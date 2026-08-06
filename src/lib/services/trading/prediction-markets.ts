/**
 * Public/read-only prediction-market domain service.
 *
 * The normalized Event -> Market -> Outcome shape is adapted from PMXT's MIT
 * unified schema. Activity grouping is adapted from collectmarkets2 (MIT);
 * calibration metrics are translated from Jon-Becker/prediction-market-analysis
 * (MIT); weather bucket math is translated from hermes_weatherbot (MIT).
 */

export const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB_API = "https://clob.polymarket.com";
export const POLYMARKET_DATA_API = "https://data-api.polymarket.com";
export const POLYMARKET_ORIGIN = "https://polymarket.com";

export type PredictionOutcome = {
  id: string;
  marketId: string;
  label: string;
  price: number;
};

export type PredictionFeeSchedule = {
  rate: number;
  exponent: number;
  takerOnly: boolean;
  rebateRate: number;
};

export type PredictionMarket = {
  id: string;
  conditionId: string;
  eventId?: string;
  title: string;
  description: string;
  slug: string;
  url: string;
  image?: string;
  outcomes: PredictionOutcome[];
  resolutionDate?: string;
  volume24h: number;
  volume: number;
  liquidity: number;
  spread?: number;
  priceChange24h?: number;
  category?: string;
  tags: string[];
  status: "active" | "closed";
  acceptingOrders: boolean;
  restricted: boolean;
  feesEnabled: boolean;
  feeSchedule?: PredictionFeeSchedule;
  minimumOrderSize: number;
  minimumTickSize: number;
  negRisk: boolean;
  negativeRiskMarketId?: string;
  negativeRiskOther: boolean;
  groupItemTitle?: string;
  resolutionSource?: string;
  rewardsMinSize: number;
  rewardsMaxSpread: number;
};

export type PredictionEvent = {
  id: string;
  title: string;
  description: string;
  slug: string;
  url: string;
  image?: string;
  category?: string;
  tags: string[];
  volume24h: number;
  volume: number;
  liquidity: number;
  endDate?: string;
  negRisk: boolean;
  enableNegRisk: boolean;
  negRiskAugmented: boolean;
  markets: PredictionMarket[];
};

export type PredictionOrderLevel = { price: number; size: number };

export type PredictionOrderBook = {
  outcomeId: string;
  bids: PredictionOrderLevel[];
  asks: PredictionOrderLevel[];
  midpoint: number | null;
  spread: number | null;
  timestamp?: string;
  hash?: string;
  minimumOrderSize: number;
  tickSize: number;
};

export type PredictionPricePoint = { timestamp: number; price: number };

export type PredictionPosition = {
  conditionId: string;
  outcomeId: string;
  title: string;
  slug: string;
  outcome: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
};

export type PredictionActivity = {
  id: string;
  timestamp: number;
  type: string;
  side?: "BUY" | "SELL";
  conditionId?: string;
  outcomeId?: string;
  title?: string;
  slug?: string;
  outcome?: string;
  size: number;
  usdcSize: number;
  price: number;
};

export type PredictionTraderProfile = {
  address: string;
  positions: PredictionPosition[];
  activity: PredictionActivity[];
  metrics: {
    tradeCount: number;
    marketCount: number;
    totalNotionalUsd: number;
    buyNotionalUsd: number;
    sellNotionalUsd: number;
    currentValueUsd: number;
    cashPnlUsd: number;
    weightedReturnPercent: number;
    largestPositionPercent: number;
  };
};

export type PredictionPaperOrder = {
  id: string;
  createdAt: string;
  marketId: string;
  conditionId: string;
  outcomeId: string;
  title: string;
  outcome: string;
  side: "buy" | "sell";
  requestedPrice: number;
  fillPrice: number;
  shares: number;
  notionalUsd: number;
  feeUsd: number;
  status: "filled";
};

export type PredictionComplementPaperFill = {
  shares: number;
  firstAveragePrice: number;
  secondAveragePrice: number;
  grossCostUsd: number;
  feeUsd: number;
  capitalUsd: number;
  payoutUsd: number;
  pnlUsd: number;
  roi: number;
};

