/**
 * Research-only prediction-market arbitrage matrix.
 *
 * Every fill is modeled from public executable book depth. This module has no
 * wallet, signing, credential, or order-submission path.
 */

import {
  fetchPredictionEvents,
  fetchPredictionOrderBooks,
  predictionTakerFeeUsd,
  simulatePredictionComplementArbitrage,
  type PredictionComplementArbitrageQuote,
  type PredictionEvent,
  type PredictionFeeSchedule,
  type PredictionMarket,
  type PredictionOrderBook,
  type PredictionOrderLevel,
  type PredictionOutcome,
} from "./prediction-markets";

export type PredictionArbitrageStrategy =
  | "binary-complete-set-sell"
  | "negative-risk-buy-all"
  | "negative-risk-convert-no"
  | "logical-implication";

export type PredictionArbitrageClassification =
  | "locked-after-complete-fills"
  | "execution-risk"
  | "criteria-review"
  | "non-guaranteed";

export type PredictionArbitrageResearchLeg = {
  marketId: string;
  outcomeId: string;
  outcome: string;
  action: "buy" | "sell";
  price: number;
  availableShares: number;
};

export type PredictionArbitrageResearchFill = {
  shares: number;
  capitalUsd: number;
  grossCostUsd: number;
  grossProceedsUsd: number;
  feeUsd: number;
  payoutUsd: number;
  pnlUsd: number;
  roi: number;
};

export type PredictionArbitrageResearchQuote = {
  observedAt: string;
  strategy: PredictionArbitrageStrategy;
  classification: PredictionArbitrageClassification;
  eventId?: string;
  eventTitle?: string;
  marketId?: string;
  title: string;
  legs: PredictionArbitrageResearchLeg[];
  rawEdgePerShare: number | null;
  takerFeePerShare: number | null;
  netEdgePerShare: number | null;
  bankrollUsd: number;
  decision: "paper-filled" | "rejected";
  reason: string;
  paperFill: PredictionArbitrageResearchFill | null;
};

export type PredictionLogicalRelation = {
  kind: "deadline" | "upward-threshold" | "downward-threshold";
  eventId: string;
  eventTitle: string;
  buyYesMarketId: string;
  buyNoMarketId: string;
  easierTitle: string;
  harderTitle: string;
  rationale: string;
};

export type PredictionMakerResearchCandidate = {
  eventId: string;
  marketId: string;
  conditionId: string;
  title: string;
  outcome: string;
  outcomeId: string;
  complementOutcomeId: string;
  resolutionDate?: string;
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  complementBestBid: number | null;
  spreadPerShare: number;
  rewardEligible: boolean;
  rewardsMinSize: number;
  rewardsMaxSpread: number;
  makerFeeRate: 0;
  modeledRebatePerFilledShare: number;
  classification: "non-guaranteed";
  reason: string;
};

export type PredictionArbitrageUniverseScan = {
  observedAt: string;
  events: PredictionEvent[];
  eventCount: number;
  marketCount: number;
  requestedBookCount: number;
  returnedBookCount: number;
  bookErrors: string[];
  binaryCompleteSetBuys: PredictionComplementArbitrageQuote[];
  binaryCompleteSetSells: PredictionArbitrageResearchQuote[];
  negativeRiskBuyAll: PredictionArbitrageResearchQuote[];
  negativeRiskConversions: PredictionArbitrageResearchQuote[];
  logicalRelations: PredictionArbitrageResearchQuote[];
  makerCandidates: PredictionMakerResearchCandidate[];
};

type ResearchOptions = {
  bankrollUsd?: number;
  maxDepthFraction?: number;
  minimumNetEdgePerShare?: number;
  now?: Date;
};

type PricedLeg = {
  market: PredictionMarket;
  outcome: PredictionOutcome;
  book: PredictionOrderBook;
  action: "buy" | "sell";
};

type MutableLevel = PredictionOrderLevel & { remaining: number };

const MONTHS = new Map([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11],
]);

function paperBankroll(value?: number): number {
  const requested = Number.isFinite(value) ? Number(value) : 100;
  const rounded = Math.round(Math.max(0, requested) * 100) / 100;
  if (rounded < 1 || rounded > 100_000) throw new Error("Paper bankroll must be between $1 and $100,000.");
  return rounded;
}

function depthFraction(value?: number): number {
  return Math.min(1, Math.max(0.01, Number.isFinite(value) ? Number(value) : 0.25));
}

function minimumEdge(value?: number): number {
  return Math.max(0, Number.isFinite(value) ? Number(value) : 0);
}

function scheduleFor(market: PredictionMarket): PredictionFeeSchedule | undefined {
  return market.feesEnabled ? market.feeSchedule : undefined;
}

function hasUnknownFeeSchedule(legs: PricedLeg[]): boolean {
  return legs.some((leg) => leg.market.feesEnabled && !leg.market.feeSchedule);
}

