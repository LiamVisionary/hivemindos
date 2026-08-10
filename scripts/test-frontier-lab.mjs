import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  FRONTIER_LAB_DEFAULT_POLICY,
  classifyFrontierLabTaskTier,
  evaluateFrontierLabCapacity,
  evaluateFrontierLabStageTransition,
  normalizeFrontierLabPolicy,
  openAiOAuthAgentForFrontierLabTier,
} = await import("../src/lib/frontier-lab.ts");
const {
  companyIntelligenceUsageFromResponse,
  readCompanyIntelligenceSnapshot,
  releaseCompanyIntelligenceReservation,
  reserveCompanyIntelligence,
  settleCompanyIntelligenceReservation,
} = await import("../src/lib/services/company-intelligence-usage.ts");
const { buildOperatingUnitLearningLoop } = await import("../src/lib/services/loops/loop-templates.ts");

const defaultPolicy = normalizeFrontierLabPolicy(undefined);
assert.deepEqual(defaultPolicy, FRONTIER_LAB_DEFAULT_POLICY);
assert.equal(defaultPolicy.provider, "openai-oauth");
assert.deepEqual(defaultPolicy.models, {
  scout: "gpt-5.6-luna",
  builder: "gpt-5.6-terra",
  reviewer: "gpt-5.6-sol",
});

const clampedPolicy = normalizeFrontierLabPolicy({
  enabled: true,
  stage: "pilot",
  monthlyTokenLimit: 9_000_000_000,
  perTaskTokenLimit: 1,
  maxParallelTasks: 999,
  maxTasksPerCycle: 999,
  perMachineConcurrency: 999,
  elasticWorkers: true,
  requireIndependentReview: true,
  provider: "openai-oauth",
  models: {
    scout: "gpt-5.6-sol",
    builder: "gpt-5.6-luna",
    reviewer: "gpt-5.6-terra",
  },
});
assert.equal(clampedPolicy.monthlyTokenLimit, 100_000_000);
assert.equal(clampedPolicy.perTaskTokenLimit, 10_000);
assert.equal(clampedPolicy.maxParallelTasks, 4, "pilot stage owns the hard parallel ceiling");
assert.equal(clampedPolicy.maxTasksPerCycle, 4);
assert.equal(clampedPolicy.perMachineConcurrency, 1);
assert.deepEqual(clampedPolicy.models, FRONTIER_LAB_DEFAULT_POLICY.models, "the reviewed OAuth ladder is immutable");

assert.equal(classifyFrontierLabTaskTier({ title: "Research the market", skills: ["research"] }), "scout");
assert.equal(classifyFrontierLabTaskTier({ title: "Implement checkout", skills: ["Engineer"] }), "builder");
assert.equal(classifyFrontierLabTaskTier({ title: "Audit launch security", skills: ["QA"] }), "reviewer");
assert.equal(openAiOAuthAgentForFrontierLabTier("scout").provider, "openai-codex");
assert.equal(openAiOAuthAgentForFrontierLabTier("builder").model, "gpt-5.6-terra");
assert.deepEqual(
  companyIntelligenceUsageFromResponse({ usage: { input_tokens: 100, output_tokens: 50, cached_tokens: 20, reasoning_tokens: 10 } }),
  { inputTokens: 100, outputTokens: 50, cachedTokens: 20, reasoningTokens: 10, totalTokens: 150 },
  "cached and reasoning detail must not be double-counted when a collector omits total_tokens",
);

const priorJudgeFlag = process.env.QUEEN_BEE_LOOP_OUTCOME_JUDGE;
process.env.QUEEN_BEE_LOOP_OUTCOME_JUDGE = "0";
try {
  const forcedReviewLoop = buildOperatingUnitLearningLoop({
    unitId: "frontier-review-contract",
    unitName: "Frontier Review Contract",
    workTitle: "Build reviewed work",
    runId: "run-review-contract",
    requireIndependentJudge: true,
  });
  assert(forcedReviewLoop.evalGates?.some((gate) => gate.verifier === "agent:judge" && gate.required), "Frontier review cannot be disabled by the ordinary-company judge flag");
} finally {
  if (priorJudgeFlag === undefined) delete process.env.QUEEN_BEE_LOOP_OUTCOME_JUDGE;
  else process.env.QUEEN_BEE_LOOP_OUTCOME_JUDGE = priorJudgeFlag;
}

