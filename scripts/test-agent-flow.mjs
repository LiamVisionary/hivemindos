#!/usr/bin/env node
// Verifies the agent-flow engine + runner: conditional edges, bounded loops, HITL approval,
// shared state threading, the sequential builder, and event-driven dispatch via the runner.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// 8. Diamond topology: A fans out to B and C in parallel; the join D waits for BOTH.
{
  const diamond = {
    id: "diamond",
    name: "Diamond",
    start: "a",
    nodes: [
      { id: "a", kind: "task", title: "A" },
      { id: "b", kind: "task", title: "B" },
      { id: "c", kind: "task", title: "C" },
      { id: "d", kind: "task", title: "D (join)" },
    ],
    edges: [
      { from: "a", to: "b", when: { on: "success" } },
      { from: "a", to: "c", when: { on: "success" } },
      { from: "b", to: "d", when: { on: "success" } },
      { from: "c", to: "d", when: { on: "success" } },
      { from: "d", to: "DONE", when: { on: "success" } },
    ],
  };
  assert.deepEqual(validateFlow(diamond), []);

  let run = instantiateFlow(diamond, { runId: "rd", now: now() });
  assert.deepEqual(run.activeNodeIds, ["a"]);
  run = applyNodeResult(diamond, run, { kind: "task", outcome: "passed", output: "a-out" }, { now: now() });
  assert.deepEqual([...run.activeNodeIds].sort(), ["b", "c"], "success fans out to BOTH branches");
  assert.deepEqual([...run.pendingDispatchNodeIds].sort(), ["b", "c"], "both branches are pending dispatch");

  run = applyNodeResult(diamond, run, { kind: "task", outcome: "passed", output: "b-out" }, { now: now(), nodeId: "b" });
  assert.deepEqual(run.activeNodeIds, ["c"], "the join is NOT active after only one inbound branch");
  assert.equal(run.status, "running");

  run = applyNodeResult(diamond, run, { kind: "task", outcome: "passed", output: "c-out" }, { now: now(), nodeId: "c" });
  assert.deepEqual(run.activeNodeIds, ["d"], "the join activates once BOTH inbound branches fired");
  assert.deepEqual(run.firedEdges, [], "consumed join entries re-arm for loops");
  assert.equal(run.state["outcome.b"], "passed", "branch outcomes are readable in shared state");

  run = applyNodeResult(diamond, run, { kind: "task", outcome: "passed" }, { now: now(), nodeId: "d" });
  assert.equal(run.status, "done");

  // A completion for a node that is not active (stale/duplicate) is a no-op.
  const before = run;
  const after = applyNodeResult(diamond, run, { kind: "task", outcome: "passed" }, { now: now(), nodeId: "b" });
  assert.equal(after, before);

  // Runner-driven: parallel branches dispatch together; the join dispatches once.
  const vaultPath = mkdtempSync(join(tmpdir(), "flow-diamond-test-"));
  const dispatched = [];
  const dispatch = async (node) => { dispatched.push(node.id); return { taskId: `t-${node.id}` }; };
  await runner.startFlowRun(diamond, { vaultPath, dispatch, runId: "dia-1", now: 1 });
  assert.deepEqual(dispatched, ["a"]);
  await runner.maybeAdvanceFlowForTask({ source: "flow:dia-1:a", outcome: "passed", output: "a", vaultPath, dispatch, loopReceipts: [] });
  assert.deepEqual(dispatched, ["a", "b", "c"], "advance dispatches every activated branch");
  await runner.maybeAdvanceFlowForTask({ source: "flow:dia-1:b", outcome: "passed", output: "b", vaultPath, dispatch, loopReceipts: [] });
  assert.deepEqual(dispatched, ["a", "b", "c"], "the waiting join is not dispatched early");
  const joined = await runner.maybeAdvanceFlowForTask({ source: "flow:dia-1:c", outcome: "passed", output: "c", vaultPath, dispatch, loopReceipts: [] });
  assert.deepEqual(dispatched, ["a", "b", "c", "d"], "the join dispatches once both branches completed");
  assert.deepEqual(joined.activeNodeIds, ["d"]);
}

