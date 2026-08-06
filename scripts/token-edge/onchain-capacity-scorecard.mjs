import { createHash } from "node:crypto";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import { exactLiveOutcomeTimingReason } from "./onchain-outcome-timing.mjs";

export const TOKEN_EDGE_EXECUTION_POLICY = Object.freeze({
  policyVersion: "token-edge-capacity-v1",
  paperNotionalUsd: 100,
  baseRoundTripCostPct: 4,
  stressRoundTripCostPct: 12,
  ammImpactModel: "constant-product-symmetric-reserves-v1",
  requiresPositiveEntryAndExitLiquidity: true,
  minimumMaturedForecasts: 252,
  minimumIndependentSignalFrames: 252,
  minimumUniqueTokens: 30,
  minimumPredictedRiseForecasts: 50,
  minimumIndependentTradedFrames: 64,
  bootstrapIterations: 10_000,
  bootstrapLower95MustExceedPct: 0,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
});

const REGISTRATION_SPEC = Object.freeze({
  ...TOKEN_EDGE_EXECUTION_POLICY,
  researchOnly: true,
  mutationAllowed: false,
});

export function createExecutionPolicyRegistrationEvents(registeredAt = new Date()) {
  return [{
    type: "execution-policy-registration",
    id: `execution_policy_registration_${digest(REGISTRATION_SPEC).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...REGISTRATION_SPEC,
  }];
}

export function executionPolicyLink(createdAt, registrations = []) {
  const createdAtMs = Date.parse(createdAt);
  const registration = registrations
    .filter(matchesFrozenPolicy)
    .filter((candidate) => Date.parse(candidate.registeredAt) < createdAtMs)
    .sort((left, right) => Date.parse(left.registeredAt) - Date.parse(right.registeredAt))[0];
  return {
    executionPolicyRegistrationId: registration?.id ?? null,
    executionPolicyRegisteredAt: registration?.registeredAt ?? null,
    executionPolicyVersion: registration?.policyVersion ?? null,
  };
}

export function resolutionExecutionEvidence(snapshot, exitMarket) {
  if (!exitMarket || typeof exitMarket !== "object") return {};
  return {
    executionEvidence: {
      entryMarketObservedAt: text(snapshot?.market?.observedAt),
      entryPairAddress: text(snapshot?.market?.pairAddress),
      entryLiquidityUsd: positiveNumber(snapshot?.market?.liquidityUsd),
      exitMarketObservedAt: text(exitMarket.observedAt),
      exitPairAddress: text(exitMarket.pairAddress),
      exitLiquidityUsd: positiveNumber(exitMarket.liquidityUsd),
    },
  };
}

export function capacityAdjustedReturnPct(input) {
  const grossReturnPct = finiteNumber(input.grossReturnPct);
  const entryLiquidityUsd = positiveNumber(input.entryLiquidityUsd);
  const exitLiquidityUsd = positiveNumber(input.exitLiquidityUsd);
  const paperNotionalUsd = positiveNumber(input.paperNotionalUsd);
  const roundTripCostPct = nonnegativeNumber(input.roundTripCostPct);
  if (grossReturnPct == null || entryLiquidityUsd == null || exitLiquidityUsd == null
    || paperNotionalUsd == null || roundTripCostPct == null) return null;
  const entryQuoteReserveUsd = entryLiquidityUsd / 2;
  const entryMarkValueUsd = (paperNotionalUsd * entryQuoteReserveUsd)
    / (entryQuoteReserveUsd + paperNotionalUsd);
  const exitMarkValueUsd = entryMarkValueUsd * (1 + grossReturnPct / 100);
  if (!(exitMarkValueUsd >= 0)) return null;
  const exitQuoteReserveUsd = exitLiquidityUsd / 2;
  const exitProceedsUsd = (exitQuoteReserveUsd * exitMarkValueUsd)
    / (exitQuoteReserveUsd + exitMarkValueUsd);
  return round(Math.max(-100, ((exitProceedsUsd / paperNotionalUsd) - 1) * 100
    - roundTripCostPct), 6);
}

export function buildCapacityScorecard(events, options = {}) {
  const rejectedForecastIds = options.rejectedForecastIds instanceof Set
    ? options.rejectedForecastIds
    : new Set();
  const registrations = events.filter((event) => event.type === "execution-policy-registration");
  const validRegistration = registrations.find(matchesFrozenPolicy) ?? null;
  const registrationsById = new Map(registrations.map((event) => [event.id, event]));
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const historicalRecoveryOutcomes = events.filter((event) => (
    event.type === "resolution-recovery" && event.status === "observed"
  )).length;
  const liveOutcomes = events.filter((event) => (
    event.type === "resolution" && event.status === "observed"
  ));
  const eligible = [];
  const ineligibilityCounts = {};
  for (const outcome of liveOutcomes) {
    const forecast = forecasts.get(outcome.forecastId);
    const snapshot = forecast ? snapshots.get(forecast.snapshotId) : null;
    const reason = capacityIneligibilityReason({
      outcome,
      forecast,
      snapshot,
      validRegistration,
      registrations,
      registrationsById,
      rejectedForecastIds,
    });
    if (reason) {
      ineligibilityCounts[reason] = (ineligibilityCounts[reason] ?? 0) + 1;
      continue;
    }
    const evidence = outcome.executionEvidence;
    const traded = forecast.predictedRise === true;
    const netReturnPct = traded ? capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: validRegistration.paperNotionalUsd,
      roundTripCostPct: validRegistration.baseRoundTripCostPct,
    }) : 0;
    const stressedNetReturnPct = traded ? capacityAdjustedReturnPct({
      grossReturnPct: outcome.grossReturnPct,
      entryLiquidityUsd: evidence.entryLiquidityUsd,
      exitLiquidityUsd: evidence.exitLiquidityUsd,
      paperNotionalUsd: validRegistration.paperNotionalUsd,
      roundTripCostPct: validRegistration.stressRoundTripCostPct,
    }) : 0;
    if (netReturnPct == null || stressedNetReturnPct == null) {
      ineligibilityCounts["unscorable-capacity-return"] = (
        ineligibilityCounts["unscorable-capacity-return"] ?? 0
      ) + 1;
      continue;
    }
    eligible.push({
      outcome,
      forecast,
      signalAtMs: Date.parse(forecast.createdAt),
      traded,
      netReturnPct,
      stressedNetReturnPct,
    });
  }
  const descriptors = new Map();
  for (const forecast of forecasts.values()) {
    const descriptor = {
      modelVersion: forecast.modelVersion,
      candidateId: forecast.candidateId,
      horizon: forecast.horizon,
    };
    descriptors.set(canonical(descriptor), descriptor);
  }
  const rows = [...descriptors.values()].map((descriptor) => buildCapacityRow({
    descriptor,
    group: eligible.filter(({ forecast }) => (
      forecast.modelVersion === descriptor.modelVersion
      && forecast.candidateId === descriptor.candidateId
      && forecast.horizon === descriptor.horizon
    )),
    durationMs: options.durations?.[descriptor.horizon]?.durationMs,
    registration: validRegistration,
    bootstrapMeanInterval: options.bootstrapMeanInterval,
  })).sort((left, right) => canonical(left).localeCompare(canonical(right)));
  return {
    type: "token-edge-capacity-scorecard",
    policyStatus: validRegistration ? "registered" : "unregistered",
    policyRegistrationId: validRegistration?.id ?? null,
    policyRegisteredAt: validRegistration?.registeredAt ?? null,
    policy: validRegistration ? policyView(validRegistration) : TOKEN_EDGE_EXECUTION_POLICY,
    invalidRegistrationCount: registrations.filter((event) => !matchesFrozenPolicy(event)).length,
    eligibleLiveOutcomes: eligible.length,
    ineligibleLiveOutcomes: liveOutcomes.length - eligible.length,
    historicalRecoveryOutcomes,
    ineligibilityCounts,
    rows,
    claimBoundary: "Only prospectively linked live outcomes with same-event entry and exit liquidity and reconstructed challenger eligibility qualify. Within each horizon frame, only the earliest exact-asset signal receives paper-capital weight. Historical price recovery remains direction evidence only.",
  };
}

export function capacityEvolutionDecision(scorecard, candidateId, horizon, modelVersion) {
  const row = scorecard.capacityAudit?.rows.find((item) => (
    item.modelVersion === modelVersion
    && item.candidateId === candidateId
    && item.horizon === horizon
  ));
  if (!row || row.evidenceStatus !== "eligible-for-frozen-capacity-audit") {
    return {
      status: "blocked",
      candidateId,
      horizon,
      modelVersion,
      reason: "Insufficient prospectively registered live execution-capacity evidence.",
      evidenceShortfall: row?.evidenceShortfall ?? null,
      mutationAllowed: false,
    };
  }
  if (!row.provisionalCapacityGate) {
    return {
      status: "retain",
      candidateId,
      horizon,
      modelVersion,
      reason: "The candidate did not clear the frozen execution-capacity gate.",
      mutationAllowed: false,
    };
  }
  return null;
}

function capacityIneligibilityReason(input) {
  const {
    outcome,
    forecast,
    snapshot,
    validRegistration,
    registrations,
    registrationsById,
    rejectedForecastIds,
  } = input;
  if (!forecast) return "missing-forecast";
  if (rejectedForecastIds.has(forecast.id)) return "challenger-lineage-rejected";
  if (forecast.status !== "ready") return "forecast-not-ready";
  if (!validRegistration) {
    return registrations.length
      ? "invalid-execution-policy-registration"
      : "execution-policy-not-registered";
  }
  if (!forecast.executionPolicyRegistrationId) {
    return Date.parse(forecast.createdAt) <= Date.parse(validRegistration.registeredAt)
      ? "forecast-created-before-execution-policy-registration"
      : "missing-execution-policy-link";
  }
  const linkedRegistration = registrationsById.get(forecast.executionPolicyRegistrationId);
  if (!linkedRegistration || !matchesFrozenPolicy(linkedRegistration)) {
    return "invalid-execution-policy-registration";
  }
  if (forecast.executionPolicyRegisteredAt !== linkedRegistration.registeredAt
    || forecast.executionPolicyVersion !== linkedRegistration.policyVersion) {
    return "execution-policy-link-mismatch";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(linkedRegistration.registeredAt))) {
    return "forecast-created-before-execution-policy-registration";
  }
  if (forecast.roundTripCostPct !== linkedRegistration.baseRoundTripCostPct) {
    return "forecast-cost-policy-mismatch";
  }
  if (!snapshot) return "missing-snapshot";
  if (forecast.createdAt !== snapshot.observedAt) return "forecast-snapshot-time-mismatch";
  if (outcome.snapshotId !== snapshot.id) return "resolution-snapshot-mismatch";
  if (outcome.modelVersion !== forecast.modelVersion
    || outcome.candidateId !== forecast.candidateId
    || outcome.horizon !== forecast.horizon
    || outcome.chain !== forecast.chain
    || outcome.tokenAddress !== forecast.tokenAddress) return "resolution-forecast-mismatch";
  if (Date.parse(outcome.observedAt) < Date.parse(forecast.dueAt)) return "resolution-before-due";
  if (outcome.observationMode !== "live-point-in-time") return "non-live-resolution";
  const timingReason = exactLiveOutcomeTimingReason(outcome);
  if (timingReason) return timingReason;
  if (outcome.entryPriceUsd !== snapshot.market?.priceUsd) return "entry-price-mismatch";
  const observedPriceUsd = positiveNumber(outcome.observedPriceUsd);
  if (observedPriceUsd == null) return "missing-observed-price";
  const expectedGrossReturnPct = round(((observedPriceUsd / snapshot.market.priceUsd) - 1) * 100, 6);
  if (outcome.grossReturnPct !== expectedGrossReturnPct) return "resolution-return-mismatch";
  const evidence = outcome.executionEvidence;
  if (positiveNumber(evidence?.entryLiquidityUsd) == null) return "missing-entry-liquidity";
  if (positiveNumber(evidence?.exitLiquidityUsd) == null) return "missing-exit-liquidity";
  if (!text(evidence?.entryPairAddress)) return "missing-entry-pair";
  if (!text(evidence?.exitPairAddress)) return "missing-exit-pair";
  if (evidence.entryMarketObservedAt !== snapshot.market?.observedAt
    || evidence.entryPairAddress !== snapshot.market?.pairAddress
    || evidence.entryLiquidityUsd !== snapshot.market?.liquidityUsd) {
    return "entry-market-evidence-mismatch";
  }
  if (evidence.exitMarketObservedAt !== outcome.observedAt) return "exit-market-time-mismatch";
  if (finiteNumber(outcome.grossReturnPct) == null) return "missing-gross-return";
  return null;
}

function buildCapacityRow(input) {
  const { descriptor, group, durationMs, registration, bootstrapMeanInterval } = input;
  const policy = registration ?? TOKEN_EDGE_EXECUTION_POLICY;
  const signalFrames = independentAssetFrames(group, {
    durationMs,
    timestamp: (item) => item.signalAtMs,
    assetKey: (item) => tokenEdgeAssetKey(item.outcome),
  });
  const weighted = signalFrames.flat();
  const tradedFrames = signalFrames.filter((frame) => frame.some((item) => item.traded));
  const returns = signalFrames.map((frame) => mean(frame.map((item) => item.netReturnPct)));
  const stressedReturns = signalFrames.map((frame) => mean(
    frame.map((item) => item.stressedNetReturnPct),
  ));
  const traded = weighted.filter((item) => item.traded);
  const uniqueTokens = new Set(group.map(({ outcome }) => tokenEdgeAssetKey(outcome)).filter(Boolean)).size;
  const ci95 = returns.length >= 2 && typeof bootstrapMeanInterval === "function"
    ? bootstrapMeanInterval(returns, policy.bootstrapIterations)
    : [null, null];
  const averageReturn = mean(returns);
  const stressedAverageReturn = mean(stressedReturns);
  const factor = profitFactor(returns);
  const drawdown = maxDrawdownPct(returns);
  const concentration = winningFrameConcentration(returns);
  const evidenceReady = weighted.length >= policy.minimumMaturedForecasts
    && signalFrames.length >= policy.minimumIndependentSignalFrames
    && uniqueTokens >= policy.minimumUniqueTokens;
  return {
    ...descriptor,
    capacityEligibleLiveOutcomes: group.length,
    capacityWeightedUniqueAssetOutcomes: weighted.length,
    sameAssetOverlappingOutcomes: overlappingAssetSignalCount(group, signalFrames),
    predictedRiseForecasts: traded.length,
    independentSignalFrames: signalFrames.length,
    independentTradedFrames: tradedFrames.length,
    uniqueTokens,
    portfolioAverageNetReturnPct: nullableRound(averageReturn, 6),
    portfolioBootstrapMeanNetReturnCi95Pct: ci95.map((value) => nullableRound(value, 6)),
    portfolioProfitFactor: nullableRound(factor, 6),
    portfolioMaxDrawdownPct: nullableRound(drawdown, 6),
    largestWinningFrameShare: nullableRound(concentration, 6),
    stressedPortfolioAverageNetReturnPct: nullableRound(stressedAverageReturn, 6),
    paperCapitalAssignedUsd: weighted.length * policy.paperNotionalUsd,
    paperNotionalTradedUsd: traded.length * policy.paperNotionalUsd,
    paperPnlAcrossEligibleSignalsUsd: nullableRound(
      weighted.reduce((sum, item) => sum + (item.netReturnPct / 100) * policy.paperNotionalUsd, 0),
      6,
    ),
    evidenceStatus: evidenceReady ? "eligible-for-frozen-capacity-audit" : "collecting",
    evidenceShortfall: {
      maturedForecasts: Math.max(0, policy.minimumMaturedForecasts - weighted.length),
      independentSignalFrames: Math.max(0, policy.minimumIndependentSignalFrames - signalFrames.length),
      uniqueTokens: Math.max(0, policy.minimumUniqueTokens - uniqueTokens),
      predictedRiseForecasts: Math.max(0, policy.minimumPredictedRiseForecasts - traded.length),
      independentTradedFrames: Math.max(0, policy.minimumIndependentTradedFrames - tradedFrames.length),
    },
    provisionalCapacityGate: evidenceReady
      && traded.length >= policy.minimumPredictedRiseForecasts
      && tradedFrames.length >= policy.minimumIndependentTradedFrames
      && ci95[0] > policy.bootstrapLower95MustExceedPct
      && factor >= policy.minimumProfitFactor
      && drawdown <= policy.maximumDrawdownPct
      && concentration <= policy.maximumLargestWinningFrameShare
      && stressedAverageReturn > 0,
  };
}

function matchesFrozenPolicy(event) {
  if (!event || event.type !== "execution-policy-registration" || event.status !== "frozen") return false;
  if (!Number.isFinite(Date.parse(event.registeredAt))) return false;
  const expected = createExecutionPolicyRegistrationEvents(event.registeredAt)[0];
  return event.id === expected.id
    && event.registeredAt === expected.registeredAt
    && Object.entries(REGISTRATION_SPEC).every(([key, value]) => canonical(event[key]) === canonical(value));
}

function policyView(registration) {
  return Object.fromEntries(Object.keys(TOKEN_EDGE_EXECUTION_POLICY)
    .map((key) => [key, registration[key]]));
}

function profitFactor(values) {
  if (!values.length) return null;
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return gains > 0 ? 999 : null;
  return gains / losses;
}

function maxDrawdownPct(values) {
  if (!values.length) return null;
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

function winningFrameConcentration(values) {
  const wins = values.filter((value) => value > 0);
  const total = wins.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...wins) / total : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableRound(value, digits) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function round(value, digits) {
  return Math.round(value * (10 ** digits)) / (10 ** digits);
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid execution-policy timestamp.");
  return date.toISOString();
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}
