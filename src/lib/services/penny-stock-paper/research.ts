import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import type {
  PennyPaperSelectorWeights,
  PennyPaperStrategy,
  PennyStockBar,
  PennyStockConservativeEv,
  PennyStockExecutionEvidence,
  PennyStockFilingSummary,
  PennyStockMonitoringEvidence,
  PennyStockResearchRow,
  PennyStockRiskUpdateSignal,
  PennyStockUniverseRow,
} from "./types";
import { DEFAULT_PENNY_PAPER_STRATEGY } from "./simulation";
import {
  fallbackExecutionEvidence,
  fetchQuoteExecutionEvidence,
} from "./execution-research";
import {
  emptyFilingSummary,
  fetchPennyRiskUpdateSignals,
  fetchPennyRiskIntelligence,
  pennyCorporateActionKey,
  pennyFilingMarkerKey,
} from "./risk-intelligence";

const NASDAQ_SCREENER_URL =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&download=true";
const ALPACA_ASSETS_URL =
  "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2/stocks";
const NASDAQ_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (compatible; HivemindOS research-only paper simulator)",
};
const LISTED_EXCHANGES = new Set([
  "NASDAQ",
  "NYSE",
  "AMEX",
  "ARCA",
  "BATS",
  "NYSEARCA",
]);
const EXCLUDED_SECURITY_NAME =
  /\b(warrant|warrants|unit|units|right|rights|preferred|preference|etf|fund|notes?|bonds?|debentures?|trust|depositary shares?|closed end|acquisition corp)\b/i;

export const PENNY_RESEARCH_FILTERS = {
  minimumPriceUsd: 0.02,
  maximumPriceUsd: 1,
  minimumMarketCapUsd: 5_000_000,
  maximumMarketCapUsd: 300_000_000,
  minimumCurrentVolume: 100_000,
  historyCandidates: 40,
  outputCandidates: 10,
  recentTradingBars: 90,
} as const;

export const PROSPECTIVE_ENTRY_DISCOUNTS_PCT = [10, 20, 30] as const;

export const DEFAULT_PENNY_SELECTOR_WEIGHTS: PennyPaperSelectorWeights = {
  liquidity: 0.2,
  marketCap: 0.05,
  consistency: 0.1,
  conservativeEv: 0.25,
  volumeTrend: 0.05,
  drawdownSafety: 0.1,
  volatilityFitness: 0.05,
  executionQuality: 0.1,
  secRiskPenalty: 0.1,
};

export type PennyStockDiscoveryResult = {
  candidates: PennyStockResearchRow[];
  eligibleBeforeHistory: number;
  historyCandidates: number;
  universeSnapshot: PennyStockUniverseRow[];
  asOf: string;
};

type AlpacaCredentials = {
  apiKey: string;
  apiSecret: string;
};

type FetchLike = typeof fetch;

