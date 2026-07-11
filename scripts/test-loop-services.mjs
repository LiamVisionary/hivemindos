#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

// The loop services statically import @/-aliased modules; register the repo's
// TS-relative loader before importing them (the established scripts/test-*.mjs pattern).
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildLoopFromTemplate,
  buildOperatingUnitLearningLoop,
  computeLoopCapabilityCapital,
  loopControlAllowsProgress,
  loopControlKey,
  loopGateFromVerifier,
  updateLoopControlPolicy,
} = await import("../src/lib/services/loops/index.ts");

const now = 1_800_000_000_000;

const appLoop = buildLoopFromTemplate({
  templateId: "app-build-harness",
  goal: "Build a small castle level editor.",
  maxAttempts: 5,
  now,
});

assert.equal(appLoop.mode, "closed");
assert.equal(appLoop.budget?.maxAttempts, 5);
assert.equal(appLoop.retryPolicy?.maxAttempts, 5);
assert(appLoop.evalGates.some((gate) => gate.verifier === "agent:judge" && gate.required), "app build template should require an independent judge gate");
assert(appLoop.evalGates.some((gate) => gate.verifier === "command:playwright"), "app build template should include a browser smoke gate");
assert.equal(appLoop.observation?.pendingRequiredGateCount, appLoop.evalGates.filter((gate) => gate.required).length);

const evoLoop = buildLoopFromTemplate({
  templateId: "evo-benchmark",
  goal: "Improve routing benchmark score.",
  benchmarkCommand: "pnpm test:routing -- --json",
  benchmarkMetricName: "held_out_score",
  now,
});

assert.equal(evoLoop.mode, "optimizer");
assert.equal(evoLoop.benchmark?.command, "pnpm test:routing -- --json");
assert.equal(evoLoop.frontierStrategy?.kind, "pareto_per_task");
assert.equal(evoLoop.experiments?.[0]?.status, "candidate");

const operatingLoop = buildOperatingUnitLearningLoop({
  unitId: "unit-a",
  unitName: "Aperture Tools",
  workTitle: "Publish onboarding landing page",
  runId: "run-1",
  metricName: "activated users",
  metricTarget: "500",
  strategicGoal: "Increase activation",
  branchAgent: "growth",
  now,
});

assert.equal(operatingLoop.mode, "optimizer");
assert(operatingLoop.goal.includes("Increase activation"));
assert(operatingLoop.evalGates.some((gate) => gate.verifier === "receipt:evidence" && gate.required), "operating-unit learning requires outcome evidence");
assert(operatingLoop.evalGates.some((gate) => gate.verifier === "agent:judge" && gate.required), "outward-facing operating-unit work requires a judge");
assert.equal(operatingLoop.benchmark?.metricName, "activated users");
assert.equal(operatingLoop.experiments?.[0]?.agent, "growth");

const capability = computeLoopCapabilityCapital({
  tasks: [{
    status: "done",
    result: "Deliverable: published onboarding checklist.",
    skills: ["growth"],
    completedAt: now,
    loop: {
      ...operatingLoop,
      evalGates: [loopGateFromVerifier("receipt:evidence", { id: "evidence", now, required: true, title: "Evidence" })],
      experiments: [{ id: "exp-a", hypothesis: "Improve activation", status: "committed", score: 0.8, createdAt: now, updatedAt: now }],
      observation: {
        totalExperiments: 1,
        committedExperiments: 1,
        discardedExperiments: 0,
        failedExperiments: 0,
        runningBestExperimentIds: ["exp-a"],
        frontier: [],
        antiPatternCount: 0,
        pendingRequiredGateCount: 1,
        updatedAt: now,
      },
    },
    loopReceipts: [],
  }],
  agents: [{ runtime: "evo" }, { runtime: "codex" }],
  totalSpentUsd: 10,
  loopAttachmentNoun: "test work",
});

assert.equal(capability.learningAssets, 2);
assert.equal(capability.workflowAssets, 2);
assert.equal(capability.evalGates, 1);
assert.equal(capability.committedExperiments, 1);
assert.equal(capability.spendEfficiency, 0.2);
assert(capability.modelIndependence > 0);

const target = { kind: "task", id: "task-1" };
const registry = updateLoopControlPolicy({}, target, { status: "paused", reason: "Waiting for approval.", maxAttempts: 4 }, now);
assert.equal(loopControlKey(target), "task:task-1");
assert.equal(registry["task:task-1"].status, "paused");
assert.equal(registry["task:task-1"].maxAttempts, 4);
assert.deepEqual(loopControlAllowsProgress(registry["task:task-1"]), { allowed: false, reason: "Waiting for approval." });
assert.deepEqual(loopControlAllowsProgress(), { allowed: true });

console.log("loop services tests passed");
