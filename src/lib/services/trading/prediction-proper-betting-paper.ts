/**
 * Prospective, research-only proper-betting paper simulation.
 *
 * The cohort is frozen before a reviewed forecast exists. A later public book
 * supplies the executable paper price after a mandatory lag. This module has no
 * authentication, signing, funding, or venue-mutation path.
 */

import {
  predictionTakerFeeUsd,
  type PredictionMarket,
  type PredictionOrderBook,
  type PredictionOutcome,
} from "./prediction-markets";

export type PredictionProperBettingPolicy = {
  id: string;
  researchOnly: true;
  startingCapitalUsd: number;
  minimumLagMs: number;
  minimumDaysToResolution: number;
  maximumDaysToResolution: number;
  haltHoursBeforeResolution: number;
  minimumLiquidityUsd: number;
  minimumNetForecastEdge: number;
  portfolioRiskFraction: number;
  maxMarketFraction: number;
  maxEventFraction: number;
  maxCategoryFraction: number;
  maxDepthFraction: number;
  minimumSettledMarkets: number;
  minimumForwardCohorts: number;
  minimumAbsoluteTStatistic: number;
  maximumPValue: number;
  bootstrapSamples: number;
  placeboTrials: number;
  maximumPbo: number;
  minimumDeflatedSharpeProbability: number;
};

export const DEFAULT_PROPER_BETTING_POLICY: PredictionProperBettingPolicy = {
  id: "polymarket-brier-proper-v1",
  researchOnly: true,
  startingCapitalUsd: 100,
  minimumLagMs: 5 * 60_000,
  minimumDaysToResolution: 2,
  maximumDaysToResolution: 14,
  haltHoursBeforeResolution: 3,
  minimumLiquidityUsd: 5_000,
  minimumNetForecastEdge: 0.02,
  portfolioRiskFraction: 0.15,
  maxMarketFraction: 0.05,
  maxEventFraction: 0.20,
  maxCategoryFraction: 0.25,
  maxDepthFraction: 0.25,
  minimumSettledMarkets: 252,
  minimumForwardCohorts: 4,
  minimumAbsoluteTStatistic: 3,
  maximumPValue: 0.01,
  bootstrapSamples: 10_000,
  placeboTrials: 2_000,
  maximumPbo: 0.5,
  minimumDeflatedSharpeProbability: 0.95,
};

export type PredictionProperBettingCandidate = {
  market: PredictionMarket;
  books: PredictionOrderBook[];
  category: string;
  eventKey?: string;
  criteriaReviewed: boolean;
};

export type PredictionProperBettingSnapshotMarket = {
  market: PredictionMarket;
  books: PredictionOrderBook[];
  category: string;
  eventKey: string;
  criteriaReviewed: true;
};

export type PredictionProperBettingSnapshot = {
  type: "prediction-proper-betting-snapshot";
  cohortId: string;
  snapshotDigest: string;
  observedAt: string;
  policyId: string;
  policy?: PredictionProperBettingPolicy;
  markets: PredictionProperBettingSnapshotMarket[];
  exclusions: Array<{ marketId: string; title: string; reason: string }>;
  claimLimit: string;
};

export type PredictionProperBettingForecastSource = {
  url: string;
  accessedAt: string;
};

export type PredictionProperBettingForecast = {
  marketId: string;
  yesProbability: number;
  rationale: string;
  sources: PredictionProperBettingForecastSource[];
  criteriaReviewed: boolean;
};

export type PredictionProperBettingForecastSet = {
  type: "prediction-proper-betting-forecasts";
  cohortId: string;
  snapshotDigest: string;
  createdAt: string;
  forecaster: string;
  forecasts: PredictionProperBettingForecast[];
};

