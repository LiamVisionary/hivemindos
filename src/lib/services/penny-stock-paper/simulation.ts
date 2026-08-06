import type {
  PennyPaperSimulationAssumptions,
  PennyPaperSimulationResult,
  PennyPaperStrategy,
  PennyPaperTrade,
  PennyStockBar,
  PennyStockQuote,
} from "./types";

type PendingOrder = {
  limitPriceUsd: number;
  placedIndex: number;
};

type OpenPosition = {
  quantity: number;
  spentUsd: number;
  openedIndex: number;
};

type Fill = {
  priceUsd: number;
  quantity: number;
  requestedQuantity: number;
  executionModel: PennyPaperTrade["executionModel"];
};

export const DEFAULT_PENNY_PAPER_STRATEGY: PennyPaperStrategy = {
  entryDiscountPct: 30,
  takeProfitPct: 42.8571,
  stopLossPct: 20,
  maxHoldDays: 10,
  orderExpiryDays: 20,
};

export const DEFAULT_PENNY_PAPER_ASSUMPTIONS: PennyPaperSimulationAssumptions = {
  startingCashUsd: 300,
  notionalUsdPerSymbol: 100,
  executionCostBpsPerSide: 100,
  adverseSelectionBps: 50,
  maximumQuoteParticipationPct: 10,
  dailyVolumeParticipationPct: 0.05,
  gapPenaltyPct: 2,
  maxPortfolioDrawdownPct: 20,
  dailyLossLimitPct: 8,
  maxConcurrentPositions: 3,
  costStressMultiplier: 1,
};

export function validatePennyPaperStrategy(value: PennyPaperStrategy): PennyPaperStrategy {
  return {
    entryDiscountPct: boundedNumber(value.entryDiscountPct, 1, 80, "entryDiscountPct"),
    takeProfitPct: boundedNumber(value.takeProfitPct, 1, 300, "takeProfitPct"),
    stopLossPct: boundedNumber(value.stopLossPct, 1, 95, "stopLossPct"),
    maxHoldDays: boundedInteger(value.maxHoldDays, 1, 90, "maxHoldDays"),
    orderExpiryDays: boundedInteger(value.orderExpiryDays, 1, 90, "orderExpiryDays"),
  };
}

