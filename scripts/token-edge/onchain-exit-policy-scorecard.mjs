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
  createExecutionPolicyRegistrationEvents,
} from "./onchain-capacity-scorecard.mjs";
import { independentAssetFrames, tokenEdgeAssetKey } from "./onchain-independent-frames.mjs";
import {
  TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE,
  defaultTokenEdgeLedgerPath,
  validTokenEdgeStoredExecutionPriceIntegrity,
} from "./onchain-forward-research.mjs";
import { exactLiveOutcomeTimingReason } from "./onchain-outcome-timing.mjs";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const TOKEN_EDGE_EXIT_POLICY = Object.freeze({
  policyVersion: "token-edge-take-profit-v1",
  evidenceBoundary: "2026-08-03T08:33:54.104Z",
  sourceModelVersion: "frozen-onchain-rank-v3",
  sourceCandidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  horizon: "1h",
  takeProfitGrossReturnPctInclusive: 10,
  exitRule: "First retained live point-in-time mark at or above +10%; otherwise fixed one-hour live outcome.",
  posthocDerived: true,
  derivation: Object.freeze({
    resolvedForecasts: 16,
    independentFrames: 3,
    inspectedPolicyVariants: 40,
    sourceForecasts: 10,
    sourceHoldFrameMeanNetPct: -0.045646,
    sourceTakeProfitFrameMeanNetPct: 4.857353,
    warning: "Tiny multiple-tested path sample; only strictly later forecasts may count.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumTakeProfitExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY = Object.freeze({
  policyVersion: "token-edge-dex-take-profit-v1",
  evidenceBoundary: "2026-08-03T17:49:11.112Z",
  sourceModelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  sourceCandidateId: "dex-early-surface-rise",
  selectionProvider: "dexscreener-early-surface",
  selectionTimeframe: "5m",
  horizon: "1h",
  takeProfitGrossReturnPctInclusive: TOKEN_EDGE_EXIT_POLICY.takeProfitGrossReturnPctInclusive,
  exitRule: TOKEN_EDGE_EXIT_POLICY.exitRule,
  posthocDerived: false,
  prospectiveTransfer: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_EXIT_POLICY.policyVersion,
    changedDimension: "source-forecast-only",
    inspectedSourceForecastsExcluded: 16,
    inspectedTakeProfitCrossingsExcluded: 4,
    warning: "The +10% rule was copied unchanged only after V11 reversals were inspected. Every V11 forecast, path, and outcome at or before the boundary is excluded.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumTakeProfitExits: TOKEN_EDGE_EXIT_POLICY.minimumTakeProfitExits,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY = Object.freeze({
  policyVersion: "token-edge-dex-confirmed-take-profit-v2",
  evidenceBoundary: "2026-08-03T18:25:27.400Z",
  sourceModelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  sourceCandidateId: "dex-early-surface-rise",
  selectionProvider: "dexscreener-early-surface",
  selectionTimeframe: "5m",
  horizon: "1h",
  takeProfitGrossReturnPctInclusive: TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY
    .takeProfitGrossReturnPctInclusive,
  minimumConfirmingMarks: 2,
  minimumConfirmationSeparationMs: 4 * 60_000,
  maximumConfirmationSeparationMs: 10 * 60_000,
  exitRule: "Exit at the second retained live point-in-time mark at or above +10% when two consecutive qualifying marks are 4 to 10 minutes apart; otherwise use the fixed one-hour live outcome.",
  posthocDerived: true,
  derivation: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.policyVersion,
    changedDimension: "persistent-executable-threshold-confirmation",
    observedTransientMarksExcluded: 1,
    observedReversionMinutes: 5,
    warning: "A same-pair DEX quote briefly printed about +1,450% and reverted below entry by the next five-minute mark. That forecast, every contemporaneous path mark, and all forecasts at or before the boundary are excluded.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumTakeProfitExits: TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.minimumTakeProfitExits,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_TAIL_STOP_POLICY = Object.freeze({
  policyVersion: "token-edge-tail-preserving-stop-v1",
  evidenceBoundary: "2026-08-03T11:34:00.000Z",
  sourceModelVersion: "frozen-onchain-rank-v3",
  sourceCandidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  horizon: "1h",
  stopLossGrossReturnPctInclusive: -10,
  exitRule: "First retained live point-in-time mark at or below -10%; otherwise fixed one-hour live outcome. There is no take-profit cap.",
  posthocDerived: false,
  economicPremise: Object.freeze({
    assumedWinRate: 0.2,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stoppedGrossLossPct: -10,
    breakEvenAverageGrossWinnerPct: 60,
    note: "At a 20% win rate, four -14% net stopped losses require one +56% net / +60% gross winner merely to break even before AMM impact. The policy preserves that right tail.",
  }),
  minimumPathMarks: 6,
  maximumPathGapMs: 10 * 60_000,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumStopLossExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_24H_TAIL_STOP_POLICY = Object.freeze({
  ...TOKEN_EDGE_TAIL_STOP_POLICY,
  policyVersion: "token-edge-smart-money-24h-tail-preserving-stop-v1",
  evidenceBoundary: "2026-08-04T04:19:49.000Z",
  horizon: "24h",
  exitRule: "First retained live point-in-time mark at or below -10%; otherwise fixed 24-hour live outcome. There is no take-profit cap.",
  posthocDerived: true,
  derivation: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_TAIL_STOP_POLICY.policyVersion,
    changedDimension: "fixed-outcome-horizon-from-one-hour-to-twenty-four-hours",
    inspectedMaturedForecastsExcluded: 21,
    inspectedIndependentFramesExcluded: 2,
    inspectedPredictedRiseForecastsExcluded: 14,
    inspectedFrameMeanNetReturnPct: 37.601311,
    inspectedStressFrameMeanNetReturnPct: 29.601311,
    inspectedLargestWinningFrameShare: 1,
    warning: "The positive 24-hour seed has only two independent frames and is winner-concentrated. The -10% stop and five-minute/ten-minute path contract are copied unchanged; every inspected forecast, path, and outcome is excluded.",
  }),
});

export const TOKEN_EDGE_DEX_TAIL_STOP_POLICY = Object.freeze({
  policyVersion: "token-edge-dex-tail-preserving-stop-v1",
  evidenceBoundary: "2026-08-03T12:06:00.000Z",
  sourceModelVersion: "frozen-onchain-rank-v11-dex-early-surface",
  sourceCandidateId: "dex-early-surface-rise",
  selectionProvider: "dexscreener-early-surface",
  selectionTimeframe: "5m",
  horizon: "1h",
  stopLossGrossReturnPctInclusive: -10,
  exitRule: "First retained live point-in-time mark at or below -10%; otherwise fixed one-hour live outcome. There is no take-profit cap.",
  posthocDerived: false,
  prospectiveTransfer: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_TAIL_STOP_POLICY.policyVersion,
    changedDimension: "source-forecast-only",
    sourceOutcomesObservedBeforeFreeze: 0,
    warning: "Open DEX path marks existed before this transfer, but the stop threshold, cadence gate, cost model, and uncapped upside were copied unchanged. Every earlier DEX forecast, path, and later outcome is excluded.",
  }),
  economicPremise: TOKEN_EDGE_TAIL_STOP_POLICY.economicPremise,
  minimumPathMarks: TOKEN_EDGE_TAIL_STOP_POLICY.minimumPathMarks,
  maximumPathGapMs: TOKEN_EDGE_TAIL_STOP_POLICY.maximumPathGapMs,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumStopLossExits: TOKEN_EDGE_TAIL_STOP_POLICY.minimumStopLossExits,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_PARTIAL_TRIM_POLICY = Object.freeze({
  policyVersion: "token-edge-half-trim-preserve-tail-v1",
  evidenceBoundary: "2026-08-03T13:08:00.000Z",
  sourceModelVersion: "frozen-onchain-rank-v3",
  sourceCandidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  horizon: "1h",
  trimTriggerGrossReturnPctInclusive: 10,
  trimFraction: 0.5,
  exitRule: "At the first retained live point-in-time mark at or above +10%, exit half and hold the other half to the exact one-hour outcome; without a trigger, hold the full position. The remainder has no take-profit cap.",
  posthocDerived: true,
  derivation: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_EXIT_POLICY.policyVersion,
    sourceObservations: 6,
    sourceIndependentFrames: 3,
    sourcePolicyFrameMeanNetReturnPct: 5.164022,
    sourceStressFrameMeanNetReturnPct: -2.835978,
    sourcePairedDeltaCi95Pct: [-5.138648, 20.741041],
    sourceLargestWinningFrameShare: 0.505338,
    changedDimension: "exit-all-versus-half-at-existing-trigger",
    warning: "The +10% trigger was inherited unchanged. A fixed 50% trim is an economic tail-preservation hypothesis, not an optimized or profitable result; every inspected source row is excluded.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumTrimExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY = Object.freeze({
  policyVersion: "token-edge-asymmetric-bracket-v1",
  evidenceBoundary: "2026-08-03T14:36:15.000Z",
  sourceModelVersion: "frozen-onchain-rank-v3",
  sourceCandidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  horizon: "1h",
  stopLossGrossReturnPctInclusive: -10,
  trimTriggerGrossReturnPctInclusive: 10,
  trimFraction: 0.5,
  exitRule: "At the first retained live point at or outside [-10%, +10%], exit all at or below -10%; at or above +10%, exit half and hold the remainder to the exact one-hour outcome. Without a trigger, hold the full position. The first boundary hit is final and no unseen crossing is inferred.",
  posthocDerived: true,
  derivation: Object.freeze({
    stopPolicyVersion: TOKEN_EDGE_TAIL_STOP_POLICY.policyVersion,
    trimPolicyVersion: TOKEN_EDGE_PARTIAL_TRIM_POLICY.policyVersion,
    changedDimension: "combine-two-separately-frozen-asymmetric-exit-actions",
    inspectedOpenPathTokensExcluded: Object.freeze(["Kimchi", "旺旺", "PIBBLE", "TIT"]),
    warning: "The combination was declared after inspecting open paths. Every forecast, mark, and later outcome at or before registration is excluded and cannot validate it.",
  }),
  economicPremise: TOKEN_EDGE_TAIL_STOP_POLICY.economicPremise,
  minimumPathMarks: TOKEN_EDGE_TAIL_STOP_POLICY.minimumPathMarks,
  maximumPathGapMs: TOKEN_EDGE_TAIL_STOP_POLICY.maximumPathGapMs,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumStopLossExits: 50,
  minimumTrimExits: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY = Object.freeze({
  policyVersion: "token-edge-shallow-profit-overshoot-preserve-v1",
  evidenceBoundary: "2026-08-03T15:05:30.000Z",
  sourceModelVersion: "frozen-onchain-rank-v3",
  sourceCandidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
  horizon: "1h",
  takeProfitGrossReturnPctInclusive: 10,
  overshootGrossReturnPctInclusive: 20,
  exitRule: "At the first retained complete-path mark at or above +10%, exit all only when the observed return is below +20%. A first qualifying mark at or above +20% commits the full paper position to the exact one-hour outcome, even after a later reversal. No unseen crossing is inferred.",
  posthocDerived: true,
  derivation: Object.freeze({
    sourcePolicyVersion: TOKEN_EDGE_EXIT_POLICY.policyVersion,
    inspectedIndependentFrames: 1,
    inspectedTokensExcluded: Object.freeze(["Kimchi", "旺旺", "PIBBLE", "TIT"]),
    shallowReversalExample: Object.freeze({ symbol: "PIBBLE", firstTriggerGrossPct: 10.483657, finalGrossPct: 2.830189 }),
    overshootContinuationExample: Object.freeze({ symbol: "TIT", firstTriggerGrossPct: 26.146789, finalGrossPct: 82.568807 }),
    changedDimension: "bypass-existing-full-take-profit-on-strong-first-observed-overshoot",
    warning: "The round +20% bypass was declared after inspecting a single independent frame. Every inspected forecast, path, and outcome is excluded; only strictly later complete paths may count.",
  }),
  minimumPathMarks: TOKEN_EDGE_TAIL_STOP_POLICY.minimumPathMarks,
  maximumPathGapMs: TOKEN_EDGE_TAIL_STOP_POLICY.maximumPathGapMs,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumShallowTakeProfitExits: 50,
  minimumPreservedTailHolds: 50,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export function requiredTailWinnerGrossReturnPct({
  winRate, stopLossGrossReturnPct, roundTripCostPct,
}) {
  if (!(winRate > 0 && winRate < 1)) throw new Error("Win rate must be between zero and one.");
  if (!(stopLossGrossReturnPct < 0)) throw new Error("Stop-loss gross return must be negative.");
  if (!(roundTripCostPct >= 0)) throw new Error("Round-trip cost must be non-negative.");
  const stoppedNetReturnPct = stopLossGrossReturnPct - roundTripCostPct;
  const requiredNetWinnerPct = -((1 - winRate) / winRate) * stoppedNetReturnPct;
  return round(requiredNetWinnerPct + roundTripCostPct);
}

export function createExitPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_EXIT_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_EXIT_POLICY,
  };
}

export function createTailStopPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_TAIL_STOP_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_TAIL_STOP_POLICY,
  };
}

export function create24hTailStopPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_24H_TAIL_STOP_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_24H_TAIL_STOP_POLICY,
  };
}

