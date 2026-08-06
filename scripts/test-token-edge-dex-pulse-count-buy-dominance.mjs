#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLedgerEvent, readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  registerDexPulseEntryProviderPriceIntegrity,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_COUNT_BUY_DOMINANCE_RULE,
  DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE,
  DEX_PULSE_COUNT_FLOW_QUALITY_RULE,
  DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE,
  buildDexPulseCountBuyDominanceScorecard,
  buildDexPulseCountDualMomentumScorecard,
  buildDexPulseCountFlowQualityScorecard,
  buildDexPulseCountPositiveMomentumScorecard,
  registerDexPulseCountBuyDominance,
  registerDexPulseCountDualMomentum,
  registerDexPulseCountFlowQuality,
  registerDexPulseCountPositiveMomentum,
} from "./token-edge/onchain-dex-pulse-count-buy-dominance.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-count-buy-dominance-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await assert.rejects(
  registerDexPulseCountBuyDominance({ ledgerPath }, {
    now: new Date(DEX_PULSE_COUNT_BUY_DOMINANCE_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseCountBuyDominance({ ledgerPath }, {
  now: new Date("2026-08-03T17:18:00.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseCountBuyDominance({ ledgerPath }, {
  now: new Date("2026-08-03T17:18:01.000Z"),
})).status, "existing");

const zeroSellWinner = "CountZeroSellWinner111";
const finiteRatioLoser = "CountFiniteRatioLoser222";
const noActivity = "CountNoActivity333";
await appendLedgerEvent(ledgerPath, discovery(zeroSellWinner, finiteRatioLoser, noActivity));
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T17:19:01.000Z"),
});
assert.equal(capture.recordedForecasts, 3);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T18:19:02.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [
      pair(zeroSellWinner, "pair-count-zero-sell", 1.8),
      pair(finiteRatioLoser, "pair-count-finite", 0.8),
      pair(noActivity, "pair-count-none", 1.8),
    ],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseCountBuyDominanceScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 3);
assert.equal(scorecard.eligibleLiveObservations, 3);
assert.equal(scorecard.zeroSellExpansionObservations, 1);
assert.equal(scorecard.legacyFiniteRatioPolicy.observations, 1);
assert.equal(scorecard.countDominancePolicy.observations, 2);
assert.ok(scorecard.countDominancePolicy.averageCapacityReturnPct > 0);
assert.ok(scorecard.countDominancePolicy.stressAverageCapacityReturnPct > 0);
assert.ok(scorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === zeroSellWinner
)).metrics.fiveMinuteBuySellTxnRatio = 99;
const forgedScorecard = buildDexPulseCountBuyDominanceScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 2);
assert.equal(Object.values(forgedScorecard.sourcePulseRejectionCounts).reduce((sum, value) => (
  sum + value
), 0), 1);

await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:30:16.000Z"),
});
await assert.rejects(
  registerDexPulseCountPositiveMomentum({ ledgerPath }, {
    now: new Date(DEX_PULSE_COUNT_POSITIVE_MOMENTUM_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const momentumRegistration = await registerDexPulseCountPositiveMomentum({ ledgerPath }, {
  now: new Date("2026-08-03T23:31:01.000Z"),
});
assert.equal(momentumRegistration.status, "registered");
assert.equal((await registerDexPulseCountPositiveMomentum({ ledgerPath }, {
  now: new Date("2026-08-03T23:31:02.000Z"),
})).status, "existing");

const momentumWinner = "CountMomentumWinner444";
const negativeMomentumLoser = "CountNegativeMomentum555";
const futureNoActivity = "CountFutureNoActivity666";
const futureDiscovery = discovery(momentumWinner, negativeMomentumLoser, futureNoActivity);
futureDiscovery.id = "discovery-count-positive-momentum-fixture";
futureDiscovery.observedAt = "2026-08-03T23:32:00.000Z";
futureDiscovery.availableAt = futureDiscovery.observedAt;
futureDiscovery.candidates[1].priceChangeM5Pct = -1;
await appendLedgerEvent(ledgerPath, futureDiscovery);
const futureMarkets = {
  [momentumWinner]: ["pair-count-zero-sell", 1, 22_000],
  [negativeMomentumLoser]: ["pair-count-finite", 1, 22_000],
  [futureNoActivity]: ["pair-count-none", 1, 22_000],
};
const futureCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T23:32:01.000Z"),
  fetcher: marketFetcher(futureMarkets),
});
assert.equal(futureCapture.recordedForecasts, 3);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T00:32:02.000Z"),
  fetcher: marketFetcher({
    ...futureMarkets,
    [momentumWinner]: ["pair-count-zero-sell", 1.8, 20_000],
    [negativeMomentumLoser]: ["pair-count-finite", 0.8, 20_000],
  }),
});

