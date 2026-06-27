/* alpaca-data.ts — real equities market data for the Trade desk: per-ticker last
   price + 24h change (snapshots), price-history sparklines (bars), and the live
   account-value history that drives the stock portfolio sparkline. Reads the
   Alpaca Market Data API (data.alpaca.markets, free IEX feed) and the account
   portfolio-history endpoint with the same shared-hive Alpaca keys the trade rail
   already uses. Server-side only, short-cached. No placeholders. */

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { ALPACA_LIVE_ENV_NAMES, ALPACA_PAPER_ENV_NAMES } from "@/lib/services/trading/buy-stock";

export type StockMarketRange = "24h" | "7d" | "30d";

export type StockMarketRow = {
  symbol: string;
  price: number;
  change24h: number;
  /** Close-price series oldest→newest for the requested range (USD). */
  history: number[];
};

const DATA_BASE = "https://data.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const PAPER_BASE = "https://paper-api.alpaca.markets";

const RANGE_BARS: Record<StockMarketRange, { timeframe: string; limit: number; lookbackMs: number }> = {
  // lookbackMs is padded past the nominal window so a weekend/holiday (no IEX
  // bars) still returns a populated series rather than collapsing to a point.
  "24h": { timeframe: "1Hour", limit: 200, lookbackMs: 4 * 24 * 3_600_000 },
  "7d": { timeframe: "1Hour", limit: 200, lookbackMs: 9 * 24 * 3_600_000 },
  "30d": { timeframe: "1Day", limit: 60, lookbackMs: 38 * 24 * 3_600_000 },
};

// ── tiny TTL cache ───────────────────────────────────────────────────────────
type CacheEntry<T> = { value: T; expires: number };
const cache = new Map<string, CacheEntry<unknown>>();
function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (hit) cache.delete(key);
  return null;
}
function setCache<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

async function firstPresentEnv(names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    const value = await hiveEnvValue(name);
    if (value) return value;
  }
  return null;
}

/**
 * Resolve a usable Alpaca key pair for market data. Paper tries its own keys
 * first, then falls back to the live/default pair (which is also what the data
 * API accepts); live uses only the live pair. Returns null when neither is set —
 * the caller surfaces "set Alpaca keys" rather than faking a chart.
 */