export function createDexTakeProfitPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY,
  };
}

export function createDexConfirmedTakeProfitPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY,
  };
}

export function createDexTailStopPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_DEX_TAIL_STOP_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_DEX_TAIL_STOP_POLICY,
  };
}

export function createPartialTrimPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_PARTIAL_TRIM_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_PARTIAL_TRIM_POLICY,
  };
}

export function createAsymmetricBracketPolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY,
  };
}

export function createOvershootPreservePolicyRegistrationEvent(registeredAt = new Date()) {
  return {
    type: "exit-policy-registration",
    id: `exit_policy_registration_${digest(TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY,
  };
}

export async function registerExitPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createExitPolicyRegistrationEvent(dependencies.now ?? new Date());
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenExitPolicy(existing)) {
    throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerTailStopPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createTailStopPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(TOKEN_EDGE_TAIL_STOP_POLICY.evidenceBoundary))) {
    throw new Error("Tail-stop registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_TAIL_STOP_POLICY,
    createTailStopPolicyRegistrationEvent,
  )) {
    throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function register24hTailStopPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = create24hTailStopPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(TOKEN_EDGE_24H_TAIL_STOP_POLICY.evidenceBoundary))) {
    throw new Error("24-hour tail-stop registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_24H_TAIL_STOP_POLICY,
    create24hTailStopPolicyRegistrationEvent,
  )) throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerDexTakeProfitPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createDexTakeProfitPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.evidenceBoundary,
  ))) {
    throw new Error("DEX take-profit registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY,
    createDexTakeProfitPolicyRegistrationEvent,
  )) {
    throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerDexConfirmedTakeProfitPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createDexConfirmedTakeProfitPolicyRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY.evidenceBoundary,
  ))) {
    throw new Error("DEX confirmed take-profit registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY,
    createDexConfirmedTakeProfitPolicyRegistrationEvent,
  )) throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerDexTailStopPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createDexTailStopPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_DEX_TAIL_STOP_POLICY.evidenceBoundary,
  ))) {
    throw new Error("DEX tail-stop registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_DEX_TAIL_STOP_POLICY,
    createDexTailStopPolicyRegistrationEvent,
  )) {
    throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerPartialTrimPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createPartialTrimPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_PARTIAL_TRIM_POLICY.evidenceBoundary,
  ))) throw new Error("Partial-trim registration must be strictly after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_PARTIAL_TRIM_POLICY,
    createPartialTrimPolicyRegistrationEvent,
  )) throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerAsymmetricBracketPolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createAsymmetricBracketPolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.evidenceBoundary,
  ))) throw new Error("Asymmetric-bracket registration must be strictly after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY,
    createAsymmetricBracketPolicyRegistrationEvent,
  )) throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export async function registerOvershootPreservePolicy(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const proposed = createOvershootPreservePolicyRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.evidenceBoundary,
  ))) throw new Error("Overshoot-preserve registration must be strictly after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFrozenPolicy(
    existing,
    TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY,
    createOvershootPreservePolicyRegistrationEvent,
  )) throw new Error(`Existing exit-policy registration mismatch: ${proposed.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    policyVersion: signed.policyVersion,
  };
}

export function buildExitPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_EXIT_POLICY, {
    registrationFactory: createExitPolicyRegistrationEvent,
    exitSource: "live-path-take-profit",
    exitCountKey: "takeProfitExits",
    rawExitCountKey: "rawTakeProfitExits",
    shortfallKey: "takeProfitExits",
    minimumExitCount: TOKEN_EDGE_EXIT_POLICY.minimumTakeProfitExits,
    matches: (event) => (
      event.grossReturnFromEntryPct >= TOKEN_EDGE_EXIT_POLICY.takeProfitGrossReturnPctInclusive
    ),
    requireCompletePath: false,
  });
}

