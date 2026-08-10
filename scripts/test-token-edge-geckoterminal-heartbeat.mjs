#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildGeckoTerminalHeartbeatGateAudit,
  GECKOTERMINAL_HEARTBEAT_PHASES,
  normalizeGeckoTerminalHeartbeatWatchResult,
  runGeckoTerminalHeartbeatPhase,
  summarizeGeckoTerminalHeartbeatCliResult,
  summarizeGeckoTerminalHeartbeatScorecard,
} from "./token-edge/onchain-geckoterminal-heartbeat.mjs";

const gateAudit = buildGeckoTerminalHeartbeatGateAudit([
  {
    type: "prospective-nearest",
    evidenceStatus: "collecting",
    maturedForecastCount: 6,
    independentHourlyFrames: 6,
    missingAsLossAverageBaseReturnPct: 1,
    missingAsLossAverageStressReturnPct: -7,
    resolvedCoverageGate: true,
    chronologicalHalfValidationGate: false,
    statisticalCandidateGate: false,
    provisionalGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  },
  {
    type: "prospective-weaker",
    evidenceStatus: "collecting",
    maturedForecastCount: 30,
    missingAsLossAverageStressReturnPct: -12,
    statisticalCandidateGate: false,
    provisionalGate: false,
    researchOnly: true,
    mutationAllowed: false,
  },
  {
    type: "retrospective-registry",
    evidenceStatus: "descriptive-only",
    nominationGate: false,
    familyExpansionPrerequisiteGate: false,
    familyExpansionAuthority: false,
    provisionalGate: false,
    researchOnly: true,
    mutationAllowed: false,
    families: [{
      auditVersion: "retrospective-nearest-v1",
      bestStressReturnPct: -0.3,
      familyCorrectionStatus: "not-run-no-variant-cleared-prerequisite-screening",
      nominationGate: false,
    }, {
      auditVersion: "retrospective-weaker-v1",
      bestStressReturnPct: -5,
      familyCorrectionStatus: "not-run-no-variant-cleared-prerequisite-screening",
      nominationGate: false,
    }],
  },
]);
assert.equal(gateAudit.scorecardCount, 3);
assert.equal(gateAudit.prospectiveStressCandidateCount, 2);
assert.equal(gateAudit.positiveProspectiveStressCandidateCount, 0);
assert.equal(gateAudit.prospectiveStressLeader.type, "prospective-nearest");
assert.equal(
  gateAudit.prospectiveStressLeader.missingAsLossAverageStressReturnPct,
  -7,
);
assert.equal(gateAudit.retrospectiveFamilyCount, 2);
assert.equal(gateAudit.positiveRetrospectiveFamilyCount, 0);
assert.equal(
  gateAudit.retrospectiveStressLeader.auditVersion,
  "retrospective-nearest-v1",
);
assert.equal(gateAudit.statisticalCandidateGatePassCount, 0);
assert.equal(gateAudit.nominationGatePassCount, 0);
assert.equal(gateAudit.familyExpansionPrerequisiteGatePassCount, 0);
assert.equal(gateAudit.familyExpansionAuthorityPassCount, 0);
assert.equal(gateAudit.outcomeKeyReconciliationFailureCount, 0);
assert.equal(gateAudit.provisionalGatePassCount, 0);
assert.equal(gateAudit.decisionAuthorityPassCount, 0);
assert.equal(gateAudit.promotionAuthorityPassCount, 0);
assert.equal(gateAudit.tradingAuthorityPassCount, 0);
assert.equal(gateAudit.allScorecardsResearchOnly, true);
assert.equal(gateAudit.anyScorecardMutationAllowed, false);
assert.equal(gateAudit.evidenceDisposition, "no-candidate-cleared-frozen-gates");
const failedOutcomeKeyAudit = buildGeckoTerminalHeartbeatGateAudit([{
  type: "duplicate-delayed-outcome-scorecard",
  evidenceStatus: "descriptive-only",
  outcomeKeyReconciliationGate: false,
  provisionalGate: false,
  researchOnly: true,
  mutationAllowed: false,
}]);
assert.equal(failedOutcomeKeyAudit.outcomeKeyReconciliationFailureCount, 1);
assert.equal(
  failedOutcomeKeyAudit.evidenceDisposition,
  "failed-delayed-outcome-key-reconciliation",
);

