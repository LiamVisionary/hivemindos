#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  TOKEN_EDGE_CHALLENGERS,
  appendLedgerEvent,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import { rejectedChallengerForecastIds } from "./onchain-challenger-scorecard.mjs";
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

export const DEX_EARLY_MONITORING_RULE = Object.freeze({
  version: "dex-early-surface-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T12:15:00.000Z",
  sourceModelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  sourceCandidateId: "dex-early-surface-rise",
  horizon: "1h",
  selectionProvider: "dexscreener-early-surface",
  selectionTimeframe: "5m",
  screens: Object.freeze([
    Object.freeze({ id: "transaction-buy-pressure", minimumBuySellTxnRatioInclusive: 1 }),
    Object.freeze({ id: "positive-entry-momentum", minimumPriceChangeH1PctExclusive: 0 }),
    Object.freeze({
      id: "buy-pressure-positive-momentum",
      minimumBuySellTxnRatioInclusive: 1,
      minimumPriceChangeH1PctExclusive: 0,
    }),
    Object.freeze({ id: "high-hourly-turnover", minimumHourlyTurnoverInclusive: 0.5 }),
    Object.freeze({
      id: "buy-pressure-high-turnover",
      minimumBuySellTxnRatioInclusive: 1,
      minimumHourlyTurnoverInclusive: 0.5,
    }),
    Object.freeze({ id: "under-24h-pair", maximumPairAgeMinutesInclusive: 1_440 }),
    Object.freeze({ id: "boost-backed-source", minimumTotalBoostAmountExclusive: 0 }),
    Object.freeze({ id: "multi-surface-source", minimumSourceBreadthInclusive: 2 }),
    Object.freeze({ id: "website-and-x", requireWebsite: true, requireTwitter: true }),
    Object.freeze({ id: "low-anti-chase-momentum", maximumPriceChangeH1PctInclusive: 10 }),
    Object.freeze({
      id: "early-flow-consensus",
      minimumBuySellTxnRatioInclusive: 1,
      minimumHourlyTurnoverInclusive: 0.5,
      maximumPairAgeMinutesInclusive: 1_440,
      maximumPriceChangeH1PctInclusive: 10,
    }),
  ]),
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "posthoc-open-path-hypotheses-only",
  priorSourceOutcomesObserved: 0,
  priorOpenPathsExcluded: true,
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexEarlyMonitoringRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const registrationSpec = {
    rule: DEX_EARLY_MONITORING_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digest(registrationSpec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...registrationSpec,
  };
}

export async function registerDexEarlyMonitoring(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createDexEarlyMonitoringRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    DEX_EARLY_MONITORING_RULE.evidenceBoundary,
  ))) throw new Error("DEX early monitoring registration must be after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error(`Existing DEX early monitoring registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function buildDexEarlyMonitoringScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const sourceChallenger = TOKEN_EDGE_CHALLENGERS.find((challenger) => (
    challenger.modelVersion === DEX_EARLY_MONITORING_RULE.sourceModelVersion
    && challenger.candidateId === DEX_EARLY_MONITORING_RULE.sourceCandidateId
    && challenger.horizon === DEX_EARLY_MONITORING_RULE.horizon
  ));
  const rejectedForecastIds = sourceChallenger
    ? rejectedChallengerForecastIds(events, [sourceChallenger])
    : new Set();
  const registrations = events.filter((event) => event.type === "execution-policy-registration");
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const outcomes = new Map(events
    .filter((event) => event.type === "resolution")
    .map((event) => [event.forecastId, event]));
  const candidates = events.filter((event) => (
    event.type === "forecast"
    && event.modelVersion === DEX_EARLY_MONITORING_RULE.sourceModelVersion
    && event.candidateId === DEX_EARLY_MONITORING_RULE.sourceCandidateId
    && event.horizon === DEX_EARLY_MONITORING_RULE.horizon
    && Date.parse(event.createdAt) > registrationAt
    && Date.parse(event.createdAt) > Date.parse(DEX_EARLY_MONITORING_RULE.evidenceBoundary)
  )).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const rows = [];
  const rejectionCounts = {};
  let openForecasts = 0;
  for (const forecast of candidates) {
    const snapshot = snapshots.get(forecast.snapshotId);
    if (rejectedForecastIds.has(forecast.id)) {
      increment(rejectionCounts, "challenger-lineage-rejected");
      continue;
    }
    const outcome = outcomes.get(forecast.id);
    if (!outcome) {
      openForecasts += 1;
      continue;
    }
    const reason = outcomeReason({ forecast, snapshot, outcome, registrations });
    if (reason) {
      increment(rejectionCounts, reason);
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
    type: "dex-early-surface-monitoring-scorecard",
    ruleVersion: DEX_EARLY_MONITORING_RULE.version,
    evidenceBoundary: DEX_EARLY_MONITORING_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
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
    screens: DEX_EARLY_MONITORING_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesDexEarlyMonitoringScreen(row, screen)),
    })),
    note: "This post-hoc, future-only screen family generates hypotheses only. Open paths and every pre-registration V11 forecast are excluded; no screen can mutate a forecast, register a challenger automatically, or trade.",
  };
}

