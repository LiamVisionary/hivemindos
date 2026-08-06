#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  resolutionEvent,
} from "./token-edge/onchain-forward-core.mjs";

const registration = createChallengerRegistrationEvents(
  new Date("2026-08-03T13:18:10.000Z"),
).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v14-dex-positive-momentum-gate"
));
assert.ok(registration);
assert.equal(registration.changedDimension, "positiveDexHourlyMomentum");
assert.equal(registration.minimumDexHourlyPriceChangePctExclusive, 0);
assert.equal(registration.evidenceBoundary, "2026-08-03T13:18:00.000Z");
assert.equal(registration.posthocDerivation.thresholdVariantsTested, 1);
assert.equal(registration.posthocDerivation.latestExcludedFalsePositiveGrossReturnPct, -36.149284);

const discovery = {
  type: "discovery",
  id: "discovery-v14-positive-momentum",
  observedAt: "2026-08-03T13:18:20.000Z",
  provider: "nansen-token-screener",
  timeframe: "6h",
  candidates: [],
};
const positive = selectedFixture("PositiveMomentumMint111", 5, discovery);
const nonpositive = selectedFixture("NonpositiveMomentumMint111", -5, discovery);
discovery.candidates = [positive, nonpositive].map(({ snapshot }) => ({
  chain: snapshot.chain,
  tokenAddress: snapshot.tokenAddress,
  status: "eligible",
}));

const positiveForecasts = createForecastEvents(positive.snapshot, null, [registration]);
const nonpositiveForecasts = createForecastEvents(nonpositive.snapshot, null, [registration]);
assert.equal(positiveForecasts.length, 28);
assert.equal(nonpositiveForecasts.length, 28);
const positiveParent = parentForecast(positiveForecasts);
const nonpositiveParent = parentForecast(nonpositiveForecasts);
const positiveV14 = momentumForecast(positiveForecasts);
const nonpositiveV14 = momentumForecast(nonpositiveForecasts);
assert.equal(positiveParent.predictedRise, true);
assert.equal(positiveV14.status, "ready");
assert.equal(positiveV14.dexHourlyPriceChangePct, 5);
assert.equal(positiveV14.predictedRise, true);
assert.equal(positiveV14.decision, "paper-long");
assert.equal(nonpositiveV14.status, "ready");
assert.equal(nonpositiveV14.dexHourlyPriceChangePct, -5);
assert.equal(nonpositiveV14.predictedRise, false);
assert.equal(nonpositiveV14.decision, "paper-cash");
assert.equal(positiveV14.inputEvidence.dexHourlyPriceChangePct, 5);
assert.equal(positiveV14.inputEvidence.minimumDexHourlyPriceChangePctExclusive, 0);
assert.equal(positiveV14.challengerRegistrationId, registration.id);

const missingRegistration = momentumForecast(createForecastEvents(positive.snapshot, null));
assert.equal(missingRegistration.status, "blocked");
assert.ok(missingRegistration.blockers.includes("challenger registration is missing"));

const missingMomentum = selectedFixture("MissingMomentumMint111", null, discovery);
const missingForecast = momentumForecast(createForecastEvents(
  missingMomentum.snapshot, null, [registration],
));
assert.equal(missingForecast.status, "blocked");
assert.ok(missingForecast.blockers.includes("DEX one-hour price momentum is unavailable"));

const scorecardEvents = [
  registration,
  discovery,
  positive.confirmation,
  nonpositive.confirmation,
  positive.snapshot,
  nonpositive.snapshot,
  positiveParent,
  nonpositiveParent,
  positiveV14,
  nonpositiveV14,
  resolutionEvent(positiveParent, positive.snapshot, 0.012, new Date(positiveParent.dueAt)),
  resolutionEvent(nonpositiveParent, nonpositive.snapshot, 0.012, new Date(nonpositiveParent.dueAt)),
  resolutionEvent(positiveV14, positive.snapshot, 0.012, new Date(positiveV14.dueAt)),
  resolutionEvent(nonpositiveV14, nonpositive.snapshot, 0.012, new Date(nonpositiveV14.dueAt)),
];
const comparison = v14Comparison(scorecardEvents);
assert.equal(comparison.matchedForecasts, 2);
assert.equal(comparison.independentPairedFrames, 1);
assert.equal(comparison.uniqueTokens, 2);
assert.equal(comparison.outcomeMismatchCount, 0);
assert.equal(comparison.baselineAverageNetReturnPct, 16);
assert.equal(comparison.challengerAverageNetReturnPct, 8);
assert.equal(comparison.averagePairedDeltaPct, -8);

const forgedInput = {
  ...positiveV14,
  inputEvidence: { ...positiveV14.inputEvidence, dexHourlyPriceChangePct: 4 },
};
assert.equal(v14Comparison([
  registration,
  discovery,
  positive.confirmation,
  positive.snapshot,
  positiveParent,
  forgedInput,
  resolutionEvent(positiveParent, positive.snapshot, 0.012, new Date(positiveParent.dueAt)),
  resolutionEvent(forgedInput, positive.snapshot, 0.012, new Date(forgedInput.dueAt)),
]).matchedForecasts, 0);

const forgedDecision = {
  ...nonpositiveV14,
  predictedRise: true,
  decision: "paper-long",
  score: 0.7,
  predictedRiseProbability: 0.6,
  predictedReturnPct: 6.4,
};
assert.equal(v14Comparison([
  registration,
  discovery,
  nonpositive.confirmation,
  nonpositive.snapshot,
  nonpositiveParent,
  forgedDecision,
  resolutionEvent(nonpositiveParent, nonpositive.snapshot, 0.012, new Date(nonpositiveParent.dueAt)),
  resolutionEvent(forgedDecision, nonpositive.snapshot, 0.012, new Date(forgedDecision.dueAt)),
]).matchedForecasts, 0);

console.log("token-edge positive-momentum challenger checks passed.");

function selectedFixture(tokenAddress, hourlyPriceChangePct, sourceDiscovery) {
  const confirmationId = `confirmation-${tokenAddress}`;
  const observedAt = new Date("2026-08-03T13:18:40.000Z");
  const snapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    cohort: "positive-momentum-v14-test",
    market: {
      source: "dexscreener",
      observedAt: observedAt.toISOString(),
      tokenAddress,
      pairAddress: `pool-${tokenAddress}`,
      symbol: "MOM",
      priceUsd: 0.01,
      liquidityUsd: 40_000,
      marketCapUsd: 500_000,
      fdvUsd: 500_000,
      volumeUsd: { m5: 1_000, h1: 25_000, h6: 60_000, h24: 100_000 },
      priceChangePct: { m5: 1, h1: hourlyPriceChangePct, h6: 8, h24: 15 },
      txns: {
        m5: { buys: 10, sells: 5 },
        h1: { buys: 90, sells: 30 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      pairCreatedAt: observedAt.getTime() - 10 * 60 * 60_000,
    },
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: sourceDiscovery.id,
      confirmationEventId: confirmationId,
      discoveryObservedAt: sourceDiscovery.observedAt,
      confirmationObservedAt: "2026-08-03T13:18:30.000Z",
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
      observedAt: "2026-08-03T13:18:30.000Z",
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

function momentumForecast(forecasts) {
  return forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v14-dex-positive-momentum-gate"
  ));
}

function v14Comparison(events) {
  return buildScorecard(events).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v14-dex-positive-momentum-gate"
  ));
}