function takerFeePerShare(price: number, schedule?: PredictionFeeSchedule): number {
  if (!schedule || schedule.rate <= 0 || price <= 0 || price >= 1) return 0;
  return schedule.rate * (price * (1 - price)) ** schedule.exponent;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function outcomeByLabel(market: PredictionMarket, label: "yes" | "no"): PredictionOutcome | undefined {
  return market.outcomes.find((outcome) => outcome.label.trim().toLowerCase() === label);
}

function bookMap(books: PredictionOrderBook[]): Map<string, PredictionOrderBook> {
  return new Map(books.map((book) => [book.outcomeId, book]));
}

function topResearchLeg(leg: PricedLeg): PredictionArbitrageResearchLeg | null {
  const level = leg.action === "buy" ? leg.book.asks[0] : leg.book.bids[0];
  return level ? {
    marketId: leg.market.id,
    outcomeId: leg.outcome.id,
    outcome: leg.outcome.label,
    action: leg.action,
    price: level.price,
    availableShares: level.size,
  } : null;
}

function quoteBase(input: {
  strategy: PredictionArbitrageStrategy;
  classification: PredictionArbitrageClassification;
  title: string;
  event?: PredictionEvent;
  market?: PredictionMarket;
  legs: PredictionArbitrageResearchLeg[];
  rawEdgePerShare: number | null;
  takerFeePerShare: number | null;
  netEdgePerShare: number | null;
  bankrollUsd: number;
  now?: Date;
}): Omit<PredictionArbitrageResearchQuote, "decision" | "reason" | "paperFill"> {
  return {
    observedAt: (input.now ?? new Date()).toISOString(),
    strategy: input.strategy,
    classification: input.classification,
    eventId: input.event?.id ?? input.market?.eventId,
    eventTitle: input.event?.title,
    marketId: input.market?.id,
    title: input.title,
    legs: input.legs,
    rawEdgePerShare: input.rawEdgePerShare,
    takerFeePerShare: input.takerFeePerShare,
    netEdgePerShare: input.netEdgePerShare,
    bankrollUsd: input.bankrollUsd,
  };
}

function reject(
  base: Omit<PredictionArbitrageResearchQuote, "decision" | "reason" | "paperFill">,
  reason: string,
): PredictionArbitrageResearchQuote {
  return { ...base, decision: "rejected", reason, paperFill: null };
}

function minimumSharesFor(legs: PricedLeg[]): number {
  return Math.max(0, ...legs.map((leg) => Math.max(leg.market.minimumOrderSize, leg.book.minimumOrderSize)));
}

function activeLevels(leg: PricedLeg, fraction: number): MutableLevel[] {
  const source = leg.action === "buy" ? leg.book.asks : leg.book.bids;
  return source.map((level) => ({ ...level, remaining: level.size * fraction }));
}

function advanceEmptyLevels(levels: MutableLevel[][], indexes: number[]): void {
  for (let index = 0; index < levels.length; index += 1) {
    while (indexes[index] < levels[index].length && levels[index][indexes[index]].remaining <= 1e-9) {
      indexes[index] += 1;
    }
  }
}

function currentLevels(levels: MutableLevel[][], indexes: number[]): MutableLevel[] | null {
  if (levels.some((rows, index) => indexes[index] >= rows.length)) return null;
  return levels.map((rows, index) => rows[indexes[index]]);
}

function actualFees(legs: PricedLeg[], levels: MutableLevel[], shares: number): number {
  return legs.reduce((sum, leg, index) => sum + predictionTakerFeeUsd({
    shares,
    price: levels[index].price,
    feeSchedule: scheduleFor(leg.market),
  }), 0);
}

function topEdges(legs: PricedLeg[], payoffPerShare: number, mode: "buy-payout" | "sell-proceeds" | "conversion"): {
  raw: number | null;
  fees: number | null;
  net: number | null;
} {
  const levels = legs.map((leg) => leg.action === "buy" ? leg.book.asks[0] : leg.book.bids[0]);
  if (levels.some((level) => !level)) return { raw: null, fees: null, net: null };
  const prices = levels.map((level) => level?.price ?? 0);
  const fees = legs.reduce((sum, leg, index) => sum + takerFeePerShare(prices[index], scheduleFor(leg.market)), 0);
  if (mode === "buy-payout") {
    const raw = payoffPerShare - prices.reduce((sum, price) => sum + price, 0);
    return { raw, fees, net: raw - fees };
  }
  if (mode === "sell-proceeds") {
    const raw = prices.reduce((sum, price) => sum + price, 0) - payoffPerShare;
    return { raw, fees, net: raw - fees };
  }
  const buyPrice = prices[0];
  const sellProceeds = prices.slice(1).reduce((sum, price) => sum + price, 0);
  const raw = sellProceeds - buyPrice;
  return { raw, fees, net: raw - fees };
}

function simulateBuyPayoutBasket(input: {
  strategy: PredictionArbitrageStrategy;
  classification: PredictionArbitrageClassification;
  title: string;
  event?: PredictionEvent;
  market?: PredictionMarket;
  legs: PricedLeg[];
  payoffPerShare: number;
  reason: string;
  options: ResearchOptions;
}): PredictionArbitrageResearchQuote {
  const bankrollUsd = paperBankroll(input.options.bankrollUsd);
  const edges = topEdges(input.legs, input.payoffPerShare, "buy-payout");
  const base = quoteBase({
    strategy: input.strategy,
    classification: input.classification,
    title: input.title,
    event: input.event,
    market: input.market,
    legs: input.legs.map(topResearchLeg).filter((leg): leg is PredictionArbitrageResearchLeg => Boolean(leg)),
    rawEdgePerShare: edges.raw,
    takerFeePerShare: edges.fees,
    netEdgePerShare: edges.net,
    bankrollUsd,
    now: input.options.now,
  });
  if (input.legs.some((leg) => !leg.book.asks.length)) {
    return reject(base, "Every guaranteed-payout leg needs an executable ask.");
  }
  if (hasUnknownFeeSchedule(input.legs)) {
    return reject(base, "A fee-enabled leg is missing its live fee schedule, so profitability cannot be verified.");
  }
  const edgeFloor = minimumEdge(input.options.minimumNetEdgePerShare);
  if (edges.net == null || edges.net <= edgeFloor) {
    return reject(base, edges.raw != null && edges.raw > 0
      ? "The raw basket discount is erased by taker fees."
      : "The executable basket does not cost less than its minimum payout.");
  }

  const levels = input.legs.map((leg) => activeLevels(leg, depthFraction(input.options.maxDepthFraction)));
  const indexes = levels.map(() => 0);
  let shares = 0;
  let grossCostUsd = 0;
  let feeUsd = 0;
  while (true) {
    advanceEmptyLevels(levels, indexes);
    const current = currentLevels(levels, indexes);
    if (!current) break;
    const unitGrossCost = current.reduce((sum, level) => sum + level.price, 0);
    const unitFees = input.legs.reduce(
      (sum, leg, index) => sum + takerFeePerShare(current[index].price, scheduleFor(leg.market)),
      0,
    );
    const unitCapital = unitGrossCost + unitFees;
    if (input.payoffPerShare - unitCapital <= edgeFloor) break;
    const availableShares = Math.min(...current.map((level) => level.remaining));
    const capitalUsd = grossCostUsd + feeUsd;
    const roundingReserve = input.legs.length * 0.00001;
    const budgetShares = Math.max(0, bankrollUsd - capitalUsd - roundingReserve) / unitCapital;
    const fillShares = Math.min(availableShares, budgetShares);
    if (!(fillShares > 1e-9)) break;
    grossCostUsd += fillShares * unitGrossCost;
    feeUsd += actualFees(input.legs, current, fillShares);
    shares += fillShares;
    current.forEach((level) => { level.remaining -= fillShares; });
  }
  if (!(shares > 0)) return reject(base, "No displayed equal-share depth remains positive after costs.");
  const minimumShares = minimumSharesFor(input.legs);
  if (shares < minimumShares) {
    return reject(base, `Every leg must contain at least ${minimumShares.toFixed(2)} shares.`);
  }
  const capitalUsd = grossCostUsd + feeUsd;
  const payoutUsd = shares * input.payoffPerShare;
  const pnlUsd = payoutUsd - capitalUsd;
  if (!(pnlUsd > 0)) return reject(base, "Fee rounding leaves no positive paper payout.");
  return {
    ...base,
    decision: "paper-filled",
    reason: input.reason,
    paperFill: {
      shares,
      capitalUsd,
      grossCostUsd,
      grossProceedsUsd: 0,
      feeUsd,
      payoutUsd,
      pnlUsd,
      roi: capitalUsd > 0 ? pnlUsd / capitalUsd : 0,
    },
  };
}

export function simulateBinaryCompleteSetSell(input: {
  market: PredictionMarket;
  books: PredictionOrderBook[];
} & ResearchOptions): PredictionArbitrageResearchQuote {
  const bankrollUsd = paperBankroll(input.bankrollUsd);
  const outcomes = input.market.outcomes;
  const byOutcome = bookMap(input.books);
  const legs = outcomes.map((outcome): PricedLeg | null => {
    const book = byOutcome.get(outcome.id);
    return book ? { market: input.market, outcome, book, action: "sell" } : null;
  }).filter((leg): leg is PricedLeg => Boolean(leg));
  const edges = legs.length === 2 ? topEdges(legs, 1, "sell-proceeds") : { raw: null, fees: null, net: null };
  const base = quoteBase({
    strategy: "binary-complete-set-sell",
    classification: "locked-after-complete-fills",
    title: input.market.title,
    market: input.market,
    legs: legs.map(topResearchLeg).filter((leg): leg is PredictionArbitrageResearchLeg => Boolean(leg)),
    rawEdgePerShare: edges.raw,
    takerFeePerShare: edges.fees,
    netEdgePerShare: edges.net,
    bankrollUsd,
    now: input.now,
  });
  if (outcomes.length !== 2 || legs.length !== 2) {
    return reject(base, "A binary split-and-sell test requires both outcome books.");
  }
  if (legs.some((leg) => !leg.book.bids.length)) {
    return reject(base, "Both split tokens need an executable bid.");
  }
  if (hasUnknownFeeSchedule(legs)) {
    return reject(base, "A fee-enabled sell leg is missing its live fee schedule, so profitability cannot be verified.");
  }
  const edgeFloor = minimumEdge(input.minimumNetEdgePerShare);
  if (edges.net == null || edges.net <= edgeFloor) {
    return reject(base, edges.raw != null && edges.raw > 0
      ? "The raw premium over $1 is erased by taker fees."
      : "Selling both executable bids does not recover more than the $1 split collateral.");
  }

  const levels = legs.map((leg) => activeLevels(leg, depthFraction(input.maxDepthFraction)));
  const indexes = levels.map(() => 0);
  let shares = 0;
  let capitalUsd = 0;
  let grossProceedsUsd = 0;
  let feeUsd = 0;
  while (true) {
    advanceEmptyLevels(levels, indexes);
    const current = currentLevels(levels, indexes);
    if (!current) break;
    const unitGrossProceeds = current.reduce((sum, level) => sum + level.price, 0);
    const unitFees = legs.reduce(
      (sum, leg, index) => sum + takerFeePerShare(current[index].price, scheduleFor(leg.market)),
      0,
    );
    if (unitGrossProceeds - unitFees - 1 <= edgeFloor) break;
    const availableShares = Math.min(...current.map((level) => level.remaining));
    const fillShares = Math.min(availableShares, bankrollUsd - capitalUsd);
    if (!(fillShares > 1e-9)) break;
    capitalUsd += fillShares;
    grossProceedsUsd += fillShares * unitGrossProceeds;
    feeUsd += actualFees(legs, current, fillShares);
    shares += fillShares;
    current.forEach((level) => { level.remaining -= fillShares; });
  }
  if (!(shares > 0)) return reject(base, "No equal-share bid depth remains profitable after costs.");
  const minimumShares = minimumSharesFor(legs);
  if (shares < minimumShares) return reject(base, `Each sell leg must contain at least ${minimumShares.toFixed(2)} shares.`);
  const payoutUsd = grossProceedsUsd - feeUsd;
  const pnlUsd = payoutUsd - capitalUsd;
  if (!(pnlUsd > 0)) return reject(base, "Fee rounding leaves no positive split-and-sell proceeds.");
  return {
    ...base,
    decision: "paper-filled",
    reason: "A $1 complete set can be split, and equal outcome shares remain profitable only after both sell legs complete.",
    paperFill: {
      shares,
      capitalUsd,
      grossCostUsd: capitalUsd,
      grossProceedsUsd,
      feeUsd,
      payoutUsd,
      pnlUsd,
      roi: pnlUsd / capitalUsd,
    },
  };
}

export function simulateNegativeRiskBuyAll(input: {
  event: PredictionEvent;
  books: PredictionOrderBook[];
} & ResearchOptions): PredictionArbitrageResearchQuote {
  const bankrollUsd = paperBankroll(input.bankrollUsd);
  const emptyBase = quoteBase({
    strategy: "negative-risk-buy-all",
    classification: "locked-after-complete-fills",
    title: input.event.title,
    event: input.event,
    legs: [],
    rawEdgePerShare: null,
    takerFeePerShare: null,
    netEdgePerShare: null,
    bankrollUsd,
    now: input.now,
  });
  if (!input.event.negRisk || !input.event.enableNegRisk) {
    return reject(emptyBase, "The event is not an enabled negative-risk outcome set.");
  }
  if (input.event.negRiskAugmented || input.event.markets.some((market) => market.negativeRiskOther)) {
    return reject(emptyBase, "Augmented negative-risk events can change the meaning of Other and are excluded.");
  }
  if (input.event.markets.length < 2 || input.event.markets.some((market) => !market.acceptingOrders)) {
    return reject(emptyBase, "Every exhaustive outcome market must be open and accepting orders.");
  }
  const byOutcome = bookMap(input.books);
  const legs = input.event.markets.map((market): PricedLeg | null => {
    const outcome = outcomeByLabel(market, "yes");
    const book = outcome ? byOutcome.get(outcome.id) : undefined;
    return outcome && book ? { market, outcome, book, action: "buy" } : null;
  }).filter((leg): leg is PricedLeg => Boolean(leg));
  if (legs.length !== input.event.markets.length) {
    return reject(emptyBase, "Every exhaustive outcome needs a YES token and executable book.");
  }
  return simulateBuyPayoutBasket({
    strategy: "negative-risk-buy-all",
    classification: "locked-after-complete-fills",
    title: input.event.title,
    event: input.event,
    legs,
    payoffPerShare: 1,
    reason: "Equal YES shares cover every fixed outcome; exactly one pays $1 after every leg completes.",
    options: input,
  });
}

export function simulateNegativeRiskConversion(input: {
  event: PredictionEvent;
  sourceMarketId: string;
  books: PredictionOrderBook[];
} & ResearchOptions): PredictionArbitrageResearchQuote {
  const bankrollUsd = paperBankroll(input.bankrollUsd);
  const baseInput = {
    strategy: "negative-risk-convert-no" as const,
    classification: "execution-risk" as const,
    title: input.event.title,
    event: input.event,
    legs: [] as PredictionArbitrageResearchLeg[],
    rawEdgePerShare: null,
    takerFeePerShare: null,
    netEdgePerShare: null,
    bankrollUsd,
    now: input.now,
  };
  const emptyBase = quoteBase(baseInput);
  if (!input.event.negRisk || !input.event.enableNegRisk || input.event.negRiskAugmented) {
    return reject(emptyBase, "Only fixed, enabled, non-augmented negative-risk sets are tested for conversion.");
  }
  const sourceMarket = input.event.markets.find((market) => market.id === input.sourceMarketId);
  if (!sourceMarket || input.event.markets.length < 3 || input.event.markets.some((market) => !market.acceptingOrders)) {
    return reject(emptyBase, "Conversion requires one open source market and every other fixed outcome market.");
  }
  const byOutcome = bookMap(input.books);
  const sourceOutcome = outcomeByLabel(sourceMarket, "no");
  const sourceBook = sourceOutcome ? byOutcome.get(sourceOutcome.id) : undefined;
  if (!sourceOutcome || !sourceBook) return reject(emptyBase, "The source NO token needs an executable book.");
  const legs: PricedLeg[] = [{ market: sourceMarket, outcome: sourceOutcome, book: sourceBook, action: "buy" }];
  for (const market of input.event.markets) {
    if (market.id === sourceMarket.id) continue;
    const outcome = outcomeByLabel(market, "yes");
    const book = outcome ? byOutcome.get(outcome.id) : undefined;
    if (!outcome || !book) return reject(emptyBase, "Every converted YES token needs an executable book.");
    legs.push({ market, outcome, book, action: "sell" });
  }
  const edges = topEdges(legs, 0, "conversion");
  const base = quoteBase({
    ...baseInput,
    legs: legs.map(topResearchLeg).filter((leg): leg is PredictionArbitrageResearchLeg => Boolean(leg)),
    rawEdgePerShare: edges.raw,
    takerFeePerShare: edges.fees,
    netEdgePerShare: edges.net,
  });
  if (!sourceBook.asks.length || legs.slice(1).some((leg) => !leg.book.bids.length)) {
    return reject(base, "The source NO ask and every destination YES bid must be executable.");
  }
  if (hasUnknownFeeSchedule(legs)) {
    return reject(base, "A fee-enabled conversion leg is missing its live fee schedule, so profitability cannot be verified.");
  }
  const edgeFloor = minimumEdge(input.minimumNetEdgePerShare);
  if (edges.net == null || edges.net <= edgeFloor) {
    return reject(base, edges.raw != null && edges.raw > 0
      ? "The raw conversion spread is erased by taker fees."
      : "Converted destination YES bids do not exceed the source NO ask.");
  }

  const levels = legs.map((leg) => activeLevels(leg, depthFraction(input.maxDepthFraction)));
  const indexes = levels.map(() => 0);
  let shares = 0;
  let grossCostUsd = 0;
  let grossProceedsUsd = 0;
  let feeUsd = 0;
  let buyFeeUsd = 0;
  while (true) {
    advanceEmptyLevels(levels, indexes);
    const current = currentLevels(levels, indexes);
    if (!current) break;
    const buyPrice = current[0].price;
    const sellPrices = current.slice(1).reduce((sum, level) => sum + level.price, 0);
    const buyFee = takerFeePerShare(buyPrice, scheduleFor(legs[0].market));
    const sellFees = legs.slice(1).reduce(
      (sum, leg, index) => sum + takerFeePerShare(current[index + 1].price, scheduleFor(leg.market)),
      0,
    );
    const unitCapital = buyPrice + buyFee;
    if (sellPrices - sellFees - unitCapital <= edgeFloor) break;
    const availableShares = Math.min(...current.map((level) => level.remaining));
    const capitalUsd = grossCostUsd + buyFeeUsd;
    const fillShares = Math.min(availableShares, Math.max(0, bankrollUsd - capitalUsd - 0.00001) / unitCapital);
    if (!(fillShares > 1e-9)) break;
    grossCostUsd += fillShares * buyPrice;
    grossProceedsUsd += fillShares * sellPrices;
    const levelBuyFee = predictionTakerFeeUsd({
      shares: fillShares,
      price: buyPrice,
      feeSchedule: scheduleFor(legs[0].market),
    });
    buyFeeUsd += levelBuyFee;
    feeUsd += levelBuyFee + actualFees(legs.slice(1), current.slice(1), fillShares);
    shares += fillShares;
    current.forEach((level) => { level.remaining -= fillShares; });
  }
  if (!(shares > 0)) return reject(base, "No equal-share conversion depth remains profitable after costs.");
  const minimumShares = minimumSharesFor(legs);
  if (shares < minimumShares) return reject(base, `Every conversion leg must contain at least ${minimumShares.toFixed(2)} shares.`);
  const capitalUsd = grossCostUsd + buyFeeUsd;
  const payoutUsd = grossProceedsUsd;
  const pnlUsd = grossProceedsUsd - grossCostUsd - feeUsd;
  if (!(pnlUsd > 0)) return reject(base, "Fee rounding leaves no positive conversion proceeds.");
  return {
    ...base,
    decision: "paper-filled",
    reason: "Buying one NO can atomically convert into every other YES, but acquiring and liquidating the legs is not atomic.",
    paperFill: {
      shares,
      capitalUsd,
      grossCostUsd,
      grossProceedsUsd,
      feeUsd,
      payoutUsd,
      pnlUsd,
      roi: capitalUsd > 0 ? pnlUsd / capitalUsd : 0,
    },
  };
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9<>]+/g, " ").trim().replace(/\s+/g, " ");
}

