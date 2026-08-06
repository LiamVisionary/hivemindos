#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  readLedger,
} from "./token-edge/onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
  createExecutionPolicyRegistrationEvents,
} from "./token-edge/onchain-capacity-scorecard.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  DEX_EARLY_MONITORING_RULE,
  buildDexEarlyMonitoringScorecard,
  createDexEarlyMonitoringRegistrationEvent,
  registerDexEarlyMonitoring,
} from "./token-edge/onchain-dex-early-monitoring-scorecard.mjs";

const execution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T12:15:01.000Z"),
)[0];
const challengerRegistrations = createChallengerRegistrationEvents(
  new Date("2026-08-03T12:15:05.000Z"),
);
const monitoringRegistration = createDexEarlyMonitoringRegistrationEvent(
  new Date("2026-08-03T12:15:10.000Z"),
);
const alpha = opportunity({
  suffix: "alpha",
  tokenAddress: "DexMonitorAlpha111",
  createdAt: "2026-08-03T12:16:00.000Z",
  grossReturnPct: 20,
  buySellTxnRatio: 2,
  hourlyTurnover: 0.6,
  pairAgeMinutes: 120,
  priceChangeH1Pct: 5,
  totalBoostAmount: 10,
  sourceBreadth: 1,
  hasWebsite: true,
  hasTwitter: true,
});
const beta = opportunity({
  suffix: "beta",
  tokenAddress: "DexMonitorBeta111",
  createdAt: "2026-08-03T13:20:00.000Z",
  grossReturnPct: -10,
  buySellTxnRatio: 0.5,
  hourlyTurnover: 0.1,
  pairAgeMinutes: 2_000,
  priceChangeH1Pct: -5,
  totalBoostAmount: 0,
  sourceBreadth: 1,
  hasWebsite: false,
  hasTwitter: false,
});
const preBoundary = opportunity({
  suffix: "pre",
  tokenAddress: "DexMonitorPre111",
  createdAt: DEX_EARLY_MONITORING_RULE.evidenceBoundary,
  grossReturnPct: 500,
  buySellTxnRatio: 2,
  hourlyTurnover: 1,
  pairAgeMinutes: 60,
  priceChangeH1Pct: 1,
  totalBoostAmount: 10,
  sourceBreadth: 2,
  hasWebsite: true,
  hasTwitter: true,
});

const scorecard = buildDexEarlyMonitoringScorecard([
  execution,
  ...challengerRegistrations,
  monitoringRegistration,
  ...alpha,
  ...beta,
  ...preBoundary,
]);
assert.equal(scorecard.registrationId, monitoringRegistration.id);
assert.equal(scorecard.ruleVersion, DEX_EARLY_MONITORING_RULE.version);
assert.equal(scorecard.researchOnly, true);
assert.equal(scorecard.mutationAllowed, false);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.openForecasts, 0);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 2);
assert.equal(scorecard.uniqueTokens, 2);
assert.equal(scorecard.screens.length, 11);

const pressure = scorecard.screens.find((screen) => screen.id === "transaction-buy-pressure");
assert.equal(pressure.observations, 1);
assert.equal(pressure.independentFrames, 2);
assert.equal(pressure.independentTradedFrames, 1);
assert.equal(pressure.uniqueTokens, 1);
assert.equal(pressure.riseRate, 1);
assert.equal(pressure.netWinRate, 1);
const alphaBase = capacityReturn(20, 4);
const betaBase = capacityReturn(-10, 4);
assert.equal(pressure.parentAverageCapacityReturnPct, round((alphaBase + betaBase) / 2));
assert.equal(pressure.screenAverageCapacityReturnPct, round(alphaBase / 2));
assert.equal(
  pressure.pairedCapacityDeltaPct,
  round((alphaBase / 2) - ((alphaBase + betaBase) / 2)),
);
assert.equal(
  scorecard.screens.find((screen) => screen.id === "early-flow-consensus").observations,
  1,
);
assert.equal(
  scorecard.screens.find((screen) => screen.id === "multi-surface-source").observations,
  0,
);