function outcomeReason({ forecast, snapshot, outcome, registrations }) {
  if (forecast.status !== "ready" || forecast.predictedRise !== true) {
    return "source-not-ready-long";
  }
  if (!snapshot || snapshot.chain !== forecast.chain
    || snapshot.tokenAddress !== forecast.tokenAddress) return "missing-or-mismatched-snapshot";
  if (outcome.status !== "observed" || outcome.observationMode !== "live-point-in-time") {
    return "not-live-fixed-horizon-outcome";
  }
  if (outcome.forecastId !== forecast.id
    || outcome.snapshotId !== snapshot.id
    || outcome.modelVersion !== forecast.modelVersion
    || outcome.candidateId !== forecast.candidateId
    || outcome.horizon !== forecast.horizon
    || outcome.chain !== forecast.chain
    || outcome.tokenAddress !== forecast.tokenAddress
    || outcome.dueAt !== forecast.dueAt) return "resolution-forecast-mismatch";
  const timingReason = exactLiveOutcomeTimingReason(outcome);
  if (timingReason) return timingReason;
  if (outcome.entryPriceUsd !== snapshot.market?.priceUsd
    || !(outcome.observedPriceUsd > 0)
    || outcome.grossReturnPct !== round6(
      ((outcome.observedPriceUsd / snapshot.market.priceUsd) - 1) * 100,
    )) return "resolution-return-mismatch";
  const expected = executionPolicyLink(forecast.createdAt, registrations);
  if (!expected.executionPolicyRegistrationId
    || forecast.executionPolicyRegistrationId !== expected.executionPolicyRegistrationId
    || forecast.executionPolicyRegisteredAt !== expected.executionPolicyRegisteredAt
    || forecast.executionPolicyVersion !== expected.executionPolicyVersion
    || forecast.roundTripCostPct !== DEX_EARLY_MONITORING_RULE.baseRoundTripCostPct) {
    return "invalid-execution-policy-link";
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
  const metrics = forecast.inputEvidence?.dexEarlySurfaceMetrics ?? {};
  const evidence = outcome.executionEvidence;
  return {
    forecastId: forecast.id,
    createdAt: forecast.createdAt,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    grossReturnPct: outcome.grossReturnPct,
    baseCapacityReturnPct: capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
      roundTripCostPct: DEX_EARLY_MONITORING_RULE.baseRoundTripCostPct,
    }),
    stressCapacityReturnPct: capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
      roundTripCostPct: DEX_EARLY_MONITORING_RULE.stressRoundTripCostPct,
    }),
    buySellTxnRatio: finiteNumber(metrics.buySellTxnRatio),
    hourlyTurnover: finiteNumber(metrics.hourlyTurnover),
    pairAgeMinutes: finiteNumber(metrics.pairAgeMinutes),
    priceChangeH1Pct: finiteNumber(metrics.priceChangeH1Pct),
    totalBoostAmount: finiteNumber(metrics.totalBoostAmount),
    sourceBreadth: finiteNumber(metrics.sourceBreadth),
    hasWebsite: metrics.hasWebsite === true,
    hasTwitter: metrics.hasTwitter === true,
  };
}

