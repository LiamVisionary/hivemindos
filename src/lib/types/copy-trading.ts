/* Copy-trading types — shared by the engine/daemon (server) and the Trade-desk
   panel (client), so this file stays pure (no "server-only", no node imports).

   A copy-trading config makes the app watch a TARGET wallet and auto-mirror its
   swaps using one of the user's local-signer ACTING wallets. Configs are keyed
   by their own `agentId` (the acting wallet's vault id), so they keep running
   server-side even after the user switches the acting wallet in the UI. Many
   configs can target many wallets across Base + Solana, independently. */

/** v1 mirrors the native swap rail: Base (0x) + Solana (Jupiter) only. */
export type CopyTradeNetwork = "eip155:8453" | "solana:mainnet";

export type CopyTradeMode = "fixed" | "proportional";

export const COPY_TRADE_EVOLUTION_MODEL = "gpt-5.6-sol" as const;
export const COPY_TRADE_EVOLUTION_POLICY_VERSION = "copy-evo-v2.0.0" as const;
export const COPY_TRADE_EVALUATION_BATCH_SIZE = 50;
export const COPY_TRADE_PROMOTION_MIN_MATURED = 200;

export type CopyTradeEvolutionConfig = {
  /** The untouched config this isolated experiment was cloned from. */
  sourceConfigId: string;
  model: typeof COPY_TRADE_EVOLUTION_MODEL;
  reasoningEffort: "medium";
  /** A close decision below this confidence is recorded but does not sell. */
  minCloseConfidence: number;
  /** Frozen decision/evaluation policy. New experiments get a new version. */
  policyVersion: typeof COPY_TRADE_EVOLUTION_POLICY_VERSION;
  createdAt: number;
};

export type CopyTradingConfig = {
  id: string;
  label: string;
  /** Acting wallet — executes the mirror via this vault id; persists independently of the UI's actingWalletId. */
  agentId: string;
  walletAddress: string;
  network: CopyTradeNetwork;
  /** Wallet to copy. */
  targetAddress: string;

  // ── sizing ────────────────────────────────────────────────────────────────
  copyMode: CopyTradeMode;
  /** Fixed mode: USD spent per mirrored buy. */
  fixedUsd: number;
  /** Proportional mode: percent of the target's trade size to copy. */
  copyPercent: number;
  minCopyUsd: number;
  /** Hard-capped at MAX_COPY_TRADE_USD — the native rail rejects swaps over it. */
  maxCopyUsd: number;
  slippageBps: number;

  // ── behaviour / exits ───────────────────────────────────────────────────────
  copySells: boolean;
  takeProfitPct: number | null;
  stopLossPct: number | null;

  // ── advanced limits ─────────────────────────────────────────────────────────
  maxOpenPositions: number;
  maxPerTokenUsd: number;
  cooldownMs: number;
  pollIntervalMs: number;
  minLiquidityUsd: number | null;
  /** Token addresses / mints to never copy (lowercased). */
  blacklist: string[];

  // ── lifecycle ───────────────────────────────────────────────────────────────
  enabled: boolean;
  /** When true, the engine paper-trades: it detects + sizes + governance-checks and
   *  simulates fills against a `paper` ledger, but never touches the chain. */
  dryRun: boolean;
  /** Dry-run starting bankroll (USD). null = seed from the wallet's fundable balance. */
  paperStartUsd: number | null;
  /** Present only on an agent-analyzed clone; source configs never receive it. */
  evolution?: CopyTradeEvolutionConfig;
  createdAt: number;
  updatedAt: number;
};

export type CopyTradeOpenPosition = {
  token: string;
  symbol: string;
  spentUsd: number;
  amount: number;
  openedAt: number;
  lastActionAt: number;
  /** Paper positions only: last mark-to-market USD value + when it was taken. */
  markUsd?: number;
  markAt?: number;
};

