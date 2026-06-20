import "server-only";

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { base58 } from "@scure/base";
import {
  resolveXStock,
  supportedXStockTickers,
  SOLANA_USDC_MINT,
} from "@/lib/config/xstocks-tokens";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
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
 *                 by swapping the mint -> USDC (ExactOut for the requested USDC),
 *                 signing with the agent's existing local Solana wallet.
 *
 * A buy requires CONFIRM_BUY, a sell CONFIRM_SELL (same shape as x402's PAY_X402).
 * Both flow through the shared spend-governance chokepoint + ledger. A buy spends
 * USDC, so the company kill switch, rolling budgets, and approval escalation all
 * apply; a sell is an inflow, so only the kill switch binds and it never debits
 * rolling budgets (see executeStockTrade).
 */

const DEFAULT_ALPACA_KEY_ENV = "ALPACA_API_KEY_ID";
const DEFAULT_ALPACA_SECRET_ENV = "ALPACA_API_SECRET_KEY";
const JUPITER_BASE = process.env.JUPITER_API_BASE || "https://lite-api.jup.ag";
const DEFAULT_SLIPPAGE_BPS = 100; // 1.0% — tokenized-equity pools are thinner than majors.

export const BUY_STOCK_CONFIRMATION = "CONFIRM_BUY";
export const SELL_STOCK_CONFIRMATION = "CONFIRM_SELL";

/** Trade direction. A "sell" reduces an existing position back into USDC. */
export type StockTradeSide = "buy" | "sell";

export function stockTradeConfirmation(side: StockTradeSide): string {
  return side === "sell" ? SELL_STOCK_CONFIRMATION : BUY_STOCK_CONFIRMATION;
}

export type BuyStockPolicy = Pick<
  AgentWalletConfig,
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
  /** "AAPL" or "AAPLx" — resolved to the underlying (alpaca) or a verified mint (xstocks). */
  ticker: string;
  /** USD value of the trade: the order notional (alpaca) or the USDC in/out leg (xstocks). */
  notionalUsd: number;
  /** Optional whole-share count for alpaca (overrides notional when present). */
  qty?: number;
  /** Must equal CONFIRM_BUY for a buy, or CONFIRM_SELL for a sell, to execute. */
  confirmation?: string;
  /** Granted approval id supplied when retrying an escalated trade. */
  approvalToken?: string;
  /** Wallet network (xstocks only) — must be solana:mainnet. */
  network?: string;
  /** base58 Solana secret key (xstocks only). Never logged. */
  secret?: string;
  /** Slippage override for the swap, in basis points. */
  slippageBps?: number;
};

export type BuyStockResult = {
  ok: boolean;
  side: StockTradeSide;
  venue: AgentTradingVenue;
  ticker: string;
  notionalUsd: number;
  qty?: number;
  /** alpaca order id or xstocks tx signature. */
  reference: string;
  /** true only for alpaca paper-trading orders. */
  paper: boolean;
  /** Best-effort acquired amount: filled shares (alpaca) or token units (xstocks). */
  acquired?: number;
  priceImpactPct?: number;
  status: string;
  detail: string;
};

export type BuyStockQuote = {
  venue: AgentTradingVenue;
  ticker: string;
  notionalUsd: number;
  /** Estimated equity acquired in human units, when derivable. */
  estimatedUnits?: number;
  priceImpactPct?: number;
  detail: string;
};