export function simulatePennyLimitPortfolio(input: {
  barsBySymbol: Record<string, PennyStockBar[]>;
  quotesBySymbol?: Record<string, PennyStockQuote[]>;
  strategy: PennyPaperStrategy;
  assumptions?: Partial<PennyPaperSimulationAssumptions>;
}): PennyPaperSimulationResult {
  const strategy = validatePennyPaperStrategy(input.strategy);
  const symbols = Object.keys(input.barsBySymbol).sort();
  if (!symbols.length) throw new Error("Simulation needs at least one symbol.");
  const assumptions = normalizeAssumptions(input.assumptions, symbols.length);
  const normalizedBars = Object.fromEntries(
    symbols.map((symbol) => [symbol, normalizeBars(input.barsBySymbol[symbol], symbol)]),
  );
  const quotesBySymbolDate = normalizeQuotes(input.quotesBySymbol ?? {}, symbols);
  const barsByDate = new Map<string, Map<string, PennyStockBar>>();
  for (const symbol of symbols) {
    for (const bar of normalizedBars[symbol]) {
      const row = barsByDate.get(bar.date) ?? new Map<string, PennyStockBar>();
      row.set(symbol, bar);
      barsByDate.set(bar.date, row);
    }
  }
  const dates = [...barsByDate.keys()].sort();
  if (dates.length < 2) throw new Error("Simulation needs at least two dated bars.");

  const pending = new Map<string, PendingOrder>();
  const positions = new Map<string, OpenPosition>();
  const lastMarks = new Map<string, number>();
  const trades: PennyPaperTrade[] = [];
  const dailyEquity: number[] = [];
  const dailyPositions: number[] = [];
  let cashUsd = assumptions.startingCashUsd;
  let executionCostsUsd = 0;
  let expiredOrders = 0;
  let winningTrades = 0;
  let partialFills = 0;
  let liquidityRejectedFills = 0;
  let gapOrHaltPenalties = 0;
  let dailyLossLimitTriggers = 0;
  let killSwitch = false;
  let peakEquity = assumptions.startingCashUsd;

  for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
    const date = dates[dateIndex];
    const rows = barsByDate.get(date) ?? new Map<string, PennyStockBar>();
    const startOfDayEquity = portfolioEquity(cashUsd, positions, lastMarks);

    for (const symbol of symbols) {
      const bar = rows.get(symbol);
      if (!bar) continue;
      lastMarks.set(symbol, bar.close);
      const order = pending.get(symbol);
      if (
        order
        && order.placedIndex < dateIndex
        && !positions.has(symbol)
        && positions.size < assumptions.maxConcurrentPositions
        && !killSwitch
      ) {
        const fill = entryFill({
          order,
          bar,
          quotes: quotesBySymbolDate.get(symbol)?.get(date) ?? [],
          cashUsd,
          assumptions,
        });
        if (fill === "liquidity-rejected") {
          liquidityRejectedFills += 1;
        } else if (fill) {
          const grossUsd = fill.priceUsd * fill.quantity;
          const costUsd = executionCost(grossUsd, assumptions);
          const totalUsd = grossUsd + costUsd;
          if (fill.quantity + 1e-12 < fill.requestedQuantity) partialFills += 1;
          cashUsd -= totalUsd;
          executionCostsUsd += costUsd;
          positions.set(symbol, {
            quantity: fill.quantity,
            spentUsd: totalUsd,
            openedIndex: dateIndex,
          });
          pending.delete(symbol);
          trades.push(tradeRow({
            symbol,
            side: "buy",
            date,
            fill,
            executionCostUsd: costUsd,
            reason: "limit-fill",
          }));
        }
      }

      const position = positions.get(symbol);
      if (position && position.openedIndex < dateIndex) {
        const averageCost = position.spentUsd / position.quantity;
        const target = averageCost * (1 + strategy.takeProfitPct / 100);
        const stop = averageCost * (1 - strategy.stopLossPct / 100);
        const heldDays = dateIndex - position.openedIndex;
        const quotes = quotesBySymbolDate.get(symbol)?.get(date) ?? [];
        const exit = exitFill({
          position,
          bar,
          quotes,
          target,
          stop,
          maxHold: heldDays >= strategy.maxHoldDays,
          assumptions,
        });
        if (exit) {
          if (exit.gapPenalty) gapOrHaltPenalties += 1;
          const grossUsd = exit.fill.priceUsd * exit.fill.quantity;
          const costUsd = executionCost(grossUsd, assumptions);
          const proceedsUsd = grossUsd - costUsd;
          const basisUsd = position.spentUsd * (exit.fill.quantity / position.quantity);
          const pnlUsd = proceedsUsd - basisUsd;
          cashUsd += proceedsUsd;
          executionCostsUsd += costUsd;
          if (pnlUsd > 0) winningTrades += 1;
          const remaining = position.quantity - exit.fill.quantity;
          if (remaining <= 1e-10) {
            positions.delete(symbol);
          } else {
            position.quantity = remaining;
            position.spentUsd -= basisUsd;
            partialFills += 1;
          }
          trades.push({
            ...tradeRow({
              symbol,
              side: "sell",
              date,
              fill: exit.fill,
              executionCostUsd: costUsd,
              reason: exit.reason,
            }),
            pnlUsd: round(pnlUsd, 6),
          });
        }
      }

      const stillPending = pending.get(symbol);
      if (stillPending && dateIndex - stillPending.placedIndex >= strategy.orderExpiryDays) {
        pending.delete(symbol);
        expiredOrders += 1;
      }
    }

    let equity = portfolioEquity(cashUsd, positions, lastMarks);
    const dailyLossPct = startOfDayEquity > 0
      ? ((startOfDayEquity - equity) / startOfDayEquity) * 100
      : 0;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (
      positions.size
      && (dailyLossPct >= assumptions.dailyLossLimitPct
        || drawdownPct >= assumptions.maxPortfolioDrawdownPct)
    ) {
      const reason = drawdownPct >= assumptions.maxPortfolioDrawdownPct
        ? "portfolio-kill-switch"
        : "daily-loss-limit";
      if (reason === "portfolio-kill-switch") killSwitch = true;
      else dailyLossLimitTriggers += 1;
      for (const [symbol, position] of [...positions]) {
        const bar = rows.get(symbol);
        const mark = bar?.close ?? lastMarks.get(symbol);
        if (!mark) continue;
        const priceUsd = roundPrice(mark * (1 - assumptions.gapPenaltyPct / 100));
        const grossUsd = priceUsd * position.quantity;
        const costUsd = executionCost(grossUsd, assumptions);
        const pnlUsd = grossUsd - costUsd - position.spentUsd;
        cashUsd += grossUsd - costUsd;
        executionCostsUsd += costUsd;
        if (pnlUsd > 0) winningTrades += 1;
        trades.push({
          symbol,
          side: "sell",
          date,
          priceUsd,
          quantity: position.quantity,
          requestedQuantity: position.quantity,
          fillRatioPct: 100,
          notionalUsd: round(grossUsd, 6),
          executionCostUsd: round(costUsd, 6),
          reason,
          executionModel: "daily-bar-pessimistic",
          pnlUsd: round(pnlUsd, 6),
        });
        positions.delete(symbol);
      }
      pending.clear();
      equity = cashUsd;
    }

    if (!killSwitch) {
      for (const symbol of symbols) {
        if (
          positions.has(symbol)
          || pending.has(symbol)
          || positions.size + pending.size >= assumptions.maxConcurrentPositions
        ) continue;
        const bar = rows.get(symbol);
        if (!bar || bar.volume <= 0) continue;
        pending.set(symbol, {
          limitPriceUsd: roundPrice(bar.close * (1 - strategy.entryDiscountPct / 100)),
          placedIndex: dateIndex,
        });
      }
    }

    dailyEquity.push(round(equity, 8));
    dailyPositions.push(positions.size);
  }

  const endingEquityUsd = portfolioEquity(cashUsd, positions, lastMarks);
  const sellTrades = trades.filter((trade) => trade.side === "sell");
  return {
    strategy,
    assumptions,
    startDate: dates[0],
    endDate: dates.at(-1) ?? dates[0],
    startingCashUsd: assumptions.startingCashUsd,
    endingEquityUsd: round(endingEquityUsd, 6),
    totalPnlUsd: round(endingEquityUsd - assumptions.startingCashUsd, 6),
    returnPct: round(
      ((endingEquityUsd - assumptions.startingCashUsd) / assumptions.startingCashUsd) * 100,
      6,
    ),
    maxDrawdownPct: round(maxDrawdownFromEquity(dailyEquity), 6),
    fills: trades.filter((trade) => trade.side === "buy").length,
    partialFills,
    closedTrades: sellTrades.length,
    winningTrades,
    winRatePct: sellTrades.length ? round((winningTrades / sellTrades.length) * 100, 4) : 0,
    expiredOrders,
    liquidityRejectedFills,
    gapOrHaltPenalties,
    portfolioKillSwitchTriggered: killSwitch,
    dailyLossLimitTriggers,
    executionCostsUsd: round(executionCostsUsd, 6),
    dailyReturnsPct: dailyReturns(dailyEquity),
    dailyPositions,
    trades,
  };
}