export function passesDexEarlyMonitoringScreen(row, screen) {
  return (!Object.hasOwn(screen, "minimumBuySellTxnRatioInclusive")
      || (Number.isFinite(row.buySellTxnRatio)
        && row.buySellTxnRatio >= screen.minimumBuySellTxnRatioInclusive))
    && (!Object.hasOwn(screen, "minimumPriceChangeH1PctExclusive")
      || (Number.isFinite(row.priceChangeH1Pct)
        && row.priceChangeH1Pct > screen.minimumPriceChangeH1PctExclusive))
    && (!Object.hasOwn(screen, "minimumHourlyTurnoverInclusive")
      || (Number.isFinite(row.hourlyTurnover)
        && row.hourlyTurnover >= screen.minimumHourlyTurnoverInclusive))
    && (!Object.hasOwn(screen, "maximumPairAgeMinutesInclusive")
      || (Number.isFinite(row.pairAgeMinutes)
        && row.pairAgeMinutes <= screen.maximumPairAgeMinutesInclusive))
    && (!Object.hasOwn(screen, "minimumTotalBoostAmountExclusive")
      || (Number.isFinite(row.totalBoostAmount)
        && row.totalBoostAmount > screen.minimumTotalBoostAmountExclusive))
    && (!Object.hasOwn(screen, "minimumSourceBreadthInclusive")
      || (Number.isFinite(row.sourceBreadth)
        && row.sourceBreadth >= screen.minimumSourceBreadthInclusive))
    && (!screen.requireWebsite || row.hasWebsite)
    && (!screen.requireTwitter || row.hasTwitter)
    && (!Object.hasOwn(screen, "maximumPriceChangeH1PctInclusive")
      || (Number.isFinite(row.priceChangeH1Pct)
        && row.priceChangeH1Pct <= screen.maximumPriceChangeH1PctInclusive));
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct)));
  const parentStress = frames.map((frame) => mean(frame.map((row) => row.stressCapacityReturnPct)));
  const screenBase = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.baseCapacityReturnPct : 0
  ))));
  const screenStress = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.stressCapacityReturnPct : 0
  ))));
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map((row) => tokenEdgeAssetKey(row))).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length
      : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length
      : null),
    parentAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    screenAverageCapacityReturnPct: nullableRound(mean(screenBase)),
    pairedCapacityDeltaPct: nullableRound(pairedMean(screenBase, parentBase)),
    parentStressCapacityReturnPct: nullableRound(mean(parentStress)),
    screenStressCapacityReturnPct: nullableRound(mean(screenStress)),
    pairedStressCapacityDeltaPct: nullableRound(pairedMean(screenStress, parentStress)),
    largestWinningFrameShare: nullableRound(largestWinningShare(screenBase)),
  };
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexEarlyMonitoringRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && JSON.stringify(event.rule) === JSON.stringify(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function finiteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function mean(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
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

function nullableRound(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function round6(value) {
  return Number(value.toFixed(6));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Registration time is invalid.");
  return date.toISOString();
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
  const action = process.argv.includes("register")
    ? registerDexEarlyMonitoring({ ledgerPath })
    : readLedger(ledgerPath).then((events) => {
      const verification = verifyLedger(events);
      if (!verification.ok) {
        throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
      }
      return {
        ledgerPath,
        verification,
        scorecard: buildDexEarlyMonitoringScorecard(events),
      };
    });
  action.then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