const pilotCapacity = evaluateFrontierLabCapacity({
  policy: { ...defaultPolicy, enabled: true },
  dispatchableMembers: 2,
  activeTasks: 1,
  settledTokens: 100_000,
  reservedTokens: 150_000,
});
assert.equal(pilotCapacity.availableSlots, 3, "elastic slots may exceed the physical member count");
assert.equal(pilotCapacity.remainingTokens, defaultPolicy.monthlyTokenLimit - 250_000);

const scarceCapacity = evaluateFrontierLabCapacity({
  policy: { ...defaultPolicy, enabled: true, monthlyTokenLimit: 300_000, perTaskTokenLimit: 250_000 },
  dispatchableMembers: 5,
  activeTasks: 0,
  settledTokens: 100_000,
  reservedTokens: 0,
});
assert.equal(scarceCapacity.availableSlots, 0);
assert.match(scarceCapacity.blockedReason ?? "", /token budget/i);

const offlineCapacity = evaluateFrontierLabCapacity({
  policy: { ...defaultPolicy, enabled: true },
  dispatchableMembers: 0,
  activeTasks: 0,
  settledTokens: 0,
  reservedTokens: 0,
});
assert.equal(offlineCapacity.availableSlots, 0, "elastic slots still require online worker and reviewer identities");
assert.match(offlineCapacity.blockedReason ?? "", /online/i);

const unreviewableCapacity = evaluateFrontierLabCapacity({
  policy: { ...defaultPolicy, enabled: true },
  dispatchableMembers: 1,
  activeTasks: 0,
  settledTokens: 0,
  reservedTokens: 0,
});
assert.equal(unreviewableCapacity.availableSlots, 0, "one online identity cannot independently review itself");
assert.match(unreviewableCapacity.blockedReason ?? "", /two dispatchable/i);

assert.equal(
  evaluateFrontierLabStageTransition("pilot", "team", { settledTasks: 2, completedTasks: 2 }).allowed,
  false,
);
assert.equal(
  evaluateFrontierLabStageTransition("pilot", "team", { settledTasks: 3, completedTasks: 2 }).allowed,
  true,
);
assert.equal(
  evaluateFrontierLabStageTransition("team", "frontier", { settledTasks: 12, completedTasks: 9 }).allowed,
  false,
);
assert.equal(
  evaluateFrontierLabStageTransition("team", "frontier", { settledTasks: 15, completedTasks: 12 }).allowed,
  true,
);
assert.equal(
  evaluateFrontierLabStageTransition("frontier", "pilot", { settledTasks: 0, completedTasks: 0 }).allowed,
  true,
  "scale-down is always reversible",
);

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-frontier-lab-"));
const ledgerPath = join(tempRoot, "company-intelligence-usage.json");
const now = Date.UTC(2026, 7, 2, 12, 0, 0);
const company = {
  id: "company-frontier-test",
  frozen: false,
  frontierLab: { ...defaultPolicy, enabled: true, monthlyTokenLimit: 600_000, perTaskTokenLimit: 250_000, maxParallelTasks: 1 },
};