export function generatePennyStrategyVariants(
  baseline: PennyPaperStrategy,
): PennyPaperStrategy[] {
  const values = [
    baseline,
    ...[15, 20, 25, 30, 35].flatMap((entryDiscountPct) =>
      [20, 30, 42.8571, 55].flatMap((takeProfitPct) =>
        [15, 20, 30].flatMap((stopLossPct) =>
          [5, 10, 20].map((maxHoldDays) => ({
            entryDiscountPct,
            takeProfitPct,
            stopLossPct,
            maxHoldDays,
            orderExpiryDays: Math.max(5, Math.min(30, maxHoldDays * 2)),
          }))
        )
      )
    ),
  ];
  const unique = new Map<string, PennyPaperStrategy>();
  for (const value of values) {
    const normalized = validatePennyPaperStrategy(value);
    unique.set(JSON.stringify(normalized), normalized);
  }
  return [...unique.values()];
}

export function parameterNeighborhood(
  selected: PennyPaperStrategy,
  variants: PennyPaperStrategy[],
): PennyPaperStrategy[] {
  const distances = variants
    .filter((variant) => strategyKey(variant) !== strategyKey(selected))
    .map((variant) => ({
      variant,
      distance:
        Math.abs(variant.entryDiscountPct - selected.entryDiscountPct) / 5
        + Math.abs(variant.takeProfitPct - selected.takeProfitPct) / 10
        + Math.abs(variant.stopLossPct - selected.stopLossPct) / 5
        + Math.abs(variant.maxHoldDays - selected.maxHoldDays) / 5
        + Math.abs(variant.orderExpiryDays - selected.orderExpiryDays) / 5,
    }))
    .sort((left, right) => left.distance - right.distance);
  return distances.slice(0, 8).map((row) => row.variant);
}

