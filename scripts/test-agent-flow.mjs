#!/usr/bin/env node
// Verifies the agent-flow engine + runner: conditional edges, bounded loops, HITL approval,
// shared state threading, the sequential builder, and event-driven dispatch via the runner.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const engine = await import("../src/lib/services/queen-bee/flow-engine.ts");
const templates = await import("../src/lib/services/queen-bee/flow-templates.ts");
const runner = await import("../src/lib/services/queen-bee/flow-runner.ts");

const { instantiateFlow, applyNodeResult, validateFlow, renderNodePrompt } = engine;
const { RESEARCH_DRAFT_PUBLISH, RESEARCH_WRITE_CRITIQUE, flowFromSequence } = templates;

let t = 0;
const now = () => ++t;

// 1. Branch + bounded loop + HITL on the canonical LangGraph example.
{
  assert.deepEqual(validateFlow(RESEARCH_DRAFT_PUBLISH).filter((e) => !e.includes("no outgoing edge")), [], "template should validate");
  let run = instantiateFlow(RESEARCH_DRAFT_PUBLISH, { runId: "r0", now: now(), state: { topic: "agent OS" } });
  assert.equal(run.currentNodeId, "research");

  const step = (result) => { run = applyNodeResult(RESEARCH_DRAFT_PUBLISH, run, result, { now: now() }); };

  step({ kind: "task", outcome: "passed", output: "findings-1" });
  assert.equal(run.currentNodeId, "draft");
  assert.equal(run.state["output.research"], "findings-1", "output threads into shared state");

  step({ kind: "task", outcome: "passed", output: "draft-1" });
  assert.equal(run.currentNodeId, "review");

  // Quality below bar -> loop back to research.
  step({ kind: "task", outcome: "passed", score: 0.4 });
  assert.equal(run.currentNodeId, "research", "score < bar loops back to research");

  step({ kind: "task", outcome: "passed", output: "findings-2" });
  step({ kind: "task", outcome: "passed", output: "draft-2" });
  // Quality clears the bar -> publish.
  step({ kind: "task", outcome: "passed", score: 0.9 });
  assert.equal(run.currentNodeId, "publish", "score >= bar advances to publish");

  step({ kind: "task", outcome: "passed", output: "published" });
  assert.equal(run.status, "awaiting-human", "publish hands off to the HITL approval node");
  assert.equal(run.currentNodeId, "approve");

  step({ kind: "approval", approved: true });
  assert.equal(run.status, "done", "approved -> done");
  assert.equal(run.history.filter((h) => h.nodeId === "research").length, 2, "research ran twice (looped)");
}

// 2. Budget cap stops an infinite loop.
{
  const spec = { id: "loopy", name: "Loopy", start: "a", maxSteps: 5, nodes: [{ id: "a", kind: "task", title: "A" }], edges: [{ from: "a", to: "a", when: { on: "always" } }] };
  let run = instantiateFlow(spec, { runId: "rl", now: now() });
  let guard = 0;
  while (run.status === "running" && guard++ < 100) run = applyNodeResult(spec, run, { kind: "task", outcome: "passed" }, { now: now() });
  assert.equal(run.status, "failed");
  assert.match(run.failureReason, /maxSteps/);
}

// 3. Approval rejection routes to FAIL.
{
  let run = instantiateFlow(RESEARCH_DRAFT_PUBLISH, { runId: "r3", now: now(), state: {} });
  const step = (result) => { run = applyNodeResult(RESEARCH_DRAFT_PUBLISH, run, result, { now: now() }); };
  step({ kind: "task", outcome: "passed" });
  step({ kind: "task", outcome: "passed" });
  step({ kind: "task", outcome: "passed", score: 0.9 });
  step({ kind: "task", outcome: "passed" });
  step({ kind: "approval", approved: false });
  assert.equal(run.status, "failed", "rejected approval -> FAIL");
}

