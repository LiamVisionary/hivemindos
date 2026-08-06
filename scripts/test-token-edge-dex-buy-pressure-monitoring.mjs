#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
  createExecutionPolicyRegistrationEvents,
} from "./token-edge/onchain-capacity-scorecard.mjs";
import {
  DEX_BUY_PRESSURE_MONITORING_RULE,
  buildDexBuyPressureMonitoringScorecard,
} from "./token-edge/onchain-dex-buy-pressure-monitoring-scorecard.mjs";

const registration = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T10:45:30.100Z"),
)[0];
const alpha = opportunity({
  createdAt: "2026-08-03T11:00:00.000Z",
  tokenAddress: "Alpha111111111111111111111111111111111",
  symbol: "ALPHA",
  grossReturnPct: 20,
  confirmed: true,
  registration,
});
const beta = opportunity({
  createdAt: "2026-08-03T11:05:00.000Z",
  tokenAddress: "Beta1111111111111111111111111111111111",
  symbol: "BETA",
  grossReturnPct: -10,
  confirmed: false,
  registration,
});
const overlappingAlpha = opportunity({
  createdAt: "2026-08-03T11:30:00.000Z",
  tokenAddress: alpha.forecast.tokenAddress,
  symbol: "ALPHA",
  grossReturnPct: 100,
  confirmed: true,
  registration,
  suffix: "overlap",
});
const gamma = opportunity({
  createdAt: "2026-08-03T12:00:00.000Z",
  tokenAddress: "Gamma111111111111111111111111111111111",
  symbol: "GAMMA",
  grossReturnPct: 5,
  confirmed: true,
  registration,
});
const preBoundary = opportunity({
  createdAt: "2026-08-03T10:45:30.000Z",
  tokenAddress: "Before11111111111111111111111111111111",
  symbol: "BEFORE",
  grossReturnPct: 500,
  confirmed: true,
  registration,
});
const open = opportunity({
  createdAt: "2026-08-03T13:00:00.000Z",
  tokenAddress: "Open1111111111111111111111111111111111",
  symbol: "OPEN",
  grossReturnPct: 50,
  confirmed: true,
  registration,
});
const late = opportunity({
  createdAt: "2026-08-03T14:00:00.000Z",
  tokenAddress: "Late1111111111111111111111111111111111",
  symbol: "LATE",
  grossReturnPct: 50,
  confirmed: true,
  registration,
  outcomeLagMs: 6 * 60_000,
});

const scorecard = buildDexBuyPressureMonitoringScorecard([
  registration,
  ...events(alpha),
  ...events(beta),
  ...events(overlappingAlpha),
  ...events(gamma),
  ...events(preBoundary),
  open.snapshot,
  open.forecast,
  ...events(late),
]);

assert.equal(scorecard.ruleVersion, "nansen-selected-dex-buy-pressure-monitoring-v1");
assert.equal(scorecard.evidenceBoundary, DEX_BUY_PRESSURE_MONITORING_RULE.evidenceBoundary);
assert.equal(scorecard.researchOnly, true);
assert.equal(scorecard.mutationAllowed, false);
assert.equal(scorecard.candidateForecasts, 6);
assert.equal(scorecard.openForecasts, 1);
assert.equal(scorecard.eligibleLiveObservations, 4);
assert.equal(scorecard.portfolioWeightedObservations, 3);
assert.equal(scorecard.sameAssetOverlappingObservations, 1);
assert.equal(scorecard.independentHourlyFrames, 2);
assert.equal(scorecard.uniqueTokens, 3);
assert.equal(scorecard.rejectionCounts["live-resolution-horizon-drift"], 1);

const confirmed = scorecard.buyPressureConfirmation;
assert.equal(confirmed.observations, 2);
assert.equal(confirmed.independentFrames, 2);
assert.equal(confirmed.independentTradedFrames, 2);
assert.equal(confirmed.uniqueTokens, 2);
assert.equal(confirmed.riseRate, 1);
assert.equal(confirmed.netWinRate, 1);
assert.equal(confirmed.largestWinningFrameShare > 0.5, true);
const alphaBase = capacityReturn(20, 4);
const betaBase = capacityReturn(-10, 4);
const gammaBase = capacityReturn(5, 4);
const expectedParent = (((alphaBase + betaBase) / 2) + gammaBase) / 2;
const expectedChallenger = ((alphaBase / 2) + gammaBase) / 2;
assert.equal(confirmed.parentAverageCapacityReturnPct, round(expectedParent));
assert.equal(confirmed.challengerAverageCapacityReturnPct, round(expectedChallenger));
assert.equal(confirmed.pairedCapacityDeltaPct, round(expectedChallenger - expectedParent));
const strict = scorecard.buyPressureWithTurnoverConfirmation;
assert.equal(strict.observations, 2);
assert.equal(strict.independentTradedFrames, 2);
assert.equal(strict.uniqueTokens, 2);
assert.equal(strict.netWinRate, 1);
assert.equal(scorecard.derivationDebt.promotionalUseAllowed, false);

