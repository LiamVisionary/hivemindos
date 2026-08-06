#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  TOKEN_EDGE_MODEL_VERSION,
  appendLedgerEvent,
  digestValue,
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

export const NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE = Object.freeze({
  version: "nansen-selected-organic-activity-monitoring-v1",
  evidenceBoundary: "2026-08-03T10:29:37.100Z",
  parentModelVersion: TOKEN_EDGE_MODEL_VERSION,
  parentCandidateId: "smart-money-selection",
  horizon: "1h",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  requiredNansenProfile: "full",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  researchOnly: true,
  mutationAllowed: false,
});

export const NANSEN_SAMPLED_BUYER_PRESSURE_RULE = Object.freeze({
  version: "nansen-selected-sampled-net-buyer-pressure-v1",
  evidenceBoundary: "2026-08-04T06:23:28.942Z",
  parentRuleVersion: NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.version,
  changedDimension: "sampled-top-buyer-to-seller-dollar-ratio-at-least-one",
  minimumSampledBuySellUsdRatioInclusive: 1,
  decisionRule: "Paper-long only when the unchanged Nansen 6h Smart Money parent has a complete full-profile sampled buyer/seller dollar ratio at least 1; otherwise paper cash.",
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumTradedObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  derivationStatus: "future-only-child-of-predeclared-multiple-screen-family",
  derivationNote: "A post-registration read-only audit found two selected observations across two tokens and two traded frames, +7.127933% base and +3.127933% stress equal-weight frame payoff, but one winner supplied every gain. All inspected snapshots, forecasts, paths, and outcomes are excluded. The inclusive ratio-one boundary was predeclared before those outcomes and was not retuned.",
  researchOnly: true,
  mutationAllowed: false,
});

export const NANSEN_ORGANIC_ACTIVITY_SCREENS = Object.freeze([
  {
    id: "sampled-net-buyer-pressure",
    test: (row) => finiteAtLeast(row.sampledBuySellUsdRatio, 1),
  },
  {
    id: "distributed-sampled-flow",
    test: distributedSampledFlow,
  },
  {
    id: "repeat-trader-depth",
    test: (row) => finiteBetween(row.medianTopPnlTradeCount, 2, 10),
  },
  {
    id: "low-profit-overhang",
    test: (row) => finiteAtMost(row.profitOverhangToLiquidity, 0.3),
  },
  {
    id: "organic-activity-consensus",
    test: organicActivityConsensus,
  },
]);

export function buildNansenOrganicActivityMonitoringScorecard(events) {
  const cohort = validatedNansenOrganicActivityRows(
    events,
    NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.evidenceBoundary,
  );
  const { candidates, openForecasts, rows, rejectionCounts } = cohort;
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "nansen-organic-activity-monitoring-scorecard",
    ruleVersion: NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.version,
    evidenceBoundary: NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.evidenceBoundary,
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
    screens: NANSEN_ORGANIC_ACTIVITY_SCREENS.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, screen.test),
    })),
    chronologicalHalves: chronologicalHalves(frames),
    derivationDebt: {
      oneHour: {
        rawObservations: 17,
        independentFrames: 14,
        conclusion: "Every nonempty predeclared screen was negative after 4% and 12% costs; the least-bad composite selected three observations from one token and remained negative.",
      },
      sixHour: {
        rawObservations: 22,
        weightedObservations: 16,
        independentFrames: 5,
        conclusion: "Every nonempty predeclared screen was negative after 4% and 12% costs.",
      },
      nextDay: {
        rawObservations: 15,
        weightedObservations: 6,
        independentFrames: 2,
        conclusion: "Positive screens were dominated by one later +68.435712% NEEGY frame; the composite selected one token, so no challenger was registered.",
      },
      promotionalUseAllowed: false,
    },
    note: "This multiple-screen family generates future hypotheses only. It requires later Nansen-6h-selected full profiles, exact live one-hour outcomes, and registered execution evidence. It cannot authorize or mutate a challenger.",
  };
}

export function validatedNansenOrganicActivityRows(events, evidenceBoundary) {
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
    && event.modelVersion === NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.parentModelVersion
    && event.candidateId === NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.parentCandidateId
    && event.horizon === NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.horizon
    && Date.parse(event.createdAt) > Date.parse(evidenceBoundary)
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
  return {
    candidates,
    openForecasts,
    rows,
    rejectionCounts,
  };
}

export function createNansenSampledBuyerPressureRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: NANSEN_SAMPLED_BUYER_PRESSURE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerNansenSampledBuyerPressure(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createNansenSampledBuyerPressureRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(NANSEN_SAMPLED_BUYER_PRESSURE_RULE.evidenceBoundary))) {
    throw new Error("Nansen sampled buyer-pressure registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesSampledBuyerPressureRegistration(existing)) {
    throw new Error("Existing Nansen sampled buyer-pressure registration mismatch.");
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

export function buildNansenSampledBuyerPressureScorecard(events) {
  const rule = NANSEN_SAMPLED_BUYER_PRESSURE_RULE;
  const registration = events.find(matchesSampledBuyerPressureRegistration) ?? null;
  const cohort = registration
    ? validatedNansenOrganicActivityRows(events, laterIso(
      rule.evidenceBoundary,
      registration.registeredAt,
    ))
    : { candidates: [], openForecasts: 0, rows: [], rejectionCounts: {} };
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const selectedTest = (row) => finiteAtLeast(
    row.sampledBuySellUsdRatio,
    rule.minimumSampledBuySellUsdRatioInclusive,
  );
  const selected = weighted.filter(selectedTest);
  const tradedFrames = frames.filter((frame) => frame.some(selectedTest));
  const uniqueTradedTokens = new Set(selected.map(tokenEdgeAssetKey)).size;
  const parentBase = frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct)));
  const childBase = frames.map((frame) => mean(frame.map((row) => (
    selectedTest(row) ? row.baseCapacityReturnPct : 0
  ))));
  const deltas = childBase.map((value, index) => value - parentBase[index]);
  const childCi95 = childBase.length >= 2
    ? bootstrapMeanInterval(childBase, rule.bootstrapIterations) : [null, null];
  const pairedCi95 = deltas.length >= 2
    ? bootstrapMeanInterval(deltas, rule.bootstrapIterations) : [null, null];
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const summary = summarizeFrames(frames, selectedTest);
  const evidenceReady = weighted.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentFrames
    && uniqueTradedTokens >= rule.minimumUniqueTokens
    && selected.length >= rule.minimumTradedObservations
    && tradedFrames.length >= rule.minimumIndependentTradedFrames;
  return {
    type: "nansen-sampled-net-buyer-pressure-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: cohort.candidates.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    independentTradedFrames: tradedFrames.length,
    uniqueTokens: new Set(weighted.map(tokenEdgeAssetKey)).size,
    uniqueTradedTokens,
    tradedObservations: selected.length,
    rejectionCounts: cohort.rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    child: summary,
    childBootstrapMeanReturnCi95Pct: childCi95.map((value) => nullableRound(value, 6)),
    pairedBootstrapMeanDeltaCi95Pct: pairedCi95.map((value) => nullableRound(value, 6)),
    profitFactor: nullableRound(factor, 6),
    maxDrawdownPct: nullableRound(drawdown, 6),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weighted.length),
      independentFrames: Math.max(0, rule.minimumIndependentFrames - frames.length),
      uniqueTradedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueTradedTokens),
      tradedObservations: Math.max(0, rule.minimumTradedObservations - selected.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - tradedFrames.length,
      ),
    },
    provisionalGate: Boolean(
      evidenceReady
      && childCi95[0] > 0
      && pairedCi95[0] > 0
      && summary.challengerStressCapacityReturnPct > 0
      && factor >= TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor
      && drawdown <= TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct
      && Number.isFinite(summary.largestWinningFrameShare)
      && summary.largestWinningFrameShare
        <= TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare
    ),
    note: "This future-only paper child changes only whether the unchanged Nansen 6h Smart Money parent follows a complete sampled top-buyer/top-seller dollar ratio of at least one. The two inspected seed rows and every forecast at registration are excluded. Missing or invalid full-profile evidence is cash; the rule cannot spend credits, backfill, mutate, promote, or trade.",
  };
}

