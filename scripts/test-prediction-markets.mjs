import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const prediction = await import(new URL("../src/lib/services/trading/prediction-markets.ts", import.meta.url));
const scanner = await import(new URL("./polymarket-btc-complement-paper.mjs", import.meta.url));

const eventFixture = [{
  id: "event-1",
  title: "Will the forecast verify?",
  slug: "forecast-verify",
  description: "Fixture event",
  volume24hr: 2500,
  liquidity: 1000,
  markets: [{
    id: "market-1",
    conditionId: "0xabc",
    question: "Will the high be 70–74?",
    slug: "high-70-74",
    outcomes: "[\"Yes\",\"No\"]",
    outcomePrices: "[\"0.42\",\"0.58\"]",
    clobTokenIds: "[\"12345678901234567890\",\"98765432109876543210\"]",
    volume24hr: "1200",
    liquidity: "800",
    feesEnabled: true,
    feeSchedule: { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 },
    orderPriceMinTickSize: 0.01,
    orderMinSize: 5,
    active: true,
    closed: false,
    acceptingOrders: true,
  }],
}];

const fetcher = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (parsed.hostname === "gamma-api.polymarket.com" && parsed.pathname.startsWith("/markets/slug/btc-updown-")) {
    return Response.json({
      ...eventFixture[0].markets[0],
      id: "btc-market-1",
      question: "Bitcoin Up or Down - fixture",
      slug: parsed.pathname.split("/").at(-1),
      outcomes: "[\"Up\",\"Down\"]",
      outcomePrices: "[\"0.48\",\"0.52\"]",
    });
  }
  if (parsed.hostname === "gamma-api.polymarket.com") return Response.json(eventFixture);
  if (parsed.pathname === "/book") {
    assert.equal(parsed.searchParams.get("token_id"), "12345678901234567890");
    return Response.json({ bids: [{ price: "0.41", size: "50" }], asks: [{ price: "0.43", size: "40" }] });
  }
  if (parsed.pathname === "/books") {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body, [
      { token_id: "12345678901234567890" },
      { token_id: "98765432109876543210" },
    ]);
    return Response.json([
      {
        asset_id: "98765432109876543210",
        timestamp: "1785360513652",
        hash: "book-no",
        min_order_size: "5",
        tick_size: "0.01",
        bids: [{ price: "0.49", size: "100" }],
        asks: [{ price: "0.50", size: "100" }],
      },
      {
        asset_id: "12345678901234567890",
        timestamp: "1785360513651",
        hash: "book-yes",
        min_order_size: "5",
        tick_size: "0.01",
        bids: [{ price: "0.46", size: "100" }],
        asks: [{ price: "0.47", size: "100" }],
      },
    ]);
  }
  if (parsed.pathname === "/prices-history") {
    assert.equal(parsed.searchParams.get("market"), "12345678901234567890", "price history must use the CLOB token id");
    return Response.json({ history: [{ t: 1_700_000_000, p: 0.4 }, { t: 1_700_003_600, p: 0.42 }] });
  }
  if (parsed.pathname === "/positions") {
    return Response.json([{ conditionId: "0xabc", asset: "123", title: "Fixture", outcome: "Yes", size: 10, avgPrice: .3, curPrice: .42, initialValue: 3, currentValue: 4.2, cashPnl: 1.2 }]);
  }
  if (parsed.pathname === "/activity") {
    return Response.json([
      { transactionHash: "0x1", timestamp: 1_700_000_000, type: "TRADE", side: "BUY", conditionId: "0xabc", asset: "123", size: 10, price: .3, usdcSize: 3 },
      { transactionHash: "0x1", timestamp: 1_700_000_000, type: "TRADE", side: "BUY", conditionId: "0xabc", asset: "123", size: 10, price: .3, usdcSize: 3 },
    ]);
  }
  return new Response("not found", { status: 404 });
};