// 9. Legacy (v1 single-active-node) persisted runs migrate on read and advance correctly.
{
  const vaultPath = mkdtempSync(join(tmpdir(), "flow-migrate-test-"));
  const runsDir = join(vaultPath, "Operations", "Flows", "runs");
  mkdirSync(runsDir, { recursive: true });
  const legacy = {
    spec: RESEARCH_WRITE_CRITIQUE,
    run: {
      flowId: RESEARCH_WRITE_CRITIQUE.id,
      flowName: RESEARCH_WRITE_CRITIQUE.name,
      runId: "legacy-1",
      status: "running",
      currentNodeId: "write",
      state: { "output.research": "findings", last: "findings" },
      history: [{ nodeId: "research", kind: "task", attempt: 1, outcome: "passed", output: "findings", at: 1 }],
      stepCount: 1,
      startedAt: 1,
    },
    fleetSnapshot: null,
  };
  writeFileSync(join(runsDir, "legacy-1.json"), JSON.stringify(legacy, null, 2));

  const loaded = await runner.getFlowRun("legacy-1", { vaultPath });
  assert.equal(loaded.run.version, 2, "legacy run migrates on read");
  assert.deepEqual(loaded.run.activeNodeIds, ["write"], "currentNodeId becomes the single active node");
  assert.deepEqual(loaded.run.firedEdges, []);

  const dispatched = [];
  const dispatch = async (node) => { dispatched.push(node.id); return { taskId: `t-${node.id}` }; };
  const advanced = await runner.maybeAdvanceFlowForTask({ source: "flow:legacy-1:write", outcome: "passed", output: "draft", vaultPath, dispatch, loopReceipts: [] });
  assert.deepEqual(advanced.activeNodeIds, ["critique"], "a migrated run advances normally");
  assert.equal(advanced.currentNodeId, "critique", "the compatibility mirror tracks the active node");
  const persisted = JSON.parse(readFileSync(join(runsDir, "legacy-1.json"), "utf8"));
  assert.equal(persisted.run.version, 2, "the migrated shape is persisted on the first write");
  assert.deepEqual(persisted.run.activeNodeIds, ["critique"]);
}

// 10. Score-gated edges on one source stay mutually exclusive even when ranges overlap.
{
  const spec = {
    id: "score-x",
    name: "Score exclusivity",
    start: "review",
    nodes: [
      { id: "review", kind: "task", title: "Review" },
      { id: "revise", kind: "task", title: "Revise" },
      { id: "ship", kind: "task", title: "Ship" },
    ],
    edges: [
      // Overlapping ranges: 0.7 satisfies BOTH conditions; only the first fires.
      { from: "review", to: "revise", when: { on: "score", lt: 0.9 } },
      { from: "review", to: "ship", when: { on: "score", gte: 0.5 } },
    ],
  };
  let run = instantiateFlow(spec, { runId: "rx", now: now() });
  run = applyNodeResult(spec, run, { kind: "task", outcome: "passed", score: 0.7 }, { now: now() });
  assert.deepEqual(run.activeNodeIds, ["revise"], "only the FIRST matching score edge fires");
}

// 11. Score edges route on the INDEPENDENT judge's weighted rubric score when the
// completion carries a judge receipt — the node's own "score: 0.NN" prose loses.
{
  const judgeReceipt = (scores, at = 10) => ({
    id: `lr_judge_${at}`,
    gateId: "flow-review-score-judge",
    status: "passed",
    summary: "judge",
    evidence: [],
    metadata: {
      source: "judge",
      axes: Object.entries(scores).map(([id, score]) => ({ id, score })),
      evaluator: { independent: true },
    },
    createdAt: at,
  });

  // Weighted formula: goal-fit 0.4, evidence 0.3, usability 0.3.
  assert.ok(Math.abs(runner.flowScoreFromReceipts([judgeReceipt({ "goal-fit": 1, evidence: 0.5, usability: 0.5 })]) - 0.7) < 1e-9);
  assert.equal(runner.flowScoreFromReceipts([]), undefined);
  assert.equal(
    runner.flowScoreFromReceipts([{ id: "x", status: "passed", summary: "not a judge", evidence: [], metadata: { source: "evidence" }, createdAt: 1 }]),
    undefined,
    "non-judge receipts never produce a score",
  );
  assert.equal(
    runner.flowScoreFromReceipts([judgeReceipt({}), { ...judgeReceipt({}), metadata: { source: "judge", confidence: 0.8 }, createdAt: 20 }]),
    0.8,
    "a judge receipt without usable axes falls back to its confidence",
  );

  const vaultPath = mkdtempSync(join(tmpdir(), "flow-judge-test-"));
  const dispatch = async (node) => ({ taskId: `t-${node.id}` });
  const opts = { vaultPath, dispatch };

  // Judge says the draft is GOOD (0.9): routes to publish even though the worker's
  // own text claims a failing "score: 0.2".
  await runner.startFlowRun(RESEARCH_DRAFT_PUBLISH, { ...opts, runId: "judge-1", now: 1, state: { topic: "x" } });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-1:research", outcome: "passed", output: "f", vaultPath, dispatch, loopReceipts: [] });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-1:draft", outcome: "passed", output: "d", vaultPath, dispatch, loopReceipts: [] });
  const good = await runner.maybeAdvanceFlowForTask({
    source: "flow:judge-1:review",
    outcome: "passed",
    output: "self-review says score: 0.2",
    vaultPath,
    dispatch,
    loopReceipts: [judgeReceipt({ "goal-fit": 0.9, evidence: 0.9, usability: 0.9 })],
  });
  assert.deepEqual(good.activeNodeIds, ["publish"], "the judge's weighted score outranks the node's own prose score");

  // Judge says the draft is BAD (0.3): loops back despite a self-reported 0.95.
  await runner.startFlowRun(RESEARCH_DRAFT_PUBLISH, { ...opts, runId: "judge-2", now: 1, state: { topic: "x" } });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-2:research", outcome: "passed", output: "f", vaultPath, dispatch, loopReceipts: [] });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-2:draft", outcome: "passed", output: "d", vaultPath, dispatch, loopReceipts: [] });
  const bad = await runner.maybeAdvanceFlowForTask({
    source: "flow:judge-2:review",
    outcome: "passed",
    output: "looks great, score: 0.95",
    vaultPath,
    dispatch,
    loopReceipts: [judgeReceipt({ "goal-fit": 0.3, evidence: 0.3, usability: 0.3 })],
  });
  assert.deepEqual(bad.activeNodeIds, ["research"], "a low judge score loops back regardless of self-reported prose");

  // No judge receipt at all (e.g. judge disabled): the regex fallback still routes.
  await runner.startFlowRun(RESEARCH_DRAFT_PUBLISH, { ...opts, runId: "judge-3", now: 1, state: { topic: "x" } });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-3:research", outcome: "passed", output: "f", vaultPath, dispatch, loopReceipts: [] });
  await runner.maybeAdvanceFlowForTask({ source: "flow:judge-3:draft", outcome: "passed", output: "d", vaultPath, dispatch, loopReceipts: [] });
  const regex = await runner.maybeAdvanceFlowForTask({
    source: "flow:judge-3:review",
    outcome: "passed",
    output: "Solid draft. score: 0.85",
    vaultPath,
    dispatch,
    loopReceipts: [],
  });
  assert.deepEqual(regex.activeNodeIds, ["publish"], "regex fallback routes when no judge receipt exists");
}