try {
  const first = await reserveCompanyIntelligence(company, {
    reservationId: "task-a:attempt-1",
    taskId: "task-a",
    tier: "builder",
  }, { filePath: ledgerPath, now: () => now });
  assert.equal(first.decision, "allow");
  assert.equal(first.duplicate, false);
  assert.equal(first.record?.model, "gpt-5.6-terra");
  assert.equal(first.record?.stage, "pilot", "reservations must retain the operating stage for smaller-stage versus treatment comparisons");

  const duplicate = await reserveCompanyIntelligence(company, {
    reservationId: "task-a:attempt-1",
    taskId: "task-a",
    tier: "builder",
  }, { filePath: ledgerPath, now: () => now + 10 });
  assert.equal(duplicate.decision, "allow");
  assert.equal(duplicate.duplicate, true, "reservations are retry-safe");

  const parallelBlocked = await reserveCompanyIntelligence(company, {
    reservationId: "task-parallel:attempt-1",
    taskId: "task-parallel",
    tier: "scout",
  }, { filePath: ledgerPath, now: () => now + 15 });
  assert.equal(parallelBlocked.decision, "block");
  assert.match(parallelBlocked.reason ?? "", /active Frontier Lab reservation/i);

  await settleCompanyIntelligenceReservation(company.id, "task-a:attempt-1", {
    outcome: "completed",
    usage: { inputTokens: 80_000, outputTokens: 20_000, cachedTokens: 10_000, reasoningTokens: 5_000, totalTokens: 105_000 },
    scaleEvidence: {
      policyVersion: "earned-scale-v1",
      outcomeScore: 0.9,
      proofSatisfied: true,
      latencyMs: 1_250,
      uniqueContribution: true,
      duplicationConflict: false,
      humanIntervention: false,
      reviewerDisagreement: false,
    },
  }, { filePath: ledgerPath, now: () => now + 20 });

  const second = await reserveCompanyIntelligence(company, {
    reservationId: "task-b:attempt-1",
    taskId: "task-b",
    tier: "reviewer",
  }, { filePath: ledgerPath, now: () => now + 30 });
  assert.equal(second.decision, "allow");

  const blocked = await reserveCompanyIntelligence(company, {
    reservationId: "task-c:attempt-1",
    taskId: "task-c",
    tier: "scout",
  }, { filePath: ledgerPath, now: () => now + 40 });
  assert.equal(blocked.decision, "block");
  assert.match(blocked.reason ?? "", /token budget/i);

  await releaseCompanyIntelligenceReservation(company.id, "task-b:attempt-1", {
    outcome: "failed",
    reason: "collector unavailable before inference",
  }, { filePath: ledgerPath, now: () => now + 50 });

  const snapshot = await readCompanyIntelligenceSnapshot(company.id, company.frontierLab, {
    filePath: ledgerPath,
    now: () => now + 60,
  });
  assert.equal(snapshot.settledTokens, 105_000);
  assert.equal(snapshot.reservedTokens, 0);
  assert.equal(snapshot.remainingTokens, 495_000);
  assert.equal(snapshot.completedTasks, 1);
  assert.equal(snapshot.blockedTasks, 0);
  assert.equal(snapshot.failedTasks, 0, "released pre-inference work is not scale evidence");
  assert.equal(snapshot.settledTasks, 1);
  assert.equal(snapshot.activeReservations, 0);
  assert.equal(snapshot.recent.find((event) => event.status === "settled")?.scaleEvidence?.proofSatisfied, true, "settlements must preserve Scale Curve proof telemetry");
  assert.equal(snapshot.recent.find((event) => event.status === "settled")?.stage, "pilot");

  const rolloverLedgerPath = join(tempRoot, "rollover-intelligence.json");
  const rolloverCompany = { ...company, id: "company-frontier-rollover" };
  const july = Date.UTC(2026, 6, 31, 23, 59, 0);
  const august = Date.UTC(2026, 7, 1, 0, 1, 0);
  await reserveCompanyIntelligence(rolloverCompany, {
    reservationId: "rollover-task:attempt-1",
    taskId: "rollover-task",
    tier: "builder",
  }, { filePath: rolloverLedgerPath, now: () => july });
  const rolloverSnapshot = await readCompanyIntelligenceSnapshot(rolloverCompany.id, rolloverCompany.frontierLab, {
    filePath: rolloverLedgerPath,
    now: () => august,
  });
  assert.equal(rolloverSnapshot.reservedTokens, 0, "the old reservation remains in its original UTC budget period");
  assert.equal(rolloverSnapshot.activeReservations, 1, "month rollover must not manufacture a parallel slot");
  const rolloverBlocked = await reserveCompanyIntelligence(rolloverCompany, {
    reservationId: "august-task:attempt-1",
    taskId: "august-task",
    tier: "scout",
  }, { filePath: rolloverLedgerPath, now: () => august });
  assert.equal(rolloverBlocked.decision, "block");
  assert.match(rolloverBlocked.reason ?? "", /active Frontier Lab reservation/i);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("frontier lab policy, capacity, scale-gate, and intelligence-ledger tests passed");