export type PredictionProperBettingSignal = {
  marketId: string;
  eventKey: string;
  category: string;
  title: string;
  slug: string;
  resolutionDate: string;
  side: "yes" | "no";
  outcomeId: string;
  forecastYesProbability: number;
  sideProbability: number;
  marketYesMidpoint: number;
  sideMidpoint: number;
  bestAsk: number;
  feePerShare: number;
  netForecastEdge: number;
  brierGradientMagnitude: number;
};

export type PredictionProperBettingPosition = {
  arm: "brier-treatment" | "equal-notional-control";
  marketId: string;
  eventKey: string;
  category: string;
  title: string;
  slug: string;
  resolutionDate: string;
  side: "yes" | "no";
  outcomeId: string;
  forecastYesProbability: number;
  marketYesMidpoint: number;
  netForecastEdge: number;
  brierGradientMagnitude: number;
  shares: number;
  averagePrice: number;
  grossCostUsd: number;
  feeUsd: number;
  capitalUsd: number;
  status: "open";
};

export type PredictionProperBettingRun = {
  type: "prediction-proper-betting-paper-run";
  runId: string;
  cohortId: string;
  snapshotDigest: string;
  policy: PredictionProperBettingPolicy;
  forecastCreatedAt: string;
  fillObservedAt: string;
  researchOnly: true;
  ordersSubmitted: 0;
  signals: PredictionProperBettingSignal[];
  rejections: Array<{ marketId: string; title: string; reason: string }>;
  positions: PredictionProperBettingPosition[];
  arms: {
    "brier-treatment": { startingCapitalUsd: number; deployedCapitalUsd: number; cashUsd: number };
    "equal-notional-control": { startingCapitalUsd: number; deployedCapitalUsd: number; cashUsd: number };
    cash: { startingCapitalUsd: number; deployedCapitalUsd: 0; cashUsd: number };
  };
  claimLimit: string;
};

type SettlementArm = {
  positions: number;
  capitalUsd: number;
  payoutUsd: number;
  pnlUsd: number;
  returnOnStartingCapital: number;
  positivePositions: number;
  negativePositions: number;
};

export type PredictionProperBettingSettlement = {
  type: "prediction-proper-betting-settlement";
  runId: string;
  settledMarkets: number;
  forecasterBrierScore: number;
  marketBrierScore: number;
  arms: {
    "brier-treatment": SettlementArm;
    "equal-notional-control": SettlementArm;
    cash: SettlementArm;
  };
  readiness: { ready: false; reasons: string[] };
  claimLimit: "Open or undersized paper cohorts cannot establish future or constant profit.";
};

