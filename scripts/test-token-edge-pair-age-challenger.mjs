#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  resolutionEvent,
} from "./token-edge/onchain-forward-core.mjs";

const boundary = "2026-08-03T05:30:12.742Z";
const registeredAt = new Date("2026-08-03T05:36:00.000Z");
const snapshotAt = new Date("2026-08-03T05:40:00.000Z");
const registration = createChallengerRegistrationEvents(registeredAt).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v7-pair-age-window"
));

assert.ok(registration);
assert.equal(registration.changedDimension, "pairAgeHoursWindow");
assert.equal(registration.minimumPairAgeHoursInclusive, 2);
assert.equal(registration.maximumPairAgeHoursExclusive, 24);
assert.equal(registration.evidenceBoundary, boundary);
assert.equal(registration.posthocDerivation.eligibleObservedForecasts, 3);
assert.equal(registration.posthocDerivation.parallel24hSelectionNetReturnPct, -7.144928);

const discovery = {
  type: "discovery",
  id: "discovery-v7-pair-age",
  observedAt: "2026-08-03T05:37:00.000Z",
  provider: "nansen-token-screener",
  timeframe: "6h",
  candidates: [],
};
const inside = selectedFixture("PairAgeInside111111111111111111111111111111", 2, discovery);
const outside = selectedFixture("PairAgeOutside11111111111111111111111111111", 24, discovery);
discovery.candidates = [inside, outside].map(({ snapshot }) => ({
  chain: snapshot.chain,
  tokenAddress: snapshot.tokenAddress,
  status: "eligible",
}));

const insideForecasts = createForecastEvents(inside.snapshot, null, [registration]);
const outsideForecasts = createForecastEvents(outside.snapshot, null, [registration]);
assert.equal(insideForecasts.length, 28);
assert.equal(outsideForecasts.length, 28);

const insideParent = parentForecast(insideForecasts);
const outsideParent = parentForecast(outsideForecasts);
const insideV7 = v7Forecast(insideForecasts);
const outsideV7 = v7Forecast(outsideForecasts);

assert.equal(insideParent.predictedRise, true);
assert.equal(insideV7.status, "ready");
assert.equal(insideV7.pairAgeHours, 2);
assert.equal(insideV7.predictedRise, true);
assert.equal(insideV7.decision, "paper-long");
assert.equal(insideV7.predictedReturnPct, 6.4);
assert.equal(outsideV7.status, "ready");
assert.equal(outsideV7.pairAgeHours, 24);
assert.equal(outsideV7.predictedRise, false);
assert.equal(outsideV7.decision, "paper-cash");
assert.equal(outsideV7.predictedReturnPct, 0);
assert.equal(insideV7.challengerRegistrationId, registration.id);
assert.equal(insideV7.challengerRegisteredAt, registration.registeredAt);

const missingRegistration = v7Forecast(createForecastEvents(inside.snapshot, null));
assert.equal(missingRegistration.status, "blocked");
assert.ok(missingRegistration.blockers.includes("challenger registration is missing"));

const preRegistrationLineage = selectedFixture(
  "PairAgePreRegistration1111111111111111111111111",
  5,
  { ...discovery, id: "discovery-v7-before-registration", observedAt: "2026-08-03T05:35:00.000Z" },
  { confirmationObservedAt: "2026-08-03T05:37:00.000Z" },
);
const preRegistrationV7 = v7Forecast(createForecastEvents(
  preRegistrationLineage.snapshot,
  null,
  [registration],
));
assert.equal(preRegistrationV7.status, "blocked");
assert.ok(preRegistrationV7.blockers.includes(
  "selection lineage is not strictly after the challenger registration",
));

const wrongTimeframe = selectedFixture(
  "PairAgeWrongTimeframe111111111111111111111111111",
  5,
  { ...discovery, id: "discovery-v7-24h", timeframe: "24h" },
  { timeframe: "24h" },
);
const wrongTimeframeV7 = v7Forecast(createForecastEvents(wrongTimeframe.snapshot, null, [registration]));
assert.equal(wrongTimeframeV7.status, "blocked");
assert.ok(wrongTimeframeV7.blockers.includes("selection timeframe is not 6h"));