export async function discoverPennyStockCandidates(options: {
  asOf?: Date;
  fetchFn?: FetchLike;
  strategy?: PennyPaperStrategy;
  historyCandidates?: number;
  selectorWeights?: PennyPaperSelectorWeights;
} = {}): Promise<PennyStockDiscoveryResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const asOf = options.asOf ?? new Date();
  const strategy = options.strategy ?? DEFAULT_PENNY_PAPER_STRATEGY;
  const credentials = await resolveAlpacaCredentials();
  const [nasdaqRows, alpacaAssets] = await Promise.all([
    fetchNasdaqUniverse(fetchFn),
    fetchAlpacaAssets(credentials, fetchFn),
  ]);
  const eligible = screenPennyStockUniverse(nasdaqRows, alpacaAssets);
  const historyCandidateCount = Math.max(
    PENNY_RESEARCH_FILTERS.outputCandidates,
    Math.min(options.historyCandidates ?? PENNY_RESEARCH_FILTERS.historyCandidates, 80),
  );
  const historyUniverse = eligible
    .sort((left, right) =>
      right.currentVolume * right.priceUsd - left.currentVolume * left.priceUsd
      || right.marketCapUsd - left.marketCapUsd
      || left.symbol.localeCompare(right.symbol)
    )
    .slice(0, historyCandidateCount);
  const start = new Date(asOf.getTime() - 180 * 86_400_000);
  const delayedEnd = new Date(asOf.getTime() - 20 * 60_000);
  const barsEntries = await mapWithConcurrency(historyUniverse, 4, async (row) => [
    row.symbol,
    await fetchAlpacaDailyBars({
      symbol: row.symbol,
      start,
      end: delayedEnd,
      credentials,
      fetchFn,
    }),
  ] as const);
  const barsBySymbol = Object.fromEntries(barsEntries);
  const rankedWithoutFilings = rankPennyStockCandidates({
    universe: historyUniverse,
    barsBySymbol,
    strategy,
    selectorWeights: options.selectorWeights,
  }).slice(0, PENNY_RESEARCH_FILTERS.outputCandidates * 2);
  const symbols = rankedWithoutFilings.map((row) => row.symbol);
  const [risk, quoteEvidence] = await Promise.all([
    fetchPennyRiskIntelligence({
      symbols,
      asOf,
      alpacaHeaders: alpacaHeaders(credentials),
      fetchFn,
    }),
    fetchQuoteExecutionEvidence({
      symbols: rankedWithoutFilings.map((row) => ({
        symbol: row.symbol,
        priceUsd: row.priceUsd,
      })),
      asOf,
      alpacaHeaders: alpacaHeaders(credentials),
      fetchFn,
    }),
  ]);
  const candidates = rankedWithoutFilings
    .map((row) => enrichResearchRow(
      row,
      risk.filings[row.symbol] ?? emptyFilingSummary(),
      risk.corporateActions[row.symbol] ?? [],
      quoteEvidence[row.symbol]?.evidence ?? fallbackExecutionEvidence(),
      strategy,
    ))
    .sort((left, right) =>
      Number(left.vetoed) - Number(right.vetoed)
      || right.score - left.score
      || right.conservativeEv.expectedValueLowPctPerOrder
        - left.conservativeEv.expectedValueLowPctPerOrder
      || left.symbol.localeCompare(right.symbol)
    )
    .slice(0, PENNY_RESEARCH_FILTERS.outputCandidates)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    candidates,
    eligibleBeforeHistory: eligible.length,
    historyCandidates: historyUniverse.length,
    universeSnapshot: historyUniverse,
    asOf: asOf.toISOString(),
  };
}

export async function fetchPennyStockLongHistory(input: {
  symbols: string[];
  asOf?: Date;
  calendarDays?: number;
  fetchFn?: FetchLike;
}): Promise<Record<string, PennyStockBar[]>> {
  const symbols = [...new Set(input.symbols.map(normalizeSymbol))];
  if (!symbols.length || symbols.length > 10) {
    throw new Error("Long-history fetch needs between one and ten symbols.");
  }
  const asOf = input.asOf ?? new Date();
  const calendarDays = Math.max(730, Math.min(input.calendarDays ?? 1_100, 2_000));
  const start = new Date(asOf.getTime() - calendarDays * 86_400_000);
  const delayedEnd = new Date(asOf.getTime() - 20 * 60_000);
  const credentials = await resolveAlpacaCredentials();
  const fetchFn = input.fetchFn ?? fetch;
  const entries = await mapWithConcurrency(symbols, 3, async (symbol) => [
    symbol,
    await fetchAlpacaDailyBars({
      symbol,
      start,
      end: delayedEnd,
      credentials,
      fetchFn,
    }),
  ] as const);
  return Object.fromEntries(entries);
}