function deadlineShape(market: PredictionMarket): { key: string; date: number } | null {
  const match = market.title.match(
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(20\d{2}))?/i,
  );
  if (!match || !MONTHS.has(match[1].toLowerCase())) return null;
  const fallbackYear = market.resolutionDate ? new Date(market.resolutionDate).getUTCFullYear() : new Date().getUTCFullYear();
  const year = Number(match[3] ?? fallbackYear);
  const month = MONTHS.get(match[1].toLowerCase()) ?? 0;
  const day = Number(match[2]);
  const date = Date.UTC(year, month, day);
  if (!Number.isFinite(date)) return null;
  return { key: normalizedText(market.title.replace(match[0], "by <deadline>")), date };
}

function thresholdShape(market: PredictionMarket): {
  key: string;
  value: number;
  direction: "up" | "down";
} | null {
  const match = market.title.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const title = market.title.toLowerCase();
  const direction = /\b(below|under|at most|less than|dip|low)\b/.test(title)
    ? "down"
    : /\b(reach|above|at least|more than|exceed|high|hit)\b/.test(title)
      ? "up"
      : null;
  if (!direction) return null;
  return {
    key: normalizedText(market.title.replace(match[0], "$<threshold>")),
    value,
    direction,
  };
}

export function discoverPredictionLogicalRelations(event: PredictionEvent): PredictionLogicalRelation[] {
  const output: PredictionLogicalRelation[] = [];
  const deadlineGroups = new Map<string, Array<{ market: PredictionMarket; date: number }>>();
  const thresholdGroups = new Map<string, Array<{ market: PredictionMarket; value: number; direction: "up" | "down" }>>();
  for (const market of event.markets.filter((candidate) => candidate.acceptingOrders && candidate.outcomes.length === 2)) {
    const deadline = deadlineShape(market);
    if (deadline) {
      const rows = deadlineGroups.get(deadline.key) ?? [];
      rows.push({ market, date: deadline.date });
      deadlineGroups.set(deadline.key, rows);
    }
    const threshold = thresholdShape(market);
    if (threshold) {
      const rows = thresholdGroups.get(threshold.key) ?? [];
      rows.push({ market, value: threshold.value, direction: threshold.direction });
      thresholdGroups.set(threshold.key, rows);
    }
  }
  for (const rows of deadlineGroups.values()) {
    rows.sort((left, right) => left.date - right.date);
    for (let earlierIndex = 0; earlierIndex < rows.length - 1; earlierIndex += 1) {
      for (let laterIndex = earlierIndex + 1; laterIndex < rows.length; laterIndex += 1) {
        const earlier = rows[earlierIndex].market;
        const later = rows[laterIndex].market;
        output.push({
          kind: "deadline",
          eventId: event.id,
          eventTitle: event.title,
          buyYesMarketId: later.id,
          buyNoMarketId: earlier.id,
          easierTitle: later.title,
          harderTitle: earlier.title,
          rationale: "If the event occurs by the earlier deadline, it must also occur by the later deadline.",
        });
      }
    }
  }
  for (const rows of thresholdGroups.values()) {
    const directions = new Set(rows.map((row) => row.direction));
    if (directions.size !== 1) continue;
    rows.sort((left, right) => left.value - right.value);
    for (let lowerIndex = 0; lowerIndex < rows.length - 1; lowerIndex += 1) {
      for (let higherIndex = lowerIndex + 1; higherIndex < rows.length; higherIndex += 1) {
        const lower = rows[lowerIndex].market;
        const higher = rows[higherIndex].market;
        const upward = rows[lowerIndex].direction === "up";
        output.push({
          kind: upward ? "upward-threshold" : "downward-threshold",
          eventId: event.id,
          eventTitle: event.title,
          buyYesMarketId: upward ? lower.id : higher.id,
          buyNoMarketId: upward ? higher.id : lower.id,
          easierTitle: upward ? lower.title : higher.title,
          harderTitle: upward ? higher.title : lower.title,
          rationale: upward
            ? "Reaching the higher threshold implies reaching the lower threshold."
            : "Falling below the lower threshold implies falling below the higher threshold.",
        });
      }
    }
  }
  return output;
}

