"use client";

/* Typed, same-origin fetch helpers for the Trade tab. Auth is the dashboard's
   ambient session (same-origin cookies), matching the other dashboard panels. */

import type { TradeTokenMetadata } from "@/lib/types/trading-token";
export type { TradeTokenMetadata } from "@/lib/types/trading-token";

// Fallback only — the live confirmation token is always taken from the server's
// prepare response (prepared.confirmation), never assumed.
export const BANKR_ACTION_CONFIRMATION_FALLBACK = "BANKR_ACTION";
export const FUND_LLM_CREDITS_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";
export const HYPERLIQUID_ORDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_ORDER";
export const HYPERLIQUID_BUILDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_BUILDER";
export const HYPERLIQUID_CANCEL_CONFIRMATION = "CONFIRM_HYPERLIQUID_CANCEL";
export const HYPERLIQUID_ACCOUNT_CONFIRMATION = "CONFIRM_HYPERLIQUID_ACCOUNT";
export const HYPERLIQUID_TRANSFER_CONFIRMATION = "CONFIRM_HYPERLIQUID_TRANSFER";
export const HYPERLIQUID_TWAP_CONFIRMATION = "CONFIRM_HYPERLIQUID_TWAP";
export const CRYPTO_PRACTICE_REPLAY_CONFIRMATION = "CONFIRM_CRYPTO_PRACTICE_REPLAY";

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

export type StockVenue = "alpaca" | "robinhood-agentic" | "xstocks" | "robinhood-chain";

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
    robinhoodChain?: {
      chain: {
        name: string;
        network: string;
        chainId: number;
        rpcUrl: string;
        websocketUrl: string;
        explorerUrl: string;
        recommendedRpcProvider: string;
      };
      testnet: {
        name: string;
        network: string;
        chainId: number;
        rpcUrl: string;
        websocketUrl: string;
        explorerUrl: string;
        recommendedRpcProvider: string;
      };
      supportedTickers: string[];
      executable: boolean;
      reason: string;
    };
    robinhoodAgentic?: {
      connected: boolean;
      selectedAccountId?: string;
      accounts: Array<{ id: string; label: string; agentic: boolean }>;
      tools: string[];
      missingTools: string[];
      reason: string;
    };
  };
  agents: Array<{ agentId: string; agentName: string; venue?: StockVenue; paper: boolean; liveEnabled: boolean; enabled: boolean }>;
};

export type TradeNansenComplexTemplateId =
  | "token-tracking-smart-money"
  | "hyperliquid-wallet-discovery"
  | "related-wallets-scale"
  | "top-wallet-copytrade-research"
  | "cex-health-monitor";

export type TradeNansenSimpleTemplateId =
  | "defi-positions"
  | "smart-money-holdings"
  | "token-top-holders"
  | "token-screener-discovery";

export type TradeNansenBriefMetric = {
  label: string;
  value: string;
};

export type TradeNansenBriefCard = {
  title: string;
  summary: string;
  metrics: TradeNansenBriefMetric[];
  observations: string[];
  endpoint: string;
  redistribution: string;
};

export type TradeNansenBriefSource = {
  label: string;
  endpoint: string;
  credits: number;
  mode?: string;
  attributionRequired: boolean;
  redistribution: string;
  note: string;
};

export type TradeNansenInsightBrief = {
  kind: "simple-template" | "complex-template" | string;
  generatedAt: string;
  subject: string;
  status: "ok" | "partial" | "blocked";
  summary: string;
  cards: TradeNansenBriefCard[];
  riskFlags: string[];
  nextQuestions: string[];
  sources: TradeNansenBriefSource[];
  attribution: {
    required: boolean;
    text: string;
    reason: string;
  };
  compliance: string[];
  billing?: Record<string, unknown>;
};

export type TradeNansenComplexTemplateParams = {
  template: TradeNansenComplexTemplateId;
  chain?: string;
  chains?: string[];
  tokenAddress?: string;
  tokenSymbol?: string;
  address?: string;
  entityName?: string;
  timeframe?: string;
  includeLabels?: boolean;
  includeTransactions?: boolean;
  includeHistoricalBalances?: boolean;
  includePnlSummary?: boolean;
  filters?: Record<string, unknown>;
  date?: { from?: string; to?: string };
};