// 4. Sequential builder + prompt rendering.
{
  const spec = flowFromSequence(
    [
      { title: "Research", workerClass: "research", prompt: "Research {{state.topic}}" },
      { title: "Write", workerClass: "writer", prompt: "Write from {{last}}" },
    ],
    { id: "seq", name: "Seq" },
  );
  assert.equal(spec.nodes.length, 2);
  assert.equal(spec.start, "step-1");
  let run = instantiateFlow(spec, { runId: "rs", now: now(), state: { topic: "bees" } });
  assert.equal(renderNodePrompt(spec.nodes[0], run), "Research bees", "state substitution");
  run = applyNodeResult(spec, run, { kind: "task", outcome: "passed", output: "F" }, { now: now() });
  assert.equal(renderNodePrompt(spec.nodes[1], run), "Write from F", "{{last}} threads prior output");
  run = applyNodeResult(spec, run, { kind: "task", outcome: "passed" }, { now: now() });
  assert.equal(run.status, "done");
}

// 5. Runner drives a full run via injected (mock) dispatch, persisting to a temp vault.
{
  const vaultPath = mkdtempSync(join(tmpdir(), "flow-runner-test-"));
  const dispatched = [];
  const dispatch = async (node) => { dispatched.push(node.id); return { taskId: `t-${node.id}` }; };
  const opts = { vaultPath, dispatch, runId: "run-1", now: 1, fleetSnapshot: [{ key: "m1" }] };

  let run = await runner.startFlowRun(RESEARCH_WRITE_CRITIQUE, opts);
  assert.equal(run.currentNodeId, "research");
  assert.deepEqual(dispatched, ["research"], "start dispatches the first task node");

  run = await runner.advanceFlowRun("run-1", { kind: "task", outcome: "passed", output: "findings" }, opts);
  assert.equal(run.currentNodeId, "write");
  run = await runner.advanceFlowRun("run-1", { kind: "task", outcome: "passed", output: "draft" }, opts);
  assert.equal(run.currentNodeId, "critique");
  run = await runner.advanceFlowRun("run-1", { kind: "task", outcome: "passed" }, opts);
  assert.equal(run.status, "done");
  assert.deepEqual(dispatched, ["research", "write", "critique"], "each task node dispatched in order");

  const reloaded = await runner.getFlowRun("run-1", { vaultPath });
  assert.equal(reloaded.run.status, "done", "run persisted to the vault");
  assert.equal(reloaded.run.state["output.research"], "findings", "shared state persisted");
  assert.equal(reloaded.fleetSnapshot?.[0]?.key, "m1", "fleet snapshot persisted for worker-driven advances");
}

// 6. Auto-advance from a completed flow-tagged task (the autonomous-worker path).
{
  assert.deepEqual(runner.parseFlowTaskSource("flow:run-x:review"), { runId: "run-x", nodeId: "review" });
  assert.equal(runner.parseFlowTaskSource("api"), null);

  const vaultPath = mkdtempSync(join(tmpdir(), "flow-advance-test-"));
  const dispatched = [];
  const dispatch = async (node) => { dispatched.push(node.id); return { taskId: `t-${node.id}` }; };

  // Sequential run, advanced purely via maybeAdvanceFlowForTask (as the worker would).
  await runner.startFlowRun(RESEARCH_WRITE_CRITIQUE, { vaultPath, dispatch, runId: "auto-1", now: 1 });
  // Stale/mismatched node id is a no-op (does not double-advance).
  const noop = await runner.maybeAdvanceFlowForTask({ source: "flow:auto-1:write", outcome: "passed", output: "x", vaultPath, dispatch });
  assert.equal(noop, null, "advancing a non-current node is a no-op");

  let run = await runner.maybeAdvanceFlowForTask({ source: "flow:auto-1:research", outcome: "passed", output: "findings", vaultPath, dispatch });
  assert.equal(run.currentNodeId, "write", "completing the current node advances the flow");
  run = await runner.maybeAdvanceFlowForTask({ source: "flow:auto-1:write", outcome: "passed", output: "draft", vaultPath, dispatch });
  run = await runner.maybeAdvanceFlowForTask({ source: "flow:auto-1:critique", outcome: "passed", output: "final", vaultPath, dispatch });
  assert.equal(run.status, "done");
  assert.deepEqual(dispatched, ["research", "write", "critique"]);

  // Score parsing: a review node's free-text "score: 0.85" routes past the quality bar.
  await runner.startFlowRun(RESEARCH_DRAFT_PUBLISH, { vaultPath, dispatch, runId: "auto-2", now: 1, state: { topic: "x" } });
  await runner.maybeAdvanceFlowForTask({ source: "flow:auto-2:research", outcome: "passed", output: "f", vaultPath, dispatch });
  await runner.maybeAdvanceFlowForTask({ source: "flow:auto-2:draft", outcome: "passed", output: "d", vaultPath, dispatch });
  const afterReview = await runner.maybeAdvanceFlowForTask({ source: "flow:auto-2:review", outcome: "passed", output: "Looks good. score: 0.85", vaultPath, dispatch });
  assert.equal(afterReview.currentNodeId, "publish", "parsed score >= bar routes to publish");
}

