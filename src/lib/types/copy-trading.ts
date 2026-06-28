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
  /** When true, the engine detects + sizes + governance-checks but never executes. */
  dryRun: boolean;
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
};

export type CopyTradeEventKind =
  | "buy"
  | "sell"
  | "skip"
  | "error"
  | "take-profit"
  | "stop-loss"
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
    createdAt: now,
    updatedAt: now,
  };
}