const events = await prediction.fetchPredictionEvents({ fetcher, limit: 5 });
assert.equal(events.length, 1);
assert.equal(events[0].markets[0].outcomes[0].id, "12345678901234567890", "double-encoded Gamma arrays should normalize");
assert.equal(events[0].markets[0].outcomes[0].price, .42);
assert.deepEqual(events[0].markets[0].feeSchedule, { rate: .07, exponent: 1, takerOnly: true, rebateRate: .2 });
assert.equal(events[0].markets[0].minimumOrderSize, 5);

const book = await prediction.fetchPredictionOrderBook("12345678901234567890", fetcher);
assert.equal(book.midpoint, .42);
assert.ok(Math.abs(book.spread - .02) < 1e-9);
const books = await prediction.fetchPredictionOrderBooks(
  ["12345678901234567890", "98765432109876543210"],
  fetcher,
);
assert.equal(books.length, 2);
assert.equal(books[0].outcomeId, "12345678901234567890", "batch books should preserve requested outcome order");
assert.equal(books[0].asks[0].price, .47);
assert.equal(books[1].outcomeId, "98765432109876543210");
const history = await prediction.fetchPredictionPriceHistory("12345678901234567890", fetcher);
assert.equal(history.length, 2);
assert.equal(history[0].timestamp, 1_700_000_000_000);

const trader = await prediction.fetchPredictionTraderProfile("0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d", fetcher);
assert.equal(trader.metrics.tradeCount, 1, "duplicate activity transactions should count once");
assert.equal(trader.metrics.marketCount, 1);
assert.equal(trader.metrics.cashPnlUsd, 1.2);

const order = prediction.simulatePredictionPaperOrder({
  market: events[0].markets[0],
  outcome: events[0].markets[0].outcomes[0],
  side: "buy",
  notionalUsd: 25,
  book,
  now: new Date("2026-07-27T00:00:00Z"),
});
assert.equal(order.status, "filled");
assert.equal(order.notionalUsd, 25);
assert.ok(order.fillPrice > .43, "paper buy should model slippage above the best ask");

const fee = prediction.predictionTakerFeeUsd({
  shares: 100,
  price: .5,
  feeSchedule: { rate: .07, exponent: 1, takerOnly: true, rebateRate: .2 },
});
assert.equal(fee, 1.75, "current 7% crypto curve should peak at $1.75 per 100 shares");

const feeKilledArb = prediction.simulatePredictionComplementArbitrage({
  market: events[0].markets[0],
  books,
  bankrollUsd: 100,
});
assert.equal(feeKilledArb.decision, "rejected");
assert.equal(feeKilledArb.bestCombinedAsk, .97);
assert.ok(feeKilledArb.rawEdgePerShare > 0, "fixture should contain a naive pre-fee gap");
assert.ok(feeKilledArb.netEdgePerShare < 0, "both-leg taker fees should erase the naive gap");
assert.match(feeKilledArb.reason, /fee/i);
assert.equal(feeKilledArb.paperFill, null);

const unknownFeeArb = prediction.simulatePredictionComplementArbitrage({
  market: { ...events[0].markets[0], feeSchedule: undefined },
  books,
  bankrollUsd: 100,
});
assert.equal(unknownFeeArb.decision, "rejected");
assert.match(unknownFeeArb.reason, /missing its live fee schedule/i);

const viableBooks = [
  { ...books[0], asks: [{ price: .45, size: 100 }] },
  { ...books[1], asks: [{ price: .50, size: 100 }] },
];
const viableArb = prediction.simulatePredictionComplementArbitrage({
  market: events[0].markets[0],
  books: viableBooks,
  bankrollUsd: 100,
});
assert.equal(viableArb.decision, "paper-filled");
assert.ok(viableArb.paperFill.shares > 24.9 && viableArb.paperFill.shares <= 25);
assert.ok(viableArb.paperFill.pnlUsd > .37 && viableArb.paperFill.pnlUsd < .39);
assert.equal(viableArb.paperFill.payoutUsd, viableArb.paperFill.shares);
assert.ok(viableArb.paperFill.capitalUsd <= 100);