export type TradeNansenSimpleTemplateParams = {
  template: TradeNansenSimpleTemplateId;
  chain?: string;
  chains?: string[];
  tokenAddress?: string;
  address?: string;
  timeframe?: string;
  aggregateByEntity?: boolean;
  labelType?: string;
  premiumLabels?: boolean;
  filters?: Record<string, unknown>;
  date?: { from?: string; to?: string };
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

export type AlpacaOpenOrder = {
  id: string;
  symbol: string;
  side: string;
  qty: number | null;
  notionalUsd: number | null;
  filledQty: number;
  status: string;
  submittedAt: string;
};

export type AlpacaPortfolio = {
  paper: boolean;
  account: { status: string; currency: string; equity: number; cash: number; buyingPower: number; portfolioValue: number };
  positions: AlpacaPosition[];
  /** Open/pending orders (not yet filled) so the desk can show pending positions. */
  openOrders?: AlpacaOpenOrder[];
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

export async function runNansenComplexTemplate(params: TradeNansenComplexTemplateParams): Promise<{ ok: boolean; error?: string; brief?: TradeNansenInsightBrief }> {
  return postJson<{ brief: TradeNansenInsightBrief }>("/api/nansen/complex-template", params);
}

export async function runNansenSimpleTemplate(params: TradeNansenSimpleTemplateParams): Promise<{ ok: boolean; error?: string; brief?: TradeNansenInsightBrief }> {
  return postJson<{ brief: TradeNansenInsightBrief }>("/api/nansen/simple-template", params);
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

export type BankrTokenHolding = { symbol: string; name: string; amount: number; usd: number };
export type BankrWalletInfo = { configured: boolean; address?: string; balanceUsd?: number | null; tokens?: BankrTokenHolding[] };

export async function fetchBankrWallet(): Promise<BankrWalletInfo> {
  const response = await fetch("/api/bankr/wallet", { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await asJson<BankrWalletInfo>(response);
  return data.ok ? { configured: Boolean((data as BankrWalletInfo).configured), address: (data as BankrWalletInfo).address, balanceUsd: (data as BankrWalletInfo).balanceUsd, tokens: Array.isArray((data as BankrWalletInfo).tokens) ? (data as BankrWalletInfo).tokens : [] } : { configured: false };
}

// ---- Local DEX swap rail (0x on Base/Robinhood Chain, Jupiter on Solana) ----
export const SWAP_CONFIRMATION = "CONFIRM_SWAP";
export const SWAP_MAX_USD = 10;
export const SWAP_TOKENS_BASE = ["USDC", "ETH", "WETH", "USDT", "HIVE"];
export const SWAP_TOKENS_ROBINHOOD = ["USDG", "WETH", "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "COIN", "QQQ", "SPY"];
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

export async function resolveTradeToken(params: { network: string; address: string }): Promise<{ ok: boolean; error?: string; token?: TradeTokenMetadata }> {
  return postJson<{ token: TradeTokenMetadata }>("/api/trading/token", params);
}

export async function quoteSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; slippageBps?: number; network?: string }): Promise<{ ok: boolean; error?: string; quote?: DexSwapQuote; confirmation?: string }> {
  return postJson("/api/trading/swap", { action: "quote", ...params });
}

export async function executeSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number; confirmation: string; slippageBps?: number; network?: string }): Promise<{ ok: boolean; error?: string; result?: DexSwapResult }> {
  return postJson("/api/trading/swap", { action: "execute", ...params });
}

// ---- Hyperliquid local rail -------------------------------------------------
export type HyperliquidActionName =
  | "status"
  | "open-orders"
  | "fills"
  | "fees"
  | "order-status"
  | "quote"
  | "order"
  | "cancel"
  | "cancel-by-cloid"
  | "modify"
  | "schedule-cancel"
  | "leverage"
  | "margin"
  | "usd-class"
  | "usd-send"
  | "spot-send"
  | "withdraw"
  | "twap-order"
  | "twap-cancel";

export type HyperliquidMarketType = "perp" | "spot";
export type HyperliquidSide = "long" | "short" | "buy" | "sell";
export type HyperliquidOrderType = "market" | "limit" | "trigger";

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
  marketType: HyperliquidMarketType;
  side: HyperliquidSide;
  orderType: HyperliquidOrderType;
  timeInForce?: "Gtc" | "Ioc" | "Alo" | "FrontendMarket";
  triggerPx?: string;
  triggerType?: "tp" | "sl";
  triggerIsMarket?: boolean;
  grouping?: "na" | "normalTpsl" | "positionTpsl";
  clientOrderId?: string;
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
  spotBalances: Array<{ coin: string; token?: number; total: number; hold: number; available: number; entryNotionalUsd?: number }>;
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

export type HyperliquidSignedActionResult = {
  network: "mainnet" | "testnet";
  walletAddress: string;
  action: string;
  response?: unknown;
  order?: HyperliquidOrderSummary;
  reference?: string;
  detail: string;
};

export type HyperliquidTradeParams = {
  agentId: string;
  coin: string;
  marketType?: HyperliquidMarketType;
  side: HyperliquidSide;
  orderType: HyperliquidOrderType;
  notionalUsd?: number;
  size?: number;
  limitPrice?: number;
  timeInForce?: "Gtc" | "Ioc" | "Alo" | "FrontendMarket";
  triggerPx?: number;
  triggerType?: "tp" | "sl";
  triggerIsMarket?: boolean;
  grouping?: "na" | "normalTpsl" | "positionTpsl";
  clientOrderId?: string;
  reduceOnly?: boolean;
  slippageBps?: number;
};

export type HyperliquidActionParams = Partial<HyperliquidTradeParams> & {
  action: HyperliquidActionName;
  agentId: string;
  assetId?: number;
  orderId?: number | string;
  oid?: number | string;
  cloid?: string;
  fastCancel?: boolean;
  alwaysPlace?: boolean;
  scheduleCancelTime?: number | null;
  leverage?: number;
  marginMode?: "cross" | "isolated";
  isCross?: boolean;
  marginDeltaUsd?: number;
  transferType?: string;
  amount?: number;
  amountUsd?: number;
  destination?: string;
  token?: string;
  toPerp?: boolean;
  twapMinutes?: number;
  twapRandomize?: boolean;
  twapId?: number | string;
  aggregateByTime?: boolean;
  confirmation?: string;
  approvalToken?: string;
};

export async function fetchHyperliquidStatus(agentId: string): Promise<{ ok: boolean; error?: string; status?: HyperliquidAccountStatus }> {
  return postJson("/api/trading/hyperliquid", { action: "status", agentId });
}

export async function quoteHyperliquidTrade(params: HyperliquidTradeParams): Promise<{ ok: boolean; error?: string; quote?: HyperliquidQuote; confirmation?: string; builderConfirmation?: string }> {
  return postJson("/api/trading/hyperliquid", { action: "quote", ...params });
}

export async function approveHyperliquidBuilder(agentId: string): Promise<{ ok: boolean; error?: string; result?: { detail: string } }> {
  return postJson("/api/trading/hyperliquid", {
    action: "approve-builder",
    agentId,
    confirmation: HYPERLIQUID_BUILDER_CONFIRMATION,
  });
}

export async function executeHyperliquidTrade(params: HyperliquidTradeParams & { approvalToken?: string }): Promise<{ ok: boolean; error?: string; result?: HyperliquidOrderResult }> {
  return postJson("/api/trading/hyperliquid", {
    action: "order",
    ...params,
    confirmation: HYPERLIQUID_ORDER_CONFIRMATION,
  });
}

export async function runHyperliquidAction(params: HyperliquidActionParams): Promise<{ ok: boolean; error?: string; result?: HyperliquidSignedActionResult; status?: HyperliquidAccountStatus }> {
  return postJson("/api/trading/hyperliquid", {
    ...params,
    confirmation: params.confirmation ?? confirmationForHyperliquidAction(params.action),
  });
}

export function confirmationForHyperliquidAction(action: HyperliquidActionName) {
  if (action === "cancel" || action === "cancel-by-cloid" || action === "schedule-cancel") return HYPERLIQUID_CANCEL_CONFIRMATION;
  if (action === "leverage" || action === "margin") return HYPERLIQUID_ACCOUNT_CONFIRMATION;
  if (action === "usd-class" || action === "usd-send" || action === "spot-send" || action === "withdraw") return HYPERLIQUID_TRANSFER_CONFIRMATION;
  if (action === "twap-order" || action === "twap-cancel") return HYPERLIQUID_TWAP_CONFIRMATION;
  if (action === "order" || action === "modify") return HYPERLIQUID_ORDER_CONFIRMATION;
  return "";
}

// ---- Shared crypto practice book -------------------------------------------
export type CryptoPracticeSource = "alpaca-paper" | "hyperliquid" | "manual";
export type CryptoPracticeMarketType = "spot" | "perp";
export type CryptoPracticeSide = "long" | "short";

export type CryptoPracticeHolding = {
  id: string;
  symbol: string;
  marketType: CryptoPracticeMarketType;
  side: CryptoPracticeSide;
  quantity: number;
  notionalUsd: number;
  avgEntryPrice?: number;
  markPrice?: number;
  unrealizedPnlUsd?: number;
  source: CryptoPracticeSource;
  sourceReference?: string;
  updatedAt: string;
  stale?: boolean;
};

export type CryptoPracticeSnapshot = {
  id: string;
  source: CryptoPracticeSource;
  capturedAt: string;
  holdings: CryptoPracticeHolding[];
  accountValueUsd?: number;
  cashUsd?: number;
  walletAddress?: string;
  network?: "mainnet" | "testnet";
  stale?: boolean;
  detail: string;
};

export type CryptoPracticeBook = {
  version: 1;
  agentId: string;
  baseCurrency: "USD";
  updatedAt: string;
  targetSource: CryptoPracticeSource | "none";
  targetUpdatedAt?: string;
  targetHoldings: CryptoPracticeHolding[];
  snapshots: Partial<Record<CryptoPracticeSource, CryptoPracticeSnapshot>>;
};

export type CryptoPracticeReplayOrder = {
  sourceHoldingId: string;
  coin: string;
  marketType: CryptoPracticeMarketType;
  side: "long" | "short" | "buy" | "sell";
  notionalUsd: number;
  reduceOnly: boolean;
  supported: boolean;
  reason: string;
  missing?: string;
};

export type CryptoPracticeReplayPlan = {
  agentId: string;
  executionVenue: "hyperliquid";
  generatedAt: string;
  network?: "mainnet" | "testnet";
  orders: CryptoPracticeReplayOrder[];
  unsupported: CryptoPracticeReplayOrder[];
  totalNotionalUsd: number;
  confirmation: typeof CRYPTO_PRACTICE_REPLAY_CONFIRMATION;
  detail: string;
};

export async function fetchCryptoPracticeBook(agentId: string): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook }> {
  const response = await fetch(`/api/trading/practice-book?agentId=${encodeURIComponent(agentId)}`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  return asJson<{ book: CryptoPracticeBook }>(response);
}

export async function snapshotAlpacaPaperPracticeBook(agentId: string): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook; snapshot?: CryptoPracticeSnapshot }> {
  return postJson("/api/trading/practice-book", { action: "snapshot-alpaca-paper", agentId, replaceTarget: true });
}

export async function snapshotHyperliquidPracticeBook(agentId: string, replaceTarget = false): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook; snapshot?: CryptoPracticeSnapshot; status?: HyperliquidAccountStatus }> {
  return postJson("/api/trading/practice-book", { action: "snapshot-hyperliquid", agentId, replaceTarget });
}

