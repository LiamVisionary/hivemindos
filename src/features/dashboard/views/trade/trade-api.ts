"use client";

/* Typed, same-origin fetch helpers for the Trade tab. Auth is the dashboard's
   ambient session (same-origin cookies), matching the other dashboard panels. */

// Fallback only — the live confirmation token is always taken from the server's
// prepare response (prepared.confirmation), never assumed.
export const BANKR_ACTION_CONFIRMATION_FALLBACK = "BANKR_ACTION";
export const FUND_LLM_CREDITS_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";
export const HYPERLIQUID_ORDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_ORDER";
export const HYPERLIQUID_BUILDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_BUILDER";

export type CryptoProviderCapability = {
  provider: string;
  label: string;
  summary: string;
  intents: string[];
  ready: boolean;
  configured: boolean;
  spendReady: boolean;
  missing: string[];
  credentials: Array<{ key: string; present: boolean }>;
};

export type CryptoCapabilityMap = {
  ok?: boolean;
  providers: CryptoProviderCapability[];
  sideEffects?: string[];
  gaps?: string[];
};

export type ClearSigningRisk = { level?: string; message?: string };

export type CryptoPreparedAction = {
  intent: string;
  provider: string;
  ready: boolean;
  mode: "read" | "prepare" | "execute";
  endpoint?: { method?: string; route?: string; skill?: string };
  requestBody: Record<string, unknown>;
  platformFee?: {
    enabled: boolean;
    configured: boolean;
    amountUsd: number;
    basisPoints: number;
    recipient?: string;
    reason?: string;
  };
  requiresApproval: boolean;
  confirmation?: string;
  missing: string[];
  guidance: string;
  review?: {
    title?: string;
    summary?: string;
    network?: string;
    asset?: string;
    amount?: string;
    amountUsd?: number;
    recipientAddress?: string;
    risks?: ClearSigningRisk[];
  };
};

export type TradePrepareParams = {
  agentId: string;
  intent: string;
  wallet?: Record<string, unknown>;
  amountUsd?: number;
  asset?: "USDC" | "ETH";
  url?: string;
  method?: string;
  recipientAddress?: string;
  amount?: number | string;
  prompt?: string;
};

export type StockVenue = "alpaca" | "xstocks";

export type TradingReadiness = {
  ok: boolean;
  confirmations: { buy: string; sell: string };
  venues: {
    alpaca: {
      configured: boolean;
      paper: { configured: boolean; dedicated: boolean; keys: string[] };
      live: { configured: boolean; keys: string[] };
      credentials: Array<{ key: string; present: boolean }>;
    };
    xstocks: { supportedTickers: string[] };
  };
  agents: Array<{ agentId: string; agentName: string; venue?: StockVenue; paper: boolean; liveEnabled: boolean; enabled: boolean }>;
};

export type AlpacaPosition = {
  symbol: string;
  qty: number;
  side: string;
  marketValue: number;
  costBasis: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPlUsd: number;
  unrealizedPlPct: number;
};

export type AlpacaPortfolio = {
  paper: boolean;
  account: { status: string; currency: string; equity: number; cash: number; buyingPower: number; portfolioValue: number };
  positions: AlpacaPosition[];
};

export type StockQuote = {
  venue: StockVenue;
  ticker: string;
  notionalUsd: number;
  priceImpactPct?: number;
  platformFee?: {
    enabled: boolean;
    configured: boolean;
    amountUsd: number;
    basisPoints: number;
    recipient?: string;
    reason?: string;
  };
  detail: string;
};

export type StockTradeResult = {
  side: "buy" | "sell";
  venue: StockVenue;
  ticker: string;
  notionalUsd: number;
  reference: string;
  paper: boolean;
  acquired?: number;
  priceImpactPct?: number;
  platformFee?: {
    enabled: boolean;
    configured: boolean;
    amountUsd: number;
    basisPoints: number;
    recipient?: string;
    signature?: string;
    reason?: string;
  };
  status: string;
  detail: string;
};

async function asJson<T>(response: Response | null): Promise<(T & { ok: boolean; error?: string }) | { ok: false; error: string }> {
  if (!response) return { ok: false, error: "Network request failed." };
  const data = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!data) return { ok: false, error: `Request failed (HTTP ${response.status}).` };
  return { ...(data as T), ok: Boolean((data as { ok?: boolean }).ok) && response.ok, error: (data as { error?: string }).error };
}

