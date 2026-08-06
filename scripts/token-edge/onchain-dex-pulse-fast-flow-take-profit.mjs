#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE,
  DEX_SURFACE_PULSE_RULE,
  validDexPulseStoredProviderPriceIntegrity,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_FAST_FLOW_RULE,
  createDexPulseFastFlowRegistrationEvent,
  passesFastFlowScreen,
} from "./onchain-dex-pulse-fast-flow-monitoring.mjs";
import {
  DEX_EARLY_MONITORING_RULE,
  passesDexEarlyMonitoringScreen,
} from "./onchain-dex-early-monitoring-scorecard.mjs";
import {
  DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE,
  createDexPulseCrossWindowReversalRegistrationEvent,
} from "./onchain-dex-pulse-cross-window-reversal.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const PATH_CADENCE_MS = 5 * 60_000;

export const DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE = Object.freeze({
  version: "dex-pulse-five-minute-buy-pressure-take-profit-v1",
  evidenceBoundary: "2026-08-03T16:34:00.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourceFastFlowRuleVersion: DEX_PULSE_FAST_FLOW_RULE.version,
  sourceScreenId: "five-minute-buy-pressure",
  entryRule: "Paper-long only when the frozen five-minute buy/sell transaction ratio is at least 1; otherwise paper cash.",
  takeProfitGrossReturnPctInclusive: 10,
  exitRule: "For screened paper-longs, exit all at the first retained complete-path point at or above +10% gross; otherwise use the exact one-hour outcome. No unseen crossing is inferred.",
  minimumPathMarks: 6,
  maximumPathGapMs: 10 * 60_000,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumTakeProfitExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "posthoc-combination-hypothesis-only",
  derivation: Object.freeze({
    inspectedIndependentFrames: 1,
    changedDimension: "add-existing-plus-ten-point-exit-to-frozen-five-minute-buy-pressure-entry-screen",
    warning: "All pulse forecasts, marks, and outcomes inspected while forming this combination are excluded. The apparent source mean was one independent seed frame and was not stress profitable.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE = Object.freeze({
  ...DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE,
  version: "dex-pulse-five-minute-buy-pressure-take-profit-cadence-v2",
  evidenceBoundary: "2026-08-03T20:45:40.000Z",
  maximumPathBucketGapMs: 10 * 60_000,
  pathCadenceBasis: "observed-time-at-forecast-boundaries-and-retained-bucket-time-internally",
  derivationStatus: "posthoc-scheduler-jitter-hypothesis-only",
  derivation: Object.freeze({
    inspectedIndependentFrames: 2,
    changedDimension: "path-coverage-clock-only",
    warning: "DORKL was excluded by v1 when retained 19:50 and 20:00 bucket observations were 600.176 seconds apart. DORKL and all evidence through the boundary are excluded; entry, exit, price-integrity, cost, and promotion rules are unchanged.",
  }),
});

export const DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE = Object.freeze({
  ...DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE,
  version: "dex-pulse-cross-window-reversal-take-profit-v1",
  evidenceBoundary: "2026-08-04T04:34:23.000Z",
  sourceReversalRuleVersion: DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.version,
  sourceScreenId: "negative-five-minute-positive-one-hour-reversal-state",
  entryRule: "Paper-long only when the frozen cross-window reversal parent has negative five-minute and positive one-hour source price momentum; otherwise paper cash.",
  derivationStatus: "live-path-inspected-transfer-hypothesis-only",
  derivation: Object.freeze({
    inspectedIndependentFrames: 1,
    changedDimension: "add-existing-plus-ten-point-exit-to-frozen-cross-window-reversal-entry-screen",
    warning: "FROGE crossed +17.616241% on a retained live mark after entering the already frozen reversal state. FROGE, its open forecast, every inspected mark, and all evidence through the boundary are excluded. The +10% exit and cadence rules are copied unchanged from prior sealed policies; no final outcome was known when this transfer was frozen.",
  }),
});

export const DEX_PULSE_SCREEN_EXIT_HYPOTHESIS_AUDIT = Object.freeze({
  version: "dex-pulse-buy-pressure-positive-momentum-exit-hypothesis-audit-v1",
  sourceScreenId: "buy-pressure-positive-momentum",
  sourceScreenRuleVersion: DEX_EARLY_MONITORING_RULE.version,
  stopLossGrossReturnPctInclusive: -10,
  takeProfitGrossReturnPctInclusive: 10,
  trimFraction: 0.5,
  minimumPathMarks: 6,
  maximumPathGapMs: 10 * 60_000,
  maximumPathBucketGapMs: 10 * 60_000,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  hypothesisFamily: Object.freeze([
    "fixed-one-hour-hold",
    "transferred-minus-ten-tail-stop",
    "transferred-plus-ten-full-take-profit",
    "transferred-plus-ten-half-trim",
    "transferred-minus-ten-plus-ten-asymmetric-bracket",
  ]),
  status: "posthoc-hypothesis-audit-only",
  promotionAllowed: false,
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseBuyPressureTakeProfitRegistrationEvent(registeredAt = new Date()) {
  return createRegistrationEvent(DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE, registeredAt);
}

export function createDexPulseCadenceTolerantTakeProfitRegistrationEvent(
  registeredAt = new Date(),
) {
  return createRegistrationEvent(DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE, registeredAt);
}

export function createDexPulseCrossWindowReversalTakeProfitRegistrationEvent(
  registeredAt = new Date(),
) {
  return createRegistrationEvent(
    DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE,
    registeredAt,
  );
}

function createRegistrationEvent(rule, registeredAt) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule,
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

export async function registerDexPulseBuyPressureTakeProfit(options = {}, dependencies = {}) {
  return registerTakeProfitRule(
    options,
    dependencies,
    DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE,
    createDexPulseBuyPressureTakeProfitRegistrationEvent,
    matchesRegistration,
  );
}

export async function registerDexPulseCadenceTolerantTakeProfit(
  options = {}, dependencies = {},
) {
  return registerTakeProfitRule(
    options,
    dependencies,
    DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE,
    createDexPulseCadenceTolerantTakeProfitRegistrationEvent,
    matchesCadenceTolerantRegistration,
  );
}

export async function registerDexPulseCrossWindowReversalTakeProfit(
  options = {}, dependencies = {},
) {
  return registerTakeProfitRule(
    options,
    dependencies,
    DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE,
    createDexPulseCrossWindowReversalTakeProfitRegistrationEvent,
    matchesCrossWindowReversalTakeProfitRegistration,
    matchesCrossWindowReversalRegistration,
    "Register the frozen DEX pulse cross-window reversal panel before its take-profit challenger.",
  );
}

async function registerTakeProfitRule(
  options,
  dependencies,
  rule,
  createEvent,
  matchesEvent,
  prerequisiteMatcher = matchesFastFlowRegistration,
  prerequisiteError = "Register the frozen DEX pulse fast-flow panel before its take-profit challenger.",
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(prerequisiteMatcher)) throw new Error(prerequisiteError);
  const proposed = createEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    rule.evidenceBoundary,
  ))) throw new Error("DEX pulse buy-pressure take-profit registration must be strictly after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesEvent(existing)) {
    throw new Error(`Existing DEX pulse buy-pressure take-profit registration mismatch: ${proposed.id}`);
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

export function buildDexPulseBuyPressureTakeProfitScorecard(events) {
  return buildTakeProfitScorecard(
    events,
    DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE,
    matchesRegistration,
  );
}

export function buildDexPulseCadenceTolerantTakeProfitScorecard(events) {
  return buildTakeProfitScorecard(
    events,
    DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE,
    matchesCadenceTolerantRegistration,
  );
}

export function buildDexPulseCrossWindowReversalTakeProfitScorecard(events) {
  return buildTakeProfitScorecard(
    events,
    DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE,
    matchesCrossWindowReversalTakeProfitRegistration,
    {
      sourceRegistrationMatcher: matchesCrossWindowReversalRegistration,
      sourceRegistrationIdField: "sourceCrossWindowReversalRegistrationId",
      scorecardType: "dex-pulse-cross-window-reversal-take-profit-scorecard",
      rowRejectionReason: crossWindowReversalRejectionReason,
      sourceInvalidAsCash: true,
      entryPredicate: passesCrossWindowReversal,
      entryMetrics: (row) => ({
        entryFiveMinutePriceChangePct: row.priceChangeM5Pct,
        entryOneHourPriceChangePct: row.priceChangeH1Pct,
      }),
      note: "This future-only paper challenger changes only the exit of the already frozen negative-five-minute/positive-one-hour reversal entry. It uses the existing first observed +10% complete-path take-profit, exact-pair integrity, cadence, capacity, cost, independent-frame, and promotion contracts. FROGE and every path inspected before registration remain excluded.",
    },
  );
}

export function buildDexPulseScreenExitHypothesisAudit(events) {
  const rule = DEX_PULSE_SCREEN_EXIT_HYPOTHESIS_AUDIT;
  const screen = DEX_EARLY_MONITORING_RULE.screens.find(
    (candidate) => candidate.id === rule.sourceScreenId,
  );
  if (!screen) throw new Error(`Missing frozen source screen: ${rule.sourceScreenId}`);
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const pathsByForecast = linkedPulsePaths(events);
  const mainPathsByTokenBucket = new Map(events.filter((event) => (
    event.type === "forecast-path-observation"
  )).map((event) => [`${event.tokenAddress}:${event.bucketStartedAt}`, event]));
  const pathExclusionCounts = {};
  const observations = [];
  for (const row of pulse.rows) {
    const validPaths = [];
    for (const event of pathsByForecast.get(row.forecastId) ?? []) {
      const reason = pulsePathRejectionReason(event, row.forecast, mainPathsByTokenBucket);
      if (reason) increment(pathExclusionCounts, reason);
      else validPaths.push(event);
    }
    validPaths.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const coverageReason = pathCoverageReason(validPaths, row.forecast, rule);
    if (coverageReason) {
      increment(pathExclusionCounts, coverageReason);
      continue;
    }
    const entryTraded = passesDexEarlyMonitoringScreen(row, screen);
    const firstStop = entryTraded ? validPaths.find((event) => (
      event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive
    )) : null;
    const firstTakeProfit = entryTraded ? validPaths.find((event) => (
      event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
    )) : null;
    const firstBracket = entryTraded ? validPaths.find((event) => (
      event.grossReturnFromEntryPct <= rule.stopLossGrossReturnPctInclusive
      || event.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
    )) : null;
    const policies = {
      hold: policyOutcome(row, null, entryTraded, rule),
      tailStop: policyOutcome(row, firstStop, entryTraded, rule),
      fullTakeProfit: policyOutcome(row, firstTakeProfit, entryTraded, rule),
      halfTrim: policyOutcome(row, firstTakeProfit, entryTraded, rule, rule.trimFraction),
      asymmetricBracket: policyOutcome(
        row,
        firstBracket,
        entryTraded,
        rule,
        firstBracket?.grossReturnFromEntryPct >= rule.takeProfitGrossReturnPctInclusive
          ? rule.trimFraction : null,
      ),
    };
    if (!Object.values(policies).every((policy) => (
      Number.isFinite(policy.baseNetReturnPct)
      && Number.isFinite(policy.stressNetReturnPct)
    ))) {
      increment(pathExclusionCounts, "unscorable-capacity-return");
      continue;
    }
    observations.push({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      dueAt: row.forecast.dueAt,
      validPathMarks: validPaths.length,
      entryTraded,
      exactOneHourGrossReturnPct: row.grossReturnPct,
      policies,
    });
  }
  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const summaries = Object.fromEntries([
    ["hold", "fixed-one-hour-hold"],
    ["tailStop", "transferred-minus-ten-tail-stop"],
    ["fullTakeProfit", "transferred-plus-ten-full-take-profit"],
    ["halfTrim", "transferred-plus-ten-half-trim"],
    ["asymmetricBracket", "transferred-minus-ten-plus-ten-asymmetric-bracket"],
  ].map(([key, id]) => [key, summarizeExitHypothesis(frames, weighted, key, id, rule)]));
  return {
    type: "dex-pulse-screen-exit-hypothesis-audit",
    ruleVersion: rule.version,
    sourceScreenId: rule.sourceScreenId,
    sourceScreenRuleVersion: rule.sourceScreenRuleVersion,
    status: rule.status,
    promotionAllowed: false,
    researchOnly: true,
    mutationAllowed: false,
    eligibleCompletePathObservations: observations.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    selectedWeightedObservations: weighted.filter((row) => row.entryTraded).length,
    selectedIndependentFrames: frames.filter((frame) => frame.some((row) => row.entryTraded)).length,
    selectedUniqueTokens: new Set(weighted.filter((row) => row.entryTraded)
      .map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    pathExclusionCounts,
    policies: summaries,
    observationsDetail: observations,
    note: "This read-only, post-hoc audit applies only previously frozen -10% stop and +10% exit mechanics to the already frozen buy-pressure-plus-positive-hourly-momentum screen. It requires complete immutable same-pair paths, treats false entry screens as cash, and cannot validate or promote any policy. Every inspected forecast must be excluded from a later prospective challenger.",
  };
}

function policyOutcome(row, pathExit, entryTraded, rule, trimFraction = null) {
  if (!entryTraded) return {
    exitSource: "entry-screen-cash",
    exitObservedAt: row.createdAt,
    baseNetReturnPct: 0,
    stressNetReturnPct: 0,
  };
  const isTrim = pathExit && Number.isFinite(trimFraction);
  const baseNetReturnPct = isTrim ? blendedCapacityReturn({
    row,
    pathExit,
    trimFraction,
    roundTripCostPct: rule.baseRoundTripCostPct,
    rule,
  }) : capacityReturn(
    pathExit?.grossReturnFromEntryPct ?? row.grossReturnPct,
    row.forecast.entryLiquidityUsd,
    pathExit?.observedLiquidityUsd ?? row.resolution.exitLiquidityUsd,
    rule.baseRoundTripCostPct,
    rule,
  );
  const stressNetReturnPct = isTrim ? blendedCapacityReturn({
    row,
    pathExit,
    trimFraction,
    roundTripCostPct: rule.stressRoundTripCostPct,
    rule,
  }) : capacityReturn(
    pathExit?.grossReturnFromEntryPct ?? row.grossReturnPct,
    row.forecast.entryLiquidityUsd,
    pathExit?.observedLiquidityUsd ?? row.resolution.exitLiquidityUsd,
    rule.stressRoundTripCostPct,
    rule,
  );
  return {
    exitSource: pathExit ? isTrim ? "live-path-half-trim" : "live-path-full-exit"
      : "fixed-one-hour-outcome",
    exitObservedAt: pathExit?.observedAt ?? row.resolution.observedAt,
    exitGrossReturnPct: pathExit?.grossReturnFromEntryPct ?? row.grossReturnPct,
    trimFraction: isTrim ? trimFraction : null,
    baseNetReturnPct,
    stressNetReturnPct,
  };
}

function blendedCapacityReturn({ row, pathExit, trimFraction, roundTripCostPct, rule }) {
  const trim = capacityReturn(
    pathExit.grossReturnFromEntryPct,
    row.forecast.entryLiquidityUsd,
    pathExit.observedLiquidityUsd,
    roundTripCostPct,
    rule,
  );
  const remainder = capacityReturn(
    row.grossReturnPct,
    row.forecast.entryLiquidityUsd,
    row.resolution.exitLiquidityUsd,
    roundTripCostPct,
    rule,
  );
  return Number.isFinite(trim) && Number.isFinite(remainder)
    ? (trim * trimFraction) + (remainder * (1 - trimFraction)) : null;
}

function summarizeExitHypothesis(frames, weighted, key, id, rule) {
  const frameBase = frames.map((frame) => mean(frame.map((row) => (
    row.policies[key].baseNetReturnPct
  ))));
  const frameStress = frames.map((frame) => mean(frame.map((row) => (
    row.policies[key].stressNetReturnPct
  ))));
  const holdBase = frames.map((frame) => mean(frame.map((row) => (
    row.policies.hold.baseNetReturnPct
  ))));
  const pairedDeltas = frameBase.map((value, index) => value - holdBase[index]);
  const selected = weighted.filter((row) => row.entryTraded);
  const exits = selected.filter((row) => row.policies[key].exitSource !== "fixed-one-hour-outcome");
  return {
    id,
    selectedObservations: selected.length,
    exits: exits.length,
    baseFrameMeanNetReturnPct: nullableRound(mean(frameBase)),
    stressFrameMeanNetReturnPct: nullableRound(mean(frameStress)),
    pairedVsHoldFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedVsHoldBootstrapMeanDeltaCi95Pct: frames.length >= 2
      ? bootstrapMeanInterval(pairedDeltas, rule.bootstrapIterations).map(nullableRound)
      : [null, null],
    profitFactor: nullableRound(profitFactor(frameBase)),
    maxDrawdownPct: nullableRound(maxDrawdownPct(frameBase)),
    largestWinningFrameShare: nullableRound(largestWinningShare(frameBase)),
  };
}

function buildTakeProfitScorecard(events, rule, registrationMatcher, options = {}) {
  const sourceRegistrationMatcher = options.sourceRegistrationMatcher
    ?? matchesFastFlowRegistration;
  const sourceRegistrationIdField = options.sourceRegistrationIdField
    ?? "sourceFastFlowRegistrationId";
  const scorecardType = options.scorecardType
    ?? "dex-pulse-five-minute-buy-pressure-take-profit-scorecard";
  const rowRejectionReason = options.rowRejectionReason ?? fastFlowRejectionReason;
  const entryPredicate = options.entryPredicate ?? ((row) => passesFastFlowScreen(
    row,
    DEX_PULSE_FAST_FLOW_RULE.screens.find((screen) => screen.id === rule.sourceScreenId),
  ));
  const entryMetrics = options.entryMetrics ?? ((row) => ({
    entryFiveMinuteBuySellTxnRatio: row.forecast.metrics.fiveMinuteBuySellTxnRatio,
  }));
  const registration = events.find(registrationMatcher) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const boundaryAt = Date.parse(rule.evidenceBoundary);
  const sourceRegistration = events.find(sourceRegistrationMatcher) ?? null;
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
    && Date.parse(forecast.createdAt) > boundaryAt
  ));
  const candidateForecastIds = new Set(candidateForecasts.map((forecast) => forecast.id));
  const pathsByForecast = linkedPulsePaths(events);
  const mainPathsByTokenBucket = new Map(events.filter((event) => (
    event.type === "forecast-path-observation"
  )).map((event) => [`${event.tokenAddress}:${event.bucketStartedAt}`, event]));
  const exclusionCounts = {};
  const sourceCashCounts = {};
  const pathExclusionCounts = {};
  const observations = [];

  for (const row of pulse.rows) {
    if (!candidateForecastIds.has(row.forecastId)) continue;
    const sourceReason = rowRejectionReason(row);
    const sourceInvalidAsCash = sourceReason && options.sourceInvalidAsCash === true;
    if (sourceReason && !sourceInvalidAsCash) {
      increment(exclusionCounts, sourceReason);
      continue;
    }
    if (sourceInvalidAsCash) increment(sourceCashCounts, sourceReason);
    const validPaths = [];
    for (const event of pathsByForecast.get(row.forecastId) ?? []) {
      const reason = pulsePathRejectionReason(event, row.forecast, mainPathsByTokenBucket);
      if (reason) increment(pathExclusionCounts, reason);
      else validPaths.push(event);
    }
    validPaths.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const coverageReason = pathCoverageReason(validPaths, row.forecast, rule);
    if (coverageReason) {
      increment(pathExclusionCounts, coverageReason);
      continue;
    }
    const entryTraded = !sourceInvalidAsCash && entryPredicate(row);
    const takeProfit = entryTraded ? validPaths.find((event) => (
      event.grossReturnFromEntryPct
        >= rule.takeProfitGrossReturnPctInclusive
    )) : null;
    const policyGrossReturnPct = takeProfit?.grossReturnFromEntryPct ?? row.grossReturnPct;
    const policyExitLiquidityUsd = takeProfit?.observedLiquidityUsd
      ?? row.resolution.exitLiquidityUsd;
    const parentNetReturnPct = entryTraded ? row.baseCapacityReturnPct : 0;
    const stressedParentNetReturnPct = entryTraded ? row.stressCapacityReturnPct : 0;
    const policyNetReturnPct = entryTraded ? capacityReturn(
      policyGrossReturnPct,
      row.forecast.entryLiquidityUsd,
      policyExitLiquidityUsd,
      rule.baseRoundTripCostPct,
      rule,
    ) : 0;
    const stressedPolicyNetReturnPct = entryTraded ? capacityReturn(
      policyGrossReturnPct,
      row.forecast.entryLiquidityUsd,
      policyExitLiquidityUsd,
      rule.stressRoundTripCostPct,
      rule,
    ) : 0;
    if (![parentNetReturnPct, stressedParentNetReturnPct, policyNetReturnPct,
      stressedPolicyNetReturnPct].every(Number.isFinite)) {
      increment(exclusionCounts, "unscorable-capacity-return");
      continue;
    }
    observations.push({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      dueAt: row.forecast.dueAt,
      validPathMarks: validPaths.length,
      entryTraded,
      entrySourceReason: sourceReason,
      ...entryMetrics(row),
      exitSource: takeProfit ? "live-path-take-profit" : entryTraded
        ? "fixed-one-hour-outcome" : "entry-screen-cash",
      exitObservedAt: takeProfit?.observedAt ?? row.resolution.observedAt,
      exitGrossReturnPct: entryTraded ? policyGrossReturnPct : 0,
      exactOneHourGrossReturnPct: row.grossReturnPct,
      parentNetReturnPct,
      stressedParentNetReturnPct,
      policyNetReturnPct,
      stressedPolicyNetReturnPct,
      pairedDeltaPct: round6(policyNetReturnPct - parentNetReturnPct),
    });
  }

  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const frameRows = frames.map((frame) => ({
    parentNetReturnPct: mean(frame.map((row) => row.parentNetReturnPct)),
    stressedParentNetReturnPct: mean(frame.map((row) => row.stressedParentNetReturnPct)),
    policyNetReturnPct: mean(frame.map((row) => row.policyNetReturnPct)),
    stressedPolicyNetReturnPct: mean(frame.map((row) => row.stressedPolicyNetReturnPct)),
    pairedDeltaPct: mean(frame.map((row) => row.pairedDeltaPct)),
  }));
  const traded = weighted.filter((row) => row.entryTraded);
  const takeProfits = weighted.filter((row) => row.exitSource === "live-path-take-profit");
  const tradedFrames = frames.filter((frame) => frame.some((row) => row.entryTraded)).length;
  const uniqueTradedTokens = new Set(traded.map(tokenEdgeAssetKey)).size;
  const policyReturns = frameRows.map((row) => row.policyNetReturnPct);
  const stressPolicyReturns = frameRows.map((row) => row.stressedPolicyNetReturnPct);
  const deltas = frameRows.map((row) => row.pairedDeltaPct);
  const deltaCi95 = frameRows.length >= 2
    ? bootstrapMeanInterval(deltas, rule.bootstrapIterations)
    : [null, null];
  const profitFactorValue = profitFactor(policyReturns);
  const maxDrawdownValue = maxDrawdownPct(policyReturns);
  const largestWinnerShare = largestWinningShare(policyReturns);
  const evidenceReady = Boolean(
    registration
    && sourceRegistration
    && weighted.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentFrames
    && uniqueTradedTokens
      >= rule.minimumUniqueTradedTokens
    && tradedFrames
      >= rule.minimumIndependentTradedFrames
    && takeProfits.length >= rule.minimumTakeProfitExits
  );
  const openForecastIds = new Set(pulse.openForecastIds);
  return {
    type: scorecardType,
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    [sourceRegistrationIdField]: sourceRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => openForecastIds.has(forecast.id)).length,
    eligibleCompletePathObservations: observations.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    independentTradedFrames: tradedFrames,
    uniqueTokens: new Set(weighted.map(tokenEdgeAssetKey)).size,
    uniqueTradedTokens,
    entryScreenTradedObservations: traded.length,
    takeProfitExits: takeProfits.length,
    fixedHorizonExits: traded.filter((row) => row.exitSource === "fixed-one-hour-outcome").length,
    entryScreenCashObservations: weighted.filter((row) => !row.entryTraded).length,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    sourceCashCounts,
    exclusionCounts,
    pathExclusionCounts,
    parentFrameMeanNetReturnPct: nullableRound(mean(
      frameRows.map((row) => row.parentNetReturnPct),
    )),
    stressedParentFrameMeanNetReturnPct: nullableRound(mean(
      frameRows.map((row) => row.stressedParentNetReturnPct),
    )),
    policyFrameMeanNetReturnPct: nullableRound(mean(policyReturns)),
    stressedPolicyFrameMeanNetReturnPct: nullableRound(mean(stressPolicyReturns)),
    pairedFrameMeanDeltaPct: nullableRound(mean(deltas)),
    pairedBootstrapMeanDeltaCi95Pct: deltaCi95.map(nullableRound),
    profitFactor: nullableRound(profitFactorValue),
    maxDrawdownPct: nullableRound(maxDrawdownValue),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(
        0,
        rule.minimumMaturedForecasts - weighted.length,
      ),
      independentFrames: Math.max(
        0,
        rule.minimumIndependentFrames - frames.length,
      ),
      uniqueTradedTokens: Math.max(
        0,
        rule.minimumUniqueTradedTokens - uniqueTradedTokens,
      ),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - tradedFrames,
      ),
      takeProfitExits: Math.max(
        0,
        rule.minimumTakeProfitExits - takeProfits.length,
      ),
    },
    provisionalGate: Boolean(
      evidenceReady
      && deltaCi95[0] > 0
      && mean(policyReturns) > 0
      && mean(stressPolicyReturns) > 0
      && profitFactorValue >= rule.minimumProfitFactor
      && maxDrawdownValue <= rule.maximumDrawdownPct
      && largestWinnerShare
        <= rule.maximumLargestWinningFrameShare
    ),
    observationsDetail: observations,
    note: options.note ?? (rule.maximumPathBucketGapMs
      ? "This future-only paper challenger changes only path coverage: forecast boundaries use observed time, while internal gaps use immutable retained five-minute bucket starts. Entry, exit, integrity, cost, weighting, and promotion rules are unchanged."
      : "This future-only paper challenger changes only the exit of the already frozen five-minute buy-pressure entry screen. It requires six same-pair marks and no entry-to-mark, mark-to-mark, or mark-to-due gap over ten minutes; false entry screens stay cash, crossings are never backfilled, and the earliest exact asset receives weight inside each independent one-hour frame."),
  };
}

