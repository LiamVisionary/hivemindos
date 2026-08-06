#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  TOKEN_EDGE_CHALLENGERS,
} from "./token-edge/onchain-forward-core.mjs";
import { rejectedChallengerForecastIds } from "./token-edge/onchain-challenger-scorecard.mjs";
import {
  DEX_EARLY_SURFACE_RULE,
  satisfiesDexEarlySurfaceRule,
} from "./token-edge/onchain-dex-early-rule.mjs";
import { actionableDexEarlySurfaceCandidates } from "./token-edge/onchain-dex-early-surface-discovery.mjs";

const observedAt = new Date("2026-08-03T11:47:00.000Z");
const metrics = {
  sourceTypes: ["boost-latest"],
  sourceBreadth: 1,
  latestBoostAmount: 10,
  totalBoostAmount: 10,
  hasWebsite: false,
  hasTwitter: true,
  pairAgeMinutes: 120,
  discoveryLiquidityUsd: 20_000,
  marketCapUsd: 100_000,
  volumeH1Usd: 12_000,
  hourlyTurnover: 0.6,
  buySellTxnRatio: 1.5,
  priceChange1hPct: 5,
  priceChange24hPct: 20,
};

assert.equal(satisfiesDexEarlySurfaceRule({
  ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  sourceBreadth: metrics.sourceBreadth,
  pairAgeMinutes: metrics.pairAgeMinutes,
  liquidityUsd: metrics.discoveryLiquidityUsd,
  marketCapUsd: metrics.marketCapUsd,
  volumeH1Usd: metrics.volumeH1Usd,
  priceChangeH1Pct: metrics.priceChange1hPct,
  priceChangeH24Pct: metrics.priceChange24hPct,
}), true);

const snapshot = createSnapshotEvent({
  observedAt,
  chain: "solana",
  tokenAddress: "EarlySurfaceToken",
  cohort: "dex-early-surface-test",
  selection: {
    status: "verified",
    provider: "dexscreener-early-surface",
    timeframe: "5m",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    discoveryEventId: "discovery-future",
    confirmationEventId: "confirmation-future",
    discoveryObservedAt: "2026-08-03T11:46:40.000Z",
    discoveryAvailableAt: "2026-08-03T11:46:40.000Z",
    confirmationObservedAt: "2026-08-03T11:46:50.000Z",
    metrics,
  },
  market: {
    source: "dexscreener",
    observedAt: observedAt.toISOString(),
    tokenAddress: "EarlySurfaceToken",
    pairAddress: "EarlySurfacePool",
    pairUrl: "https://dexscreener.com/solana/early",
    dexId: "raydium",
    symbol: "EARLY",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
    fdvUsd: 100_000,
    volumeUsd: { m5: 2_000, h1: 12_000, h6: 20_000, h24: 30_000 },
    priceChangePct: { m5: 1, h1: 5, h6: 10, h24: 20 },
    txns: {
      m5: { buys: 20, sells: 10 },
      h1: { buys: 100, sells: 50 },
      h6: { buys: 200, sells: 100 },
      h24: { buys: 300, sells: 150 },
    },
    pairCreatedAt: observedAt.getTime() - (120 * 60_000),
  },
});
const registrations = createChallengerRegistrationEvents(new Date("2026-08-03T11:46:30.000Z"));
const forecast = createForecastEvents(snapshot, null, registrations).find((row) => (
  row.modelVersion === "frozen-onchain-rank-v11-dex-early-surface"
));
assert.equal(forecast.status, "ready");
assert.equal(forecast.predictedRise, true);
assert.equal(forecast.decision, "paper-long");
assert.equal(forecast.selectionProvider, "dexscreener-early-surface");
assert.equal(forecast.inputEvidence.dexEarlySurfaceMetrics.sourceTypes[0], "boost-latest");
assert.equal(forecast.inputEvidence.provider, "dexscreener-early-surface");
assert.equal(forecast.inputEvidence.discoveryEventId, "discovery-future");

const sixHourForecast = createForecastEvents(snapshot, null, registrations).find((row) => (
  row.modelVersion === "frozen-onchain-rank-v12-dex-early-surface-6h"
));
assert.equal(sixHourForecast.status, "ready");
assert.equal(sixHourForecast.horizon, "6h");
assert.equal(sixHourForecast.predictedRise, true);
const nextDayForecast = createForecastEvents(snapshot, null, registrations).find((row) => (
  row.modelVersion === "frozen-onchain-rank-v13-dex-early-surface-24h"
));
assert.equal(nextDayForecast.status, "ready");
assert.equal(nextDayForecast.horizon, "24h");
assert.equal(nextDayForecast.predictedRise, true);

