/* adapt-trade.ts — pure mappers that turn the app's REAL payloads (wallet token
   balances, Alpaca portfolio, market rows, the spend-ledger activity feed) into
   the Trade desk's view shapes. No React, no fetching — TradePanel does the I/O
   and calls these. */

import type { DeskActivity, DeskHolding, DeskPortfolio } from "./trade-context";
import type { WalletActivityRecord, CryptoMarketRow, StockMarketRow } from "@/features/dashboard/views/trade/trade-api";
import type { AlpacaPosition, AlpacaPortfolio } from "@/features/dashboard/views/trade/trade-api";

export function truncateAddress(address: string): string {
  const a = (address || "").trim();
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function relativeTime(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function hoursAgo(ms: number, now: number): number {
  return Math.max(0, now - ms) / 3_600_000;
}

// ── activity ─────────────────────────────────────────────────────────────────
const STOCK_TARGET = /^(alpaca|xstocks):/i;

function activityDisplay(record: WalletActivityRecord): { kind: string; text: string; via: string; src: "crypto" | "stocks" } {
  // Guard literal "null"/"undefined" strings (and blanks) from a sparse ledger
  // record so a row never renders the text "null".
  const raw = (record.target || "").trim();
  const target = raw === "null" || raw === "undefined" ? "" : raw;
  const isStockTrade = record.kind === "trade" && STOCK_TARGET.test(target);
  if (isStockTrade) {
    // "alpaca:NVDA buy (paper)" → kind "Buy"/"Sell", text "NVDA buy …", via venue.
    const [venue, rest = ""] = target.split(":");
    const side = /sell/i.test(rest) ? "Sell" : "Buy";
    return { kind: side, text: rest.trim() || "Stock trade", via: venue.toLowerCase() === "xstocks" ? "xStocks" : "Alpaca", src: "stocks" };
  }
  switch (record.kind) {
    case "trade": return { kind: "Swap", text: target || `${record.asset} swap`, via: "DEX", src: "crypto" };
    case "send": return { kind: "Send", text: target ? `Sent to ${target}` : `Sent ${record.asset}`, via: "Base", src: "crypto" };
    case "x402": return { kind: "Pay", text: target ? `Paid ${target}` : "Paid an API", via: "x402", src: "crypto" };
    case "x402-private": return { kind: "Private", text: target ? `Privately paid ${target}` : "Private API pay", via: "Veil", src: "crypto" };
    case "veil-transfer": return { kind: "Private", text: target ? `Private transfer to ${target}` : "Private transfer", via: "Veil", src: "crypto" };
    case "platform-fee": return { kind: "Fee", text: "Platform fee", via: "Platform", src: "crypto" };
    default: return { kind: "Activity", text: target || record.kind, via: record.asset, src: "crypto" };
  }
}

export function mapActivity(records: WalletActivityRecord[], now: number): DeskActivity[] {
  return records.map((record) => {
    const display = activityDisplay(record);
    // Guard the timestamp like the activity route does — a legacy record missing
    // createdAtMs must not render "NaNd" or corrupt the day sort/grouping.
    const ms = Number(record.createdAtMs) || Date.parse(record.createdAt) || now;
    return {
      id: record.id,
      kind: display.kind,
      text: display.text,
      via: display.via,
      wid: record.agentId,
      when: relativeTime(ms, now),
      hrs: hoursAgo(ms, now),
      usd: Number(record.amountUsd) || 0,
      state: record.status === "executed" ? "filled" : record.status === "failed" ? "failed" : String(record.status || "filled"),
      src: display.src,
    };
  });
}

// ── crypto portfolio ─────────────────────────────────────────────────────────
type BalanceToken = { symbol?: string; name?: string; balance?: number; valueUsd?: number | null; priceChange24hPct?: number | null; tokenAddress?: string };

export function cryptoBalancesFrom(tokens: BalanceToken[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const token of tokens) {
    const symbol = String(token.symbol || "").trim();
    if (symbol) map[symbol] = Number(token.balance) || 0;
  }
  return map;
}

export function buildCryptoPortfolio(tokens: BalanceToken[], history: number[]): DeskPortfolio {
  const rows: DeskHolding[] = tokens
    .map((token) => {
      const sym = String(token.symbol || "").trim();
      // Key on the mint/contract — two distinct mints can share a symbol on-chain.
      const id = String(token.tokenAddress || "").trim() || sym;
      return {
        id,
        sym,
        name: String(token.name || token.symbol || "").trim(),
        amount: Number(token.balance) || 0,
        usd: Number(token.valueUsd) || 0,
        chg: Number(token.priceChange24hPct) || 0,
      };
    })
    .filter((row) => row.sym && row.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  const total = rows.reduce((sum, row) => sum + row.usd, 0);
  const dayChange = rows.reduce((sum, row) => sum + (row.usd * row.chg) / 100, 0);
  const dayPct = total - dayChange !== 0 ? (dayChange / (total - dayChange)) * 100 : 0;
  return { rows, total, dayChange, dayPct, history };
}

/**
 * Real crypto portfolio value history: sum, per time-bucket, of each held
 * token's quantity × its price history. Aligns series by index (all are
 * downsampled to a common length upstream) and only includes tokens we actually
 * have a price series for — so it's a real curve, never a synthetic one. Returns
 * [] when no held token has a series.
 */
export function cryptoPortfolioHistory(balances: Record<string, number>, marketRows: CryptoMarketRow[]): number[] {
  // Case-insensitive join: held balances are keyed by the raw on-chain symbol,
  // market rows by the canonical registry key — match either casing.
  const byUpper: Record<string, number> = {};
  for (const [sym, amount] of Object.entries(balances)) byUpper[sym.toUpperCase()] = amount;
  const heldAmount = (sym: string) => balances[sym] || byUpper[sym.toUpperCase()] || 0;
  const series = marketRows
    .filter((row) => heldAmount(row.symbol) > 0 && row.history.length >= 2)
    .map((row) => ({ amount: heldAmount(row.symbol), history: row.history }));
  if (!series.length) return [];
  const length = Math.min(...series.map((s) => s.history.length));
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const s of series) sum += s.amount * s.history[s.history.length - length + i];
    out.push(sum);
  }
  return out;
}

// ── stock portfolio ──────────────────────────────────────────────────────────
export function buildStockPortfolio(portfolio: AlpacaPortfolio | null, snapshotChg: Record<string, number>, equityHistory: number[]): DeskPortfolio {
  const positions: AlpacaPosition[] = portfolio?.positions ?? [];
  const rows: DeskHolding[] = positions
    .map((position) => {
      const chg = snapshotChg[position.symbol];
      return {
        id: position.symbol,
        sym: position.symbol,
        name: position.symbol,
        amount: position.qty,
        shares: position.qty,
        usd: position.marketValue,
        // Prefer the live 24h change; fall back to since-entry P/L% when no snapshot.
        chg: Number.isFinite(chg) ? chg : (position.unrealizedPlPct || 0) * 100,
      };
    })
    .sort((a, b) => b.usd - a.usd);
  const total = portfolio?.account.portfolioValue ?? rows.reduce((sum, row) => sum + row.usd, 0);
  const dayChange = rows.reduce((sum, row) => sum + (row.usd * row.chg) / 100, 0);
  // Base the day % on the invested position total (not account value incl. cash),
  // so a position-level dollar delta isn't diluted by an unrelated cash balance.
  const positionsTotal = rows.reduce((sum, row) => sum + row.usd, 0);
  const dayPct = positionsTotal > 0 ? (dayChange / positionsTotal) * 100 : 0;
  return { rows, total, dayChange, dayPct, history: equityHistory };
}

export function moverFromCrypto(row: CryptoMarketRow) {
  return { sym: row.symbol, name: row.name, price: row.price, chg: row.change24h, history: row.history };
}

export function moverFromStock(row: StockMarketRow, name: string) {
  return { sym: row.symbol, name, price: row.price, chg: row.change24h, history: row.history };
}