export function simulatePredictionLogicalRelation(input: {
  event: PredictionEvent;
  relation: PredictionLogicalRelation;
  books: PredictionOrderBook[];
} & ResearchOptions): PredictionArbitrageResearchQuote {
  const yesMarket = input.event.markets.find((market) => market.id === input.relation.buyYesMarketId);
  const noMarket = input.event.markets.find((market) => market.id === input.relation.buyNoMarketId);
  const bankrollUsd = paperBankroll(input.bankrollUsd);
  const emptyBase = quoteBase({
    strategy: "logical-implication",
    classification: "criteria-review",
    title: input.event.title,
    event: input.event,
    legs: [],
    rawEdgePerShare: null,
    takerFeePerShare: null,
    netEdgePerShare: null,
    bankrollUsd,
    now: input.now,
  });
  if (!yesMarket || !noMarket) return reject(emptyBase, "The parsed relation no longer maps to both markets.");
  const yesOutcome = outcomeByLabel(yesMarket, "yes");
  const noOutcome = outcomeByLabel(noMarket, "no");
  const byOutcome = bookMap(input.books);
  const yesBook = yesOutcome ? byOutcome.get(yesOutcome.id) : undefined;
  const noBook = noOutcome ? byOutcome.get(noOutcome.id) : undefined;
  if (!yesOutcome || !noOutcome || !yesBook || !noBook) {
    return reject(emptyBase, "The implication basket needs the easier YES and harder NO books.");
  }
  return simulateBuyPayoutBasket({
    strategy: "logical-implication",
    classification: "criteria-review",
    title: input.event.title,
    event: input.event,
    legs: [
      { market: yesMarket, outcome: yesOutcome, book: yesBook, action: "buy" },
      { market: noMarket, outcome: noOutcome, book: noBook, action: "buy" },
    ],
    payoffPerShare: 1,
    reason: `${input.relation.rationale} A human must still confirm identical resolution criteria and oracle treatment.`,
    options: input,
  });
}