/** Simulated portfolio for a dry-run config — the paper analogue of a live run.
 *  Seeded once from the wallet's fundable USD (or `paperStartUsd`), then the SAME
 *  buy/sell/exit path spends this simulated cash instead of touching the chain. */
export type CopyTradePaperLedger = {
  initialized: boolean;
  startCashUsd: number;
  cashUsd: number;
  /** Cumulative realized P&L from simulated sells. */
  realizedPnlUsd: number;
  /** Modeled venue, slippage, price-impact, and network execution costs. */
  executionCostsUsd?: number;
  /** Simulated fills (buys + sells) — the paper analogue of stats.mirrored. */
  mirrored: number;
  positions: Record<string, CopyTradeOpenPosition>;
};

export type CopyTradeEventKind =
  | "buy"
  | "sell"
  | "skip"
  | "error"
  | "take-profit"
  | "stop-loss"
  | "agent-keep"
  | "agent-close"
  | "agent-error"
  | "needs-approval";

export type CopyTradeEvent = {
  at: number;
  kind: CopyTradeEventKind;
  detail: string;
  /** Our mirror tx hash, when executed. */
  txRef?: string;
  /** The target's tx that triggered this. */
  targetTxRef?: string;
  token?: string;
  symbol?: string;
  usd?: number;
  dryRun?: boolean;
};

export type CopyTradeAgentReviewDecision = "keep" | "close" | "uncertain";

export type CopyTradeAgentReviewSource = {
  title: string;
  url: string;
};

export type CopyTradeAgentReview = {
  reviewedAt: number;
  targetTxRef: string;
  token: string;
  symbol: string;
  spentUsd: number;
  model: typeof COPY_TRADE_EVOLUTION_MODEL;
  decision: CopyTradeAgentReviewDecision;
  reviewPath?: "risk-close" | "sol-adjudication" | "sol-failed-open";
  confidence: number;
  /** Model-reported confidence before empirical calibration. */
  rawConfidence?: number;
  /** Confidence after calibration on prior frozen evaluation batches. */
  calibratedConfidence?: number;
  /** Context-sensitive threshold applied to close decisions. */
  closeThreshold?: number;
  riskScore?: number;
  riskFlags?: string[];
  policyVersion?: typeof COPY_TRADE_EVOLUTION_POLICY_VERSION;
  evaluationBatch?: number;
  summary: string;
  risks: string[];
  sources: CopyTradeAgentReviewSource[];
  researchUsed: boolean;
  /** True only when the engine successfully closed the evolved position. */
  closeExecuted: boolean;
  responseId?: string;
  error?: string;
};

export type CopyTradeCounterfactualHorizon = "5m" | "30m" | "4h" | "24h";

export type CopyTradeExecutionCost = {
  fixedUsd: number;
  variableBps: number;
};

export type CopyTradeCounterfactualObservation = {
  dueAt: number;
  observedAt?: number;
  missedAt?: number;
  missedReason?: "observation-window-expired";
  priceUsd?: number;
  holdReturnPct?: number;
  closeReturnPct?: number;
  evolvedReturnPct?: number;
  pairedDeltaPct?: number;
};

export type CopyTradeCounterfactual = {
  sequence: number;
  evaluationBatch: number;
  policyVersion: typeof COPY_TRADE_EVOLUTION_POLICY_VERSION;
  targetTxRef: string;
  token: string;
  symbol: string;
  entryAt: number;
  entryPriceUsd: number;
  spentUsd: number;
  decision: CopyTradeAgentReviewDecision;
  reviewPath?: "risk-close" | "sol-adjudication" | "sol-failed-open";
  confidence: number;
  calibratedConfidence: number;
  closeThreshold: number;
  closeExecuted: boolean;
  closePriceUsd?: number;
  closeAt?: number;
  buyCost: CopyTradeExecutionCost;
  sellCost: CopyTradeExecutionCost;
  horizons: Record<CopyTradeCounterfactualHorizon, CopyTradeCounterfactualObservation>;
};

