import type {
  PennyStockExecutionEvidence,
  PennyStockQuote,
} from "./types";

const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2/stocks";

type FetchLike = typeof fetch;

export async function fetchQuoteExecutionEvidence(input: {
  symbols: Array<{ symbol: string; priceUsd: number }>;
  asOf: Date;
  alpacaHeaders: Record<string, string>;
  fetchFn?: FetchLike;
}): Promise<Record<string, {
  evidence: PennyStockExecutionEvidence;
  quotes: PennyStockQuote[];
}>> {
  const fetchFn = input.fetchFn ?? fetch;
  const start = new Date(input.asOf.getTime() - 7 * 86_400_000);
  const delayedEnd = new Date(input.asOf.getTime() - 20 * 60_000);
  const entries = await mapWithConcurrency(input.symbols, 3, async (row) => {
    const quotes = await fetchHistoricalQuotes({
      symbol: row.symbol,
      start,
      end: delayedEnd,
      headers: input.alpacaHeaders,
      fetchFn,
    });
    return [row.symbol, {
      quotes,
      evidence: summarizeQuoteExecution(quotes, row.priceUsd),
    }] as const;
  });
  return Object.fromEntries(entries);
}

export function summarizeQuoteExecution(
  quotes: PennyStockQuote[],
  referencePriceUsd: number,
): PennyStockExecutionEvidence {
  const valid = quotes.filter((quote) =>
    quote.bidPriceUsd > 0
    && quote.askPriceUsd >= quote.bidPriceUsd
    && quote.bidSize >= 0
    && quote.askSize >= 0
  );
  if (!valid.length) return fallbackExecutionEvidence();
  const spreads = valid.map((quote) => {
    const midpoint = (quote.bidPriceUsd + quote.askPriceUsd) / 2;
    return midpoint > 0 ? ((quote.askPriceUsd - quote.bidPriceUsd) / midpoint) * 10_000 : 0;
  });
  const bidSizes = valid.map((quote) => quote.bidSize);
  const askSizes = valid.map((quote) => quote.askSize);
  const requestedShares = referencePriceUsd > 0 ? 100 / referencePriceUsd : Number.POSITIVE_INFINITY;
  const conservativeDisplayedShares = percentile(askSizes, 0.25) * 0.1;
  const estimatedFillRatioPct = requestedShares > 0
    ? Math.min(100, conservativeDisplayedShares / requestedShares * 100)
    : 0;
  return {
    quoteObservations: valid.length,
    quoteStartAt: valid[0].timestamp,
    quoteEndAt: valid.at(-1)?.timestamp ?? valid[0].timestamp,
    medianSpreadBps: round(percentile(spreads, 0.5), 4),
    p90SpreadBps: round(percentile(spreads, 0.9), 4),
    medianBidSize: round(percentile(bidSizes, 0.5), 4),
    medianAskSize: round(percentile(askSizes, 0.5), 4),
    estimatedFillRatioPct: round(estimatedFillRatioPct, 4),
    displayedSizeParticipationPct: 10,
    queuePriorityKnown: false,
    source: "alpaca-sip-quotes",
  };
}

export function fallbackExecutionEvidence(): PennyStockExecutionEvidence {
  return {
    quoteObservations: 0,
    quoteStartAt: null,
    quoteEndAt: null,
    medianSpreadBps: null,
    p90SpreadBps: null,
    medianBidSize: null,
    medianAskSize: null,
    estimatedFillRatioPct: 25,
    displayedSizeParticipationPct: 0,
    queuePriorityKnown: false,
    source: "daily-bar-fallback",
  };
}

async function fetchHistoricalQuotes(input: {
  symbol: string;
  start: Date;
  end: Date;
  headers: Record<string, string>;
  fetchFn: FetchLike;
}): Promise<PennyStockQuote[]> {
  const url = new URL(
    `${ALPACA_DATA_BASE}/${encodeURIComponent(input.symbol)}/quotes`,
  );
  url.searchParams.set("start", input.start.toISOString());
  url.searchParams.set("end", input.end.toISOString());
  url.searchParams.set("limit", "10000");
  url.searchParams.set("feed", "sip");
  url.searchParams.set("sort", "desc");
  const response = await input.fetchFn(url, {
    headers: input.headers,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) return [];
  const body = await response.json().catch(() => null) as unknown;
  if (!isRecord(body) || !Array.isArray(body.quotes)) return [];
  return body.quotes
    .map(normalizeAlpacaQuote)
    .filter((quote): quote is PennyStockQuote => quote !== null)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function normalizeAlpacaQuote(value: unknown): PennyStockQuote | null {
  if (!isRecord(value)) return null;
  const quote = {
    timestamp: String(value.t ?? ""),
    bidPriceUsd: Number(value.bp),
    askPriceUsd: Number(value.ap),
    bidSize: Number(value.bs),
    askSize: Number(value.as),
  };
  if (
    !quote.timestamp
    || ![
      quote.bidPriceUsd,
      quote.askPriceUsd,
      quote.bidSize,
      quote.askSize,
    ].every((number) => Number.isFinite(number) && number >= 0)
  ) return null;
  return quote;
}

function percentile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

async function mapWithConcurrency<T, U>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await task(values[index]);
      }
    }),
  );
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