// 12. Production path: receipts are read back off the Work Board by the task's flow
// source tag when the caller does not hand them over.
{
  const vaultPath = mkdtempSync(join(tmpdir(), "flow-board-receipts-test-"));
  const kanban = await import("../src/lib/services/kanban/local-kanban-store.ts");
  const dispatch = async (node) => ({ taskId: `t-${node.id}` });

  await runner.startFlowRun(RESEARCH_DRAFT_PUBLISH, { vaultPath, dispatch, runId: "board-1", now: 1, state: { topic: "x" } });
  await runner.maybeAdvanceFlowForTask({ source: "flow:board-1:research", outcome: "passed", output: "f", vaultPath, dispatch, loopReceipts: [] });
  await runner.maybeAdvanceFlowForTask({ source: "flow:board-1:draft", outcome: "passed", output: "d", vaultPath, dispatch, loopReceipts: [] });

  await kanban.createTask(null, {
    title: "Quality review",
    body: "flow node task",
    source: "flow:board-1:review",
    status: "done",
    loopReceipts: [{
      id: "lr_judge_board",
      gateId: "flow-review-score-judge",
      status: "passed",
      summary: "judge scored",
      evidence: [],
      metadata: { source: "judge", axes: [{ id: "goal-fit", score: 0.9 }, { id: "evidence", score: 0.9 }, { id: "usability", score: 0.9 }] },
      createdAt: 5,
    }],
  }, { vaultPath });

  const advanced = await runner.maybeAdvanceFlowForTask({
    source: "flow:board-1:review",
    outcome: "passed",
    output: "self-review says score: 0.1",
    vaultPath,
    dispatch,
  });
  assert.deepEqual(advanced.activeNodeIds, ["publish"], "board-persisted judge receipts are found by source tag and win");
}

// 13. Score-emitting nodes get the independent-judge loop from the default dispatch
// builders; the QUEEN_BEE_FLOW_SCORE_JUDGE=0 kill-switch disables it.
{
  assert.equal(runner.flowNodeEmitsScore(RESEARCH_DRAFT_PUBLISH, "review"), true);
  assert.equal(runner.flowNodeEmitsScore(RESEARCH_DRAFT_PUBLISH, "research"), false);

  const review = RESEARCH_DRAFT_PUBLISH.nodes.find((n) => n.id === "review");
  const loop = runner.buildFlowScoreJudgeLoop(review, RESEARCH_DRAFT_PUBLISH, 1);
  assert.ok(loop, "a score-emitting node gets a judge loop");
  assert.equal(loop.evalGates.length, 1);
  assert.equal(loop.evalGates[0].verifier, "agent:judge");
  assert.equal(loop.evalGates[0].required, false, "the score is a routing signal — it must never park the task needs-human");
  assert.equal(loop.evaluationRubric.axes.length, 3);
  assert.equal(Math.round(loop.evaluationRubric.axes.reduce((s, a) => s + a.weight, 0) * 100), 100);

  const research = RESEARCH_DRAFT_PUBLISH.nodes.find((n) => n.id === "research");
  assert.equal(runner.buildFlowScoreJudgeLoop(research, RESEARCH_DRAFT_PUBLISH, 1), undefined, "non-scoring nodes get no judge loop");

  process.env.QUEEN_BEE_FLOW_SCORE_JUDGE = "0";
  try {
    assert.equal(runner.buildFlowScoreJudgeLoop(review, RESEARCH_DRAFT_PUBLISH, 1), undefined, "the kill-switch disables the judge loop");
  } finally {
    delete process.env.QUEEN_BEE_FLOW_SCORE_JUDGE;
  }
}

console.log("Agent flow tests passed.");
process.exit(0);