function fastFlowRejectionReason(row) {
  const metrics = row.forecast.metrics ?? {};
  const fields = [
    metrics.fiveMinuteBuySellTxnRatio,
    metrics.fiveMinuteTurnover,
    metrics.priceChangeM5Pct,
    metrics.buysM5,
    metrics.sellsM5,
    metrics.volumeM5Usd,
    metrics.buySellTxnRatio,
  ];
  if (!fields.every(Number.isFinite) || metrics.sellsM5 <= 0
    || row.forecast.entryLiquidityUsd <= 0) return "missing-or-invalid-five-minute-flow";
  if (metrics.fiveMinuteBuySellTxnRatio !== roundRatio(metrics.buysM5, metrics.sellsM5)
    || metrics.fiveMinuteTurnover !== roundRatio(
      metrics.volumeM5Usd,
      row.forecast.entryLiquidityUsd,
    )) return "inconsistent-five-minute-flow";
  return null;
}

function crossWindowReversalRejectionReason(row) {
  if (!Number.isFinite(row.priceChangeM5Pct)) {
    return "missing-or-invalid-five-minute-momentum";
  }
  if (!Number.isFinite(row.priceChangeH1Pct)) {
    return "missing-or-invalid-one-hour-momentum";
  }
  return null;
}

function passesCrossWindowReversal(row) {
  return row.priceChangeM5Pct < 0 && row.priceChangeH1Pct > 0;
}