assert.equal(normalizeGeckoTerminalHeartbeatWatchResult({
  status: "recorded",
  discoveryEventId: "discovery-1",
}).requestsAttempted, 1);
assert.equal(normalizeGeckoTerminalHeartbeatWatchResult({
  status: "skipped-existing-cadence",
}).requestsAttempted, 0);
const scoreSummary = summarizeGeckoTerminalHeartbeatScorecard({
  type: "synthetic-scorecard",
  candidateOutcomes: 100,
  recordedOutcomes: 92,
  recordedOutcomeEvents: 93,
  uniqueOutcomeKeys: 92,
  matchedOutcomeKeyCount: 91,
  invalidOutcomeKeyEventCount: 0,
  unexpectedOutcomeKeyCount: 1,
  unexpectedOutcomeEventCount: 1,
  duplicateOutcomeKeyCount: 1,
  duplicateOutcomeEventCount: 1,
  outcomeKeyReconciliationGate: false,
  openOutcomes: 5,
  maturedCandidateOutcomes: 95,
  unrecordedMaturedOutcomes: 3,
  unrecordedMaturedForecasts: 4,
  unrecordedMaturedDecisions: 2,
  recordedOutcomeCoverageRate: 92 / 95,
  validCapacityOutcomeCoverageRate: 0.9,
  cashInclusiveAverageBaseReturnPct: -10,
  missingAsLossMaturedForecasts: 95,
  missingAsLossUnscoredForecasts: 3,
  missingAsLossSelectedForecasts: 90,
  missingAsLossMaturedDecisions: 25,
  missingAsLossUnscoredDecisions: 2,
  missingAsLossSelectedDecisions: 20,
  missingAsLossIndependentHourlyFrames: 50,
  missingAsLossAverageStressReturnPct: -80,
  resolvedCoverageGate: true,
  validCapacityOutcomeCoverageGate: false,
  chronologicalHalfValidationGate: false,
  horizons: {
    "1h": {
      prospectiveCandidates: 100,
      maturedCandidateOutcomes: 95,
      recordedOutcomes: 94,
      recordedOutcomeEvents: 95,
      uniqueOutcomeKeys: 94,
      matchedOutcomeKeyCount: 93,
      invalidOutcomeKeyEventCount: 0,
      unexpectedOutcomeKeyCount: 1,
      unexpectedOutcomeEventCount: 1,
      duplicateOutcomeKeyCount: 1,
      duplicateOutcomeEventCount: 1,
      outcomeKeyReconciliationGate: false,
      openOutcomes: 5,
      unrecordedMaturedOutcomes: 1,
      recordedOutcomeCoverageRate: 94 / 95,
      observedOutcomes: 40,
      missedOutcomes: 54,
      validCapacityOutcomes: 39,
      validCapacityOutcomeCoverageRate: 39 / 95,
      minimumValidCapacityOutcomeCoverageRate: 0.95,
      validCapacityOutcomeCoverageGate: false,
      coverageDiagnostics: {
        invalidCapacityOutcomes: 56,
        invalidCapacityOutcomeCounts: {
          "unrecorded-matured": 1,
          "delayed-shadow-window-expired": 55,
        },
        invalidCapacityOutcomeReconciliationGate: true,
        dominantInvalidCapacityOutcomeReason: "delayed-shadow-window-expired",
        dominantInvalidCapacityOutcomeCount: 55,
        minimumAdditionalPerfectValidOutcomesToReachCoverageGate: 1_025,
      },
      discoveryUtcDayCoverageDiagnostics: {
        maximumReportedDiscoveryUtcDays: 14,
        totalDiscoveryUtcDays: 1,
        omittedEarlierDiscoveryUtcDays: 0,
        rows: [{
          discoveryUtcDay: "2026-08-10",
          maturedCandidateOutcomes: 95,
          validCapacityOutcomes: 39,
          validCapacityOutcomeCoverageRate: 39 / 95,
          reconciliationGate: true,
        }],
        researchOnly: true,
        mutationAllowed: false,
        authority: false,
      },
      cashInclusiveAverageStressReturnPct: -20,
      missingAsLossAverageStressReturnPct: -70,
    },
  },
});
assert.equal(scoreSummary.maturedCandidateOutcomes, 95);
assert.equal(scoreSummary.recordedOutcomes, 92);
assert.equal(scoreSummary.recordedOutcomeEvents, 93);
assert.equal(scoreSummary.uniqueOutcomeKeys, 92);
assert.equal(scoreSummary.matchedOutcomeKeyCount, 91);
assert.equal(scoreSummary.invalidOutcomeKeyEventCount, 0);
assert.equal(scoreSummary.unexpectedOutcomeKeyCount, 1);
assert.equal(scoreSummary.unexpectedOutcomeEventCount, 1);
assert.equal(scoreSummary.duplicateOutcomeKeyCount, 1);
assert.equal(scoreSummary.duplicateOutcomeEventCount, 1);
assert.equal(scoreSummary.outcomeKeyReconciliationGate, false);
assert.equal(scoreSummary.unrecordedMaturedOutcomes, 3);
assert.equal(scoreSummary.unrecordedMaturedForecasts, 4);
assert.equal(scoreSummary.unrecordedMaturedDecisions, 2);
assert.equal(scoreSummary.recordedOutcomeCoverageRate, 92 / 95);
assert.equal(scoreSummary.validCapacityOutcomeCoverageRate, 0.9);
assert.equal(scoreSummary.cashInclusiveAverageBaseReturnPct, -10);
assert.equal(scoreSummary.missingAsLossMaturedForecasts, 95);
assert.equal(scoreSummary.missingAsLossUnscoredForecasts, 3);
assert.equal(scoreSummary.missingAsLossSelectedForecasts, 90);
assert.equal(scoreSummary.missingAsLossMaturedDecisions, 25);
assert.equal(scoreSummary.missingAsLossUnscoredDecisions, 2);
assert.equal(scoreSummary.missingAsLossSelectedDecisions, 20);
assert.equal(scoreSummary.missingAsLossIndependentHourlyFrames, 50);
assert.equal(scoreSummary.missingAsLossAverageStressReturnPct, -80);
assert.equal(scoreSummary.resolvedCoverageGate, true);
assert.equal(scoreSummary.validCapacityOutcomeCoverageGate, false);
assert.equal(scoreSummary.chronologicalHalfValidationGate, false);
assert.equal(scoreSummary.horizons["1h"].prospectiveCandidates, 100);
assert.equal(scoreSummary.horizons["1h"].unrecordedMaturedOutcomes, 1);
assert.equal(scoreSummary.horizons["1h"].validCapacityOutcomes, 39);
assert.equal(scoreSummary.horizons["1h"].recordedOutcomeEvents, 95);
assert.equal(scoreSummary.horizons["1h"].uniqueOutcomeKeys, 94);
assert.equal(scoreSummary.horizons["1h"].matchedOutcomeKeyCount, 93);
assert.equal(scoreSummary.horizons["1h"].invalidOutcomeKeyEventCount, 0);
assert.equal(scoreSummary.horizons["1h"].unexpectedOutcomeKeyCount, 1);
assert.equal(scoreSummary.horizons["1h"].unexpectedOutcomeEventCount, 1);
assert.equal(scoreSummary.horizons["1h"].duplicateOutcomeKeyCount, 1);
assert.equal(scoreSummary.horizons["1h"].duplicateOutcomeEventCount, 1);
assert.equal(
  scoreSummary.horizons["1h"].outcomeKeyReconciliationGate,
  false,
);
assert.equal(
  scoreSummary.horizons["1h"].dominantInvalidCapacityOutcomeReason,
  "delayed-shadow-window-expired",
);
assert.equal(
  scoreSummary.horizons["1h"]
    .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
  1_025,
);
assert.deepEqual(
  scoreSummary.horizons["1h"].discoveryUtcDayCoverageDiagnostics,
  {
    maximumReportedDiscoveryUtcDays: 14,
    totalDiscoveryUtcDays: 1,
    omittedEarlierDiscoveryUtcDays: 0,
    rows: [{
      discoveryUtcDay: "2026-08-10",
      maturedCandidateOutcomes: 95,
      validCapacityOutcomes: 39,
      validCapacityOutcomeCoverageRate: 39 / 95,
      reconciliationGate: true,
    }],
    researchOnly: true,
    mutationAllowed: false,
    authority: false,
  },
);
assert.equal(scoreSummary.horizons["1h"].cashInclusiveAverageStressReturnPct, -20);
assert.equal(scoreSummary.horizons["1h"].missingAsLossAverageStressReturnPct, -70);