const defaultedBankrollArb = prediction.simulatePredictionComplementArbitrage({
  market: events[0].markets[0],
  books: viableBooks,
  bankrollUsd: Number.NaN,
});
assert.equal(defaultedBankrollArb.bankrollUsd, 100, "a missing or non-finite API bankroll should use the $100 paper default");

const belowMinimumArb = prediction.simulatePredictionComplementArbitrage({
  market: events[0].markets[0],
  books: viableBooks,
  bankrollUsd: 1,
});
assert.equal(belowMinimumArb.decision, "rejected");
assert.match(belowMinimumArb.reason, /5.00 shares/);

const oneSidedArb = prediction.simulatePredictionComplementArbitrage({
  market: events[0].markets[0],
  books: [books[0], { ...books[1], asks: [] }],
  bankrollUsd: 100,
});
assert.equal(oneSidedArb.decision, "rejected");
assert.match(oneSidedArb.reason, /both.*ask/i);

const currentBtcQuotes = await prediction.fetchCurrentBtcComplementArbitrageQuotes({
  intervalMinutes: [5],
  bankrollUsd: 100,
  now: new Date("2026-07-29T21:26:00Z"),
  fetcher,
});
assert.equal(currentBtcQuotes.length, 1);
assert.equal(currentBtcQuotes[0].slug, "btc-updown-5m-1785360300", "current BTC market should derive from the interval epoch");
assert.equal(currentBtcQuotes[0].intervalMinutes, 5);
assert.equal(currentBtcQuotes[0].decision, "rejected");

const calibration = prediction.calculatePredictionCalibration([{ probability: .8, outcome: 1 }, { probability: .2, outcome: 0 }]);
assert.equal(calibration.samples, 2);
assert.ok(Math.abs(calibration.brierScore - .04) < 1e-9);

const weather = prediction.weatherBucketProbability({ forecast: 72, low: 70, high: 74, uncertainty: 2 });
assert.ok(weather > .68 && weather < .69, "±1σ bucket should hold roughly 68.3% probability");

const tradeView = readFileSync(new URL("../src/components/trade/TradeView.tsx", import.meta.url), "utf8");
assert.match(tradeView, /PredictionMarketsPanel/);
assert.match(tradeView, /> Prediction</);
const route = readFileSync(new URL("../src/app/api/trading/prediction/route.ts", import.meta.url), "utf8");
assert.match(route, /requireAuth/);
assert.match(route, /btc-complement-arbitrage/);
assert.doesNotMatch(route, /createAndPostOrder|privateKey|signature/i, "native prediction route must remain read/paper-only");
assert.deepEqual(
  scanner.parsePaperScannerArguments(["--duration-seconds", "5", "--sample-ms", "250", "--bankroll-usd", "100"]),
  { durationSeconds: 5, sampleMs: 250, bankrollUsd: 100, outputPath: undefined, quiet: false },
);
const scanSummary = scanner.summarizePaperScanner([{
  observedAt: "2026-07-29T21:26:00.000Z",
  quotes: [feeKilledArb, viableArb],
}], 100, 100.38, [{ marketId: "market-1" }]);
assert.equal(scanSummary.rawGapObservations, 2);
assert.equal(scanSummary.postFeeOpportunityObservations, 1);
assert.equal(scanSummary.paperTrades, 1);
const scannerSource = readFileSync(new URL("./polymarket-btc-complement-paper.mjs", import.meta.url), "utf8");
assert.doesNotMatch(scannerSource, /privateKey|createAndPostOrder|postOrder|signOrder/i, "paper scanner must not gain a wallet/order path");

console.log("Prediction market normalization, batch CLOB books, fee-aware complement paper fills, trader metrics, weather math, and Trade segment contracts pass.");
