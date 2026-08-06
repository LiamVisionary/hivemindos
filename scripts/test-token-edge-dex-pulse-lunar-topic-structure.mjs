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
  DEX_PULSE_LUNAR_POSTS_RULE,
  DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE,
  buildDexPulseLunarPostsScorecard,
  buildDexPulseLunarTopicStructureScorecard,
  enrichDexSurfacePulseWithLunarPosts,
  enrichDexSurfacePulseWithLunarTopicStructure,
  registerDexPulseLunarPosts,
  registerDexPulseLunarTopicStructure,
} from "./token-edge/onchain-dex-pulse-lunar-topic-structure.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-topic-structure-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:34:46.000Z"),
});
await assert.rejects(
  registerDexPulseLunarTopicStructure({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.evidenceBoundary),
  }),
  /after its boundary/,
);
const registration = await registerDexPulseLunarTopicStructure({ ledgerPath }, {
  now: new Date("2026-08-03T21:51:31.000Z"),
});
assert.equal(registration.status, "registered");

const covered = "CoveredStructureMint1111111111111111111111";
const uncovered = "UncoveredStructureMint22222222222222222222";
await appendLedgerEvent(ledgerPath, discovery(covered, uncovered));
const enrichment = await enrichDexSurfacePulseWithLunarTopicStructure({
  ledgerPath,
  apiKey: "test-key",
  maxRequests: 4,
}, {
  now: new Date("2026-08-03T21:55:01.000Z"),
  responseNow: () => new Date("2026-08-03T21:55:01.500Z"),
  fetcher: structureFetcher(covered),
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.requestBudget.attempted, 4);
assert.equal(enrichment.requestBudget.succeeded, 4);

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:55:02.000Z"),
  fetcher: marketFetcher({
    [covered]: ["pair-structure-covered", 1, 20_000],
    [uncovered]: ["pair-structure-uncovered", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T22:55:03.000Z"),
  fetcher: marketFetcher({
    [covered]: ["pair-structure-covered", 1.8, 25_000],
    [uncovered]: ["pair-structure-uncovered", 0.7, 18_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const linked = events.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === covered
));
assert.ok(linked.lunarcrushTopicStructureEnrichmentReceiptId);
assert.ok(linked.lunarcrushTopicStructureEvidenceId);
const scorecard = buildDexPulseLunarTopicStructureScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.parent.observations, 2);
const coveredScreen = scorecard.screens.find((screen) => (
  screen.id === "exact-contract-topic-structure-covered"
));
const consensus = scorecard.screens.find((screen) => (
  screen.id === "positive-distributed-creator-post-consensus"
));
assert.equal(coveredScreen.observations, 1);
assert.equal(consensus.observations, 1);
assert.ok(consensus.screenAverageCapacityReturnPct > scorecard.parent.screenAverageCapacityReturnPct);
assert.ok(consensus.screenStressCapacityReturnPct > 0);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "lunarcrush-contract-topic-structure-snapshot"
  && event.tokenAddress === covered
)).topicStructureMetrics.creator.interactions24h = 999_999;
const forgedScorecard = buildDexPulseLunarTopicStructureScorecard(forged);
assert.equal(forgedScorecard.parent.observations, 2);
assert.equal(forgedScorecard.screens.find((screen) => (
  screen.id === "exact-contract-topic-structure-covered"
)).observations, 0);
assert.equal(forgedScorecard.rejectionCounts["invalid-exact-contract-structure"], 1);

await assert.rejects(
  registerDexPulseLunarPosts({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_POSTS_RULE.evidenceBoundary),
  }),
  /after its boundary/,
);
const postsRegistration = await registerDexPulseLunarPosts({ ledgerPath }, {
  now: new Date("2026-08-03T22:56:00.000Z"),
});
const postsCovered = "CoveredPostsMint333333333333333333333333333";
const postsUncovered = "UncoveredPostsMint4444444444444444444444444";
await appendLedgerEvent(ledgerPath, postsDiscovery(postsCovered, postsUncovered));
const postsEnrichment = await enrichDexSurfacePulseWithLunarPosts({
  ledgerPath,
  apiKey: "test-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T23:00:01.000Z"),
  responseNow: () => new Date("2026-08-03T23:00:01.500Z"),
  fetcher: postsFetcher(postsCovered),
});
assert.equal(postsEnrichment.requestBudget.attempted, 2);
const postsCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T23:00:02.000Z"),
  fetcher: marketFetcher({
    [postsCovered]: ["pair-posts-covered", 1, 20_000],
    [postsUncovered]: ["pair-posts-uncovered", 1, 20_000],
  }),
});
assert.equal(postsCapture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T00:00:03.000Z"),
  fetcher: marketFetcher({
    [postsCovered]: ["pair-posts-covered", 1.8, 25_000],
    [postsUncovered]: ["pair-posts-uncovered", 0.7, 18_000],
  }),
});
const postsEvents = await readLedger(ledgerPath);
const postsLinked = postsEvents.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === postsCovered
));
assert.ok(postsLinked.lunarcrushPostsEnrichmentReceiptId);
assert.ok(postsLinked.lunarcrushPostsEvidenceId);
const postsScorecard = buildDexPulseLunarPostsScorecard(postsEvents);
assert.equal(postsScorecard.registrationId, postsRegistration.registrationId);
assert.equal(postsScorecard.candidateForecasts, 2);
assert.equal(postsScorecard.eligibleLiveObservations, 2);
const postConsensus = postsScorecard.screens.find((screen) => (
  screen.id === "positive-distributed-exact-contract-post-swarm"
));
assert.equal(postConsensus.observations, 1);
assert.ok(postConsensus.screenStressCapacityReturnPct > 0);
const forgedPosts = structuredClone(postsEvents);
forgedPosts.find((event) => (
  event.type === "lunarcrush-contract-posts-snapshot"
  && event.tokenAddress === postsCovered
)).postMetrics.interactions24h = 999_999;
const forgedPostsScorecard = buildDexPulseLunarPostsScorecard(forgedPosts);
assert.equal(forgedPostsScorecard.parent.observations, 2);
assert.equal(forgedPostsScorecard.screens.find((screen) => (
  screen.id === "exact-contract-posts-covered"
)).observations, 0);
assert.equal(forgedPostsScorecard.rejectionCounts["invalid-exact-contract-posts"], 1);

