import { NextRequest, NextResponse } from "next/server";
import {
  ALPACA_LIVE_ENV_NAMES,
  ALPACA_PAPER_ENV_NAMES,
  BUY_STOCK_CONFIRMATION,
  SELL_STOCK_CONFIRMATION,
  type StockTradeSide,
  cancelAlpacaOrder,
  discoverStockTradeQuote,
  executeStockTrade,
  fetchAlpacaPortfolio,
  stockTradeConfirmation,
  toBuyStockPolicy,
} from "@/lib/services/trading/buy-stock";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import { hiveEnvPresence } from "@/lib/services/shared-hive-env";
import { supportedXStockTickers } from "@/lib/config/xstocks-tokens";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HTTP surface for the stock-trade rail that previously only existed inside the
 * chat agent runtime. Buy and sell, Alpaca (paper/live) and on-chain xStocks.
 *
 * The acting wallet is ALWAYS resolved server-side from the persisted wallet
 * ledger (loadGovernanceWallet) — a client request never supplies the trade
 * policy, venue, or live/paper flag. Governance (kill switch, budgets, approval,
 * per-trade cap) and the CONFIRM_BUY / CONFIRM_SELL gate run inside
 * executeStockTrade, so a blocked or escalated trade surfaces its reason here.
 */

type TradingBody = {
  action?: "quote" | "execute" | "portfolio" | "cancel-order";
  side?: string;
  agentId?: string;
  orderId?: string;
  ticker?: string;
  notionalUsd?: number;
  qty?: number;
  confirmation?: string;
  approvalToken?: string;
  slippageBps?: number;
  /** Paper toggle from the Stocks screen. true forces paper; never escalates to live. */
  paper?: boolean;
};

function normalizeSide(value: unknown): StockTradeSide {
  return String(value || "").trim().toLowerCase() === "sell" ? "sell" : "buy";
}

/**
 * The Alpaca account mode actually used for this request. A client may force
 * PAPER (the safe sandbox), but it can NEVER escalate a paper-only agent to the
 * live brokerage — live is reachable only when the persisted wallet opted in
 * (alpacaPaper === false). Mirrors the client-trust rule in /api/wallet/send.
 */
