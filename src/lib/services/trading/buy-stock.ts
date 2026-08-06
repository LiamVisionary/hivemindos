import "server-only";

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { base58 } from "@scure/base";
import { formatUnits, parseUnits } from "viem";
import {
  resolveXStock,
  supportedXStockTickers,
  SOLANA_USDC_MINT,
} from "@/lib/config/xstocks-tokens";
import {
  ROBINHOOD_CHAIN,
  ROBINHOOD_CHAIN_NETWORK,
  ROBINHOOD_CORE_TOKENS,
  resolveRobinhoodStockToken,
  supportedRobinhoodStockTickers,
} from "@/lib/config/robinhood-chain";
import { zeroExFetch } from "@/lib/services/trading/zero-ex";
import {
  buildAlpacaOrderPayload,
  type AlpacaSupportedOrderType,
  type AlpacaTimeInForce,
} from "@/lib/services/trading/alpaca-order";
import {
  placeRobinhoodAgenticEquityOrder,
  reviewRobinhoodAgenticEquityOrder,
} from "@/lib/services/trading/robinhood-agentic";
import { executeEvmZeroExSwap, type ZeroExSwapQuote } from "@/lib/services/wallet/chain-wallet";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  platformFeeDetail,
  platformFeeReceiptDetail,
  quoteTradingPlatformFee,
  reserveTradingPlatformFee,
  settleReservedTradingPlatformFee,
  type PlatformFeeCollection,
  type PlatformFeeQuote,
  type PlatformFeeReservation,
} from "@/lib/services/wallet/platform-fees";
import {
  evaluateSpend,
  resolveSpendGovernance,
  shouldEvaluateSpend,
} from "@/lib/services/wallet/spend-governance";
import type { AgentTradingVenue, AgentWalletConfig } from "@/lib/types/agent-wallet";

/**
 * Unified "trade a stock from a prompt" rail. Two venues, both directions:
 *
 *   - "alpaca"  — a real, regulated US brokerage. Places a market order via the
 *                 Alpaca Trading API. Defaults to PAPER trading; live trading is
 *                 reachable only when the wallet sets alpacaPaper:false.
 *   - "xstocks" — on-chain tokenized equities (Backed Finance xStocks). Buys by
 *                 swapping USDC -> the verified xStock SPL mint via Jupiter; sells
 *                 by sizing from the current quote then swapping the mint -> USDC,
 *                 signing with the agent's existing local Solana wallet.
 *   - "robinhood-chain" — official Robinhood Stock Token contracts on Robinhood
 *                 Chain. Buys/sells swap USDG <-> the canonical ERC-20 contract
 *                 through 0x Swap API RFQ/AMM liquidity and sign with the agent's
 *                 existing local Robinhood Chain EVM wallet.
 *   - "robinhood-agentic" — long equities in the user's dedicated Robinhood
 *                 Agentic brokerage account through Robinhood's official MCP.
 *                 HivemindOS reviews first and keeps placement behind the same
 *                 confirmation, cap, kill-switch, approval, and ledger path.
 *
 * A buy requires CONFIRM_BUY, a sell CONFIRM_SELL (same shape as x402's PAY_X402).
 * Both flow through the shared spend-governance chokepoint + ledger. A buy spends
 * USD stablecoins, so wallet caps and approval escalation apply. An explicit
 * active company task additionally applies that company's freeze and budgets; a
 * sell is an inflow and never debits rolling budgets (see executeStockTrade).
 */

// Alpaca issues SEPARATE credentials for the live brokerage and the paper
// (simulated) account — a live key 401s against paper-api and vice versa. So
// paper resolves its own env names first and only falls back to the live names
// for backward compat (the original single-key setups put paper keys here, since
// the rail defaults to paper).
const DEFAULT_ALPACA_KEY_ENV = "ALPACA_API_KEY_ID";
const DEFAULT_ALPACA_SECRET_ENV = "ALPACA_API_SECRET_KEY";
const DEFAULT_ALPACA_PAPER_KEY_ENV = "ALPACA_PAPER_API_KEY_ID";
const DEFAULT_ALPACA_PAPER_SECRET_ENV = "ALPACA_PAPER_API_SECRET_KEY";
const ALPACA_LIVE_BASE = "https://api.alpaca.markets";
const ALPACA_PAPER_BASE = "https://paper-api.alpaca.markets";
const JUPITER_BASE = process.env.JUPITER_API_BASE || "https://lite-api.jup.ag";
const DEFAULT_SLIPPAGE_BPS = 100; // 1.0% — tokenized-equity pools are thinner than majors.
const ROBINHOOD_USDG_DECIMALS = 6;

export const BUY_STOCK_CONFIRMATION = "CONFIRM_BUY";
export const SELL_STOCK_CONFIRMATION = "CONFIRM_SELL";

/** Shared-hive env var names this rail reads, by Alpaca account mode. */
export const ALPACA_LIVE_ENV_NAMES = [DEFAULT_ALPACA_KEY_ENV, DEFAULT_ALPACA_SECRET_ENV] as const;
export const ALPACA_PAPER_ENV_NAMES = [DEFAULT_ALPACA_PAPER_KEY_ENV, DEFAULT_ALPACA_PAPER_SECRET_ENV] as const;

/** Trade direction. A "sell" reduces an existing position back into USDC. */
export type StockTradeSide = "buy" | "sell";

export function stockTradeConfirmation(side: StockTradeSide): string {
  return side === "sell" ? SELL_STOCK_CONFIRMATION : BUY_STOCK_CONFIRMATION;
}

export type BuyStockPolicy = Pick<
  AgentWalletConfig,
  | "agentId"
  | "enabled"
  | "network"
  | "tradingVenue"
  | "alpacaKeyEnvName"
  | "alpacaSecretEnvName"
  | "alpacaPaper"
  | "maxTradeUsd"
  | "maxPaymentUsd"
>;

