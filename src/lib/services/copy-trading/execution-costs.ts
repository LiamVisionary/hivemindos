import type { CopyTradeExecutionCost, CopyTradeNetwork } from "@/lib/types/copy-trading";

export type CopyTradeExecutionCostEstimate = CopyTradeExecutionCost & {
  venueFeeBps: number;
  expectedSlippageBps: number;
  priceImpactBps: number;
  totalUsd: number;
};

const NETWORK_FIXED_COST_USD: Record<CopyTradeNetwork, number> = {
  "eip155:8453": 0.01,
  "solana:mainnet": 0.002,
};

const VENUE_FEE_BPS = 30;

/** Conservative, deterministic cost estimate shared by paper fills and EVO.
 *  The configured slippage is a ceiling, so the model uses one quarter of it
 *  plus notional/liquidity impact rather than charging the full ceiling. */
export function estimateCopyTradeExecutionCost(input: {
  network: CopyTradeNetwork;
  notionalUsd: number;
  liquidityUsd: number | null;
  maxSlippageBps: number;
}): CopyTradeExecutionCostEstimate {
  const notionalUsd = finitePositive(input.notionalUsd);
  const maxSlippageBps = clamp(finitePositive(input.maxSlippageBps), 10, 2_000);
  const expectedSlippageBps = clamp(maxSlippageBps * 0.25, 5, 75);
  const priceImpactBps = input.liquidityUsd != null && input.liquidityUsd > 0
    ? clamp((notionalUsd / input.liquidityUsd) * 10_000 * 0.5, 0, maxSlippageBps)
    : expectedSlippageBps;
  const variableBps = VENUE_FEE_BPS + expectedSlippageBps + priceImpactBps;
  const fixedUsd = NETWORK_FIXED_COST_USD[input.network];
  const totalUsd = fixedUsd + (notionalUsd * variableBps) / 10_000;
  return {
    fixedUsd,
    variableBps,
    venueFeeBps: VENUE_FEE_BPS,
    expectedSlippageBps,
    priceImpactBps,
    totalUsd,
  };
}

export function executionCostUsd(notionalUsd: number, cost: CopyTradeExecutionCost): number {
  return Math.max(0, cost.fixedUsd) + (Math.max(0, notionalUsd) * Math.max(0, cost.variableBps)) / 10_000;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