function monitoringLineageReason(forecast, snapshot) {
  if (forecast.status !== "ready" || forecast.predictedRise !== true) {
    return "parent-not-ready-long";
  }
  if (forecast.selectionProvider !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.selectionProvider
    || forecast.selectionTimeframe !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.selectionTimeframe) {
    return "wrong-forecast-selection-lineage";
  }
  if (!snapshot || snapshot.chain !== forecast.chain
    || snapshot.tokenAddress !== forecast.tokenAddress) return "missing-or-mismatched-snapshot";
  if (snapshot.selection?.status !== "verified"
    || snapshot.selection?.provider !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.selectionProvider
    || snapshot.selection?.timeframe !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.selectionTimeframe
    || snapshot.selection?.discoveryEventId !== forecast.selectionDiscoveryEventId
    || snapshot.selection?.confirmationEventId !== forecast.selectionConfirmationEventId) {
    return "wrong-snapshot-selection-lineage";
  }
  if (snapshot.nansen?.status !== "ok"
    || snapshot.nansen?.profile !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.requiredNansenProfile
    || !snapshot.nansen?.aggregates) return "missing-full-nansen-profile";
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
  if (forecast.roundTripCostPct !== NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.baseRoundTripCostPct) {
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
  const aggregates = snapshot.nansen.aggregates;
  const evidence = outcome.executionEvidence;
  const baseCapacityReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: evidence.entryLiquidityUsd,
    exitLiquidityUsd: evidence.exitLiquidityUsd,
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    roundTripCostPct: NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.baseRoundTripCostPct,
  });
  const stressCapacityReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: evidence.entryLiquidityUsd,
    exitLiquidityUsd: evidence.exitLiquidityUsd,
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    roundTripCostPct: NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.stressRoundTripCostPct,
  });
  return {
    forecastId: forecast.id,
    snapshotId: snapshot.id,
    createdAt: forecast.createdAt,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    symbol: forecast.symbol,
    grossReturnPct: outcome.grossReturnPct,
    baseFlatReturnPct: round(
      outcome.grossReturnPct - NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.baseRoundTripCostPct,
      6,
    ),
    stressFlatReturnPct: round(
      outcome.grossReturnPct - NANSEN_ORGANIC_ACTIVITY_MONITORING_RULE.stressRoundTripCostPct,
      6,
    ),
    baseCapacityReturnPct,
    stressCapacityReturnPct,
    sampledBuyerCount: aggregates.sampledBuyerCount,
    sampledSellerCount: aggregates.sampledSellerCount,
    sampledBuySellUsdRatio: aggregates.sampledBuySellUsdRatio,
    topSampledBuyerVolumeShare: aggregates.topSampledBuyerVolumeShare,
    sampledBuyerVolumeHhi: aggregates.sampledBuyerVolumeHhi,
    topSampledSellerVolumeShare: aggregates.topSampledSellerVolumeShare,
    sampledSellerVolumeHhi: aggregates.sampledSellerVolumeHhi,
    medianTopPnlTradeCount: aggregates.medianTopPnlTradeCount,
    top10OwnershipPct: aggregates.top10OwnershipPct,
    accumulatingHolderShare: aggregates.accumulatingHolderShare,
    positiveSelectiveNetflowShare: aggregates.positiveSelectiveNetflowShare,
    profitOverhangToLiquidity: ratio(
      aggregates.sampledProfitOverhangUsd,
      snapshot.market.liquidityUsd,
    ),
  };
}

function distributedSampledFlow(row) {
  return finiteAtLeast(row.sampledBuyerCount, 10)
    && finiteAtLeast(row.sampledSellerCount, 10)
    && finiteAtMost(row.topSampledBuyerVolumeShare, 0.2)
    && finiteAtMost(row.sampledBuyerVolumeHhi, 0.1)
    && finiteAtMost(row.topSampledSellerVolumeShare, 0.2)
    && finiteAtMost(row.sampledSellerVolumeHhi, 0.1);
}

function organicActivityConsensus(row) {
  return finiteAtLeast(row.sampledBuySellUsdRatio, 1)
    && distributedSampledFlow(row)
    && finiteBetween(row.medianTopPnlTradeCount, 2, 10)
    && finiteAtMost(row.top10OwnershipPct, 0.5)
    && finiteBetween(row.accumulatingHolderShare, 0.2, 0.7)
    && finiteAtLeast(row.positiveSelectiveNetflowShare, 0.6)
    && finiteAtMost(row.profitOverhangToLiquidity, 0.3);
}

function finiteAtLeast(value, threshold) {
  return Number.isFinite(value) && value >= threshold;
}

function finiteAtMost(value, threshold) {
  return Number.isFinite(value) && value <= threshold;
}