export function buildTailStopPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_TAIL_STOP_POLICY, {
    registrationFactory: createTailStopPolicyRegistrationEvent,
    exitSource: "live-path-stop-loss",
    exitCountKey: "stopLossExits",
    rawExitCountKey: "rawStopLossExits",
    shortfallKey: "stopLossExits",
    minimumExitCount: TOKEN_EDGE_TAIL_STOP_POLICY.minimumStopLossExits,
    matches: (event) => (
      event.grossReturnFromEntryPct <= TOKEN_EDGE_TAIL_STOP_POLICY.stopLossGrossReturnPctInclusive
    ),
    requireCompletePath: true,
  });
}

export function build24hTailStopPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_24H_TAIL_STOP_POLICY, {
    registrationFactory: create24hTailStopPolicyRegistrationEvent,
    exitSource: "live-path-stop-loss",
    exitCountKey: "stopLossExits",
    rawExitCountKey: "rawStopLossExits",
    shortfallKey: "stopLossExits",
    minimumExitCount: TOKEN_EDGE_24H_TAIL_STOP_POLICY.minimumStopLossExits,
    matches: (event) => (
      event.grossReturnFromEntryPct
        <= TOKEN_EDGE_24H_TAIL_STOP_POLICY.stopLossGrossReturnPctInclusive
    ),
    requireCompletePath: true,
    independentFrameDurationMs: DAY_MS,
    noExitSource: () => "fixed-twenty-four-hour-outcome",
    note: "The unchanged -10% stop is evaluated only at retained five-minute response marks across the full 24-hour horizon. Scoring requires at least six marks and no entry-to-mark, mark-to-mark, or mark-to-due gap over ten minutes; no unseen crossing is inferred and upside remains uncapped. Only the earliest exact asset receives weight inside an independent 24-hour frame.",
  });
}

export function buildDexTakeProfitPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY, {
    registrationFactory: createDexTakeProfitPolicyRegistrationEvent,
    exitSource: "live-path-take-profit",
    exitCountKey: "takeProfitExits",
    rawExitCountKey: "rawTakeProfitExits",
    shortfallKey: "takeProfitExits",
    minimumExitCount: TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.minimumTakeProfitExits,
    matches: (event) => (
      event.grossReturnFromEntryPct
        >= TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.takeProfitGrossReturnPctInclusive
    ),
    requireCompletePath: false,
  });
}

export function buildDexConfirmedTakeProfitPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY, {
    registrationFactory: createDexConfirmedTakeProfitPolicyRegistrationEvent,
    exitSource: "live-path-confirmed-take-profit",
    exitCountKey: "confirmedTakeProfitExits",
    rawExitCountKey: "rawConfirmedTakeProfitExits",
    shortfallKey: "confirmedTakeProfitExits",
    minimumExitCount: TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY.minimumTakeProfitExits,
    selectPathExit: (paths) => confirmedThresholdExit(
      paths,
      TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY,
    ),
    requireCompletePath: false,
    note: "A take-profit is recorded only at the second of two consecutive retained +10% marks separated by 4 to 10 minutes. The second observed quote is the fill; isolated spikes, non-qualifying intervening marks, and unseen intrabar crossings do not count. Only the earliest exact-asset signal receives weight inside an independent one-hour frame.",
  });
}

export function buildDexTailStopPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_DEX_TAIL_STOP_POLICY, {
    registrationFactory: createDexTailStopPolicyRegistrationEvent,
    exitSource: "live-path-stop-loss",
    exitCountKey: "stopLossExits",
    rawExitCountKey: "rawStopLossExits",
    shortfallKey: "stopLossExits",
    minimumExitCount: TOKEN_EDGE_DEX_TAIL_STOP_POLICY.minimumStopLossExits,
    matches: (event) => (
      event.grossReturnFromEntryPct
        <= TOKEN_EDGE_DEX_TAIL_STOP_POLICY.stopLossGrossReturnPctInclusive
    ),
    requireCompletePath: true,
  });
}

export function buildPartialTrimPolicyScorecard(events) {
  return buildPathExitPolicyScorecard(events, TOKEN_EDGE_PARTIAL_TRIM_POLICY, {
    registrationFactory: createPartialTrimPolicyRegistrationEvent,
    exitSource: "live-path-half-trim",
    exitCountKey: "trimExits",
    rawExitCountKey: "rawTrimExits",
    shortfallKey: "trimExits",
    minimumExitCount: TOKEN_EDGE_PARTIAL_TRIM_POLICY.minimumTrimExits,
    matches: (event) => (
      event.grossReturnFromEntryPct
        >= TOKEN_EDGE_PARTIAL_TRIM_POLICY.trimTriggerGrossReturnPctInclusive
    ),
    requireCompletePath: false,
    trimFraction: TOKEN_EDGE_PARTIAL_TRIM_POLICY.trimFraction,
    note: "A trigger is evaluated only at its retained response time. Half exits at the first retained +10% mark and the remainder holds to the exact due outcome with uncapped upside. Each tranche conservatively receives the full $100 capacity-impact estimate before weighting; no unseen intrabar fill is assumed. Only the earliest exact-asset signal receives weight inside an independent one-hour frame.",
  });
}

export function buildAsymmetricBracketPolicyScorecard(events) {
  const scorecard = buildPathExitPolicyScorecard(events, TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY, {
    registrationFactory: createAsymmetricBracketPolicyRegistrationEvent,
    exitSource: (event) => event.grossReturnFromEntryPct
      <= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.stopLossGrossReturnPctInclusive
      ? "live-path-stop-loss" : "live-path-half-trim",
    exitCountKey: "thresholdExits",
    rawExitCountKey: "rawThresholdExits",
    shortfallKey: "thresholdExits",
    minimumExitCount: 0,
    matches: (event) => (
      event.grossReturnFromEntryPct
        <= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.stopLossGrossReturnPctInclusive
      || event.grossReturnFromEntryPct
        >= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.trimTriggerGrossReturnPctInclusive
    ),
    trimWhen: (event) => event.grossReturnFromEntryPct
      >= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.trimTriggerGrossReturnPctInclusive,
    countExit: (row) => row.exitSource === "live-path-stop-loss"
      || row.exitSource === "live-path-half-trim",
    requireCompletePath: true,
    trimFraction: TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.trimFraction,
    note: "The first retained point at or outside [-10%, +10%] determines the action: a full stop below, or a half trim above with the remainder held uncapped to the exact due outcome. Six marks and ten-minute maximum gaps are required; no unseen crossing is inferred.",
  });
  const weightedForecastIds = new Set(independentFrames(scorecard.observationsDetail)
    .weightedObservations.map((row) => row.forecastId));
  const weighted = scorecard.observationsDetail.filter((row) => weightedForecastIds.has(row.forecastId));
  const stopLossExits = weighted.filter((row) => row.exitSource === "live-path-stop-loss").length;
  const trimExits = weighted.filter((row) => row.exitSource === "live-path-half-trim").length;
  const exitBreadthReady = stopLossExits >= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.minimumStopLossExits
    && trimExits >= TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.minimumTrimExits;
  const evidenceShortfall = { ...scorecard.evidenceShortfall };
  delete evidenceShortfall.thresholdExits;
  return {
    ...scorecard,
    stopLossExits,
    trimExits,
    evidenceStatus: scorecard.evidenceStatus === "audit-ready" && exitBreadthReady
      ? "audit-ready" : "collecting",
    evidenceShortfall: {
      ...evidenceShortfall,
      stopLossExits: Math.max(
        0,
        TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.minimumStopLossExits - stopLossExits,
      ),
      trimExits: Math.max(
        0,
        TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.minimumTrimExits - trimExits,
      ),
    },
    provisionalGate: scorecard.provisionalGate && exitBreadthReady,
  };
}

export function buildOvershootPreservePolicyScorecard(events) {
  const firstTrigger = (paths) => paths.find((event) => (
    event.grossReturnFromEntryPct
      >= TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.takeProfitGrossReturnPctInclusive
  ));
  const scorecard = buildPathExitPolicyScorecard(events, TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY, {
    registrationFactory: createOvershootPreservePolicyRegistrationEvent,
    exitSource: "live-path-shallow-take-profit",
    exitCountKey: "shallowTakeProfitExits",
    rawExitCountKey: "rawShallowTakeProfitExits",
    shortfallKey: "shallowTakeProfitExits",
    minimumExitCount: 0,
    selectPathExit: (paths) => {
      const trigger = firstTrigger(paths);
      return trigger && trigger.grossReturnFromEntryPct
        < TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.overshootGrossReturnPctInclusive
        ? trigger : null;
    },
    noExitSource: (paths) => {
      const trigger = firstTrigger(paths);
      return trigger && trigger.grossReturnFromEntryPct
        >= TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.overshootGrossReturnPctInclusive
        ? "fixed-one-hour-overshoot-preserved" : "fixed-one-hour-outcome";
    },
    matches: () => false,
    requireCompletePath: true,
    note: "The first retained complete-path mark at or above +10% determines the action. A shallow +10% to below +20% crossing exits all; a first observed +20% or stronger overshoot preserves the full one-hour tail even if later marks reverse. Six marks and ten-minute maximum gaps are required; no unseen crossing is inferred.",
  });
  const weightedForecastIds = new Set(independentFrames(scorecard.observationsDetail)
    .weightedObservations.map((row) => row.forecastId));
  const weighted = scorecard.observationsDetail.filter((row) => weightedForecastIds.has(row.forecastId));
  const shallowTakeProfitExits = weighted.filter((row) => (
    row.exitSource === "live-path-shallow-take-profit"
  )).length;
  const preservedTailHolds = weighted.filter((row) => (
    row.exitSource === "fixed-one-hour-overshoot-preserved"
  )).length;
  const exitBreadthReady = shallowTakeProfitExits
    >= TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.minimumShallowTakeProfitExits
    && preservedTailHolds >= TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.minimumPreservedTailHolds;
  return {
    ...scorecard,
    shallowTakeProfitExits,
    preservedTailHolds,
    evidenceStatus: scorecard.evidenceStatus === "audit-ready" && exitBreadthReady
      ? "audit-ready" : "collecting",
    evidenceShortfall: {
      ...scorecard.evidenceShortfall,
      shallowTakeProfitExits: Math.max(
        0,
        TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.minimumShallowTakeProfitExits
          - shallowTakeProfitExits,
      ),
      preservedTailHolds: Math.max(
        0,
        TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.minimumPreservedTailHolds - preservedTailHolds,
      ),
    },
    provisionalGate: scorecard.provisionalGate && exitBreadthReady,
  };
}