export type PredictionComplementArbitrageQuote = {
  observedAt: string;
  marketId: string;
  conditionId: string;
  title: string;
  slug: string;
  intervalMinutes?: 5 | 15;
  outcomeLabels: [string, string];
  outcomeIds: [string, string];
  bestAsks: [number | null, number | null];
  bestCombinedAsk: number | null;
  rawEdgePerShare: number | null;
  takerFeePerShare: number | null;
  netEdgePerShare: number | null;
  snapshotSkewMs: number | null;
  bankrollUsd: number;
  decision: "paper-filled" | "rejected";
  reason: string;
  paperFill: PredictionComplementPaperFill | null;
};

export type PredictionCalibration = {
  samples: number;
  brierScore: number;
  logLoss: number;
  expectedCalibrationError: number;
  buckets: Array<{ lower: number; upper: number; samples: number; forecast: number; observed: number }>;
};

type Fetcher = typeof fetch;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function numberArray(value: unknown): number[] {
  return stringArray(value).map((item) => numberValue(item));
}

function tagsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).map((item) => stringValue(item.label || item.name)).filter(Boolean);
}

function feeScheduleFrom(value: unknown): PredictionFeeSchedule | undefined {
  const raw = record(value);
  const rate = numberValue(raw.rate, -1);
  const exponent = numberValue(raw.exponent, -1);
  if (rate < 0 || exponent < 0) return undefined;
  return {
    rate,
    exponent,
    takerOnly: booleanValue(raw.takerOnly),
    rebateRate: Math.max(0, numberValue(raw.rebateRate)),
  };
}

function mapMarket(value: unknown, event?: PredictionEvent): PredictionMarket | null {
  const raw = record(value);
  const id = stringValue(raw.id);
  const conditionId = stringValue(raw.conditionId);
  const title = stringValue(raw.question || raw.title);
  if (!id || !title) return null;
  const labels = stringArray(raw.outcomes);
  const prices = numberArray(raw.outcomePrices);
  const tokenIds = stringArray(raw.clobTokenIds);
  const slug = stringValue(raw.slug);
  return {
    id,
    conditionId,
    eventId: event?.id,
    title,
    description: stringValue(raw.description),
    slug,
    url: slug ? `${POLYMARKET_ORIGIN}/event/${slug}` : POLYMARKET_ORIGIN,
    image: stringValue(raw.image || raw.icon) || event?.image,
    outcomes: labels.map((label, index) => ({
      id: tokenIds[index] || `${conditionId || id}:${index}`,
      marketId: id,
      label,
      price: Math.min(1, Math.max(0, prices[index] ?? 0)),
    })),
    resolutionDate: stringValue(raw.endDate || raw.endDateIso) || undefined,
    volume24h: numberValue(raw.volume24hr || raw.volume24hrClob),
    volume: numberValue(raw.volume || raw.volumeNum || raw.volumeClob),
    liquidity: numberValue(raw.liquidity || raw.liquidityNum || raw.liquidityClob),
    spread: raw.spread == null ? undefined : numberValue(raw.spread),
    priceChange24h: raw.oneDayPriceChange == null ? undefined : numberValue(raw.oneDayPriceChange),
    category: event?.category,
    tags: event?.tags ?? [],
    status: booleanValue(raw.closed) ? "closed" : "active",
    acceptingOrders: booleanValue(raw.acceptingOrders),
    restricted: booleanValue(raw.restricted) || event?.markets.some((market) => market.restricted) === true,
    feesEnabled: booleanValue(raw.feesEnabled),
    feeSchedule: feeScheduleFrom(raw.feeSchedule),
    minimumOrderSize: Math.max(0, numberValue(raw.orderMinSize)),
    minimumTickSize: Math.max(0, numberValue(raw.orderPriceMinTickSize, 0.01)),
    negRisk: booleanValue(raw.negRisk),
    negativeRiskMarketId: stringValue(raw.negRiskMarketID) || undefined,
    negativeRiskOther: booleanValue(raw.negRiskOther),
    groupItemTitle: stringValue(raw.groupItemTitle) || undefined,
    resolutionSource: stringValue(raw.resolutionSource) || undefined,
    rewardsMinSize: Math.max(0, numberValue(raw.rewardsMinSize)),
    rewardsMaxSpread: Math.max(0, numberValue(raw.rewardsMaxSpread)),
  };
}