export type BuyStockInput = {
  agentId: string;
  policy: BuyStockPolicy;
  /** Buy (default) turns USDC into a position; sell turns a position into USDC. */
  side?: StockTradeSide;
  /** "AAPL" or "AAPLx" — resolved to Alpaca, a verified xStock mint, or a Robinhood Chain contract. */
  ticker: string;
  /** USD value of the trade: the order notional (alpaca) or the USDC in/out leg (xstocks). */
  notionalUsd: number;
  /**
   * Per-trade Alpaca account override. Undefined falls back to the wallet's
   * persisted alpacaPaper. The caller (route) only ever passes `true` to force
   * paper, or `false` when the persisted policy already permits live — a client
   * can never escalate a paper-only agent to the live brokerage.
   */
  paper?: boolean;
  /** Optional whole-share count for alpaca (overrides notional when present). */
  qty?: number;
  /** Advanced Alpaca order controls. Other venues remain market-only. */
  orderType?: AlpacaSupportedOrderType;
  timeInForce?: AlpacaTimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  /** Must equal CONFIRM_BUY for a buy, or CONFIRM_SELL for a sell, to execute. */
  confirmation?: string;
  /** Granted approval id supplied when retrying an escalated trade. */
  approvalToken?: string;
  /** True only for a server-validated direct confirmation or bounded persisted authorization. */
  approvalThresholdSatisfied?: boolean;
  /** Local wallet network used by xStocks, and by live Alpaca platform-fee collection. */
  network?: string;
  /** Local wallet secret used by xStocks, and by live Alpaca platform-fee collection. Never logged. */
  secret?: string;
  /** Local wallet public address used for live Alpaca platform-fee collection. */
  fromAddress?: string;
  /** Slippage override for the swap, in basis points. */
  slippageBps?: number;
  /** Active Work Board company task id. Omit for ordinary wallet trades. */
  companyTaskId?: string;
};

export type BuyStockResult = {
  ok: boolean;
  side: StockTradeSide;
  venue: AgentTradingVenue;
  ticker: string;
  notionalUsd: number;
  qty?: number;
  orderType?: AlpacaSupportedOrderType;
  timeInForce?: AlpacaTimeInForce;
  /** Alpaca order id, xStocks tx signature, or future venue reference. */
  reference: string;
  /** true only for alpaca paper-trading orders. */
  paper: boolean;
  /** Best-effort acquired amount: filled shares (alpaca) or token units (xstocks). */
  acquired?: number;
  priceImpactPct?: number;
  platformFee?: PlatformFeeCollection;
  status: string;
  detail: string;
};

export type BuyStockQuote = {
  venue: AgentTradingVenue;
  ticker: string;
  notionalUsd: number;
  orderType?: AlpacaSupportedOrderType;
  timeInForce?: AlpacaTimeInForce;
  /** Estimated equity acquired in human units, when derivable. */
  estimatedUnits?: number;
  priceImpactPct?: number;
  platformFee?: PlatformFeeQuote;
  detail: string;
};

function maxTradeUsd(policy: BuyStockPolicy): number {
  const explicit = Number(policy.maxTradeUsd) || 0;
  if (explicit > 0) return explicit;
  // Personal ("user:") wallets are the user's own custody — they carry no agent
  // per-trade guardrail (the Trade desk shows them uncapped). Don't inherit the
  // agent default maxPaymentUsd ($0.50) that createDefaultAgentWallet seeds onto
  // every wallet config; a human-operated own wallet sizes its own orders.
  if (policy.agentId?.startsWith("user:")) return 0;
  return Number(policy.maxPaymentUsd) || 0;
}

/**
 * Resolve a user ticker to an Alpaca symbol. If the input is a known xStock
 * symbol ("AAPLx") map to its underlying ("AAPL"); otherwise pass the real
 * ticker through untouched — never strip a trailing X (NFLX, SPGX are real).
 */
function alpacaSymbol(ticker: string): string {
  const known = resolveXStock(ticker);
  if (known) return known.underlying;
  const cleaned = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z.]{0,9}$/.test(cleaned)) throw new Error(`"${ticker}" is not a valid stock ticker.`);
  return cleaned;
}

