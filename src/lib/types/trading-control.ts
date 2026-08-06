import type { ReasoningTrail } from "@/lib/types/reasoning-trail";

export type TradingExecutionMode = "research" | "paper" | "live";
export type TradingAssetClass = "crypto" | "stock" | "perp" | "option" | "prediction" | "liquidity";
export type TradingOrderType = "market" | "limit" | "stop" | "stop_limit" | "trigger" | "liquidity" | "prediction";
export type TradingTimeInForce = "day" | "gtc" | "ioc" | "fok";
export type TradingSide = "buy" | "sell" | "swap" | "long" | "short" | "add" | "remove" | "yes" | "no";
export type TradePlanStatus =
  | "draft"
  | "review"
  | "blocked"
  | "approved"
  | "submitted"
  | "filled"
  | "reconciled"
  | "rejected"
  | "failed";

export type TradeQuoteContext = {
  capturedAt: string;
  source: string;
  slippageBps?: number;
  liquidityUsd?: number;
  feeUsd?: number;
  detail?: string;
};

export type TradePortfolioContext = {
  totalValueUsd: number;
  currentAssetValueUsd: number;
  dailyPnlPct?: number;
  drawdownPct?: number;
};

export type TradeProposal = {
  accountId: string;
  agentId?: string;
  assetClass: TradingAssetClass;
  asset: string;
  side: TradingSide;
  orderType: TradingOrderType;
  timeInForce?: TradingTimeInForce;
  quantity?: number;
  notionalUsd: number;
  estimatedPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
  fromAsset?: string;
  fromQuantity?: number;
  estimatedReceiveQuantity?: number;
  leverage?: number;
  reduceOnly?: boolean;
  venue?: string;
  network?: string;
  quote?: TradeQuoteContext;
  portfolio?: TradePortfolioContext;
  source?: string;
  sourceReference?: string;
  companyTaskId?: string;
};

export type TradingRiskPolicy = {
  maxPositionPct: number;
  maxConcentrationPct: number;
  maxLeverage: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxSlippageBps: number;
  minLiquidityUsd: number;
  cooldownSeconds: number;
  maxQuoteAgeSeconds: number;
  allowedSymbols: string[];
  requireKnownPortfolioForLive: boolean;
  requirePlanForLive: boolean;
};

export type TradeRiskCheckStatus = "pass" | "warn" | "block";

export type TradeRiskCheck = {
  id: string;
  label: string;
  status: TradeRiskCheckStatus;
  detail: string;
  actual?: number | string;
  limit?: number | string;
};

export type TradeRiskEvaluation = {
  decision: "allow" | "block";
  summary: string;
  evaluatedAt: string;
  policyVersion: 1;
  checks: TradeRiskCheck[];
  reasoning: ReasoningTrail;
};

export type TradePlanExecution = {
  kind: "simulation" | "live";
  status: string;
  reference?: string;
  detail: string;
  submittedAt: string;
  filledAt?: string;
  fillPrice?: number;
  filledQuantity?: number;
  feesUsd?: number;
};

export type TradePlanAuditEntry = {
  at: string;
  action: string;
  status: TradePlanStatus;
  note?: string;
};

export type TradePlan = {
  id: string;
  title: string;
  proposal: TradeProposal;
  thesis?: string;
  evidence: string[];
  missingContext: string[];
  executionMode: TradingExecutionMode;
  status: TradePlanStatus;
  risk: TradeRiskEvaluation;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  execution?: TradePlanExecution;
  audit: TradePlanAuditEntry[];
};

export type TradingAccountPolicy = {
  readOnly: boolean;
  executionMode?: TradingExecutionMode;
};

export type TradingControlConfig = {
  executionMode: TradingExecutionMode;
  accountPolicies: Record<string, TradingAccountPolicy>;
  riskPolicy: TradingRiskPolicy;
  snapshotCadenceMinutes: number;
};

export type PortfolioHoldingSnapshot = {
  asset: string;
  assetClass: TradingAssetClass;
  quantity: number;
  marketPrice: number;
  marketValueUsd: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
  source?: string;
};

export type PortfolioAccountSnapshot = {
  accountId: string;
  label: string;
  provider: string;
  custody: string;
  cashUsd: number;
  holdings: PortfolioHoldingSnapshot[];
  totalValueUsd?: number;
  health?: "healthy" | "degraded" | "offline" | "unknown";
  lastSyncAt?: string;
};

export type PortfolioSnapshot = {
  id: string;
  capturedAt: string;
  reason: "manual" | "event" | "scheduled" | "reconciliation";
  accounts: PortfolioAccountSnapshot[];
  totalValueUsd: number;
  cashUsd: number;
  investedValueUsd: number;
};

export type SimulatedPosition = {
  asset: string;
  assetClass: TradingAssetClass;
  quantity: number;
  averageCost: number;
  marketPrice: number;
  realizedPnlUsd: number;
};

export type SimulatedTradingAccount = {
  accountId: string;
  startingCashUsd: number;
  cashUsd: number;
  positions: Record<string, SimulatedPosition>;
  updatedAt: string;
};

export type TradingSimulatorState = {
  accounts: Record<string, SimulatedTradingAccount>;
};

export type TradingThesisStatus = "draft" | "watching" | "validated" | "invalidated" | "archived";
export type TradingThesis = {
  id: string;
  title: string;
  asset: string;
  assetClass: TradingAssetClass;
  direction: "long" | "short" | "neutral";
  conviction: "low" | "medium" | "high";
  summary: string;
  invalidation?: string;
  catalysts: string[];
  status: TradingThesisStatus;
  reviewCadenceDays: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
  notes: Array<{ at: string; text: string }>;
};

export type TradingBrokerPackId = "ccxt" | "ibkr";
export type TradingBrokerConnection = {
  id: string;
  packId: TradingBrokerPackId;
  label: string;
  enabled: boolean;
  readOnly: boolean;
  paper: boolean;
  settings: Record<string, string>;
  health: "unknown" | "healthy" | "degraded" | "offline";
  healthDetail?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TradingReconciliation = {
  id: string;
  accountId: string;
  asset: string;
  assetClass: TradingAssetClass;
  observedQuantity: number;
  trackedQuantity: number;
  quantityDelta: number;
  observedCostBasisUsd?: number;
  trackedCostBasisUsd?: number;
  costBasisDeltaUsd?: number;
  status: "matched" | "attention";
  source: string;
  reconciledAt: string;
};

export type TradingEvent = {
  id: string;
  kind: string;
  at: string;
  title: string;
  detail: string;
  planId?: string;
  accountId?: string;
  asset?: string;
};

export type TradingControlOverview = {
  version: 1;
  updatedAt: string;
  config: TradingControlConfig;
  plans: TradePlan[];
  snapshots: PortfolioSnapshot[];
  theses: TradingThesis[];
  simulator: TradingSimulatorState;
  connections: TradingBrokerConnection[];
  reconciliations: TradingReconciliation[];
  events: TradingEvent[];
};

export const TRADING_EXECUTION_MODE_META: Record<TradingExecutionMode, { label: string; shortLabel: string; detail: string; movesFunds: boolean }> = {
  research: {
    label: "Research-only",
    shortLabel: "Research",
    detail: "Build and review plans. Nothing is submitted or simulated.",
    movesFunds: false,
  },
  paper: {
    label: "Paper",
    shortLabel: "Paper",
    detail: "Practice with virtual fills and a separate simulated portfolio.",
    movesFunds: false,
  },
  live: {
    label: "Live",
    shortLabel: "Live",
    detail: "Approved plans may reach the selected governed execution rail.",
    movesFunds: true,
  },
};