const momentumEvents = await readLedger(ledgerPath);
const momentumScorecard = buildDexPulseCountPositiveMomentumScorecard(momentumEvents);
assert.equal(momentumScorecard.registrationId, momentumRegistration.registrationId);
assert.equal(momentumScorecard.parentRegistrationId, registration.registrationId);
assert.equal(momentumScorecard.candidateForecasts, 3);
assert.equal(momentumScorecard.eligibleLiveObservations, 3);
assert.equal(momentumScorecard.countDominanceParentPolicy.observations, 2);
assert.equal(momentumScorecard.countPositiveMomentumPolicy.observations, 1);
assert.ok(momentumScorecard.countPositiveMomentumPolicy.averageCapacityReturnPct > 0);
assert.ok(momentumScorecard.countPositiveMomentumPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(momentumScorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(momentumScorecard.provisionalGate, false);

await assert.rejects(
  registerDexPulseCountFlowQuality({ ledgerPath }, {
    now: new Date(DEX_PULSE_COUNT_FLOW_QUALITY_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const flowQualityRegistration = await registerDexPulseCountFlowQuality({ ledgerPath }, {
  now: new Date("2026-08-04T00:33:00.000Z"),
});
assert.equal(flowQualityRegistration.status, "registered");
assert.equal(flowQualityRegistration.parentRegistrationId, momentumRegistration.registrationId);
assert.equal((await registerDexPulseCountFlowQuality({ ledgerPath }, {
  now: new Date("2026-08-04T00:33:01.000Z"),
})).status, "existing");

const flowQualityWinner = "CountFlowQualityWinner777";
const thinFlowLoser = "CountThinFlowLoser888";
const flowNegativeMomentum = "CountFlowNegativeMomentum999";
const flowDiscovery = discovery(flowQualityWinner, thinFlowLoser, flowNegativeMomentum);
flowDiscovery.id = "discovery-count-flow-quality-fixture";
flowDiscovery.observedAt = "2026-08-04T00:34:00.000Z";
flowDiscovery.availableAt = flowDiscovery.observedAt;
flowDiscovery.candidates[0].volumeM5Usd = 400;
flowDiscovery.candidates[0].fiveMinuteTurnover = 0.02;
flowDiscovery.candidates[1].volumeM5Usd = 20;
flowDiscovery.candidates[1].fiveMinuteTurnover = 0.001;
flowDiscovery.candidates[2].volumeM5Usd = 400;
flowDiscovery.candidates[2].fiveMinuteTurnover = 0.02;
flowDiscovery.candidates[2].priceChangeM5Pct = -1;
await appendLedgerEvent(ledgerPath, flowDiscovery);
const flowMarkets = {
  [flowQualityWinner]: ["pair-count-zero-sell", 1, 22_000],
  [thinFlowLoser]: ["pair-count-finite", 1, 22_000],
  [flowNegativeMomentum]: ["pair-count-none", 1, 22_000],
};
const flowCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T00:34:01.000Z"),
  fetcher: marketFetcher(flowMarkets),
});
assert.equal(flowCapture.recordedForecasts, 3);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T01:34:02.000Z"),
  fetcher: marketFetcher({
    ...flowMarkets,
    [flowQualityWinner]: ["pair-count-zero-sell", 1.8, 20_000],
    [thinFlowLoser]: ["pair-count-finite", 0.8, 20_000],
  }),
});

const flowEvents = await readLedger(ledgerPath);
const flowScorecard = buildDexPulseCountFlowQualityScorecard(flowEvents);
assert.equal(flowScorecard.registrationId, flowQualityRegistration.registrationId);
assert.equal(flowScorecard.parentRegistrationId, momentumRegistration.registrationId);
assert.equal(flowScorecard.candidateForecasts, 3);
assert.equal(flowScorecard.eligibleLiveObservations, 3);
assert.equal(flowScorecard.countPositiveMomentumParentPolicy.observations, 2);
assert.equal(flowScorecard.countFlowQualityPolicy.observations, 1);
assert.ok(flowScorecard.countFlowQualityPolicy.averageCapacityReturnPct > 0);
assert.ok(flowScorecard.countFlowQualityPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(flowScorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(flowScorecard.provisionalGate, false);

await assert.rejects(
  registerDexPulseCountDualMomentum({ ledgerPath }, {
    now: new Date(DEX_PULSE_COUNT_DUAL_MOMENTUM_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const dualMomentumRegistration = await registerDexPulseCountDualMomentum({ ledgerPath }, {
  now: new Date("2026-08-04T01:35:00.000Z"),
});
assert.equal(dualMomentumRegistration.status, "registered");
assert.equal(dualMomentumRegistration.parentRegistrationId, momentumRegistration.registrationId);
assert.equal((await registerDexPulseCountDualMomentum({ ledgerPath }, {
  now: new Date("2026-08-04T01:35:01.000Z"),
})).status, "existing");

const dualMomentumWinner = "CountDualMomentumWinnerAAA";
const negativeHourlyLoser = "CountNegativeHourlyLoserBBB";
const dualNegativeFiveMinute = "CountDualNegativeFiveMinuteCCC";
const dualDiscovery = discovery(
  dualMomentumWinner,
  negativeHourlyLoser,
  dualNegativeFiveMinute,
);
dualDiscovery.id = "discovery-count-dual-momentum-fixture";
dualDiscovery.observedAt = "2026-08-04T01:36:00.000Z";
dualDiscovery.availableAt = dualDiscovery.observedAt;
dualDiscovery.candidates[1].priceChangeH1Pct = -1;
dualDiscovery.candidates[2].priceChangeM5Pct = -1;
await appendLedgerEvent(ledgerPath, dualDiscovery);
const dualMarkets = {
  [dualMomentumWinner]: ["pair-count-zero-sell", 1, 22_000],
  [negativeHourlyLoser]: ["pair-count-finite", 1, 22_000],
  [dualNegativeFiveMinute]: ["pair-count-none", 1, 22_000],
};
const dualCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T01:36:01.000Z"),
  fetcher: marketFetcher(dualMarkets),
});
assert.equal(dualCapture.recordedForecasts, 3);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T02:36:02.000Z"),
  fetcher: marketFetcher({
    ...dualMarkets,
    [dualMomentumWinner]: ["pair-count-zero-sell", 1.8, 20_000],
    [negativeHourlyLoser]: ["pair-count-finite", 0.8, 20_000],
  }),
});

const dualEvents = await readLedger(ledgerPath);
const dualScorecard = buildDexPulseCountDualMomentumScorecard(dualEvents);
assert.equal(dualScorecard.registrationId, dualMomentumRegistration.registrationId);
assert.equal(dualScorecard.parentRegistrationId, momentumRegistration.registrationId);
assert.equal(dualScorecard.candidateForecasts, 3);
assert.equal(dualScorecard.eligibleLiveObservations, 3);
assert.equal(dualScorecard.countPositiveMomentumParentPolicy.observations, 2);
assert.equal(dualScorecard.countDualMomentumPolicy.observations, 1);
assert.ok(dualScorecard.countDualMomentumPolicy.averageCapacityReturnPct > 0);
assert.ok(dualScorecard.countDualMomentumPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(dualScorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(dualScorecard.provisionalGate, false);

console.log("token-edge DEX pulse count buy-dominance checks passed.");

function discovery(zeroSellAddress, finiteAddress, noActivityAddress) {
  return {
    type: "discovery",
    id: "discovery-count-buy-dominance-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T17:19:00.000Z",
    availableAt: "2026-08-03T17:19:00.000Z",
    candidates: [
      candidate(zeroSellAddress, "ZERO", "pair-count-zero-sell", {
        fiveMinuteBuySellTxnRatio: null,
        buysM5: 10,
        sellsM5: 0,
        volumeM5Usd: 1_000,
      }),
      candidate(finiteAddress, "FINITE", "pair-count-finite", {
        fiveMinuteBuySellTxnRatio: 2,
        buysM5: 10,
        sellsM5: 5,
        volumeM5Usd: 1_000,
      }),
      candidate(noActivityAddress, "NONE", "pair-count-none", {
        fiveMinuteBuySellTxnRatio: null,
        buysM5: 0,
        sellsM5: 0,
        volumeM5Usd: 0,
      }),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress, fast) {
  return {
    chain: "solana",
    tokenAddress,
    symbol,
    status: "eligible",
    blockers: [],
    sourceTypes: ["boost-latest"],
    sourceBreadth: 1,
    latestSourceTimestamp: null,
    latestBoostAmount: 10,
    totalBoostAmount: 10,
    hasWebsite: true,
    hasTwitter: true,
    pairAddress,
    pairAgeMinutes: 120,
    priceUsd: 1,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
    volumeH1Usd: 14_000,
    hourlyTurnover: 0.7,
    buysH1: 200,
    sellsH1: 100,
    buySellTxnRatio: 2,
    fiveMinuteTurnover: fast.volumeM5Usd / 20_000,
    priceChangeM5Pct: 1,
    priceChangeH1Pct: 5,
    priceChangeH24Pct: 10,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    ...fast,
  };
}

function pair(address, pairAddress, priceUsd) {
  return {
    baseToken: { address },
    pairAddress,
    priceUsd: String(priceUsd),
    liquidity: { usd: 20_000 },
  };
}

function marketFetcher(markets) {
  return async (url) => ({
    ok: true,
    json: async () => Object.entries(markets).map(([tokenAddress, market]) => ({
      baseToken: { address: tokenAddress },
      pairAddress: market[0],
      priceUsd: String(market[1]),
      liquidity: { usd: market[2] },
      endpointKind: String(url).includes("/token-pairs/") ? "direct" : "batch",
    })),
  });
}