function mapEvent(value: unknown): PredictionEvent | null {
  const raw = record(value);
  const id = stringValue(raw.id);
  const title = stringValue(raw.title);
  const slug = stringValue(raw.slug);
  if (!id || !title) return null;
  const tags = tagsFrom(raw.tags);
  const event: PredictionEvent = {
    id,
    title,
    description: stringValue(raw.description),
    slug,
    url: slug ? `${POLYMARKET_ORIGIN}/event/${slug}` : POLYMARKET_ORIGIN,
    image: stringValue(raw.image || raw.icon) || undefined,
    category: stringValue(record(raw.category).label || raw.category) || tags[0],
    tags,
    volume24h: numberValue(raw.volume24hr),
    volume: numberValue(raw.volume),
    liquidity: numberValue(raw.liquidity || raw.liquidityClob),
    endDate: stringValue(raw.endDate) || undefined,
    negRisk: booleanValue(raw.negRisk),
    enableNegRisk: booleanValue(raw.enableNegRisk),
    negRiskAugmented: booleanValue(raw.negRiskAugmented),
    markets: [],
  };
  event.markets = (Array.isArray(raw.markets) ? raw.markets : [])
    .map((market) => mapMarket(market, event))
    .filter((market): market is PredictionMarket => Boolean(market));
  return event;
}