const registrySummary = summarizeGeckoTerminalHeartbeatScorecard({
  type: "synthetic-full-cohort-audit-registry",
  totalFamilyCount: 6,
  totalVariantCount: 36,
  baselineMaturedCandidates: 100,
  baselineValidCapacityOutcomes: 40,
  recordedOutcomeEvents: 41,
  uniqueOutcomeKeys: 40,
  matchedOutcomeKeyCount: 39,
  invalidOutcomeKeyEventCount: 0,
  unexpectedOutcomeKeyCount: 1,
  unexpectedOutcomeEventCount: 1,
  duplicateOutcomeKeyCount: 1,
  duplicateOutcomeEventCount: 1,
  outcomeKeyReconciliationGate: false,
  validCapacityOutcomeCoverageRate: 0.4,
  minimumValidCapacityOutcomeCoverageRate: 0.95,
  invalidCapacityOutcomes: 60,
  minimumAdditionalPerfectValidOutcomesToReachCoverageGate: 1_100,
  screeningCandidateCount: 0,
  allFamiliesPrerequisiteRejected: true,
  familyCorrectionStatus: "blocked-insufficient-valid-capacity-outcome-coverage",
  lineageIntegrityGate: true,
  evidenceReadinessGate: false,
  independentQuantValidationStatus: "not-run",
  nominationGate: false,
  familyExpansionPolicy:
    "one-separately-declared-family-only-after-lineage-coverage-and-correction-prerequisites",
  maximumAdditionalFamiliesPerReviewedExpansion: 1,
  familyExpansionPrerequisiteGate: false,
  familyExpansionStatus: "blocked-insufficient-valid-capacity-outcome-coverage",
  familyExpansionAuthority: false,
  researchOnly: true,
  mutationAllowed: false,
  decisionAuthority: false,
  promotionAuthority: false,
  tradingAuthority: false,
  families: [{
    auditVersion: "synthetic-family-v1",
    variantCount: 6,
    screeningCandidates: [],
    nominationGate: false,
  }],
});
assert.equal(registrySummary.totalFamilyCount, 6);
assert.equal(registrySummary.totalVariantCount, 36);
assert.equal(registrySummary.baselineMaturedCandidates, 100);
assert.equal(registrySummary.baselineValidCapacityOutcomes, 40);
assert.equal(registrySummary.recordedOutcomeEvents, 41);
assert.equal(registrySummary.uniqueOutcomeKeys, 40);
assert.equal(registrySummary.matchedOutcomeKeyCount, 39);
assert.equal(registrySummary.invalidOutcomeKeyEventCount, 0);
assert.equal(registrySummary.unexpectedOutcomeKeyCount, 1);
assert.equal(registrySummary.unexpectedOutcomeEventCount, 1);
assert.equal(registrySummary.duplicateOutcomeKeyCount, 1);
assert.equal(registrySummary.duplicateOutcomeEventCount, 1);
assert.equal(registrySummary.outcomeKeyReconciliationGate, false);
assert.equal(registrySummary.minimumValidCapacityOutcomeCoverageRate, 0.95);
assert.equal(registrySummary.invalidCapacityOutcomes, 60);
assert.equal(
  registrySummary.minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
  1_100,
);
assert.equal(registrySummary.screeningCandidateCount, 0);
assert.equal(registrySummary.allFamiliesPrerequisiteRejected, true);
assert.equal(registrySummary.lineageIntegrityGate, true);
assert.equal(registrySummary.evidenceReadinessGate, false);
assert.equal(registrySummary.nominationGate, false);
assert.equal(registrySummary.maximumAdditionalFamiliesPerReviewedExpansion, 1);
assert.equal(registrySummary.familyExpansionPrerequisiteGate, false);
assert.equal(
  registrySummary.familyExpansionStatus,
  "blocked-insufficient-valid-capacity-outcome-coverage",
);
assert.equal(registrySummary.familyExpansionAuthority, false);
assert.equal(registrySummary.researchOnly, true);
assert.equal(registrySummary.mutationAllowed, false);
assert.equal(registrySummary.decisionAuthority, false);
assert.equal(registrySummary.promotionAuthority, false);
assert.equal(registrySummary.tradingAuthority, false);
assert.deepEqual(registrySummary.families, [{
  auditVersion: "synthetic-family-v1",
  variantCount: 6,
  screeningCandidates: [],
  nominationGate: false,
}]);