function buildPathExitPolicyScorecard(events, policy, mode) {
  const registration = events.find((event) => (
    matchesFrozenPolicy(event, policy, mode.registrationFactory)
  )) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const boundaryAt = Date.parse(policy.evidenceBoundary);
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const sourceChallenger = TOKEN_EDGE_CHALLENGERS.find((challenger) => (
    challenger.modelVersion === policy.sourceModelVersion
    && challenger.candidateId === policy.sourceCandidateId
    && challenger.horizon === policy.horizon
    && challenger.provider === policy.selectionProvider
    && challenger.selectionTimeframe === policy.selectionTimeframe
  )) ?? null;
  const rejectedSourceForecastIds = sourceChallenger
    ? rejectedChallengerForecastIds(events, [sourceChallenger])
    : null;
  const pathsByForecast = linkedPathObservations(events);
  const exclusions = {};
  const pathExclusions = {};
  const observations = [];
  for (const outcome of events.filter((event) => event.type === "resolution")) {
    const forecast = forecasts.get(outcome.forecastId);
    const snapshot = forecast ? snapshots.get(forecast.snapshotId) : null;
    const reason = exclusionReason({
      registration,
      registrationAt,
      boundaryAt,
      forecast,
      snapshot,
      outcome,
      eventById,
      policy,
      sourceChallenger,
      rejectedSourceForecastIds,
    });
    if (reason) {
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
      continue;
    }
    const paths = [];
    for (const event of pathsByForecast.get(forecast.id) ?? []) {
      const pathReason = pathExclusionReason(event, forecast, snapshot);
      if (pathReason) {
        pathExclusions[pathReason] = (pathExclusions[pathReason] ?? 0) + 1;
      } else paths.push(event);
    }
    if (mode.requireCompletePath) {
      const coverageReason = pathCoverageReason(paths, forecast, policy);
      if (coverageReason) {
        pathExclusions[coverageReason] = (pathExclusions[coverageReason] ?? 0) + 1;
        continue;
      }
    }
    const pathExit = typeof mode.selectPathExit === "function"
      ? mode.selectPathExit(paths)
      : paths.find(mode.matches);
    const exitGrossReturnPct = pathExit?.grossReturnFromEntryPct ?? outcome.grossReturnPct;
    const exitLiquidityUsd = pathExit?.observedLiquidityUsd
      ?? outcome.executionEvidence.exitLiquidityUsd;
    const baselineNetReturnPct = capacityReturn(
      outcome.grossReturnPct,
      snapshot.market.liquidityUsd,
      outcome.executionEvidence.exitLiquidityUsd,
      TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    );
    const trimFraction = pathExit && Number.isFinite(mode.trimFraction)
      && (!mode.trimWhen || mode.trimWhen(pathExit))
      ? mode.trimFraction
      : null;
    const exitSource = pathExit
      ? typeof mode.exitSource === "function" ? mode.exitSource(pathExit) : mode.exitSource
      : typeof mode.noExitSource === "function" ? mode.noExitSource(paths) : "fixed-one-hour-outcome";
    const policyNetReturnPct = trimFraction == null
      ? capacityReturn(
        exitGrossReturnPct,
        snapshot.market.liquidityUsd,
        exitLiquidityUsd,
        TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
      )
      : blendedTrimReturn({
        trimFraction,
        trimGrossReturnPct: pathExit.grossReturnFromEntryPct,
        trimExitLiquidityUsd: pathExit.observedLiquidityUsd,
        remainderGrossReturnPct: outcome.grossReturnPct,
        remainderExitLiquidityUsd: outcome.executionEvidence.exitLiquidityUsd,
        entryLiquidityUsd: snapshot.market.liquidityUsd,
        roundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
      });
    const stressedPolicyNetReturnPct = trimFraction == null
      ? capacityReturn(
        exitGrossReturnPct,
        snapshot.market.liquidityUsd,
        exitLiquidityUsd,
        TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
      )
      : blendedTrimReturn({
        trimFraction,
        trimGrossReturnPct: pathExit.grossReturnFromEntryPct,
        trimExitLiquidityUsd: pathExit.observedLiquidityUsd,
        remainderGrossReturnPct: outcome.grossReturnPct,
        remainderExitLiquidityUsd: outcome.executionEvidence.exitLiquidityUsd,
        entryLiquidityUsd: snapshot.market.liquidityUsd,
        roundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
      });
    if (![baselineNetReturnPct, policyNetReturnPct, stressedPolicyNetReturnPct].every(Number.isFinite)) {
      exclusions["unscorable-capacity-return"] = (exclusions["unscorable-capacity-return"] ?? 0) + 1;
      continue;
    }
    observations.push({
      forecastId: forecast.id,
      snapshotId: forecast.snapshotId,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      createdAt: forecast.createdAt,
      dueAt: forecast.dueAt,
      validPathMarks: paths.length,
      exitSource,
      exitObservedAt: pathExit?.observedAt ?? outcome.observedAt,
      exitGrossReturnPct,
      trimFraction,
      trimGrossReturnPct: trimFraction == null ? null : pathExit.grossReturnFromEntryPct,
      remainderGrossReturnPct: trimFraction == null ? null : outcome.grossReturnPct,
      baselineNetReturnPct,
      policyNetReturnPct,
      stressedPolicyNetReturnPct,
      pairedDeltaPct: round(policyNetReturnPct - baselineNetReturnPct),
    });
  }
  const frameData = independentFrames(
    observations,
    mode.independentFrameDurationMs ?? HOUR_MS,
  );
  const frames = frameData.frames;
  const deltas = frames.map((frame) => frame.pairedDeltaPct);
  const deltaCi95 = frames.length >= 2
    ? bootstrapMeanInterval(deltas, policy.bootstrapIterations)
    : [null, null];
  const weightedObservations = frameData.weightedObservations;
  const countsAsExit = (row) => typeof mode.countExit === "function"
    ? mode.countExit(row)
    : row.exitSource === mode.exitSource;
  const exitCount = weightedObservations.filter(countsAsExit).length;
  const rawExitCount = observations.filter(countsAsExit).length;
  const policyReturns = frames.map((frame) => frame.policyNetReturnPct);
  const stressedReturns = frames.map((frame) => frame.stressedPolicyNetReturnPct);
  const uniqueTokens = new Set(observations.map((row) => exactText(row.tokenAddress))).size;
  const profitFactorValue = profitFactor(policyReturns);
  const maxDrawdownValue = maxDrawdown(policyReturns);
  const largestWinnerShare = largestWinningShare(policyReturns);
  const evidenceReady = registration
    && weightedObservations.length >= policy.minimumMaturedForecasts
    && frames.length >= policy.minimumIndependentFrames
    && uniqueTokens >= policy.minimumUniqueTokens
    && exitCount >= mode.minimumExitCount;
  return {
    type: "token-edge-exit-policy-scorecard",
    policyVersion: policy.policyVersion,
    evidenceBoundary: policy.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: policy.posthocDerived,
    observations: observations.length,
    weightedUniqueAssetObservations: weightedObservations.length,
    sameAssetOverlappingObservations: observations.length - weightedObservations.length,
    independentFrames: frames.length,
    uniqueTokens,
    [mode.exitCountKey]: exitCount,
    [mode.rawExitCountKey]: rawExitCount,
    fixedHorizonExits: weightedObservations.length - exitCount,
    exclusionCounts: exclusions,
    pathExclusionCounts: pathExclusions,
    baselineFrameMeanNetReturnPct: nullableRound(mean(frames, "baselineNetReturnPct")),
    policyFrameMeanNetReturnPct: nullableRound(mean(frames, "policyNetReturnPct")),
    pairedFrameMeanDeltaPct: nullableRound(mean(frames, "pairedDeltaPct")),
    pairedBootstrapMeanDeltaCi95Pct: deltaCi95.map(nullableRound),
    stressedPolicyFrameMeanNetReturnPct: nullableRound(mean(frames, "stressedPolicyNetReturnPct")),
    profitFactor: nullableRound(profitFactorValue),
    maxDrawdownPct: nullableRound(maxDrawdownValue),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(
        0,
        policy.minimumMaturedForecasts - weightedObservations.length,
      ),
      independentFrames: Math.max(0, policy.minimumIndependentFrames - frames.length),
      uniqueTokens: Math.max(0, policy.minimumUniqueTokens - uniqueTokens),
      [mode.shortfallKey]: Math.max(0, mode.minimumExitCount - exitCount),
    },
    provisionalGate: Boolean(evidenceReady
      && deltaCi95[0] > 0
      && mean(policyReturns) > 0
      && mean(stressedReturns) > 0
      && profitFactorValue >= policy.minimumProfitFactor
      && maxDrawdownValue <= policy.maximumDrawdownPct
      && largestWinnerShare <= policy.maximumLargestWinningFrameShare),
    observationsDetail: observations,
    note: mode.note ?? (mode.requireCompletePath
      ? "A stop is evaluated only at its first retained response mark. Scoring requires at least six marks with no entry-to-mark, mark-to-mark, or mark-to-due gap over ten minutes; no unseen intrabar fill is assumed. Upside remains uncapped. Only the earliest exact-asset signal receives weight inside an independent one-hour frame."
      : "A point mark is evaluated only at its retained response time; no unseen intrabar threshold fill is assumed. Only the earliest exact-asset signal receives weight inside an independent one-hour frame."),
  };
}

