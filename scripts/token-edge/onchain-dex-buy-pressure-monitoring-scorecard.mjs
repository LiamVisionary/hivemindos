#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  TOKEN_EDGE_MODEL_VERSION,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
  executionPolicyLink,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import { exactLiveOutcomeTimingReason } from "./onchain-outcome-timing.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;

export const DEX_BUY_PRESSURE_MONITORING_RULE = Object.freeze({
  version: "nansen-selected-dex-buy-pressure-monitoring-v1",
  evidenceBoundary: "2026-08-03T10:45:30.000Z",
  parentModelVersion: TOKEN_EDGE_MODEL_VERSION,
  parentCandidateId: "smart-money-selection",
  horizon: "1h",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  minimumHourlyBuySellTransactionRatio: 1,
  minimumHourlyPriceChangePctExclusive: 0,
  minimumHourlyTurnoverToLiquidity: 0.5,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  researchOnly: true,
  mutationAllowed: false,
});

export function buildDexBuyPressureMonitoringScorecard(events) {
  const registrations = events.filter((event) => event.type === "execution-policy-registration");
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const outcomes = new Map(events
    .filter((event) => (
      event.type === "resolution"
      && event.status === "observed"
      && event.observationMode === "live-point-in-time"
    ))
    .map((event) => [event.forecastId, event]));
  const candidates = events.filter((event) => (
    event.type === "forecast"
    && event.modelVersion === DEX_BUY_PRESSURE_MONITORING_RULE.parentModelVersion
    && event.candidateId === DEX_BUY_PRESSURE_MONITORING_RULE.parentCandidateId
    && event.horizon === DEX_BUY_PRESSURE_MONITORING_RULE.horizon
    && Date.parse(event.createdAt) > Date.parse(DEX_BUY_PRESSURE_MONITORING_RULE.evidenceBoundary)
  )).sort((left, right) => (
    Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.id.localeCompare(right.id)
  ));

  const rows = [];
  const rejectionCounts = {};
  let openForecasts = 0;
  for (const forecast of candidates) {
    const snapshot = snapshots.get(forecast.snapshotId);
    const lineageReason = monitoringLineageReason(forecast, snapshot);
    if (lineageReason) {
      increment(rejectionCounts, lineageReason);
      continue;
    }
    const outcome = outcomes.get(forecast.id);
    if (!outcome) {
      openForecasts += 1;
      continue;
    }
    const timingReason = exactLiveOutcomeTimingReason(outcome);
    if (timingReason) {
      increment(rejectionCounts, timingReason);
      continue;
    }
    const capacityReason = capacityLineageReason({
      forecast,
      snapshot,
      outcome,
      registrations,
    });
    if (capacityReason) {
      increment(rejectionCounts, capacityReason);
      continue;
    }
    rows.push(monitoringRow(forecast, snapshot, outcome));
  }

  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "nansen-dex-buy-pressure-monitoring-scorecard",
    ruleVersion: DEX_BUY_PRESSURE_MONITORING_RULE.version,
    evidenceBoundary: DEX_BUY_PRESSURE_MONITORING_RULE.evidenceBoundary,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidates.length,
    openForecasts,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map((row) => tokenEdgeAssetKey(row))).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    buyPressureConfirmation: summarizeFrames(frames, passesBuyPressureConfirmation),
    buyPressureWithTurnoverConfirmation: summarizeFrames(
      frames,
      passesBuyPressureWithTurnoverConfirmation,
    ),
    chronologicalHalves: chronologicalHalves(frames),
    derivationDebt: {
      rawObservations: 21,
      weightedObservations: 13,
      independentFrames: 5,
      selectedObservations: 3,
      independentTradedFrames: 2,
      uniqueTokens: 3,
      baseCapacityReturnPct: 0.999067,
      stressCapacityReturnPct: -0.334266,
      firstHalfBaseCapacityReturnPct: 1.76197,
      secondHalfBaseCapacityReturnPct: 0.490465,
      largestWinningFrameShare: 0.705446,
      conclusion: "The coarse entry-time confirmation was positive after base costs in both halves, but negative under stress, supported by only two traded frames, and winner-concentrated.",
      strictTurnoverConfirmation: {
        minimumHourlyTurnoverToLiquidity: 0.5,
        selectedObservations: 2,
        independentTradedFrames: 2,
        uniqueTokens: 2,
        baseCapacityReturnPct: 1.202057,
        stressCapacityReturnPct: 0.268724,
        firstHalfBaseCapacityReturnPct: 2.269445,
        secondHalfBaseCapacityReturnPct: 0.490465,
        largestWinningFrameShare: 0.755187,
        conclusion: "Positive under stress but supported by only two tokens and two traded frames, with severe winner concentration.",
      },
      promotionalUseAllowed: false,
    },
    note: "This fixed future-only screen generates monitoring evidence only. It cannot authorize a challenger, mutate a forecast, or trade.",
  };
}

