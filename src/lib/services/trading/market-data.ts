/* market-data.ts — real crypto market data for the Trade desk (movers strip +
   sparklines), with no placeholders. Majors resolve from CoinGecko (price, 24h
   change, price history); on-chain Base tokens (e.g. HIVE) resolve from
   DexScreener (price + 24h) and GeckoTerminal pool OHLCV (history). Everything is
   server-side only and short-cached so the movers strip + portfolio sparkline
   don't hammer the free APIs. */

import net from "node:net";

// Node's default happy-eyeballs per-attempt connect timeout (250ms) is shorter
// than the TCP handshake to several of these hosts on some networks, so reads
// silently ETIMEDOUT. Mirror the dex-swap rail and widen it.
(net as unknown as { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void })
  .setDefaultAutoSelectFamilyAttemptTimeout?.(3000);

export type CryptoMarketRange = "24h" | "7d" | "30d";

export type CryptoMarketRow = {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  /** Close-price series oldest→newest for the requested range (USD). */
  history: number[];
  source: "defillama" | "coingecko" | "geckoterminal" | "dexscreener";
};

type Registry = { name: string; cg?: string; base?: string };

// Symbol → data source. `cg` = CoinGecko coin id; `base` = Base ERC-20 address.
// HIVE address is the canonical one from the DEX swap rail (BASE_TOKENS).
const CRYPTO_REGISTRY: Record<string, Registry> = {
  BTC: { name: "Bitcoin", cg: "bitcoin" },
  cbBTC: { name: "Coinbase BTC", cg: "bitcoin" },
  WBTC: { name: "Wrapped BTC", cg: "bitcoin" },
  ETH: { name: "Ethereum", cg: "ethereum" },
  WETH: { name: "Wrapped Ether", cg: "weth" },
  SOL: { name: "Solana", cg: "solana" },
  HYPE: { name: "Hyperliquid", cg: "hyperliquid" },
  USDC: { name: "USD Coin", cg: "usd-coin" },
  USDT: { name: "Tether", cg: "tether" },
  HIVE: { name: "Hive", base: "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3" },
};

const RANGE_DAYS: Record<CryptoMarketRange, number> = { "24h": 1, "7d": 7, "30d": 30 };
const RANGE_GT: Record<CryptoMarketRange, { tf: "hour" | "day"; aggregate: number; limit: number }> = {
  "24h": { tf: "hour", aggregate: 1, limit: 24 },
  "7d": { tf: "hour", aggregate: 4, limit: 42 },
  "30d": { tf: "day", aggregate: 1, limit: 30 },
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
  // Expired entries are otherwise only dropped on a same-key re-read, so
  // one-off symbol/range keys would accumulate for the process lifetime.
  if (cache.size >= 256) {
    const now = Date.now();
    for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
    while (cache.size >= 256) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

async function getJsonOnce<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal }).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as T | null;
  } finally {
    clearTimeout(timeout);
  }
}

// One retry after a short backoff — covers the transient connect ETIMEDOUT this
// dev network hits, without hammering a genuinely-rate-limited host.
async function getJson<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const first = await getJsonOnce<T>(url, timeoutMs);
  if (first != null) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return getJsonOnce<T>(url, timeoutMs);
}

// ── CoinGecko (majors) ───────────────────────────────────────────────────────
type CgSimplePrice = Record<string, { usd?: number; usd_24h_change?: number }>;
type CgMarketChart = { prices?: Array<[number, number]> };

async function coingeckoPrices(ids: string[]): Promise<CgSimplePrice> {
  if (!ids.length) return {};
  const key = `cg:price:${[...ids].sort().join(",")}`;
  const hit = cached<CgSimplePrice>(key);
  if (hit) return hit;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=usd&include_24hr_change=true`;
  const data = (await getJson<CgSimplePrice>(url)) ?? {};
  setCache(key, data, 60_000);
  return data;
}

async function coingeckoHistory(id: string, range: CryptoMarketRange): Promise<number[]> {
  const key = `cg:hist:${id}:${range}`;
  const hit = cached<number[]>(key);
  if (hit) return hit;
  const days = RANGE_DAYS[range];
  const interval = days <= 1 ? "" : "&interval=daily";
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}${interval}`;
  const data = await getJson<CgMarketChart>(url, 9000);
  const series = Array.isArray(data?.prices) ? data!.prices.map(([, price]) => Number(price)).filter((n) => Number.isFinite(n)) : [];
  const trimmed = downsample(series, 32);
  if (trimmed.length) setCache(key, trimmed, 5 * 60_000);
  return trimmed;
}