function maxTradeUsd(policy: BuyStockPolicy): number {
  const explicit = Number(policy.maxTradeUsd) || 0;
  if (explicit > 0) return explicit;
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
    throw new Error("Stock buying is off for this agent. Set a trading venue (alpaca or xstocks) first.");
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

async function executeAlpaca(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const underlying = alpacaSymbol(input.ticker);
  const keyName = input.policy.alpacaKeyEnvName?.trim() || DEFAULT_ALPACA_KEY_ENV;
  const secretName = input.policy.alpacaSecretEnvName?.trim() || DEFAULT_ALPACA_SECRET_ENV;
  const [apiKey, apiSecret] = await Promise.all([hiveEnvValue(keyName), hiveEnvValue(secretName)]);
  if (!apiKey || !apiSecret) {
    throw new Error(`Alpaca keys not found in shared hive env (${keyName} / ${secretName}). Set them with hive-env first.`);
  }
  const paper = input.policy.alpacaPaper !== false;
  const base = paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  const order = input.qty && input.qty > 0
    ? { symbol: underlying, qty: String(input.qty), side, type: "market", time_in_force: "day" }
    : { symbol: underlying, notional: input.notionalUsd.toFixed(2), side, type: "market", time_in_force: "day" };

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
  const filled = Number(json.filled_qty || 0);
  return {
    ok: true,
    side,
    venue: "alpaca",
    ticker: underlying,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
    reference: json.id,
    paper,
    acquired: Number.isFinite(filled) ? filled : undefined,
    status: json.status || "accepted",
    detail: `${paper ? "Paper" : "LIVE"} market ${side} of ${underlying} submitted (order ${json.id}, status ${json.status || "accepted"}).`,
  };
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

async function executeXStocksSwap(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const token = resolveXStock(input.ticker);
  if (!token) {
    throw new Error(`"${input.ticker}" is not a verified xStock. Supported: ${supportedXStockTickers().join(", ")}.`);
  }
  if (input.network !== "solana:mainnet") throw new Error("xStocks swaps require a Solana mainnet wallet.");
  if (!input.secret) throw new Error("No local Solana wallet secret is available for the swap.");

  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const amountAtomic = Math.round(input.notionalUsd * 1_000_000); // USDC has 6 decimals.
  const quote = await quoteXStocksLeg(token.mint, side, amountAtomic, slippageBps);

  const keypair = Keypair.fromSecretKey(base58.decode(input.secret));
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
  return {
    ok: true,
    side,
    venue: "xstocks",
    ticker: token.symbol,
    notionalUsd: input.notionalUsd,
    reference: signature,
    paper: false,
    priceImpactPct,
    status: "confirmed",
    detail: side === "sell"
      ? `Swapped ${token.symbol} (${token.name}) into ~$${realizedUsd.toFixed(2)} USDC. Tx ${signature}.`
      : `Swapped ~$${input.notionalUsd.toFixed(2)} USDC into ${token.symbol} (${token.name}). Tx ${signature}.`,
  };
}

// ---- Public API -------------------------------------------------------------

export async function executeStockTrade(input: BuyStockInput): Promise<BuyStockResult> {
  const side = input.side ?? "buy";
  const venue = assertVenue(input.policy);
  const notionalUsd = assertAmount(input, input.policy);
  const expected = stockTradeConfirmation(side);
  if (input.confirmation !== expected) {
    throw new Error(`Stock ${side}s need confirmation. Type ${expected} to approve up to $${maxTradeUsd(input.policy).toFixed(2)}.`);
  }

  // Governance pre-flight. The company kill switch binds for BOTH directions, so
  // resolveSpendGovernance also covers company members without their own wallet
  // config. A buy spends USDC -> run the full budget/approval evaluation. A sell
  // is an inflow, so we evaluate with amountUsd 0: that still hard-blocks on a
  // frozen company kill switch but never trips a rolling budget or escalation.
  const governance = await resolveSpendGovernance(input.agentId);
  let approvalGrantId: string | undefined;
  let companyId: string | undefined;
  const spendForGovernance = side === "sell" ? 0 : notionalUsd;
  if (governance && (side === "sell" || (await shouldEvaluateSpend(governance.wallet, maxTradeUsd(input.policy))))) {
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "trade",
      asset: "USDC",
      amountUsd: spendForGovernance,
      target: `${venue}:${input.ticker} ${side}`,
      approvalToken: input.approvalToken,
    });
    if (decision.decision !== "allow") throw new Error(decision.reason);
    approvalGrantId = decision.grant?.id;
    companyId = decision.companyId;
  }

  const result = venue === "alpaca" ? await executeAlpaca(input) : await executeXStocksSwap(input);

  await appendSpend({
    agentId: input.agentId,
    companyId,
    kind: "trade",
    asset: "USDC",
    // A sell credits USDC; record its USD value as assetAmount (not amountUsd) so
    // it shows in activity without counting against the rolling spend budgets,
    // which sum amountUsd across every kind.
    amountUsd: spendForGovernance,
    assetAmount: side === "sell" ? notionalUsd : undefined,
    target: shortTarget(`${venue}:${result.ticker} ${side}`),
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
export async function discoverStockTradeQuote(input: Pick<BuyStockInput, "side" | "policy" | "ticker" | "notionalUsd" | "slippageBps">): Promise<BuyStockQuote> {
  const side = input.side ?? "buy";
  const venue = assertVenue(input.policy);
  const notionalUsd = assertAmount({ ...input, agentId: "", ticker: input.ticker, notionalUsd: input.notionalUsd }, input.policy);
  if (venue === "alpaca") {
    const underlying = alpacaSymbol(input.ticker);
    return {
      venue,
      ticker: underlying,
      notionalUsd,
      detail: `Market ${side} of ${underlying} for ~$${notionalUsd.toFixed(2)} via Alpaca ${input.policy.alpacaPaper === false ? "LIVE" : "paper"}.`,
    };
  }
  const token = resolveXStock(input.ticker);
  if (!token) throw new Error(`"${input.ticker}" is not a verified xStock. Supported: ${supportedXStockTickers().join(", ")}.`);
  const slippageBps = input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
  const quote = await quoteXStocksLeg(token.mint, side, Math.round(notionalUsd * 1_000_000), slippageBps);
  const priceImpactPct = quote.priceImpactPct != null ? Number(quote.priceImpactPct) : undefined;
  const impactNote = priceImpactPct != null ? ` (price impact ${(priceImpactPct * 100).toFixed(2)}%)` : "";
  return {
    venue,
    ticker: token.symbol,
    notionalUsd,
    priceImpactPct,
    detail: side === "sell"
      ? `Swap ${token.symbol} -> ~$${notionalUsd.toFixed(2)} USDC via Jupiter${impactNote}.`
      : `Swap ~$${notionalUsd.toFixed(2)} USDC -> ${token.symbol} via Jupiter${impactNote}.`,
  };
}

/** Buy-side wrapper kept stable for the chat-runtime tool. */
export async function discoverBuyStockQuote(input: Pick<BuyStockInput, "policy" | "ticker" | "notionalUsd" | "slippageBps">): Promise<BuyStockQuote> {
  return discoverStockTradeQuote({ ...input, side: "buy" });
}

/** Narrow a persisted wallet config to the trade policy fields. */
export function toBuyStockPolicy(wallet: AgentWalletConfig): BuyStockPolicy {
  return {
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
    venue === "xstocks" ? `- On-chain network: ${wallet.network}` : "",
    `- Max per trade: $${maxTradeUsd(wallet).toFixed(2)}`,
  ].filter(Boolean).join("\n");
}
