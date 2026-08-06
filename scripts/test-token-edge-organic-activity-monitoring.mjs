#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
  createExecutionPolicyRegistrationEvents,
} from "./token-edge/onchain-capacity-scorecard.mjs";
import {
  NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE,
  NANSEN_SAMPLED_BUYER_PRESSURE_RULE,
  buildNansenOrganicActivityMonitoringScorecard,
  buildNansenSampledBuyerPressureScorecard,
  createNansenSampledBuyerPressureRegistrationEvent,
} from "./token-edge/onchain-organic-activity-monitoring-scorecard.mjs";

const registration = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T10:29:37.200Z"),
)[0];
const alpha = opportunity({
  createdAt: "2026-08-03T11:00:00.000Z",
  tokenAddress: "Alpha111111111111111111111111111111111",
  symbol: "ALPHA",
  grossReturnPct: 20,
  organic: true,
  registration,
});
const beta = opportunity({
  createdAt: "2026-08-03T11:05:00.000Z",
  tokenAddress: "Beta1111111111111111111111111111111111",
  symbol: "BETA",
  grossReturnPct: -10,
  organic: false,
  registration,
});
const overlappingAlpha = opportunity({
  createdAt: "2026-08-03T11:30:00.000Z",
  tokenAddress: alpha.forecast.tokenAddress,
  symbol: "ALPHA",
  grossReturnPct: 100,
  organic: true,
  registration,
  suffix: "overlap",
});
const gamma = opportunity({
  createdAt: "2026-08-03T12:00:00.000Z",
  tokenAddress: "Gamma111111111111111111111111111111111",
  symbol: "GAMMA",
  grossReturnPct: 5,
  organic: true,
  registration,
});
const preBoundary = opportunity({
  createdAt: "2026-08-03T10:29:37.000Z",
  tokenAddress: "Before11111111111111111111111111111111",
  symbol: "BEFORE",
  grossReturnPct: 500,
  organic: true,
  registration,
});
const open = opportunity({
  createdAt: "2026-08-03T13:00:00.000Z",
  tokenAddress: "Open1111111111111111111111111111111111",
  symbol: "OPEN",
  grossReturnPct: 50,
  organic: true,
  registration,
});
const late = opportunity({
  createdAt: "2026-08-03T14:00:00.000Z",
  tokenAddress: "Late1111111111111111111111111111111111",
  symbol: "LATE",
  grossReturnPct: 50,
  organic: true,
  registration,
  outcomeLagMs: 6 * 60_000,
});