// 7. Crypto Research Crew template: registration, validation, happy path, score-gated loop-back,
// and prompt rendering of {{state.framework}} / {{output.collector}}.
{
  // A temp vault keeps getFlowTemplate hermetic (no saved templates can shadow the built-in).
  const vaultPath = mkdtempSync(join(tmpdir(), "flow-crypto-crew-test-"));
  const spec = await templates.getFlowTemplate("crypto-research-crew", { vaultPath });
  assert.ok(spec, "crypto-research-crew resolves via getFlowTemplate");
  assert.equal(spec.name, "Crypto Research Crew");
  assert.deepEqual(validateFlow(spec).filter((e) => !e.includes("no outgoing edge")), [], "template should validate");

  let run = instantiateFlow(spec, {
    runId: "rc",
    now: now(),
    state: { token: "HIVE", chain: "base", framework: "receipts-first: assume unproven until on-chain receipts" },
  });
  assert.equal(run.currentNodeId, "collector");
  const step = (result) => { run = applyNodeResult(spec, run, result, { now: now() }); };

  step({ kind: "task", outcome: "passed", output: "collected-facts" });
  assert.equal(run.currentNodeId, "onchain");
  assert.equal(run.state["output.collector"], "collected-facts", "collector output threads into shared state");
  step({ kind: "task", outcome: "passed", output: "onchain-findings" });
  assert.equal(run.currentNodeId, "sentiment");
  step({ kind: "task", outcome: "passed", output: "sentiment-read" });
  assert.equal(run.currentNodeId, "chart");
  step({ kind: "task", outcome: "passed", output: "chart-read" });
  assert.equal(run.currentNodeId, "analyst");

  const analystNode = spec.nodes.find((n) => n.id === "analyst");
  const rendered = renderNodePrompt(analystNode, run);
  assert.ok(rendered.includes("receipts-first: assume unproven until on-chain receipts"), "{{state.framework}} substituted");
  assert.ok(rendered.includes("collected-facts"), "{{output.collector}} substituted");
  assert.ok(!rendered.includes("{{"), "no unresolved placeholders in the analyst prompt");

  step({ kind: "task", outcome: "passed", output: "thesis-v1" });
  assert.equal(run.currentNodeId, "devils-advocate");

  // Weak thesis -> loop back to the analyst.
  step({ kind: "task", outcome: "passed", score: 0.4, output: "attack found holes. score: 0.40" });
  assert.equal(run.currentNodeId, "analyst", "score < 0.6 loops back to analyst");

  step({ kind: "task", outcome: "passed", output: "thesis-v2" });
  assert.equal(run.currentNodeId, "devils-advocate");
  // Thesis survives -> queen synthesis.
  step({ kind: "task", outcome: "passed", score: 0.8, output: "attack survived. score: 0.80" });
  assert.equal(run.currentNodeId, "queen", "score >= 0.6 advances to queen");

  step({ kind: "task", outcome: "passed", output: "final report" });
  assert.equal(run.status, "done");
  assert.deepEqual(
    run.history.map((h) => h.nodeId),
    ["collector", "onchain", "sentiment", "chart", "analyst", "devils-advocate", "analyst", "devils-advocate", "queen"],
    "crew ran in order with exactly one adversarial loop-back",
  );
}

console.log("Agent flow tests passed.");
process.exit(0);
