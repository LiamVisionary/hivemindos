import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/utils/server-auth";
import { fetchCryptoMarket, type CryptoMarketRange } from "@/lib/services/trading/market-data";
import { fetchStockMarket, fetchAlpacaEquityHistory, type StockMarketRange } from "@/lib/services/trading/alpaca-data";
import { fetchFxRates } from "@/lib/services/trading/fx-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only market-data surface for the Trade desk: real crypto + equities
 * prices / 24h change / price-history sparklines, the live Alpaca account-value
 * history, and USD→currency FX rates. No money moves through here — it only
 * feeds the movers strip, portfolio sparkline, and currency toggle with live
 * data (no placeholders). Same-origin auth, same as the other dashboard routes.
 */

type MarketBody = {
  kind?: "crypto" | "stock" | "stock-equity" | "fx";
  symbols?: unknown;
  range?: string;
  paper?: boolean;
  withHistory?: boolean;
};

function normalizeRange(value: unknown): CryptoMarketRange & StockMarketRange {
  return value === "7d" || value === "30d" ? value : "24h";
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 40);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as MarketBody;
    const kind = body.kind;

    if (kind === "fx") {
      const fx = await fetchFxRates();
      if (!fx) return NextResponse.json({ ok: true, rates: { USD: 1 }, source: "none", updatedAt: Date.now() });
      return NextResponse.json({ ok: true, rates: fx.rates, source: fx.source, updatedAt: fx.updatedAt });
    }

    if (kind === "crypto") {
      const rows = await fetchCryptoMarket(normalizeSymbols(body.symbols), normalizeRange(body.range));
      return NextResponse.json({ ok: true, rows });
    }

    if (kind === "stock") {
      const rows = await fetchStockMarket(normalizeSymbols(body.symbols), {
        paper: body.paper !== false,
        range: normalizeRange(body.range),
        withHistory: body.withHistory !== false,
      });
      return NextResponse.json({ ok: true, rows });
    }

    if (kind === "stock-equity") {
      const history = await fetchAlpacaEquityHistory(body.paper !== false, normalizeRange(body.range));
      return NextResponse.json({ ok: true, history });
    }

    return NextResponse.json({ ok: false, error: "Unknown market-data kind." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Market data unavailable." }, { status: 502 });
  }
}