function monitoringLineageReason(forecast, snapshot) {
  if (forecast.status !== "ready" || forecast.predictedRise !== true) {
    return "parent-not-ready-long";
  }
  if (forecast.selectionProvider !== DEX_BUY_PRESSURE_MONITORING_RULE.selectionProvider
    || forecast.selectionTimeframe !== DEX_BUY_PRESSURE_MONITORING_RULE.selectionTimeframe) {
    return "wrong-forecast-selection-lineage";
  }
  if (!snapshot || snapshot.chain !== forecast.chain
    || snapshot.tokenAddress !== forecast.tokenAddress) return "missing-or-mismatched-snapshot";
  if (snapshot.selection?.status !== "verified"
    || snapshot.selection?.provider !== DEX_BUY_PRESSURE_MONITORING_RULE.selectionProvider
    || snapshot.selection?.timeframe !== DEX_BUY_PRESSURE_MONITORING_RULE.selectionTimeframe
    || snapshot.selection?.discoveryEventId !== forecast.selectionDiscoveryEventId
    || snapshot.selection?.confirmationEventId !== forecast.selectionConfirmationEventId) {
    return "wrong-snapshot-selection-lineage";
  }
  return null;
}

function capacityLineageReason(input) {
  const { forecast, snapshot, outcome, registrations } = input;
  const expected = executionPolicyLink(forecast.createdAt, registrations);
  if (!expected.executionPolicyRegistrationId
    || forecast.executionPolicyRegistrationId !== expected.executionPolicyRegistrationId
    || forecast.executionPolicyRegisteredAt !== expected.executionPolicyRegisteredAt
    || forecast.executionPolicyVersion !== expected.executionPolicyVersion) {
    return "invalid-execution-policy-link";
  }
  if (forecast.roundTripCostPct !== DEX_BUY_PRESSURE_MONITORING_RULE.baseRoundTripCostPct) {
    return "forecast-cost-policy-mismatch";
  }
  const evidence = outcome.executionEvidence;
  if (!evidence
    || evidence.entryMarketObservedAt !== snapshot.market?.observedAt
    || evidence.entryPairAddress !== snapshot.market?.pairAddress
    || evidence.exitPairAddress !== snapshot.market?.pairAddress
    || evidence.entryLiquidityUsd !== snapshot.market?.liquidityUsd
    || !(evidence.entryLiquidityUsd > 0)
    || !(evidence.exitLiquidityUsd > 0)) return "invalid-capacity-evidence";
  return null;
}