const scorecardEvents = [
  registration,
  discovery,
  inside.confirmation,
  outside.confirmation,
  inside.snapshot,
  outside.snapshot,
  insideParent,
  outsideParent,
  insideV7,
  outsideV7,
  resolutionEvent(insideParent, inside.snapshot, 0.012, new Date(insideParent.dueAt)),
  resolutionEvent(outsideParent, outside.snapshot, 0.012, new Date(outsideParent.dueAt)),
  resolutionEvent(insideV7, inside.snapshot, 0.012, new Date(insideV7.dueAt)),
  resolutionEvent(outsideV7, outside.snapshot, 0.012, new Date(outsideV7.dueAt)),
];
const comparison = buildScorecard(scorecardEvents).challengerComparisons.find((row) => (
  row.challengerModelVersion === registration.modelVersion
));
assert.equal(comparison.matchedForecasts, 2);
assert.equal(comparison.independentPairedFrames, 1);
assert.equal(comparison.uniqueTokens, 2);
assert.equal(comparison.outcomeMismatchCount, 0);
assert.equal(comparison.baselineAverageNetReturnPct, 16);
assert.equal(comparison.challengerAverageNetReturnPct, 8);
assert.equal(comparison.averagePairedDeltaPct, -8);

const forgedAge = {
  ...insideV7,
  pairAgeHours: 1,
};
const forgedAgeComparison = buildScorecard([
  registration,
  discovery,
  inside.confirmation,
  inside.snapshot,
  insideParent,
  forgedAge,
  resolutionEvent(insideParent, inside.snapshot, 0.012, new Date(insideParent.dueAt)),
  resolutionEvent(forgedAge, inside.snapshot, 0.012, new Date(forgedAge.dueAt)),
]).challengerComparisons.find((row) => row.challengerModelVersion === registration.modelVersion);
assert.equal(forgedAgeComparison.matchedForecasts, 0);
assert.equal(forgedAgeComparison.lineageRejectedForecasts, 1);

const forgedDecision = {
  ...outsideV7,
  predictedRise: true,
  decision: "paper-long",
  score: 0.7,
  predictedRiseProbability: 0.6,
  predictedReturnPct: 6.4,
};
const forgedDecisionComparison = buildScorecard([
  registration,
  discovery,
  outside.confirmation,
  outside.snapshot,
  outsideParent,
  forgedDecision,
  resolutionEvent(outsideParent, outside.snapshot, 0.012, new Date(outsideParent.dueAt)),
  resolutionEvent(forgedDecision, outside.snapshot, 0.012, new Date(forgedDecision.dueAt)),
]).challengerComparisons.find((row) => row.challengerModelVersion === registration.modelVersion);
assert.equal(forgedDecisionComparison.matchedForecasts, 0);
assert.equal(forgedDecisionComparison.lineageRejectedForecasts, 1);

console.log("token-edge pair-age challenger checks passed.");

function selectedFixture(tokenAddress, pairAgeHours, sourceDiscovery, overrides = {}) {
  const timeframe = overrides.timeframe ?? sourceDiscovery.timeframe;
  const confirmationObservedAt = overrides.confirmationObservedAt ?? "2026-08-03T05:38:00.000Z";
  const confirmationId = `confirmation-${tokenAddress}`;
  const selection = {
    status: "verified",
    provider: "nansen-token-screener",
    timeframe,
    discoveryEventId: sourceDiscovery.id,
    confirmationEventId: confirmationId,
    discoveryObservedAt: sourceDiscovery.observedAt,
    confirmationObservedAt,
    metrics: {
      netflowUsd: 2_000,
      netflowToLiquidity: 0.05,
      buySellVolumeRatio: 1.5,
      priceChangePct: 0,
      confirmedLiquidityUsd: 40_000,
    },
  };
  const snapshot = createSnapshotEvent({
    observedAt: snapshotAt,
    chain: "solana",
    tokenAddress,
    cohort: "pair-age-v7-test",
    market: {
      source: "dexscreener",
      observedAt: snapshotAt.toISOString(),
      tokenAddress,
      pairAddress: `pool-${tokenAddress}`,
      symbol: "AGE",
      priceUsd: 0.01,
      liquidityUsd: 40_000,
      marketCapUsd: 500_000,
      fdvUsd: 500_000,
      volumeUsd: { m5: 1_000, h1: 20_000, h6: 60_000, h24: 100_000 },
      priceChangePct: { m5: 1, h1: 5, h6: 8, h24: 15 },
      txns: {
        m5: { buys: 10, sells: 5 },
        h1: { buys: 90, sells: 30 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      pairCreatedAt: snapshotAt.getTime() - pairAgeHours * 60 * 60_000,
    },
    selection,
  });
  return {
    snapshot,
    confirmation: {
      type: "market-confirmation",
      id: confirmationId,
      observedAt: confirmationObservedAt,
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

function v7Forecast(forecasts) {
  return forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v7-pair-age-window"
  ));
}
