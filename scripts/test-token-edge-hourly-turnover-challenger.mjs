#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  resolutionEvent,
} from "./token-edge/onchain-forward-core.mjs";

const registeredAt = new Date("2026-08-03T09:11:00.000Z");
const snapshotAt = new Date("2026-08-03T09:14:00.000Z");
const registration = createChallengerRegistrationEvents(registeredAt).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v9-hourly-turnover-gate"
));

assert.ok(registration);
assert.equal(registration.changedDimension, "minimumHourlyVolumeToLiquidity");
assert.equal(registration.minimumHourlyVolumeToLiquidityInclusive, 0.5);
assert.equal(registration.evidenceBoundary, "2026-08-03T09:09:51.511Z");
assert.equal(registration.posthocDerivation.testedOneDimensionalVariants, 160);
assert.equal(registration.posthocDerivation.selectedGateBaseCostFrameMeanPct, 1.182082);
assert.equal(registration.posthocDerivation.selectedGateStressCostFrameMeanPct, -1.964584);

const discovery = {
  type: "discovery",
  id: "discovery-v9-hourly-turnover",
  observedAt: "2026-08-03T09:12:00.000Z",
  provider: "nansen-token-screener",
  timeframe: "6h",
  candidates: [],
};
const passing = selectedFixture("TurnoverPass1111111111111111111111111111111", 25_000, discovery);
const failing = selectedFixture("TurnoverFail1111111111111111111111111111111", 10_000, discovery);
discovery.candidates = [passing, failing].map(({ snapshot }) => ({
  chain: snapshot.chain,
  tokenAddress: snapshot.tokenAddress,
  status: "eligible",
}));

const passingForecasts = createForecastEvents(passing.snapshot, null, [registration]);
const failingForecasts = createForecastEvents(failing.snapshot, null, [registration]);
assert.equal(passingForecasts.length, 28);
assert.equal(failingForecasts.length, 28);

const passingParent = parentForecast(passingForecasts);
const failingParent = parentForecast(failingForecasts);
const passingV9 = v9Forecast(passingForecasts);
const failingV9 = v9Forecast(failingForecasts);
assert.equal(passingParent.predictedRise, true);
assert.equal(passingV9.status, "ready");
assert.equal(passingV9.hourlyVolumeToLiquidity, 0.625);
assert.equal(passingV9.predictedRise, true);
assert.equal(passingV9.decision, "paper-long");
assert.equal(failingV9.status, "ready");
assert.equal(failingV9.hourlyVolumeToLiquidity, 0.25);
assert.equal(failingV9.predictedRise, false);
assert.equal(failingV9.decision, "paper-cash");
assert.equal(passingV9.inputEvidence.hourlyVolumeUsd, 25_000);
assert.equal(passingV9.inputEvidence.currentLiquidityUsd, 40_000);
assert.equal(passingV9.challengerRegistrationId, registration.id);

const missingRegistration = v9Forecast(createForecastEvents(passing.snapshot, null));
assert.equal(missingRegistration.status, "blocked");
assert.ok(missingRegistration.blockers.includes("challenger registration is missing"));

const missingVolume = selectedFixture(
  "TurnoverMissing11111111111111111111111111111",
  null,
  discovery,
);
const missingVolumeV9 = v9Forecast(createForecastEvents(missingVolume.snapshot, null, [registration]));
assert.equal(missingVolumeV9.status, "blocked");
assert.ok(missingVolumeV9.blockers.includes("hourly volume-to-liquidity is unavailable"));