async function postJson<T>(route: string, body: unknown): Promise<(T & { ok: boolean; error?: string }) | { ok: false; error: string }> {
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  return asJson<T>(response);
}

export async function fetchCryptoCapabilities(agentId: string, wallet?: Record<string, unknown> | null): Promise<CryptoCapabilityMap | null> {
  // POST a status request WITH the wallet so the readiness badges reflect this
  // wallet's actual spend policy. A bare GET (no wallet) can't evaluate per-wallet
  // spend readiness, so wallet-native rails (send / x402 / Veil) would show
  // "Setup" even when they're ready. This is a display hint only — execution
  // always re-resolves the wallet server-side from the persisted ledger.
  const result = await postJson<CryptoCapabilityMap>("/api/crypto/capabilities", { action: "status", agentId, wallet: wallet ?? undefined });
  return result.ok && Array.isArray((result as CryptoCapabilityMap).providers) ? (result as CryptoCapabilityMap) : null;
}

export async function prepareCryptoAction(params: TradePrepareParams): Promise<{ ok: boolean; error?: string; prepared?: CryptoPreparedAction }> {
  const result = await postJson<{ prepared: CryptoPreparedAction }>("/api/crypto/capabilities", { action: "prepare", ...params });
  return result;
}

/** Generic execute: POST the router-prepared requestBody to its prepared route. */
export async function executePreparedRoute(route: string, requestBody: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  return postJson(route, requestBody);
}

/** Bankr two-step: the prepared body runs the prepare leg; this confirms+executes. */
export async function executeBankrDraft(draftMessage: string, confirmation: string): Promise<{ ok: boolean; error?: string; message?: string; result?: unknown }> {
  return postJson("/api/bankr/actions", { action: "execute", draftMessage, confirmation });
}

export async function fundBankrLlmCredits(amountUsd: number, token: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  return postJson("/api/bankr/llm-credits", { amountUsd, token, confirmation: FUND_LLM_CREDITS_CONFIRMATION });
}

export type BankrWalletInfo = { configured: boolean; address?: string; balanceUsd?: number | null };

export async function fetchBankrWallet(): Promise<BankrWalletInfo> {
  const response = await fetch("/api/bankr/wallet", { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await asJson<BankrWalletInfo>(response);
  return data.ok ? { configured: Boolean((data as BankrWalletInfo).configured), address: (data as BankrWalletInfo).address, balanceUsd: (data as BankrWalletInfo).balanceUsd } : { configured: false };
}

// ---- Local DEX swap rail (0x on Base) --------------------------------------
export const SWAP_CONFIRMATION = "CONFIRM_SWAP";
export const SWAP_MAX_USD = 10;
export const SWAP_TOKENS_BASE = ["USDC", "ETH", "WETH", "USDT", "HIVE"];
export const SWAP_TOKENS_SOLANA = ["USDC", "SOL", "USDT"];

export type TradePlatformFee = {
  enabled: boolean;
  configured: boolean;
  amountUsd: number;
  basisPoints: number;
  recipient?: string;
  signature?: string;
  reason?: string;
};

export type DexSwapQuote = { sell: string; buy: string; sellAmount: number; buyAmount: number; valueUsd: number; platformFee?: TradePlatformFee; detail: string };
export type DexSwapResult = { network: string; sell: string; buy: string; sellAmount: number; buyAmount: number; valueUsd: number; reference: string; approvalReference?: string; platformFee?: TradePlatformFee; detail: string };

export async function quoteSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; slippageBps?: number }): Promise<{ ok: boolean; error?: string; quote?: DexSwapQuote; confirmation?: string }> {
  return postJson("/api/trading/swap", { action: "quote", ...params });
}

export async function executeSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; confirmation: string; slippageBps?: number }): Promise<{ ok: boolean; error?: string; result?: DexSwapResult }> {
  return postJson("/api/trading/swap", { action: "execute", ...params });
}

// ---- Hyperliquid local perp rail -------------------------------------------
export type HyperliquidBuilderConfig = {
  configured: boolean;
  official: boolean;
  source: "official-policy";
  policyUrl: string;
  builderAddress?: string;
  builderFeeTenthBps: number;
  builderFeeBps: number;
  maxBuilderFeeTenthBps: number;
  maxBuilderFeeRate: string;
  isTestnet: boolean;
  missing: string[];
  detail: string;
};