export function strategyTrainingScore(result: PennyPaperSimulationResult): number {
  if (result.fills < 3) return Number.NEGATIVE_INFINITY;
  return result.returnPct
    - result.maxDrawdownPct
    - result.executionCostsUsd * 0.02
    - result.partialFills * 0.1
    - result.gapOrHaltPenalties * 0.25;
}

export function sliceBarsByDates(
  barsBySymbol: Record<string, PennyStockBar[]>,
  dates: string[],
): Record<string, PennyStockBar[]> {
  const wanted = new Set(dates);
  return Object.fromEntries(
    Object.entries(barsBySymbol).map(([symbol, bars]) => [
      symbol,
      bars.filter((bar) => wanted.has(bar.date)),
    ]),
  );
}

export function commonTradingDates(
  barsBySymbol: Record<string, PennyStockBar[]>,
): string[] {
  const sets = Object.values(barsBySymbol).map(
    (bars) => new Set(bars.map((bar) => bar.date)),
  );
  if (!sets.length) return [];
  return [...sets[0]].filter((date) => sets.every((set) => set.has(date))).sort();
}

function entryFill(input: {
  order: PendingOrder;
  bar: PennyStockBar;
  quotes: PennyStockQuote[];
  cashUsd: number;
  assumptions: PennyPaperSimulationAssumptions;
}): Fill | "liquidity-rejected" | null {
  if (input.bar.volume <= 0) return null;
  const availableCash = Math.min(input.cashUsd, input.assumptions.notionalUsdPerSymbol);
  if (availableCash < 1) return null;
  const quote = input.quotes.find((row) =>
    row.askPriceUsd > 0 && row.askPriceUsd <= input.order.limitPriceUsd
  );
  const referencePrice = quote?.askPriceUsd
    ?? (input.bar.low <= input.order.limitPriceUsd
      ? Math.min(input.order.limitPriceUsd, input.bar.open)
      : 0);
  if (!(referencePrice > 0)) return null;
  const adversePrice = roundPrice(Math.min(
    input.order.limitPriceUsd,
    referencePrice * (1 + input.assumptions.adverseSelectionBps / 10_000),
  ));
  const requestedQuantity = availableCash
    / (adversePrice * (1 + effectiveCostBps(input.assumptions) / 10_000));
  const capacity = quote
    ? quote.askSize * input.assumptions.maximumQuoteParticipationPct / 100
    : input.bar.volume * input.assumptions.dailyVolumeParticipationPct / 100;
  const quantity = Math.min(requestedQuantity, capacity);
  if (quantity * adversePrice < 1) return "liquidity-rejected";
  return {
    priceUsd: adversePrice,
    quantity,
    requestedQuantity,
    executionModel: quote ? "sip-quote" : "daily-bar-pessimistic",
  };
}