const scorecardEvents = [
  registration,
  discovery,
  passing.confirmation,
  failing.confirmation,
  passing.snapshot,
  failing.snapshot,
  passingParent,
  failingParent,
  passingV9,
  failingV9,
  resolutionEvent(passingParent, passing.snapshot, 0.012, new Date(passingParent.dueAt)),
  resolutionEvent(failingParent, failing.snapshot, 0.012, new Date(failingParent.dueAt)),
  resolutionEvent(passingV9, passing.snapshot, 0.012, new Date(passingV9.dueAt)),
  resolutionEvent(failingV9, failing.snapshot, 0.012, new Date(failingV9.dueAt)),
];
const comparison = v9Comparison(scorecardEvents);
assert.equal(comparison.matchedForecasts, 2);
assert.equal(comparison.independentPairedFrames, 1);
assert.equal(comparison.uniqueTokens, 2);
assert.equal(comparison.outcomeMismatchCount, 0);
assert.equal(comparison.baselineAverageNetReturnPct, 16);
assert.equal(comparison.challengerAverageNetReturnPct, 8);
assert.equal(comparison.averagePairedDeltaPct, -8);

const forgedRatio = {
  ...passingV9,
  hourlyVolumeToLiquidity: 0.4,
};
const forgedComparison = v9Comparison([
  registration,
  discovery,
  passing.confirmation,
  passing.snapshot,
  passingParent,
  forgedRatio,
  resolutionEvent(passingParent, passing.snapshot, 0.012, new Date(passingParent.dueAt)),
  resolutionEvent(forgedRatio, passing.snapshot, 0.012, new Date(forgedRatio.dueAt)),
]);
assert.equal(forgedComparison.matchedForecasts, 0);
assert.equal(forgedComparison.lineageRejectedForecasts, 1);

const forgedDecision = {
  ...failingV9,
  predictedRise: true,
  decision: "paper-long",
  score: 0.7,
  predictedRiseProbability: 0.6,
  predictedReturnPct: 6.4,
};
assert.equal(v9Comparison([
  registration,
  discovery,
  failing.confirmation,
  failing.snapshot,
  failingParent,
  forgedDecision,
  resolutionEvent(failingParent, failing.snapshot, 0.012, new Date(failingParent.dueAt)),
  resolutionEvent(forgedDecision, failing.snapshot, 0.012, new Date(forgedDecision.dueAt)),
]).matchedForecasts, 0);

console.log("token-edge hourly-turnover challenger checks passed.");

function selectedFixture(tokenAddress, hourlyVolumeUsd, sourceDiscovery) {
  const confirmationId = `confirmation-${tokenAddress}`;
  const snapshot = createSnapshotEvent({
    observedAt: snapshotAt,
    chain: "solana",
    tokenAddress,
    cohort: "hourly-turnover-v9-test",
    market: {
      source: "dexscreener",
      observedAt: snapshotAt.toISOString(),
      tokenAddress,
      pairAddress: `pool-${tokenAddress}`,
      symbol: "TURN",
      priceUsd: 0.01,
      liquidityUsd: 40_000,
      marketCapUsd: 500_000,
      fdvUsd: 500_000,
      volumeUsd: { m5: 1_000, h1: hourlyVolumeUsd, h6: 60_000, h24: 100_000 },
      priceChangePct: { m5: 1, h1: 5, h6: 8, h24: 15 },
      txns: {
        m5: { buys: 10, sells: 5 },
        h1: { buys: 90, sells: 30 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      pairCreatedAt: snapshotAt.getTime() - 10 * 60 * 60_000,
    },
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: sourceDiscovery.id,
      confirmationEventId: confirmationId,
      discoveryObservedAt: sourceDiscovery.observedAt,
      confirmationObservedAt: "2026-08-03T09:13:00.000Z",
      metrics: {
        netflowUsd: 2_000,
        netflowToLiquidity: 0.05,
        buySellVolumeRatio: 1.5,
        priceChangePct: 0,
        confirmedLiquidityUsd: 40_000,
      },
    },
  });
  return {
    snapshot,
    confirmation: {
      type: "market-confirmation",
      id: confirmationId,
      observedAt: "2026-08-03T09:13:00.000Z",
      sourceEventId: sourceDiscovery.id,
      candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
    },
  };
}

function parentForecast(forecasts) {
  return forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "smart-money-selection"
    && forecast.horizon === "1h"
  ));
}

function v9Forecast(forecasts) {
  return forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v9-hourly-turnover-gate"
  ));
}

function v9Comparison(events) {
  return buildScorecard(events).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v9-hourly-turnover-gate"
  ));
}
