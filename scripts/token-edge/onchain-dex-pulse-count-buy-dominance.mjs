#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_SURFACE_PULSE_RULE,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;

export const DEX_PULSE_COUNT_BUY_DOMINANCE_RULE = Object.freeze({
  version: "dex-surface-pulse-count-buy-dominance-v1",
  evidenceBoundary: "2026-08-03T17:16:30.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  changedDimension: "zero-sell-compatible-five-minute-buy-dominance",
  legacyPolicy: Object.freeze({
    id: "finite-ratio-buy-pressure",
    minimumBuySellTxnRatioInclusive: 1,
    requiresPositiveSellCount: true,
  }),
  countPolicy: Object.freeze({
    id: "positive-buy-count-at-least-sell-count",
    minimumBuyCountInclusive: 1,
    requireBuysAtLeastSells: true,
  }),
  paperNotionalUsd: 100,
  baseRoundTripCostPct: 4,
  stressRoundTripCostPct: 12,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumZeroSellExpansionObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-provider-null-semantics-hypothesis-only",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE = Object.freeze({
  version: "dex-surface-pulse-count-buy-positive-momentum-v2",
  evidenceBoundary: "2026-08-03T23:31:00.000Z",
  parentRuleVersion: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.version,
  changedDimension: "require-positive-five-minute-price-change-sign",
  parentPolicy: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.countPolicy,
  challengerPolicy: Object.freeze({
    id: "positive-buy-count-at-least-sell-count-and-positive-five-minute-momentum",
    minimumBuyCountInclusive: 1,
    requireBuysAtLeastSells: true,
    requirePositiveFiveMinutePriceChange: true,
  }),
  paperNotionalUsd: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.paperNotionalUsd,
  baseRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.baseRoundTripCostPct,
  stressRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.stressRoundTripCostPct,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumPositiveMomentumObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-one-change-from-count-buy-dominance-only",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_COUNT_FLOW_QUALITY_RULE = Object.freeze({
  version: "dex-surface-pulse-count-buy-positive-momentum-minimum-turnover-v3",
  evidenceBoundary: "2026-08-04T00:19:43.000Z",
  parentRuleVersion: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.version,
  changedDimension: "require-one-percent-five-minute-turnover",
  parentPolicy: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.challengerPolicy,
  challengerPolicy: Object.freeze({
    id: "count-buy-positive-momentum-and-one-percent-five-minute-turnover",
    minimumBuyCountInclusive: 1,
    requireBuysAtLeastSells: true,
    requirePositiveFiveMinutePriceChange: true,
    minimumFiveMinuteTurnoverInclusive: 0.01,
  }),
  paperNotionalUsd: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.paperNotionalUsd,
  baseRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.baseRoundTripCostPct,
  stressRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.stressRoundTripCostPct,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumFlowQualityObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-one-change-from-count-positive-momentum-only",
  derivationNote: "A post-outcome seed contrasted FROGE (+36.400986% gross; 0.028544 five-minute turnover) with LetsPlay (-48.096988%; 0.001193 turnover) while both had count buy dominance and positive five-minute momentum. The round 0.01 threshold, those outcomes, every inspected path, and every forecast open at the boundary are derivation-only and excluded. Only strictly later forecasts may test this one additional flow-quality requirement.",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE = Object.freeze({
  version: "dex-surface-pulse-count-buy-positive-five-minute-and-hourly-momentum-v4",
  evidenceBoundary: "2026-08-04T00:48:30.000Z",
  parentRuleVersion: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.version,
  changedDimension: "require-positive-one-hour-price-change-sign",
  parentPolicy: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.challengerPolicy,
  challengerPolicy: Object.freeze({
    id: "count-buy-positive-five-minute-and-one-hour-momentum",
    minimumBuyCountInclusive: 1,
    requireBuysAtLeastSells: true,
    requirePositiveFiveMinutePriceChange: true,
    requirePositiveOneHourPriceChange: true,
  }),
  paperNotionalUsd: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.paperNotionalUsd,
  baseRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.baseRoundTripCostPct,
  stressRoundTripCostPct: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.stressRoundTripCostPct,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumDualMomentumObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-one-change-from-count-positive-momentum-only",
  derivationNote: "A bounded coarse-screen audit across 50 weighted observations and 10 pulse frames found the count-plus-five-minute-momentum parent at +2.244271% base/-0.975729% stress and the one-change positive-hourly-sign screen at +2.515744% base/+0.382411% stress. Only seven frames/tokens traded, the first half remained negative, and one frame supplied 0.4981 of gains. All audited outcomes, paths, and forecasts open at the boundary are derivation-only and excluded.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseCountBuyDominanceRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseCountBuyDominance(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseCountBuyDominanceRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse count buy-dominance registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing count buy-dominance registration mismatch.");
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

export function createDexPulseCountPositiveMomentumRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseCountPositiveMomentum(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const parentRegistration = events.find(matchesRegistration) ?? null;
  if (!parentRegistration) throw new Error("Count buy-dominance parent registration is required.");
  const proposed = createDexPulseCountPositiveMomentumRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.evidenceBoundary))) {
    throw new Error("Count positive-momentum registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesPositiveMomentumRegistration(existing)) {
    throw new Error("Existing count positive-momentum registration mismatch.");
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
    parentRegistrationId: parentRegistration.id,
  };
}

export function createDexPulseCountFlowQualityRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule: DEX_PULSE_COUNT_FLOW_QUALITY_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseCountFlowQuality(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const parentRegistration = events.find(matchesPositiveMomentumRegistration) ?? null;
  if (!parentRegistration) throw new Error("Count positive-momentum parent registration is required.");
  const proposed = createDexPulseCountFlowQualityRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_COUNT_FLOW_QUALITY_RULE.evidenceBoundary))) {
    throw new Error("Count flow-quality registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFlowQualityRegistration(existing)) {
    throw new Error("Existing count flow-quality registration mismatch.");
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
    parentRegistrationId: parentRegistration.id,
  };
}

export function createDexPulseCountDualMomentumRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule: DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseCountDualMomentum(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const parentRegistration = events.find(matchesPositiveMomentumRegistration) ?? null;
  if (!parentRegistration) throw new Error("Count positive-momentum parent registration is required.");
  const proposed = createDexPulseCountDualMomentumRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.evidenceBoundary))) {
    throw new Error("Count dual-momentum registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesDualMomentumRegistration(existing)) {
    throw new Error("Existing count dual-momentum registration mismatch.");
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
    parentRegistrationId: parentRegistration.id,
  };
}

export function buildDexPulseCountBuyDominanceScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = discoveryMap(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const reason = countFlowRejectionReason(row, sourceLiquidityUsd(row, discoveries));
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const metrics = row.forecast.metrics;
    rows.push({
      ...row,
      buysM5: metrics.buysM5,
      sellsM5: metrics.sellsM5,
      fiveMinuteBuySellTxnRatio: metrics.fiveMinuteBuySellTxnRatio,
      legacyDecision: metrics.sellsM5 > 0 && metrics.fiveMinuteBuySellTxnRatio >= 1,
      countDecision: metrics.buysM5 > 0 && metrics.buysM5 >= metrics.sellsM5,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const legacy = policySummary(frames, (row) => row.legacyDecision);
  const count = policySummary(frames, (row) => row.countDecision);
  const legacyFrameBase = policyFrameReturns(frames, (row) => row.legacyDecision, "baseCapacityReturnPct");
  const countFrameBase = policyFrameReturns(frames, (row) => row.countDecision, "baseCapacityReturnPct");
  const pairedDeltas = countFrameBase.map((value, index) => value - legacyFrameBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(pairedDeltas, DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.bootstrapIterations)
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const zeroSellExpansionObservations = weightedRows.filter((row) => (
    row.countDecision && !row.legacyDecision && row.buysM5 > 0 && row.sellsM5 === 0
  )).length;
  const evidenceShortfall = {
    observations: Math.max(0, DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumObservations - weightedRows.length),
    independentFrames: Math.max(
      0,
      DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumUniqueTradedTokens - count.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumIndependentTradedFrames
        - count.independentTradedFrames,
    ),
    zeroSellExpansionObservations: Math.max(
      0,
      DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumZeroSellExpansionObservations
        - zeroSellExpansionObservations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && count.averageCapacityReturnPct > 0
    && count.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && count.profitFactor >= DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.minimumProfitFactor
    && count.maxDrawdownPct <= DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.maximumDrawdownPct
    && count.largestWinningFrameShare <= DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-count-buy-dominance-scorecard",
    ruleVersion: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.version,
    evidenceBoundary: DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    zeroSellExpansionObservations,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    rejectionCounts,
    legacyFiniteRatioPolicy: legacy,
    countDominancePolicy: count,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper monitor changes only five-minute buy-pressure representation: nonnegative transaction counts make buys>0 and buys>=sells valid even when zero sells forces the provider ratio to null. Zero/zero remains cash. It compares that policy with the frozen finite-ratio policy inside the same independent frames and cannot mutate, promote, or trade.",
  };
}

export function buildDexPulseCountPositiveMomentumScorecard(events) {
  const registration = events.find(matchesPositiveMomentumRegistration) ?? null;
  const parentRegistration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = discoveryMap(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const reason = countFlowRejectionReason(row, sourceLiquidityUsd(row, discoveries));
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const metrics = row.forecast.metrics;
    rows.push({
      ...row,
      buysM5: metrics.buysM5,
      sellsM5: metrics.sellsM5,
      priceChangeM5Pct: metrics.priceChangeM5Pct,
      countDecision: metrics.buysM5 > 0 && metrics.buysM5 >= metrics.sellsM5,
      positiveMomentumDecision: metrics.buysM5 > 0
        && metrics.buysM5 >= metrics.sellsM5
        && Number.isFinite(metrics.priceChangeM5Pct)
        && metrics.priceChangeM5Pct > 0,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parent = policySummary(frames, (row) => row.countDecision);
  const challenger = policySummary(frames, (row) => row.positiveMomentumDecision);
  const parentFrameBase = policyFrameReturns(
    frames,
    (row) => row.countDecision,
    "baseCapacityReturnPct",
  );
  const challengerFrameBase = policyFrameReturns(
    frames,
    (row) => row.positiveMomentumDecision,
    "baseCapacityReturnPct",
  );
  const pairedDeltas = challengerFrameBase.map((value, index) => value - parentFrameBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(
      pairedDeltas,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.bootstrapIterations,
    )
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumObservations - weightedRows.length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumUniqueTradedTokens
        - challenger.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumIndependentTradedFrames
        - challenger.independentTradedFrames,
    ),
    positiveMomentumObservations: Math.max(
      0,
      DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumPositiveMomentumObservations
        - challenger.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && challenger.averageCapacityReturnPct > 0
    && challenger.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && challenger.profitFactor >= DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.minimumProfitFactor
    && challenger.maxDrawdownPct <= DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.maximumDrawdownPct
    && challenger.largestWinningFrameShare
      <= DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-count-buy-positive-momentum-scorecard",
    ruleVersion: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.version,
    evidenceBoundary: DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRegistrationId: parentRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    rejectionCounts,
    countDominanceParentPolicy: parent,
    countPositiveMomentumPolicy: challenger,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper challenger adds only a positive five-minute source-price-change sign to the frozen count buy-dominance parent. All inspected outcomes and every forecast created before registration are excluded. Missing momentum holds challenger cash; it cannot backfill, retune, promote, mutate, or trade.",
  };
}

export function buildDexPulseCountFlowQualityScorecard(events) {
  const registration = events.find(matchesFlowQualityRegistration) ?? null;
  const parentRegistration = events.find(matchesPositiveMomentumRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = discoveryMap(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const reason = countFlowRejectionReason(row, sourceLiquidityUsd(row, discoveries));
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const metrics = row.forecast.metrics;
    const positiveMomentumDecision = metrics.buysM5 > 0
      && metrics.buysM5 >= metrics.sellsM5
      && Number.isFinite(metrics.priceChangeM5Pct)
      && metrics.priceChangeM5Pct > 0;
    rows.push({
      ...row,
      buysM5: metrics.buysM5,
      sellsM5: metrics.sellsM5,
      priceChangeM5Pct: metrics.priceChangeM5Pct,
      fiveMinuteTurnover: metrics.fiveMinuteTurnover,
      positiveMomentumDecision,
      flowQualityDecision: positiveMomentumDecision
        && metrics.fiveMinuteTurnover
          >= DEX_PULSE_COUNT_FLOW_QUALITY_RULE.challengerPolicy
            .minimumFiveMinuteTurnoverInclusive,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parent = policySummary(frames, (row) => row.positiveMomentumDecision);
  const challenger = policySummary(frames, (row) => row.flowQualityDecision);
  const parentFrameBase = policyFrameReturns(
    frames,
    (row) => row.positiveMomentumDecision,
    "baseCapacityReturnPct",
  );
  const challengerFrameBase = policyFrameReturns(
    frames,
    (row) => row.flowQualityDecision,
    "baseCapacityReturnPct",
  );
  const pairedDeltas = challengerFrameBase.map((value, index) => value - parentFrameBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(pairedDeltas, DEX_PULSE_COUNT_FLOW_QUALITY_RULE.bootstrapIterations)
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumObservations - weightedRows.length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumUniqueTradedTokens
        - challenger.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumIndependentTradedFrames
        - challenger.independentTradedFrames,
    ),
    flowQualityObservations: Math.max(
      0,
      DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumFlowQualityObservations
        - challenger.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && challenger.averageCapacityReturnPct > 0
    && challenger.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && challenger.profitFactor >= DEX_PULSE_COUNT_FLOW_QUALITY_RULE.minimumProfitFactor
    && challenger.maxDrawdownPct <= DEX_PULSE_COUNT_FLOW_QUALITY_RULE.maximumDrawdownPct
    && challenger.largestWinningFrameShare
      <= DEX_PULSE_COUNT_FLOW_QUALITY_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-count-buy-positive-momentum-minimum-turnover-scorecard",
    ruleVersion: DEX_PULSE_COUNT_FLOW_QUALITY_RULE.version,
    evidenceBoundary: DEX_PULSE_COUNT_FLOW_QUALITY_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRegistrationId: parentRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    rejectionCounts,
    countPositiveMomentumParentPolicy: parent,
    countFlowQualityPolicy: challenger,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper challenger adds only a round one-percent five-minute turnover floor to the frozen count-plus-positive-momentum parent. The FROGE/LetsPlay derivation frame, every inspected outcome/path, and every forecast open at registration are excluded. Missing or inconsistent flow holds challenger cash; it cannot backfill, retune, promote, mutate, or trade.",
  };
}

export function buildDexPulseCountDualMomentumScorecard(events) {
  const registration = events.find(matchesDualMomentumRegistration) ?? null;
  const parentRegistration = events.find(matchesPositiveMomentumRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = discoveryMap(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const reason = countFlowRejectionReason(row, sourceLiquidityUsd(row, discoveries));
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const metrics = row.forecast.metrics;
    if (!Number.isFinite(metrics.priceChangeH1Pct)) {
      increment(rejectionCounts, "missing-or-invalid-one-hour-momentum");
      continue;
    }
    const positiveMomentumDecision = metrics.buysM5 > 0
      && metrics.buysM5 >= metrics.sellsM5
      && Number.isFinite(metrics.priceChangeM5Pct)
      && metrics.priceChangeM5Pct > 0;
    rows.push({
      ...row,
      buysM5: metrics.buysM5,
      sellsM5: metrics.sellsM5,
      priceChangeM5Pct: metrics.priceChangeM5Pct,
      priceChangeH1Pct: metrics.priceChangeH1Pct,
      positiveMomentumDecision,
      dualMomentumDecision: positiveMomentumDecision && metrics.priceChangeH1Pct > 0,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parent = policySummary(frames, (row) => row.positiveMomentumDecision);
  const challenger = policySummary(frames, (row) => row.dualMomentumDecision);
  const parentFrameBase = policyFrameReturns(
    frames,
    (row) => row.positiveMomentumDecision,
    "baseCapacityReturnPct",
  );
  const challengerFrameBase = policyFrameReturns(
    frames,
    (row) => row.dualMomentumDecision,
    "baseCapacityReturnPct",
  );
  const pairedDeltas = challengerFrameBase.map((value, index) => value - parentFrameBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(pairedDeltas, DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.bootstrapIterations)
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumObservations - weightedRows.length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumUniqueTradedTokens
        - challenger.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumIndependentTradedFrames
        - challenger.independentTradedFrames,
    ),
    dualMomentumObservations: Math.max(
      0,
      DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumDualMomentumObservations
        - challenger.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && challenger.averageCapacityReturnPct > 0
    && challenger.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && challenger.profitFactor >= DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.minimumProfitFactor
    && challenger.maxDrawdownPct <= DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.maximumDrawdownPct
    && challenger.largestWinningFrameShare
      <= DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-count-buy-dual-momentum-scorecard",
    ruleVersion: DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.version,
    evidenceBoundary: DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRegistrationId: parentRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    rejectionCounts,
    countPositiveMomentumParentPolicy: parent,
    countDualMomentumPolicy: challenger,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper challenger adds only a positive one-hour source-price-change sign to the frozen count-plus-positive-five-minute-momentum parent. Every audited outcome/path and every forecast open at registration are excluded. Missing hourly momentum holds challenger cash; it cannot backfill, retune, promote, mutate, or trade.",
  };
}

function countFlowRejectionReason(row, sourceLiquidity) {
  const metrics = row.forecast.metrics ?? {};
  if (!Number.isInteger(metrics.buysM5) || metrics.buysM5 < 0
    || !Number.isInteger(metrics.sellsM5) || metrics.sellsM5 < 0
    || !Number.isFinite(metrics.volumeM5Usd) || metrics.volumeM5Usd < 0
    || !Number.isFinite(metrics.fiveMinuteTurnover) || metrics.fiveMinuteTurnover < 0
    || !(sourceLiquidity > 0)) return "missing-or-invalid-five-minute-count-flow";
  if (metrics.fiveMinuteTurnover !== roundRatio(
    metrics.volumeM5Usd,
    sourceLiquidity,
  )) return "inconsistent-five-minute-turnover";
  if (metrics.sellsM5 === 0) {
    return metrics.fiveMinuteBuySellTxnRatio === null ? null : "inconsistent-zero-sell-ratio";
  }
  if (!Number.isFinite(metrics.fiveMinuteBuySellTxnRatio)
    || metrics.fiveMinuteBuySellTxnRatio !== roundRatio(metrics.buysM5, metrics.sellsM5)) {
    return "inconsistent-finite-buy-sell-ratio";
  }
  return null;
}

function discoveryMap(events) {
  return new Map(events.filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
}

function sourceLiquidityUsd(row, discoveries) {
  const discovery = discoveries.get(row.forecast.discoveryEventId);
  const candidate = (discovery?.candidates ?? []).find((item) => (
    item.chain === row.forecast.chain
    && item.tokenAddress === row.forecast.tokenAddress
    && item.pairAddress === row.forecast.pairAddress
  ));
  return candidate?.liquidityUsd ?? null;
}

function policySummary(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const base = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const stress = policyFrameReturns(frames, test, "stressCapacityReturnPct");
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map(tokenEdgeAssetKey)).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length : null),
    averageCapacityReturnPct: nullableRound(mean(base)),
    stressAverageCapacityReturnPct: nullableRound(mean(stress)),
    profitFactor: nullableRound(profitFactor(base)),
    maxDrawdownPct: nullableRound(maxDrawdownPct(base)),
    largestWinningFrameShare: nullableRound(largestWinningShare(base)),
  };
}

function policyFrameReturns(frames, test, field) {
  return frames.map((frame) => mean(frame.map((row) => test(row) ? row[field] : 0)));
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCountBuyDominanceRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesPositiveMomentumRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCountPositiveMomentumRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFlowQualityRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCountFlowQualityRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesDualMomentumRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCountDualMomentumRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0x6a09e667;
  const random = () => {
    state = ((state * 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

function quantile(values, probability) {
  if (!values.length) return null;
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? values[lower]
    : values[lower] + ((values[upper] - values[lower]) * (index - lower));
}

function profitFactor(values) {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? 999 : null;
  return wins / losses;
}

function maxDrawdownPct(values) {
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return maximum;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function roundRatio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? Math.round((numerator / denominator) * 1e6) / 1e6 : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "score", "register-positive-momentum", "score-positive-momentum",
    "register-flow-quality", "score-flow-quality", "register-dual-momentum",
    "score-dual-momentum"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-count-buy-dominance.mjs register|score|register-positive-momentum|score-positive-momentum|register-flow-quality|score-flow-quality|register-dual-momentum|score-dual-momentum [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseCountBuyDominance(options), null, 2));
    } else if (options.command === "register-positive-momentum") {
      console.log(JSON.stringify(await registerDexPulseCountPositiveMomentum(options), null, 2));
    } else if (options.command === "register-flow-quality") {
      console.log(JSON.stringify(await registerDexPulseCountFlowQuality(options), null, 2));
    } else if (options.command === "register-dual-momentum") {
      console.log(JSON.stringify(await registerDexPulseCountDualMomentum(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-positive-momentum"
          ? buildDexPulseCountPositiveMomentumScorecard(events)
          : options.command === "score-flow-quality"
            ? buildDexPulseCountFlowQualityScorecard(events)
            : options.command === "score-dual-momentum"
              ? buildDexPulseCountDualMomentumScorecard(events)
              : buildDexPulseCountBuyDominanceScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