function linkedPulsePaths(events) {
  const result = new Map();
  for (const event of events.filter((row) => row.type === "dex-surface-pulse-path")) {
    const values = result.get(event.forecastId) ?? [];
    values.push(event);
    result.set(event.forecastId, values);
  }
  return result;
}

function pulsePathRejectionReason(event, forecast, mainPathsByTokenBucket) {
  const observedAt = Date.parse(event.observedAt ?? "");
  const bucketAt = Math.floor(observedAt / PATH_CADENCE_MS) * PATH_CADENCE_MS;
  if (event.ruleVersion !== DEX_SURFACE_PULSE_RULE.version
    || event.registrationId !== forecast.registrationId
    || event.researchOnly !== true
    || event.mutationAllowed !== false) return "invalid-path-contract";
  if (!(observedAt > Date.parse(forecast.createdAt)
    && observedAt <= Date.parse(forecast.dueAt))) return "path-outside-forecast-window";
  if (event.bucketStartedAt !== new Date(bucketAt).toISOString()) return "path-bucket-mismatch";
  if (event.forecastId !== forecast.id
    || event.discoveryEventId !== forecast.discoveryEventId
    || event.chain !== forecast.chain
    || event.tokenAddress !== forecast.tokenAddress
    || event.pairAddress !== forecast.pairAddress
    || event.entryPriceUsd !== forecast.entryPriceUsd) return "path-forecast-mismatch";
  if (!(event.observedPriceUsd > 0) || !(event.observedLiquidityUsd > 0)) {
    return "path-market-evidence-mismatch";
  }
  if (event.grossReturnFromEntryPct !== round6(
    ((event.observedPriceUsd / event.entryPriceUsd) - 1) * 100,
  )) return "path-return-mismatch";
  const mainPath = mainPathsByTokenBucket.get(`${event.tokenAddress}:${event.bucketStartedAt}`);
  if (mainPath?.observedPairAddress === event.pairAddress) {
    const priceRatio = Math.max(event.observedPriceUsd, mainPath.observedPriceUsd)
      / Math.min(event.observedPriceUsd, mainPath.observedPriceUsd);
    const liquidityRatio = Math.max(event.observedLiquidityUsd, mainPath.observedLiquidityUsd)
      / Math.min(event.observedLiquidityUsd, mainPath.observedLiquidityUsd);
    if (priceRatio > DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.maximumPriceRatioInclusive) {
      return "cross-collector-price-disagreement";
    }
    if (liquidityRatio > DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE
      .maximumLiquidityRatioInclusive) return "cross-collector-liquidity-disagreement";
  }
  if (observedAt >= Date.parse(DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.appliesFrom)
    && !validDexPulseStoredProviderPriceIntegrity(
      event.providerPriceIntegrity,
      event.observedPriceUsd,
      event.observedLiquidityUsd,
    )) return "provider-price-integrity-mismatch";
  return null;
}