const armSummary = summarizeGeckoTerminalHeartbeatScorecard({
  type: "synthetic-ab-scorecard",
  arms: {
    "market-only": {
      candidateForecasts: 300,
      maturedForecastCount: 280,
      resolvedOutcomes: 270,
      unrecordedMaturedOutcomes: 2,
      outcomeIdentityMismatches: 1,
      resolvedCoverage: 270 / 280,
      forecastAvailabilityCoverage: 0.97,
      missingAsLossAverageStressReturnPct: 1,
      missingAsLossSensitivityGate: true,
      chronologicalHalfValidationGate: true,
      statisticalCandidateGate: false,
    },
  },
}).arms["market-only"];
assert.equal(armSummary.maturedForecastCount, 280);
assert.equal(armSummary.resolvedOutcomes, 270);
assert.equal(armSummary.unrecordedMaturedOutcomes, 2);
assert.equal(armSummary.outcomeIdentityMismatches, 1);
assert.equal(armSummary.missingAsLossSensitivityGate, true);
assert.equal(armSummary.chronologicalHalfValidationGate, true);
assert.equal(armSummary.statisticalCandidateGate, false);

const cliSummary = summarizeGeckoTerminalHeartbeatCliResult({
  status: "provider-request-lower-priority-skipped",
  providerRequestsAttempted: 1,
  actionResults: {
    "resolve-delayed-shadow24h": {
      requestsAttempted: 1,
      recordedOutcomes: 2,
      outcomes: [{ id: "outcome-1", grossReturnPct: 1 }, { id: "outcome-2", grossReturnPct: -1 }],
      failures: ["preserved-failure"],
    },
    score: {
      verification: { ok: true, errors: [] },
      scorecards: [summarizeGeckoTerminalHeartbeatScorecard({
        type: "synthetic-scorecard",
        candidateForecasts: 10,
        candidateDecisions: null,
        provisionalGate: false,
        arms: null,
      })],
    },
  },
});
assert.equal(cliSummary.providerRequestsAttempted, 1);
assert.equal(cliSummary.actionResults["resolve-delayed-shadow24h"].outcomes, undefined);
assert.deepEqual(
  cliSummary.actionResults["resolve-delayed-shadow24h"].emittedEventArrays.outcomes,
  { count: 2, firstId: "outcome-1", lastId: "outcome-2" },
);
assert.deepEqual(cliSummary.actionResults.score.scorecards[0], {
  type: "synthetic-scorecard",
  candidateForecasts: 10,
  provisionalGate: false,
});
assert.deepEqual(
  cliSummary.actionResults["resolve-delayed-shadow24h"].failures,
  ["preserved-failure"],
);