const baseline = createForecastEvents(snapshot, null, registrations).find((row) => (
  row.modelVersion === "frozen-onchain-rank-v3"
  && row.candidateId === "market-only-control"
  && row.horizon === "1h"
));
const discoveryCandidate = {
  chain: "solana",
  tokenAddress: "EarlySurfaceToken",
  symbol: "EARLY",
  status: "eligible",
  blockers: [],
  sourceTypes: ["boost-latest"],
  sourceBreadth: 1,
  latestSourceTimestamp: null,
  latestBoostAmount: 10,
  totalBoostAmount: 10,
  hasWebsite: false,
  hasTwitter: true,
  pairAddress: "EarlySurfacePool",
  pairAgeMinutes: 120,
  priceUsd: 0.0001,
  liquidityUsd: 20_000,
  marketCapUsd: 100_000,
  volumeH1Usd: 12_000,
  hourlyTurnover: 0.6,
  buysH1: 100,
  sellsH1: 50,
  buySellTxnRatio: 1.5,
  priceChangeH1Pct: 5,
  priceChangeH24Pct: 20,
  ruleVersion: DEX_EARLY_SURFACE_RULE.version,
};
assert.deepEqual(actionableDexEarlySurfaceCandidates([
  discoveryCandidate,
  { ...discoveryCandidate, tokenAddress: "SecondEarlySurfaceToken" },
], [{
  type: "forecast",
  id: "open-v11",
  modelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  candidateId: "dex-early-surface-rise",
  horizon: "1h",
  chain: "solana",
  tokenAddress: discoveryCandidate.tokenAddress,
  status: "ready",
  predictedRise: true,
}]).map((row) => row.tokenAddress), ["SecondEarlySurfaceToken"]);
assert.equal(actionableDexEarlySurfaceCandidates([discoveryCandidate], [{
  type: "forecast",
  id: "resolved-v11",
  modelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  candidateId: "dex-early-surface-rise",
  horizon: "1h",
  chain: "solana",
  tokenAddress: discoveryCandidate.tokenAddress,
  status: "ready",
  predictedRise: true,
}, {
  type: "resolution",
  forecastId: "resolved-v11",
}]).length, 1);
assert.equal(actionableDexEarlySurfaceCandidates([discoveryCandidate], [{
  type: "discovery",
  provider: "dexscreener-early-surface",
  candidates: [structuredClone(discoveryCandidate)],
}]).length, 0);
assert.equal(actionableDexEarlySurfaceCandidates([{
  ...discoveryCandidate,
  totalBoostAmount: discoveryCandidate.totalBoostAmount + 1,
}], [{
  type: "discovery",
  provider: "dexscreener-early-surface",
  candidates: [structuredClone(discoveryCandidate)],
}]).length, 1);
const discovery = {
  type: "discovery",
  id: "discovery-future",
  provider: "dexscreener-early-surface",
  sourceAttribution: "DEX Screener public API",
  chain: "solana",
  timeframe: "5m",
  ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  rule: DEX_EARLY_SURFACE_RULE,
  collectionStartedAt: "2026-08-03T11:46:39.000Z",
  availableAt: "2026-08-03T11:46:40.000Z",
  observedAt: "2026-08-03T11:46:40.000Z",
  candidates: [discoveryCandidate],
  researchOnly: true,
  mutationAllowed: false,
};
const confirmation = {
  type: "market-confirmation",
  id: "confirmation-future",
  observedAt: "2026-08-03T11:46:50.000Z",
  sourceEventId: discovery.id,
  candidates: [{ chain: "solana", tokenAddress: "EarlySurfaceToken", status: "eligible" }],
};
assert.equal(rejectedChallengerForecastIds([
  ...registrations,
  discovery,
  confirmation,
  snapshot,
  baseline,
  forecast,
], TOKEN_EDGE_CHALLENGERS).has(forecast.id), false);
for (const horizonForecast of [sixHourForecast, nextDayForecast]) {
  const baselineHorizon = createForecastEvents(snapshot, null, registrations).find((row) => (
    row.modelVersion === "frozen-onchain-rank-v3"
    && row.candidateId === "market-only-control"
    && row.horizon === horizonForecast.horizon
  ));
  assert.equal(rejectedChallengerForecastIds([
    ...registrations,
    discovery,
    confirmation,
    snapshot,
    baselineHorizon,
    horizonForecast,
  ], TOKEN_EDGE_CHALLENGERS).has(horizonForecast.id), false);
}

const forgedForecast = structuredClone(forecast);
forgedForecast.id = `${forecast.id}-forged`;
forgedForecast.inputEvidence.dexEarlySurfaceMetrics.totalBoostAmount = 999;
assert.equal(rejectedChallengerForecastIds([
  ...registrations,
  discovery,
  confirmation,
  snapshot,
  baseline,
  forgedForecast,
], TOKEN_EDGE_CHALLENGERS).has(forgedForecast.id), true);

const invalid = structuredClone(snapshot);
invalid.id = `${snapshot.id}-invalid`;
invalid.selection.metrics.priceChange1hPct = 30;
const invalidForecast = createForecastEvents(invalid, null, registrations).find((row) => (
  row.modelVersion === "frozen-onchain-rank-v11-dex-early-surface"
));
assert.equal(invalidForecast.status, "blocked");
assert.ok(invalidForecast.blockers.includes("DEX early-surface metrics do not satisfy the frozen rule"));

console.log("token-edge DEX early-surface challenger checks passed.");