function pathCoverageReason(paths, forecast, rule) {
  if (paths.length < rule.minimumPathMarks) {
    return "insufficient-path-marks";
  }
  if (new Set(paths.map((event) => event.bucketStartedAt)).size !== paths.length) {
    return "duplicate-path-bucket";
  }
  if (rule.maximumPathBucketGapMs) {
    if (Date.parse(paths[0].observedAt) - Date.parse(forecast.createdAt) > rule.maximumPathGapMs
      || Date.parse(forecast.dueAt) - Date.parse(paths.at(-1).observedAt)
        > rule.maximumPathGapMs) return "path-cadence-gap";
    const buckets = paths.map((event) => Date.parse(event.bucketStartedAt));
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index] - buckets[index - 1] > rule.maximumPathBucketGapMs) {
        return "path-cadence-gap";
      }
    }
    return null;
  }
  const timestamps = [
    Date.parse(forecast.createdAt),
    ...paths.map((event) => Date.parse(event.observedAt)),
    Date.parse(forecast.dueAt),
  ];
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1]
      > rule.maximumPathGapMs) {
      return "path-cadence-gap";
    }
  }
  return null;
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseBuyPressureTakeProfitRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesCadenceTolerantRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCadenceTolerantTakeProfitRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesCrossWindowReversalTakeProfitRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseCrossWindowReversalTakeProfitRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesCrossWindowReversalRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  if (event.rule?.version !== DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.version) return false;
  const expected = createDexPulseCrossWindowReversalRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastFlowRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  if (event.rule?.version !== DEX_PULSE_FAST_FLOW_RULE.version) return false;
  const expected = createDexPulseFastFlowRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function capacityReturn(
  grossReturnPct, entryLiquidityUsd, exitLiquidityUsd, roundTripCostPct, rule,
) {
  return capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd,
    exitLiquidityUsd,
    paperNotionalUsd: rule.paperNotionalUsd,
    roundTripCostPct,
  });
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
    ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value) {
  return Number.isFinite(value) ? round6(value) : null;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
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

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "score", "register-cadence-tolerant", "score-cadence-tolerant",
    "register-cross-window-reversal", "score-cross-window-reversal", "audit-screen-exits"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-fast-flow-take-profit.mjs register|score|register-cadence-tolerant|score-cadence-tolerant|register-cross-window-reversal|score-cross-window-reversal|audit-screen-exits [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseBuyPressureTakeProfit(options), null, 2));
    } else if (options.command === "register-cadence-tolerant") {
      console.log(JSON.stringify(
        await registerDexPulseCadenceTolerantTakeProfit(options), null, 2,
      ));
    } else if (options.command === "register-cross-window-reversal") {
      console.log(JSON.stringify(
        await registerDexPulseCrossWindowReversalTakeProfit(options), null, 2,
      ));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-cadence-tolerant"
          ? buildDexPulseCadenceTolerantTakeProfitScorecard(events)
          : options.command === "score-cross-window-reversal"
            ? buildDexPulseCrossWindowReversalTakeProfitScorecard(events)
          : options.command === "audit-screen-exits"
            ? buildDexPulseScreenExitHypothesisAudit(events)
            : buildDexPulseBuyPressureTakeProfitScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