export async function fetchPennyStockMonitoringEvidence(input: {
  candidates: Array<{ symbol: string; priceUsd: number }>;
  asOf: Date;
  knownFilingKeys?: Record<string, string[]>;
  knownFilingThroughDate?: Record<string, string>;
  knownCorporateActionKeys?: Record<string, string[]>;
  fetchFn?: FetchLike;
}): Promise<PennyStockMonitoringEvidence> {
  const candidates = input.candidates.map((row) => ({
    symbol: normalizeSymbol(row.symbol),
    priceUsd: row.priceUsd,
  }));
  if (!candidates.length || candidates.length > 10) {
    throw new Error("Evidence monitoring needs between one and ten research candidates.");
  }
  const credentials = await resolveAlpacaCredentials();
  const fetchFn = input.fetchFn ?? fetch;
  const headers = alpacaHeaders(credentials);
  const [quoteEvidence, riskUpdates] = await Promise.all([
    fetchQuoteExecutionEvidence({
      symbols: candidates,
      asOf: input.asOf,
      alpacaHeaders: headers,
      fetchFn,
    }),
    fetchPennyRiskUpdateSignals({
      symbols: candidates.map((row) => row.symbol),
      asOf: input.asOf,
      alpacaHeaders: headers,
      fetchFn,
    }),
  ]);
  const deepRiskRefreshSymbols = candidates.flatMap((candidate) => {
    const symbol = candidate.symbol;
    const knownFilings = new Set(input.knownFilingKeys?.[symbol] ?? []);
    const knownActions = new Set(input.knownCorporateActionKeys?.[symbol] ?? []);
    const update = riskUpdates[symbol];
    const filingThroughDate = input.knownFilingThroughDate?.[symbol] ?? null;
    const hasNewFiling = (update?.filingMarkers ?? []).some((marker) =>
      !knownFilings.has(pennyFilingMarkerKey(marker))
      && !knownFilings.has(`${marker.form}|${marker.filedAt}|`)
      && (!filingThroughDate || marker.filedAt > filingThroughDate)
    );
    const hasNewAction = (update?.corporateActions ?? []).some((action) =>
      !knownActions.has(pennyCorporateActionKey(action))
    );
    return hasNewFiling || hasNewAction ? [symbol] : [];
  });
  const refreshed = deepRiskRefreshSymbols.length
    ? await fetchPennyRiskIntelligence({
      symbols: deepRiskRefreshSymbols,
      asOf: input.asOf,
      alpacaHeaders: headers,
      fetchFn,
    })
    : { filings: {}, corporateActions: {} };
  return {
    execution: Object.fromEntries(Object.entries(quoteEvidence).map(
      ([symbol, value]) => [symbol, value.evidence],
    )),
    riskUpdates,
    refreshedFilings: refreshed.filings,
    deepRiskRefreshSymbols,
  };
}

export async function fetchPennyOutcomeCatalystSignals(input: {
  symbols: string[];
  asOf: Date;
  fetchFn?: FetchLike;
}): Promise<Record<string, PennyStockRiskUpdateSignal>> {
  const symbols = [...new Set(input.symbols.map(normalizeSymbol).filter(Boolean))];
  if (!symbols.length) return {};
  if (symbols.length > 20) {
    throw new Error("Outcome catalyst review is bounded to twenty symbols per daily run.");
  }
  const credentials = await resolveAlpacaCredentials();
  return fetchPennyRiskUpdateSignals({
    symbols,
    asOf: input.asOf,
    alpacaHeaders: alpacaHeaders(credentials),
    fetchFn: input.fetchFn ?? fetch,
  });
}

