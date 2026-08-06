import { strict as assert } from "node:assert";

const shadow = await import("./polymarket-maker-shadow.mjs");

const candidate = {
  eventId: "event",
  marketId: "market",
  conditionId: "condition",
  title: "Fixture market",
  outcome: "Yes",
  outcomeId: "yes-token",
  complementOutcomeId: "no-token",
  resolutionDate: "2026-08-31T00:00:00Z",
  bestBid: 0.45,
  bestAsk: 0.5,
  bestBidSize: 20,
  bestAskSize: 30,
  complementBestBid: 0.49,
  spreadPerShare: 0.05,
  rewardEligible: true,
  rewardsMinSize: 10,
  rewardsMaxSpread: 4.5,
  makerFeeRate: 0,
  modeledRebatePerFilledShare: 0,
  classification: "non-guaranteed",
  reason: "Fixture",
};

let state = {
  candidate,
  quoteShares: 10,
  requiredCapitalUsd: 14.5,
  bidQueueAheadShares: 20,
  askQueueAheadShares: 30,
  bidEligibleTradeShares: 0,
  askEligibleTradeShares: 0,
  bidPaperFilled: false,
  askPaperFilled: false,
  tradeEvents: 0,
  finalOutcomeBid: 0.44,
  finalComplementBid: 0.49,
};
state = shadow.applyMakerShadowTrade(state, { side: "SELL", price: 0.45, size: 29 });
assert.equal(state.bidPaperFilled, false);
state = shadow.applyMakerShadowTrade(state, { side: "SELL", price: 0.44, size: 1 });
assert.equal(state.bidPaperFilled, true);
state = shadow.applyMakerShadowTrade(state, { side: "BUY", price: 0.5, size: 40 });
assert.equal(state.askPaperFilled, true);
const both = shadow.evaluateMakerShadowState(state);
assert.equal(both.fillState, "both");
assert.equal(both.markedPnlUsd, 0.5);

const askOnly = shadow.evaluateMakerShadowState({
  ...state,
  bidPaperFilled: false,
  askPaperFilled: true,
});
assert.equal(askOnly.fillState, "ask-only");
assert.equal(askOnly.markedPnlUsd, -0.1);

assert.deepEqual(
  shadow.parseMakerShadowArguments([
    "--event-limit", "10",
    "--bankroll-usd", "100",
    "--duration-seconds", "60",
    "--candidate-limit", "3",
    "--minimum-hours-to-resolution", "24",
  ]),
  {
    eventLimit: 10,
    bankrollUsd: 100,
    durationSeconds: 60,
    candidateLimit: 3,
    minimumHoursToResolution: 24,
    outputPath: undefined,
  },
);

process.stdout.write("Polymarket maker-shadow contracts pass.\n");