const forged = alpha.map((event) => {
  if (event.type !== "forecast"
    || event.modelVersion !== DEX_EARLY_MONITORING_RULE.sourceModelVersion) return event;
  const value = structuredClone(event);
  value.inputEvidence.dexEarlySurfaceMetrics.totalBoostAmount = 999;
  return value;
});
const forgedScorecard = buildDexEarlyMonitoringScorecard([
  execution,
  ...challengerRegistrations,
  monitoringRegistration,
  ...forged,
]);
assert.equal(forgedScorecard.eligibleLiveObservations, 0);
assert.equal(forgedScorecard.rejectionCounts["challenger-lineage-rejected"], 1);

const registerDirectory = await mkdtemp(path.join(os.tmpdir(), "dex-early-monitor-register-"));
const registerLedger = path.join(registerDirectory, "ledger.jsonl");
const first = await registerDexEarlyMonitoring({ ledgerPath: registerLedger }, {
  now: new Date("2026-08-03T12:15:20.000Z"),
});
const second = await registerDexEarlyMonitoring({ ledgerPath: registerLedger }, {
  now: new Date("2026-08-03T12:15:30.000Z"),
});
assert.equal(first.status, "registered");
assert.equal(second.status, "existing");
assert.equal(first.registrationId, second.registrationId);
assert.equal((await readLedger(registerLedger)).length, 1);

console.log("token-edge DEX early-surface monitoring checks passed.");