export function rankPredictionMakerCandidates(
  events: PredictionEvent[],
  books: PredictionOrderBook[],
): PredictionMakerResearchCandidate[] {
  const byOutcome = bookMap(books);
  const candidates: PredictionMakerResearchCandidate[] = [];
  for (const event of events) {
    for (const market of event.markets) {
      const outcome = market.outcomes[0];
      const complement = market.outcomes[1];
      const book = outcome ? byOutcome.get(outcome.id) : undefined;
      const complementBook = complement ? byOutcome.get(complement.id) : undefined;
      const bestBid = book?.bids[0]?.price;
      const bestAsk = book?.asks[0]?.price;
      const bestBidSize = book?.bids[0]?.size;
      const bestAskSize = book?.asks[0]?.size;
      if (
        !outcome
        || !complement
        || bestBid == null
        || bestAsk == null
        || bestBidSize == null
        || bestAskSize == null
        || bestAsk <= bestBid
      ) continue;
      const midpoint = (bestBid + bestAsk) / 2;
      const schedule = scheduleFor(market);
      const feeEquivalent = takerFeePerShare(midpoint, schedule);
      candidates.push({
        eventId: event.id,
        marketId: market.id,
        conditionId: market.conditionId,
        title: market.title,
        outcome: outcome.label,
        outcomeId: outcome.id,
        complementOutcomeId: complement.id,
        resolutionDate: market.resolutionDate,
        bestBid,
        bestAsk,
        bestBidSize,
        bestAskSize,
        complementBestBid: complementBook?.bids[0]?.price ?? null,
        spreadPerShare: bestAsk - bestBid,
        rewardEligible: market.rewardsMinSize > 0 && market.rewardsMaxSpread > 0,
        rewardsMinSize: market.rewardsMinSize,
        rewardsMaxSpread: market.rewardsMaxSpread,
        makerFeeRate: 0,
        modeledRebatePerFilledShare: feeEquivalent * (schedule?.rebateRate ?? 0),
        classification: "non-guaranteed",
        reason: "Quoted spread and rewards require queue priority and both-side fills; one-sided adverse selection can exceed them.",
      });
    }
  }
  return candidates.sort((left, right) => (
    right.spreadPerShare + right.modeledRebatePerFilledShare
    - left.spreadPerShare - left.modeledRebatePerFilledShare
  ));
}