export type HyperliquidBuilderApproval = {
  configured: boolean;
  builderAddress?: string;
  approved: boolean;
  approvedMaxFeeTenthBps: number;
  requiredFeeTenthBps: number;
  maxApprovalFeeTenthBps: number;
  maxApprovalFeeRate: string;
  activeApprovalSlot: boolean;
  approvedBuilders: string[];
  missing: string[];
  error?: string;
  detail: string;
};

export type HyperliquidOrderSummary = {
  coin: string;
  assetId: number;
  side: "long" | "short";
  orderType: "market" | "limit";
  timeInForce: "Gtc" | "Ioc";
  reduceOnly: boolean;
  price: string;
  size: string;
  midPrice: number;
  notionalUsd: number;
};

export type HyperliquidQuote = {
  network: "mainnet" | "testnet";
  walletAddress: string;
  order: HyperliquidOrderSummary;
  builder?: { b: string; f: number };
  builderConfig: HyperliquidBuilderConfig;
  builderApproval: HyperliquidBuilderApproval;
  detail: string;
};

export type HyperliquidAccountStatus = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  accountValueUsd?: number;
  withdrawableUsd?: number;
  positions: Array<{
    coin: string;
    side: "long" | "short" | "flat";
    size: number;
    entryPrice?: number;
    positionValueUsd?: number;
    unrealizedPnlUsd?: number;
    liquidationPrice?: number;
    leverage?: number;
    marginMode?: string;
  }>;
  openOrders: unknown[];
  builderConfig: HyperliquidBuilderConfig;
  builderApproval: HyperliquidBuilderApproval;
  detail: string;
};

export type HyperliquidOrderResult = {
  network: "mainnet" | "testnet";
  walletAddress: string;
  order: HyperliquidOrderSummary;
  builder?: { b: string; f: number };
  statuses: unknown[];
  reference: string;
  detail: string;
};

export async function fetchHyperliquidStatus(agentId: string): Promise<{ ok: boolean; error?: string; status?: HyperliquidAccountStatus }> {
  return postJson("/api/trading/hyperliquid", { action: "status", agentId });
}

export async function quoteHyperliquidTrade(params: {
  agentId: string;
  coin: string;
  side: "long" | "short";
  orderType: "market" | "limit";
  notionalUsd?: number;
  size?: number;
  limitPrice?: number;
  reduceOnly?: boolean;
  slippageBps?: number;
}): Promise<{ ok: boolean; error?: string; quote?: HyperliquidQuote; confirmation?: string; builderConfirmation?: string }> {
  return postJson("/api/trading/hyperliquid", { action: "quote", ...params });
}

export async function approveHyperliquidBuilder(agentId: string): Promise<{ ok: boolean; error?: string; result?: { detail: string } }> {
  return postJson("/api/trading/hyperliquid", {
    action: "approve-builder",
    agentId,
    confirmation: HYPERLIQUID_BUILDER_CONFIRMATION,
  });
}

export async function executeHyperliquidTrade(params: {
  agentId: string;
  coin: string;
  side: "long" | "short";
  orderType: "market" | "limit";
  notionalUsd?: number;
  size?: number;
  limitPrice?: number;
  reduceOnly?: boolean;
  slippageBps?: number;
  approvalToken?: string;
}): Promise<{ ok: boolean; error?: string; result?: HyperliquidOrderResult }> {
  return postJson("/api/trading/hyperliquid", {
    action: "order",
    ...params,
    confirmation: HYPERLIQUID_ORDER_CONFIRMATION,
  });
}

export async function fetchTradingReadiness(): Promise<TradingReadiness | null> {
  const response = await fetch("/api/trading", { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await asJson<TradingReadiness>(response);
  return data.ok ? (data as TradingReadiness) : null;
}

export async function quoteStockTrade(params: { agentId: string; side: "buy" | "sell"; ticker: string; notionalUsd: number; paper: boolean }): Promise<{ ok: boolean; error?: string; quote?: StockQuote; confirmation?: string }> {
  return postJson("/api/trading", { action: "quote", ...params });
}

export async function executeStockTrade(params: { agentId: string; side: "buy" | "sell"; ticker: string; notionalUsd: number; confirmation: string; paper: boolean }): Promise<{ ok: boolean; error?: string; result?: StockTradeResult }> {
  return postJson("/api/trading", { action: "execute", ...params });
}

export async function fetchStockPortfolio(agentId: string, paper: boolean): Promise<{ ok: boolean; error?: string; portfolio?: AlpacaPortfolio | null; note?: string }> {
  return postJson("/api/trading", { action: "portfolio", agentId, paper });
}