async function resolveDataCreds(paper: boolean): Promise<{ apiKey: string; apiSecret: string } | null> {
  const keyNames = paper ? [ALPACA_PAPER_ENV_NAMES[0], ALPACA_LIVE_ENV_NAMES[0]] : [ALPACA_LIVE_ENV_NAMES[0]];
  const secretNames = paper ? [ALPACA_PAPER_ENV_NAMES[1], ALPACA_LIVE_ENV_NAMES[1]] : [ALPACA_LIVE_ENV_NAMES[1]];
  const [apiKey, apiSecret] = await Promise.all([firstPresentEnv(keyNames), firstPresentEnv(secretNames)]);
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

function authHeaders(creds: { apiKey: string; apiSecret: string }) {
  return { "APCA-API-KEY-ID": creds.apiKey, "APCA-API-SECRET-KEY": creds.apiSecret, accept: "application/json" };
}

async function getJson<T>(url: string, creds: { apiKey: string; apiSecret: string }, timeoutMs = 9000): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", headers: authHeaders(creds), signal: controller.signal }).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as T | null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── snapshots: last price + 24h change ───────────────────────────────────────
type AlpacaSnapshot = {
  latestTrade?: { p?: number };
  dailyBar?: { c?: number; o?: number };
  prevDailyBar?: { c?: number };
};
type SnapshotsResponse = Record<string, AlpacaSnapshot>;

function rowFromSnapshot(symbol: string, snap: AlpacaSnapshot | undefined): { symbol: string; price: number; change24h: number } | null {
  if (!snap) return null;
  const price = Number(snap.latestTrade?.p) || Number(snap.dailyBar?.c) || Number(snap.prevDailyBar?.c) || 0;
  if (!price) return null;
  const prevClose = Number(snap.prevDailyBar?.c) || 0;
  const change24h = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  return { symbol, price, change24h };
}

async function fetchSnapshots(symbols: string[], paper: boolean): Promise<Record<string, { symbol: string; price: number; change24h: number }>> {
  const creds = await resolveDataCreds(paper);
  if (!creds || !symbols.length) return {};
  const key = `alp:snap:${[...symbols].sort().join(",")}`;
  const hit = cached<Record<string, { symbol: string; price: number; change24h: number }>>(key);
  if (hit) return hit;
  const url = `${DATA_BASE}/v2/stocks/snapshots?symbols=${symbols.map(encodeURIComponent).join(",")}&feed=iex`;
  const data = (await getJson<SnapshotsResponse>(url, creds)) ?? {};
  const out: Record<string, { symbol: string; price: number; change24h: number }> = {};
  for (const symbol of symbols) {
    const row = rowFromSnapshot(symbol, data[symbol]);
    if (row) out[symbol] = row;
  }
  setCache(key, out, 60_000);
  return out;
}

// ── bars: price history (sparkline) ──────────────────────────────────────────
type BarsResponse = { bars?: Array<{ c?: number }> };

async function fetchBars(symbol: string, range: StockMarketRange, paper: boolean): Promise<number[]> {
  const creds = await resolveDataCreds(paper);
  if (!creds) return [];
  const key = `alp:bars:${symbol}:${range}`;
  const hit = cached<number[]>(key);
  if (hit) return hit;
  const { timeframe, limit, lookbackMs } = RANGE_BARS[range];
  // `start` is required — without it Alpaca only returns bars from the current
  // day (so a sparkline collapses to a point, or empties on a non-trading day).
  const startIso = new Date(Date.now() - lookbackMs).toISOString();
  const url = `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&start=${encodeURIComponent(startIso)}&limit=${limit}&feed=iex&sort=asc&adjustment=raw`;
  const data = await getJson<BarsResponse>(url, creds);
  // oldest→newest already (sort=asc); keep the most recent points for the spark.
  const series = (data?.bars ?? []).map((bar) => Number(bar.c)).filter((n) => Number.isFinite(n)).slice(-48);
  if (series.length) setCache(key, series, 5 * 60_000);
  return series;
}

/**
 * Real market rows for the requested equities. `withHistory` additionally pulls
 * the bar series for each symbol (one extra call per symbol) — use it for the
 * small movers strip, not for long lists. Symbols Alpaca can't price are dropped.
 */
export async function fetchStockMarket(symbols: string[], opts: { paper: boolean; range?: StockMarketRange; withHistory?: boolean }): Promise<StockMarketRow[]> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return [];
  const range = opts.range ?? "24h";
  const snapshots = await fetchSnapshots(wanted, opts.paper);
  const rows = await Promise.all(wanted.map(async (symbol): Promise<StockMarketRow | null> => {
    const snap = snapshots[symbol];
    if (!snap) return null;
    const history = opts.withHistory ? await fetchBars(symbol, range, opts.paper) : [];
    return { symbol, price: snap.price, change24h: snap.change24h, history };
  }));
  return rows.filter((row): row is StockMarketRow => row !== null);
}

// ── account portfolio value history (stock portfolio sparkline) ──────────────
type PortfolioHistoryResponse = { equity?: Array<number | null>; timestamp?: number[] };

const HISTORY_PARAMS: Record<StockMarketRange, string> = {
  "24h": "period=1D&timeframe=1H",
  "7d": "period=1W&timeframe=1H",
  "30d": "period=1M&timeframe=1D",
};

/**
 * Real account-equity history for the chosen Alpaca account (paper/live). Drives
 * the stock portfolio sparkline. Returns [] when keys are missing or the account
 * has no history yet (a fresh paper account) — the caller hides the chart rather
 * than inventing one.
 */
export async function fetchAlpacaEquityHistory(paper: boolean, range: StockMarketRange = "30d"): Promise<number[]> {
  const creds = await resolveDataCreds(paper);
  if (!creds) return [];
  const key = `alp:eqhist:${paper ? "paper" : "live"}:${range}`;
  const hit = cached<number[]>(key);
  if (hit) return hit;
  const base = paper ? PAPER_BASE : LIVE_BASE;
  const url = `${base}/v2/account/portfolio/history?${HISTORY_PARAMS[range]}&intraday_reporting=market_hours`;
  const data = await getJson<PortfolioHistoryResponse>(url, creds);
  const series = (data?.equity ?? []).map((value) => Number(value)).filter((n) => Number.isFinite(n) && n > 0);
  if (series.length) setCache(key, series, 5 * 60_000);
  return series;
}