const scorecard = buildNansenOrganicActivityMonitoringScorecard([
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

assert.equal(scorecard.ruleVersion, "nansen-selected-organic-activity-monitoring-v1");
assert.equal(scorecard.evidenceBoundary, NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.evidenceBoundary);
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
assert.equal(scorecard.chronologicalHalves.status, "insufficient-frames");

const consensus = screen(scorecard, "organic-activity-consensus");
assert.equal(consensus.observations, 2);
assert.equal(consensus.independentFrames, 2);
assert.equal(consensus.independentTradedFrames, 2);
assert.equal(consensus.uniqueTokens, 2);
assert.equal(consensus.riseRate, 1);
assert.equal(consensus.netWinRate, 1);
assert.equal(consensus.explosion25Rate, 0);
assert.equal(consensus.largestWinningFrameShare > 0.5, true);

const alphaBase = capacityReturn(20, 4);
const betaBase = capacityReturn(-10, 4);
const gammaBase = capacityReturn(5, 4);
const expectedParent = (((alphaBase + betaBase) / 2) + gammaBase) / 2;
const expectedChallenger = ((alphaBase / 2) + gammaBase) / 2;
assert.equal(consensus.parentAverageCapacityReturnPct, round(expectedParent));
assert.equal(consensus.challengerAverageCapacityReturnPct, round(expectedChallenger));
assert.equal(consensus.pairedCapacityDeltaPct, round(expectedChallenger - expectedParent));

assert.equal(screen(scorecard, "sampled-net-buyer-pressure").observations, 2);
assert.equal(screen(scorecard, "distributed-sampled-flow").observations, 3);
assert.equal(screen(scorecard, "repeat-trader-depth").observations, 2);
assert.equal(screen(scorecard, "low-profit-overhang").observations, 2);
assert.equal(scorecard.derivationDebt.promotionalUseAllowed, false);

const missingFields = opportunity({
  createdAt: "2026-08-03T15:00:00.000Z",
  tokenAddress: "Missing11111111111111111111111111111111",
  symbol: "MISSING",
  grossReturnPct: 20,
  organic: true,
  registration,
});
missingFields.snapshot.nansen.aggregates.sampledBuySellUsdRatio = null;
missingFields.snapshot.nansen.aggregates.sampledProfitOverhangUsd = null;
const missingScore = buildNansenOrganicActivityMonitoringScorecard([
  registration,
  ...events(missingFields),
]);
assert.equal(screen(missingScore, "sampled-net-buyer-pressure").observations, 0);
assert.equal(screen(missingScore, "low-profit-overhang").observations, 0);
assert.equal(screen(missingScore, "organic-activity-consensus").observations, 0);

const futureExecutionRegistration = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-04T06:23:29.000Z"),
)[0];
const buyerPressureRegistration = createNansenSampledBuyerPressureRegistrationEvent(
  new Date("2026-08-04T06:24:00.000Z"),
);
const excludedSeed = opportunity({
  createdAt: "2026-08-04T06:23:45.000Z",
  tokenAddress: "ExcludedBuyer111111111111111111111111111",
  symbol: "EXCLUDED",
  grossReturnPct: 500,
  organic: true,
  registration: futureExecutionRegistration,
});
const buyerWinner = opportunity({
  createdAt: "2026-08-04T07:00:00.000Z",
  tokenAddress: "BuyerWinner1111111111111111111111111111",
  symbol: "BUYWIN",
  grossReturnPct: 20,
  organic: true,
  registration: futureExecutionRegistration,
});
const buyerCash = opportunity({
  createdAt: "2026-08-04T07:05:00.000Z",
  tokenAddress: "BuyerCash111111111111111111111111111111",
  symbol: "BUYCASH",
  grossReturnPct: -20,
  organic: false,
  registration: futureExecutionRegistration,
});
const laterBuyerWinner = opportunity({
  createdAt: "2026-08-04T08:00:00.000Z",
  tokenAddress: "LaterBuyer11111111111111111111111111111",
  symbol: "LATER",
  grossReturnPct: 30,
  organic: true,
  registration: futureExecutionRegistration,
});
const buyerPressureScore = buildNansenSampledBuyerPressureScorecard([
  futureExecutionRegistration,
  buyerPressureRegistration,
  ...events(excludedSeed),
  ...events(buyerWinner),
  ...events(buyerCash),
  ...events(laterBuyerWinner),
]);
assert.equal(buyerPressureScore.ruleVersion, NANSEN_SAMPLED_BUYER_PRESSURE_RULE.version);
assert.equal(buyerPressureScore.registrationId, buyerPressureRegistration.id);
assert.equal(buyerPressureScore.candidateForecasts, 3);
assert.equal(buyerPressureScore.eligibleLiveObservations, 3);
assert.equal(buyerPressureScore.portfolioWeightedObservations, 3);
assert.equal(buyerPressureScore.independentHourlyFrames, 2);
assert.equal(buyerPressureScore.independentTradedFrames, 2);
assert.equal(buyerPressureScore.tradedObservations, 2);
assert.equal(buyerPressureScore.uniqueTradedTokens, 2);
assert.equal(buyerPressureScore.child.challengerAverageCapacityReturnPct > 0, true);
assert.equal(buyerPressureScore.child.challengerStressCapacityReturnPct > 0, true);
assert.equal(buyerPressureScore.provisionalGate, false);
const tamperedBuyerRegistration = structuredClone(buyerPressureRegistration);
tamperedBuyerRegistration.rule.minimumSampledBuySellUsdRatioInclusive = 0.5;
const tamperedBuyerScore = buildNansenSampledBuyerPressureScorecard([
  futureExecutionRegistration,
  tamperedBuyerRegistration,
  ...events(buyerWinner),
]);
assert.equal(tamperedBuyerScore.registrationId, null);
assert.equal(tamperedBuyerScore.eligibleLiveObservations, 0);

console.log("token-edge organic-activity monitoring checks passed.");

function opportunity(input) {
  const suffix = input.suffix ?? input.symbol.toLowerCase();
  const createdAtMs = Date.parse(input.createdAt);
  const dueAt = new Date(createdAtMs + 60 * 60_000).toISOString();
  const observedAt = new Date(Date.parse(dueAt) + (input.outcomeLagMs ?? 60_000)).toISOString();
  const pairAddress = `pair-${suffix}`;
  const marketObservedAt = input.createdAt;
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
      observedAt: marketObservedAt,
      pairAddress,
      liquidityUsd: 100_000,
    },
    nansen: {
      status: "ok",
      profile: "full",
      aggregates: aggregates(input.organic),
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
      entryMarketObservedAt: marketObservedAt,
      entryPairAddress: pairAddress,
      entryLiquidityUsd: 100_000,
      exitMarketObservedAt: observedAt,
      exitPairAddress: pairAddress,
      exitLiquidityUsd: 100_000,
    },
  };
  return { snapshot, forecast, outcome };
}

function aggregates(organic) {
  return {
    sampledBuyerCount: 25,
    sampledSellerCount: 25,
    sampledBuySellUsdRatio: organic ? 1.2 : 0.8,
    topSampledBuyerVolumeShare: 0.1,
    sampledBuyerVolumeHhi: 0.05,
    topSampledSellerVolumeShare: 0.1,
    sampledSellerVolumeHhi: 0.05,
    medianTopPnlTradeCount: organic ? 4 : 20,
    top10OwnershipPct: 0.25,
    accumulatingHolderShare: 0.4,
    positiveSelectiveNetflowShare: 0.8,
    sampledProfitOverhangUsd: organic ? 10_000 : 50_000,
  };
}

function events(value) {
  return [value.snapshot, value.forecast, value.outcome];
}

function screen(scorecardValue, id) {
  return scorecardValue.screens.find((row) => row.id === id);
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