console.log("token-edge DEX pulse Lunar exact-contract topic-structure checks passed.");

function discovery(coveredAddress, uncoveredAddress) {
  return {
    type: "discovery",
    id: "discovery-lunar-topic-structure-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T21:55:00.000Z",
    availableAt: "2026-08-03T21:55:00.000Z",
    candidates: [
      candidate(coveredAddress, "COVERED", "pair-structure-covered"),
      candidate(uncoveredAddress, "UNCOVERED", "pair-structure-uncovered"),
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

function structureFetcher(coveredAddress) {
  return async (url) => {
    const target = String(url);
    const address = decodeURIComponent(target.split("/topic/")[1].split("/")[0]);
    if (target.includes("/creators/")) {
      return jsonResponse({
        data: Array.from({ length: 10 }, (_, index) => ({
          creator_id: `private-${index}`,
          creator_name: "must-not-be-retained",
          interactions_24h: 100,
          creator_followers: 1_000,
          creator_rank: 50,
        })),
      });
    }
    return jsonResponse({
      config: {
        id: address === coveredAddress ? address : address.toLowerCase(),
        topic: address.toLowerCase(),
        type: "topic",
      },
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `private-post-${index}`,
        creator_id: `private-${index}`,
        post_description: "must-not-be-retained",
        post_type: "tweet",
        post_sentiment: 4,
        interactions_24h: 100,
      })),
    });
  };
}

function postsDiscovery(coveredAddress, uncoveredAddress) {
  return {
    type: "discovery",
    id: "discovery-lunar-posts-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T23:00:00.000Z",
    availableAt: "2026-08-03T23:00:00.000Z",
    candidates: [
      candidate(coveredAddress, "POSTWIN", "pair-posts-covered"),
      candidate(uncoveredAddress, "POSTLOSE", "pair-posts-uncovered"),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function postsFetcher(coveredAddress) {
  return async (url) => {
    const address = decodeURIComponent(String(url).split("/topic/")[1].split("/")[0]);
    return jsonResponse({
      config: {
        id: address === coveredAddress ? address : address.toLowerCase(),
        topic: address.toLowerCase(),
        type: "topic",
      },
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `private-post-${index}`,
        creator_id: `private-${index}`,
        post_description: "must-not-be-retained",
        post_type: "tweet",
        post_sentiment: 4,
        interactions_24h: 100,
      })),
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
