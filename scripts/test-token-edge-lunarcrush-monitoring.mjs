#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildLunarCrushMonitoringScorecard,
} from "./token-edge/onchain-lunarcrush-monitoring-scorecard.mjs";
import { LUNARCRUSH_SOLANA_MONITORING_RULE } from "./token-edge/onchain-lunarcrush-provider.mjs";

const first = discovery("2026-08-03T08:00:00.000Z", [
  candidate("Alpha111111111111111111111111111111111", 1, 0.001, 1_200, 15, 100),
  candidate("Beta1111111111111111111111111111111111", 2, 0.002, 100, 2, 20),
]);
const second = discovery("2026-08-03T09:00:00.000Z", [
  candidate("Alpha111111111111111111111111111111111", 1, 0.0015, 900, 12, 90),
  candidate("Beta1111111111111111111111111111111111", 2, 0.0018, 50, 1, 20),
]);
const third = discovery("2026-08-03T10:00:00.000Z", [
  candidate("Alpha111111111111111111111111111111111", 1, 0.0012, 800, 8, 80),
  candidate("Beta1111111111111111111111111111111111", 2, 0.0027, 60, 3, 25),
]);
const history = {
  type: "lunarcrush-social-snapshot",
  id: "history-alpha",
  observedAt: first.observedAt,
  sourceDiscoveryEventId: first.id,
  tokenAddress: first.monitoringPanel.candidates[0].tokenAddress,
  status: "ready",
  socialFeatures: {
    contributorsActiveZ: 1.2,
    accelerationSignalCount: 3,
  },
};
const creatorAggregate = {
  type: "lunarcrush-creator-aggregate",
  id: "creators-alpha",
  observedAt: first.observedAt,
  sourceDiscoveryEventId: first.id,
  tokenAddress: first.monitoringPanel.candidates[0].tokenAddress,
  status: "ready",
  aggregateOnly: true,
  rawCreatorIdentitiesRetained: false,
  creatorMetrics: {
    creatorCount: 12,
    interactions24h: 10_000,
    topCreatorInteractionShare: 0.2,
    creatorInteractionHhi: 0.12,
    medianCreatorFollowers: 1_000,
    networkCounts: { twitter: 12 },
  },
};
const secondCreatorAggregate = {
  ...creatorAggregate,
  id: "creators-alpha-second",
  observedAt: second.observedAt,
  sourceDiscoveryEventId: second.id,
  creatorMetrics: {
    ...creatorAggregate.creatorMetrics,
    creatorCount: 18,
    interactions24h: 15_000,
    topCreatorInteractionShare: 0.1,
    creatorInteractionHhi: 0.08,
    medianCreatorFollowers: 1_500,
    networkCounts: { unspecified: 18 },
  },
};

const scorecard = buildLunarCrushMonitoringScorecard([
  first, second, third, history, creatorAggregate, secondCreatorAggregate,
]);
assert.equal(scorecard.discoveryEvents, 3);
assert.equal(scorecard.independentHourlyFrames, 2);
assert.equal(scorecard.observations, 4);
assert.equal(scorecard.uniqueTokens, 2);
assert.equal(scorecard.historyFeatureObservations, 1);
assert.equal(scorecard.creatorFeatureObservations, 2);
assert.equal(scorecard.creatorDeltaObservations, 1);
assert.equal(scorecard.providerPriceIsNotExecutionEvidence, true);
assert.equal(scorecard.allCandidates.averageEqualWeightFrameReturnPct, 17.5);
assert.equal(scorecard.allCandidates.fourPercentCostProxyPct, 13.5);
assert.equal(scorecard.chronologicalHalves.status, "insufficient-frames");
const alt = scorecard.screens.find((row) => row.id === "alt-rank-improvement-1000");
assert.equal(alt.observations, 1);
assert.equal(alt.independentFrames, 1);
assert.equal(alt.riseRate, 1);
assert.equal(alt.averageEqualWeightFrameReturnPct, 50);
const creator = scorecard.screens.find((row) => row.id === "interaction-post-creator-breakout");
assert.equal(creator.observations, 1);
assert.equal(creator.averageEqualWeightFrameReturnPct, 50);
const distributed = scorecard.screens.find((row) => row.id === "distributed-creator-attention");
assert.equal(distributed.observations, 2);
assert.equal(distributed.averageEqualWeightFrameReturnPct, 15);
const concentrated = scorecard.screens.find((row) => row.id === "concentrated-creator-attention");
assert.equal(concentrated.observations, 0);
const midTail = scorecard.screens.find((row) => row.id === "mid-tail-creator-swarm");
assert.equal(midTail.observations, 2);
assert.equal(midTail.averageEqualWeightFrameReturnPct, 15);
const depth = scorecard.screens.find((row) => row.id === "creator-interaction-depth-500");
assert.equal(depth.observations, 2);
const breadthAcceleration = scorecard.screens.find((row) => row.id === "creator-breadth-acceleration");
assert.equal(breadthAcceleration.observations, 1);
assert.equal(breadthAcceleration.averageEqualWeightFrameReturnPct, -20);
const diffusion = scorecard.screens.find((row) => row.id === "creator-concentration-diffusion");
assert.equal(diffusion.observations, 1);
assert.equal(diffusion.averageEqualWeightFrameReturnPct, -20);

const tooLate = discovery("2026-08-03T12:00:00.000Z", [
  candidate("Alpha111111111111111111111111111111111", 1, 0.002, 1_200, 15, 100),
]);
assert.equal(buildLunarCrushMonitoringScorecard([first, tooLate]).independentHourlyFrames, 0);

const anomalousSource = discovery("2026-08-03T11:00:00.000Z", [
  candidate("SupplyGlitch11111111111111111111111111111", 3, 0.001, 0, 0, 1_000),
]);
const anomalousTarget = discovery("2026-08-03T12:00:00.000Z", [
  candidate("SupplyGlitch11111111111111111111111111111", 3, 0.075, 0, 0, 1_000),
]);
const anomalousScorecard = buildLunarCrushMonitoringScorecard([
  anomalousSource,
  anomalousTarget,
]);
assert.equal(anomalousScorecard.independentHourlyFrames, 1);
assert.equal(anomalousScorecard.observations, 0);
assert.equal(anomalousScorecard.providerPriceIntegrityRejectedObservations, 1);

console.log("token-edge LunarCrush monitoring scorecard checks passed.");

function discovery(observedAt, candidates) {
  return {
    type: "discovery",
    id: `discovery-${observedAt}`,
    observedAt,
    provider: "lunarcrush-coin-list",
    candidates: [],
    monitoringPanel: {
      ruleVersion: LUNARCRUSH_SOLANA_MONITORING_RULE.version,
      rule: LUNARCRUSH_SOLANA_MONITORING_RULE,
      candidates,
      researchOnly: true,
      mutationAllowed: false,
    },
  };
}

function candidate(tokenAddress, coinId, priceUsd, altRankImprovement, galaxyScoreImprovement, interactions24h) {
  return {
    chain: "solana",
    tokenAddress,
    lunarcrushCoinId: coinId,
    priceUsd,
    marketCapUsd: 500_000,
    volume24hUsd: 100_000,
    interactions24h,
    socialVolume24h: 10,
    altRank: 100,
    altRankPrevious: 100 + altRankImprovement,
    altRankImprovement,
    galaxyScore: 60,
    galaxyScorePrevious: 60 - galaxyScoreImprovement,
    galaxyScoreImprovement,
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    status: "monitoring-only",
    ruleVersion: LUNARCRUSH_SOLANA_MONITORING_RULE.version,
  };
}