export async function saveManualCryptoPracticeHolding(params: {
  agentId: string;
  symbol: string;
  marketType: CryptoPracticeMarketType;
  side: CryptoPracticeSide;
  quantity?: number;
  notionalUsd?: number;
  avgEntryPrice?: number;
  markPrice?: number;
}): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook }> {
  return postJson("/api/trading/practice-book", { action: "manual-holding", ...params });
}

export async function clearCryptoPracticeTarget(agentId: string): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook }> {
  return postJson("/api/trading/practice-book", { action: "clear-target", agentId });
}

export async function planCryptoPracticeReplay(agentId: string): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook; status?: HyperliquidAccountStatus; plan?: CryptoPracticeReplayPlan }> {
  return postJson("/api/trading/practice-book", { action: "plan-hyperliquid", agentId, includeCurrent: true });
}

export async function executeCryptoPracticeReplay(agentId: string): Promise<{ ok: boolean; error?: string; book?: CryptoPracticeBook; plan?: CryptoPracticeReplayPlan; results?: HyperliquidOrderResult[]; message?: string }> {
  return postJson("/api/trading/practice-book", {
    action: "execute-hyperliquid-replay",
    agentId,
    confirmation: CRYPTO_PRACTICE_REPLAY_CONFIRMATION,
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

export async function executeStockTrade(params: { agentId: string; side: "buy" | "sell"; ticker: string; notionalUsd: number; confirmation: string; paper: boolean; qty?: number }): Promise<{ ok: boolean; error?: string; result?: StockTradeResult }> {
  return postJson("/api/trading", { action: "execute", ...params });
}

export async function fetchStockPortfolio(agentId: string, paper: boolean): Promise<{ ok: boolean; error?: string; portfolio?: AlpacaPortfolio | null; note?: string }> {
  return postJson("/api/trading", { action: "portfolio", agentId, paper });
}

export async function cancelStockOrder(agentId: string, orderId: string, paper: boolean): Promise<{ ok: boolean; error?: string; canceled?: string }> {
  return postJson("/api/trading", { action: "cancel-order", agentId, orderId, paper });
}

// ---- Real market data (movers + sparklines + FX) ---------------------------
export type MarketRange = "24h" | "7d" | "30d";

export type CryptoMarketRow = { symbol: string; name: string; price: number; change24h: number; history: number[]; source: string };
export type StockMarketRow = { symbol: string; price: number; change24h: number; history: number[] };

export async function fetchCryptoMarket(symbols: string[], range: MarketRange = "24h"): Promise<{ ok: boolean; error?: string; rows?: CryptoMarketRow[] }> {
  return postJson("/api/trading/market", { kind: "crypto", symbols, range });
}

export async function fetchStockMarket(symbols: string[], paper: boolean, range: MarketRange = "24h", withHistory = true): Promise<{ ok: boolean; error?: string; rows?: StockMarketRow[] }> {
  return postJson("/api/trading/market", { kind: "stock", symbols, paper, range, withHistory });
}

export async function fetchStockEquityHistory(paper: boolean, range: MarketRange = "30d"): Promise<{ ok: boolean; error?: string; history?: number[] }> {
  return postJson("/api/trading/market", { kind: "stock-equity", paper, range });
}

export type FxRatesResult = { rates: Record<string, number>; source: string; updatedAt: number };

export async function fetchFxRates(): Promise<{ ok: boolean; error?: string; rates?: Record<string, number>; source?: string; updatedAt?: number }> {
  return postJson("/api/trading/market", { kind: "fx" });
}

// ---- Real wallet activity (unified spend ledger) ---------------------------
export type WalletActivityKind = "x402" | "x402-private" | "send" | "veil-transfer" | "trade" | "platform-fee" | string;
export type WalletActivityRecord = {
  id: string;
  agentId: string;
  companyId?: string;
  kind: WalletActivityKind;
  asset: string;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  status: "executed" | "failed" | string;
  approvalId?: string;
  transactionHash?: string;
  /** DEX swap legs (tokens + human amounts), when this record is a swap. */
  swap?: { sellToken: string; sellAmount: number; buyToken: string; buyAmount: number };
  createdAt: string;
  createdAtMs: number;
};

export async function fetchWalletActivity(limit = 100): Promise<{ ok: boolean; error?: string; records?: WalletActivityRecord[] }> {
  const response = await fetch(`/api/wallet/activity?limit=${encodeURIComponent(String(limit))}`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  return asJson<{ records: WalletActivityRecord[] }>(response);
}