export type CopyTradeAgentAnalysisState = {
  sourceConfigId: string;
  startedAt: number;
  sourceStartPortfolioUsd: number | null;
  evolvedStartPortfolioUsd: number | null;
  reviews: CopyTradeAgentReview[];
  /** Cost-aware per-fill outcomes; optional for persisted v1 state migration. */
  counterfactuals?: CopyTradeCounterfactual[];
  nextSequence?: number;
};

export type CopyTradeRuntimeState = {
  configId: string;
  /** EVM detection cursor — last scanned block (stringified bigint). */
  lastBlock?: string;
  /** Solana detection cursor — last seen signature. */
  lastSignature?: string;
  /** Target tx refs already consumed (bounded), for restart-safe dedup. */
  consumedTxRefs: string[];
  openPositions: Record<string, CopyTradeOpenPosition>;
  stats: { polls: number; mirrored: number; skipped: number; errors: number };
  /** Simulated portfolio for dry-run configs (absent until the first dry-run tick). */
  paper?: CopyTradePaperLedger;
  /** Paired experiment baseline + bounded post-fill analyst decisions. */
  agentAnalysis?: CopyTradeAgentAnalysisState;
  lastError: string | null;
  lastPollAt: number | null;
  running: boolean;
  /** Recent events (bounded), newest last. */
  events: CopyTradeEvent[];
};

export type CopyTradeEngineStatus = {
  /** "daemon" | "next" | hostname — who owns execution. */
  host: string;
  pid: number;
  startedAt: number;
  heartbeatMs: number;
  activeConfigs: number;
};

/** One asset the acting wallet can spend to fund copied buys (USDC/USDT/native). */
export type CopyTradeFundableAsset = { symbol: string; amount: number; usd: number };
/** The acting wallet's spendable balance for a copy config's chain (for the UI). */
export type CopyTradeFundable = { assets: CopyTradeFundableAsset[]; totalUsd: number };

export const COPY_TRADE_NETWORKS: readonly CopyTradeNetwork[] = ["eip155:8453", "solana:mainnet"];

/** Matches MAX_SWAP_USD in trading/dex-swap.ts — the rail throws above it. */
export const MAX_COPY_TRADE_USD = 10;

export const DEFAULT_COPY_POLL_MS = 8_000;
export const MIN_COPY_POLL_MS = 3_000;

/** How stale the engine heartbeat may get before the UI calls it offline. */
export const ENGINE_OFFLINE_AFTER_MS = 45_000;

export function copyTradeNetworkLabel(network: CopyTradeNetwork): string {
  return network === "solana:mainnet" ? "Solana" : "Base";
}

export function isCopyTradeNetwork(value: unknown): value is CopyTradeNetwork {
  return value === "eip155:8453" || value === "solana:mainnet";
}

/** Default config seed for a new entry on a given acting wallet + chain. */
export function defaultCopyTradingConfig(seed: {
  id: string;
  agentId: string;
  walletAddress: string;
  network: CopyTradeNetwork;
}): CopyTradingConfig {
  const now = Date.now();
  return {
    id: seed.id,
    label: "",
    agentId: seed.agentId,
    walletAddress: seed.walletAddress,
    network: seed.network,
    targetAddress: "",
    copyMode: "fixed",
    fixedUsd: 5,
    copyPercent: 25,
    minCopyUsd: 1,
    maxCopyUsd: MAX_COPY_TRADE_USD,
    slippageBps: 100,
    copySells: true,
    takeProfitPct: null,
    stopLossPct: null,
    maxOpenPositions: 6,
    maxPerTokenUsd: MAX_COPY_TRADE_USD,
    cooldownMs: 1_200,
    pollIntervalMs: DEFAULT_COPY_POLL_MS,
    minLiquidityUsd: null,
    blacklist: [],
    enabled: false,
    dryRun: true,
    paperStartUsd: null,
    createdAt: now,
    updatedAt: now,
  };
}
