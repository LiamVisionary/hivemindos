#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  PLUME_ACTION_CONFIRMATIONS,
  collateralForWrite,
  plumeSeriesId,
  preparePlumeAction,
} from "../src/lib/services/trading/plume-options-domain.ts";

const nowSeconds = 1_800_000_000;

assert.deepEqual(
  Object.keys(PLUME_ACTION_CONFIRMATIONS).sort(),
  ["buy", "buy-to-close", "cancel", "exercise", "reclaim", "redeem", "settle", "settle-worthless", "write"].sort(),
  "every mutating Plume lifecycle action must have an exact confirmation token",
);

assert.equal(PLUME_ACTION_CONFIRMATIONS.write, "CONFIRM_OPTION_WRITE");
assert.equal(PLUME_ACTION_CONFIRMATIONS.buy, "CONFIRM_OPTION_BUY");
assert.equal(PLUME_ACTION_CONFIRMATIONS["settle-worthless"], "CONFIRM_OPTION_SETTLE_WORTHLESS");

assert.equal(
  plumeSeriesId(20_000_000_000n, 1_800_086_400n),
  "0x72fec724f6400e61da628b49331e4fd86ae064af27dcec47b43867c8d26edc63",
  "series ids must match keccak256(abi.encode(uint128 strike,uint40 expiry))",
);

assert.equal(
  collateralForWrite({ kind: "call", amount: 2_500_000_000_000_000_000n, strike: 20_000_000_000n, underlyingDecimals: 18, quoteDecimals: 18, feedDecimals: 8 }),
  2_500_000_000_000_000_000n,
  "covered calls lock one underlying token per option",
);
assert.equal(
  collateralForWrite({ kind: "put", amount: 2_500_000_000_000_000_000n, strike: 20_000_000_000n, underlyingDecimals: 18, quoteDecimals: 18, feedDecimals: 8 }),
  500_000_000_000_000_000_000n,
  "cash-secured puts lock strike-scaled quote collateral per option",
);

const writeReview = preparePlumeAction({
  action: "write",
  symbol: "TSLA",
  kind: "call",
  strikePrice: "200",
  expiry: nowSeconds + 86_400,
  amount: "2.5",
  premiumPerOption: "4.25",
}, {
  nowSeconds,
  feedDecimals: 8,
  underlyingDecimals: 18,
  quoteDecimals: 18,
});

assert.equal(writeReview.confirmation, "CONFIRM_OPTION_WRITE");
assert.equal(writeReview.seriesId, "0x72fec724f6400e61da628b49331e4fd86ae064af27dcec47b43867c8d26edc63");
assert.equal(writeReview.amountAtomic, "2500000000000000000");
assert.equal(writeReview.collateralAtomic, "2500000000000000000");
assert.match(writeReview.summary, /Write and list 2\.5 TSLA covered calls/i);

assert.throws(
  () => preparePlumeAction({
    action: "write",
    symbol: "TSLA",
    kind: "put",
    strikePrice: "200",
    expiry: nowSeconds + 31 * 86_400,
    amount: "1",
    premiumPerOption: "2",
  }, { nowSeconds, feedDecimals: 8, underlyingDecimals: 18, quoteDecimals: 18 }),
  /30 days/i,
  "write previews must enforce the contract's maximum tenor before signing",
);

const buyReview = preparePlumeAction({
  action: "buy",
  symbol: "AMD",
  kind: "put",
  offerId: "6",
  amount: "1.25",
  listedPremiumPerOptionAtomic: "3950000000000000000",
}, {
  nowSeconds,
  feedDecimals: 8,
  underlyingDecimals: 18,
  quoteDecimals: 18,
});
assert.equal(buyReview.confirmation, "CONFIRM_OPTION_BUY");
assert.equal(buyReview.premiumAtomic, "4937500000000000000");
assert.equal(buyReview.offerId, "6");

assert.throws(
  () => preparePlumeAction({ action: "buy", symbol: "NVDA", kind: "call", offerId: "1", amount: "1", listedPremiumPerOptionAtomic: "1" }, {
    nowSeconds,
    feedDecimals: 8,
    underlyingDecimals: 18,
    quoteDecimals: 18,
  }),
  /TSLA or AMD/i,
  "only pinned-registry markets may reach execution",
);

console.log("Plume options domain contract passed.");
