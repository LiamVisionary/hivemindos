import { NextRequest, NextResponse } from "next/server";
import {
  BUY_STOCK_CONFIRMATION,
  SELL_STOCK_CONFIRMATION,
  type StockTradeSide,
  discoverStockTradeQuote,
  executeStockTrade,
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

const DEFAULT_ALPACA_KEYS = ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"] as const;

type TradingBody = {
  action?: "quote" | "execute";
  side?: string;
  agentId?: string;
  ticker?: string;
  notionalUsd?: number;
  qty?: number;
  confirmation?: string;
  approvalToken?: string;
  slippageBps?: number;
};

function normalizeSide(value: unknown): StockTradeSide {
  return String(value || "").trim().toLowerCase() === "sell" ? "sell" : "buy";
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
      paper: record.wallet.alpacaPaper !== false,
      enabled: record.wallet.enabled !== false,
    }));

  // Check every Alpaca key name in play (defaults + any per-agent override).
  const alpacaKeys = Array.from(new Set([
    ...DEFAULT_ALPACA_KEYS,
    ...ledger.records.flatMap((record) => [record.wallet?.alpacaKeyEnvName, record.wallet?.alpacaSecretEnvName].filter(Boolean) as string[]),
  ]));
  const alpacaPresence = await hiveEnvPresence(alpacaKeys);

  return NextResponse.json({
    ok: true,
    confirmations: { buy: BUY_STOCK_CONFIRMATION, sell: SELL_STOCK_CONFIRMATION },
    venues: {
      alpaca: { configured: DEFAULT_ALPACA_KEYS.every((key) => alpacaPresence.find((item) => item.key === key)?.present), credentials: alpacaPresence },
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
    const ticker = body.ticker?.trim();
    const side = normalizeSide(body.side);
    const action = body.action === "execute" ? "execute" : "quote";
    if (!agentId) return badRequest("An agentId is required to trade.");
    if (!ticker) return badRequest("A ticker is required.");

    // Authoritative wallet: persisted config only, never a client-supplied policy.
    const loaded = await loadGovernanceWallet(agentId);
    if (!loaded) return NextResponse.json({ ok: false, error: "No wallet is configured for this agent." }, { status: 404 });
    const policy = toBuyStockPolicy(loaded.wallet);
    const notionalUsd = Number(body.notionalUsd) || 0;
    const slippageBps = Number(body.slippageBps) || undefined;

    if (action === "quote") {
      const quote = await discoverStockTradeQuote({ side, policy, ticker, notionalUsd, slippageBps });
      return NextResponse.json({ ok: true, side, quote, confirmation: stockTradeConfirmation(side) });
    }

    // Execute: xStocks needs the agent's local Solana wallet secret.
    let network: string | undefined;
    let secret: string | undefined;
    if (policy.tradingVenue === "xstocks") {
      const stored = await getWalletSecret(agentId);
      if (!stored) return NextResponse.json({ ok: false, error: "No local Solana wallet exists for this agent." }, { status: 404 });
      network = stored.info.network;
      secret = stored.secret;
    }

    const result = await executeStockTrade({
      agentId,
      side,
      policy,
      ticker,
      notionalUsd,
      qty: Number(body.qty) > 0 ? Number(body.qty) : undefined,
      confirmation: body.confirmation,
      approvalToken: body.approvalToken?.trim() || undefined,
      network,
      secret,
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