assert.deepEqual(
  GECKOTERMINAL_HEARTBEAT_PHASES.map(({ minuteModulo, startSecond }) => ({
    minuteModulo,
    startSecond,
  })),
  [
    { minuteModulo: 0, startSecond: 5 },
    { minuteModulo: 1, startSecond: 20 },
    { minuteModulo: 2, startSecond: 35 },
    { minuteModulo: 3, startSecond: 50 },
    { minuteModulo: 4, startSecond: 0 },
  ],
);

{
  let now = new Date("2026-08-04T19:31:18.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async (milliseconds) => {
        now = new Date(now.getTime() + milliseconds);
      },
    }),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.phaseMinuteModulo, 1);
  assert.equal(result.startedAt, "2026-08-04T19:31:20.000Z");
  assert.deepEqual(calls, [
    "mark-fast-path",
    "watch",
    "capture-forecast-ab",
    "capture-forecast-posts-rescue",
    "capture",
  ]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:30:05.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    "resolve-delayed-24h",
    "mark-birth-path",
    "score",
  ]);
}

{
  const calls = [];
  const dependencies = heartbeatDependencies({
    calls,
    clock: () => new Date("2026-08-04T19:30:05.000Z"),
  });
  dependencies.actions.resolveDelayedShadow24h = async () => {
    calls.push("resolve-delayed-24h");
    return {
      requestsAttempted: 0,
      recordedOutcomes: 20,
    };
  };
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    dependencies,
  );
  assert.equal(result.status, "exact-outcome-recorded-lower-priority-skipped");
  assert.deepEqual(calls, ["resolve-delayed-24h"]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:33:50.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    "resolve-delayed-1h",
    "mark-standard-mid",
    "score",
  ]);
}