function monitoringRow(forecast, snapshot, outcome) {
  const evidence = outcome.executionEvidence;
  const hourlyTransactions = snapshot.market?.txns?.h1;
  return {
    forecastId: forecast.id,
    snapshotId: snapshot.id,
    createdAt: forecast.createdAt,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    symbol: forecast.symbol,
    grossReturnPct: outcome.grossReturnPct,
    baseCapacityReturnPct: capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
      roundTripCostPct: DEX_BUY_PRESSURE_MONITORING_RULE.baseRoundTripCostPct,
    }),
    stressCapacityReturnPct: capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
      roundTripCostPct: DEX_BUY_PRESSURE_MONITORING_RULE.stressRoundTripCostPct,
    }),
    hourlyBuys: finiteNumber(hourlyTransactions?.buys),
    hourlySells: finiteNumber(hourlyTransactions?.sells),
    hourlyPriceChangePct: finiteNumber(snapshot.market?.priceChangePct?.h1),
    hourlyTurnoverToLiquidity: ratio(
      snapshot.market?.volumeUsd?.h1,
      snapshot.market?.liquidityUsd,
    ),
  };
}

function passesBuyPressureWithTurnoverConfirmation(row) {
  return passesBuyPressureConfirmation(row)
    && Number.isFinite(row.hourlyTurnoverToLiquidity)
    && row.hourlyTurnoverToLiquidity
      >= DEX_BUY_PRESSURE_MONITORING_RULE.minimumHourlyTurnoverToLiquidity;
}

function passesBuyPressureConfirmation(row) {
  return Number.isFinite(row.hourlyBuys)
    && Number.isFinite(row.hourlySells)
    && row.hourlyBuys >= row.hourlySells
    && Number.isFinite(row.hourlyPriceChangePct)
    && row.hourlyPriceChangePct > DEX_BUY_PRESSURE_MONITORING_RULE.minimumHourlyPriceChangePctExclusive;
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct)));
  const parentStress = frames.map((frame) => mean(frame.map((row) => row.stressCapacityReturnPct)));
  const challengerBase = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.baseCapacityReturnPct : 0
  ))));
  const challengerStress = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.stressCapacityReturnPct : 0
  ))));
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map((row) => tokenEdgeAssetKey(row))).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length
      : null, 6),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length
      : null, 6),
    parentAverageCapacityReturnPct: nullableRound(mean(parentBase), 6),
    challengerAverageCapacityReturnPct: nullableRound(mean(challengerBase), 6),
    pairedCapacityDeltaPct: nullableRound(pairedMean(challengerBase, parentBase), 6),
    parentStressCapacityReturnPct: nullableRound(mean(parentStress), 6),
    challengerStressCapacityReturnPct: nullableRound(mean(challengerStress), 6),
    pairedStressCapacityDeltaPct: nullableRound(pairedMean(challengerStress, parentStress), 6),
    largestWinningFrameShare: nullableRound(largestWinningShare(challengerBase), 6),
  };
}

function chronologicalHalves(frames) {
  if (frames.length < 4) return { status: "insufficient-frames", first: null, second: null };
  const midpoint = Math.floor(frames.length / 2);
  return {
    status: "available",
    first: summarizeFrames(frames.slice(0, midpoint), passesBuyPressureConfirmation),
    second: summarizeFrames(frames.slice(midpoint), passesBuyPressureConfirmation),
  };
}

function pairedMean(left, right) {
  return left.length && left.length === right.length
    ? mean(left.map((value, index) => value - right[index]))
    : null;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  if (!winners.length) return null;
  const total = winners.reduce((sum, value) => sum + value, 0);
  return Math.max(...winners) / total;
}

function finiteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function ratio(numerator, denominator) {
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  return top !== null && bottom > 0 ? top / bottom : null;
}

function mean(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function nullableRound(value, decimals) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const ledgerIndex = process.argv.indexOf("--ledger");
  const ledgerPath = path.resolve(
    ledgerIndex >= 0 && process.argv[ledgerIndex + 1]
      ? process.argv[ledgerIndex + 1]
      : defaultTokenEdgeLedgerPath(),
  );
  readLedger(ledgerPath).then((events) => {
    const verification = verifyLedger(events);
    if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
    process.stdout.write(`${JSON.stringify({
      ledgerPath,
      verification,
      scorecard: buildDexBuyPressureMonitoringScorecard(events),
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