// ── DefiLlama (majors — primary; CoinGecko free tier is rate-limited) ────────
// DefiLlama's coins API aggregates many sources (incl. CoinGecko) with far more
// generous free limits and no key, so it's the primary price/24h/history source
// for the majors; CoinGecko stays as a fallback for ids DefiLlama doesn't carry.
const DEFILLAMA = "https://coins.llama.fi";
const RANGE_DL: Record<CryptoMarketRange, { span: number; period: string }> = {
  "24h": { span: 24, period: "1h" },
  "7d": { span: 42, period: "4h" },
  "30d": { span: 30, period: "1d" },
};

type DlPrice = { price?: number };
type DlPriceResponse = { coins?: Record<string, DlPrice> };
type DlPctResponse = { coins?: Record<string, number> };
type DlChartResponse = { coins?: Record<string, { prices?: Array<{ price?: number }> }> };

async function defillamaPrices(ids: string[]): Promise<Record<string, { usd: number; change24h: number }>> {
  if (!ids.length) return {};
  const key = `dl:price:${[...ids].sort().join(",")}`;
  const hit = cached<Record<string, { usd: number; change24h: number }>>(key);
  if (hit) return hit;
  const coins = ids.map((id) => `coingecko:${id}`).join(",");
  const [priceRes, pctRes] = await Promise.all([
    getJson<DlPriceResponse>(`${DEFILLAMA}/prices/current/${coins}`),
    getJson<DlPctResponse>(`${DEFILLAMA}/percentage/${coins}?period=24h`),
  ]);
  const prices = priceRes?.coins ?? {};
  const pct = pctRes?.coins ?? {};
  const out: Record<string, { usd: number; change24h: number }> = {};
  for (const id of ids) {
    const entry = prices[`coingecko:${id}`];
    if (entry && typeof entry.price === "number") {
      out[id] = { usd: entry.price, change24h: Number(pct[`coingecko:${id}`]) || 0 };
    }
  }
  if (Object.keys(out).length) setCache(key, out, 60_000);
  return out;
}

async function defillamaHistory(id: string, range: CryptoMarketRange): Promise<number[]> {
  const key = `dl:hist:${id}:${range}`;
  const hit = cached<number[]>(key);
  if (hit) return hit;
  const { span, period } = RANGE_DL[range];
  const data = await getJson<DlChartResponse>(`${DEFILLAMA}/chart/coingecko:${id}?span=${span}&period=${period}`, 9000);
  const prices = data?.coins?.[`coingecko:${id}`]?.prices ?? [];
  const series = prices.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
  const trimmed = downsample(series, 32);
  if (trimmed.length) setCache(key, trimmed, 5 * 60_000);
  return trimmed;
}

// ── DexScreener + GeckoTerminal (on-chain Base tokens) ───────────────────────
type DexPair = { chainId?: string; pairAddress?: string; priceUsd?: string; priceChange?: { h24?: number | string }; liquidity?: { usd?: number }; baseToken?: { address?: string; name?: string; symbol?: string } };
type GtOhlcv = { data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } } };

async function dexscreenerToken(address: string): Promise<{ price: number; change24h: number; name: string; pool?: string } | null> {
  const key = `ds:tok:${address.toLowerCase()}`;
  const hit = cached<{ price: number; change24h: number; name: string; pool?: string }>(key);
  if (hit) return hit;
  const pairs = (await getJson<DexPair[]>(`https://api.dexscreener.com/token-pairs/v1/base/${encodeURIComponent(address)}`, 6000)) ?? [];
  const best = pairs
    .filter((p) => p.chainId === "base" && Number(p.priceUsd) > 0)
    // Deepest-liquidity pool is the canonical price source — a thin/stale pool
    // can report a higher spot than the real market, so never sort by price.
    .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
  if (!best) return null;
  const value = {
    price: Number(best.priceUsd) || 0,
    change24h: Number(best.priceChange?.h24) || 0,
    name: best.baseToken?.name || best.baseToken?.symbol || "Token",
    pool: best.pairAddress,
  };
  setCache(key, value, 60_000);
  return value;
}