async function fetchBooksBestEffort(
  outcomeIds: string[],
  fetcher: typeof fetch,
): Promise<{ books: PredictionOrderBook[]; errors: string[] }> {
  const books: PredictionOrderBook[] = [];
  const errors: string[] = [];
  const fetchChunk = async (chunk: string[]): Promise<void> => {
    if (!chunk.length) return;
    try {
      books.push(...await fetchPredictionOrderBooks(chunk, fetcher));
    } catch (error) {
      if (chunk.length === 1) {
        errors.push(`${chunk[0]}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const midpoint = Math.ceil(chunk.length / 2);
      await Promise.all([fetchChunk(chunk.slice(0, midpoint)), fetchChunk(chunk.slice(midpoint))]);
    }
  };
  const chunks: string[][] = [];
  for (let index = 0; index < outcomeIds.length; index += 500) chunks.push(outcomeIds.slice(index, index + 500));
  await Promise.all(chunks.map(fetchChunk));
  return { books, errors };
}

export async function scanPredictionArbitrageUniverse(options: {
  eventLimit?: number;
  bankrollUsd?: number;
  maxDepthFraction?: number;
  minimumNetEdgePerShare?: number;
  now?: Date;
  fetcher?: typeof fetch;
} = {}): Promise<PredictionArbitrageUniverseScan> {
  const fetcher = options.fetcher ?? fetch;
  const eventLimit = Math.min(50, Math.max(1, Math.floor(options.eventLimit ?? 50)));
  const now = options.now ?? new Date();
  const events = await fetchPredictionEvents({ limit: eventLimit, fetcher });
  const markets = events.flatMap((event) => event.markets)
    .filter((market) => market.acceptingOrders && market.outcomes.length === 2);
  const outcomeIds = [...new Set(markets.flatMap((market) => market.outcomes.map((outcome) => outcome.id))
    .filter((outcomeId) => /^\d{10,}$/.test(outcomeId)))];
  const fetched = await fetchBooksBestEffort(outcomeIds, fetcher);
  const books = fetched.books;
  const common = {
    bankrollUsd: options.bankrollUsd,
    maxDepthFraction: options.maxDepthFraction,
    minimumNetEdgePerShare: options.minimumNetEdgePerShare,
    now,
  };
  const binaryCompleteSetBuys = markets.map((market) => simulatePredictionComplementArbitrage({
    market,
    books,
    ...common,
  }));
  const binaryCompleteSetSells = markets.map((market) => simulateBinaryCompleteSetSell({
    market,
    books,
    ...common,
  }));
  const negativeRiskEvents = events.filter((event) => event.negRisk && event.enableNegRisk);
  const negativeRiskBuyAll = negativeRiskEvents.map((event) => simulateNegativeRiskBuyAll({
    event,
    books,
    ...common,
  }));
  const negativeRiskConversions = negativeRiskEvents.flatMap((event) => event.markets.map((market) => (
    simulateNegativeRiskConversion({
      event,
      sourceMarketId: market.id,
      books,
      ...common,
    })
  )));
  const logicalRelations = events.flatMap((event) => discoverPredictionLogicalRelations(event).map((relation) => (
    simulatePredictionLogicalRelation({ event, relation, books, ...common })
  )));
  return {
    observedAt: now.toISOString(),
    events,
    eventCount: events.length,
    marketCount: markets.length,
    requestedBookCount: outcomeIds.length,
    returnedBookCount: books.length,
    bookErrors: fetched.errors,
    binaryCompleteSetBuys,
    binaryCompleteSetSells,
    negativeRiskBuyAll,
    negativeRiskConversions,
    logicalRelations,
    makerCandidates: rankPredictionMakerCandidates(events, books),
  };
}

export function summarizePredictionArbitrageUniverse(scan: PredictionArbitrageUniverseScan): Record<string, unknown> {
  const binaryBuyFills = scan.binaryCompleteSetBuys.filter((quote) => quote.decision === "paper-filled");
  const families = [
    ...scan.binaryCompleteSetSells,
    ...scan.negativeRiskBuyAll,
    ...scan.negativeRiskConversions,
    ...scan.logicalRelations,
  ];
  const paperFills = families.filter((quote) => quote.decision === "paper-filled");
  const lockedFills = paperFills.filter((quote) => quote.classification === "locked-after-complete-fills");
  const criteriaReviewFills = paperFills.filter((quote) => quote.classification === "criteria-review");
  const executionRiskFills = paperFills.filter((quote) => quote.classification === "execution-risk");
  const maximumNetEdge = Math.max(
    Number.NEGATIVE_INFINITY,
    ...scan.binaryCompleteSetBuys.map((quote) => quote.netEdgePerShare ?? Number.NEGATIVE_INFINITY),
    ...families.map((quote) => quote.netEdgePerShare ?? Number.NEGATIVE_INFINITY),
  );
  return {
    type: "summary",
    observedAt: scan.observedAt,
    eventCount: scan.eventCount,
    marketCount: scan.marketCount,
    requestedBookCount: scan.requestedBookCount,
    returnedBookCount: scan.returnedBookCount,
    bookErrors: scan.bookErrors.length,
    binaryBuyFills: binaryBuyFills.length,
    binarySellFills: scan.binaryCompleteSetSells.filter((quote) => quote.decision === "paper-filled").length,
    negativeRiskBuyAllFills: scan.negativeRiskBuyAll.filter((quote) => quote.decision === "paper-filled").length,
    negativeRiskConversionFills: scan.negativeRiskConversions.filter((quote) => quote.decision === "paper-filled").length,
    logicalCriteriaReviewFills: criteriaReviewFills.length,
    lockedFills: binaryBuyFills.length + lockedFills.length,
    executionRiskFills: executionRiskFills.length,
    makerCandidates: scan.makerCandidates.length,
    rewardEligibleMakerCandidates: scan.makerCandidates.filter((candidate) => candidate.rewardEligible).length,
    maximumNetEdgePerShare: Number.isFinite(maximumNetEdge) ? roundUsd(maximumNetEdge) : null,
    claimLimit: "Public snapshots cannot prove queue position, simultaneous fills, criteria equivalence, incentive share, or future profitability.",
  };
}
