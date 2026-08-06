import { strict as assert } from "node:assert";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const research = await import(new URL(
  "../src/lib/services/trading/prediction-arbitrage-research.ts",
  import.meta.url,
));
const scanner = await import(new URL("./polymarket-arbitrage-research.mjs", import.meta.url));

function market(id, yesPrice, options = {}) {
  return {
    id,
    conditionId: `condition-${id}`,
    eventId: options.eventId ?? "event-1",
    title: options.title ?? `Will ${id} happen?`,
    description: options.description ?? "Identical resolution contract.",
    slug: options.slug ?? `will-${id}-happen`,
    url: `https://polymarket.com/event/${options.slug ?? `will-${id}-happen`}`,
    outcomes: [
      { id: `${id}-yes-1234567890`, marketId: id, label: "Yes", price: yesPrice },
      { id: `${id}-no-1234567890`, marketId: id, label: "No", price: 1 - yesPrice },
    ],
    resolutionDate: options.resolutionDate ?? "2026-08-31T23:59:00Z",
    volume24h: 10_000,
    volume: 100_000,
    liquidity: 20_000,
    tags: [],
    status: "active",
    acceptingOrders: true,
    restricted: false,
    feesEnabled: options.feesEnabled ?? false,
    feeSchedule: options.feeSchedule,
    minimumOrderSize: 5,
    minimumTickSize: 0.01,
    negRisk: options.negRisk ?? false,
    negativeRiskMarketId: options.negativeRiskMarketId,
    negativeRiskOther: options.negativeRiskOther ?? false,
    groupItemTitle: options.groupItemTitle,
    resolutionSource: options.resolutionSource ?? "Fixture oracle",
    rewardsMinSize: options.rewardsMinSize ?? 0,
    rewardsMaxSpread: options.rewardsMaxSpread ?? 0,
  };
}

function event(id, markets, options = {}) {
  return {
    id,
    title: options.title ?? "Fixture event",
    description: options.description ?? "Exactly one listed outcome resolves Yes.",
    slug: options.slug ?? `fixture-${id}`,
    url: `https://polymarket.com/event/${options.slug ?? `fixture-${id}`}`,
    tags: [],
    volume24h: 10_000,
    volume: 100_000,
    liquidity: 20_000,
    markets,
    endDate: "2026-08-31T23:59:00Z",
    negRisk: options.negRisk ?? false,
    enableNegRisk: options.enableNegRisk ?? false,
    negRiskAugmented: options.negRiskAugmented ?? false,
  };
}

function book(outcomeId, bid, ask, size = 100) {
  return {
    outcomeId,
    bids: bid == null ? [] : [{ price: bid, size }],
    asks: ask == null ? [] : [{ price: ask, size }],
    midpoint: bid != null && ask != null ? (bid + ask) / 2 : null,
    spread: bid != null && ask != null ? ask - bid : null,
    timestamp: "1785360513652",
    minimumOrderSize: 5,
    tickSize: 0.01,
  };
}

function booksForMarket(value, yesBid, yesAsk, noBid, noAsk, size = 100) {
  return [
    book(value.outcomes[0].id, yesBid, yesAsk, size),
    book(value.outcomes[1].id, noBid, noAsk, size),
  ];
}

const feeSchedule = { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 };

const reverseMarket = market("reverse", 0.5);
const reverseBooks = booksForMarket(reverseMarket, 0.55, 0.56, 0.47, 0.48);
const reverse = research.simulateBinaryCompleteSetSell({
  market: reverseMarket,
  books: reverseBooks,
  bankrollUsd: 100,
});
assert.equal(reverse.decision, "paper-filled");
assert.equal(reverse.classification, "locked-after-complete-fills");
assert.ok(reverse.paperFill.pnlUsd > 0.49 && reverse.paperFill.pnlUsd < 0.51);
assert.ok(reverse.paperFill.shares > 24.9 && reverse.paperFill.shares <= 25);

const feeKilledReverseMarket = market("reverse-fee", 0.5, { feesEnabled: true, feeSchedule });
const feeKilledReverse = research.simulateBinaryCompleteSetSell({
  market: feeKilledReverseMarket,
  books: booksForMarket(feeKilledReverseMarket, 0.55, 0.56, 0.47, 0.48),
  bankrollUsd: 100,
});
assert.equal(feeKilledReverse.decision, "rejected");
assert.ok(feeKilledReverse.rawEdgePerShare > 0);
assert.ok(feeKilledReverse.netEdgePerShare < 0);