async function fetchJson(fetcher: Fetcher, url: URL, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("user-agent", "HivemindOS/PredictionMarkets");
  const response = await fetcher(url, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status}.`);
  return response.json();
}

export async function fetchPredictionEvents(options: {
  query?: string;
  limit?: number;
  activeOnly?: boolean;
  fetcher?: Fetcher;
} = {}): Promise<PredictionEvent[]> {
  const fetcher = options.fetcher ?? fetch;
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 12)));
  const query = options.query?.trim();
  const url = new URL(query ? "/public-search" : "/events", POLYMARKET_GAMMA_API);
  if (query) {
    url.searchParams.set("q", query);
    url.searchParams.set("limit_per_type", String(limit));
  } else {
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");
  }
  const payload = await fetchJson(fetcher, url);
  const rawEvents = Array.isArray(payload) ? payload : record(payload).events;
  if (!Array.isArray(rawEvents)) return [];
  const events = rawEvents.map(mapEvent).filter((event): event is PredictionEvent => Boolean(event));
  const activeOnly = options.activeOnly ?? true;
  return events
    .map((event) => ({ ...event, markets: activeOnly ? event.markets.filter((market) => market.status === "active") : event.markets }))
    .filter((event) => !activeOnly || event.markets.length > 0)
    .slice(0, limit);
}

export async function fetchPredictionMarketBySlug(slug: string, fetcher: Fetcher = fetch): Promise<PredictionMarket> {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,200}$/.test(normalized)) throw new Error("A valid Polymarket market slug is required.");
  const market = mapMarket(await fetchJson(fetcher, new URL(`/markets/slug/${normalized}`, POLYMARKET_GAMMA_API)));
  if (!market) throw new Error(`Polymarket returned an invalid market for ${normalized}.`);
  return market;
}

export async function fetchPredictionOrderBook(outcomeId: string, fetcher: Fetcher = fetch): Promise<PredictionOrderBook> {
  if (!/^\d{10,}$/.test(outcomeId)) throw new Error("A valid Polymarket outcome token id is required.");
  const url = new URL("/book", POLYMARKET_CLOB_API);
  url.searchParams.set("token_id", outcomeId);
  return mapPredictionOrderBook(await fetchJson(fetcher, url), outcomeId);
}

function mapPredictionOrderBook(value: unknown, fallbackOutcomeId = ""): PredictionOrderBook {
  const raw = record(value);
  const levels = (value: unknown, descending: boolean) => (Array.isArray(value) ? value : [])
    .map(record)
    .map((item) => ({ price: numberValue(item.price), size: numberValue(item.size) }))
    .filter((item) => item.price > 0 && item.price < 1 && item.size > 0)
    .sort((a, b) => descending ? b.price - a.price : a.price - b.price);
  const bids = levels(raw.bids, true);
  const asks = levels(raw.asks, false);
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  return {
    outcomeId: stringValue(raw.asset_id, fallbackOutcomeId),
    bids,
    asks,
    midpoint: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
    spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
    timestamp: stringValue(raw.timestamp) || undefined,
    hash: stringValue(raw.hash) || undefined,
    minimumOrderSize: Math.max(0, numberValue(raw.min_order_size)),
    tickSize: Math.max(0, numberValue(raw.tick_size, 0.01)),
  };
}

export async function fetchPredictionOrderBooks(outcomeIds: string[], fetcher: Fetcher = fetch): Promise<PredictionOrderBook[]> {
  const requested = [...new Set(outcomeIds.map((outcomeId) => outcomeId.trim()))];
  if (requested.length < 1 || requested.length > 500 || requested.some((outcomeId) => !/^\d{10,}$/.test(outcomeId))) {
    throw new Error("Provide between 1 and 500 valid Polymarket outcome token ids.");
  }
  const url = new URL("/books", POLYMARKET_CLOB_API);
  const payload = await fetchJson(fetcher, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requested.map((token_id) => ({ token_id }))),
  });
  const byOutcomeId = new Map(
    (Array.isArray(payload) ? payload : [])
      .map((book) => mapPredictionOrderBook(book))
      .filter((book) => book.outcomeId)
      .map((book) => [book.outcomeId, book] as const),
  );
  return requested.map((outcomeId) => {
    const book = byOutcomeId.get(outcomeId);
    if (!book) throw new Error(`Polymarket omitted outcome ${outcomeId} from the batch order books.`);
    return book;
  });
}

export async function fetchPredictionPriceHistory(outcomeId: string, fetcher: Fetcher = fetch): Promise<PredictionPricePoint[]> {
  if (!/^\d{10,}$/.test(outcomeId)) throw new Error("A valid Polymarket outcome token id is required.");
  const url = new URL("/prices-history", POLYMARKET_CLOB_API);
  url.searchParams.set("market", outcomeId);
  url.searchParams.set("interval", "max");
  url.searchParams.set("fidelity", "60");
  const raw = record(await fetchJson(fetcher, url));
  return (Array.isArray(raw.history) ? raw.history : [])
    .map(record)
    .map((point) => ({ timestamp: numberValue(point.t) * 1_000, price: numberValue(point.p) }))
    .filter((point) => point.timestamp > 0 && point.price >= 0 && point.price <= 1);
}

function validateEvmAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error("Enter a valid 0x wallet address.");
  return normalized;
}

function mapPosition(value: unknown): PredictionPosition {
  const raw = record(value);
  const initialValue = numberValue(raw.initialValue);
  const currentValue = numberValue(raw.currentValue);
  const cashPnl = numberValue(raw.cashPnl, currentValue - initialValue);
  return {
    conditionId: stringValue(raw.conditionId),
    outcomeId: stringValue(raw.asset),
    title: stringValue(raw.title),
    slug: stringValue(raw.slug),
    outcome: stringValue(raw.outcome),
    size: numberValue(raw.size),
    averagePrice: numberValue(raw.avgPrice),
    currentPrice: numberValue(raw.curPrice),
    initialValue,
    currentValue,
    cashPnl,
    percentPnl: numberValue(raw.percentPnl, initialValue > 0 ? cashPnl / initialValue * 100 : 0),
  };
}

function mapActivity(value: unknown, index: number): PredictionActivity {
  const raw = record(value);
  const size = numberValue(raw.size);
  const price = numberValue(raw.price);
  const side = stringValue(raw.side).toUpperCase();
  return {
    id: stringValue(raw.transactionHash) || `${numberValue(raw.timestamp)}:${index}`,
    timestamp: numberValue(raw.timestamp) * 1_000,
    type: stringValue(raw.type),
    side: side === "BUY" || side === "SELL" ? side : undefined,
    conditionId: stringValue(raw.conditionId) || undefined,
    outcomeId: stringValue(raw.asset) || undefined,
    title: stringValue(raw.title) || undefined,
    slug: stringValue(raw.slug) || undefined,
    outcome: stringValue(raw.outcome) || undefined,
    size,
    usdcSize: numberValue(raw.usdcSize, size * price),
    price,
  };
}

export async function fetchPredictionTraderProfile(address: string, fetcher: Fetcher = fetch): Promise<PredictionTraderProfile> {
  const normalized = validateEvmAddress(address);
  const positionsUrl = new URL("/positions", POLYMARKET_DATA_API);
  positionsUrl.searchParams.set("user", normalized);
  positionsUrl.searchParams.set("limit", "500");
  positionsUrl.searchParams.set("sortBy", "CURRENT");
  positionsUrl.searchParams.set("sortDirection", "DESC");
  const activityUrl = new URL("/activity", POLYMARKET_DATA_API);
  activityUrl.searchParams.set("user", normalized);
  activityUrl.searchParams.set("limit", "500");
  activityUrl.searchParams.set("sortBy", "TIMESTAMP");
  activityUrl.searchParams.set("sortDirection", "DESC");
  const [positionsRaw, activityRaw] = await Promise.all([
    fetchJson(fetcher, positionsUrl),
    fetchJson(fetcher, activityUrl),
  ]);
  const positions = (Array.isArray(positionsRaw) ? positionsRaw : []).map(mapPosition);
  const seen = new Set<string>();
  const activity = (Array.isArray(activityRaw) ? activityRaw : []).map(mapActivity).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const trades = activity.filter((item) => item.type === "TRADE");
  const totalNotionalUsd = trades.reduce((sum, item) => sum + item.usdcSize, 0);
  const buyNotionalUsd = trades.filter((item) => item.side === "BUY").reduce((sum, item) => sum + item.usdcSize, 0);
  const sellNotionalUsd = trades.filter((item) => item.side === "SELL").reduce((sum, item) => sum + item.usdcSize, 0);
  const currentValueUsd = positions.reduce((sum, item) => sum + item.currentValue, 0);
  const cashPnlUsd = positions.reduce((sum, item) => sum + item.cashPnl, 0);
  const initialValueUsd = positions.reduce((sum, item) => sum + item.initialValue, 0);
  const largestPosition = positions.reduce((largest, item) => Math.max(largest, item.currentValue), 0);
  return {
    address: normalized,
    positions,
    activity,
    metrics: {
      tradeCount: trades.length,
      marketCount: new Set(trades.map((item) => item.conditionId || item.slug).filter(Boolean)).size,
      totalNotionalUsd,
      buyNotionalUsd,
      sellNotionalUsd,
      currentValueUsd,
      cashPnlUsd,
      weightedReturnPercent: initialValueUsd > 0 ? cashPnlUsd / initialValueUsd * 100 : 0,
      largestPositionPercent: currentValueUsd > 0 ? largestPosition / currentValueUsd * 100 : 0,
    },
  };
}

export function simulatePredictionPaperOrder(input: {
  market: Pick<PredictionMarket, "id" | "conditionId" | "title">;
  outcome: PredictionOutcome;
  side: "buy" | "sell";
  notionalUsd: number;
  book?: Pick<PredictionOrderBook, "bids" | "asks" | "spread">;
  slippageBps?: number;
  feeBps?: number;
  now?: Date;
}): PredictionPaperOrder {
  const notionalUsd = Math.round(Math.max(0, input.notionalUsd) * 100) / 100;
  if (notionalUsd < 1 || notionalUsd > 10_000) throw new Error("Paper notional must be between $1 and $10,000.");
  const best = input.side === "buy" ? input.book?.asks[0]?.price : input.book?.bids[0]?.price;
  const basePrice = best ?? input.outcome.price;
  if (!(basePrice > 0 && basePrice < 1)) throw new Error("This outcome has no executable paper price.");
  const direction = input.side === "buy" ? 1 : -1;
  const slippage = Math.max(0, input.slippageBps ?? 10) / 10_000;
  const fillPrice = Math.min(0.999, Math.max(0.001, basePrice * (1 + direction * slippage)));
  const feeUsd = Math.round(notionalUsd * Math.max(0, input.feeBps ?? 0) / 10_000 * 100) / 100;
  return {
    id: `paper_${(input.now ?? new Date()).getTime()}_${input.outcome.id.slice(-8)}`,
    createdAt: (input.now ?? new Date()).toISOString(),
    marketId: input.market.id,
    conditionId: input.market.conditionId,
    outcomeId: input.outcome.id,
    title: input.market.title,
    outcome: input.outcome.label,
    side: input.side,
    requestedPrice: input.outcome.price,
    fillPrice,
    shares: notionalUsd / fillPrice,
    notionalUsd,
    feeUsd,
    status: "filled",
  };
}

function feePerShare(price: number, feeSchedule?: PredictionFeeSchedule): number {
  if (!feeSchedule || feeSchedule.rate <= 0 || price <= 0 || price >= 1) return 0;
  return feeSchedule.rate * (price * (1 - price)) ** feeSchedule.exponent;
}

function roundFee(value: number): number {
  return Math.round(Math.max(0, value) * 100_000) / 100_000;
}

export function predictionTakerFeeUsd(input: {
  shares: number;
  price: number;
  feeSchedule?: PredictionFeeSchedule;
}): number {
  if (!Number.isFinite(input.shares) || input.shares <= 0 || !Number.isFinite(input.price)) return 0;
  return roundFee(input.shares * feePerShare(input.price, input.feeSchedule));
}

function orderBookTimestampMs(book?: Pick<PredictionOrderBook, "timestamp">): number | null {
  if (!book?.timestamp) return null;
  const numeric = Number(book.timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(book.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function simulatePredictionComplementArbitrage(input: {
  market: PredictionMarket;
  books: PredictionOrderBook[];
  bankrollUsd?: number;
  minimumNetEdgePerShare?: number;
  maxDepthFraction?: number;
  now?: Date;
}): PredictionComplementArbitrageQuote {
  const requestedBankroll = Number.isFinite(input.bankrollUsd) ? Number(input.bankrollUsd) : 100;
  const bankrollUsd = Math.round(Math.max(0, requestedBankroll) * 100) / 100;
  if (bankrollUsd < 1 || bankrollUsd > 100_000) throw new Error("Paper bankroll must be between $1 and $100,000.");
  const outcomes = input.market.outcomes;
  if (outcomes.length !== 2) throw new Error("Complement arbitrage requires exactly two outcomes from one binary market.");
  const firstOutcome = outcomes[0];
  const secondOutcome = outcomes[1];
  const byOutcomeId = new Map(input.books.map((book) => [book.outcomeId, book]));
  const firstBook = byOutcomeId.get(firstOutcome.id);
  const secondBook = byOutcomeId.get(secondOutcome.id);
  const firstAsk = firstBook?.asks[0]?.price ?? null;
  const secondAsk = secondBook?.asks[0]?.price ?? null;
  const bestCombinedAsk = firstAsk != null && secondAsk != null ? firstAsk + secondAsk : null;
  const rawEdgePerShare = bestCombinedAsk == null ? null : 1 - bestCombinedAsk;
  const feeSchedule = input.market.feesEnabled ? input.market.feeSchedule : undefined;
  const takerFeePerShare = firstAsk != null && secondAsk != null
    ? feePerShare(firstAsk, feeSchedule) + feePerShare(secondAsk, feeSchedule)
    : null;
  const netEdgePerShare = rawEdgePerShare == null || takerFeePerShare == null
    ? null
    : rawEdgePerShare - takerFeePerShare;
  const firstTimestamp = orderBookTimestampMs(firstBook);
  const secondTimestamp = orderBookTimestampMs(secondBook);
  const snapshotSkewMs = firstTimestamp != null && secondTimestamp != null
    ? Math.abs(firstTimestamp - secondTimestamp)
    : null;
  const base: Omit<PredictionComplementArbitrageQuote, "decision" | "reason" | "paperFill"> = {
    observedAt: (input.now ?? new Date()).toISOString(),
    marketId: input.market.id,
    conditionId: input.market.conditionId,
    title: input.market.title,
    slug: input.market.slug,
    outcomeLabels: [firstOutcome.label, secondOutcome.label],
    outcomeIds: [firstOutcome.id, secondOutcome.id],
    bestAsks: [firstAsk, secondAsk],
    bestCombinedAsk,
    rawEdgePerShare,
    takerFeePerShare,
    netEdgePerShare,
    snapshotSkewMs,
    bankrollUsd,
  };
  const reject = (reason: string): PredictionComplementArbitrageQuote => ({
    ...base,
    decision: "rejected",
    reason,
    paperFill: null,
  });
  if (input.market.status !== "active" || !input.market.acceptingOrders) {
    return reject("The market is not currently accepting orders.");
  }
  if (!firstBook?.asks.length || !secondBook?.asks.length) {
    return reject("Both outcomes need an executable ask; a one-sided quote cannot lock a payout.");
  }
  if (input.market.feesEnabled && !input.market.feeSchedule) {
    return reject("This fee-enabled market is missing its live fee schedule, so profitability cannot be verified.");
  }
  if (rawEdgePerShare == null || rawEdgePerShare <= 0) {
    return reject("The executable asks cost at least $1 before fees; displayed midpoint odds are not a fill.");
  }
  const minimumNetEdgePerShare = Math.max(0, input.minimumNetEdgePerShare ?? 0);
  if (netEdgePerShare == null || netEdgePerShare <= minimumNetEdgePerShare) {
    return reject("The raw price gap is erased by taker fees on the two legs.");
  }

  const maxDepthFraction = Math.min(1, Math.max(0.01, input.maxDepthFraction ?? 0.25));
  const firstLevels = firstBook.asks.map((level) => ({ ...level, remaining: level.size * maxDepthFraction }));
  const secondLevels = secondBook.asks.map((level) => ({ ...level, remaining: level.size * maxDepthFraction }));
  let firstIndex = 0;
  let secondIndex = 0;
  let shares = 0;
  let firstCost = 0;
  let secondCost = 0;
  let feeUsd = 0;
  let capitalUsd = 0;
  while (firstIndex < firstLevels.length && secondIndex < secondLevels.length && capitalUsd < bankrollUsd) {
    const firstLevel = firstLevels[firstIndex];
    const secondLevel = secondLevels[secondIndex];
    const pairFeePerShare = feePerShare(firstLevel.price, feeSchedule) + feePerShare(secondLevel.price, feeSchedule);
    const pairCapitalPerShare = firstLevel.price + secondLevel.price + pairFeePerShare;
    if (1 - pairCapitalPerShare <= minimumNetEdgePerShare) break;
    const availableShares = Math.min(firstLevel.remaining, secondLevel.remaining);
    const budgetShares = (bankrollUsd - capitalUsd) / pairCapitalPerShare;
    const filledShares = Math.min(availableShares, budgetShares);
    if (!(filledShares > 1e-9)) break;
    const firstLevelCost = filledShares * firstLevel.price;
    const secondLevelCost = filledShares * secondLevel.price;
    const levelFee = predictionTakerFeeUsd({
      shares: filledShares,
      price: firstLevel.price,
      feeSchedule,
    }) + predictionTakerFeeUsd({
      shares: filledShares,
      price: secondLevel.price,
      feeSchedule,
    });
    shares += filledShares;
    firstCost += firstLevelCost;
    secondCost += secondLevelCost;
    feeUsd += levelFee;
    capitalUsd = firstCost + secondCost + feeUsd;
    firstLevel.remaining -= filledShares;
    secondLevel.remaining -= filledShares;
    if (firstLevel.remaining <= 1e-9) firstIndex += 1;
    if (secondLevel.remaining <= 1e-9) secondIndex += 1;
  }
  if (!(shares > 0)) return reject("No paired displayed depth remained profitable after fees.");
  const minimumShares = Math.max(
    input.market.minimumOrderSize,
    firstBook.minimumOrderSize,
    secondBook.minimumOrderSize,
  );
  if (minimumShares > 0 && shares < minimumShares) {
    return reject(`Each leg must contain at least ${minimumShares.toFixed(2)} shares.`);
  }
  const payoutUsd = shares;
  const pnlUsd = payoutUsd - capitalUsd;
  if (!(pnlUsd > 0)) return reject("Rounding and fees leave no positive paired paper payout.");
  return {
    ...base,
    decision: "paper-filled",
    reason: `Equal ${firstOutcome.label}/${secondOutcome.label} shares fit the bankroll and remain positive after both taker fees.`,
    paperFill: {
      shares,
      firstAveragePrice: firstCost / shares,
      secondAveragePrice: secondCost / shares,
      grossCostUsd: firstCost + secondCost,
      feeUsd,
      capitalUsd,
      payoutUsd,
      pnlUsd,
      roi: capitalUsd > 0 ? pnlUsd / capitalUsd : 0,
    },
  };
}

export async function fetchCurrentBtcComplementArbitrageQuotes(options: {
  intervalMinutes?: Array<5 | 15>;
  bankrollUsd?: number;
  minimumNetEdgePerShare?: number;
  maxDepthFraction?: number;
  now?: Date;
  fetcher?: Fetcher;
} = {}): Promise<PredictionComplementArbitrageQuote[]> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const intervals: Array<5 | 15> = [...new Set<5 | 15>(options.intervalMinutes ?? [5, 15])];
  return Promise.all(intervals.map(async (intervalMinutes) => {
    const intervalSeconds = intervalMinutes * 60;
    const epoch = Math.floor(now.getTime() / 1_000 / intervalSeconds) * intervalSeconds;
    const market = await fetchPredictionMarketBySlug(`btc-updown-${intervalMinutes}m-${epoch}`, fetcher);
    const books = await fetchPredictionOrderBooks(market.outcomes.map((outcome) => outcome.id), fetcher);
    return {
      ...simulatePredictionComplementArbitrage({
        market,
        books,
        bankrollUsd: options.bankrollUsd,
        minimumNetEdgePerShare: options.minimumNetEdgePerShare,
        maxDepthFraction: options.maxDepthFraction,
        now,
      }),
      intervalMinutes,
    };
  }));
}

export function calculatePredictionCalibration(samples: Array<{ probability: number; outcome: 0 | 1 }>): PredictionCalibration {
  const valid = samples.filter((sample) => sample.probability >= 0 && sample.probability <= 1);
  if (!valid.length) return { samples: 0, brierScore: 0, logLoss: 0, expectedCalibrationError: 0, buckets: [] };
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const lower = index / 10;
    const upper = (index + 1) / 10;
    const rows = valid.filter((sample) => sample.probability >= lower && (index === 9 ? sample.probability <= upper : sample.probability < upper));
    return {
      lower,
      upper,
      samples: rows.length,
      forecast: rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : 0,
      observed: rows.length ? rows.reduce((sum, row) => sum + row.outcome, 0) / rows.length : 0,
    };
  }).filter((bucket) => bucket.samples > 0);
  const epsilon = 1e-15;
  const brierScore = valid.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / valid.length;
  const logLoss = valid.reduce((sum, row) => {
    const probability = Math.min(1 - epsilon, Math.max(epsilon, row.probability));
    return sum - (row.outcome * Math.log(probability) + (1 - row.outcome) * Math.log(1 - probability));
  }, 0) / valid.length;
  const expectedCalibrationError = buckets.reduce((sum, bucket) => (
    sum + bucket.samples / valid.length * Math.abs(bucket.forecast - bucket.observed)
  ), 0);
  return { samples: valid.length, brierScore, logLoss, expectedCalibrationError, buckets };
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function weatherBucketProbability(input: {
  forecast: number;
  low?: number;
  high?: number;
  uncertainty?: number;
}): number {
  const sigma = Math.max(0.1, input.uncertainty ?? 2);
  const lowProbability = input.low == null ? 0 : normalCdf((input.low - input.forecast) / sigma);
  const highProbability = input.high == null ? 1 : normalCdf((input.high - input.forecast) / sigma);
  return Math.min(1, Math.max(0, highProbability - lowProbability));
}