export function rankPennyStockCandidates(input: {
  universe: PennyStockUniverseRow[];
  barsBySymbol: Record<string, PennyStockBar[]>;
  strategy?: PennyPaperStrategy;
  selectorWeights?: PennyPaperSelectorWeights;
}): PennyStockResearchRow[] {
  const strategy = input.strategy ?? DEFAULT_PENNY_PAPER_STRATEGY;
  const weights = input.selectorWeights ?? DEFAULT_PENNY_SELECTOR_WEIGHTS;
  const provisional = input.universe.map((row) => {
    const bars = normalizeRecentBars(
      input.barsBySymbol[row.symbol] ?? [],
      PENNY_RESEARCH_FILTERS.recentTradingBars,
    );
    if (bars.length < 60) return null;
    const volumes = bars.map((bar) => bar.volume);
    const dollarVolumes = bars.map((bar) => bar.close * bar.volume);
    const returns = simpleReturns(bars.map((bar) => bar.close));
    const firstClose = bars[0]?.close ?? row.priceUsd;
    const lastClose = bars.at(-1)?.close ?? row.priceUsd;
    const recent20 = mean(volumes.slice(-20));
    const prior = mean(volumes.slice(0, Math.max(1, volumes.length - 20)));
    return {
      base: row,
      bars,
      metrics: {
        averageDailyVolume90: mean(volumes),
        medianDailyVolume90: median(volumes),
        averageDailyDollarVolume90: mean(dollarVolumes),
        volumeTrend20VsPriorPct: prior > 0 ? ((recent20 - prior) / prior) * 100 : 0,
        volatility90Pct: standardDeviation(returns) * 100,
        maxDrawdown90Pct: maxDrawdownPct(bars.map((bar) => bar.close)),
        return90Pct: firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0,
        zeroVolumeDays90: volumes.filter((value) => value <= 0).length,
        methodEvidence: evaluateLimitMethodEvidence(bars, strategy),
      },
    };
  }).filter((value): value is NonNullable<typeof value> => value !== null);

  const liquidityValues = provisional.map((row) =>
    Math.log10(Math.max(1, row.metrics.averageDailyDollarVolume90))
  );
  const marketCapValues = provisional.map((row) =>
    Math.log10(Math.max(1, row.base.marketCapUsd))
  );
  const ranked = provisional.map((row, index) => {
    const liquidity = percentileRank(liquidityValues, liquidityValues[index]);
    const marketCap = percentileRank(marketCapValues, marketCapValues[index]);
    const consistency = 1 - row.metrics.zeroVolumeDays90 / row.bars.length;
    const conservativeEv = conservativeExpectedValue(
      row.metrics.methodEvidence,
      fallbackExecutionEvidence(),
      strategy,
    );
    const evFitness = clamp((conservativeEv.expectedValueLowPctPerOrder + 20) / 40, 0, 1);
    const trendFitness = clamp((row.metrics.volumeTrend20VsPriorPct + 50) / 150, 0, 1);
    const drawdownSafety = 1 - clamp(row.metrics.maxDrawdown90Pct / 100, 0, 1);
    const volatilityFitness = 1 - clamp(
      Math.abs(row.metrics.volatility90Pct - 8) / 20,
      0,
      1,
    );
    const score = 100 * (
      liquidity * weights.liquidity
      + marketCap * weights.marketCap
      + consistency * weights.consistency
      + evFitness * weights.conservativeEv
      + trendFitness * weights.volumeTrend
      + drawdownSafety * weights.drawdownSafety
      + volatilityFitness * weights.volatilityFitness
      + 0.25 * weights.executionQuality
    );
    return researchRow(row.base, row.bars, row.metrics, score, conservativeEv);
  });
  return ranked
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function evaluateLimitMethodEvidence(
  bars: PennyStockBar[],
  strategy: PennyPaperStrategy,
) {
  let limitTouches = 0;
  let bouncesAfterTouch = 0;
  const observations = Math.max(0, bars.length - 1);
  for (let placedIndex = 0; placedIndex < bars.length - 1; placedIndex += 1) {
    const limit = bars[placedIndex].close * (1 - strategy.entryDiscountPct / 100);
    const expiry = Math.min(
      bars.length - 1,
      placedIndex + strategy.orderExpiryDays,
    );
    let fillIndex = -1;
    let fillPrice = 0;
    for (let index = placedIndex + 1; index <= expiry; index += 1) {
      if (bars[index].low <= limit) {
        fillIndex = index;
        fillPrice = Math.min(limit, bars[index].open);
        break;
      }
    }
    if (fillIndex < 0) continue;
    limitTouches += 1;
    const target = fillPrice * (1 + strategy.takeProfitPct / 100);
    const exit = Math.min(bars.length - 1, fillIndex + strategy.maxHoldDays);
    for (let index = fillIndex + 1; index <= exit; index += 1) {
      if (bars[index].high >= target) {
        bouncesAfterTouch += 1;
        break;
      }
    }
  }
  return {
    observations,
    limitTouches,
    limitTouchRatePct: observations ? round((limitTouches / observations) * 100, 4) : 0,
    limitTouchWilsonLowPct: round(wilsonLowerBound(limitTouches, observations) * 100, 4),
    bouncesAfterTouch,
    bounceRatePct: limitTouches ? round((bouncesAfterTouch / limitTouches) * 100, 4) : 0,
    bounceWilsonLowPct: round(wilsonLowerBound(bouncesAfterTouch, limitTouches) * 100, 4),
  };
}

function screenPennyStockUniverse(
  nasdaqRows: unknown[],
  alpacaAssets: unknown[],
): PennyStockUniverseRow[] {
  const assets = new Map<string, { exchange: string; tradable: boolean }>();
  for (const raw of alpacaAssets) {
    if (!isRecord(raw)) continue;
    const symbol = safeNormalizeSymbol(String(raw.symbol ?? ""));
    const exchange = String(raw.exchange ?? "").trim().toUpperCase();
    if (!symbol) continue;
    assets.set(symbol, { exchange, tradable: raw.tradable === true });
  }
  const result: PennyStockUniverseRow[] = [];
  for (const raw of nasdaqRows) {
    if (!isRecord(raw)) continue;
    const symbol = safeNormalizeSymbol(String(raw.symbol ?? ""));
    const name = String(raw.name ?? "").trim();
    const asset = assets.get(symbol);
    const priceUsd = parseMarketNumber(raw.lastsale);
    const marketCapUsd = parseMarketNumber(raw.marketCap);
    const currentVolume = parseMarketNumber(raw.volume);
    const country = String(raw.country ?? "").trim();
    if (
      !asset?.tradable
      || !LISTED_EXCHANGES.has(asset.exchange)
      || country !== "United States"
      || EXCLUDED_SECURITY_NAME.test(name)
      || priceUsd < PENNY_RESEARCH_FILTERS.minimumPriceUsd
      || priceUsd > PENNY_RESEARCH_FILTERS.maximumPriceUsd
      || marketCapUsd < PENNY_RESEARCH_FILTERS.minimumMarketCapUsd
      || marketCapUsd > PENNY_RESEARCH_FILTERS.maximumMarketCapUsd
      || currentVolume < PENNY_RESEARCH_FILTERS.minimumCurrentVolume
    ) {
      continue;
    }
    result.push({
      symbol,
      name,
      exchange: asset.exchange,
      country,
      sector: String(raw.sector ?? "").trim() || "Unclassified",
      industry: String(raw.industry ?? "").trim() || "Unclassified",
      priceUsd,
      marketCapUsd,
      currentVolume,
    });
  }
  return result;
}

async function fetchNasdaqUniverse(fetchFn: FetchLike): Promise<unknown[]> {
  const response = await fetchFn(NASDAQ_SCREENER_URL, {
    headers: NASDAQ_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.rows)) {
    throw new Error(`Nasdaq screener request failed (HTTP ${response.status}).`);
  }
  if (body.data.rows.length > 20_000) throw new Error("Nasdaq screener response exceeded the safety limit.");
  return body.data.rows;
}

async function fetchAlpacaAssets(
  credentials: AlpacaCredentials,
  fetchFn: FetchLike,
): Promise<unknown[]> {
  const response = await fetchFn(ALPACA_ASSETS_URL, {
    headers: alpacaHeaders(credentials),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(`Alpaca assets request failed (HTTP ${response.status}).`);
  }
  if (body.length > 50_000) throw new Error("Alpaca assets response exceeded the safety limit.");
  return body;
}

async function fetchAlpacaDailyBars(input: {
  symbol: string;
  start: Date;
  end: Date;
  credentials: AlpacaCredentials;
  fetchFn: FetchLike;
}): Promise<PennyStockBar[]> {
  const symbol = normalizeSymbol(input.symbol);
  const url = new URL(`${ALPACA_DATA_BASE}/${encodeURIComponent(symbol)}/bars`);
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", input.start.toISOString());
  url.searchParams.set("end", input.end.toISOString());
  url.searchParams.set("limit", "10000");
  url.searchParams.set("adjustment", "all");
  url.searchParams.set("feed", "sip");
  const response = await input.fetchFn(url, {
    headers: alpacaHeaders(input.credentials),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isRecord(body) || !Array.isArray(body.bars)) {
    const message = isRecord(body) && typeof body.message === "string" ? ` ${body.message}` : "";
    throw new Error(`Alpaca bars request for ${symbol} failed (HTTP ${response.status}).${message}`);
  }
  if (body.bars.length > 20_000) throw new Error(`${symbol} returned too many bars.`);
  return body.bars.map((raw) => normalizeAlpacaBar(raw)).filter(
    (bar): bar is PennyStockBar => bar !== null,
  );
}

async function resolveAlpacaCredentials(): Promise<AlpacaCredentials> {
  const apiKey = await firstHiveEnvValue([
    "ALPACA_PAPER_API_KEY_ID",
    "ALPACA_API_KEY_ID",
  ]);
  const apiSecret = await firstHiveEnvValue([
    "ALPACA_PAPER_API_SECRET_KEY",
    "ALPACA_API_SECRET_KEY",
  ]);
  if (!apiKey || !apiSecret) {
    throw new Error(
      "Read-only penny-stock research needs ALPACA_PAPER_API_KEY_ID and ALPACA_PAPER_API_SECRET_KEY (or the live-key fallback names) in Shared Hive Env.",
    );
  }
  return { apiKey, apiSecret };
}

async function firstHiveEnvValue(names: string[]): Promise<string> {
  for (const name of names) {
    const value = await hiveEnvValue(name);
    if (value) return value;
  }
  return "";
}

function alpacaHeaders(credentials: AlpacaCredentials) {
  return {
    accept: "application/json",
    "APCA-API-KEY-ID": credentials.apiKey,
    "APCA-API-SECRET-KEY": credentials.apiSecret,
  };
}

function researchRow(
  base: PennyStockUniverseRow,
  bars: PennyStockBar[],
  metrics: Omit<
    PennyStockResearchRow,
    keyof PennyStockUniverseRow
    | "rank"
    | "score"
    | "bars90"
    | "executionEvidence"
    | "conservativeEv"
    | "filings"
    | "corporateActions"
    | "vetoed"
    | "vetoReasons"
    | "reviewRequired"
    | "reviewReasons"
    | "evidence"
    | "risks"
  >,
  score: number,
  conservativeEv: PennyStockConservativeEv,
): PennyStockResearchRow {
  return {
    ...base,
    rank: 0,
    score: round(score, 4),
    bars90: bars.length,
    ...metrics,
    executionEvidence: fallbackExecutionEvidence(),
    conservativeEv,
    filings: emptyFilingSummary(),
    corporateActions: [],
    vetoed: false,
    vetoReasons: [],
    reviewRequired: false,
    reviewReasons: [],
    evidence: [],
    risks: [],
  };
}

function enrichResearchRow(
  row: PennyStockResearchRow,
  filings: PennyStockFilingSummary,
  corporateActions: PennyStockResearchRow["corporateActions"],
  executionEvidence: PennyStockExecutionEvidence,
  strategy: PennyPaperStrategy,
): PennyStockResearchRow {
  const conservativeEv = conservativeExpectedValue(
    row.methodEvidence,
    executionEvidence,
    strategy,
  );
  const evidence = [
    `${row.bars90} consolidated-market daily bars; average volume ${Math.round(row.averageDailyVolume90).toLocaleString("en-US")} shares.`,
    `Average 90-day dollar volume ${formatUsd(row.averageDailyDollarVolume90)}; current market cap ${formatUsd(row.marketCapUsd)}.`,
    `${row.methodEvidence.limitTouches} modeled ${strategy.entryDiscountPct}%-below-close limit touches and ${row.methodEvidence.bouncesAfterTouch} subsequent target bounces in the recent sample.`,
    executionEvidence.source === "alpaca-sip-quotes"
      ? `${executionEvidence.quoteObservations.toLocaleString("en-US")} SIP quotes; median spread ${executionEvidence.medianSpreadBps?.toFixed(1)} bps and modeled displayed-size fill ratio ${executionEvidence.estimatedFillRatioPct.toFixed(1)}%.`
      : "Quote sample was unavailable; execution evidence uses a pessimistic daily-bar fallback.",
    `Wilson-bound conservative expected value is ${conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}% per standing order before portfolio overlap.`,
  ];
  if (filings.latestPeriodicForm && filings.latestPeriodicFiledAt) {
    evidence.push(`Latest SEC periodic filing: ${filings.latestPeriodicForm} filed ${filings.latestPeriodicFiledAt}.`);
  }
  const risks: string[] = [];
  if (row.priceUsd < 0.1) risks.push("Sub-$0.10 price magnifies tick size, spread, and reverse-split risk.");
  if (row.maxDrawdown90Pct > 50) risks.push(`Recent maximum drawdown was ${row.maxDrawdown90Pct.toFixed(1)}%.`);
  if (row.averageDailyDollarVolume90 < 500_000) risks.push("Average daily dollar volume is below $500,000.");
  if (row.volumeTrend20VsPriorPct > 300) risks.push("Recent volume is more than four times the prior sample and may be event-driven.");
  if (row.return90Pct < -50) risks.push("The stock lost more than half its value during the recent sample.");
  if (!filings.latestPeriodicFiledAt) risks.push("No recent SEC periodic filing was resolved automatically.");
  for (const secEvidence of filings.riskEvidence) {
    risks.push(
      `${secEvidence.severity.toUpperCase()} ${secEvidence.flag} in ${secEvidence.form} filed ${secEvidence.filedAt || "unknown date"}.`,
    );
  }
  if (corporateActions.length) {
    risks.push(
      `Corporate-action lookback found: ${corporateActions.map((action) =>
        `${action.type} (${action.processDate || "date unavailable"})`
      ).join(", ")}.`,
    );
  }
  const vetoReasons = [...new Set(filings.vetoReasons)];
  const reviewReasons = [...new Set(filings.reviewReasons ?? [])];
  const executionQuality = executionEvidence.source === "alpaca-sip-quotes"
    ? clamp(1 - (executionEvidence.p90SpreadBps ?? 2_000) / 5_000, 0, 1)
      * clamp(executionEvidence.estimatedFillRatioPct / 50, 0, 1)
    : 0.1;
  const secPenalty = Math.min(
    30,
    filings.riskEvidence.reduce(
      (total, item) => total + (item.severity === "veto" ? 10 : item.severity === "warning" ? 3 : 1),
      0,
    ),
  );
  const adjustedScore = row.score
    + conservativeEv.expectedValueLowPctPerOrder * 0.5
    + executionQuality * 10
    - secPenalty
    - vetoReasons.length * 25;
  return {
    ...row,
    score: round(adjustedScore, 4),
    executionEvidence,
    conservativeEv,
    filings,
    corporateActions,
    vetoed: vetoReasons.length > 0,
    vetoReasons,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    evidence,
    risks: [...new Set(risks)],
  };
}

function normalizeAlpacaBar(value: unknown): PennyStockBar | null {
  if (!isRecord(value)) return null;
  const date = String(value.t ?? "").slice(0, 10);
  const bar = {
    date,
    open: Number(value.o),
    high: Number(value.h),
    low: Number(value.l),
    close: Number(value.c),
    volume: Number(value.v),
  };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)
    || ![bar.open, bar.high, bar.low, bar.close].every((number) => Number.isFinite(number) && number > 0)
    || !Number.isFinite(bar.volume)
    || bar.volume < 0
  ) {
    return null;
  }
  return bar;
}

function normalizeRecentBars(bars: PennyStockBar[], limit: number) {
  const unique = new Map(
    bars
      .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date))
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((bar) => [bar.date, bar]),
  );
  return [...unique.values()].slice(-limit);
}

