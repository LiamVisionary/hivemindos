#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  EARNED_SCALE_POLICY_VERSION,
  buildOutcomeAwareAllocation,
  earnedScaleStageTransitionBlock,
  earnedScaleSettlementEvidence,
  evaluateEarnedScale,
  mineDelightProposals,
  summarizeSwarmBlackboard,
} = await import("../src/lib/earned-scale.ts");

const healthy = evaluateEarnedScale({
  baseline: observations("before", { outcomeScore: 0.74, proofRate: 0.82, latencyMs: 1_200, totalTokens: 1_000, uniqueContributionRate: 0.62, duplicationConflictRate: 0.15, humanInterventionRate: 0.18, reviewerDisagreementRate: 0.14, completedTasks: 10 }),
  treatment: observations("after", { outcomeScore: 0.89, proofRate: 1, latencyMs: 880, totalTokens: 940, uniqueContributionRate: 0.81, duplicationConflictRate: 0.06, humanInterventionRate: 0.08, reviewerDisagreementRate: 0.05, completedTasks: 11 }),
});
assert.equal(healthy.recommendation, "scale");
assert.equal(healthy.automaticAction, false);
assert(healthy.dimensions.every((dimension) => dimension.status !== "missing"));
assert.equal(earnedScaleStageTransitionBlock("team", "frontier", healthy), undefined);

const proofRegression = evaluateEarnedScale({
  baseline: observations("proof-before", { outcomeScore: 0.86, proofRate: 1, latencyMs: 1_100, totalTokens: 1_000, uniqueContributionRate: 0.72, duplicationConflictRate: 0.07, humanInterventionRate: 0.06, reviewerDisagreementRate: 0.05, completedTasks: 10 }),
  treatment: observations("proof-after", { outcomeScore: 0.9, proofRate: 0.67, latencyMs: 820, totalTokens: 850, uniqueContributionRate: 0.76, duplicationConflictRate: 0.05, humanInterventionRate: 0.05, reviewerDisagreementRate: 0.04, completedTasks: 11 }),
});
assert.equal(proofRegression.recommendation, "reduce", "faster, cheaper completion must not outrank a proof regression");
assert.match(proofRegression.reasons.join(" "), /Proof quality regressed/i);
assert.match(earnedScaleStageTransitionBlock("team", "frontier", proofRegression) ?? "", /has not earned Frontier scale/i);

const collecting = evaluateEarnedScale({
  baseline: observations("short-before", { outcomeScore: 0.8, proofRate: 1, latencyMs: 1_000, totalTokens: 1_000, uniqueContributionRate: 0.8, duplicationConflictRate: 0, humanInterventionRate: 0, reviewerDisagreementRate: 0, completedTasks: 10 }).slice(0, 2),
  treatment: [],
});
assert.equal(collecting.recommendation, "collect-evidence");
assert.match(collecting.evidenceGaps.join(" "), /baseline run/i);
assert.match(collecting.evidenceGaps.join(" "), /treatment run/i);
assert.match(earnedScaleStageTransitionBlock("pilot", "frontier", collecting) ?? "", /one measured stage at a time/i);
assert.equal(earnedScaleStageTransitionBlock("pilot", "team", collecting), undefined, "Team is the calibration treatment after the Pilot baseline");

const evidence = earnedScaleSettlementEvidence({
  outcome: "completed",
  startedAt: 1_000,
  completedAt: 2_250,
  evaluation: {
    verdict: "accepted",
    score: 0.91,
    routingEligible: true,
    judge: { verdict: "accepted", evaluator: { independent: true } },
  },
});
assert.deepEqual(evidence, {
  policyVersion: EARNED_SCALE_POLICY_VERSION,
  outcomeScore: 0.91,
  proofSatisfied: true,
  latencyMs: 1_250,
  uniqueContribution: true,
  duplicationConflict: false,
  humanIntervention: false,
  reviewerDisagreement: false,
});
const nonRubricEvidence = earnedScaleSettlementEvidence({
  outcome: "completed",
  evaluation: {
    verdict: "accepted",
    score: 0,
    routingEligible: true,
    judge: { verdict: "accepted", confidence: 0.87, axes: [], evaluator: { independent: true } },
  },
});
assert.equal(nonRubricEvidence.outcomeScore, 0.87, "accepted non-rubric judges must contribute confidence instead of the control-plane's empty-axis zero");

const frontierAllocation = buildOutcomeAwareAllocation({
  frontierEnabled: true,
  models: { scout: "luna", builder: "terra", reviewer: "sol" },
  evidenceSamples: 7,
  recentFailureRate: 0.3,
});
assert.equal(frontierAllocation.mode, "frontier-oauth");
assert.match(frontierAllocation.lanes[0].route, /luna/);
assert.match(frontierAllocation.lanes[2].intent, /Independently verify/i);
assert.match(frontierAllocation.checkpoints[1].trigger, /50%/);

const adaptiveAllocation = buildOutcomeAwareAllocation({
  frontierEnabled: false,
  models: { scout: "luna", builder: "terra", reviewer: "sol" },
});
assert.match(adaptiveAllocation.lanes[0].route, /free \/ local-first/i);

const blackboard = summarizeSwarmBlackboard([
  {
    id: "challenge-1",
    title: "Improve onboarding",
    objective: "Raise activation",
    status: "active",
    bestScore: 0.91,
    frontier: [{ id: "result-1" }],
    leaderboard: [{ agent: "bee-1" }, { agent: "bee-2" }],
    totals: { boardEntries: 8, lineageNodes: 3, integrityAlerts: 1 },
  },
  {
    id: "challenge-2",
    title: "Archived",
    objective: "Ignore",
    status: "archived",
    frontier: [],
    leaderboard: [],
    totals: { boardEntries: 100, lineageNodes: 100, integrityAlerts: 100 },
  },
]);
assert.equal(blackboard.activeChallenges, 1);
assert.equal(blackboard.boardEntries, 8);
assert.equal(blackboard.contributors, 2);

const delightEvents = Array.from({ length: 5 }, (_, index) => ({
  id: `event-${index + 1}`,
  skillSlug: "launch-workflow",
  event: "task-completed",
  status: "success",
  taskSource: `company:acme:task-${index + 1}`,
  companyId: "acme",
  score: 0.9,
  createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
}));
const delight = mineDelightProposals(delightEvents, "acme");
assert.deepEqual(delight.map((proposal) => proposal.kind).sort(), ["company", "schedule", "skill"]);
assert(delight.every((proposal) => proposal.reviewRequired));

const liveHarnessSource = await readFile(new URL("./benchmark-earned-scale-live.mjs", import.meta.url), "utf8");
assert.match(liveHarnessSource, /\/chat/);
assert.match(liveHarnessSource, /gpt-4\.1/);
assert.match(liveHarnessSource, /condition-blind/i);
assert.match(liveHarnessSource, /recordCanonicalHarness/);
assert.match(liveHarnessSource, /MIN_REPEATS = 3/);
assert.match(liveHarnessSource, /deterministicPolicyIsOutcomeGrader: false/);

console.log("earned scale policy, live-provider harness contract, settlement evidence, allocation, blackboard, and delight-miner checks passed");

function observations(prefix, metrics) {
  return Array.from({ length: 3 }, (_, index) => ({ id: `${prefix}-${index + 1}`, settledTasks: 12, ...metrics }));
}