function svmRpc(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

function assertVenue(policy: BuyStockPolicy): AgentTradingVenue {
  if (!policy.enabled) throw new Error("This agent's wallet is not enabled.");
  if (!policy.tradingVenue) {
    throw new Error("Stock buying is off for this agent. Set a trading venue (alpaca, robinhood-agentic, xstocks, or robinhood-chain) first.");
  }
  return policy.tradingVenue;
}

function assertAmount(input: BuyStockInput, policy: BuyStockPolicy): number {
  const notional = Number(input.notionalUsd);
  if (!Number.isFinite(notional) || notional <= 0) throw new Error("Trade amount must be a positive USD value.");
  const cap = maxTradeUsd(policy);
  if (cap > 0 && notional > cap) {
    throw new Error(`Trade would exceed this agent's per-trade cap ($${cap.toFixed(2)}).`);
  }
  return notional;
}

// ---- Alpaca (real brokerage) ------------------------------------------------

/** Effective paper/live for this trade: per-trade override, else persisted policy (defaults paper). */
function resolveAlpacaPaper(input: Pick<BuyStockInput, "paper" | "policy">): boolean {
  return typeof input.paper === "boolean" ? input.paper : input.policy.alpacaPaper !== false;
}

async function firstPresentEnv(names: Array<string | undefined>): Promise<{ name: string; value: string } | null> {
  for (const name of names) {
    const clean = name?.trim();
    if (!clean) continue;
    const value = await hiveEnvValue(clean);
    if (value) return { name: clean, value };
  }
  return null;
}

/**
 * Resolve the Alpaca key pair for the chosen account mode. Paper tries its own
 * env names first, then falls back to the live/default names; live uses only the
 * live names. Throws a message naming exactly which keys to set.
 */
async function resolveAlpacaCreds(policy: BuyStockPolicy, paper: boolean): Promise<{ apiKey: string; apiSecret: string }> {
  const liveKey = policy.alpacaKeyEnvName?.trim() || DEFAULT_ALPACA_KEY_ENV;
  const liveSecret = policy.alpacaSecretEnvName?.trim() || DEFAULT_ALPACA_SECRET_ENV;
  const keyNames = paper ? [DEFAULT_ALPACA_PAPER_KEY_ENV, liveKey] : [liveKey];
  const secretNames = paper ? [DEFAULT_ALPACA_PAPER_SECRET_ENV, liveSecret] : [liveSecret];
  const [key, secret] = await Promise.all([firstPresentEnv(keyNames), firstPresentEnv(secretNames)]);
  if (!key || !secret) {
    const wanted = paper
      ? `${DEFAULT_ALPACA_PAPER_KEY_ENV} / ${DEFAULT_ALPACA_PAPER_SECRET_ENV} (or ${liveKey} / ${liveSecret})`
      : `${liveKey} / ${liveSecret}`;
    throw new Error(`Alpaca ${paper ? "paper" : "live"} keys not found in shared hive env (${wanted}). Set them with hive-env first.`);
  }
  return { apiKey: key.value, apiSecret: secret.value };
}

async function reserveBrokeragePlatformFee(
  input: BuyStockInput,
  source: "alpaca-live" | "robinhood-agentic",
  venueLabel: string,
): Promise<PlatformFeeReservation | undefined> {
  const feeNetwork = input.network || input.policy.network;
  const quote = await quoteTradingPlatformFee({ source, network: feeNetwork, amountUsd: input.notionalUsd });
  if (!quote.enabled) return undefined;
  if (!input.network || !input.secret || !input.fromAddress) {
    throw new Error(`${venueLabel} trades need this agent's local wallet so HivemindOS can reserve and collect the platform fee.`);
  }
  return reserveTradingPlatformFee({
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    amountUsd: input.notionalUsd,
    source,
  });
}

async function executeAlpaca(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const underlying = alpacaSymbol(input.ticker);
  const paper = resolveAlpacaPaper(input);
  const { apiKey, apiSecret } = await resolveAlpacaCreds(input.policy, paper);
  const feeReservation = paper
    ? undefined
    : await reserveBrokeragePlatformFee(input, "alpaca-live", "Live Alpaca");
  const base = paper ? ALPACA_PAPER_BASE : ALPACA_LIVE_BASE;
  const order = buildAlpacaOrderPayload({
    ticker: underlying,
    side,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
    orderType: input.orderType,
    timeInForce: input.timeInForce,
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
  });

  const response = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(order),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => null)) as
    | { id?: string; status?: string; filled_qty?: string; filled_avg_price?: string; message?: string }
    | null;
  if (!response.ok || !json?.id) {
    throw new Error(`Alpaca order rejected (HTTP ${response.status}): ${json?.message || "no order id returned"}.`);
  }
  const platformFee = feeReservation
    ? await settleReservedTradingPlatformFee({ agentId: input.agentId, reservation: feeReservation })
    : undefined;
  const filled = Number(json.filled_qty || 0);
  return {
    ok: true,
    side,
    venue: "alpaca",
    ticker: underlying,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
    orderType: order.type,
    timeInForce: order.time_in_force,
    reference: json.id,
    paper,
    acquired: Number.isFinite(filled) ? filled : undefined,
    platformFee,
    status: json.status || "accepted",
    detail: `${paper ? "Paper" : "LIVE"} ${order.type.replace("_", "-")} ${side} of ${underlying} submitted (order ${json.id}, status ${json.status || "accepted"}).${platformFeeReceiptDetail(platformFee)}`,
  };
}

// ---- Alpaca portfolio (read-only account + open positions) ------------------

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

/** An open (not-yet-filled) Alpaca order — surfaced so the desk can show a
 *  pending position before it fills. A notional market buy has notionalUsd set
 *  and qty null; a share order has qty set. */
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
  account: {
    status: string;
    currency: string;
    equity: number;
    cash: number;
    buyingPower: number;
    portfolioValue: number;
  };
  positions: AlpacaPosition[];
  /** Open/pending orders (status=open) so the UI can show them before they fill. */
  openOrders: AlpacaOpenOrder[];
};

/**
 * Read the Alpaca account summary + open positions for the chosen mode. Read-only
 * (no order placed), so no governance gate — but it still uses the mode-correct
 * credentials, so a paper view never touches the live account.
 */