function exclusionReason({
  registration,
  registrationAt,
  boundaryAt,
  forecast,
  snapshot,
  outcome,
  eventById,
  policy,
  sourceChallenger,
  rejectedSourceForecastIds,
}) {
  if (!registration) return "missing-frozen-registration";
  if (!forecast || !snapshot) return "missing-forecast-or-snapshot";
  if (outcome.status !== "observed" || outcome.observationMode !== "live-point-in-time") {
    return "not-live-fixed-horizon-outcome";
  }
  const timingReason = exactLiveOutcomeTimingReason(outcome);
  if (timingReason) return timingReason;
  if (forecast.status !== "ready"
    || forecast.modelVersion !== policy.sourceModelVersion
    || forecast.candidateId !== policy.sourceCandidateId
    || forecast.horizon !== policy.horizon
    || forecast.selectionProvider !== policy.selectionProvider
    || forecast.selectionTimeframe !== policy.selectionTimeframe
    || forecast.predictedRise !== true) return "wrong-source-forecast";
  const createdAt = Date.parse(forecast.createdAt);
  if (!(createdAt > registrationAt && createdAt > boundaryAt)) return "not-strictly-future";
  if (!validExecutionPolicyLink(forecast, eventById)) return "invalid-execution-policy-link";
  if (sourceChallenger) {
    if (rejectedSourceForecastIds.has(forecast.id)) return "invalid-source-lineage";
  } else if (!validSourceLineage(forecast, snapshot, eventById, policy)) {
    return "invalid-source-lineage";
  }
  if (forecast.createdAt !== snapshot.observedAt
    || forecast.chain !== snapshot.chain
    || forecast.tokenAddress !== snapshot.tokenAddress) return "forecast-snapshot-mismatch";
  if (outcome.snapshotId !== snapshot.id
    || outcome.modelVersion !== forecast.modelVersion
    || outcome.candidateId !== forecast.candidateId
    || outcome.horizon !== forecast.horizon
    || outcome.chain !== forecast.chain
    || outcome.tokenAddress !== forecast.tokenAddress
    || outcome.dueAt !== forecast.dueAt) return "resolution-forecast-mismatch";
  if (Date.parse(outcome.observedAt) < Date.parse(forecast.dueAt)) return "resolution-before-due";
  if (outcome.entryPriceUsd !== snapshot.market?.priceUsd
    || !(outcome.observedPriceUsd > 0)
    || outcome.grossReturnPct !== round(
      ((outcome.observedPriceUsd / snapshot.market?.priceUsd) - 1) * 100,
    )) return "resolution-return-mismatch";
  const evidence = outcome.executionEvidence;
  if (!(snapshot.market?.liquidityUsd > 0)
    || evidence?.entryMarketObservedAt !== snapshot.market?.observedAt
    || evidence?.entryPairAddress !== snapshot.market?.pairAddress
    || evidence?.entryLiquidityUsd !== snapshot.market?.liquidityUsd
    || !(evidence?.exitLiquidityUsd > 0)
    || evidence?.exitMarketObservedAt !== outcome.observedAt
    || exactText(snapshot.market?.pairAddress) !== exactText(evidence?.exitPairAddress)) {
    return "invalid-fixed-horizon-execution-evidence";
  }
  if (Date.parse(outcome.observedAt) >= Date.parse(
    TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.appliesFrom,
  ) && !validTokenEdgeStoredExecutionPriceIntegrity(
    outcome.providerPriceIntegrity,
    outcome.observedPriceUsd,
    evidence.exitLiquidityUsd,
  )) return "provider-price-integrity-mismatch";
  return null;
}