{
  let now = new Date("2026-08-04T19:33:49.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async () => {
        now = new Date("2026-08-04T19:34:02.000Z");
      },
    }),
  );
  assert.equal(result.status, "skipped-stale-phase");
  assert.deepEqual(calls, []);
}

{
  let now = new Date("2026-08-04T19:33:49.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async () => {
        now = new Date("2026-08-04T19:38:50.000Z");
      },
    }),
  );
  assert.equal(result.status, "skipped-stale-phase");
  assert.deepEqual(calls, []);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:34:02.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.phaseMinuteModulo, 4);
  assert.deepEqual(calls, ["score"]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:30.000Z"),
      dueState: {
        genericDue: 1,
        jupiterDue: 1,
        genericWindowClosesAt: "2026-08-04T19:31:39.000Z",
        jupiterWindowClosesAt: "2026-08-04T19:31:39.000Z",
      },
    }),
  );
  assert.equal(result.status, "exact-window-only");
  assert.deepEqual(calls, ["resolve-jupiter", "resolve-generic"]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:20.000Z"),
      dueState: {
        genericDue: 0,
        jupiterDue: 0,
        genericWindowClosesAt: null,
        jupiterWindowClosesAt: null,
        delayedShadowDue: {
          horizons: {
            "1h": {
              liveDueCandidates: 0,
              earliestLiveWindowClosesAt: null,
            },
            "24h": {
              liveDueCandidates: 20,
              earliestLiveWindowClosesAt: "2026-08-04T19:31:25.500Z",
            },
          },
        },
      },
    }),
  );
  assert.equal(result.status, "exact-window-only");
  assert.deepEqual(calls, ["resolve-delayed-24h"]);
}

{
  const calls = [];
  let dueInspection = 0;
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:20.000Z"),
      inspectDue: async () => {
        dueInspection += 1;
        if (dueInspection < 3) {
          return {
            genericDue: 0,
            jupiterDue: 0,
            genericWindowClosesAt: null,
            jupiterWindowClosesAt: null,
          };
        }
        return {
          genericDue: 0,
          jupiterDue: 0,
          genericWindowClosesAt: null,
          jupiterWindowClosesAt: null,
          delayedShadowDue: {
            horizons: {
              "1h": {
                liveDueCandidates: 18,
                earliestLiveWindowClosesAt: "2026-08-04T19:31:29.000Z",
              },
            },
          },
        };
      },
    }),
  );
  assert.equal(result.status, "due-window-became-imminent-lower-priority-skipped");
  assert.deepEqual(calls, [
    "mark-fast-path",
    "resolve-delayed-1h",
  ]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:56.000Z"),
      dueState: {
        genericDue: 0,
        jupiterDue: 1,
        genericWindowClosesAt: null,
        jupiterWindowClosesAt: "2026-08-04T19:31:59.000Z",
      },
    }),
  );
  assert.equal(result.status, "exact-window-only-stale-phase");
  assert.deepEqual(calls, ["resolve-jupiter"]);
}

