import type {
  LiquidityRangeAction,
  LiquidityRangeConfig,
  LiquidityRangeDecision,
  LiquidityRangeStatus,
} from "@/lib/types/liquidity-range-manager";

const TICK_BASE = 1.0001;
const MIN_TICK = -887_272;
const MAX_TICK = 887_272;

export type LiquidityRangePolicyInput = {
  config: LiquidityRangeConfig;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  tickSpacing: number;
  positionValueUsd: number | null;
  lastRebalancedAt: number | null;
  now?: number;
};

export function tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  return Math.pow(TICK_BASE, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const spacing = Math.max(1, Math.abs(Math.trunc(tickSpacing)));
  return clampTick(Math.round(tick / spacing) * spacing);
}

export function targetRangeAroundTick(currentTick: number, totalWidthBps: number, tickSpacing: number) {
  const spacing = Math.max(1, Math.abs(Math.trunc(tickSpacing)));
  const halfWidth = clamp(totalWidthBps, 20, 20_000) / 20_000;
  const lowerOffset = Math.ceil(Math.abs(Math.log(1 - Math.min(halfWidth, 0.95)) / Math.log(TICK_BASE)));
  const upperOffset = Math.ceil(Math.log(1 + halfWidth) / Math.log(TICK_BASE));
  let tickLower = floorToSpacing(currentTick - lowerOffset, spacing);
  let tickUpper = ceilToSpacing(currentTick + upperOffset, spacing);
  tickLower = clampTick(tickLower);
  tickUpper = clampTick(tickUpper);
  if (tickUpper <= tickLower) tickUpper = clampTick(tickLower + spacing);
  return { tickLower, tickUpper };
}

export function evaluateLiquidityRangePolicy(input: LiquidityRangePolicyInput): LiquidityRangeDecision {
  const now = input.now ?? Date.now();
  const config = input.config;
  const lower = Math.min(input.tickLower, input.tickUpper);
  const upper = Math.max(input.tickLower, input.tickUpper);
  const inside = input.currentTick >= lower && input.currentTick < upper;
  const distanceToLowerBps = inside ? priceMoveBps(lower - input.currentTick, "down") : 0;
  const distanceToUpperBps = inside ? priceMoveBps(upper - input.currentTick, "up") : 0;
  const distanceToNearestEdgeBps = inside ? Math.min(distanceToLowerBps, distanceToUpperBps) : 0;
  const status: LiquidityRangeStatus = !inside
    ? "out-of-range"
    : distanceToNearestEdgeBps <= config.triggerBufferBps
      ? "edge"
      : "in-range";
  const target = targetRangeAroundTick(input.currentTick, config.targetWidthBps, input.tickSpacing);
  const recoveredFraction = status === "out-of-range" ? 1 : status === "edge" ? 0.5 : 0;
  const expectedRecoveredFeesUsd = input.positionValueUsd == null
    ? null
    : roundUsd(input.positionValueUsd * (config.feeAprPct / 100) * (config.evaluationHorizonDays / 365) * recoveredFraction);
  const estimatedRebalanceCostUsd = roundUsd(config.gasCostUsd + config.estimatedIlCostUsd);
  const expectedNetBenefitUsd = expectedRecoveredFeesUsd == null
    ? null
    : roundUsd(expectedRecoveredFeesUsd - estimatedRebalanceCostUsd);
  const cooldownMs = config.minHoursBetweenRebalances * 60 * 60 * 1_000;
  const cooldownRemainingMs = input.lastRebalancedAt == null
    ? 0
    : Math.max(0, cooldownMs - (now - input.lastRebalancedAt));
  const economicGatePassed = expectedNetBenefitUsd != null && expectedNetBenefitUsd >= config.minNetBenefitUsd;
  const reasons: string[] = [];
  let action: LiquidityRangeAction = "hold";

  if (status === "in-range") {
    reasons.push(`Price is ${Math.round(distanceToNearestEdgeBps)} bps from the nearest edge, outside the ${config.triggerBufferBps} bps trigger buffer.`);
  } else if (status === "edge") {
    reasons.push(`Price is ${Math.round(distanceToNearestEdgeBps)} bps from the nearest edge.`);
    action = "watch";
  } else {
    reasons.push("The position is out of range and is not earning swap fees until price returns.");
    action = "watch";
  }

  if (status !== "in-range") {
    if (cooldownRemainingMs > 0) {
      reasons.push(`Cooldown has ${formatDuration(cooldownRemainingMs)} remaining, preventing churn.`);
    } else if (expectedNetBenefitUsd == null) {
      reasons.push("Position value is not priced in USD, so the fee-versus-cost gate cannot be proven.");
    } else if (!economicGatePassed) {
      reasons.push(`Modeled net benefit is $${expectedNetBenefitUsd.toFixed(2)}, below the $${config.minNetBenefitUsd.toFixed(2)} policy floor.`);
    } else {
      action = "propose-rebalance";
      reasons.push(`Modeled net benefit is $${expectedNetBenefitUsd.toFixed(2)} after gas and impermanent-loss assumptions.`);
    }
  }

  if (action === "propose-rebalance") {
    reasons.push(`The shadow target recenters at ticks ${target.tickLower} to ${target.tickUpper}; no transaction will be signed.`);
  }

  return {
    policyVersion: 1,
    status,
    action,
    currentTick: input.currentTick,
    effectiveTickLower: lower,
    effectiveTickUpper: upper,
    distanceToLowerBps: roundMetric(distanceToLowerBps),
    distanceToUpperBps: roundMetric(distanceToUpperBps),
    distanceToNearestEdgeBps: roundMetric(distanceToNearestEdgeBps),
    targetTickLower: target.tickLower,
    targetTickUpper: target.tickUpper,
    expectedRecoveredFeesUsd,
    estimatedRebalanceCostUsd,
    expectedNetBenefitUsd,
    cooldownRemainingMs,
    economicGatePassed,
    reasons,
    decidedAt: now,
  };
}

function priceMoveBps(tickDelta: number, direction: "up" | "down"): number {
  const ratio = Math.pow(TICK_BASE, tickDelta);
  return direction === "up" ? Math.max(0, (ratio - 1) * 10_000) : Math.max(0, (1 - ratio) * 10_000);
}

function floorToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function ceilToSpacing(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing;
}

function clampTick(tick: number): number {
  return Math.min(MAX_TICK, Math.max(MIN_TICK, Math.trunc(tick)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatDuration(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1_000));
  return hours <= 1 ? "under one hour" : `${hours} hours`;
}
