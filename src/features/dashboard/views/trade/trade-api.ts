"use client";

/* Typed, same-origin fetch helpers for the Trade tab. Auth is the dashboard's
   ambient session (same-origin cookies), matching the other dashboard panels. */

// Fallback only — the live confirmation token is always taken from the server's
// prepare response (prepared.confirmation), never assumed.
export const BANKR_ACTION_CONFIRMATION_FALLBACK = "BANKR_ACTION";
export const FUND_LLM_CREDITS_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";

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

export async function fetchCryptoCapabilities(agentId: string): Promise<CryptoCapabilityMap | null> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  const response = await fetch(`/api/crypto/capabilities${query}`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await asJson<CryptoCapabilityMap>(response);
  return data.ok && Array.isArray((data as CryptoCapabilityMap).providers) ? (data as CryptoCapabilityMap) : null;
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

export type DexSwapQuote = { sell: string; buy: string; sellAmount: number; buyAmount: number; valueUsd: number; detail: string };
export type DexSwapResult = { network: string; sell: string; buy: string; sellAmount: number; buyAmount: number; valueUsd: number; reference: string; approvalReference?: string; detail: string };

export async function quoteSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; slippageBps?: number }): Promise<{ ok: boolean; error?: string; quote?: DexSwapQuote; confirmation?: string }> {
  return postJson("/api/trading/swap", { action: "quote", ...params });
}

export async function executeSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; confirmation: string; slippageBps?: number }): Promise<{ ok: boolean; error?: string; result?: DexSwapResult }> {
  return postJson("/api/trading/swap", { action: "execute", ...params });
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
