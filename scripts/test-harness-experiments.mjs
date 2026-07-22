#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-harness-experiments-"));
const deviceToken = "harness-experiment-device-token";
process.env.HOME = tempHome;
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "h".repeat(40);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = deviceToken;

try {
  const service = await import("../src/lib/services/evaluation/harness-experiments.ts");
  const route = await import("../src/app/api/harness-experiments/route.ts");
  const { NextRequest } = await import("next/server");
  const created = await service.createHarnessExperiment({
    id: "prompt-routing-v1",
    createdAt: 1_800_000_000_000,
    contract: contract(),
    intervention: intervention(),
  });
  assert.equal(created.comparison.claimReady, false);
  assert.match(created.comparison.claimLimits[0], /3 baseline/i);

  let current = created;
  for (const condition of ["baseline", "treatment"]) {
    for (let index = 1; index <= 3; index += 1) {
      current = await service.recordHarnessRun(created.id, run(condition, index));
    }
  }
  assert.equal(current.comparison.claimReady, true);
  assert.equal(current.comparison.acceptanceDelta, 0);
  assert.equal(current.comparison.proofDelta, 0);
  assert.equal(current.comparison.promptTokenDelta, -700);
  assert.equal(service.harnessDecisionBlock(current.comparison, "retain"), null);
  const wrongEvaluatorComparison = service.compareHarnessRuns(
    current.contract,
    current.runs.map((candidate) => candidate.id === "treatment-3"
      ? { ...candidate, evaluationId: "different-grader-v1" }
      : candidate),
  );
  assert.equal(wrongEvaluatorComparison.claimReady, false);
  assert.match(wrongEvaluatorComparison.parityFailures.join(" "), /Evaluator differs/i);
  const degradedComparison = service.compareHarnessRuns(
    current.contract,
    current.runs.map((candidate) => candidate.id === "treatment-3"
      ? { ...candidate, outcome: "rejected", proof: { ...candidate.proof, workerProduced: [] } }
      : candidate),
  );
  assert.match(service.harnessDecisionBlock(degradedComparison, "retain"), /every treatment run/i);
  await assert.rejects(() => service.recordHarnessRun(created.id, run("baseline", 4)), /run budget/i);

  const retained = await service.decideHarnessExperiment({
    experimentId: created.id,
    decision: "retain",
    evidence: ["Three fixed-worker treatment runs preserved accepted outcomes and worker-produced proof while using 700 fewer prompt tokens on average."],
    retirementCondition: "Retest when the model, prompt contract, or context index changes materially.",
  });
  assert.equal(retained.decision, "retain");

  const listed = await service.listHarnessExperiments({ decision: "retain" });
  assert.equal(listed.experiments.length, 1);
  assert.equal(listed.experiments[0].runs.length, 6);

  const unauthorized = await route.GET(new NextRequest("http://127.0.0.1/api/harness-experiments"));
  assert.equal(unauthorized.status, 401);
  const response = await route.GET(authedRequest(NextRequest, "http://127.0.0.1/api/harness-experiments?limit=5"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.experiments[0].id, created.id);

  const concurrent = await service.createHarnessExperiment({
    id: "concurrent-runs-v1",
    contract: { ...contract(), budget: { ...contract().budget, maxRunsPerCondition: 4 } },
    intervention: intervention(),
  });
  await Promise.all([
    service.recordHarnessRun(concurrent.id, run("baseline", 1)),
    service.recordHarnessRun(concurrent.id, run("baseline", 2)),
  ]);
  assert.equal((await service.getHarnessExperiment(concurrent.id)).runs.length, 2, "concurrent run receipts must not lose an append");

  const raw = await readFile(join(tempHome, ".hivemindos", "harness-experiments.jsonl"), "utf8");
  assert.equal(raw.includes("sk-abcdefghijklmnopqrstuvwxyz123456"), false);
  assert(raw.trim().split(/\r?\n/).length >= 8, "append-only snapshots should preserve the experiment history");

  console.log("harness experiment store, comparison, decision, and API checks passed");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function contract() {
  return {
    title: "Targeted prompt routing",
    targetRevision: "abc123",
    externalState: "Fixture corpus v1",
    worker: { runtime: "codex", model: "gpt-test", configurationHash: "worker-v1" },
    representativeJob: "Identify the existing chat owners and verification command.",
    acceptedOutcome: "The answer names existing owners and a runnable focused test.",
    evaluatorId: "repository-plan-grader-v1",
    proofRequired: ["All claimed paths exist", "The focused command passes"],
    authority: {
      mode: "workspace-write",
      approvalBoundary: "No commit, push, deploy, or external send.",
      recoveryPath: "Discard only the isolated fixture worktree.",
      permissions: ["read", "write fixture"],
    },
    budget: { maxRunsPerCondition: 3, maxRuntimeMs: 60_000, maxTokens: 20_000 },
    suspectedGap: "Broad prompt context may increase cost without improving owner selection.",
  };
}

function intervention() {
  return {
    owner: "src/lib/services/chat/task-retrieval-context.ts",
    change: "Route only task-relevant context.",
    expectedBehavior: "The fixed worker names correct owners with fewer prompt tokens.",
    mechanism: "Remove irrelevant context while preserving retrieved owner evidence.",
    supportingEvidence: ["Paths and commands are verified."],
    weakeningEvidence: ["Any outcome or proof regression."],
    carryingCost: "One routing predicate and a focused regression corpus. sk-abcdefghijklmnopqrstuvwxyz123456",
  };
}

function run(condition, index) {
  const treatment = condition === "treatment";
  const startedAt = 1_800_000_000_000 + index * 10_000 + (treatment ? 1_000 : 0);
  return {
    id: `${condition}-${index}`,
    condition,
    sessionId: `${condition}-session-${index}`,
    targetRevision: "abc123",
    environmentFingerprint: "fixture-v1",
    worker: { runtime: "codex", model: "gpt-test", configurationHash: "worker-v1" },
    authorityMode: "workspace-write",
    freshSession: true,
    isolatedTarget: true,
    interventionAvailable: treatment,
    interventionExercised: treatment,
    context: {
      available: [treatment ? "targeted chat owner context" : "baseline project context"],
      retrieved: [treatment ? "targeted chat owner context" : "baseline project context"],
      invoked: [],
      relevant: ["existing route and test owners"],
    },
    proof: {
      outcome: ["5/5 claimed paths exist"],
      architecture: ["Existing chat owner preserved"],
      workerProduced: ["Focused test receipt attached"],
      evaluatorOnly: ["Hidden path grader passed"],
    },
    outcome: "accepted",
    evaluationId: "repository-plan-grader-v1",
    metrics: {
      elapsedMs: treatment ? 500 : 700,
      retries: 0,
      humanSteeringCount: 0,
      toolCallCount: 2,
      promptTokens: treatment ? 300 : 1_000,
      completionTokens: 100,
    },
    startedAt,
    completedAt: startedAt + (treatment ? 500 : 700),
  };
}

function authedRequest(NextRequest, url, init = {}) {
  return new NextRequest(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-hivemindos-device-token": deviceToken },
  });
}
