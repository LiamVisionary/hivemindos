export const LIQUIDITY_RANGE_NETWORK = "eip155:8453" as const;
export const LIQUIDITY_RANGE_MODE = "shadow" as const;
export const DEFAULT_LIQUIDITY_RANGE_POLL_MS = 60_000;
export const LIQUIDITY_RANGE_ENGINE_OFFLINE_AFTER_MS = 90_000;

export type LiquidityRangeNetwork = typeof LIQUIDITY_RANGE_NETWORK;
export type LiquidityRangeMode = typeof LIQUIDITY_RANGE_MODE;
export type LiquidityRangeStatus = "in-range" | "edge" | "out-of-range";
export type LiquidityRangeAction = "hold" | "watch" | "propose-rebalance";

export type LiquidityRangeConfig = {
  id: string;
  label: string;
  agentId: string;
  walletAddress: string;
  network: LiquidityRangeNetwork;
  protocol: "uniswap-v3";
  tokenId: string;
  mode: LiquidityRangeMode;
  enabled: boolean;
  pollIntervalMs: number;
  targetWidthBps: number;
  triggerBufferBps: number;
  minHoursBetweenRebalances: number;
  minNetBenefitUsd: number;
  feeAprPct: number;
  gasCostUsd: number;
  estimatedIlCostUsd: number;
  evaluationHorizonDays: number;
  createdAt: number;
  updatedAt: number;
};

export type LiquidityTokenSnapshot = {
  address: string;
  symbol: string;
  decimals: number;
};

export type LiquidityPositionSnapshot = {
  network: LiquidityRangeNetwork;
  protocol: "uniswap-v3";
  tokenId: string;
  owner: string;
  positionManagerAddress: string;
  factoryAddress: string;
  poolAddress: string;
  token0: LiquidityTokenSnapshot;
  token1: LiquidityTokenSnapshot;
  fee: number;
  feePercent: number;
  tickSpacing: number;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  currentPrice: number;
  lowerPrice: number;
  upperPrice: number;
  amount0: number;
  amount1: number;
  positionValueUsd: number | null;
  quoteLabel: string;
  blockNumber: string;
  observedAt: number;
};

export type LiquidityRangeDecision = {
  policyVersion: 1;
  status: LiquidityRangeStatus;
  action: LiquidityRangeAction;
  currentTick: number;
  effectiveTickLower: number;
  effectiveTickUpper: number;
  distanceToLowerBps: number;
  distanceToUpperBps: number;
  distanceToNearestEdgeBps: number;
  targetTickLower: number;
  targetTickUpper: number;
  expectedRecoveredFeesUsd: number | null;
  estimatedRebalanceCostUsd: number;
  expectedNetBenefitUsd: number | null;
  cooldownRemainingMs: number;
  economicGatePassed: boolean;
  reasons: string[];
  decidedAt: number;
};

export type LiquidityRangeEvent = {
  at: number;
  kind: "observation" | "shadow-rebalance" | "error";
  action?: LiquidityRangeAction;
  status?: LiquidityRangeStatus;
  message: string;
};

export type LiquidityShadowRange = {
  tickLower: number;
  tickUpper: number;
  rebalancedAt: number;
};

export type LiquidityRangePaperState = {
  version: 1;
  feeModel: "configured-apr";
  startedAt: number;
  lastUpdatedAt: number;
  initialUsd: number;
  initialAmount0: number;
  initialAmount1: number;
  liquidity: number;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
  principalUsd: number;
  modeledFeesUsd: number;
  cumulativeRebalanceCostsUsd: number;
  totalUsd: number;
  normalizedReturnPct: number;
  hodlUsd: number;
  hodlReturnPct: number;
  excessVsHodlPct: number;
  rebalanceCount: number;
  lastRebalancedAt: number | null;
};

export type LiquidityRangeRuntimeState = {
  configId: string;
  lastCheckedAt: number | null;
  lastRebalancedAt: number | null;
  lastDecision: LiquidityRangeDecision | null;
  lastSnapshot: LiquidityPositionSnapshot | null;
  shadowRange: LiquidityShadowRange | null;
  paper: LiquidityRangePaperState | null;
  events: LiquidityRangeEvent[];
  error: string | null;
};

export type LiquidityRangeEngineStatus = {
  host: "daemon" | "manual";
  pid: number;
  startedAt: number;
  heartbeatMs: number;
  activeConfigs: number;
  mode: LiquidityRangeMode;
};

export function defaultLiquidityRangeConfig(input: {
  id: string;
  tokenId: string;
  agentId?: string;
  walletAddress?: string;
}): LiquidityRangeConfig {
  const now = Date.now();
  return {
    id: input.id,
    label: "Uniswap v3 position",
    agentId: input.agentId ?? "",
    walletAddress: input.walletAddress ?? "",
    network: LIQUIDITY_RANGE_NETWORK,
    protocol: "uniswap-v3",
    tokenId: input.tokenId,
    mode: LIQUIDITY_RANGE_MODE,
    enabled: false,
    pollIntervalMs: DEFAULT_LIQUIDITY_RANGE_POLL_MS,
    targetWidthBps: 400,
    triggerBufferBps: 75,
    minHoursBetweenRebalances: 6,
    minNetBenefitUsd: 3,
    feeAprPct: 25,
    gasCostUsd: 0.25,
    estimatedIlCostUsd: 0,
    evaluationHorizonDays: 7,
    createdAt: now,
    updatedAt: now,
  };
}