function exitFill(input: {
  position: OpenPosition;
  bar: PennyStockBar;
  quotes: PennyStockQuote[];
  target: number;
  stop: number;
  maxHold: boolean;
  assumptions: PennyPaperSimulationAssumptions;
}): {
  fill: Fill;
  reason: "take-profit" | "stop-loss" | "max-hold";
  gapPenalty: boolean;
} | null {
  if (input.bar.volume <= 0) return null;
  const stopQuote = input.quotes.find((quote) => quote.bidPriceUsd > 0 && quote.bidPriceUsd <= input.stop);
  const targetQuote = input.quotes.find((quote) => quote.bidPriceUsd >= input.target);
  const stopHit = Boolean(stopQuote) || input.bar.low <= input.stop;
  const targetHit = Boolean(targetQuote) || input.bar.high >= input.target;
  let reason: "take-profit" | "stop-loss" | "max-hold" | null = null;
  let referencePrice = 0;
  let quote: PennyStockQuote | undefined;
  let gapPenalty = false;
  if (stopHit) {
    reason = "stop-loss";
    quote = stopQuote;
    referencePrice = quote?.bidPriceUsd ?? Math.min(input.stop, input.bar.open);
    if (!quote && input.bar.open < input.stop) {
      referencePrice *= 1 - input.assumptions.gapPenaltyPct / 100;
      gapPenalty = true;
    }
  } else if (targetHit) {
    reason = "take-profit";
    quote = targetQuote;
    referencePrice = quote?.bidPriceUsd ?? input.target;
  } else if (input.maxHold) {
    reason = "max-hold";
    quote = input.quotes.at(-1);
    referencePrice = quote?.bidPriceUsd ?? input.bar.close;
  }
  if (!reason || !(referencePrice > 0)) return null;
  const priceUsd = roundPrice(
    referencePrice * (1 - input.assumptions.adverseSelectionBps / 10_000),
  );
  const capacity = quote
    ? quote.bidSize * input.assumptions.maximumQuoteParticipationPct / 100
    : input.bar.volume * input.assumptions.dailyVolumeParticipationPct / 100;
  const quantity = Math.min(input.position.quantity, Math.max(0, capacity));
  if (quantity * priceUsd < 0.01) return null;
  return {
    fill: {
      priceUsd,
      quantity,
      requestedQuantity: input.position.quantity,
      executionModel: quote ? "sip-quote" : "daily-bar-pessimistic",
    },
    reason,
    gapPenalty,
  };
}

function normalizeAssumptions(
  input: Partial<PennyPaperSimulationAssumptions> | undefined,
  symbolCount: number,
): PennyPaperSimulationAssumptions {
  const notionalUsdPerSymbol = boundedNumber(
    input?.notionalUsdPerSymbol ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.notionalUsdPerSymbol,
    1,
    1_000_000,
    "notionalUsdPerSymbol",
  );
  return {
    startingCashUsd: boundedNumber(
      input?.startingCashUsd ?? notionalUsdPerSymbol * symbolCount,
      notionalUsdPerSymbol,
      10_000_000,
      "startingCashUsd",
    ),
    notionalUsdPerSymbol,
    executionCostBpsPerSide: boundedNumber(
      input?.executionCostBpsPerSide
        ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.executionCostBpsPerSide,
      0,
      5_000,
      "executionCostBpsPerSide",
    ),
    adverseSelectionBps: boundedNumber(
      input?.adverseSelectionBps ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.adverseSelectionBps,
      0,
      5_000,
      "adverseSelectionBps",
    ),
    maximumQuoteParticipationPct: boundedNumber(
      input?.maximumQuoteParticipationPct
        ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.maximumQuoteParticipationPct,
      0.01,
      100,
      "maximumQuoteParticipationPct",
    ),
    dailyVolumeParticipationPct: boundedNumber(
      input?.dailyVolumeParticipationPct
        ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.dailyVolumeParticipationPct,
      0.0001,
      5,
      "dailyVolumeParticipationPct",
    ),
    gapPenaltyPct: boundedNumber(
      input?.gapPenaltyPct ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.gapPenaltyPct,
      0,
      25,
      "gapPenaltyPct",
    ),
    maxPortfolioDrawdownPct: boundedNumber(
      input?.maxPortfolioDrawdownPct
        ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.maxPortfolioDrawdownPct,
      1,
      100,
      "maxPortfolioDrawdownPct",
    ),
    dailyLossLimitPct: boundedNumber(
      input?.dailyLossLimitPct ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.dailyLossLimitPct,
      1,
      100,
      "dailyLossLimitPct",
    ),
    maxConcurrentPositions: boundedInteger(
      input?.maxConcurrentPositions
        ?? Math.min(symbolCount, DEFAULT_PENNY_PAPER_ASSUMPTIONS.maxConcurrentPositions),
      1,
      Math.max(1, symbolCount),
      "maxConcurrentPositions",
    ),
    costStressMultiplier: boundedNumber(
      input?.costStressMultiplier ?? DEFAULT_PENNY_PAPER_ASSUMPTIONS.costStressMultiplier,
      1,
      10,
      "costStressMultiplier",
    ),
  };
}