function pathExclusionReason(event, forecast, snapshot) {
  const observedAt = Date.parse(event.observedAt);
  if (event.researchOnly !== true || event.mutationAllowed !== false
    || event.observationMode !== "live-point-in-time-path") return "invalid-path-contract";
  if (!(observedAt > Date.parse(forecast.createdAt)
    && observedAt <= Date.parse(forecast.dueAt))) return "path-outside-forecast-window";
  if (event.snapshotId !== forecast.snapshotId
    || event.signalCreatedAt !== forecast.createdAt
    || event.dueAt !== forecast.dueAt
    || event.horizon !== forecast.horizon
    || event.chain !== forecast.chain
    || event.tokenAddress !== forecast.tokenAddress) return "path-forecast-mismatch";
  if (event.entryMarketObservedAt !== snapshot.market?.observedAt
    || event.entryPairAddress !== snapshot.market?.pairAddress
    || event.entryPriceUsd !== snapshot.market?.priceUsd
    || event.entryLiquidityUsd !== snapshot.market?.liquidityUsd
    || event.observedPairAddress !== snapshot.market?.pairAddress
    || !(event.observedLiquidityUsd > 0)) return "path-market-evidence-mismatch";
  if (!(event.observedPriceUsd > 0)
    || event.grossReturnFromEntryPct !== round(
      ((event.observedPriceUsd / event.entryPriceUsd) - 1) * 100,
    )) return "path-return-mismatch";
  if (observedAt >= Date.parse(TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.appliesFrom)
    && !validTokenEdgeStoredExecutionPriceIntegrity(
      event.providerPriceIntegrity,
      event.observedPriceUsd,
      event.observedLiquidityUsd,
    )) return "provider-price-integrity-mismatch";
  return null;
}

function pathCoverageReason(paths, forecast, policy) {
  if (paths.length < policy.minimumPathMarks) return "insufficient-path-marks";
  const timestamps = [
    Date.parse(forecast.createdAt),
    ...paths.map((event) => Date.parse(event.observedAt)),
    Date.parse(forecast.dueAt),
  ];
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1] > policy.maximumPathGapMs) {
      return "path-cadence-gap";
    }
  }
  return null;
}

function validExecutionPolicyLink(forecast, eventById) {
  const linked = eventById.get(forecast.executionPolicyRegistrationId);
  if (!linked || !Number.isFinite(Date.parse(linked.registeredAt))) return false;
  const expected = createExecutionPolicyRegistrationEvents(linked.registeredAt)[0];
  return linked.id === expected.id
    && Object.entries(expected).every(([key, value]) => sameJson(linked[key], value))
    && forecast.executionPolicyRegisteredAt === linked.registeredAt
    && forecast.executionPolicyVersion === linked.policyVersion
    && forecast.roundTripCostPct === linked.baseRoundTripCostPct
    && Date.parse(forecast.createdAt) > Date.parse(linked.registeredAt);
}

function validSourceLineage(forecast, snapshot, eventById, policy) {
  const discovery = eventById.get(forecast.selectionDiscoveryEventId);
  const confirmation = eventById.get(forecast.selectionConfirmationEventId);
  const selected = eligibleAsset(discovery, forecast);
  const confirmed = eligibleAsset(confirmation, forecast);
  const selection = snapshot.selection;
  const evidence = forecast.inputEvidence;
  const discoveryAt = Date.parse(discovery?.observedAt ?? "");
  const availableAt = Date.parse(discovery?.availableAt ?? discovery?.observedAt ?? "");
  const confirmationAt = Date.parse(confirmation?.observedAt ?? "");
  const forecastAt = Date.parse(forecast.createdAt);
  return discovery?.type === "discovery"
    && discovery.provider === policy.selectionProvider
    && discovery.timeframe === policy.selectionTimeframe
    && confirmation?.type === "market-confirmation"
    && confirmation.sourceEventId === discovery.id
    && selected != null
    && confirmed != null
    && [discoveryAt, availableAt, confirmationAt, forecastAt].every(Number.isFinite)
    && availableAt >= discoveryAt
    && confirmationAt >= availableAt
    && forecastAt >= confirmationAt
    && forecastAt - discoveryAt <= 6 * HOUR_MS
    && selection?.status === "verified"
    && selection.provider === discovery.provider
    && selection.timeframe === discovery.timeframe
    && selection.discoveryEventId === discovery.id
    && selection.confirmationEventId === confirmation.id
    && selection.discoveryObservedAt === discovery.observedAt
    && selection.discoveryAvailableAt === (discovery.availableAt ?? discovery.observedAt)
    && selection.confirmationObservedAt === confirmation.observedAt
    && evidence?.provider === discovery.provider
    && evidence?.timeframe === discovery.timeframe
    && evidence?.discoveryEventId === discovery.id
    && evidence?.confirmationEventId === confirmation.id
    && evidence?.discoveryNetflowUsd === (selected.netflowUsd ?? null)
    && evidence?.discoveryNetflowToLiquidity === (selected.netflowToLiquidity ?? null)
    && evidence?.discoveryBuySellVolumeRatio === (selected.buySellVolumeRatio ?? null)
    && evidence?.discoveryPriceChangePct === (selected.priceChangePct ?? null)
    && evidence?.confirmedLiquidityUsd === (confirmed.market?.liquidityUsd ?? null);
}

function eligibleAsset(event, forecast) {
  return event?.candidates?.find((candidate) => (
    candidate.status === "eligible"
    && candidate.chain === forecast.chain
    && candidate.tokenAddress === forecast.tokenAddress
  )) ?? null;
}

