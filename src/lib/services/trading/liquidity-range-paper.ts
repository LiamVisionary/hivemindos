import { positionAmounts, stableQuotedValue } from "@/lib/services/trading/liquidity-range-onchain";
import type {
  LiquidityPositionSnapshot,
  LiquidityRangeConfig,
  LiquidityRangeDecision,
  LiquidityRangePaperState,
} from "@/lib/types/liquidity-range-manager";

const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

type MarkInput = {
  previous: LiquidityRangePaperState | null;
  config: LiquidityRangeConfig;
  snapshot: LiquidityPositionSnapshot;
  tickLower: number;
  tickUpper: number;
  now: number;
};

type ApplyDecisionInput = {
  state: LiquidityRangePaperState;
  config: LiquidityRangeConfig;
  snapshot: LiquidityPositionSnapshot;
  decision: LiquidityRangeDecision;
  now: number;
};

export function markLiquidityRangePaperState(input: MarkInput): LiquidityRangePaperState | null {
  const lower = Math.min(input.tickLower, input.tickUpper);
  const upper = Math.max(input.tickLower, input.tickUpper);
  if (!input.previous) return initializePaperState(input, lower, upper);

  const previous = input.previous;
  const marked = markPosition(previous.liquidity, input.snapshot, lower, upper);
  if (!marked) return previous;
  const elapsedMs = Math.max(0, input.now - previous.lastUpdatedAt);
  const inRange = input.snapshot.currentTick >= lower && input.snapshot.currentTick < upper;
  const averagePrincipalUsd = Math.max(0, (previous.principalUsd + marked.principalUsd) / 2);
  const feeIncrementUsd = inRange
    ? averagePrincipalUsd * Math.max(0, input.config.feeAprPct) / 100 * elapsedMs / YEAR_MS
    : 0;
  return withReturns({
    ...previous,
    lastUpdatedAt: input.now,
    tickLower: lower,
    tickUpper: upper,
    inRange,
    principalUsd: marked.principalUsd,
    modeledFeesUsd: previous.modeledFeesUsd + feeIncrementUsd,
  }, input.snapshot);
}

export function applyLiquidityRangePaperDecision(input: ApplyDecisionInput): LiquidityRangePaperState {
  if (input.decision.action !== "propose-rebalance") return input.state;
  const tickLower = Math.min(input.decision.targetTickLower, input.decision.targetTickUpper);
  const tickUpper = Math.max(input.decision.targetTickLower, input.decision.targetTickUpper);
  const rebalanceCostUsd = Math.max(0, input.config.gasCostUsd) + Math.max(0, input.config.estimatedIlCostUsd);
  const availableUsd = Math.max(0, input.state.principalUsd + input.state.modeledFeesUsd - rebalanceCostUsd);
  const liquidity = liquidityForUsd(availableUsd, input.snapshot, tickLower, tickUpper);
  const marked = markPosition(liquidity, input.snapshot, tickLower, tickUpper);
  const next = {
    ...input.state,
    lastUpdatedAt: input.now,
    liquidity,
    tickLower,
    tickUpper,
    inRange: input.snapshot.currentTick >= tickLower && input.snapshot.currentTick < tickUpper,
    principalUsd: marked?.principalUsd ?? 0,
    modeledFeesUsd: 0,
    cumulativeRebalanceCostsUsd: input.state.cumulativeRebalanceCostsUsd + rebalanceCostUsd,
    rebalanceCount: input.state.rebalanceCount + 1,
    lastRebalancedAt: input.now,
  } satisfies LiquidityRangePaperState;
  return withReturns(next, input.snapshot);
}

function initializePaperState(input: MarkInput, tickLower: number, tickUpper: number): LiquidityRangePaperState | null {
  const initialUsd = input.snapshot.positionValueUsd;
  if (initialUsd == null || !Number.isFinite(initialUsd) || initialUsd <= 0) return null;
  const liquidity = liquidityForUsd(initialUsd, input.snapshot, tickLower, tickUpper);
  const marked = markPosition(liquidity, input.snapshot, tickLower, tickUpper);
  if (!marked) return null;
  const state = {
    version: 1,
    feeModel: "configured-apr",
    startedAt: input.now,
    lastUpdatedAt: input.now,
    initialUsd: marked.principalUsd,
    initialAmount0: marked.amount0,
    initialAmount1: marked.amount1,
    liquidity,
    tickLower,
    tickUpper,
    inRange: input.snapshot.currentTick >= tickLower && input.snapshot.currentTick < tickUpper,
    principalUsd: marked.principalUsd,
    modeledFeesUsd: 0,
    cumulativeRebalanceCostsUsd: 0,
    totalUsd: marked.principalUsd,
    normalizedReturnPct: 0,
    hodlUsd: marked.principalUsd,
    hodlReturnPct: 0,
    excessVsHodlPct: 0,
    rebalanceCount: 0,
    lastRebalancedAt: null,
  } satisfies LiquidityRangePaperState;
  return withReturns(state, input.snapshot);
}

function liquidityForUsd(
  usd: number,
  snapshot: LiquidityPositionSnapshot,
  tickLower: number,
  tickUpper: number,
): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const unit = markPosition(1, snapshot, tickLower, tickUpper);
  if (!unit || unit.principalUsd <= 0) return 0;
  return usd / unit.principalUsd;
}

function markPosition(
  liquidity: number,
  snapshot: LiquidityPositionSnapshot,
  tickLower: number,
  tickUpper: number,
): { amount0: number; amount1: number; principalUsd: number } | null {
  const amounts = positionAmounts(
    liquidity,
    snapshot.currentTick,
    tickLower,
    tickUpper,
    snapshot.token0.decimals,
    snapshot.token1.decimals,
  );
  const principalUsd = stableQuotedValue(
    snapshot.token0,
    snapshot.token1,
    snapshot.currentPrice,
    amounts.amount0,
    amounts.amount1,
  );
  if (principalUsd == null || !Number.isFinite(principalUsd)) return null;
  return { ...amounts, principalUsd: Math.max(0, principalUsd) };
}

function withReturns(state: LiquidityRangePaperState, snapshot: LiquidityPositionSnapshot): LiquidityRangePaperState {
  const totalUsd = Math.max(0, state.principalUsd + state.modeledFeesUsd);
  const hodlUsd = stableQuotedValue(
    snapshot.token0,
    snapshot.token1,
    snapshot.currentPrice,
    state.initialAmount0,
    state.initialAmount1,
  ) ?? state.initialUsd;
  const normalizedReturnPct = percentReturn(totalUsd, state.initialUsd);
  const hodlReturnPct = percentReturn(hodlUsd, state.initialUsd);
  return {
    ...state,
    totalUsd,
    normalizedReturnPct,
    hodlUsd,
    hodlReturnPct,
    excessVsHodlPct: normalizedReturnPct - hodlReturnPct,
  };
}

function percentReturn(current: number, initial: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(initial) || initial <= 0) return 0;
  return (current / initial - 1) * 100;
}