function normalizeBars(bars: PennyStockBar[], symbol: string): PennyStockBar[] {
  const rows = bars
    .filter((bar) =>
      /^\d{4}-\d{2}-\d{2}$/.test(bar.date)
      && [bar.open, bar.high, bar.low, bar.close].every(
        (value) => Number.isFinite(value) && value > 0,
      )
      && Number.isFinite(bar.volume)
      && bar.volume >= 0
      && bar.high >= bar.low
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  const unique = new Map(rows.map((bar) => [bar.date, bar]));
  if (unique.size < 2) throw new Error(`${symbol} needs at least two valid bars.`);
  return [...unique.values()];
}

function normalizeQuotes(
  input: Record<string, PennyStockQuote[]>,
  symbols: string[],
) {
  const output = new Map<string, Map<string, PennyStockQuote[]>>();
  for (const symbol of symbols) {
    const byDate = new Map<string, PennyStockQuote[]>();
    for (const quote of input[symbol] ?? []) {
      const date = quote.timestamp.slice(0, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || ![quote.bidPriceUsd, quote.askPriceUsd, quote.bidSize, quote.askSize]
          .every((value) => Number.isFinite(value) && value >= 0)
        || quote.askPriceUsd < quote.bidPriceUsd
      ) continue;
      const rows = byDate.get(date) ?? [];
      rows.push(quote);
      byDate.set(date, rows);
    }
    for (const rows of byDate.values()) {
      rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    }
    output.set(symbol, byDate);
  }
  return output;
}

function tradeRow(input: {
  symbol: string;
  side: "buy" | "sell";
  date: string;
  fill: Fill;
  executionCostUsd: number;
  reason: PennyPaperTrade["reason"];
}): PennyPaperTrade {
  return {
    symbol: input.symbol,
    side: input.side,
    date: input.date,
    priceUsd: input.fill.priceUsd,
    quantity: round(input.fill.quantity, 8),
    requestedQuantity: round(input.fill.requestedQuantity, 8),
    fillRatioPct: round(
      input.fill.requestedQuantity > 0
        ? (input.fill.quantity / input.fill.requestedQuantity) * 100
        : 0,
      4,
    ),
    notionalUsd: round(input.fill.priceUsd * input.fill.quantity, 6),
    executionCostUsd: round(input.executionCostUsd, 6),
    reason: input.reason,
    executionModel: input.fill.executionModel,
  };
}

function portfolioEquity(
  cashUsd: number,
  positions: Map<string, OpenPosition>,
  lastMarks: Map<string, number>,
) {
  let equity = cashUsd;
  for (const [symbol, position] of positions) {
    equity += position.quantity * (lastMarks.get(symbol) ?? 0);
  }
  return equity;
}

function executionCost(notionalUsd: number, assumptions: PennyPaperSimulationAssumptions) {
  return notionalUsd * effectiveCostBps(assumptions) / 10_000;
}

function effectiveCostBps(assumptions: PennyPaperSimulationAssumptions) {
  return assumptions.executionCostBpsPerSide * assumptions.costStressMultiplier;
}

function maxDrawdownFromEquity(values: number[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100);
  }
  return maxDrawdown;
}

function dailyReturns(equity: number[]): number[] {
  const values: number[] = [];
  for (let index = 1; index < equity.length; index += 1) {
    const previous = equity[index - 1];
    values.push(previous > 0 ? ((equity[index] - previous) / previous) * 100 : 0);
  }
  return values.map((value) => round(value, 8));
}

function strategyKey(strategy: PennyPaperStrategy) {
  return JSON.stringify(strategy);
}

function roundPrice(value: number): number {
  return round(Math.max(0.0001, value), value < 1 ? 4 : 2);
}

function boundedNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  const integer = boundedNumber(value, minimum, maximum, label);
  if (!Number.isInteger(integer)) throw new Error(`${label} must be an integer.`);
  return integer;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