{
  const calls = [];
  const dependencies = heartbeatDependencies({
    calls,
    clock: () => new Date("2026-08-04T19:32:35.000Z"),
    dueState: {
      genericDue: 1,
      jupiterDue: 0,
      genericWindowClosesAt: "2026-08-04T19:37:35.000Z",
      jupiterWindowClosesAt: null,
    },
  });
  dependencies.actions.resolveGeneric = async () => {
    calls.push("resolve-generic");
    return { requestsAttempted: 0, recordedResolutions: 1 };
  };
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    dependencies,
  );
  assert.equal(result.status, "exact-outcome-recorded-lower-priority-skipped");
  assert.deepEqual(calls, ["resolve-generic"]);
}

{
  const calls = [];
  const dependencies = heartbeatDependencies({
    calls,
    clock: () => new Date("2026-08-04T19:31:20.000Z"),
  });
  dependencies.actions.watch = async () => {
    calls.push("watch");
    return { requestsAttempted: 1, recordedResolutions: 0 };
  };
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    dependencies,
  );
  assert.equal(result.status, "provider-request-lower-priority-skipped");
  assert.equal(result.providerRequestsAttempted, 1);
  assert.deepEqual(calls, [
    "mark-fast-path",
    "watch",
  ]);
}

{
  const calls = [];
  let dueInspection = 0;
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:20.000Z"),
      inspectDue: async () => {
        dueInspection += 1;
        if (dueInspection < 3) {
          return {
            genericDue: 0,
            jupiterDue: 0,
            genericWindowClosesAt: null,
            jupiterWindowClosesAt: null,
          };
        }
        return {
          genericDue: 0,
          jupiterDue: 1,
          genericWindowClosesAt: null,
          jupiterWindowClosesAt: "2026-08-04T19:36:20.000Z",
        };
      },
    }),
  );
  assert.equal(result.status, "exact-became-due-lower-priority-skipped");
  assert.equal(result.dueState.jupiterDue, 1);
  assert.deepEqual(calls, [
    "mark-fast-path",
    "resolve-jupiter",
  ]);
}

console.log("token-edge GeckoTerminal heartbeat phase checks passed.");

function heartbeatDependencies({
  calls,
  clock,
  sleep = async () => {},
  inspectDue = null,
  dueState = {
    genericDue: 0,
    jupiterDue: 0,
    genericWindowClosesAt: null,
    jupiterWindowClosesAt: null,
  },
}) {
  const action = (name, result = {}) => async () => {
    calls.push(name);
    return {
      requestsAttempted: 0,
      recordedResolutions: 0,
      ...result,
    };
  };
  return {
    clock,
    sleep,
    inspectDue: inspectDue ?? (async () => dueState),
    actions: {
      resolveGeneric: action("resolve-generic"),
      resolveJupiter: action("resolve-jupiter"),
      markBirthPath: action("mark-birth-path"),
      markFastPath: action("mark-fast-path"),
      watch: action("watch"),
      captureForecastAb: action("capture-forecast-ab"),
      captureForecastPostsRescue: action("capture-forecast-posts-rescue"),
      capture: action("capture"),
      activate: action("activate"),
      resolveDelayedShadow1h: action("resolve-delayed-1h"),
      resolveDelayedShadow24h: action("resolve-delayed-24h"),
      markStandardMid: action("mark-standard-mid"),
      score: action("score"),
    },
  };
}