function parseMarketNumber(value: unknown): number {
  const number = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function simpleReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] > 0) returns.push(values[index] / values[index - 1] - 1);
  }
  return returns;
}

function maxDrawdownPct(values: number[]): number {
  let peak = 0;
  let maximum = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maximum = Math.max(maximum, ((peak - value) / peak) * 100);
  }
  return maximum;
}

function percentileRank(values: number[], value: number): number {
  if (values.length <= 1) return 1;
  const below = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (below + Math.max(0, equal - 1) / 2) / (values.length - 1);
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export function conservativeExpectedValue(
  method: PennyStockResearchRow["methodEvidence"],
  execution: PennyStockExecutionEvidence,
  strategy: PennyPaperStrategy,
): PennyStockConservativeEv {
  const touch = method.limitTouchWilsonLowPct / 100;
  const bounce = method.bounceWilsonLowPct / 100;
  const spreadPct = (execution.p90SpreadBps ?? 300) / 100;
  const partialFillPenaltyPct = (1 - execution.estimatedFillRatioPct / 100) * 2;
  const roundTripFrictionPct = 2 + spreadPct + 1 + partialFillPenaltyPct;
  const conditionalOutcomePct =
    bounce * strategy.takeProfitPct
    - (1 - bounce) * strategy.stopLossPct
    - roundTripFrictionPct;
  const expectedValueLowPctPerOrder = touch * conditionalOutcomePct;
  return {
    touchProbabilityLowPct: round(touch * 100, 4),
    bounceProbabilityLowPct: round(bounce * 100, 4),
    roundTripFrictionPct: round(roundTripFrictionPct, 4),
    expectedValueLowPctPerOrder: round(expectedValueLowPctPerOrder, 4),
    positive: expectedValueLowPctPerOrder > 0,
  };
}

function wilsonLowerBound(successes: number, observations: number) {
  if (observations <= 0) return 0;
  const z = 1.959963984540054;
  const probability = successes / observations;
  const denominator = 1 + z ** 2 / observations;
  const center = probability + z ** 2 / (2 * observations);
  const margin = z * Math.sqrt(
    probability * (1 - probability) / observations
    + z ** 2 / (4 * observations ** 2),
  );
  return Math.max(0, (center - margin) / denominator);
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
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

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z.]{0,9}$/.test(symbol)) {
    if (!symbol) return "";
    throw new Error(`Invalid stock symbol "${value}".`);
  }
  return symbol;
}

function safeNormalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z.]{0,9}$/.test(symbol) ? symbol : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
