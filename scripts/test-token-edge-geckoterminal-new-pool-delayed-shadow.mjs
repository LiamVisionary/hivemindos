#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  independentAssetFrames,
  tokenEdgeAssetKey,
} from "./token-edge/onchain-independent-frames.mjs";
import {
  registerGeckoTerminalNewPoolActivation,
  watchGeckoTerminalNewPools,
} from "./token-edge/onchain-geckoterminal-new-pool-activation.mjs";
import {
  buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortTransactionCountAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit,
  buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit,
  buildGeckoTerminalNewPoolDelayedShadowLiquidityFloorAudit,
  buildGeckoTerminalNewPoolDelayedShadowScorecard,
  buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit,
  delayedAuditWorstLeaveOneTokenOutStressReturnPct,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_BUY_SHARE_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_REGISTRY_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_LIQUIDITY_FLOOR_AUDIT_RULE,
  GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_TRANSACTION_COUNT_AUDIT_RULE,
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound,
  inspectGeckoTerminalNewPoolDelayedShadowDue,
  registerGeckoTerminalNewPoolDelayedShadow,
  resolveGeckoTerminalNewPoolDelayedShadows,
  validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry,
} from "./token-edge/onchain-geckoterminal-new-pool-delayed-shadow.mjs";

assert.equal(
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound({
    birthQuote: { buysM5: 0, sellsM5: 0 },
  }),
  null,
);
assert.ok(Math.abs(
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound({
    birthQuote: { buysM5: 1, sellsM5: 0 },
  }) - 0.20654931437723742,
) < 1e-12);
assert.ok(Math.abs(
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound({
    birthQuote: { buysM5: 10, sellsM5: 5 },
  }) - 0.41713547738519774,
) < 1e-12);
assert.equal(
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound({
    birthQuote: { buysM5: 0, sellsM5: 10 },
  }),
  0,
);
assert.equal(
  geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound({
    birthQuote: { buysM5: 1.5, sellsM5: 1 },
  }),
  null,
);

