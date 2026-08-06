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
  enrichDexSurfacePulseWithLunarTopic,
  registerDexPulseLunarTopic,
} from "./token-edge/onchain-dex-pulse-lunar-topic-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE,
  buildDexPulseLunarTopicGrowthScorecard,
  registerDexPulseLunarTopicGrowth,
} from "./token-edge/onchain-dex-pulse-lunar-topic-growth.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-topic-growth-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:34:46.000Z"),
});
await registerDexPulseLunarTopic({ ledgerPath }, {
  now: new Date("2026-08-03T21:06:31.000Z"),
});
await assert.rejects(
  registerDexPulseLunarTopicGrowth({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseLunarTopicGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T21:30:36.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseLunarTopicGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T21:30:37.000Z"),
})).status, "existing");

const growing = "GrowingTopicMint11111111111111111111111111";
const declining = "DecliningTopicMint22222222222222222222222";
await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-topic-growth-baseline",
  observedAt: "2026-08-03T21:31:00.000Z",
  growing,
  declining,
}));
await enrichDexSurfacePulseWithLunarTopic({
  ledgerPath,
  apiKey: "test-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T21:31:01.000Z"),
  responseNow: () => new Date("2026-08-03T21:31:01.500Z"),
  fetcher: topicFetcher({
    [growing]: [1_000, 10, 10],
    [declining]: [3_000, 30, 30],
  }),
});

await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-topic-growth-current",
  observedAt: "2026-08-03T21:46:00.000Z",
  growing,
  declining,
}));
await enrichDexSurfacePulseWithLunarTopic({
  ledgerPath,
  apiKey: "test-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T21:46:01.000Z"),
  responseNow: () => new Date("2026-08-03T21:46:01.500Z"),
  fetcher: topicFetcher({
    [growing]: [2_000, 20, 20],
    [declining]: [2_000, 20, 20],
  }),
});
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:46:02.000Z"),
  fetcher: marketFetcher({
    [growing]: ["pair-topic-growing", 1, 20_000],
    [declining]: ["pair-topic-declining", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T22:46:03.000Z"),
  fetcher: marketFetcher({
    [growing]: ["pair-topic-growing", 1.8, 25_000],
    [declining]: ["pair-topic-declining", 0.7, 18_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseLunarTopicGrowthScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.eligibleTopicComparisons, 2);
assert.equal(scorecard.parent.observations, 2);
const interactionGrowth = scorecard.screens.find((screen) => (
  screen.id === "topic-interactions-growing"
));
const consensus = scorecard.screens.find((screen) => (
  screen.id === "topic-all-growing-consensus"
));
assert.equal(interactionGrowth.observations, 1);
assert.equal(consensus.observations, 1);
assert.ok(consensus.screenAverageCapacityReturnPct > 0);
assert.ok(consensus.screenStressCapacityReturnPct > 0);
assert.ok(consensus.pairedCapacityDeltaPct > 0);
assert.equal(consensus.provisionalGate, false);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "lunarcrush-contract-topic-snapshot"
  && event.discoveryEventId === "discovery-topic-growth-baseline"
  && event.tokenAddress === growing
)).topicMetrics.interactions24h = 9_999;
const forgedScorecard = buildDexPulseLunarTopicGrowthScorecard(forged);
assert.equal(forgedScorecard.parent.observations, 2);
assert.equal(forgedScorecard.eligibleTopicComparisons, 1);
assert.equal(forgedScorecard.screens.find((screen) => (
  screen.id === "topic-all-growing-consensus"
)).observations, 0);
assert.equal(
  forgedScorecard.sourceTopicEvidenceRejectionCounts["invalid-exact-contract-topic-aggregate"],
  1,
);

console.log("token-edge DEX pulse Lunar exact-contract topic-growth checks passed.");

function discovery({ id, observedAt, growing, declining }) {
  return {
    type: "discovery",
    id,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt,
    availableAt: observedAt,
    candidates: [
      candidate(growing, "GROW", "pair-topic-growing"),
      candidate(declining, "DECLINE", "pair-topic-declining"),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress) {
  return {
    chain: "solana", tokenAddress, symbol, status: "eligible", blockers: [],
    sourceTypes: ["boost-latest"], sourceBreadth: 1, latestSourceTimestamp: null,
    latestBoostAmount: 10, totalBoostAmount: 10, hasWebsite: true, hasTwitter: true,
    pairAddress, pairAgeMinutes: 120, priceUsd: 1, liquidityUsd: 20_000,
    marketCapUsd: 100_000, volumeH1Usd: 14_000, hourlyTurnover: 0.7,
    buysH1: 200, sellsH1: 100, buySellTxnRatio: 2,
    priceChangeH1Pct: 5, priceChangeH24Pct: 10,
    fiveMinuteBuySellTxnRatio: 2, fiveMinuteTurnover: 0.1,
    priceChangeM5Pct: 1, buysM5: 20, sellsM5: 10, volumeM5Usd: 2_000,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function topicFetcher(metricsByAddress) {
  return async (url) => {
    const address = decodeURIComponent(String(url).split("/topic/")[1].split("/v1")[0]);
    const [interactions, contributors, posts] = metricsByAddress[address];
    return jsonResponse({
      data: {
        topic: address.toLowerCase(),
        title: address,
        interactions_24h: interactions,
        num_contributors: contributors,
        num_posts: posts,
        trend: "flat",
        types_count: { tweet: posts },
        types_interactions: { tweet: interactions },
        types_sentiment: { tweet: 80 },
      },
    });
  };
}

function marketFetcher(markets) {
  return async () => jsonResponse(Object.entries(markets).map(([tokenAddress, market]) => ({
    baseToken: { address: tokenAddress },
    pairAddress: market[0],
    priceUsd: String(market[1]),
    liquidity: { usd: market[2] },
  })));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}