const missing = opportunity({
  createdAt: "2026-08-03T15:00:00.000Z",
  tokenAddress: "Missing11111111111111111111111111111111",
  symbol: "MISSING",
  grossReturnPct: 20,
  confirmed: true,
  registration,
});
missing.snapshot.market.txns.h1.buys = null;
missing.snapshot.market.priceChangePct.h1 = null;
missing.snapshot.market.volumeUsd.h1 = null;
const missingScore = buildDexBuyPressureMonitoringScorecard([
  registration,
  ...events(missing),
]);
assert.equal(missingScore.buyPressureConfirmation.observations, 0);
assert.equal(missingScore.buyPressureWithTurnoverConfirmation.observations, 0);

const forgedPair = opportunity({
  createdAt: "2026-08-03T16:00:00.000Z",
  tokenAddress: "Forged111111111111111111111111111111111",
  symbol: "FORGED",
  grossReturnPct: 20,
  confirmed: true,
  registration,
});
forgedPair.outcome.executionEvidence.exitPairAddress = "wrong-pair";
const forgedScore = buildDexBuyPressureMonitoringScorecard([
  registration,
  ...events(forgedPair),
]);
assert.equal(forgedScore.eligibleLiveObservations, 0);
assert.equal(forgedScore.rejectionCounts["invalid-capacity-evidence"], 1);

console.log("token-edge DEX buy-pressure monitoring checks passed.");

function opportunity(input) {
  const suffix = input.suffix ?? input.symbol.toLowerCase();
  const createdAtMs = Date.parse(input.createdAt);
  const dueAt = new Date(createdAtMs + 60 * 60_000).toISOString();
  const observedAt = new Date(Date.parse(dueAt) + (input.outcomeLagMs ?? 60_000)).toISOString();
  const pairAddress = `pair-${suffix}`;
  const snapshot = {
    type: "snapshot",
    id: `snapshot-${suffix}`,
    observedAt: input.createdAt,
    chain: "solana",
    tokenAddress: input.tokenAddress,
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: `discovery-${suffix}`,
      confirmationEventId: `confirmation-${suffix}`,
    },
    market: {
      observedAt: input.createdAt,
      pairAddress,
      liquidityUsd: 100_000,
      txns: {
        h1: input.confirmed
          ? { buys: 12, sells: 10 }
          : { buys: 9, sells: 10 },
      },
      priceChangePct: { h1: input.confirmed ? 2 : -2 },
      volumeUsd: { h1: 60_000 },
    },
  };
  const forecast = {
    type: "forecast",
    id: `forecast-${suffix}`,
    snapshotId: snapshot.id,
    createdAt: input.createdAt,
    dueAt,
    chain: snapshot.chain,
    tokenAddress: snapshot.tokenAddress,
    symbol: input.symbol,
    modelVersion: "frozen-onchain-rank-v3",
    candidateId: "smart-money-selection",
    horizon: "1h",
    status: "ready",
    predictedRise: true,
    selectionProvider: snapshot.selection.provider,
    selectionTimeframe: snapshot.selection.timeframe,
    selectionDiscoveryEventId: snapshot.selection.discoveryEventId,
    selectionConfirmationEventId: snapshot.selection.confirmationEventId,
    roundTripCostPct: 4,
    executionPolicyRegistrationId: input.registration.id,
    executionPolicyRegisteredAt: input.registration.registeredAt,
    executionPolicyVersion: input.registration.policyVersion,
  };
  const outcome = {
    type: "resolution",
    id: `resolution-${suffix}`,
    forecastId: forecast.id,
    snapshotId: snapshot.id,
    horizon: "1h",
    dueAt,
    observedAt,
    status: "observed",
    observationMode: "live-point-in-time",
    grossReturnPct: input.grossReturnPct,
    executionEvidence: {
      entryMarketObservedAt: snapshot.market.observedAt,
      entryPairAddress: pairAddress,
      entryLiquidityUsd: 100_000,
      exitMarketObservedAt: observedAt,
      exitPairAddress: pairAddress,
      exitLiquidityUsd: 100_000,
    },
  };
  return { snapshot, forecast, outcome };
}

function events(value) {
  return [value.snapshot, value.forecast, value.outcome];
}

function capacityReturn(grossReturnPct, roundTripCostPct) {
  return capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd: 100_000,
    exitLiquidityUsd: 100_000,
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    roundTripCostPct,
  });
}

function round(value) {
  return Number(value.toFixed(6));
}
