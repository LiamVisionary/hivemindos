#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  evaluateCompletionEvent,
  evaluationPolicyForEvent,
  evaluationRoutingEligible,
  sanitizeClientLoopReceipts,
} = await import("../src/lib/services/evaluation/control-plane.ts");
const {
  buildOperatingUnitLearningLoop,
  loopCompletionBlock,
  loopGateFromVerifier,
  runLoopGates,
} = await import("../src/lib/services/loops/index.ts");
const { codexAdapter, claudeCodeAdapter } = await import("../src/lib/services/runtime-adapters/cli-runtimes.ts");

const now = 1_800_000_000_000;

function completion(overrides = {}) {
  return {
    id: "run-1",
    surface: "work-board",
    status: "completed",
    observed: true,
    output: "Implemented the requested change and verified the focused tests through the real task path.",
    startedAt: now - 1_000,
    completedAt: now,
    ...overrides,
  };
}

// Policy selection is universal, but the amount of evaluation is proportional to risk.
assert.equal(evaluationPolicyForEvent(completion({ surface: "chat" })).tier, "quick");
assert.equal(evaluationPolicyForEvent(completion({ surface: "runtime-cli" })).tier, "verified");
assert.equal(
  evaluationPolicyForEvent(completion({ output: "Publish this production payment page and send it to customers." })).tier,
  "high-assurance",
);

// Quick evaluation rejects confident garbage without pretending to deeply grade ordinary chat.
assert.equal((await evaluateCompletionEvent(completion({ surface: "chat", output: "" }))).verdict, "rejected");
assert.equal((await evaluateCompletionEvent(completion({ surface: "chat", output: "I can't help with that." }))).verdict, "rejected");
assert.equal((await evaluateCompletionEvent(completion({ surface: "chat" }))).verdict, "accepted");

// An external run HivemindOS cannot observe is labeled honestly, never counted as a pass.
const unobserved = await evaluateCompletionEvent(completion({ surface: "aeon", observed: false, output: "" }));
assert.equal(unobserved.verdict, "unobserved");
assert.equal(unobserved.score, null);

// Verified artifact claims need a real verifier, not a path-shaped string.
const missingArtifact = await evaluateCompletionEvent(completion({
  artifacts: [{ kind: "file", path: "/tmp/does-not-exist" }],
}), {
  verifyArtifact: async () => ({ ok: false, evidence: ["missing"] }),
});
assert.equal(missingArtifact.verdict, "needs-evidence");
assert.ok(missingArtifact.checks.some((check) => check.id === "artifact" && check.status === "failed"));

// A structured independent judge produces real axis scores instead of unused rubric metadata.
const judged = await evaluateCompletionEvent(completion({
  risk: "high",
  rubric: {
    id: "rubric-1",
    title: "Product quality",
    scale: "0-1",
    passThreshold: 0.8,
    axes: [
      { id: "craft", title: "Craft", weight: 0.5, description: "Polished execution." },
      { id: "functionality", title: "Functionality", weight: 0.5, description: "Works through the real path." },
    ],
  },
}), {
  judge: async () => ({
    verdict: "accepted",
    confidence: 0.9,
    axes: [
      { id: "craft", score: 0.82, evidence: ["polished result"] },
      { id: "functionality", score: 0.94, evidence: ["focused test passed"] },
    ],
    summary: "Meets the bar.",
    evaluator: { agentId: "reviewer", model: "review-model", independent: true },
  }),
});
assert.equal(judged.verdict, "accepted");
assert.equal(judged.score, 0.88);
assert.equal(judged.judge?.evaluator?.independent, true);

// Server-authoritative gates cannot be self-approved through HTTP/MCP receipts.
const judgeGate = loopGateFromVerifier("agent:judge", { id: "g-judge", required: true, now });
const commandGate = loopGateFromVerifier("command:test", { id: "g-test", required: true, now });
const evidenceGate = loopGateFromVerifier("receipt:evidence", { id: "g-evidence", required: true, now });
const loop = { mode: "closed", goal: "verify", successCriteria: [], evalGates: [judgeGate, commandGate, evidenceGate] };
const clientReceipts = [
  { id: "r-judge", gateId: "g-judge", verifier: "agent:judge", status: "passed", summary: "self-approved", evidence: [], createdAt: now },
  { id: "r-test", gateId: "g-test", status: "passed", summary: "tests passed", evidence: [], createdAt: now },
  { id: "r-evidence", gateId: "g-evidence", status: "passed", summary: "evidence candidate", evidence: ["result"], createdAt: now },
];
const sanitized = sanitizeClientLoopReceipts(loop, clientReceipts);
assert.deepEqual(sanitized.map((receipt) => receipt.id), ["r-evidence"]);

// Server receipts are bound to the output. Reusing a valid judge receipt for changed output fails closed.
const originalOutput = "Original result with concrete verification evidence.";
const gateRun = await runLoopGates({
  loop: { ...loop, evalGates: [judgeGate] },
  output: originalOutput,
  judge: async () => ({ accepted: true, summary: "accepted", evaluator: { agentId: "reviewer", independent: true } }),
  now,
});
assert.equal(loopCompletionBlock({ ...loop, evalGates: [judgeGate] }, gateRun.receipts, originalOutput), null);
assert.ok(loopCompletionBlock({ ...loop, evalGates: [judgeGate] }, gateRun.receipts, "Changed output"));
assert.ok(loopCompletionBlock(
  { ...loop, evalGates: [{ ...judgeGate, status: "passed" }] },
  gateRun.receipts,
  "Changed output",
), "a stale passed gate status cannot bypass output binding");

// Default outward-facing company work now receives a required independent judge gate.
const companyLoop = buildOperatingUnitLearningLoop({
  unitId: "company-1",
  unitName: "Example Company",
  workTitle: "Publish customer landing page",
  runId: "run-1",
  now,
});
assert.ok(companyLoop.evalGates.some((gate) => gate.verifier === "agent:judge" && gate.required));
assert.ok(companyLoop.evalGates.some((gate) => gate.verifier === "receipt:evidence" && gate.required));

// Routing learns from evaluated task outcomes, not casual chat completion volume.
const acceptedTask = await evaluateCompletionEvent(completion());
const acceptedChat = await evaluateCompletionEvent(completion({ surface: "chat" }));
assert.equal(evaluationRoutingEligible(acceptedTask), true);
assert.equal(evaluationRoutingEligible(acceptedChat), false);

// Managed Codex and Claude Code runs expose a real background execution path.
assert.equal(codexAdapter.capabilities.backgroundTasks, true);
assert.equal(codexAdapter.capabilities.runs, true);
assert.equal(claudeCodeAdapter.capabilities.backgroundTasks, true);
assert.equal(claudeCodeAdapter.capabilities.runs, true);

console.log("evaluation control plane tests passed");