function finiteBetween(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function summarizeFrames(frames, test) {
  const frameRows = frames.map((frame) => frame.map((row) => ({ row, selected: test(row) })));
  const selected = frameRows.flat().filter((entry) => entry.selected).map((entry) => entry.row);
  const parentBase = frameRows.map((frame) => mean(frame.map(({ row }) => row.baseCapacityReturnPct)));
  const parentStress = frameRows.map((frame) => mean(frame.map(({ row }) => row.stressCapacityReturnPct)));
  const challengerBase = frameRows.map((frame) => mean(frame.map(({ row, selected: isSelected }) => (
    isSelected ? row.baseCapacityReturnPct : 0
  ))));
  const challengerStress = frameRows.map((frame) => mean(frame.map(({ row, selected: isSelected }) => (
    isSelected ? row.stressCapacityReturnPct : 0
  ))));
  const challengerFlatBase = frameRows.map((frame) => mean(frame.map(({ row, selected: isSelected }) => (
    isSelected ? row.baseFlatReturnPct : 0
  ))));
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frameRows.filter((frame) => frame.some((entry) => entry.selected)).length,
    uniqueTokens: new Set(selected.map((row) => tokenEdgeAssetKey(row))).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length
      : null, 6),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length
      : null, 6),
    explosion25Rate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct >= 25).length / selected.length
      : null, 6),
    parentAverageCapacityReturnPct: nullableRound(mean(parentBase), 6),
    challengerAverageFlatReturnPct: nullableRound(mean(challengerFlatBase), 6),
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
    first: summarizeFrames(frames.slice(0, midpoint), () => true),
    second: summarizeFrames(frames.slice(midpoint), () => true),
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

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && denominator > 0 ? numerator / denominator : null;
}

function mean(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function nullableRound(value, decimals) {
  return Number.isFinite(value) ? round(value, decimals) : null;
}

function round(value, decimals) {
  return Number(Number(value).toFixed(decimals));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function matchesSampledBuyerPressureRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") {
    return false;
  }
  const expected = createNansenSampledBuyerPressureRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && JSON.stringify(event.rule) === JSON.stringify(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function laterIso(left, right) {
  return new Date(Math.max(Date.parse(left), Date.parse(right))).toISOString();
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid registration time is required.");
  return date.toISOString();
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) {
    throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  }
  return events;
}

function bootstrapMeanInterval(values, iterations) {
  const blockSize = Math.max(2, Math.min(values.length, Math.round(Math.sqrt(values.length))));
  const random = seededRandom(0x7e6e1d6e);
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize && sample.length < values.length; offset += 1) {
        sample.push(values[(start + offset) % values.length]);
      }
    }
    means.push(mean(sample));
  }
  means.sort((left, right) => left - right);
  return [percentile(means, 0.025), percentile(means, 0.975)];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function profitFactor(values) {
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0));
  if (losses === 0) return gains > 0 ? 999 : null;
  return gains / losses;
}

function maxDrawdownPct(values) {
  if (!values.length) return 0;
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    if (peak > 0) maximum = Math.max(maximum, ((peak - equity) / peak) * 100);
  }
  return maximum;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const acceptedCommands = new Set([
    "register-buyer-pressure",
    "score-buyer-pressure",
    "score",
  ]);
  const command = acceptedCommands.has(process.argv[2]) ? process.argv[2] : "score";
  const ledgerIndex = process.argv.indexOf("--ledger");
  const ledgerPath = path.resolve(
    ledgerIndex >= 0 && process.argv[ledgerIndex + 1]
      ? process.argv[ledgerIndex + 1]
      : defaultTokenEdgeLedgerPath(),
  );
  const run = async () => {
    if (command === "register-buyer-pressure") {
      process.stdout.write(`${JSON.stringify(
        await registerNansenSampledBuyerPressure({ ledgerPath }),
        null,
        2,
      )}\n`);
      return;
    }
    const events = await verifiedLedger(ledgerPath);
    const scorecard = command === "score-buyer-pressure"
      ? buildNansenSampledBuyerPressureScorecard(events)
      : buildNansenOrganicActivityMonitoringScorecard(events);
    process.stdout.write(`${JSON.stringify({
      ledgerPath,
      verification: verifyLedger(events),
      scorecard,
    }, null, 2)}\n`);
  };
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