async function geckoterminalHistory(pool: string, range: CryptoMarketRange): Promise<number[]> {
  const key = `gt:hist:${pool}:${range}`;
  const hit = cached<number[]>(key);
  if (hit) return hit;
  const { tf, aggregate, limit } = RANGE_GT[range];
  const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${encodeURIComponent(pool)}/ohlcv/${tf}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  const data = await getJson<GtOhlcv>(url, 9000);
  const list = data?.data?.attributes?.ohlcv_list ?? [];
  // ohlcv rows are [timestamp, open, high, low, close, volume], newest-first.
  const series = [...list].reverse().map((row) => Number(row[4])).filter((n) => Number.isFinite(n));
  const trimmed = downsample(series, 32);
  if (trimmed.length) setCache(key, trimmed, 5 * 60_000);
  return trimmed;
}

function downsample(series: number[], target: number): number[] {
  if (series.length <= target) return series;
  const step = series.length / target;
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(series[Math.floor(i * step)]);
  out.push(series[series.length - 1]);
  return out;
}

// ── public API ───────────────────────────────────────────────────────────────
/** Symbols this service can resolve to real market data (movers default + extras). */
export function knownCryptoMarketSymbols(): string[] {
  return Object.keys(CRYPTO_REGISTRY);
}

/**
 * Real market rows (price, 24h change, price-history series) for the requested
 * symbols. Unknown/unresolvable symbols are dropped rather than faked, so the
 * caller only ever renders live numbers.
 */
export async function fetchCryptoMarket(symbols: string[], range: CryptoMarketRange = "24h"): Promise<CryptoMarketRow[]> {
  const wanted = uniqueUpper(symbols).filter((s) => CRYPTO_REGISTRY[s] || CRYPTO_REGISTRY[canonical(s)]);
  if (!wanted.length) return [];

  // Price the majors via DefiLlama (batch); fall back to CoinGecko only for ids
  // DefiLlama didn't return (e.g. a brand-new listing).
  const cgIds = uniqueStrings(wanted.map((s) => reg(s).cg).filter(Boolean) as string[]);
  const dlPrices = cgIds.length ? await defillamaPrices(cgIds) : {};
  const cgMissing = cgIds.filter((id) => !dlPrices[id]);
  const cgPrices = cgMissing.length ? await coingeckoPrices(cgMissing) : {};

  const rows = await Promise.all(wanted.map(async (symbol): Promise<CryptoMarketRow | null> => {
    const r = reg(symbol);
    if (r.cg) {
      const dl = dlPrices[r.cg];
      const cg = cgPrices[r.cg];
      const usd = dl ? dl.usd : (typeof cg?.usd === "number" ? cg.usd : null);
      if (usd == null) return null;
      const change24h = dl ? dl.change24h : (Number(cg?.usd_24h_change) || 0);
      // History from DefiLlama; fall back to CoinGecko if it returns nothing.
      let history = await defillamaHistory(r.cg, range);
      if (!history.length) history = await coingeckoHistory(r.cg, range);
      return { symbol, name: r.name, price: usd, change24h, history, source: dl ? "defillama" : "coingecko" };
    }
    if (r.base) {
      const tok = await dexscreenerToken(r.base);
      if (!tok) return null;
      const history = tok.pool ? await geckoterminalHistory(tok.pool, range) : [];
      return { symbol, name: r.name || tok.name, price: tok.price, change24h: tok.change24h, history, source: history.length ? "geckoterminal" : "dexscreener" };
    }
    return null;
  }));

  return rows.filter((row): row is CryptoMarketRow => row !== null);
}

function canonical(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (CRYPTO_REGISTRY[symbol]) return symbol;
  // case-insensitive match (cbBTC etc.)
  const match = Object.keys(CRYPTO_REGISTRY).find((k) => k.toUpperCase() === upper);
  return match ?? symbol;
}
function reg(symbol: string): Registry {
  return CRYPTO_REGISTRY[symbol] ?? CRYPTO_REGISTRY[canonical(symbol)] ?? { name: symbol };
}
function uniqueUpper(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const c = canonical(String(v || "").trim());
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