function linkedPathObservations(events) {
  const result = new Map();
  for (const event of events.filter((row) => row.type === "forecast-path-observation")) {
    for (const forecastId of event.forecastIds ?? []) {
      const values = result.get(forecastId) ?? [];
      values.push(event);
      result.set(forecastId, values);
    }
  }
  for (const values of result.values()) {
    values.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  }
  return result;
}

function confirmedThresholdExit(paths, policy) {
  let previous = null;
  for (const event of paths) {
    const qualifies = event.grossReturnFromEntryPct
      >= policy.takeProfitGrossReturnPctInclusive;
    if (qualifies && previous) {
      const separationMs = Date.parse(event.observedAt) - Date.parse(previous.observedAt);
      if (separationMs >= policy.minimumConfirmationSeparationMs
        && separationMs <= policy.maximumConfirmationSeparationMs) return event;
    }
    previous = qualifies ? event : null;
  }
  return null;
}

function independentFrames(observations, durationMs = HOUR_MS) {
  const weightedFrames = independentAssetFrames(observations, {
    durationMs,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  return {
    frames: weightedFrames.map((values) => ({
      baselineNetReturnPct: mean(values, "baselineNetReturnPct"),
      policyNetReturnPct: mean(values, "policyNetReturnPct"),
      pairedDeltaPct: mean(values, "pairedDeltaPct"),
      stressedPolicyNetReturnPct: mean(values, "stressedPolicyNetReturnPct"),
    })),
    weightedObservations: weightedFrames.flat(),
  };
}

function capacityReturn(grossReturnPct, entryLiquidityUsd, exitLiquidityUsd, roundTripCostPct) {
  return capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd,
    exitLiquidityUsd,
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    roundTripCostPct,
  });
}

function blendedTrimReturn({
  trimFraction,
  trimGrossReturnPct,
  trimExitLiquidityUsd,
  remainderGrossReturnPct,
  remainderExitLiquidityUsd,
  entryLiquidityUsd,
  roundTripCostPct,
}) {
  const trimReturn = capacityReturn(
    trimGrossReturnPct, entryLiquidityUsd, trimExitLiquidityUsd, roundTripCostPct,
  );
  const remainderReturn = capacityReturn(
    remainderGrossReturnPct, entryLiquidityUsd, remainderExitLiquidityUsd, roundTripCostPct,
  );
  return (trimFraction * trimReturn) + ((1 - trimFraction) * remainderReturn);
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0x8f3a91c7;
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

function profitFactor(values) {
  if (!values.length) return null;
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return losses === 0 ? (gains > 0 ? 999 : null) : gains / losses;
}

function maxDrawdown(values) {
  if (!values.length) return null;
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - equity) / peak) * 100);
  }
  return drawdown;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function matchesFrozenExitPolicy(event) {
  return matchesFrozenPolicy(event, TOKEN_EDGE_EXIT_POLICY, createExitPolicyRegistrationEvent);
}

function matchesFrozenPolicy(event, policy, registrationFactory) {
  if (event?.type !== "exit-policy-registration" || event.status !== "frozen"
    || !Number.isFinite(Date.parse(event.registeredAt))) return false;
  const expected = registrationFactory(event.registeredAt);
  return event.id === expected.id
    && event.registeredAt === expected.registeredAt
    && Object.entries(policy).every(([key, value]) => sameJson(event[key], value));
}

function mean(values, key = null) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + (key ? value[key] : value), 0) / values.length;
}

function quantile(sorted, probability) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

function nullableRound(value) {
  return Number.isFinite(value) ? round(value) : null;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Exit-policy registration time is invalid.");
  return date.toISOString();
}

function exactText(value) {
  return String(value ?? "").trim();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseArgs(argv) {
  const options = { command: "score" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if ([
      "register",
      "score",
      "register-tail-stop",
      "score-tail-stop",
      "register-24h-tail-stop",
      "score-24h-tail-stop",
      "register-dex-take-profit",
      "score-dex-take-profit",
      "register-dex-confirmed-take-profit",
      "score-dex-confirmed-take-profit",
      "register-dex-tail-stop",
      "score-dex-tail-stop",
      "register-partial-trim",
      "score-partial-trim",
      "register-asymmetric-bracket",
      "score-asymmetric-bracket",
      "register-overshoot-preserve",
      "score-overshoot-preserve",
    ].includes(argument)) {
      options.command = argument;
    }
    else if (argument === "--ledger" && value) {
      options.ledgerPath = value;
      index += 1;
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if ([
    "register", "register-tail-stop", "register-24h-tail-stop", "register-dex-take-profit", "register-dex-confirmed-take-profit", "register-dex-tail-stop", "register-partial-trim",
    "register-asymmetric-bracket", "register-overshoot-preserve",
  ].includes(options.command)) {
    const registration = options.command === "register-tail-stop"
      ? registerTailStopPolicy(options)
      : options.command === "register-24h-tail-stop"
        ? register24hTailStopPolicy(options)
      : options.command === "register-dex-take-profit"
        ? registerDexTakeProfitPolicy(options)
        : options.command === "register-dex-confirmed-take-profit"
          ? registerDexConfirmedTakeProfitPolicy(options)
        : options.command === "register-dex-tail-stop"
          ? registerDexTailStopPolicy(options)
          : options.command === "register-partial-trim"
            ? registerPartialTrimPolicy(options)
            : options.command === "register-asymmetric-bracket"
              ? registerAsymmetricBracketPolicy(options)
              : options.command === "register-overshoot-preserve"
                ? registerOvershootPreservePolicy(options)
                : registerExitPolicy(options);
    registration.then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } else {
    const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
    readLedger(ledgerPath).then((events) => {
      const verification = verifyLedger(events);
      if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
      process.stdout.write(`${JSON.stringify({
        ledgerPath,
        verification,
        scorecard: options.command === "score-tail-stop"
          ? buildTailStopPolicyScorecard(events)
          : options.command === "score-24h-tail-stop"
            ? build24hTailStopPolicyScorecard(events)
          : options.command === "score-dex-take-profit"
            ? buildDexTakeProfitPolicyScorecard(events)
            : options.command === "score-dex-confirmed-take-profit"
              ? buildDexConfirmedTakeProfitPolicyScorecard(events)
            : options.command === "score-dex-tail-stop"
              ? buildDexTailStopPolicyScorecard(events)
              : options.command === "score-partial-trim"
                ? buildPartialTrimPolicyScorecard(events)
                : options.command === "score-asymmetric-bracket"
                  ? buildAsymmetricBracketPolicyScorecard(events)
                  : options.command === "score-overshoot-preserve"
                    ? buildOvershootPreservePolicyScorecard(events)
                    : buildExitPolicyScorecard(events),
      }, null, 2)}\n`);
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