export async function fetchAlpacaPortfolio(input: { policy: BuyStockPolicy; paper: boolean }): Promise<AlpacaPortfolio> {
  const { apiKey, apiSecret } = await resolveAlpacaCreds(input.policy, input.paper);
  const base = input.paper ? ALPACA_PAPER_BASE : ALPACA_LIVE_BASE;
  const headers = { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret };
  const [accountRes, positionsRes, ordersRes] = await Promise.all([
    fetch(`${base}/v2/account`, { headers, signal: AbortSignal.timeout(20_000) }),
    fetch(`${base}/v2/positions`, { headers, signal: AbortSignal.timeout(20_000) }),
    fetch(`${base}/v2/orders?status=open&limit=100&nested=false`, { headers, signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!accountRes.ok) {
    throw new Error(`Alpaca account fetch failed (HTTP ${accountRes.status}). Check the ${input.paper ? "paper" : "live"} keys.`);
  }
  const account = (await accountRes.json().catch(() => ({}))) as Record<string, unknown>;
  const rawPositions = positionsRes.ok ? ((await positionsRes.json().catch(() => [])) as unknown) : [];
  const rawOrders = ordersRes.ok ? ((await ordersRes.json().catch(() => [])) as unknown) : [];
  const openOrders: AlpacaOpenOrder[] = (Array.isArray(rawOrders) ? rawOrders : []).map((raw) => {
    const o = raw as Record<string, unknown>;
    const qty = o.qty == null ? null : Number(o.qty) || 0;
    const notionalUsd = o.notional == null ? null : Number(o.notional) || 0;
    return {
      id: String(o.id || ""),
      symbol: String(o.symbol || ""),
      side: String(o.side || "buy"),
      qty,
      notionalUsd,
      filledQty: Number(o.filled_qty) || 0,
      status: String(o.status || "pending"),
      submittedAt: String(o.submitted_at || o.created_at || ""),
    };
  });
  const positions: AlpacaPosition[] = (Array.isArray(rawPositions) ? rawPositions : []).map((raw) => {
    const p = raw as Record<string, unknown>;
    return {
      symbol: String(p.symbol || ""),
      qty: Number(p.qty) || 0,
      side: String(p.side || "long"),
      marketValue: Number(p.market_value) || 0,
      costBasis: Number(p.cost_basis) || 0,
      avgEntryPrice: Number(p.avg_entry_price) || 0,
      currentPrice: Number(p.current_price) || 0,
      unrealizedPlUsd: Number(p.unrealized_pl) || 0,
      unrealizedPlPct: Number(p.unrealized_plpc) || 0,
    };
  });
  return {
    paper: input.paper,
    account: {
      status: String(account.status || "unknown"),
      currency: String(account.currency || "USD"),
      equity: Number(account.equity) || 0,
      cash: Number(account.cash) || 0,
      buyingPower: Number(account.buying_power) || 0,
      portfolioValue: Number(account.portfolio_value) || 0,
    },
    positions,
    openOrders,
  };
}

/**
 * Cancel one open Alpaca order by id, on the mode-correct account. Cancelling is
 * a reversal (it prevents a spend), so it's not governance- or confirmation-gated
 * — but it still uses the venue's own credentials. Alpaca returns 204 on cancel
 * and 422 when the order is no longer cancelable (e.g. it already filled).
 */
export async function cancelAlpacaOrder(input: { policy: BuyStockPolicy; paper: boolean; orderId: string }): Promise<{ ok: boolean; status: number }> {
  if (input.policy.tradingVenue !== "alpaca") throw new Error("Order cancel is only available for the Alpaca venue.");
  const orderId = input.orderId?.trim();
  if (!orderId) throw new Error("An order id is required to cancel.");
  const { apiKey, apiSecret } = await resolveAlpacaCreds(input.policy, input.paper);
  const base = input.paper ? ALPACA_PAPER_BASE : ALPACA_LIVE_BASE;
  const res = await fetch(`${base}/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    headers: { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && res.status !== 204) {
    if (res.status === 422) throw new Error("This order can't be canceled — it may have already filled.");
    if (res.status === 404) throw new Error("That order no longer exists (it may have filled or already canceled).");
    const body = await res.text().catch(() => "");
    throw new Error(`Order cancel failed (HTTP ${res.status}).${body ? ` ${body.slice(0, 120)}` : ""}`);
  }
  return { ok: true, status: res.status };
}

// ---- xStocks (on-chain tokenized equities via Jupiter) ----------------------

type JupiterQuote = {
  outAmount?: string;
  priceImpactPct?: string;
  swapUsdValue?: string;
  [k: string]: unknown;
};

/**
 * Quote a Jupiter swap (always ExactIn — tokenized-equity pools route ExactIn far
 * more reliably than ExactOut). `amountAtomic` is in the input mint's atomic units.
 */
async function fetchJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountAtomic: number,
  slippageBps: number,
): Promise<JupiterQuote> {
  if (amountAtomic <= 0) throw new Error("Swap amount rounds to zero.");
  const url = `${JUPITER_BASE}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountAtomic}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Jupiter quote failed (HTTP ${response.status}).`);
  const quote = (await response.json()) as JupiterQuote;
  if (!quote?.outAmount) throw new Error("Jupiter returned no route for this swap (insufficient liquidity?).");
  return quote;
}

/**
 * Quote the directly-executable swap for an xStock trade. A buy is USDC->mint for
 * the requested USD. A sell sizes the position from the current USDC->mint price,
 * then quotes mint->USDC for that many tokens — both legs ExactIn — so the sell
 * routes through the same liquid pools as the buy. `usdcAtomic` is the requested
 * USD in 6-decimal USDC units, so the caller always works in USD.
 */
async function quoteXStocksLeg(mint: string, side: StockTradeSide, usdcAtomic: number, slippageBps: number): Promise<JupiterQuote> {
  if (side === "buy") return fetchJupiterQuote(SOLANA_USDC_MINT, mint, usdcAtomic, slippageBps);
  const price = await fetchJupiterQuote(SOLANA_USDC_MINT, mint, usdcAtomic, slippageBps);
  const mintAtomic = Math.floor(Number(price.outAmount) || 0);
  if (mintAtomic <= 0) throw new Error("Could not size the sell from the current xStock price.");
  return fetchJupiterQuote(mint, SOLANA_USDC_MINT, mintAtomic, slippageBps);
}

function assertXStocksNetwork(network: string | undefined): asserts network is "solana:mainnet" {
  if (network !== "solana:mainnet") throw new Error("xStocks swaps require a Solana mainnet wallet.");
}

function assertRobinhoodChainNetwork(network: string | undefined): asserts network is typeof ROBINHOOD_CHAIN_NETWORK {
  if (network !== ROBINHOOD_CHAIN_NETWORK) throw new Error(`Robinhood Chain stock tokens require a ${ROBINHOOD_CHAIN.network} wallet.`);
}

async function executeXStocksSwap(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const token = resolveXStock(input.ticker);
  if (!token) {
    throw new Error(`"${input.ticker}" is not a verified xStock. Supported: ${supportedXStockTickers().join(", ")}.`);
  }
  assertXStocksNetwork(input.network);
  if (!input.secret) throw new Error("No local Solana wallet secret is available for the swap.");

  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const amountAtomic = Math.round(input.notionalUsd * 1_000_000); // USDC has 6 decimals.
  const quote = await quoteXStocksLeg(token.mint, side, amountAtomic, slippageBps);
  await assertTradingPlatformFeeReady({ source: "xstocks", network: input.network, amountUsd: input.notionalUsd });

  const keypair = Keypair.fromSecretKey(base58.decode(input.secret));
  const fromAddress = keypair.publicKey.toBase58();
  const swapResponse = await fetch(`${JUPITER_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      // Use the quote's fixed slippageBps as the binding min-out — dynamic slippage
      // recomputes a tighter bound that fails simulation (Jupiter 0x1771) on deep pairs.
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const swapJson = (await swapResponse.json().catch(() => null)) as { swapTransaction?: string; error?: string } | null;
  if (!swapResponse.ok || !swapJson?.swapTransaction) {
    throw new Error(`Jupiter swap build failed (HTTP ${swapResponse.status}): ${swapJson?.error || "no transaction returned"}.`);
  }

  const tx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(swapJson.swapTransaction, "base64")));
  tx.sign([keypair]);
  const connection = new Connection(svmRpc(), "confirmed");
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");

  const priceImpactPct = quote.priceImpactPct != null ? Number(quote.priceImpactPct) : undefined;
  // For a sell the swap's outAmount is the realized USDC (6 decimals).
  const realizedUsd = side === "sell" ? (Number(quote.outAmount) || 0) / 1_000_000 : input.notionalUsd;
  const platformFee = await collectTradingPlatformFee({
    agentId: input.agentId,
    network: input.network,
    secret: input.secret,
    fromAddress,
    amountUsd: input.notionalUsd,
    source: "xstocks",
  });
  return {
    ok: true,
    side,
    venue: "xstocks",
    ticker: token.symbol,
    notionalUsd: input.notionalUsd,
    reference: signature,
    paper: false,
    priceImpactPct,
    platformFee,
    status: "confirmed",
    detail: side === "sell"
      ? `Swapped ${token.symbol} (${token.name}) into ~$${realizedUsd.toFixed(2)} USDC. Tx ${signature}.${platformFeeReceiptDetail(platformFee)}`
      : `Swapped ~$${input.notionalUsd.toFixed(2)} USDC into ${token.symbol} (${token.name}). Tx ${signature}.${platformFeeReceiptDetail(platformFee)}`,
  };
}

// ---- Robinhood Chain (official stock-token allowlist via 0x Swap API) -------

function robinhoodStockToken(ticker: string) {
  const token = resolveRobinhoodStockToken(ticker);
  if (!token) {
    throw new Error(`"${ticker}" is not a canonical Robinhood Stock Token. Supported: ${supportedRobinhoodStockTickers().join(", ")}.`);
  }
  return token;
}

type RobinhoodZeroExLeg = {
  token: ReturnType<typeof robinhoodStockToken>;
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellSymbol: string;
  buySymbol: string;
  sellDecimals: number;
  buyDecimals: number;
  sellAmount: bigint;
  side: StockTradeSide;
};

type RobinhoodZeroExPrice = Record<string, unknown> & {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  sellAmount?: string;
};

function robinhoodZeroExPath(endpoint: "price" | "quote", leg: RobinhoodZeroExLeg, slippageBps: number, taker?: string): string {
  const params = new URLSearchParams({
    chainId: String(ROBINHOOD_CHAIN.chainId),
    sellToken: leg.sellToken,
    buyToken: leg.buyToken,
    sellAmount: leg.sellAmount.toString(),
    slippageBps: String(slippageBps),
  });
  if (taker) params.set("taker", taker);
  return `/swap/permit2/${endpoint}?${params.toString()}`;
}

async function fetchRobinhoodZeroExPrice(leg: RobinhoodZeroExLeg, slippageBps: number): Promise<RobinhoodZeroExPrice> {
  const price = await zeroExFetch(robinhoodZeroExPath("price", leg, slippageBps), "Robinhood Chain stock-token trades") as RobinhoodZeroExPrice;
  if (!price.liquidityAvailable) throw new Error("0x returned no Robinhood Chain route/liquidity for this stock-token trade right now.");
  if (!price.buyAmount) throw new Error("0x returned no output amount for this Robinhood Chain stock-token trade.");
  return price;
}

async function fetchRobinhoodZeroExQuote(leg: RobinhoodZeroExLeg, slippageBps: number, taker: string): Promise<RobinhoodZeroExPrice & ZeroExSwapQuote> {
  const quote = await zeroExFetch(robinhoodZeroExPath("quote", leg, slippageBps, taker), "Robinhood Chain stock-token trades") as RobinhoodZeroExPrice & ZeroExSwapQuote;
  if (!quote.liquidityAvailable || !quote.transaction) throw new Error("0x returned no executable Robinhood Chain transaction for this stock-token trade.");
  return quote;
}

async function prepareRobinhoodChainLeg(ticker: string, side: StockTradeSide, notionalUsd: number, slippageBps: number): Promise<{ leg: RobinhoodZeroExLeg; price: RobinhoodZeroExPrice }> {
  const token = robinhoodStockToken(ticker);
  const usdgAmount = parseUnits(notionalUsd.toFixed(ROBINHOOD_USDG_DECIMALS), ROBINHOOD_USDG_DECIMALS);
  if (usdgAmount <= 0n) throw new Error("Trade amount rounds to zero USDG.");
  if (side === "buy") {
    const leg: RobinhoodZeroExLeg = {
      token,
      sellToken: ROBINHOOD_CORE_TOKENS.USDG,
      buyToken: token.address,
      sellSymbol: "USDG",
      buySymbol: token.symbol,
      sellDecimals: ROBINHOOD_USDG_DECIMALS,
      buyDecimals: token.decimals,
      sellAmount: usdgAmount,
      side,
    };
    return { leg, price: await fetchRobinhoodZeroExPrice(leg, slippageBps) };
  }

  const sizingLeg: RobinhoodZeroExLeg = {
    token,
    sellToken: ROBINHOOD_CORE_TOKENS.USDG,
    buyToken: token.address,
    sellSymbol: "USDG",
    buySymbol: token.symbol,
    sellDecimals: ROBINHOOD_USDG_DECIMALS,
    buyDecimals: token.decimals,
    sellAmount: usdgAmount,
    side: "buy",
  };
  const sizingPrice = await fetchRobinhoodZeroExPrice(sizingLeg, slippageBps);
  const tokenAmount = BigInt(String(sizingPrice.buyAmount || "0"));
  if (tokenAmount <= 0n) throw new Error("Could not size the Robinhood Chain stock-token sell from the current USDG price.");
  const sellLeg: RobinhoodZeroExLeg = {
    token,
    sellToken: token.address,
    buyToken: ROBINHOOD_CORE_TOKENS.USDG,
    sellSymbol: token.symbol,
    buySymbol: "USDG",
    sellDecimals: token.decimals,
    buyDecimals: ROBINHOOD_USDG_DECIMALS,
    sellAmount: tokenAmount,
    side,
  };
  return { leg: sellLeg, price: await fetchRobinhoodZeroExPrice(sellLeg, slippageBps) };
}

function robinhoodBuyUnits(price: RobinhoodZeroExPrice, leg: RobinhoodZeroExLeg): number {
  return Number(formatUnits(BigInt(String(price.buyAmount || "0")), leg.buyDecimals));
}

async function quoteRobinhoodChainTrade(input: Pick<BuyStockInput, "side" | "ticker" | "notionalUsd" | "slippageBps">): Promise<{ token: ReturnType<typeof robinhoodStockToken>; estimatedUnits: number; realizedUsd?: number; detail: string }> {
  const side = input.side ?? "buy";
  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const { leg, price } = await prepareRobinhoodChainLeg(input.ticker, side, input.notionalUsd, slippageBps);
  const buyUnits = robinhoodBuyUnits(price, leg);
  const detail = side === "sell"
    ? `Swap ~${Number(formatUnits(leg.sellAmount, leg.sellDecimals)).toPrecision(6)} ${leg.sellSymbol} -> ~${buyUnits.toFixed(6)} USDG on ${ROBINHOOD_CHAIN.name} via 0x (<=${(slippageBps / 100).toFixed(2)}% slippage).`
    : `Swap ~$${input.notionalUsd.toFixed(2)} USDG -> ~${buyUnits.toPrecision(6)} ${leg.buySymbol} on ${ROBINHOOD_CHAIN.name} via 0x (<=${(slippageBps / 100).toFixed(2)}% slippage).`;
  return {
    token: leg.token,
    estimatedUnits: side === "sell" ? Number(formatUnits(leg.sellAmount, leg.sellDecimals)) : buyUnits,
    realizedUsd: side === "sell" ? buyUnits : undefined,
    detail,
  };
}

async function executeRobinhoodChainSwap(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const token = robinhoodStockToken(input.ticker);
  assertRobinhoodChainNetwork(input.network);
  if (!input.secret) throw new Error("No local Robinhood Chain wallet secret is available for the swap.");
  if (!input.fromAddress) throw new Error("No Robinhood Chain wallet address is available for the swap.");

  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const { leg } = await prepareRobinhoodChainLeg(token.symbol, side, input.notionalUsd, slippageBps);
  await assertTradingPlatformFeeReady({ source: "robinhood-chain", network: input.network, amountUsd: input.notionalUsd });
  const quote = await fetchRobinhoodZeroExQuote(leg, slippageBps, input.fromAddress);
  const { approvalHash, swapHash } = await executeEvmZeroExSwap({
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    sellToken: leg.sellToken,
    quote,
  });
  const buyAmount = robinhoodBuyUnits(quote, leg);
  const platformFee = await collectTradingPlatformFee({
    agentId: input.agentId,
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    amountUsd: input.notionalUsd,
    source: "robinhood-chain",
  });
  return {
    ok: true,
    side,
    venue: "robinhood-chain",
    ticker: token.symbol,
    notionalUsd: input.notionalUsd,
    reference: swapHash,
    paper: false,
    acquired: side === "buy" ? buyAmount : undefined,
    platformFee,
    status: "confirmed",
    detail: side === "sell"
      ? `Swapped ${Number(formatUnits(leg.sellAmount, leg.sellDecimals)).toPrecision(6)} ${token.symbol} (${token.name}) into ~${buyAmount.toFixed(6)} USDG. Tx ${swapHash}${approvalHash ? `; approval ${approvalHash}` : ""}.${platformFeeReceiptDetail(platformFee)}`
      : `Swapped ~$${input.notionalUsd.toFixed(2)} USDG into ~${buyAmount.toPrecision(6)} ${token.symbol} (${token.name}). Tx ${swapHash}${approvalHash ? `; approval ${approvalHash}` : ""}.${platformFeeReceiptDetail(platformFee)}`,
  };
}

export async function checkRobinhoodChainTradingReadiness(): Promise<{ executable: boolean; reason: string }> {
  try {
    await quoteRobinhoodChainTrade({ side: "buy", ticker: "AAPL", notionalUsd: 1, slippageBps: DEFAULT_SLIPPAGE_BPS });
    return { executable: true, reason: "0x returned a live Robinhood Chain stock-token route for USDG -> AAPL." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Robinhood Chain stock-token route check failed.";
    return { executable: false, reason: message };
  }
}

// ---- Robinhood Agentic brokerage (official OAuth MCP) ----------------------

function robinhoodAgenticDetail(value: unknown) {
  if (typeof value === "string") return value.slice(0, 600);
  try {
    return JSON.stringify(value).slice(0, 600);
  } catch {
    return "Robinhood completed the pre-trade review.";
  }
}

async function quoteRobinhoodAgenticTrade(input: Pick<BuyStockInput, "side" | "ticker" | "notionalUsd" | "qty">) {
  const side = input.side ?? "buy";
  const review = await reviewRobinhoodAgenticEquityOrder({
    side,
    ticker: alpacaSymbol(input.ticker),
    notionalUsd: input.notionalUsd,
    qty: input.qty,
  });
  return {
    review,
    detail: `Robinhood pre-trade review for a market ${side} of ${alpacaSymbol(input.ticker)} for ~$${input.notionalUsd.toFixed(2)}: ${robinhoodAgenticDetail(review)}`,
  };
}

async function executeRobinhoodAgenticTrade(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const ticker = alpacaSymbol(input.ticker);
  const feeReservation = await reserveBrokeragePlatformFee(input, "robinhood-agentic", "Robinhood Agentic");
  const placed = await placeRobinhoodAgenticEquityOrder({
    side,
    ticker,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
  });
  const platformFee = feeReservation
    ? await settleReservedTradingPlatformFee({ agentId: input.agentId, reservation: feeReservation })
    : undefined;
  return {
    ok: true,
    side,
    venue: "robinhood-agentic",
    ticker,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
    reference: placed.reference,
    paper: false,
    platformFee,
    status: "submitted",
    detail: `Robinhood Agentic market ${side} submitted after Robinhood review and HivemindOS approval. ${placed.detail}.${platformFeeReceiptDetail(platformFee)}`,
  };
}

// ---- Public API -------------------------------------------------------------

export async function executeStockTrade(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const venue = assertVenue(input.policy);
  if (venue !== "alpaca" && input.orderType && input.orderType !== "market") {
    throw new Error("Advanced stock orders are currently available only for Alpaca. Choose a market order for this venue.");
  }
  const notionalUsd = assertAmount(input, input.policy);
  const expected = stockTradeConfirmation(side);
  if (input.confirmation !== expected) {
    throw new Error(`Stock ${side}s need confirmation. Type ${expected} to approve up to $${maxTradeUsd(input.policy).toFixed(2)}.`);
  }

  // A paper trade is simulated against the Alpaca paper account — no real money
  // moves — so it must NOT debit real rolling budgets or trip approval
  // escalation, exactly like a sell (an inflow). It's "non-spending" for
  // governance: we evaluate with amountUsd 0 so an explicit company task's
  // freeze switch can bind, but it never consumes daily/monthly budget.
  const isPaperTrade = venue === "alpaca" && resolveAlpacaPaper(input);
  const nonSpending = side === "sell" || isPaperTrade;

  // Ordinary trades use wallet policy only. Company policy binds only when the
  // caller supplies an active validated company Work Board task.
  const governance = await resolveSpendGovernance(input.agentId, { companyTaskId: input.companyTaskId });
  let approvalGrantId: string | undefined;
  let companyId: string | undefined;
  const spendForGovernance = nonSpending ? 0 : notionalUsd;
  const spendAsset = venue === "robinhood-chain" ? "USDG" : "USDC";
  if (governance && (nonSpending || (await shouldEvaluateSpend(governance.wallet, maxTradeUsd(input.policy), { companyId: governance.companyId })))) {
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "trade",
      asset: spendAsset,
      amountUsd: spendForGovernance,
      target: `${venue}:${input.ticker} ${side}${isPaperTrade ? " (paper)" : ""}`,
      approvalToken: input.approvalToken,
      approvalThresholdSatisfied: input.approvalThresholdSatisfied,
      companyId: governance.companyId,
      explanation: {
        summary: isPaperTrade
          ? "This is a paper stock trade. It does not spend real funds."
          : `This is a ${venue} stock trade request.`,
        whyNow: nonSpending
          ? "The governance check still runs, but the action does not debit a rolling spend budget."
          : "The trade notional crossed a wallet governance rule and was paused before execution.",
        impact: nonSpending
          ? "Approving lets the simulated or reducing trade continue. Rejecting stops this trade attempt."
          : `Approving lets the agent place the ${side} order for about $${notionalUsd.toFixed(2)}. Rejecting keeps the trade blocked.`,
        requestedAction: "Approve only if the ticker, side, venue, and notional amount match the intended trading plan.",
        evidence: [
          `Ticker: ${input.ticker}`,
          `Side: ${side}`,
          `Venue: ${venue}`,
          `Order type: ${input.orderType ?? "market"}`,
          `Notional: $${notionalUsd.toFixed(2)}`,
        ],
        missingContext: [],
        source: "Stock trade governance",
      },
    });
    if (decision.decision !== "allow") throw new Error(decision.reason);
    approvalGrantId = decision.grant?.id;
    companyId = decision.companyId;
  }

  const result = venue === "alpaca"
    ? await executeAlpaca(input)
    : venue === "robinhood-agentic"
      ? await executeRobinhoodAgenticTrade(input)
    : venue === "xstocks"
      ? await executeXStocksSwap(input)
      : await executeRobinhoodChainSwap(input);

  await appendSpend({
    agentId: input.agentId,
    companyId,
    kind: "trade",
    asset: spendAsset,
    // Non-spending trades (sells, paper) record their USD value as assetAmount
    // (not amountUsd) so they show in activity without counting against the
    // rolling spend budgets, which sum amountUsd across every kind.
    amountUsd: spendForGovernance,
    assetAmount: nonSpending ? notionalUsd : undefined,
    target: shortTarget(`${venue}:${result.ticker} ${side}${result.paper ? " (paper)" : ""}`),
    status: "executed",
    approvalId: approvalGrantId,
  }).catch(() => {});

  return result;
}

/** Buy-side wrapper kept stable for the chat-runtime tool. */
export async function executeBuyStock(input: BuyStockInput): Promise<BuyStockResult> {
  return executeStockTrade({ ...input, side: "buy" });
}

/**
 * Tolerant pre-flight used to build the confirmation card. For xstocks it pulls
 * a live Jupiter quote (price impact, and for sells the USDC ExactOut leg); for
 * alpaca it echoes the notional (a live quote would burn an API call before
 * confirmation).
 */
export async function discoverStockTradeQuote(input: Pick<BuyStockInput, "side" | "policy" | "ticker" | "notionalUsd" | "slippageBps" | "paper" | "orderType" | "timeInForce" | "qty" | "limitPrice" | "stopPrice">): Promise<BuyStockQuote> {
  const side = input.side ?? "buy";
  const venue = assertVenue(input.policy);
  const notionalUsd = assertAmount({ ...input, agentId: "", ticker: input.ticker, notionalUsd: input.notionalUsd }, input.policy);
  if (venue === "alpaca") {
    const underlying = alpacaSymbol(input.ticker);
    const paper = resolveAlpacaPaper(input);
    const order = buildAlpacaOrderPayload({
      ticker: underlying,
      side,
      notionalUsd,
      qty: input.qty,
      orderType: input.orderType,
      timeInForce: input.timeInForce,
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
    });
    const platformFee = paper
      ? undefined
      : await quoteTradingPlatformFee({ source: "alpaca-live", network: input.policy.network, amountUsd: notionalUsd });
    return {
      venue,
      ticker: underlying,
      notionalUsd,
      orderType: order.type,
      timeInForce: order.time_in_force,
      platformFee,
      detail: `${order.type.replace("_", "-")} ${side} of ${underlying} for ~$${notionalUsd.toFixed(2)} via Alpaca ${paper ? "paper" : "LIVE"} (${order.time_in_force.toUpperCase()}).${platformFeeDetail(platformFee)}`,
    };
  }
  if (input.orderType && input.orderType !== "market") {
    throw new Error("Advanced stock orders are currently available only for Alpaca.");
  }
  if (venue === "robinhood-agentic") {
    const ticker = alpacaSymbol(input.ticker);
    const quote = await quoteRobinhoodAgenticTrade({ side, ticker, notionalUsd, qty: undefined });
    const platformFee = await quoteTradingPlatformFee({ source: "robinhood-agentic", network: input.policy.network, amountUsd: notionalUsd });
    return {
      venue,
      ticker,
      notionalUsd,
      platformFee,
      detail: `${quote.detail}${platformFeeDetail(platformFee)}`,
    };
  }
  if (venue === "robinhood-chain") {
    assertRobinhoodChainNetwork(input.policy.network);
    const token = robinhoodStockToken(input.ticker);
    const quote = await quoteRobinhoodChainTrade({ side, ticker: token.symbol, notionalUsd, slippageBps: input.slippageBps });
    const platformFee = await quoteTradingPlatformFee({ source: "robinhood-chain", network: input.policy.network, amountUsd: notionalUsd });
    return {
      venue,
      ticker: token.symbol,
      notionalUsd,
      estimatedUnits: side === "buy" ? quote.estimatedUnits : undefined,
      platformFee,
      detail: `${quote.detail}${platformFeeDetail(platformFee)}`,
    };
  }
  assertXStocksNetwork(input.policy.network);
  const token = resolveXStock(input.ticker);
  if (!token) throw new Error(`"${input.ticker}" is not a verified xStock. Supported: ${supportedXStockTickers().join(", ")}.`);
  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const quote = await quoteXStocksLeg(token.mint, side, Math.round(notionalUsd * 1_000_000), slippageBps);
  const priceImpactPct = quote.priceImpactPct != null ? Number(quote.priceImpactPct) : undefined;
  const impactNote = priceImpactPct != null ? ` (price impact ${(priceImpactPct * 100).toFixed(2)}%)` : "";
  const platformFee = await quoteTradingPlatformFee({ source: "xstocks", network: input.policy.network, amountUsd: notionalUsd });
  return {
    venue,
    ticker: token.symbol,
    notionalUsd,
    priceImpactPct,
    platformFee,
    detail: side === "sell"
      ? `Swap ${token.symbol} -> ~$${notionalUsd.toFixed(2)} USDC via Jupiter${impactNote}.${platformFeeDetail(platformFee)}`
      : `Swap ~$${notionalUsd.toFixed(2)} USDC -> ${token.symbol} via Jupiter${impactNote}.${platformFeeDetail(platformFee)}`,
  };
}

/** Buy-side wrapper kept stable for the chat-runtime tool. */
export async function discoverBuyStockQuote(input: Pick<BuyStockInput, "policy" | "ticker" | "notionalUsd" | "slippageBps">): Promise<BuyStockQuote> {
  return discoverStockTradeQuote({ ...input, side: "buy" });
}

/** Narrow a persisted wallet config to the trade policy fields. */
export function toBuyStockPolicy(wallet: AgentWalletConfig): BuyStockPolicy {
  return {
    agentId: wallet.agentId,
    enabled: wallet.enabled,
    network: wallet.network,
    tradingVenue: wallet.tradingVenue,
    alpacaKeyEnvName: wallet.alpacaKeyEnvName,
    alpacaSecretEnvName: wallet.alpacaSecretEnvName,
    alpacaPaper: wallet.alpacaPaper,
    maxTradeUsd: wallet.maxTradeUsd,
    maxPaymentUsd: wallet.maxPaymentUsd,
  };
}

export function summarizeBuyStockPolicy(wallet: AgentWalletConfig): string {
  const venue = wallet.tradingVenue;
  return [
    `- Stock buying: ${venue ? "on" : "off"}`,
    `- Venue: ${venue || "(none)"}`,
    venue === "alpaca" ? `- Alpaca mode: ${wallet.alpacaPaper === false ? "LIVE brokerage" : "paper (simulated)"}` : "",
    venue === "robinhood-agentic" ? "- Robinhood mode: dedicated Agentic brokerage account" : "",
    venue === "xstocks" ? `- On-chain network: ${wallet.network}` : "",
    venue === "robinhood-chain" ? `- Robinhood Chain network: ${wallet.network}` : "",
    `- Max per trade: $${maxTradeUsd(wallet).toFixed(2)}`,
  ].filter(Boolean).join("\n");
}