type FillMarket = {
  market: PredictionMarket;
  books: PredictionOrderBook[];
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

function finiteTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp.`);
  return parsed;
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function outcomeByLabel(market: PredictionMarket, label: "yes" | "no"): PredictionOutcome | undefined {
  return market.outcomes.find((outcome) => outcome.label.trim().toLowerCase() === label);
}

function bookByOutcome(books: PredictionOrderBook[], outcomeId: string): PredictionOrderBook | undefined {
  return books.find((book) => book.outcomeId === outcomeId);
}

function midpoint(book?: PredictionOrderBook): number | null {
  if (book?.midpoint != null && book.midpoint > 0 && book.midpoint < 1) return book.midpoint;
  const bid = book?.bids[0]?.price;
  const ask = book?.asks[0]?.price;
  return bid != null && ask != null ? (bid + ask) / 2 : null;
}

function eligibilityReason(
  candidate: PredictionProperBettingCandidate,
  observedAtMs: number,
  policy: PredictionProperBettingPolicy,
): string | null {
  const { market } = candidate;
  if (!candidate.criteriaReviewed) return "Resolution criteria require an explicit analyst review.";
  if (market.status !== "active" || !market.acceptingOrders) return "The market is not active and accepting orders.";
  const yes = outcomeByLabel(market, "yes");
  const no = outcomeByLabel(market, "no");
  if (market.outcomes.length !== 2 || !yes || !no) return "Only reviewed binary Yes/No markets are eligible.";
  if (market.liquidity < policy.minimumLiquidityUsd) {
    return `Liquidity is below the $${policy.minimumLiquidityUsd.toLocaleString("en-US")} floor.`;
  }
  if (market.feesEnabled && !market.feeSchedule) {
    return "The fee-enabled market is missing its live fee schedule.";
  }
  const resolutionMs = market.resolutionDate ? Date.parse(market.resolutionDate) : Number.NaN;
  if (!Number.isFinite(resolutionMs)) return "A valid resolution timestamp is required.";
  const days = (resolutionMs - observedAtMs) / DAY_MS;
  if (days < policy.minimumDaysToResolution || days > policy.maximumDaysToResolution) {
    return `Resolution must be ${policy.minimumDaysToResolution}-${policy.maximumDaysToResolution} days after the snapshot.`;
  }
  const text = `${market.title} ${market.description}`.toLowerCase();
  if (/\b(mentions?|tweets?|posts? on x)\b/.test(text)) return "Mentions and social-post counting markets are excluded.";
  const yesBook = bookByOutcome(candidate.books, yes.id);
  const noBook = bookByOutcome(candidate.books, no.id);
  if (!yesBook?.bids.length || !yesBook.asks.length || !noBook?.bids.length || !noBook.asks.length) {
    return "Both outcomes require two-sided executable books at the frozen snapshot.";
  }
  return null;
}

export function createProperBettingSnapshot(input: {
  cohortId: string;
  snapshotDigest: string;
  observedAt: string;
  policy?: PredictionProperBettingPolicy;
  candidates: PredictionProperBettingCandidate[];
}): PredictionProperBettingSnapshot {
  const policy = input.policy ?? DEFAULT_PROPER_BETTING_POLICY;
  if (!policy.researchOnly) throw new Error("Proper-betting experiments must remain research-only.");
  if (!/^[a-z0-9][a-z0-9-]{5,100}$/i.test(input.cohortId)) throw new Error("A stable cohort id is required.");
  if (!input.snapshotDigest.trim()) throw new Error("A snapshot digest is required.");
  const observedAtMs = finiteTimestamp(input.observedAt, "Snapshot observedAt");
  const markets: PredictionProperBettingSnapshotMarket[] = [];
  const exclusions: PredictionProperBettingSnapshot["exclusions"] = [];
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (seen.has(candidate.market.id)) {
      exclusions.push({
        marketId: candidate.market.id,
        title: candidate.market.title,
        reason: "Duplicate market in the same prospective cohort.",
      });
      continue;
    }
    seen.add(candidate.market.id);
    const reason = eligibilityReason(candidate, observedAtMs, policy);
    if (reason) {
      exclusions.push({ marketId: candidate.market.id, title: candidate.market.title, reason });
      continue;
    }
    markets.push({
      market: candidate.market,
      books: candidate.books,
      category: candidate.category.trim() || "Uncategorized",
      eventKey: candidate.eventKey?.trim() || candidate.market.eventId || candidate.market.id,
      criteriaReviewed: true,
    });
  }
  return {
    type: "prediction-proper-betting-snapshot",
    cohortId: input.cohortId,
    snapshotDigest: input.snapshotDigest,
    observedAt: new Date(observedAtMs).toISOString(),
    policyId: policy.id,
    policy,
    markets,
    exclusions,
    claimLimit: "A frozen cohort contains no forecast, fill, outcome, or profit evidence.",
  };
}

export function validateProperBettingForecasts(
  snapshot: PredictionProperBettingSnapshot,
  forecastSet: PredictionProperBettingForecastSet,
  policy: PredictionProperBettingPolicy = snapshot.policy ?? DEFAULT_PROPER_BETTING_POLICY,
): PredictionProperBettingForecast[] {
  if (forecastSet.type !== "prediction-proper-betting-forecasts") throw new Error("Invalid forecast artifact type.");
  if (forecastSet.cohortId !== snapshot.cohortId) throw new Error("Forecast cohort does not match the snapshot.");
  if (forecastSet.snapshotDigest !== snapshot.snapshotDigest) throw new Error("Forecast snapshot digest does not match.");
  if (!forecastSet.forecaster.trim()) throw new Error("A reviewed forecaster identity is required.");
  const snapshotMs = finiteTimestamp(snapshot.observedAt, "Snapshot observedAt");
  const createdMs = finiteTimestamp(forecastSet.createdAt, "Forecast createdAt");
  if (createdMs < snapshotMs) throw new Error("Forecasts cannot predate the frozen snapshot.");
  const expected = new Set(snapshot.markets.map((entry) => entry.market.id));
  if (forecastSet.forecasts.length !== expected.size) {
    throw new Error("The reviewed forecast set must cover every included snapshot market exactly once.");
  }
  const seen = new Set<string>();
  for (const forecast of forecastSet.forecasts) {
    if (!expected.has(forecast.marketId)) throw new Error(`Forecast market ${forecast.marketId} is not in the snapshot.`);
    if (seen.has(forecast.marketId)) throw new Error(`Forecast market ${forecast.marketId} is duplicated.`);
    seen.add(forecast.marketId);
    if (!(forecast.yesProbability > 0 && forecast.yesProbability < 1)) {
      throw new Error(`Forecast ${forecast.marketId} must be strictly between 0 and 1.`);
    }
    if (!forecast.criteriaReviewed) throw new Error(`Forecast ${forecast.marketId} requires criteria review.`);
    if (forecast.rationale.trim().length < 40) {
      throw new Error(`Forecast ${forecast.marketId} needs a substantive rationale.`);
    }
    if (!forecast.sources.length) throw new Error(`Forecast ${forecast.marketId} needs at least one source.`);
    for (const source of forecast.sources) {
      const url = new URL(source.url);
      if (url.protocol !== "https:") throw new Error(`Forecast ${forecast.marketId} sources must use HTTPS.`);
      const accessedMs = finiteTimestamp(source.accessedAt, "Source accessedAt");
      if (accessedMs < snapshotMs || accessedMs > createdMs) {
        throw new Error(`Forecast ${forecast.marketId} source timestamps must fall between snapshot and forecast creation.`);
      }
    }
    const entry = snapshot.markets.find((candidate) => candidate.market.id === forecast.marketId);
    const resolutionMs = finiteTimestamp(entry?.market.resolutionDate ?? "", "Market resolutionDate");
    if (createdMs >= resolutionMs - policy.haltHoursBeforeResolution * HOUR_MS) {
      throw new Error(`Forecast ${forecast.marketId} was created inside the resolution halt window.`);
    }
  }
  return forecastSet.forecasts;
}

function buildSignal(input: {
  entry: PredictionProperBettingSnapshotMarket;
  forecast: PredictionProperBettingForecast;
  fill: FillMarket;
  fillObservedAtMs: number;
  policy: PredictionProperBettingPolicy;
}): { signal?: PredictionProperBettingSignal; reason?: string } {
  const { market, books } = input.fill;
  if (market.id !== input.entry.market.id) return { reason: "The fill market id differs from the frozen market." };
  if (market.status !== "active" || !market.acceptingOrders) return { reason: "The market stopped accepting orders before the lagged fill." };
  if (market.feesEnabled && !market.feeSchedule) return { reason: "The lagged fee schedule is unavailable." };
  const resolutionDate = market.resolutionDate;
  if (!resolutionDate) return { reason: "The lagged market has no valid resolution timestamp." };
  const resolutionMs = Date.parse(resolutionDate);
  if (!Number.isFinite(resolutionMs)) return { reason: "The lagged market has no valid resolution timestamp." };
  if (input.fillObservedAtMs >= resolutionMs - input.policy.haltHoursBeforeResolution * HOUR_MS) {
    return { reason: "The lagged fill falls inside the resolution halt window." };
  }
  const yes = outcomeByLabel(market, "yes");
  const no = outcomeByLabel(market, "no");
  if (!yes || !no) return { reason: "The lagged market is no longer a binary Yes/No contract." };
  const yesBook = bookByOutcome(books, yes.id);
  const noBook = bookByOutcome(books, no.id);
  const yesMidpoint = midpoint(yesBook);
  const noMidpoint = midpoint(noBook);
  const yesAsk = yesBook?.asks[0]?.price;
  const noAsk = noBook?.asks[0]?.price;
  if (yesMidpoint == null || noMidpoint == null || yesAsk == null || noAsk == null) {
    return { reason: "The lagged snapshot lacks a two-sided midpoint and executable ask for both outcomes." };
  }
  const schedule = market.feesEnabled ? market.feeSchedule : undefined;
  const yesFee = predictionTakerFeeUsd({ shares: 1, price: yesAsk, feeSchedule: schedule });
  const noFee = predictionTakerFeeUsd({ shares: 1, price: noAsk, feeSchedule: schedule });
  const yesEdge = input.forecast.yesProbability - yesAsk - yesFee;
  const noProbability = 1 - input.forecast.yesProbability;
  const noEdge = noProbability - noAsk - noFee;
  const side = yesEdge >= noEdge ? "yes" : "no";
  const netForecastEdge = side === "yes" ? yesEdge : noEdge;
  if (netForecastEdge < input.policy.minimumNetForecastEdge) {
    return { reason: `Neither outcome clears the ${round(input.policy.minimumNetForecastEdge * 100, 2)}% net forecast-edge floor.` };
  }
  const outcome = side === "yes" ? yes : no;
  const sideProbability = side === "yes" ? input.forecast.yesProbability : noProbability;
  return {
    signal: {
      marketId: market.id,
      eventKey: input.entry.eventKey,
      category: input.entry.category,
      title: market.title,
      slug: market.slug,
      resolutionDate,
      side,
      outcomeId: outcome.id,
      forecastYesProbability: input.forecast.yesProbability,
      sideProbability,
      marketYesMidpoint: yesMidpoint,
      sideMidpoint: side === "yes" ? yesMidpoint : noMidpoint,
      bestAsk: side === "yes" ? yesAsk : noAsk,
      feePerShare: side === "yes" ? yesFee : noFee,
      netForecastEdge,
      brierGradientMagnitude: 2 * Math.abs(input.forecast.yesProbability - yesMidpoint),
    },
  };
}

function allocateTreatment(
  signals: PredictionProperBettingSignal[],
  policy: PredictionProperBettingPolicy,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const totalWeight = signals.reduce((sum, signal) => sum + signal.brierGradientMagnitude, 0);
  if (!(totalWeight > 0)) return allocations;
  const portfolioBudget = policy.startingCapitalUsd * policy.portfolioRiskFraction;
  const marketCap = policy.startingCapitalUsd * policy.maxMarketFraction;
  const eventCap = policy.startingCapitalUsd * policy.maxEventFraction;
  const categoryCap = policy.startingCapitalUsd * policy.maxCategoryFraction;
  const eventUsed = new Map<string, number>();
  const categoryUsed = new Map<string, number>();
  for (const signal of signals) {
    const proportional = portfolioBudget * signal.brierGradientMagnitude / totalWeight;
    const eventRemaining = Math.max(0, eventCap - (eventUsed.get(signal.eventKey) ?? 0));
    const categoryRemaining = Math.max(0, categoryCap - (categoryUsed.get(signal.category) ?? 0));
    const allocation = Math.max(0, Math.min(proportional, marketCap, eventRemaining, categoryRemaining));
    allocations.set(signal.marketId, allocation);
    eventUsed.set(signal.eventKey, (eventUsed.get(signal.eventKey) ?? 0) + allocation);
    categoryUsed.set(signal.category, (categoryUsed.get(signal.category) ?? 0) + allocation);
  }
  return allocations;
}

function fillPosition(input: {
  arm: PredictionProperBettingPosition["arm"];
  signal: PredictionProperBettingSignal;
  fill: FillMarket;
  targetCapitalUsd: number;
  policy: PredictionProperBettingPolicy;
}): PredictionProperBettingPosition | null {
  if (!(input.targetCapitalUsd > 0)) return null;
  const market = input.fill.market;
  const book = bookByOutcome(input.fill.books, input.signal.outcomeId);
  if (!book?.asks.length) return null;
  const schedule = market.feesEnabled ? market.feeSchedule : undefined;
  let remainingCapital = input.targetCapitalUsd;
  let shares = 0;
  let grossCostUsd = 0;
  let feeUsd = 0;
  for (const level of book.asks) {
    const feePerShare = predictionTakerFeeUsd({ shares: 1, price: level.price, feeSchedule: schedule });
    const capitalPerShare = level.price + feePerShare;
    const displayedShares = level.size * input.policy.maxDepthFraction;
    let levelShares = Math.min(displayedShares, remainingCapital / capitalPerShare);
    if (!(levelShares > 1e-9)) continue;
    let levelCost = levelShares * level.price;
    let levelFee = predictionTakerFeeUsd({ shares: levelShares, price: level.price, feeSchedule: schedule });
    if (levelCost + levelFee > remainingCapital) {
      levelShares *= remainingCapital / (levelCost + levelFee);
      levelCost = levelShares * level.price;
      levelFee = predictionTakerFeeUsd({ shares: levelShares, price: level.price, feeSchedule: schedule });
    }
    shares += levelShares;
    grossCostUsd += levelCost;
    feeUsd += levelFee;
    remainingCapital -= levelCost + levelFee;
    if (remainingCapital <= 1e-6) break;
  }
  const minimumShares = Math.max(market.minimumOrderSize, book.minimumOrderSize);
  if (!(shares > 0) || shares + 1e-9 < minimumShares) return null;
  const capitalUsd = grossCostUsd + feeUsd;
  return {
    arm: input.arm,
    marketId: input.signal.marketId,
    eventKey: input.signal.eventKey,
    category: input.signal.category,
    title: input.signal.title,
    slug: input.signal.slug,
    resolutionDate: input.signal.resolutionDate,
    side: input.signal.side,
    outcomeId: input.signal.outcomeId,
    forecastYesProbability: input.signal.forecastYesProbability,
    marketYesMidpoint: input.signal.marketYesMidpoint,
    netForecastEdge: round(input.signal.netForecastEdge),
    brierGradientMagnitude: round(input.signal.brierGradientMagnitude),
    shares: round(shares),
    averagePrice: round(grossCostUsd / shares),
    grossCostUsd: round(grossCostUsd),
    feeUsd: round(feeUsd),
    capitalUsd: round(capitalUsd),
    status: "open",
  };
}

function armCapital(positions: PredictionProperBettingPosition[], arm: PredictionProperBettingPosition["arm"], starting: number) {
  const deployedCapitalUsd = round(
    positions.filter((position) => position.arm === arm).reduce((sum, position) => sum + position.capitalUsd, 0),
  );
  return { startingCapitalUsd: starting, deployedCapitalUsd, cashUsd: round(starting - deployedCapitalUsd) };
}

export function simulateProperBettingCohort(input: {
  snapshot: PredictionProperBettingSnapshot;
  forecasts: PredictionProperBettingForecastSet;
  fillObservedAt: string;
  fillMarkets: FillMarket[];
  policy?: PredictionProperBettingPolicy;
}): PredictionProperBettingRun {
  const policy = input.policy ?? input.snapshot.policy ?? DEFAULT_PROPER_BETTING_POLICY;
  if (!policy.researchOnly) throw new Error("Proper-betting experiments must remain research-only.");
  if (input.snapshot.policyId !== policy.id) throw new Error("The paper policy differs from the frozen cohort policy.");
  const forecasts = validateProperBettingForecasts(input.snapshot, input.forecasts, policy);
  const forecastCreatedMs = finiteTimestamp(input.forecasts.createdAt, "Forecast createdAt");
  const fillObservedAtMs = finiteTimestamp(input.fillObservedAt, "Fill observedAt");
  if (fillObservedAtMs - forecastCreatedMs < policy.minimumLagMs) {
    throw new Error(`The paper fill must observe an execution lag of at least ${policy.minimumLagMs}ms.`);
  }
  const forecastByMarket = new Map(forecasts.map((forecast) => [forecast.marketId, forecast]));
  const fillByMarket = new Map(input.fillMarkets.map((fill) => [fill.market.id, fill]));
  const signals: PredictionProperBettingSignal[] = [];
  const rejections: PredictionProperBettingRun["rejections"] = [];
  for (const entry of input.snapshot.markets) {
    const forecast = forecastByMarket.get(entry.market.id);
    const fill = fillByMarket.get(entry.market.id);
    if (!forecast || !fill) {
      rejections.push({ marketId: entry.market.id, title: entry.market.title, reason: "Forecast or lagged fill evidence is missing." });
      continue;
    }
    const result = buildSignal({ entry, forecast, fill, fillObservedAtMs, policy });
    if (result.signal) signals.push(result.signal);
    else rejections.push({ marketId: entry.market.id, title: entry.market.title, reason: result.reason ?? "No eligible signal." });
  }
  const treatmentTargets = allocateTreatment(signals, policy);
  const positions: PredictionProperBettingPosition[] = [];
  for (const signal of signals) {
    const fill = fillByMarket.get(signal.marketId);
    const targetCapitalUsd = treatmentTargets.get(signal.marketId) ?? 0;
    const position = fill && fillPosition({
      arm: "brier-treatment",
      signal,
      fill,
      targetCapitalUsd,
      policy,
    });
    if (position) positions.push(position);
    else rejections.push({ marketId: signal.marketId, title: signal.title, reason: "Brier allocation did not meet executable displayed depth or minimum-size rules." });
  }
  const treatmentPositions = positions.filter((position) => position.arm === "brier-treatment");
  const treatmentCapitalUsd = treatmentPositions.reduce((sum, position) => sum + position.capitalUsd, 0);
  const controlTargetUsd = treatmentPositions.length > 0 ? treatmentCapitalUsd / treatmentPositions.length : 0;
  for (const treatment of treatmentPositions) {
    const signal = signals.find((candidate) => candidate.marketId === treatment.marketId);
    const fill = fillByMarket.get(treatment.marketId);
    const position = signal && fill && fillPosition({
      arm: "equal-notional-control",
      signal,
      fill,
      targetCapitalUsd: controlTargetUsd,
      policy,
    });
    if (position) positions.push(position);
    else rejections.push({ marketId: treatment.marketId, title: treatment.title, reason: "Equal-notional control did not meet executable displayed depth or minimum-size rules." });
  }
  const safeFillIso = new Date(fillObservedAtMs).toISOString();
  return {
    type: "prediction-proper-betting-paper-run",
    runId: `${input.snapshot.cohortId}-${safeFillIso.replace(/[-:.TZ]/g, "")}`,
    cohortId: input.snapshot.cohortId,
    snapshotDigest: input.snapshot.snapshotDigest,
    policy,
    forecastCreatedAt: new Date(forecastCreatedMs).toISOString(),
    fillObservedAt: safeFillIso,
    researchOnly: true,
    ordersSubmitted: 0,
    signals,
    rejections,
    positions,
    arms: {
      "brier-treatment": armCapital(positions, "brier-treatment", policy.startingCapitalUsd),
      "equal-notional-control": armCapital(positions, "equal-notional-control", policy.startingCapitalUsd),
      cash: { startingCapitalUsd: policy.startingCapitalUsd, deployedCapitalUsd: 0, cashUsd: policy.startingCapitalUsd },
    },
    claimLimit: "Paper fills are prospective evidence only; unresolved positions have no realized profit.",
  };
}

function settleArm(
  positions: PredictionProperBettingPosition[],
  outcomes: Map<string, "yes" | "no">,
  startingCapitalUsd: number,
): SettlementArm {
  const rows = positions.flatMap((position) => {
    const outcome = outcomes.get(position.marketId);
    if (!outcome) return [];
    const payoutUsd = position.side === outcome ? position.shares : 0;
    return [{ capitalUsd: position.capitalUsd, payoutUsd, pnlUsd: payoutUsd - position.capitalUsd }];
  });
  const capitalUsd = rows.reduce((sum, row) => sum + row.capitalUsd, 0);
  const payoutUsd = rows.reduce((sum, row) => sum + row.payoutUsd, 0);
  const pnlUsd = rows.reduce((sum, row) => sum + row.pnlUsd, 0);
  return {
    positions: rows.length,
    capitalUsd: round(capitalUsd),
    payoutUsd: round(payoutUsd),
    pnlUsd: round(pnlUsd),
    returnOnStartingCapital: round(pnlUsd / startingCapitalUsd),
    positivePositions: rows.filter((row) => row.pnlUsd > 0).length,
    negativePositions: rows.filter((row) => row.pnlUsd < 0).length,
  };
}

export function settleProperBettingCohort(
  run: PredictionProperBettingRun,
  outcomes: Map<string, "yes" | "no">,
): PredictionProperBettingSettlement {
  const signalRows = run.signals.flatMap((signal) => {
    const outcome = outcomes.get(signal.marketId);
    if (!outcome) return [];
    return [{ signal, observed: outcome === "yes" ? 1 : 0 }];
  });
  const brier = (probability: number, observed: number) => (probability - observed) ** 2;
  const mean = (values: number[]) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : Number.NaN;
  const settledMarkets = signalRows.length;
  const reasons = [
    settledMarkets < run.policy.minimumSettledMarkets
      ? `${run.policy.minimumSettledMarkets} settled markets are required; this artifact has ${settledMarkets}.`
      : null,
    `At least ${run.policy.minimumForwardCohorts} non-overlapping forward cohorts are required.`,
    `The aggregate validator must still run ${run.policy.bootstrapSamples.toLocaleString("en-US")} bootstrap samples, ${run.policy.placeboTrials.toLocaleString("en-US")} placebo trials, HAC inference, FDR, PBO, deflated Sharpe, and regime/concentration checks.`,
  ].filter((reason): reason is string => Boolean(reason));
  const starting = run.policy.startingCapitalUsd;
  return {
    type: "prediction-proper-betting-settlement",
    runId: run.runId,
    settledMarkets,
    forecasterBrierScore: round(mean(signalRows.map(({ signal, observed }) => brier(signal.forecastYesProbability, observed)))),
    marketBrierScore: round(mean(signalRows.map(({ signal, observed }) => brier(signal.marketYesMidpoint, observed)))),
    arms: {
      "brier-treatment": settleArm(
        run.positions.filter((position) => position.arm === "brier-treatment"),
        outcomes,
        starting,
      ),
      "equal-notional-control": settleArm(
        run.positions.filter((position) => position.arm === "equal-notional-control"),
        outcomes,
        starting,
      ),
      cash: {
        positions: 0,
        capitalUsd: 0,
        payoutUsd: 0,
        pnlUsd: 0,
        returnOnStartingCapital: 0,
        positivePositions: 0,
        negativePositions: 0,
      },
    },
    readiness: { ready: false, reasons },
    claimLimit: "Open or undersized paper cohorts cannot establish future or constant profit.",
  };
}
