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
  DEX_PULSE_LUNAR_TOPIC_RULE,
  buildDexPulseLunarTopicScorecard,
  enrichDexSurfacePulseWithLunarTopic,
  registerDexPulseLunarTopic,
} from "./token-edge/onchain-dex-pulse-lunar-topic-monitoring.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-topic-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:34:46.000Z"),
});
await assert.rejects(
  registerDexPulseLunarTopic({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_TOPIC_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseLunarTopic({ ledgerPath }, {
  now: new Date("2026-08-03T21:06:31.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseLunarTopic({ ledgerPath }, {
  now: new Date("2026-08-03T21:06:32.000Z"),
})).status, "existing");

const covered = "CoveredTopicMint11111111111111111111111111";
const uncovered = "UncoveredTopicMint222222222222222222222222";
await appendLedgerEvent(ledgerPath, discovery(covered, uncovered));
const enrichment = await enrichDexSurfacePulseWithLunarTopic({
  ledgerPath,
  apiKey: "test-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T21:10:01.000Z"),
  responseNow: () => new Date("2026-08-03T21:10:01.500Z"),
  fetcher: topicFetcher(covered),
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.requestBudget.attempted, 2);
assert.equal(enrichment.requestBudget.succeeded, 2);

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:10:02.000Z"),
  fetcher: marketFetcher({
    [covered]: ["pair-topic-covered", 1, 20_000],
    [uncovered]: ["pair-topic-uncovered", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T22:10:03.000Z"),
  fetcher: marketFetcher({
    [covered]: ["pair-topic-covered", 1.8, 25_000],
    [uncovered]: ["pair-topic-uncovered", 0.7, 18_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseLunarTopicScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.parent.observations, 2);
const coverage = scorecard.screens.find((screen) => screen.id === "exact-contract-topic-covered");
const consensus = scorecard.screens.find((screen) => (
  screen.id === "exact-contract-topic-breadth-consensus"
));
assert.equal(coverage.observations, 1);
assert.equal(consensus.observations, 1);
assert.ok(consensus.screenAverageCapacityReturnPct > scorecard.parent.screenAverageCapacityReturnPct);
assert.ok(consensus.screenStressCapacityReturnPct > 0);

const forged = structuredClone(events);
forged.find((event) => event.type === "lunarcrush-contract-topic-snapshot"
  && event.tokenAddress === covered).topicMetrics.interactions24h = 999_999;
const forgedScorecard = buildDexPulseLunarTopicScorecard(forged);
assert.equal(forgedScorecard.parent.observations, 2);
assert.equal(forgedScorecard.screens.find((screen) => (
  screen.id === "exact-contract-topic-covered"
)).observations, 0);
assert.equal(forgedScorecard.rejectionCounts["invalid-exact-contract-topic-aggregate"], 1);

console.log("token-edge DEX pulse Lunar exact-contract topic checks passed.");

function discovery(coveredAddress, uncoveredAddress) {
  return {
    type: "discovery",
    id: "discovery-lunar-topic-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T21:10:00.000Z",
    availableAt: "2026-08-03T21:10:00.000Z",
    candidates: [
      candidate(coveredAddress, "COVERED", "pair-topic-covered"),
      candidate(uncoveredAddress, "UNCOVERED", "pair-topic-uncovered"),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress) {
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
    priceChangeH1Pct: 5,
    priceChangeH24Pct: 10,
    fiveMinuteBuySellTxnRatio: 2,
    fiveMinuteTurnover: 0.1,
    priceChangeM5Pct: 1,
    buysM5: 20,
    sellsM5: 10,
    volumeM5Usd: 2_000,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function topicFetcher(coveredAddress) {
  return async (url) => {
    const address = decodeURIComponent(String(url).split("/topic/")[1].split("/v1")[0]);
    const covered = address === coveredAddress;
    return jsonResponse({
      data: covered ? {
        topic: address.toLowerCase(),
        title: address,
        interactions_24h: 10_000,
        num_contributors: 20,
        num_posts: 20,
        trend: "up",
        types_count: { tweet: 20 },
        types_interactions: { tweet: 10_000 },
        types_sentiment: { tweet: 80 },
      } : {
        topic: address.toLowerCase(),
        title: address.toLowerCase(),
        interactions_24h: null,
        num_contributors: null,
        num_posts: null,
      },
    });
  };
}

function marketFetcher(markets) {
  return async (url) => jsonResponse(Object.entries(markets).map(([tokenAddress, market]) => ({
    baseToken: { address: tokenAddress },
    pairAddress: market[0],
    priceUsd: String(market[1]),
    liquidity: { usd: market[2] },
    sourceRoute: String(url).includes("/token-pairs/") ? "direct" : "batch",
  })));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}
