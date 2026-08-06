#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  resolutionEvent,
} from "./token-edge/onchain-forward-core.mjs";
import { LUNARCRUSH_SOLANA_DISCOVERY_RULE } from "./token-edge/onchain-lunarcrush-provider.mjs";

const tokenAddress = "SocialMagnitude11111111111111111111111111111";
const registeredAt = new Date("2026-08-03T09:50:00.000Z");
const snapshotAt = new Date("2026-08-03T09:53:00.000Z");
const registration = createChallengerRegistrationEvents(registeredAt).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v10-social-magnitude-direction"
));
assert.ok(registration);
assert.equal(registration.changedDimension, "lunarcrushDiscoveryMagnitudeGate");
assert.equal(registration.posthocDerivation.largeCapProspectiveFrames, 49);
assert.deepEqual(
  registration.posthocDerivation.cleanSocialPairedBootstrapCi95Pct,
  [0.02018, 0.152478],
);

const nansenDiscovery = {
  type: "discovery",
  id: "nansen-discovery-v10",
  observedAt: "2026-08-03T09:50:30.000Z",
  provider: "nansen-token-screener",
  timeframe: "6h",
  candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
};
const confirmation = {
  type: "market-confirmation",
  id: "nansen-confirmation-v10",
  observedAt: "2026-08-03T09:51:00.000Z",
  sourceEventId: nansenDiscovery.id,
  candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
};
const candidate = {
  chain: "solana",
  tokenAddress,
  symbol: "MAG",
  lunarcrushCoinId: 7,
  marketCapUsd: 500_000,
  volume24hUsd: 100_000,
  interactions24h: 2_000,
  socialVolume24h: 50,
  altRank: 50,
  altRankPrevious: 1_100,
  altRankImprovement: 1_050,
  galaxyScore: 65,
  galaxyScorePrevious: 50,
  galaxyScoreImprovement: 15,
  priceChange1hPct: 2,
  priceChange24hPct: 10,
  status: "eligible",
  ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
};
const socialDiscovery = {
  type: "discovery",
  id: "lunar-discovery-v10",
  observedAt: "2026-08-03T09:52:00.000Z",
  availableAt: "2026-08-03T09:52:00.000Z",
  collectionStartedAt: "2026-08-03T09:51:30.000Z",
  provider: "lunarcrush-coin-list",
  sourceProvider: "lunarcrush",
  chain: "solana",
  timeframe: "1h",
  ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
  rule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
  universe: { complete: true, generatedAt: null },
  candidates: [candidate],
  researchOnly: true,
  mutationAllowed: false,
  digest: "fixture-lunar-discovery-v10",
};
const snapshot = createSnapshotEvent({
  observedAt: snapshotAt,
  chain: "solana",
  tokenAddress,
  cohort: "social-magnitude-direction-test",
  market: {
    source: "dexscreener",
    observedAt: snapshotAt.toISOString(),
    tokenAddress,
    pairAddress: "social-magnitude-pool",
    symbol: "MAG",
    priceUsd: 0.01,
    liquidityUsd: 50_000,
    marketCapUsd: 500_000,
    fdvUsd: 500_000,
    volumeUsd: { m5: 5_000, h1: 50_000, h6: 200_000, h24: 500_000 },
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
    discoveryEventId: nansenDiscovery.id,
    confirmationEventId: confirmation.id,
    discoveryObservedAt: nansenDiscovery.observedAt,
    confirmationObservedAt: confirmation.observedAt,
    metrics: {
      netflowUsd: 5_000,
      netflowToLiquidity: 0.1,
      buySellVolumeRatio: 2,
      priceChangePct: 0,
      confirmedLiquidityUsd: 50_000,
    },
  },
});

const forecasts = createForecastEvents(snapshot, null, [registration], [], [socialDiscovery]);
assert.equal(forecasts.length, 28);
const parent = forecasts.find((forecast) => (
  forecast.modelVersion === "frozen-onchain-rank-v3"
  && forecast.candidateId === "smart-money-selection"
  && forecast.horizon === "1h"
));
const challenger = forecasts.find((forecast) => (
  forecast.modelVersion === registration.modelVersion
));
assert.equal(parent.predictedRise, true);
assert.equal(challenger.status, "ready");
assert.equal(challenger.magnitudeAlert, true);
assert.equal(challenger.predictedRise, true);
assert.equal(challenger.additionalEvidenceEventId, socialDiscovery.id);
assert.deepEqual(challenger.inputEvidence.magnitudeCandidate, {
  lunarcrushCoinId: 7,
  marketCapUsd: 500_000,
  volume24hUsd: 100_000,
  interactions24h: 2_000,
  socialVolume24h: 50,
  altRank: 50,
  altRankPrevious: 1_100,
  altRankImprovement: 1_050,
  galaxyScore: 65,
  galaxyScorePrevious: 50,
  galaxyScoreImprovement: 15,
  priceChange1hPct: 2,
  priceChange24hPct: 10,
});

const cashForecast = createForecastEvents(
  snapshot,
  null,
  [registration],
  [],
  [{ ...socialDiscovery, candidates: [], digest: "empty-complete-universe" }],
).find((forecast) => forecast.modelVersion === registration.modelVersion);
assert.equal(cashForecast.status, "ready");
assert.equal(cashForecast.magnitudeAlert, false);
assert.equal(cashForecast.predictedRise, false);
assert.equal(cashForecast.decision, "paper-cash");

const parentResolution = resolutionEvent(parent, snapshot, 0.012, new Date(parent.dueAt));
const challengerResolution = resolutionEvent(challenger, snapshot, 0.012, new Date(challenger.dueAt));
const comparison = buildScorecard([
  registration,
  nansenDiscovery,
  confirmation,
  socialDiscovery,
  snapshot,
  parent,
  challenger,
  parentResolution,
  challengerResolution,
]).challengerComparisons.find((row) => row.challengerModelVersion === registration.modelVersion);
assert.equal(comparison.matchedForecasts, 1);
assert.equal(comparison.lineageRejectedForecasts, 0);
assert.equal(comparison.averagePairedDeltaPct, 0);

console.log("token-edge social-magnitude/direction challenger checks passed.");