function opportunity(input) {
  const createdAtMs = Date.parse(input.createdAt);
  const discoveryAt = new Date(createdAtMs - 20_000).toISOString();
  const confirmationAt = new Date(createdAtMs - 10_000).toISOString();
  const dueAt = new Date(createdAtMs + 60 * 60_000).toISOString();
  const observedAt = new Date(Date.parse(dueAt) + 60_000).toISOString();
  const pairAddress = `pair-${input.suffix}`;
  const metrics = {
    sourceTypes: [input.totalBoostAmount > 0 ? "boost-latest" : "profile-latest"],
    sourceBreadth: input.sourceBreadth,
    latestBoostAmount: input.totalBoostAmount,
    totalBoostAmount: input.totalBoostAmount,
    hasWebsite: input.hasWebsite,
    hasTwitter: input.hasTwitter,
    pairAgeMinutes: input.pairAgeMinutes,
    discoveryLiquidityUsd: 20_000,
    marketCapUsd: 100_000,
    volumeH1Usd: 12_000,
    hourlyTurnover: input.hourlyTurnover,
    buySellTxnRatio: input.buySellTxnRatio,
    priceChange1hPct: input.priceChangeH1Pct,
    priceChange24hPct: 20,
  };
  const candidate = {
    chain: "solana",
    tokenAddress: input.tokenAddress,
    symbol: input.suffix.toUpperCase(),
    status: "eligible",
    blockers: [],
    sourceTypes: metrics.sourceTypes,
    sourceBreadth: metrics.sourceBreadth,
    latestSourceTimestamp: null,
    latestBoostAmount: metrics.latestBoostAmount,
    totalBoostAmount: metrics.totalBoostAmount,
    hasWebsite: metrics.hasWebsite,
    hasTwitter: metrics.hasTwitter,
    pairAddress,
    pairAgeMinutes: metrics.pairAgeMinutes,
    priceUsd: 1,
    liquidityUsd: metrics.discoveryLiquidityUsd,
    marketCapUsd: metrics.marketCapUsd,
    volumeH1Usd: metrics.volumeH1Usd,
    hourlyTurnover: metrics.hourlyTurnover,
    buysH1: Math.round(100 * input.buySellTxnRatio),
    sellsH1: 100,
    buySellTxnRatio: metrics.buySellTxnRatio,
    priceChangeH1Pct: metrics.priceChange1hPct,
    priceChangeH24Pct: metrics.priceChange24hPct,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
  const discovery = {
    type: "discovery",
    id: `discovery-${input.suffix}`,
    provider: "dexscreener-early-surface",
    sourceAttribution: "DEX Screener public API",
    chain: "solana",
    timeframe: "5m",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    rule: DEX_EARLY_SURFACE_RULE,
    collectionStartedAt: new Date(createdAtMs - 21_000).toISOString(),
    availableAt: discoveryAt,
    observedAt: discoveryAt,
    candidates: [candidate],
    researchOnly: true,
    mutationAllowed: false,
  };
  const confirmation = {
    type: "market-confirmation",
    id: `confirmation-${input.suffix}`,
    observedAt: confirmationAt,
    sourceEventId: discovery.id,
    candidates: [{
      chain: "solana",
      tokenAddress: input.tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 20_000 },
    }],
  };
  const snapshot = createSnapshotEvent({
    observedAt: new Date(input.createdAt),
    chain: "solana",
    tokenAddress: input.tokenAddress,
    cohort: "dex-monitor-test",
    selection: {
      status: "verified",
      provider: "dexscreener-early-surface",
      timeframe: "5m",
      ruleVersion: DEX_EARLY_SURFACE_RULE.version,
      discoveryEventId: discovery.id,
      confirmationEventId: confirmation.id,
      discoveryObservedAt: discoveryAt,
      discoveryAvailableAt: discoveryAt,
      confirmationObservedAt: confirmationAt,
      metrics,
    },
    market: {
      source: "dexscreener",
      observedAt: input.createdAt,
      tokenAddress: input.tokenAddress,
      pairAddress,
      pairUrl: `https://dexscreener.com/solana/${input.suffix}`,
      dexId: "raydium",
      symbol: input.suffix.toUpperCase(),
      priceUsd: 1,
      liquidityUsd: 20_000,
      marketCapUsd: 100_000,
      fdvUsd: 100_000,
      volumeUsd: { h1: 12_000 },
      priceChangePct: { h1: input.priceChangeH1Pct, h24: 20 },
      txns: { h1: { buys: candidate.buysH1, sells: candidate.sellsH1 } },
      pairCreatedAt: createdAtMs - input.pairAgeMinutes * 60_000,
    },
  });
  const forecasts = createForecastEvents(snapshot, null, challengerRegistrations);
  const sourceForecast = structuredClone(forecasts.find((event) => (
    event.modelVersion === DEX_EARLY_MONITORING_RULE.sourceModelVersion
  )));
  const baseline = forecasts.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v3"
    && event.candidateId === "market-only-control"
    && event.horizon === "1h"
  ));
  Object.assign(sourceForecast, {
    executionPolicyRegistrationId: execution.id,
    executionPolicyRegisteredAt: execution.registeredAt,
    executionPolicyVersion: execution.policyVersion,
    roundTripCostPct: execution.baseRoundTripCostPct,
  });
  const outcome = {
    type: "resolution",
    id: `resolution-${input.suffix}`,
    forecastId: sourceForecast.id,
    snapshotId: snapshot.id,
    modelVersion: sourceForecast.modelVersion,
    candidateId: sourceForecast.candidateId,
    horizon: "1h",
    chain: "solana",
    tokenAddress: input.tokenAddress,
    dueAt,
    observedAt,
    status: "observed",
    observationMode: "live-point-in-time",
    entryPriceUsd: 1,
    observedPriceUsd: 1 + input.grossReturnPct / 100,
    grossReturnPct: input.grossReturnPct,
    executionEvidence: {
      entryMarketObservedAt: input.createdAt,
      entryPairAddress: pairAddress,
      entryLiquidityUsd: 20_000,
      exitMarketObservedAt: observedAt,
      exitPairAddress: pairAddress,
      exitLiquidityUsd: 20_000,
    },
  };
  return [discovery, confirmation, snapshot, baseline, sourceForecast, outcome];
}

function capacityReturn(grossReturnPct, roundTripCostPct) {
  return capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd: 20_000,
    exitLiquidityUsd: 20_000,
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    roundTripCostPct,
  });
}

function round(value) {
  return Number(value.toFixed(6));
}