function resolveEffectivePaper(persistedAlpacaPaper: boolean | undefined, requested: unknown): boolean {
  const persistedPaper = persistedAlpacaPaper !== false; // true = paper-only / default
  if (persistedPaper) return true;
  return typeof requested === "boolean" ? requested : false;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const ledger = await readWalletLedger().catch(() => ({ records: [] }));
  const tradeAgents = ledger.records
    .filter((record) => Boolean(record.wallet?.tradingVenue))
    .map((record) => ({
      agentId: record.agentId,
      agentName: record.agentName,
      venue: record.wallet.tradingVenue,
      // `paper` is the persisted default state; `liveEnabled` says whether the UI
      // toggle may switch this agent to the live brokerage at all.
      paper: record.wallet.alpacaPaper !== false,
      liveEnabled: record.wallet.alpacaPaper === false,
      enabled: record.wallet.enabled !== false,
    }));

  // Check every Alpaca key name in play (live defaults + paper defaults + any
  // per-agent override). Paper falls back to the live keys, so paper is usable
  // when EITHER pair is present; live needs the live pair specifically.
  const alpacaKeys = Array.from(new Set([
    ...ALPACA_LIVE_ENV_NAMES,
    ...ALPACA_PAPER_ENV_NAMES,
    ...ledger.records.flatMap((record) => [record.wallet?.alpacaKeyEnvName, record.wallet?.alpacaSecretEnvName].filter(Boolean) as string[]),
  ]));
  const alpacaPresence = await hiveEnvPresence(alpacaKeys);
  const present = (key: string) => Boolean(alpacaPresence.find((item) => item.key === key)?.present);
  const liveConfigured = ALPACA_LIVE_ENV_NAMES.every(present);
  const paperOwnConfigured = ALPACA_PAPER_ENV_NAMES.every(present);
  const paperConfigured = paperOwnConfigured || liveConfigured;

  return NextResponse.json({
    ok: true,
    confirmations: { buy: BUY_STOCK_CONFIRMATION, sell: SELL_STOCK_CONFIRMATION },
    venues: {
      alpaca: {
        configured: paperConfigured || liveConfigured,
        paper: { configured: paperConfigured, dedicated: paperOwnConfigured, keys: [...ALPACA_PAPER_ENV_NAMES] },
        live: { configured: liveConfigured, keys: [...ALPACA_LIVE_ENV_NAMES] },
        credentials: alpacaPresence,
      },
      xstocks: { supportedTickers: supportedXStockTickers() },
    },
    agents: tradeAgents,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as TradingBody;
    const agentId = body.agentId?.trim();
    const side = normalizeSide(body.side);
    const action = body.action === "execute" ? "execute"
      : body.action === "portfolio" ? "portfolio"
      : body.action === "cancel-order" ? "cancel-order"
      : "quote";
    if (!agentId) return badRequest("An agentId is required to trade.");

    // Authoritative wallet: persisted config only, never a client-supplied policy.
    const loaded = await loadGovernanceWallet(agentId);
    if (!loaded) return NextResponse.json({ ok: false, error: "No wallet is configured for this agent." }, { status: 404 });
    const policy = toBuyStockPolicy(loaded.wallet);
    const paper = resolveEffectivePaper(policy.alpacaPaper, body.paper);

    // Portfolio is a read of the chosen Alpaca account — no ticker, no governance.
    if (action === "portfolio") {
      if (policy.tradingVenue !== "alpaca") {
        return NextResponse.json({ ok: true, portfolio: null, paper, note: "Portfolio view is available for the Alpaca venue. On-chain xStocks positions live in the agent's Solana wallet." });
      }
      const portfolio = await fetchAlpacaPortfolio({ policy, paper });
      return NextResponse.json({ ok: true, portfolio, paper });
    }

    // Cancel an open order — no ticker, reversal of a queued spend.
    if (action === "cancel-order") {
      if (policy.tradingVenue !== "alpaca") return badRequest("Order cancel is only available for the Alpaca venue.");
      const orderId = body.orderId?.trim();
      if (!orderId) return badRequest("An order id is required to cancel.");
      await cancelAlpacaOrder({ policy, paper, orderId });
      return NextResponse.json({ ok: true, canceled: orderId, paper });
    }

    const ticker = body.ticker?.trim();
    if (!ticker) return badRequest("A ticker is required.");
    const notionalUsd = Number(body.notionalUsd) || 0;
    const slippageBps = Number(body.slippageBps) || undefined;

    if (action === "quote") {
      const quote = await discoverStockTradeQuote({ side, policy, ticker, notionalUsd, slippageBps, paper });
      return NextResponse.json({ ok: true, side, paper, quote, confirmation: stockTradeConfirmation(side) });
    }

    // Execute: xStocks uses the agent's local Solana wallet for the swap; live
    // Alpaca uses the local wallet only to collect the HivemindOS platform fee.
    let network: string | undefined;
    let secret: string | undefined;
    let fromAddress: string | undefined;
    if (policy.tradingVenue === "xstocks") {
      const stored = await getWalletSecret(agentId);
      if (!stored) return NextResponse.json({ ok: false, error: "No local Solana wallet exists for this agent." }, { status: 404 });
      network = stored.info.network;
      secret = stored.secret;
      fromAddress = stored.info.address;
    } else if (policy.tradingVenue === "alpaca" && paper === false) {
      const stored = await getWalletSecret(agentId).catch(() => null);
      if (stored) {
        network = stored.info.network;
        secret = stored.secret;
        fromAddress = stored.info.address;
      }
    }

    const result = await executeStockTrade({
      agentId,
      side,
      policy,
      ticker,
      notionalUsd,
      paper,
      qty: Number(body.qty) > 0 ? Number(body.qty) : undefined,
      confirmation: body.confirmation,
      approvalToken: body.approvalToken?.trim() || undefined,
      network,
      secret,
      fromAddress,
      slippageBps,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Governance blocks/escalations and confirmation/cap failures throw with a
    // human-readable reason; surface it so the UI can show the next step.
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Trade failed." }, { status: 400 });
  }
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