assertLeaveOneOutParity([
  auditRow("TokenParityA", "2026-08-04T00:00:00.000Z", 10),
  auditRow("TokenParityB", "2026-08-04T00:00:00.000Z", -5),
  auditRow("TokenParityC", "2026-08-04T00:30:00.000Z", 20),
  auditRow("TokenParityA", "2026-08-04T01:00:00.000Z", -10),
  auditRow("TokenParityD", "2026-08-04T01:10:00.000Z", 5),
]);

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-gecko-delayed-shadow-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:30.000Z") },
  );
  await assert.rejects(
    registerGeckoTerminalNewPoolDelayedShadow(
      { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
      { now: new Date("2026-08-04T04:00:00.000Z") },
    ),
    /strictly after its evidence boundary/,
  );
  const registration = await registerGeckoTerminalNewPoolDelayedShadow(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:01.000Z") },
  );
  assert.equal(registration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolDelayedShadow(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:02.000Z") },
  )).status, "existing");

  const watchAt = new Date("2026-08-04T04:05:00.000Z");
  const firstBirth = poolRow({
    tokenAddress: "TokenDelayed11111111111111111111111111111",
    pairAddress: "PoolDelayed111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T04:04:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 8_000,
    volumeM5Usd: 16_000,
  });
  const secondBirth = poolRow({
    tokenAddress: "TokenDelayed22222222222222222222222222222",
    pairAddress: "PoolDelayed222222222222222222222222222222",
    poolCreatedAt: "2026-08-04T04:04:15.000Z",
    priceUsd: 0.0002,
    liquidityUsd: 12_000,
    marketCapUsd: 20_000,
  });
  const watch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: watchAt,
      clock: () => watchAt,
      fetcher: fakeProvider({ newPoolRows: [firstBirth, secondBirth] }),
    },
  );
  assert.equal(watch.watchedCandidates, 2);

  const early = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    { now: new Date("2026-08-04T05:04:59.000Z") },
  );
  assert.equal(early.dueCandidates, 0);
  assert.equal(early.deferredDueCandidates, 0);
  assert.equal(early.unrecordedSelectedDueCandidates, 0);
  assert.equal(early.dueCandidateReconciliationGate, true);
  assert.equal(early.requestsAttempted, 0);
  assert.deepEqual(early.missedOutcomeReasonCounts, {});
  const openEvents = await readLedger(ledgerPath);
  const earlyDueState = inspectGeckoTerminalNewPoolDelayedShadowDue(openEvents, {
    asOf: "2026-08-04T05:04:59.000Z",
  });
  assert.equal(earlyDueState.registrationId, registration.registrationId);
  assert.equal(earlyDueState.horizons["1h"].unresolvedCohorts, 1);
  assert.equal(earlyDueState.horizons["1h"].unresolvedCandidates, 2);
  assert.equal(earlyDueState.horizons["1h"].dueCandidates, 0);
  assert.equal(earlyDueState.horizons["1h"].futureCandidates, 2);
  assert.equal(
    earlyDueState.horizons["1h"].nextFutureDueAt,
    "2026-08-04T05:05:00.000Z",
  );
  assert.equal(
    earlyDueState.horizons["1h"].unresolvedCandidateReconciliationGate,
    true,
  );
  assert.equal(earlyDueState.horizons["24h"].futureCandidates, 2);
  assert.equal(earlyDueState.researchOnly, true);
  assert.equal(earlyDueState.mutationAllowed, false);
  assert.equal(earlyDueState.authority, false);
  const liveDueState = inspectGeckoTerminalNewPoolDelayedShadowDue(openEvents, {
    asOf: "2026-08-04T05:05:30.000Z",
  });
  assert.equal(liveDueState.horizons["1h"].dueCohorts, 1);
  assert.equal(liveDueState.horizons["1h"].dueCandidates, 2);
  assert.equal(liveDueState.horizons["1h"].liveDueCandidates, 2);
  assert.equal(liveDueState.horizons["1h"].expiredDueCandidates, 0);
  assert.equal(
    liveDueState.horizons["1h"].earliestLiveWindowClosesAt,
    "2026-08-04T05:15:00.000Z",
  );
  assert.equal(
    liveDueState.horizons["1h"].dueCandidateReconciliationGate,
    true,
  );
  const expiredDueState = inspectGeckoTerminalNewPoolDelayedShadowDue(openEvents, {
    asOf: "2026-08-04T05:15:01.000Z",
  });
  assert.equal(expiredDueState.horizons["1h"].liveDueCandidates, 0);
  assert.equal(expiredDueState.horizons["1h"].expiredDueCandidates, 2);
  const openScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(openEvents);
  assert.equal(openScore.candidateOutcomes, 4);
  assert.equal(openScore.prospectiveCandidates, 4);
  assert.equal(openScore.recordedOutcomes, 0);
  assert.equal(openScore.recordedOutcomeEvents, 0);
  assert.equal(openScore.uniqueOutcomeKeys, 0);
  assert.equal(openScore.matchedOutcomeKeyCount, 0);
  assert.equal(openScore.invalidOutcomeKeyEventCount, 0);
  assert.equal(openScore.unexpectedOutcomeKeyCount, 0);
  assert.equal(openScore.unexpectedOutcomeEventCount, 0);
  assert.equal(openScore.duplicateOutcomeKeyCount, 0);
  assert.equal(openScore.duplicateOutcomeEventCount, 0);
  assert.equal(openScore.outcomeKeyReconciliationGate, true);
  assert.equal(openScore.maturedCandidateOutcomes, 0);
  assert.equal(openScore.openOutcomes, 4);
  assert.equal(openScore.unrecordedMaturedOutcomes, 0);
  assert.equal(openScore.recordedOutcomeCoverageRate, null);
  assert.equal(openScore.validCapacityOutcomes, 0);
  assert.equal(openScore.validCapacityOutcomeCoverageRate, null);
  assert.equal(openScore.minimumValidCapacityOutcomeCoverageRate, 0.95);
  assert.equal(openScore.validCapacityOutcomeCoverageGate, false);
  assert.equal(openScore.coverageDiagnostics.invalidCapacityOutcomes, 0);
  assert.equal(
    openScore.coverageDiagnostics
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    null,
  );
  assert.equal(
    openScore.coverageDiagnostics.invalidCapacityOutcomeReconciliationGate,
    true,
  );
  assert.equal(openScore.horizons["1h"].prospectiveCandidates, 2);
  assert.equal(openScore.horizons["1h"].candidateOutcomes, 2);
  assert.equal(openScore.horizons["1h"].recordedOutcomes, 0);
  assert.equal(openScore.horizons["1h"].maturedCandidateOutcomes, 0);
  assert.equal(openScore.horizons["1h"].openOutcomes, 2);
  assert.equal(
    openScore.horizons["1h"].discoveryUtcDayCoverageDiagnostics
      .totalDiscoveryUtcDays,
    0,
  );
  assert.deepEqual(
    openScore.horizons["1h"].discoveryUtcDayCoverageDiagnostics.rows,
    [],
  );
  assert.equal(openScore.horizons["24h"].prospectiveCandidates, 2);
  assert.equal(openScore.horizons["24h"].openOutcomes, 2);
  const overdueUnrecordedScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(
    openEvents,
    { asOf: "2026-08-04T05:05:30.000Z" },
  );
  assert.equal(overdueUnrecordedScore.maturedCandidateOutcomes, 2);
  assert.equal(overdueUnrecordedScore.candidateOutcomes, 4);
  assert.equal(overdueUnrecordedScore.recordedOutcomes, 0);
  assert.equal(overdueUnrecordedScore.openOutcomes, 2);
  assert.equal(overdueUnrecordedScore.unrecordedMaturedOutcomes, 2);
  assert.equal(overdueUnrecordedScore.recordedOutcomeCoverageRate, 0);
  assert.equal(overdueUnrecordedScore.validCapacityOutcomeCoverageRate, 0);
  assert.equal(overdueUnrecordedScore.validCapacityOutcomeCoverageGate, false);
  assert.equal(
    overdueUnrecordedScore.coverageDiagnostics.invalidCapacityOutcomes,
    2,
  );
  assert.equal(
    overdueUnrecordedScore.coverageDiagnostics
      .invalidCapacityOutcomeCounts["unrecorded-matured"],
    2,
  );
  assert.equal(
    overdueUnrecordedScore.coverageDiagnostics
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    38,
  );
  assert.equal(overdueUnrecordedScore.horizons["1h"].maturedCandidateOutcomes, 2);
  assert.equal(overdueUnrecordedScore.horizons["1h"].openOutcomes, 0);
  assert.equal(overdueUnrecordedScore.horizons["1h"].unrecordedMaturedOutcomes, 2);
  assert.equal(overdueUnrecordedScore.horizons["1h"].cashInclusiveAverageBaseReturnPct, 0);
  assert.equal(overdueUnrecordedScore.horizons["1h"].cashInclusiveAverageStressReturnPct, 0);
  assert.equal(overdueUnrecordedScore.horizons["1h"].missingAsLossAverageBaseReturnPct, -100);
  assert.equal(overdueUnrecordedScore.horizons["1h"].missingAsLossAverageStressReturnPct, -100);
  assert.deepEqual(
    overdueUnrecordedScore.horizons["1h"]
      .discoveryUtcDayCoverageDiagnostics.rows,
    [{
      discoveryUtcDay: "2026-08-04",
      maturedCandidateOutcomes: 2,
      recordedOutcomes: 0,
      observedOutcomes: 0,
      missedOutcomes: 0,
      expiredOutcomes: 0,
      otherMissedOutcomes: 0,
      validCapacityOutcomes: 0,
      unrecordedMaturedOutcomes: 2,
      observedCapacityInvalidOutcomes: 0,
      recordedOutcomeCoverageRate: 0,
      validCapacityOutcomeCoverageRate: 0,
      validCapacityOutcomeCoverageGate: false,
      reconciliationGate: true,
    }],
  );
  assert.equal(overdueUnrecordedScore.horizons["24h"].maturedCandidateOutcomes, 0);

  const firstHourRows = [
    poolRow({
      tokenAddress: firstBirth.relationships.base_token.data.id.slice("solana_".length),
      pairAddress: firstBirth.attributes.address,
      poolCreatedAt: firstBirth.attributes.pool_created_at,
      priceUsd: 0.0003,
      liquidityUsd: 10_000,
    }),
    poolRow({
      tokenAddress: secondBirth.relationships.base_token.data.id.slice("solana_".length),
      pairAddress: secondBirth.attributes.address,
      poolCreatedAt: secondBirth.attributes.pool_created_at,
      priceUsd: 0.0001,
      liquidityUsd: 9_000,
    }),
  ];
  const oneHour = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T05:05:30.000Z"),
      clock: () => new Date("2026-08-04T05:05:31.000Z"),
      fetcher: fakeProvider({ multiPoolRows: firstHourRows }),
    },
  );
  assert.equal(oneHour.dueCandidates, 2);
  assert.equal(oneHour.requestsAttempted, 1);
  assert.equal(oneHour.recordedOutcomes, 2);
  assert.equal(oneHour.observedOutcomes, 2);
  assert.equal(oneHour.missedOutcomes, 0);
  assert.equal(oneHour.deferredDueCandidates, 0);
  assert.equal(oneHour.unrecordedSelectedDueCandidates, 0);
  assert.equal(oneHour.dueCandidateReconciliationGate, true);
  assert.deepEqual(oneHour.missedOutcomeReasonCounts, {});
  assert.deepEqual(oneHour.outcomes.map((event) => event.horizon), ["1h", "1h"]);
  assert.deepEqual(oneHour.outcomes.map((event) => event.grossReturnPct), [200, -50]);
  assert.ok(oneHour.outcomes.every((event) => (
    event.decisionAuthority === false
      && event.promotionAuthority === false
      && event.tradingAuthority === false
      && event.mutationAllowed === false
  )));

  const repeated = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T05:06:00.000Z"),
      fetcher: async () => {
        throw new Error("resolved shadow must not call provider twice");
      },
    },
  );
  assert.equal(repeated.dueCandidates, 0);
  assert.equal(repeated.requestsAttempted, 0);

  const nextDayRows = firstHourRows.map((row, index) => poolRow({
    tokenAddress: row.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: row.attributes.address,
    poolCreatedAt: row.attributes.pool_created_at,
    priceUsd: index === 0 ? 0.0004 : 0.00005,
    liquidityUsd: index === 0 ? 14_000 : 7_000,
  }));
  const oneDay = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "24h" },
    {
      now: new Date("2026-08-05T04:05:30.000Z"),
      clock: () => new Date("2026-08-05T04:05:31.000Z"),
      fetcher: fakeProvider({ multiPoolRows: nextDayRows }),
    },
  );
  assert.equal(oneDay.requestsAttempted, 1);
  assert.equal(oneDay.recordedOutcomes, 2);
  assert.deepEqual(oneDay.outcomes.map((event) => event.horizon), ["24h", "24h"]);

  const events = await readLedger(ledgerPath);
  assert.deepEqual(verifyLedger(events), {
    ok: true,
    errors: [],
    eventCount: events.length,
  });
  assert.equal(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
  )).length, 4);
  assert.equal(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      || event.type === "geckoterminal-new-pool-jupiter-executable-decision"
  )).length, 0);
  const preRegistrationScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(
    events,
    { asOf: "2026-08-04T03:58:29.000Z" },
  );
  assert.equal(preRegistrationScore.registrationId, null);
  assert.equal(preRegistrationScore.candidateOutcomes, 0);
  assert.equal(preRegistrationScore.recordedOutcomes, 0);

  const historicalAsOf = "2026-08-04T05:05:30.500Z";
  const historicalDueState = inspectGeckoTerminalNewPoolDelayedShadowDue(
    events,
    { asOf: historicalAsOf },
  );
  assert.equal(historicalDueState.horizons["1h"].dueCandidates, 2);
  assert.equal(historicalDueState.horizons["1h"].liveDueCandidates, 2);
  assert.equal(historicalDueState.horizons["1h"].futureCandidates, 0);
  const historicalScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(
    events,
    { asOf: historicalAsOf },
  );
  assert.equal(historicalScore.candidateOutcomes, 4);
  assert.equal(historicalScore.maturedCandidateOutcomes, 2);
  assert.equal(historicalScore.recordedOutcomes, 0);
  assert.equal(historicalScore.unrecordedMaturedOutcomes, 2);
  assert.equal(historicalScore.validCapacityOutcomes, 0);
  assert.equal(historicalScore.horizons["1h"].recordedOutcomes, 0);
  assert.equal(historicalScore.horizons["1h"].validCapacityOutcomes, 0);
  const historicalRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      events,
      { asOf: historicalAsOf },
    );
  assert.equal(historicalRegistry.baselineMaturedCandidates, 2);
  assert.equal(historicalRegistry.baselineValidCapacityOutcomes, 0);
  assert.equal(historicalRegistry.invalidCapacityOutcomes, 2);
  assert.equal(historicalRegistry.validCapacityOutcomeCoverageRate, 0);

  const score = buildGeckoTerminalNewPoolDelayedShadowScorecard(events);
  assert.equal(score.candidateOutcomes, 4);
  assert.equal(score.recordedOutcomes, 4);
  assert.equal(score.recordedOutcomeEvents, 4);
  assert.equal(score.uniqueOutcomeKeys, 4);
  assert.equal(score.matchedOutcomeKeyCount, 4);
  assert.equal(score.invalidOutcomeKeyEventCount, 0);
  assert.equal(score.unexpectedOutcomeKeyCount, 0);
  assert.equal(score.unexpectedOutcomeEventCount, 0);
  assert.equal(score.duplicateOutcomeKeyCount, 0);
  assert.equal(score.duplicateOutcomeEventCount, 0);
  assert.equal(score.outcomeKeyReconciliationGate, true);
  assert.equal(score.maturedCandidateOutcomes, 4);
  assert.equal(score.observedOutcomes, 4);
  assert.equal(score.missedOutcomes, 0);
  assert.equal(score.prospectiveCandidates, 4);
  assert.equal(score.openOutcomes, 0);
  assert.equal(score.unrecordedMaturedOutcomes, 0);
  assert.equal(score.recordedOutcomeCoverageRate, 1);
  assert.equal(score.validCapacityOutcomes, 4);
  assert.equal(score.validCapacityOutcomeCoverageRate, 1);
  assert.equal(score.minimumValidCapacityOutcomeCoverageRate, 0.95);
  assert.equal(score.validCapacityOutcomeCoverageGate, true);
  assert.equal(score.coverageDiagnostics.invalidCapacityOutcomes, 0);
  assert.equal(
    score.coverageDiagnostics
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    0,
  );
  assert.equal(
    score.coverageDiagnostics.invalidCapacityOutcomeReconciliationGate,
    true,
  );
  assert.equal(score.cashInclusiveIndependentHourlyFrames, 2);
  assert.ok(Number.isFinite(score.cashInclusiveAverageBaseReturnPct));
  assert.ok(Number.isFinite(score.cashInclusiveAverageStressReturnPct));
  assert.ok(Number.isFinite(score.missingAsLossAverageBaseReturnPct));
  assert.ok(Number.isFinite(score.missingAsLossAverageStressReturnPct));
  assert.equal(score.horizons["1h"].observedOutcomes, 2);
  assert.equal(score.horizons["1h"].candidateOutcomes, 2);
  assert.equal(score.horizons["1h"].recordedOutcomes, 2);
  assert.equal(score.horizons["1h"].recordedOutcomeEvents, 2);
  assert.equal(score.horizons["1h"].uniqueOutcomeKeys, 2);
  assert.equal(score.horizons["1h"].matchedOutcomeKeyCount, 2);
  assert.equal(score.horizons["1h"].invalidOutcomeKeyEventCount, 0);
  assert.equal(score.horizons["1h"].unexpectedOutcomeKeyCount, 0);
  assert.equal(score.horizons["1h"].unexpectedOutcomeEventCount, 0);
  assert.equal(score.horizons["1h"].duplicateOutcomeKeyCount, 0);
  assert.equal(score.horizons["1h"].duplicateOutcomeEventCount, 0);
  assert.equal(score.horizons["1h"].outcomeKeyReconciliationGate, true);
  assert.equal(score.horizons["1h"].maturedCandidateOutcomes, 2);
  assert.equal(score.horizons["1h"].recordedOutcomeCoverageRate, 1);
  assert.equal(score.horizons["1h"].validCapacityOutcomes, 2);
  assert.equal(score.horizons["1h"].validCapacityOutcomeCoverageRate, 1);
  assert.equal(score.horizons["1h"].validCapacityOutcomeCoverageGate, true);
  assert.deepEqual(
    score.horizons["1h"].discoveryUtcDayCoverageDiagnostics,
    {
      maximumReportedDiscoveryUtcDays: 14,
      totalDiscoveryUtcDays: 1,
      omittedEarlierDiscoveryUtcDays: 0,
      rows: [{
        discoveryUtcDay: "2026-08-04",
        maturedCandidateOutcomes: 2,
        recordedOutcomes: 2,
        observedOutcomes: 2,
        missedOutcomes: 0,
        expiredOutcomes: 0,
        otherMissedOutcomes: 0,
        validCapacityOutcomes: 2,
        unrecordedMaturedOutcomes: 0,
        observedCapacityInvalidOutcomes: 0,
        recordedOutcomeCoverageRate: 1,
        validCapacityOutcomeCoverageRate: 1,
        validCapacityOutcomeCoverageGate: true,
        reconciliationGate: true,
      }],
      researchOnly: true,
      mutationAllowed: false,
      authority: false,
    },
  );
  assert.equal(
    score.horizons["1h"].cashInclusiveAverageBaseReturnPct,
    score.horizons["1h"].averageBaseReturnPct,
  );
  assert.equal(
    score.horizons["1h"].missingAsLossAverageStressReturnPct,
    score.horizons["1h"].averageStressReturnPct,
  );
  assert.equal(score.horizons["24h"].observedOutcomes, 2);
  assert.equal(score.decisionAuthority, false);
  assert.equal(score.promotionAuthority, false);
  assert.equal(score.tradingAuthority, false);
  assert.equal(score.provisionalGate, false);

  const liquidityFloorAudit =
    buildGeckoTerminalNewPoolDelayedShadowLiquidityFloorAudit(events);
  assert.equal(
    liquidityFloorAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_LIQUIDITY_FLOOR_AUDIT_RULE.version,
  );
  assert.deepEqual(
    liquidityFloorAudit.thresholdsUsd,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_LIQUIDITY_FLOOR_AUDIT_RULE
      .thresholdsUsd],
  );
  assert.equal(liquidityFloorAudit.baselineMaturedCandidates, 1);
  assert.equal(liquidityFloorAudit.baselineValidCapacityOutcomes, 1);
  assert.equal(liquidityFloorAudit.variants.length, 8);
  assert.equal(liquidityFloorAudit.variants[0].thresholdUsd, 10_000);
  assert.equal(liquidityFloorAudit.variants[0].maturedObservations, 1);
  assert.equal(liquidityFloorAudit.variants[0].selectedObservations, 1);
  assert.equal(liquidityFloorAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(
    liquidityFloorAudit.variants[0].retrospectiveScreeningGate,
    false,
  );
  assert.equal(liquidityFloorAudit.variants[1].thresholdUsd, 12_500);
  assert.equal(liquidityFloorAudit.variants[1].selectedObservations, 0);
  assert.deepEqual(liquidityFloorAudit.retrospectiveScreeningCandidates, []);
  assert.equal(liquidityFloorAudit.nominationGate, false);
  assert.equal(liquidityFloorAudit.decisionAuthority, false);
  assert.equal(liquidityFloorAudit.promotionAuthority, false);
  assert.equal(liquidityFloorAudit.tradingAuthority, false);
  assert.equal(liquidityFloorAudit.mutationAllowed, false);

  const fullCohortLiquidityAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(events);
  assert.equal(
    fullCohortLiquidityAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortLiquidityAudit.thresholdsUsd,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
      .thresholdsUsd],
  );
  assert.equal(fullCohortLiquidityAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortLiquidityAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortLiquidityAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortLiquidityAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortLiquidityAudit.variants.length, 6);
  assert.equal(fullCohortLiquidityAudit.variants[0].thresholdUsd, 10_000);
  assert.equal(fullCohortLiquidityAudit.variants[0].selectedObservations, 1);
  assert.equal(fullCohortLiquidityAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(
    fullCohortLiquidityAudit.variants[0].gates.winnerConcentration,
    false,
  );
  assert.equal(fullCohortLiquidityAudit.variants[1].thresholdUsd, 25_000);
  assert.equal(fullCohortLiquidityAudit.variants[1].selectedObservations, 0);
  assert.deepEqual(
    fullCohortLiquidityAudit.retrospectiveScreeningCandidates,
    [],
  );
  assert.equal(fullCohortLiquidityAudit.nominationGate, false);
  assert.equal(fullCohortLiquidityAudit.decisionAuthority, false);
  assert.equal(fullCohortLiquidityAudit.promotionAuthority, false);
  assert.equal(fullCohortLiquidityAudit.tradingAuthority, false);
  assert.equal(fullCohortLiquidityAudit.mutationAllowed, false);

  const fullCohortVolumeAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit(events);
  assert.equal(
    fullCohortVolumeAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortVolumeAudit.thresholdsUsd,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
      .thresholdsUsd],
  );
  assert.equal(fullCohortVolumeAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortVolumeAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortVolumeAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortVolumeAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortVolumeAudit.variants.length, 6);
  assert.equal(fullCohortVolumeAudit.variants[0].thresholdUsd, 1_000);
  assert.equal(fullCohortVolumeAudit.variants[0].selectedObservations, 2);
  assert.equal(fullCohortVolumeAudit.variants[0].validSelectedOutcomes, 2);
  assert.equal(fullCohortVolumeAudit.variants[1].thresholdUsd, 2_500);
  assert.equal(fullCohortVolumeAudit.variants[1].selectedObservations, 0);
  assert.deepEqual(fullCohortVolumeAudit.retrospectiveScreeningCandidates, []);
  assert.equal(fullCohortVolumeAudit.nominationGate, false);
  assert.equal(fullCohortVolumeAudit.decisionAuthority, false);
  assert.equal(fullCohortVolumeAudit.promotionAuthority, false);
  assert.equal(fullCohortVolumeAudit.tradingAuthority, false);
  assert.equal(fullCohortVolumeAudit.mutationAllowed, false);

  const fullCohortTurnoverAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit(events);
  assert.equal(
    fullCohortTurnoverAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortTurnoverAudit.maximumTurnovers,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
      .maximumTurnovers],
  );
  assert.equal(fullCohortTurnoverAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortTurnoverAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortTurnoverAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortTurnoverAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortTurnoverAudit.variants.length, 6);
  assert.equal(fullCohortTurnoverAudit.variants[0].maximumTurnover, 0.025);
  assert.equal(fullCohortTurnoverAudit.variants[0].selectedObservations, 0);
  assert.equal(fullCohortTurnoverAudit.variants[3].maximumTurnover, 0.2);
  assert.equal(fullCohortTurnoverAudit.variants[3].selectedObservations, 1);
  assert.equal(fullCohortTurnoverAudit.variants[3].validSelectedOutcomes, 1);
  assert.equal(fullCohortTurnoverAudit.variants[4].maximumTurnover, 0.5);
  assert.equal(fullCohortTurnoverAudit.variants[4].selectedObservations, 1);
  assert.deepEqual(fullCohortTurnoverAudit.retrospectiveScreeningCandidates, []);
  assert.equal(fullCohortTurnoverAudit.nominationGate, false);
  assert.equal(fullCohortTurnoverAudit.decisionAuthority, false);
  assert.equal(fullCohortTurnoverAudit.promotionAuthority, false);
  assert.equal(fullCohortTurnoverAudit.tradingAuthority, false);
  assert.equal(fullCohortTurnoverAudit.mutationAllowed, false);

  const fullCohortTurnoverFloorAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit(events);
  assert.equal(
    fullCohortTurnoverFloorAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortTurnoverFloorAudit.minimumTurnovers,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
      .minimumTurnovers],
  );
  assert.equal(fullCohortTurnoverFloorAudit.derivationStatus, "post-rejection-complementary-direction");
  assert.equal(fullCohortTurnoverFloorAudit.relatedPriorAuditVersions.length, 3);
  assert.equal(fullCohortTurnoverFloorAudit.sequentialRelatedFamilyCountIncludingThis, 4);
  assert.equal(fullCohortTurnoverFloorAudit.sequentialRelatedVariantCountIncludingThis, 24);
  assert.equal(fullCohortTurnoverFloorAudit.sequentialFamilyCorrectionRequired, true);
  assert.equal(fullCohortTurnoverFloorAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortTurnoverFloorAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortTurnoverFloorAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortTurnoverFloorAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortTurnoverFloorAudit.variants.length, 6);
  assert.equal(fullCohortTurnoverFloorAudit.variants[0].minimumTurnover, 0.5);
  assert.equal(fullCohortTurnoverFloorAudit.variants[0].selectedObservations, 1);
  assert.equal(fullCohortTurnoverFloorAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(fullCohortTurnoverFloorAudit.variants[2].minimumTurnover, 2);
  assert.equal(fullCohortTurnoverFloorAudit.variants[2].selectedObservations, 1);
  assert.equal(fullCohortTurnoverFloorAudit.variants[3].minimumTurnover, 5);
  assert.equal(fullCohortTurnoverFloorAudit.variants[3].selectedObservations, 0);
  assert.deepEqual(
    fullCohortTurnoverFloorAudit.retrospectiveScreeningCandidates,
    [],
  );
  assert.equal(
    fullCohortTurnoverFloorAudit.familyCorrectionStatus,
    "not-run-no-variant-cleared-prerequisite-screening",
  );
  assert.equal(fullCohortTurnoverFloorAudit.nominationGate, false);
  assert.equal(fullCohortTurnoverFloorAudit.decisionAuthority, false);
  assert.equal(fullCohortTurnoverFloorAudit.promotionAuthority, false);
  assert.equal(fullCohortTurnoverFloorAudit.tradingAuthority, false);
  assert.equal(fullCohortTurnoverFloorAudit.mutationAllowed, false);

  const fullCohortMarketCapAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit(events);
  assert.equal(
    fullCohortMarketCapAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortMarketCapAudit.thresholdsUsd,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
      .thresholdsUsd],
  );
  assert.equal(
    fullCohortMarketCapAudit.derivationStatus,
    "distinct-maturity-hypothesis-after-four-related-failures",
  );
  assert.equal(fullCohortMarketCapAudit.fieldSource, "provider-market-cap-with-provider-fdv-fallback");
  assert.equal(fullCohortMarketCapAudit.relatedPriorAuditVersions.length, 4);
  assert.equal(fullCohortMarketCapAudit.sequentialRelatedFamilyCountIncludingThis, 5);
  assert.equal(fullCohortMarketCapAudit.sequentialRelatedVariantCountIncludingThis, 30);
  assert.equal(fullCohortMarketCapAudit.sequentialFamilyCorrectionRequired, true);
  assert.equal(fullCohortMarketCapAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortMarketCapAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortMarketCapAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortMarketCapAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortMarketCapAudit.variants.length, 6);
  assert.equal(fullCohortMarketCapAudit.variants[0].thresholdUsd, 50_000);
  assert.equal(fullCohortMarketCapAudit.variants[0].selectedObservations, 1);
  assert.equal(fullCohortMarketCapAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(fullCohortMarketCapAudit.variants[1].thresholdUsd, 100_000);
  assert.equal(fullCohortMarketCapAudit.variants[1].selectedObservations, 1);
  assert.equal(fullCohortMarketCapAudit.variants[2].thresholdUsd, 250_000);
  assert.equal(fullCohortMarketCapAudit.variants[2].selectedObservations, 0);
  assert.deepEqual(fullCohortMarketCapAudit.retrospectiveScreeningCandidates, []);
  assert.equal(
    fullCohortMarketCapAudit.familyCorrectionStatus,
    "not-run-no-variant-cleared-prerequisite-screening",
  );
  assert.equal(fullCohortMarketCapAudit.nominationGate, false);
  assert.equal(fullCohortMarketCapAudit.decisionAuthority, false);
  assert.equal(fullCohortMarketCapAudit.promotionAuthority, false);
  assert.equal(fullCohortMarketCapAudit.tradingAuthority, false);
  assert.equal(fullCohortMarketCapAudit.mutationAllowed, false);

  const fullCohortWilsonBuyShareAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit(events);
  assert.equal(
    fullCohortWilsonBuyShareAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortWilsonBuyShareAudit.minimumWilsonLowerBounds,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
      .minimumWilsonLowerBounds],
  );
  assert.equal(fullCohortWilsonBuyShareAudit.confidenceLevel, 0.95);
  assert.equal(
    fullCohortWilsonBuyShareAudit.derivationStatus,
    "outcome-blind-sparse-count-penalized-order-flow-hypothesis-after-five-related-failures",
  );
  assert.equal(fullCohortWilsonBuyShareAudit.relatedPriorAuditVersions.length, 5);
  assert.equal(
    fullCohortWilsonBuyShareAudit.sequentialRelatedFamilyCountIncludingThis,
    6,
  );
  assert.equal(
    fullCohortWilsonBuyShareAudit.sequentialRelatedVariantCountIncludingThis,
    36,
  );
  assert.equal(
    fullCohortWilsonBuyShareAudit.sequentialFamilyCorrectionRequired,
    true,
  );
  assert.equal(fullCohortWilsonBuyShareAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortWilsonBuyShareAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortWilsonBuyShareAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortWilsonBuyShareAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortWilsonBuyShareAudit.variants.length, 6);
  assert.equal(
    fullCohortWilsonBuyShareAudit.variants[0].minimumWilsonLowerBound,
    0.35,
  );
  assert.equal(fullCohortWilsonBuyShareAudit.variants[0].selectedObservations, 2);
  assert.equal(fullCohortWilsonBuyShareAudit.variants[0].validSelectedOutcomes, 2);
  assert.equal(
    fullCohortWilsonBuyShareAudit.variants[1].minimumWilsonLowerBound,
    0.4,
  );
  assert.equal(fullCohortWilsonBuyShareAudit.variants[1].selectedObservations, 2);
  assert.equal(
    fullCohortWilsonBuyShareAudit.variants[2].minimumWilsonLowerBound,
    0.45,
  );
  assert.equal(fullCohortWilsonBuyShareAudit.variants[2].selectedObservations, 0);
  assert.deepEqual(
    fullCohortWilsonBuyShareAudit.retrospectiveScreeningCandidates,
    [],
  );
  assert.equal(
    fullCohortWilsonBuyShareAudit.familyCorrectionStatus,
    "not-run-no-variant-cleared-prerequisite-screening",
  );
  assert.equal(fullCohortWilsonBuyShareAudit.nominationGate, false);
  assert.equal(fullCohortWilsonBuyShareAudit.decisionAuthority, false);
  assert.equal(fullCohortWilsonBuyShareAudit.promotionAuthority, false);
  assert.equal(fullCohortWilsonBuyShareAudit.tradingAuthority, false);
  assert.equal(fullCohortWilsonBuyShareAudit.mutationAllowed, false);

  const fullCohortTransactionCountAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTransactionCountAudit(events);
  assert.equal(
    fullCohortTransactionCountAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE
      .version,
  );
  assert.deepEqual(
    fullCohortTransactionCountAudit.minimumTransactionCounts,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE
      .minimumTransactionCounts],
  );
  assert.equal(
    fullCohortTransactionCountAudit.derivationStatus,
    "post-rejection-participation-breadth-hypothesis-after-six-related-failures",
  );
  assert.equal(fullCohortTransactionCountAudit.relatedPriorAuditVersions.length, 6);
  assert.equal(
    fullCohortTransactionCountAudit.sequentialRelatedFamilyCountIncludingThis,
    7,
  );
  assert.equal(
    fullCohortTransactionCountAudit.sequentialRelatedVariantCountIncludingThis,
    42,
  );
  assert.equal(
    fullCohortTransactionCountAudit.sequentialFamilyCorrectionRequired,
    true,
  );
  assert.equal(fullCohortTransactionCountAudit.baselineMaturedCandidates, 2);
  assert.equal(fullCohortTransactionCountAudit.featureAvailableCandidates, 2);
  assert.equal(fullCohortTransactionCountAudit.featureAvailabilityRate, 1);
  assert.equal(fullCohortTransactionCountAudit.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortTransactionCountAudit.variants.length, 6);
  assert.equal(
    fullCohortTransactionCountAudit.variants[0].minimumTransactionCount,
    1,
  );
  assert.equal(fullCohortTransactionCountAudit.variants[0].selectedObservations, 2);
  assert.equal(fullCohortTransactionCountAudit.variants[0].validSelectedOutcomes, 2);
  assert.equal(
    fullCohortTransactionCountAudit.variants[3].minimumTransactionCount,
    20,
  );
  assert.equal(fullCohortTransactionCountAudit.variants[3].selectedObservations, 0);
  assert.deepEqual(
    fullCohortTransactionCountAudit.retrospectiveScreeningCandidates,
    [],
  );
  assert.equal(
    fullCohortTransactionCountAudit.familyCorrectionStatus,
    "not-run-no-variant-cleared-prerequisite-screening",
  );
  assert.equal(fullCohortTransactionCountAudit.nominationGate, false);
  assert.equal(fullCohortTransactionCountAudit.decisionAuthority, false);
  assert.equal(fullCohortTransactionCountAudit.promotionAuthority, false);
  assert.equal(fullCohortTransactionCountAudit.tradingAuthority, false);
  assert.equal(fullCohortTransactionCountAudit.mutationAllowed, false);

  const fullCohortFamilyReports = [
    fullCohortLiquidityAudit,
    fullCohortVolumeAudit,
    fullCohortTurnoverAudit,
    fullCohortTurnoverFloorAudit,
    fullCohortMarketCapAudit,
    fullCohortWilsonBuyShareAudit,
    fullCohortTransactionCountAudit,
  ];
  assert.deepEqual(
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      fullCohortFamilyReports,
    ),
    { ok: true, errors: [] },
  );
  const omittedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      fullCohortFamilyReports.slice(1),
    );
  assert.equal(omittedFullCohortFamilyVerification.ok, false);
  assert.ok(omittedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("expected-7-families")
  )));
  const tamperedFullCohortFamilyReports = structuredClone(fullCohortFamilyReports);
  tamperedFullCohortFamilyReports[4].relatedPriorAuditVersions.pop();
  const tamperedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      tamperedFullCohortFamilyReports,
    );
  assert.equal(tamperedFullCohortFamilyVerification.ok, false);
  assert.ok(tamperedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("family-sequential-lineage-mismatch")
  )));
  const countTamperedFullCohortFamilyReports = structuredClone(
    fullCohortFamilyReports,
  );
  countTamperedFullCohortFamilyReports[2].variants.pop();
  const countTamperedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      countTamperedFullCohortFamilyReports,
    );
  assert.equal(countTamperedFullCohortFamilyVerification.ok, false);
  assert.ok(countTamperedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("family-variant-count-mismatch")
  )));
  const asOfTamperedFullCohortFamilyReports = structuredClone(
    fullCohortFamilyReports,
  );
  asOfTamperedFullCohortFamilyReports[1].scorecardAsOf =
    "2026-08-09T00:00:00.000Z";
  const asOfTamperedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      asOfTamperedFullCohortFamilyReports,
    );
  assert.equal(asOfTamperedFullCohortFamilyVerification.ok, false);
  assert.ok(asOfTamperedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("family-cohort-identity-mismatch")
  )));
  const coverageTamperedFullCohortFamilyReports = structuredClone(
    fullCohortFamilyReports,
  );
  coverageTamperedFullCohortFamilyReports[5].baselineValidCapacityOutcomes -= 1;
  const coverageTamperedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      coverageTamperedFullCohortFamilyReports,
    );
  assert.equal(coverageTamperedFullCohortFamilyVerification.ok, false);
  assert.ok(coverageTamperedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("family-cohort-identity-mismatch")
  )));
  const authorityTamperedFullCohortFamilyReports = structuredClone(
    fullCohortFamilyReports,
  );
  authorityTamperedFullCohortFamilyReports[0].tradingAuthority = true;
  const authorityTamperedFullCohortFamilyVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      authorityTamperedFullCohortFamilyReports,
    );
  assert.equal(authorityTamperedFullCohortFamilyVerification.ok, false);
  assert.ok(authorityTamperedFullCohortFamilyVerification.errors.some((error) => (
    error.startsWith("family-authority-mismatch")
  )));

  const fullCohortAuditRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(events);
  assert.equal(
    fullCohortAuditRegistry.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_REGISTRY_RULE
      .version,
  );
  assert.equal(fullCohortAuditRegistry.totalFamilyCount, 7);
  assert.equal(fullCohortAuditRegistry.totalVariantCount, 42);
  assert.equal(fullCohortAuditRegistry.families.length, 7);
  assert.equal(fullCohortAuditRegistry.baselineMaturedCandidates, 2);
  assert.equal(fullCohortAuditRegistry.baselineValidCapacityOutcomes, 2);
  assert.equal(fullCohortAuditRegistry.validCapacityOutcomeCoverageRate, 1);
  assert.equal(
    fullCohortAuditRegistry.minimumValidCapacityOutcomeCoverageRate,
    0.95,
  );
  assert.equal(fullCohortAuditRegistry.validCapacityOutcomeCoverageGate, true);
  assert.equal(fullCohortAuditRegistry.recordedOutcomeEvents, 2);
  assert.equal(fullCohortAuditRegistry.uniqueOutcomeKeys, 2);
  assert.equal(fullCohortAuditRegistry.matchedOutcomeKeyCount, 2);
  assert.equal(fullCohortAuditRegistry.invalidOutcomeKeyEventCount, 0);
  assert.equal(fullCohortAuditRegistry.unexpectedOutcomeKeyCount, 0);
  assert.equal(fullCohortAuditRegistry.unexpectedOutcomeEventCount, 0);
  assert.equal(fullCohortAuditRegistry.duplicateOutcomeKeyCount, 0);
  assert.equal(fullCohortAuditRegistry.duplicateOutcomeEventCount, 0);
  assert.equal(fullCohortAuditRegistry.outcomeKeyReconciliationGate, true);
  assert.equal(fullCohortAuditRegistry.invalidCapacityOutcomes, 0);
  assert.equal(
    fullCohortAuditRegistry
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    0,
  );
  assert.equal(fullCohortAuditRegistry.lineageVerification.ok, true);
  assert.deepEqual(fullCohortAuditRegistry.lineageVerification.errors, []);
  assert.equal(fullCohortAuditRegistry.lineageIntegrityGate, true);
  assert.equal(fullCohortAuditRegistry.evidenceReadinessGate, true);
  assert.equal(fullCohortAuditRegistry.screeningCandidateCount, 0);
  assert.equal(fullCohortAuditRegistry.allFamiliesPrerequisiteRejected, true);
  assert.equal(
    fullCohortAuditRegistry.familyExpansionPolicy,
    "one-separately-declared-family-only-after-lineage-coverage-and-correction-prerequisites",
  );
  assert.equal(
    fullCohortAuditRegistry.maximumAdditionalFamiliesPerReviewedExpansion,
    1,
  );
  assert.equal(fullCohortAuditRegistry.familyExpansionPrerequisiteGate, true);
  assert.equal(
    fullCohortAuditRegistry.familyExpansionStatus,
    "eligible-only-for-separately-declared-one-change-family",
  );
  assert.equal(fullCohortAuditRegistry.familyExpansionAuthority, false);
  assert.equal(
    fullCohortAuditRegistry.familyCorrectionStatus,
    "not-run-no-variant-cleared-prerequisite-screening",
  );
  assert.equal(fullCohortAuditRegistry.nominationGate, false);
  assert.equal(fullCohortAuditRegistry.decisionAuthority, false);
  assert.equal(fullCohortAuditRegistry.promotionAuthority, false);
  assert.equal(fullCohortAuditRegistry.tradingAuthority, false);
  assert.equal(fullCohortAuditRegistry.mutationAllowed, false);

  const duplicateOutcomeEvents = structuredClone(events);
  const duplicateOutcome = structuredClone(duplicateOutcomeEvents.find((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  )));
  duplicateOutcome.id = `${duplicateOutcome.id}-semantic-duplicate`;
  duplicateOutcomeEvents.push(duplicateOutcome);
  const duplicateOutcomeScore =
    buildGeckoTerminalNewPoolDelayedShadowScorecard(duplicateOutcomeEvents);
  assert.equal(duplicateOutcomeScore.recordedOutcomes, 4);
  assert.equal(duplicateOutcomeScore.recordedOutcomeEvents, 5);
  assert.equal(duplicateOutcomeScore.uniqueOutcomeKeys, 4);
  assert.equal(duplicateOutcomeScore.matchedOutcomeKeyCount, 4);
  assert.equal(duplicateOutcomeScore.unexpectedOutcomeKeyCount, 0);
  assert.equal(duplicateOutcomeScore.unexpectedOutcomeEventCount, 0);
  assert.equal(duplicateOutcomeScore.duplicateOutcomeKeyCount, 1);
  assert.equal(duplicateOutcomeScore.duplicateOutcomeEventCount, 1);
  assert.equal(duplicateOutcomeScore.outcomeKeyReconciliationGate, false);
  assert.equal(duplicateOutcomeScore.recordedOutcomeCoverageRate, 1);
  assert.equal(duplicateOutcomeScore.horizons["1h"].recordedOutcomes, 2);
  assert.equal(duplicateOutcomeScore.horizons["1h"].recordedOutcomeEvents, 3);
  assert.equal(duplicateOutcomeScore.horizons["1h"].uniqueOutcomeKeys, 2);
  assert.equal(
    duplicateOutcomeScore.horizons["1h"].outcomeKeyReconciliationGate,
    false,
  );
  const duplicateOutcomeRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      duplicateOutcomeEvents,
    );
  assert.equal(duplicateOutcomeRegistry.recordedOutcomeEvents, 3);
  assert.equal(duplicateOutcomeRegistry.uniqueOutcomeKeys, 2);
  assert.equal(duplicateOutcomeRegistry.matchedOutcomeKeyCount, 2);
  assert.equal(duplicateOutcomeRegistry.unexpectedOutcomeKeyCount, 0);
  assert.equal(duplicateOutcomeRegistry.unexpectedOutcomeEventCount, 0);
  assert.equal(duplicateOutcomeRegistry.duplicateOutcomeKeyCount, 1);
  assert.equal(duplicateOutcomeRegistry.duplicateOutcomeEventCount, 1);
  assert.equal(duplicateOutcomeRegistry.outcomeKeyReconciliationGate, false);
  assert.equal(duplicateOutcomeRegistry.evidenceReadinessGate, false);
  assert.equal(duplicateOutcomeRegistry.familyExpansionPrerequisiteGate, false);
  assert.equal(
    duplicateOutcomeRegistry.familyExpansionStatus,
    "blocked-unreconciled-delayed-outcome-keys",
  );
  assert.equal(
    duplicateOutcomeRegistry.familyCorrectionStatus,
    "blocked-unreconciled-delayed-outcome-keys",
  );
  assert.equal(duplicateOutcomeRegistry.familyExpansionAuthority, false);
  assert.equal(duplicateOutcomeRegistry.tradingAuthority, false);

  const invalidOutcomeKeyEvents = structuredClone(events);
  invalidOutcomeKeyEvents.find((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  )).pairAddress = "";
  const invalidOutcomeKeyScore =
    buildGeckoTerminalNewPoolDelayedShadowScorecard(invalidOutcomeKeyEvents);
  assert.equal(invalidOutcomeKeyScore.recordedOutcomeEvents, 4);
  assert.equal(invalidOutcomeKeyScore.uniqueOutcomeKeys, 3);
  assert.equal(invalidOutcomeKeyScore.matchedOutcomeKeyCount, 3);
  assert.equal(invalidOutcomeKeyScore.invalidOutcomeKeyEventCount, 1);
  assert.equal(invalidOutcomeKeyScore.unexpectedOutcomeKeyCount, 0);
  assert.equal(invalidOutcomeKeyScore.unexpectedOutcomeEventCount, 0);
  assert.equal(invalidOutcomeKeyScore.duplicateOutcomeEventCount, 0);
  assert.equal(invalidOutcomeKeyScore.outcomeKeyReconciliationGate, false);
  const invalidOutcomeKeyRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      invalidOutcomeKeyEvents,
    );
  assert.equal(invalidOutcomeKeyRegistry.invalidOutcomeKeyEventCount, 1);
  assert.equal(invalidOutcomeKeyRegistry.matchedOutcomeKeyCount, 1);
  assert.equal(invalidOutcomeKeyRegistry.outcomeKeyReconciliationGate, false);
  assert.equal(invalidOutcomeKeyRegistry.evidenceReadinessGate, false);
  assert.equal(
    invalidOutcomeKeyRegistry.familyExpansionStatus,
    "blocked-unreconciled-delayed-outcome-keys",
  );
  assert.equal(invalidOutcomeKeyRegistry.familyExpansionAuthority, false);

  const unexpectedOutcomeKeyEvents = structuredClone(events);
  const unexpectedOutcome = structuredClone(unexpectedOutcomeKeyEvents.find((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  )));
  unexpectedOutcome.id = `${unexpectedOutcome.id}-unexpected-pair`;
  unexpectedOutcome.pairAddress = "PoolUnexpected1111111111111111111111111111";
  unexpectedOutcomeKeyEvents.push(unexpectedOutcome);
  const unexpectedOutcomeKeyScore =
    buildGeckoTerminalNewPoolDelayedShadowScorecard(unexpectedOutcomeKeyEvents);
  assert.equal(unexpectedOutcomeKeyScore.recordedOutcomeEvents, 5);
  assert.equal(unexpectedOutcomeKeyScore.uniqueOutcomeKeys, 5);
  assert.equal(unexpectedOutcomeKeyScore.matchedOutcomeKeyCount, 4);
  assert.equal(unexpectedOutcomeKeyScore.unexpectedOutcomeKeyCount, 1);
  assert.equal(unexpectedOutcomeKeyScore.unexpectedOutcomeEventCount, 1);
  assert.equal(unexpectedOutcomeKeyScore.recordedOutcomes, 4);
  assert.equal(unexpectedOutcomeKeyScore.recordedOutcomeCoverageRate, 1);
  assert.equal(unexpectedOutcomeKeyScore.outcomeKeyReconciliationGate, false);
  const unexpectedOutcomeKeyRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      unexpectedOutcomeKeyEvents,
    );
  assert.equal(unexpectedOutcomeKeyRegistry.recordedOutcomeEvents, 3);
  assert.equal(unexpectedOutcomeKeyRegistry.uniqueOutcomeKeys, 3);
  assert.equal(unexpectedOutcomeKeyRegistry.matchedOutcomeKeyCount, 2);
  assert.equal(unexpectedOutcomeKeyRegistry.unexpectedOutcomeKeyCount, 1);
  assert.equal(unexpectedOutcomeKeyRegistry.unexpectedOutcomeEventCount, 1);
  assert.equal(unexpectedOutcomeKeyRegistry.outcomeKeyReconciliationGate, false);
  assert.equal(unexpectedOutcomeKeyRegistry.evidenceReadinessGate, false);
  assert.equal(
    unexpectedOutcomeKeyRegistry.familyExpansionStatus,
    "blocked-unreconciled-delayed-outcome-keys",
  );
  assert.equal(unexpectedOutcomeKeyRegistry.familyExpansionAuthority, false);

  const unavailableFullCohortLiquidityEvents = structuredClone(events);
  const unavailableFullCohortLiquidityCandidate =
    unavailableFullCohortLiquidityEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === secondBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableFullCohortLiquidityCandidate.birthQuote.liquidityUsd = null;
  const unavailableFullCohortLiquidityAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(
      unavailableFullCohortLiquidityEvents,
    );
  assert.equal(unavailableFullCohortLiquidityAudit.baselineMaturedCandidates, 2);
  assert.equal(unavailableFullCohortLiquidityAudit.featureAvailableCandidates, 1);
  assert.equal(unavailableFullCohortLiquidityAudit.featureAvailabilityRate, 0.5);
  assert.ok(unavailableFullCohortLiquidityAudit.variants.every((variant) => (
    variant.selectedObservations === 0
      && variant.averageBaseReturnPct === 0
      && variant.averageStressReturnPct === 0
      && variant.retrospectiveScreeningGate === false
  )));

  const unavailableFullCohortVolumeEvents = structuredClone(events);
  const unavailableFullCohortVolumeCandidate =
    unavailableFullCohortVolumeEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === secondBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableFullCohortVolumeCandidate.birthQuote.volumeH1Usd = null;
  const unavailableFullCohortVolumeAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit(
      unavailableFullCohortVolumeEvents,
    );
  assert.equal(unavailableFullCohortVolumeAudit.baselineMaturedCandidates, 2);
  assert.equal(unavailableFullCohortVolumeAudit.featureAvailableCandidates, 1);
  assert.equal(unavailableFullCohortVolumeAudit.featureAvailabilityRate, 0.5);
  assert.equal(unavailableFullCohortVolumeAudit.variants[0].selectedObservations, 1);
  assert.ok(unavailableFullCohortVolumeAudit.variants.slice(1).every((variant) => (
    variant.selectedObservations === 0
      && variant.averageBaseReturnPct === 0
      && variant.averageStressReturnPct === 0
      && variant.retrospectiveScreeningGate === false
  )));

  const unavailableFullCohortTurnoverEvents = structuredClone(events);
  const unavailableFullCohortTurnoverCandidate =
    unavailableFullCohortTurnoverEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === secondBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableFullCohortTurnoverCandidate.birthQuote.fiveMinuteTurnover = null;
  const unavailableFullCohortTurnoverAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit(
      unavailableFullCohortTurnoverEvents,
    );
  assert.equal(unavailableFullCohortTurnoverAudit.baselineMaturedCandidates, 2);
  assert.equal(unavailableFullCohortTurnoverAudit.featureAvailableCandidates, 1);
  assert.equal(unavailableFullCohortTurnoverAudit.featureAvailabilityRate, 0.5);
  assert.equal(unavailableFullCohortTurnoverAudit.variants[3].selectedObservations, 0);
  assert.equal(unavailableFullCohortTurnoverAudit.variants[4].selectedObservations, 0);
  assert.equal(unavailableFullCohortTurnoverAudit.variants[4].validSelectedOutcomes, 0);

  const unavailableFullCohortTurnoverFloorAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit(
      unavailableFullCohortTurnoverEvents,
    );
  assert.equal(
    unavailableFullCohortTurnoverFloorAudit.baselineMaturedCandidates,
    2,
  );
  assert.equal(
    unavailableFullCohortTurnoverFloorAudit.featureAvailableCandidates,
    1,
  );
  assert.equal(unavailableFullCohortTurnoverFloorAudit.featureAvailabilityRate, 0.5);
  assert.equal(
    unavailableFullCohortTurnoverFloorAudit.variants[0].selectedObservations,
    1,
  );
  assert.equal(
    unavailableFullCohortTurnoverFloorAudit.variants[0].validSelectedOutcomes,
    1,
  );
  assert.equal(
    unavailableFullCohortTurnoverFloorAudit.variants[3].selectedObservations,
    0,
  );

  const unavailableFullCohortMarketCapEvents = structuredClone(events);
  const unavailableFullCohortMarketCapCandidate =
    unavailableFullCohortMarketCapEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === firstBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableFullCohortMarketCapCandidate.birthQuote.marketCapUsd = null;
  const unavailableFullCohortMarketCapAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit(
      unavailableFullCohortMarketCapEvents,
    );
  assert.equal(unavailableFullCohortMarketCapAudit.baselineMaturedCandidates, 2);
  assert.equal(unavailableFullCohortMarketCapAudit.featureAvailableCandidates, 1);
  assert.equal(unavailableFullCohortMarketCapAudit.featureAvailabilityRate, 0.5);
  assert.ok(unavailableFullCohortMarketCapAudit.variants.every((variant) => (
    variant.selectedObservations === 0
      && variant.averageBaseReturnPct === 0
      && variant.averageStressReturnPct === 0
      && variant.retrospectiveScreeningGate === false
  )));

  const unavailableFullCohortWilsonBuyShareEvents = structuredClone(events);
  const unavailableFullCohortWilsonBuyShareCandidate =
    unavailableFullCohortWilsonBuyShareEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === firstBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableFullCohortWilsonBuyShareCandidate.birthQuote.buysM5 = 0;
  unavailableFullCohortWilsonBuyShareCandidate.birthQuote.sellsM5 = 0;
  const unavailableFullCohortWilsonBuyShareAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit(
      unavailableFullCohortWilsonBuyShareEvents,
    );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.baselineMaturedCandidates,
    2,
  );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.featureAvailableCandidates,
    1,
  );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.featureAvailabilityRate,
    0.5,
  );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.variants[0].selectedObservations,
    1,
  );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.variants[0].validSelectedOutcomes,
    1,
  );
  assert.equal(
    unavailableFullCohortWilsonBuyShareAudit.variants[2].selectedObservations,
    0,
  );

  const buyShareAudit =
    buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit(events);
  assert.equal(
    buyShareAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_BUY_SHARE_AUDIT_RULE.version,
  );
  assert.deepEqual(
    buyShareAudit.minimumBuyShares,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_BUY_SHARE_AUDIT_RULE
      .minimumBuyShares],
  );
  assert.equal(buyShareAudit.baselineMaturedCandidates, 1);
  assert.equal(buyShareAudit.featureAvailableCandidates, 1);
  assert.equal(buyShareAudit.featureAvailabilityRate, 1);
  assert.equal(buyShareAudit.baselineValidCapacityOutcomes, 1);
  assert.equal(buyShareAudit.variants.length, 6);
  assert.equal(buyShareAudit.variants[0].minimumBuyShare, 0.5);
  assert.equal(buyShareAudit.variants[0].selectedObservations, 1);
  assert.equal(buyShareAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(buyShareAudit.variants[4].minimumBuyShare, 0.7);
  assert.equal(buyShareAudit.variants[4].selectedObservations, 0);
  assert.deepEqual(buyShareAudit.retrospectiveScreeningCandidates, []);
  assert.equal(buyShareAudit.nominationGate, false);
  assert.equal(buyShareAudit.decisionAuthority, false);
  assert.equal(buyShareAudit.promotionAuthority, false);
  assert.equal(buyShareAudit.tradingAuthority, false);
  assert.equal(buyShareAudit.mutationAllowed, false);

  const transactionCountAudit =
    buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit(events);
  assert.equal(
    transactionCountAudit.auditVersion,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_TRANSACTION_COUNT_AUDIT_RULE.version,
  );
  assert.deepEqual(
    transactionCountAudit.minimumTransactionCounts,
    [...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_TRANSACTION_COUNT_AUDIT_RULE
      .minimumTransactionCounts],
  );
  assert.equal(transactionCountAudit.baselineMaturedCandidates, 1);
  assert.equal(transactionCountAudit.featureAvailableCandidates, 1);
  assert.equal(transactionCountAudit.featureAvailabilityRate, 1);
  assert.equal(transactionCountAudit.baselineValidCapacityOutcomes, 1);
  assert.equal(transactionCountAudit.variants.length, 6);
  assert.equal(transactionCountAudit.variants[0].minimumTransactionCount, 1);
  assert.equal(transactionCountAudit.variants[0].selectedObservations, 1);
  assert.equal(transactionCountAudit.variants[0].validSelectedOutcomes, 1);
  assert.equal(transactionCountAudit.variants[3].minimumTransactionCount, 20);
  assert.equal(transactionCountAudit.variants[3].selectedObservations, 0);
  assert.deepEqual(transactionCountAudit.retrospectiveScreeningCandidates, []);
  assert.equal(transactionCountAudit.nominationGate, false);
  assert.equal(transactionCountAudit.decisionAuthority, false);
  assert.equal(transactionCountAudit.promotionAuthority, false);
  assert.equal(transactionCountAudit.tradingAuthority, false);
  assert.equal(transactionCountAudit.mutationAllowed, false);

  const unavailableBuyShareEvents = structuredClone(events);
  const unavailableBuyShareCandidate = unavailableBuyShareEvents.find((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).candidates.find((candidate) => (
    candidate.tokenAddress
      === secondBirth.relationships.base_token.data.id.slice("solana_".length)
  ));
  unavailableBuyShareCandidate.birthQuote.buysM5 = 0;
  unavailableBuyShareCandidate.birthQuote.sellsM5 = 0;
  unavailableBuyShareCandidate.birthQuote.fiveMinuteBuySellTxnRatio = null;
  const unavailableBuyShareAudit =
    buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit(
      unavailableBuyShareEvents,
    );
  assert.equal(unavailableBuyShareAudit.featureAvailableCandidates, 0);
  assert.equal(unavailableBuyShareAudit.featureAvailabilityRate, 0);
  assert.ok(unavailableBuyShareAudit.variants.every((variant) => (
    variant.selectedObservations === 0
      && variant.averageBaseReturnPct === 0
      && variant.averageStressReturnPct === 0
      && variant.retrospectiveScreeningGate === false
  )));

  const unavailableTransactionCountEvents = structuredClone(events);
  const unavailableTransactionCountCandidate =
    unavailableTransactionCountEvents.find((event) => (
      event.type === "geckoterminal-new-pool-discovery"
    )).candidates.find((candidate) => (
      candidate.tokenAddress
        === secondBirth.relationships.base_token.data.id.slice("solana_".length)
    ));
  unavailableTransactionCountCandidate.birthQuote.buysM5 = null;
  unavailableTransactionCountCandidate.birthQuote.sellsM5 = null;
  unavailableTransactionCountCandidate.birthQuote.fiveMinuteBuySellTxnRatio = null;
  const unavailableTransactionCountAudit =
    buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit(
      unavailableTransactionCountEvents,
    );
  assert.equal(unavailableTransactionCountAudit.featureAvailableCandidates, 0);
  assert.equal(unavailableTransactionCountAudit.featureAvailabilityRate, 0);
  assert.ok(unavailableTransactionCountAudit.variants.every((variant) => (
    variant.selectedObservations === 0
      && variant.averageBaseReturnPct === 0
      && variant.averageStressReturnPct === 0
      && variant.retrospectiveScreeningGate === false
  )));

  const missingAuditEvents = structuredClone(events);
  const missingAuditOutcome = missingAuditEvents.find((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
      && event.tokenAddress
        === secondBirth.relationships.base_token.data.id.slice("solana_".length)
  ));
  missingAuditOutcome.status = "missed";
  missingAuditOutcome.reason = "delayed-shadow-window-expired";
  missingAuditOutcome.outcomeQuote = null;
  missingAuditOutcome.grossReturnPct = null;
  const missingFullCohortAuditRegistry =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
      missingAuditEvents,
    );
  assert.equal(missingFullCohortAuditRegistry.lineageIntegrityGate, true);
  assert.equal(missingFullCohortAuditRegistry.baselineMaturedCandidates, 2);
  assert.equal(missingFullCohortAuditRegistry.baselineValidCapacityOutcomes, 1);
  assert.equal(
    missingFullCohortAuditRegistry.validCapacityOutcomeCoverageRate,
    0.5,
  );
  assert.equal(
    missingFullCohortAuditRegistry.validCapacityOutcomeCoverageGate,
    false,
  );
  assert.equal(missingFullCohortAuditRegistry.invalidCapacityOutcomes, 1);
  assert.equal(
    missingFullCohortAuditRegistry
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    18,
  );
  assert.equal(missingFullCohortAuditRegistry.evidenceReadinessGate, false);
  assert.equal(
    missingFullCohortAuditRegistry.familyExpansionPrerequisiteGate,
    false,
  );
  assert.equal(
    missingFullCohortAuditRegistry.familyExpansionStatus,
    "blocked-insufficient-valid-capacity-outcome-coverage",
  );
  assert.equal(missingFullCohortAuditRegistry.familyExpansionAuthority, false);
  assert.equal(
    missingFullCohortAuditRegistry.familyCorrectionStatus,
    "blocked-insufficient-valid-capacity-outcome-coverage",
  );
  assert.equal(missingFullCohortAuditRegistry.nominationGate, false);
  assert.equal(missingFullCohortAuditRegistry.tradingAuthority, false);
  const missingLiquidityFloorAudit =
    buildGeckoTerminalNewPoolDelayedShadowLiquidityFloorAudit(missingAuditEvents);
  assert.equal(missingLiquidityFloorAudit.baselineValidCapacityOutcomes, 0);
  assert.equal(missingLiquidityFloorAudit.variants[0].selectedObservations, 1);
  assert.equal(missingLiquidityFloorAudit.variants[0].validSelectedOutcomes, 0);
  assert.equal(missingLiquidityFloorAudit.variants[0].averageBaseReturnPct, -100);
  assert.equal(missingLiquidityFloorAudit.variants[0].averageStressReturnPct, -100);
  const missingFullCohortLiquidityAudit =
    buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(
      missingAuditEvents,
    );
  assert.equal(missingFullCohortLiquidityAudit.variants[0].selectedObservations, 1);
  assert.equal(missingFullCohortLiquidityAudit.variants[0].validSelectedOutcomes, 0);
  assert.equal(missingFullCohortLiquidityAudit.variants[0].averageBaseReturnPct, -50);
  assert.equal(missingFullCohortLiquidityAudit.variants[0].averageStressReturnPct, -50);
  const missingBuyShareAudit =
    buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit(missingAuditEvents);
  assert.equal(missingBuyShareAudit.baselineValidCapacityOutcomes, 0);
  assert.equal(missingBuyShareAudit.variants[0].selectedObservations, 1);
  assert.equal(missingBuyShareAudit.variants[0].validSelectedOutcomes, 0);
  assert.equal(missingBuyShareAudit.variants[0].averageBaseReturnPct, -100);
  assert.equal(missingBuyShareAudit.variants[0].averageStressReturnPct, -100);
  const missingTransactionCountAudit =
    buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit(
      missingAuditEvents,
    );
  assert.equal(missingTransactionCountAudit.baselineValidCapacityOutcomes, 0);
  assert.equal(missingTransactionCountAudit.variants[0].selectedObservations, 1);
  assert.equal(missingTransactionCountAudit.variants[0].validSelectedOutcomes, 0);
  assert.equal(missingTransactionCountAudit.variants[0].averageBaseReturnPct, -100);
  assert.equal(missingTransactionCountAudit.variants[0].averageStressReturnPct, -100);

  const missedEvents = structuredClone(events);
  const missedOutcome = missedEvents.find((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  ));
  missedOutcome.status = "missed";
  missedOutcome.reason = "delayed-shadow-window-expired";
  missedOutcome.outcomeQuote = null;
  missedOutcome.grossReturnPct = null;
  const missedScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(missedEvents);
  assert.equal(missedScore.candidateOutcomes, 4);
  assert.equal(missedScore.recordedOutcomes, 4);
  assert.equal(missedScore.validCapacityOutcomes, 3);
  assert.equal(missedScore.validCapacityOutcomeCoverageRate, 0.75);
  assert.equal(missedScore.validCapacityOutcomeCoverageGate, false);
  assert.equal(missedScore.coverageDiagnostics.invalidCapacityOutcomes, 1);
  assert.equal(
    missedScore.coverageDiagnostics
      .invalidCapacityOutcomeCounts["delayed-shadow-window-expired"],
    1,
  );
  assert.equal(
    missedScore.coverageDiagnostics.dominantInvalidCapacityOutcomeReason,
    "delayed-shadow-window-expired",
  );
  assert.equal(
    missedScore.coverageDiagnostics
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    16,
  );
  assert.equal(
    missedScore.coverageDiagnostics.invalidCapacityOutcomeReconciliationGate,
    true,
  );
  assert.equal(missedScore.horizons["1h"].validCapacityOutcomes, 1);
  assert.equal(missedScore.horizons["1h"].validCapacityOutcomeCoverageRate, 0.5);
  assert.equal(missedScore.horizons["1h"].validCapacityOutcomeCoverageGate, false);
  assert.equal(
    missedScore.horizons["1h"].coverageDiagnostics
      .minimumAdditionalPerfectValidOutcomesToReachCoverageGate,
    18,
  );
  assert.ok(
    missedScore.horizons["1h"].cashInclusiveAverageBaseReturnPct
      > missedScore.horizons["1h"].missingAsLossAverageBaseReturnPct,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

await assertResolutionResultDiagnostics();
await assertLiveCohortPrecedesExpiredBacklog();

console.log("token-edge GeckoTerminal delayed full-cohort shadow checks passed.");

async function assertResolutionResultDiagnostics() {
  const diagnosticsRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "token-edge-gecko-delayed-shadow-diagnostics-",
  ));
  try {
    const ledgerPath = path.join(diagnosticsRoot, "ledger.jsonl");
    await registerGeckoTerminalNewPoolActivation(
      { ledgerPath },
      { now: new Date("2026-08-04T03:58:30.000Z") },
    );
    await registerGeckoTerminalNewPoolDelayedShadow(
      { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
      { now: new Date("2026-08-04T04:00:01.000Z") },
    );
    const firstBirth = poolRow({
      tokenAddress: "TokenDiagnostics111111111111111111111111111",
      pairAddress: "PoolDiagnostics1111111111111111111111111111",
      poolCreatedAt: "2026-08-04T04:04:00.000Z",
      priceUsd: 0.0001,
      liquidityUsd: 10_000,
    });
    const secondBirth = poolRow({
      tokenAddress: "TokenDiagnostics222222222222222222222222222",
      pairAddress: "PoolDiagnostics2222222222222222222222222222",
      poolCreatedAt: "2026-08-04T04:09:00.000Z",
      priceUsd: 0.0002,
      liquidityUsd: 12_000,
    });
    await watchGeckoTerminalNewPools(
      { ledgerPath },
      {
        now: new Date("2026-08-04T04:05:00.000Z"),
        clock: () => new Date("2026-08-04T04:05:00.000Z"),
        fetcher: fakeProvider({ newPoolRows: [firstBirth] }),
      },
    );
    await watchGeckoTerminalNewPools(
      { ledgerPath },
      {
        now: new Date("2026-08-04T04:10:00.000Z"),
        clock: () => new Date("2026-08-04T04:10:00.000Z"),
        fetcher: fakeProvider({ newPoolRows: [secondBirth] }),
      },
    );
    const bounded = await resolveGeckoTerminalNewPoolDelayedShadows(
      { ledgerPath, horizon: "1h" },
      {
        now: new Date("2026-08-04T05:10:30.000Z"),
        clock: () => new Date("2026-08-04T05:10:31.000Z"),
        fetcher: fakeProvider({
          multiPoolRows: [poolRow({
            tokenAddress: "TokenDiagnostics111111111111111111111111111",
            pairAddress: "PoolDiagnostics1111111111111111111111111111",
            poolCreatedAt: "2026-08-04T04:04:00.000Z",
            priceUsd: 0.00015,
            liquidityUsd: 11_000,
          })],
        }),
      },
    );
    assert.equal(bounded.dueCandidates, 2);
    assert.equal(bounded.recordedOutcomes, 1);
    assert.equal(bounded.deferredDueCandidates, 1);
    assert.equal(bounded.unrecordedSelectedDueCandidates, 0);
    assert.equal(bounded.dueCandidateReconciliationGate, true);
    assert.deepEqual(bounded.missedOutcomeReasonCounts, {});

    const expired = await resolveGeckoTerminalNewPoolDelayedShadows(
      { ledgerPath, horizon: "1h" },
      {
        now: new Date("2026-08-04T05:21:00.000Z"),
        fetcher: async () => {
          throw new Error("expired delayed outcomes must not call the provider");
        },
      },
    );
    assert.equal(expired.dueCandidates, 1);
    assert.equal(expired.recordedOutcomes, 1);
    assert.equal(expired.deferredDueCandidates, 0);
    assert.equal(expired.unrecordedSelectedDueCandidates, 0);
    assert.equal(expired.dueCandidateReconciliationGate, true);
    assert.equal(expired.missedOutcomes, 1);
    assert.deepEqual(expired.missedOutcomeReasonCounts, {
      "delayed-shadow-window-expired": 1,
    });

    const providerFailureBirth = poolRow({
      tokenAddress: "TokenDiagnostics333333333333333333333333333",
      pairAddress: "PoolDiagnostics3333333333333333333333333333",
      poolCreatedAt: "2026-08-04T05:24:00.000Z",
      priceUsd: 0.0003,
      liquidityUsd: 14_000,
    });
    await watchGeckoTerminalNewPools(
      { ledgerPath },
      {
        now: new Date("2026-08-04T05:25:00.000Z"),
        clock: () => new Date("2026-08-04T05:25:00.000Z"),
        fetcher: fakeProvider({ newPoolRows: [providerFailureBirth] }),
      },
    );
    const providerFailure = await resolveGeckoTerminalNewPoolDelayedShadows(
      { ledgerPath, horizon: "1h" },
      {
        now: new Date("2026-08-04T06:25:30.000Z"),
        fetcher: async () => jsonResponse({ error: "unavailable" }, 503),
      },
    );
    assert.equal(providerFailure.dueCandidates, 1);
    assert.equal(providerFailure.recordedOutcomes, 0);
    assert.equal(providerFailure.deferredDueCandidates, 0);
    assert.equal(providerFailure.unrecordedSelectedDueCandidates, 1);
    assert.equal(providerFailure.dueCandidateReconciliationGate, true);
    assert.deepEqual(providerFailure.missedOutcomeReasonCounts, {});
  } finally {
    await rm(diagnosticsRoot, { recursive: true, force: true });
  }
}

async function assertLiveCohortPrecedesExpiredBacklog() {
  const liveFirstRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "token-edge-gecko-delayed-shadow-live-first-",
  ));
  try {
    const ledgerPath = path.join(liveFirstRoot, "ledger.jsonl");
    await registerGeckoTerminalNewPoolActivation(
      { ledgerPath },
      { now: new Date("2026-08-04T03:58:30.000Z") },
    );
    await registerGeckoTerminalNewPoolDelayedShadow(
      { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
      { now: new Date("2026-08-04T04:00:01.000Z") },
    );
    const expiredBirth = poolRow({
      tokenAddress: "TokenExpiredBacklog1111111111111111111111111",
      pairAddress: "PoolExpiredBacklog11111111111111111111111111",
      poolCreatedAt: "2026-08-04T04:04:00.000Z",
      priceUsd: 0.0001,
      liquidityUsd: 10_000,
    });
    const liveBirth = poolRow({
      tokenAddress: "TokenLivePriority111111111111111111111111111",
      pairAddress: "PoolLivePriority1111111111111111111111111111",
      poolCreatedAt: "2026-08-04T04:14:00.000Z",
      priceUsd: 0.0002,
      liquidityUsd: 12_000,
    });
    const expiredDiscovery = await watchGeckoTerminalNewPools(
      { ledgerPath },
      {
        now: new Date("2026-08-04T04:05:00.000Z"),
        clock: () => new Date("2026-08-04T04:05:00.000Z"),
        fetcher: fakeProvider({ newPoolRows: [expiredBirth] }),
      },
    );
    const liveDiscovery = await watchGeckoTerminalNewPools(
      { ledgerPath },
      {
        now: new Date("2026-08-04T04:15:00.000Z"),
        clock: () => new Date("2026-08-04T04:15:00.000Z"),
        fetcher: fakeProvider({ newPoolRows: [liveBirth] }),
      },
    );
    const liveFirst = await resolveGeckoTerminalNewPoolDelayedShadows(
      { ledgerPath, horizon: "1h" },
      {
        now: new Date("2026-08-04T05:15:30.000Z"),
        clock: () => new Date("2026-08-04T05:15:31.000Z"),
        fetcher: fakeProvider({
          multiPoolRows: [poolRow({
            tokenAddress: "TokenLivePriority111111111111111111111111111",
            pairAddress: "PoolLivePriority1111111111111111111111111111",
            poolCreatedAt: "2026-08-04T04:14:00.000Z",
            priceUsd: 0.0003,
            liquidityUsd: 13_000,
          })],
        }),
      },
    );
    assert.equal(liveFirst.dueCandidates, 2);
    assert.equal(liveFirst.recordedOutcomes, 1);
    assert.equal(liveFirst.observedOutcomes, 1);
    assert.equal(liveFirst.missedOutcomes, 0);
    assert.equal(liveFirst.deferredDueCandidates, 1);
    assert.equal(liveFirst.outcomes[0].discoveryEventId, liveDiscovery.discoveryEventId);

    const expiredFallback = await resolveGeckoTerminalNewPoolDelayedShadows(
      { ledgerPath, horizon: "1h" },
      {
        now: new Date("2026-08-04T05:15:32.000Z"),
        fetcher: async () => {
          throw new Error("expired fallback must not call the provider");
        },
      },
    );
    assert.equal(expiredFallback.dueCandidates, 1);
    assert.equal(expiredFallback.recordedOutcomes, 1);
    assert.equal(expiredFallback.observedOutcomes, 0);
    assert.equal(expiredFallback.missedOutcomes, 1);
    assert.equal(expiredFallback.deferredDueCandidates, 0);
    assert.equal(expiredFallback.requestsAttempted, 0);
    assert.equal(
      expiredFallback.outcomes[0].discoveryEventId,
      expiredDiscovery.discoveryEventId,
    );
  } finally {
    await rm(liveFirstRoot, { recursive: true, force: true });
  }
}

function poolRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceUsd,
  liquidityUsd,
  marketCapUsd = 100_000,
  volumeM5Usd = 2_000,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "DELAYED / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: String(priceUsd),
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: String(marketCapUsd),
      price_change_percentage: { m5: "0", h1: "0", h24: "0" },
      volume_usd: { m5: String(volumeM5Usd), h1: "2000", h24: "2000" },
      transactions: {
        m5: { buys: 10, sells: 5 },
        h1: { buys: 10, sells: 5 },
      },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}` } },
      quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112" } },
    },
  };
}

function fakeProvider({ newPoolRows = [], multiPoolRows = [] }) {
  return async (url) => {
    if (url.includes("/new_pools")) return jsonResponse({ data: newPoolRows });
    if (url.includes("/pools/multi/")) return jsonResponse({ data: multiPoolRows });
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}

function auditRow(tokenAddress, createdAt, stressReturnPct) {
  return {
    chain: "solana",
    tokenAddress,
    createdAt,
    stressReturnPct,
  };
}

function assertLeaveOneOutParity(rows) {
  const frameOptions = {
    durationMs: 60 * 60_000,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  };
  const frames = independentAssetFrames(rows, frameOptions);
  const selectedTokens = new Set(frames.flat().map(tokenEdgeAssetKey));
  const expected = Math.min(...[...selectedTokens].map((excludedAssetKey) => {
    const leaveOneOutFrames = independentAssetFrames(rows.filter((row) => (
      tokenEdgeAssetKey(row) !== excludedAssetKey
    )), frameOptions);
    return meanForTest(leaveOneOutFrames.map((frame) => (
      meanForTest(frame.map((row) => row.stressReturnPct))
    )));
  }));
  const actual = delayedAuditWorstLeaveOneTokenOutStressReturnPct(
    rows,
    frames,
    selectedTokens,
  );
  assert.ok(Math.abs(actual - expected) < 1e-12);
}

function meanForTest(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