const unknownFeeMarket = market("unknown-fee", 0.5, { feesEnabled: true });
const unknownFeeReverse = research.simulateBinaryCompleteSetSell({
  market: unknownFeeMarket,
  books: booksForMarket(unknownFeeMarket, 0.55, 0.56, 0.47, 0.48),
  bankrollUsd: 100,
});
assert.equal(unknownFeeReverse.decision, "rejected");
assert.match(unknownFeeReverse.reason, /missing its live fee schedule/i);

const negMarkets = [
  market("alice", 0.3, { eventId: "neg-event", negRisk: true }),
  market("bob", 0.3, { eventId: "neg-event", negRisk: true }),
  market("carol", 0.3, { eventId: "neg-event", negRisk: true }),
];
const negEvent = event("neg-event", negMarkets, { negRisk: true, enableNegRisk: true });
const negBooks = negMarkets.flatMap((value) => booksForMarket(value, 0.29, 0.30, 0.69, 0.70));
const negBasket = research.simulateNegativeRiskBuyAll({
  event: negEvent,
  books: negBooks,
  bankrollUsd: 100,
});
assert.equal(negBasket.decision, "paper-filled");
assert.equal(negBasket.legs.length, 3);
assert.ok(negBasket.paperFill.pnlUsd > 2.49 && negBasket.paperFill.pnlUsd < 2.51);

const augmented = research.simulateNegativeRiskBuyAll({
  event: { ...negEvent, negRiskAugmented: true },
  books: negBooks,
  bankrollUsd: 100,
});
assert.equal(augmented.decision, "rejected");
assert.match(augmented.reason, /augmented|other/i);

const conversionBooks = [
  ...booksForMarket(negMarkets[0], 0.79, 0.80, 0.19, 0.20),
  ...booksForMarket(negMarkets[1], 0.15, 0.16, 0.84, 0.85),
  ...booksForMarket(negMarkets[2], 0.12, 0.13, 0.87, 0.88),
];
const conversion = research.simulateNegativeRiskConversion({
  event: negEvent,
  sourceMarketId: "alice",
  books: conversionBooks,
  bankrollUsd: 100,
});
assert.equal(conversion.decision, "paper-filled");
assert.equal(conversion.classification, "execution-risk");
assert.ok(conversion.netEdgePerShare > 0.069 && conversion.netEdgePerShare < 0.071);

const deadlineMarkets = [
  market("early", 0.2, {
    eventId: "deadline-event",
    title: "Effective ceasefire by July 31, 2026?",
    slug: "ceasefire-by-july-31-2026",
  }),
  market("late", 0.3, {
    eventId: "deadline-event",
    title: "Effective ceasefire by August 31, 2026?",
    slug: "ceasefire-by-august-31-2026",
  }),
];
const deadlineRelations = research.discoverPredictionLogicalRelations(event("deadline-event", deadlineMarkets));
assert.equal(deadlineRelations.length, 1);
assert.equal(deadlineRelations[0].kind, "deadline");
assert.equal(deadlineRelations[0].buyYesMarketId, "late");
assert.equal(deadlineRelations[0].buyNoMarketId, "early");

const thresholdMarkets = [
  market("low-threshold", 0.7, {
    eventId: "threshold-event",
    title: "Will Bitcoin reach $80,000 in July 2026?",
  }),
  market("high-threshold", 0.4, {
    eventId: "threshold-event",
    title: "Will Bitcoin reach $100,000 in July 2026?",
  }),
];
const thresholdRelations = research.discoverPredictionLogicalRelations(event("threshold-event", thresholdMarkets));
assert.equal(thresholdRelations.length, 1);
assert.equal(thresholdRelations[0].kind, "upward-threshold");
assert.equal(thresholdRelations[0].buyYesMarketId, "low-threshold");
assert.equal(thresholdRelations[0].buyNoMarketId, "high-threshold");

const makerCandidates = research.rankPredictionMakerCandidates(
  [event("maker-event", [market("maker", 0.5, {
    rewardsMinSize: 100,
    rewardsMaxSpread: 3,
    feesEnabled: true,
    feeSchedule,
  })])],
  booksForMarket(market("maker", 0.5), 0.48, 0.52, 0.48, 0.52),
);
assert.equal(makerCandidates[0].classification, "non-guaranteed");
assert.equal(makerCandidates[0].makerFeeRate, 0);
assert.match(makerCandidates[0].reason, /queue|adverse|both/i);

assert.deepEqual(
  scanner.parseArbitrageResearchArguments([
    "--event-limit", "25",
    "--bankroll-usd", "100",
    "--duration-seconds", "60",
    "--sample-ms", "10000",
    "--quiet",
  ]),
  {
    eventLimit: 25,
    bankrollUsd: 100,
    durationSeconds: 60,
    sampleMs: 10_000,
    outputPath: undefined,
    quiet: true,
  },
);

console.log("Prediction arbitrage research contracts pass.");
