#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerEvent,
  digestValue,
  readLedger,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  registerDexPulseEntryProviderPriceIntegrity,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE,
  buildGeminiPostSemanticsStabilityAudit,
  buildDexPulseLunarGeminiPostSemanticsScorecard,
  enrichDexSurfacePulseWithLunarGeminiPostSemantics,
  registerDexPulseLunarGeminiPostSemantics,
} from "./token-edge/onchain-dex-pulse-lunar-post-semantics.mjs";
import {
  DEX_PULSE_LUNAR_POST_GROWTH_RULE,
  DEX_PULSE_LUNAR_POST_RECENCY_RULE,
  buildDexPulseLunarPostGrowthScorecard,
  buildDexPulseLunarPostRecencyScorecard,
  registerDexPulseLunarPostGrowth,
  registerDexPulseLunarPostRecency,
} from "./token-edge/onchain-dex-pulse-lunar-post-growth.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-semantics-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:34:46.000Z"),
});
await assert.rejects(
  registerDexPulseLunarGeminiPostSemantics({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.evidenceBoundary),
  }),
  /after its boundary/,
);
const registration = await registerDexPulseLunarGeminiPostSemantics({ ledgerPath }, {
  now: new Date("2026-08-03T22:40:02.000Z"),
});
assert.equal(registration.status, "registered");
const repeated = await registerDexPulseLunarGeminiPostSemantics({ ledgerPath }, {
  now: new Date("2026-08-03T22:40:03.000Z"),
});
assert.equal(repeated.status, "existing");
assert.equal(repeated.registrationId, registration.registrationId);

const organic = "OrganicSemanticMint11111111111111111111111";
const hype = "HypeSemanticMint22222222222222222222222222";
await appendLedgerEvent(ledgerPath, discovery(organic, hype));
let modelRequestCount = 0;
const enrichment = await enrichDexSurfacePulseWithLunarGeminiPostSemantics({
  ledgerPath,
  lunarcrushApiKey: "lunar-secret-test-key",
  geminiApiKey: "gemini-secret-test-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T22:45:01.000Z"),
  responseNow: () => new Date("2026-08-03T22:45:01.500Z"),
  fetcher: semanticFetcher(organic, () => { modelRequestCount += 1; }),
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.lunarRequestBudget.attempted, 2);
assert.equal(enrichment.lunarRequestBudget.succeeded, 2);
assert.equal(enrichment.geminiRequestBudget.attempted, 2);
assert.equal(enrichment.geminiRequestBudget.succeeded, 2);
assert.equal(modelRequestCount, 2);
assert.equal(enrichment.evidence.length, 2);

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T22:45:02.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1, 20_000],
    [hype]: ["pair-semantic-hype", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T23:45:03.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1.5, 25_000],
    [hype]: ["pair-semantic-hype", 0.5, 18_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const ledgerText = JSON.stringify(events);
assert.equal(ledgerText.includes("Sensitive Creator"), false);
assert.equal(ledgerText.includes("creator-secret-"), false);
assert.equal(ledgerText.includes("concrete release evidence"), false);
assert.equal(ledgerText.includes("buy buy moon"), false);
assert.equal(ledgerText.includes("lunar-secret-test-key"), false);
assert.equal(ledgerText.includes("gemini-secret-test-key"), false);
const linked = events.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === organic
));
assert.ok(linked.lunarcrushGeminiSemanticsEnrichmentReceiptId);
assert.ok(linked.lunarcrushGeminiPostsEvidenceId);
assert.ok(linked.lunarcrushGeminiSemanticsEvidenceId);

const scorecard = buildDexPulseLunarGeminiPostSemanticsScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.parent.observations, 2);
const coverage = scorecard.screens.find((screen) => (
  screen.id === "exact-contract-post-semantics-covered"
));
const organicScreen = scorecard.screens.find((screen) => (
  screen.id === "organic-bullish-specific-narrative"
));
assert.equal(coverage.observations, 2);
assert.equal(organicScreen.observations, 1);
assert.equal(scorecard.semanticStability.repeatedCorpusDigests, 0);
assert.ok(organicScreen.screenAverageCapacityReturnPct
  > scorecard.parent.screenAverageCapacityReturnPct);
assert.ok(organicScreen.screenStressCapacityReturnPct > 0);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "lunarcrush-contract-post-semantics-snapshot"
  && event.tokenAddress === organic
)).semanticMetrics.coordinatedPromotionShare = 0.99;
const forgedScorecard = buildDexPulseLunarGeminiPostSemanticsScorecard(forged);
assert.equal(forgedScorecard.parent.observations, 2);
assert.equal(forgedScorecard.screens.find((screen) => (
  screen.id === "exact-contract-post-semantics-covered"
)).observations, 1);
assert.equal(forgedScorecard.rejectionCounts["invalid-exact-contract-semantics"], 1);

const organicSemantics = events.find((event) => (
  event.type === "lunarcrush-contract-post-semantics-snapshot"
  && event.tokenAddress === organic
));
const repeatedSemantics = structuredClone(organicSemantics);
repeatedSemantics.semanticMetrics.narrativeCoherence = 0.1;
repeatedSemantics.semanticMetricsDigest = digestValue(repeatedSemantics.semanticMetrics);
const stability = buildGeminiPostSemanticsStabilityAudit([
  organicSemantics,
  repeatedSemantics,
]);
assert.equal(stability.repeatedCorpusDigests, 1);
assert.equal(stability.maximumMetricRanges.narrativeCoherence, 0.8);
assert.equal(stability.screenDecisionFlipCounts["organic-bullish-specific-narrative"], 1);

await assert.rejects(
  registerDexPulseLunarPostGrowth({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_POST_GROWTH_RULE.evidenceBoundary),
  }),
  /after its boundary/,
);
const growthRegistration = await registerDexPulseLunarPostGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T22:56:16.000Z"),
});
const repeatedGrowthRegistration = await registerDexPulseLunarPostGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T22:56:17.000Z"),
});
assert.equal(repeatedGrowthRegistration.status, "existing");
await appendLedgerEvent(ledgerPath, growthDiscovery(
  "discovery-lunar-post-growth-baseline",
  "2026-08-03T23:00:00.000Z",
  organic,
  hype,
));
await enrichDexSurfacePulseWithLunarGeminiPostSemantics({
  ledgerPath,
  lunarcrushApiKey: "lunar-key",
  geminiApiKey: "gemini-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T23:00:01.000Z"),
  responseNow: () => new Date("2026-08-03T23:00:01.500Z"),
  fetcher: growthFetcher(organic, "baseline"),
});
await assert.rejects(
  registerDexPulseLunarPostRecency({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_POST_RECENCY_RULE.evidenceBoundary),
  }),
  /after its boundary/,
);
const recencyRegistration = await registerDexPulseLunarPostRecency({ ledgerPath }, {
  now: new Date("2026-08-03T23:03:38.000Z"),
});
await appendLedgerEvent(ledgerPath, growthDiscovery(
  "discovery-lunar-post-growth-current",
  "2026-08-03T23:15:00.000Z",
  organic,
  hype,
));
await enrichDexSurfacePulseWithLunarGeminiPostSemantics({
  ledgerPath,
  lunarcrushApiKey: "lunar-key",
  geminiApiKey: "gemini-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T23:15:01.000Z"),
  responseNow: () => new Date("2026-08-03T23:15:01.500Z"),
  fetcher: growthFetcher(organic, "current"),
});
await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T23:15:02.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1, 20_000],
    [hype]: ["pair-semantic-hype", 1, 20_000],
  }),
});
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T00:15:03.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1.5, 25_000],
    [hype]: ["pair-semantic-hype", 0.5, 18_000],
  }),
});
const growthEvents = await readLedger(ledgerPath);
const growthScorecard = buildDexPulseLunarPostGrowthScorecard(growthEvents);
assert.equal(growthScorecard.registrationId, growthRegistration.registrationId);
assert.equal(growthScorecard.candidateForecasts, 2);
assert.equal(growthScorecard.eligiblePostComparisons, 2);
const interactionGrowth = growthScorecard.screens.find((screen) => (
  screen.id === "post-interactions-growing"
));
const growthConsensus = growthScorecard.screens.find((screen) => (
  screen.id === "post-activity-breadth-growing-consensus"
));
assert.equal(interactionGrowth.observations, 1);
assert.equal(growthConsensus.observations, 1);
assert.ok(growthConsensus.screenStressCapacityReturnPct > 0);
const forgedGrowthEvents = structuredClone(growthEvents);
forgedGrowthEvents.find((event) => (
  event.type === "lunarcrush-contract-posts-snapshot"
  && event.discoveryEventId === "discovery-lunar-post-growth-baseline"
  && event.tokenAddress === organic
)).postMetrics.interactions24h = 999_999;
const forgedGrowthScorecard = buildDexPulseLunarPostGrowthScorecard(forgedGrowthEvents);
assert.equal(forgedGrowthScorecard.screens.find((screen) => (
  screen.id === "post-activity-breadth-growing-consensus"
)).observations, 0);
assert.equal(
  forgedGrowthScorecard.sourcePostPointRejectionCounts["invalid-exact-contract-post-point"],
  1,
);
const recencyScorecard = buildDexPulseLunarPostRecencyScorecard(growthEvents);
assert.equal(recencyScorecard.registrationId, recencyRegistration.registrationId);
assert.equal(recencyScorecard.candidateForecasts, 2);
assert.equal(recencyScorecard.recencyCoveredObservations, 2);
const freshHour = recencyScorecard.screens.find((screen) => (
  screen.id === "any-post-created-within-one-hour"
));
const freshSwarm = recencyScorecard.screens.find((screen) => (
  screen.id === "fresh-distributed-exact-post-swarm"
));
assert.equal(freshHour.observations, 1);
assert.equal(freshSwarm.observations, 1);
assert.ok(freshSwarm.screenStressCapacityReturnPct > 0);

await appendLedgerEvent(ledgerPath, growthDiscovery(
  "discovery-lunar-semantic-cache",
  "2026-08-03T23:50:00.000Z",
  organic,
  hype,
));
let cachedModelRequests = 0;
const cachedEnrichment = await enrichDexSurfacePulseWithLunarGeminiPostSemantics({
  ledgerPath,
  lunarcrushApiKey: "lunar-key",
  geminiApiKey: "gemini-key",
  maxRequests: 2,
}, {
  now: new Date("2026-08-03T23:50:01.000Z"),
  responseNow: () => new Date("2026-08-03T23:50:01.500Z"),
  fetcher: semanticFetcher(organic, () => { cachedModelRequests += 1; }),
});
assert.equal(cachedEnrichment.geminiRequestBudget.attempted, 0);
assert.equal(cachedEnrichment.geminiRequestBudget.exactCorpusCacheHits, 2);
assert.equal(cachedModelRequests, 0);
await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T23:50:02.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1, 20_000],
    [hype]: ["pair-semantic-hype", 1, 20_000],
  }),
});
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T00:50:03.000Z"),
  fetcher: marketFetcher({
    [organic]: ["pair-semantic-organic", 1.5, 25_000],
    [hype]: ["pair-semantic-hype", 0.5, 18_000],
  }),
});
const cachedEvents = await readLedger(ledgerPath);
const cachedSemantics = cachedEvents.filter((event) => (
  event.type === "lunarcrush-contract-post-semantics-snapshot"
  && event.discoveryEventId === "discovery-lunar-semantic-cache"
));
assert.equal(cachedSemantics.length, 2);
assert.ok(cachedSemantics.every((event) => (
  event.semanticInferenceSource === "exact-corpus-cache"
  && event.cachedSemanticEvidenceId
  && event.semanticCachePolicyVersion === "lunarcrush-gemini-exact-corpus-cache-v1"
)));
const cachedScorecard = buildDexPulseLunarGeminiPostSemanticsScorecard(cachedEvents);
assert.equal(cachedScorecard.candidateForecasts, 6);
assert.equal(cachedScorecard.eligibleLiveObservations, 6);
const forgedCacheEvents = structuredClone(cachedEvents);
forgedCacheEvents.find((event) => (
  event.type === "lunarcrush-contract-post-semantics-snapshot"
  && event.discoveryEventId === "discovery-lunar-semantic-cache"
)).cachedSemanticEvidenceId = "missing-cache-source";
const forgedCacheScorecard = buildDexPulseLunarGeminiPostSemanticsScorecard(forgedCacheEvents);
assert.equal(forgedCacheScorecard.parent.observations, cachedScorecard.parent.observations);
assert.equal(forgedCacheScorecard.rejectionCounts["invalid-cached-semantic-lineage"], 1);

console.log("token-edge DEX pulse Lunar Gemini post-semantics checks passed.");

function discovery(organicAddress, hypeAddress) {
  return {
    type: "discovery",
    id: "discovery-lunar-gemini-semantics-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T22:45:00.000Z",
    availableAt: "2026-08-03T22:45:00.000Z",
    candidates: [
      candidate(organicAddress, "ORGANIC", "pair-semantic-organic"),
      candidate(hypeAddress, "HYPE", "pair-semantic-hype"),
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

function semanticFetcher(organicAddress, onModelRequest) {
  return async (url, init = {}) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      onModelRequest();
      const request = JSON.parse(init.body);
      const prompt = request.contents[0].parts[0].text;
      assert.equal(prompt.includes("Sensitive Creator"), false);
      assert.equal(prompt.includes("creator-secret-"), false);
      assert.equal(prompt.includes("follower-secret"), false);
      assert.ok(prompt.includes("Do not use web search"));
      const isOrganic = prompt.includes("concrete release evidence");
      return jsonResponse({
        modelVersion: "gemini-3.6-flash",
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(isOrganic ? {
              analyzedPostCount: 10,
              substantiveProjectEvidenceShare: 0.9,
              coordinatedPromotionShare: 0.1,
              genericHypeShare: 0.1,
              bullishIntentShare: 0.8,
              riskWarningShare: 0.1,
              narrativeCoherence: 0.9,
              informationNovelty: 0.9,
              semanticConfidence: 0.9,
            } : {
              analyzedPostCount: 10,
              substantiveProjectEvidenceShare: 0.1,
              coordinatedPromotionShare: 0.9,
              genericHypeShare: 0.9,
              bullishIntentShare: 0.9,
              riskWarningShare: 0,
              narrativeCoherence: 0.2,
              informationNovelty: 0.1,
              semanticConfidence: 0.9,
            }) }],
          },
        }],
      });
    }
    const address = decodeURIComponent(target.split("/topic/")[1].split("/")[0]);
    const isOrganic = address === organicAddress;
    return jsonResponse({
      config: { id: address, topic: address.toLowerCase(), type: "topic" },
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `private-post-${index}`,
        creator_id: `creator-secret-${index}`,
        creator_name: "Sensitive Creator",
        creator_followers: "follower-secret",
        post_title: isOrganic ? "concrete release evidence" : "buy buy moon",
        post_description: isOrganic
          ? `specific independent product update ${index}`
          : "buy buy moon giveaway raid",
        post_type: "tweet",
        post_sentiment: 4,
        interactions_24h: 100,
      })),
    });
  };
}

function growthDiscovery(id, observedAt, organicAddress, hypeAddress) {
  return {
    ...discovery(organicAddress, hypeAddress),
    id,
    observedAt,
    availableAt: observedAt,
  };
}

function growthFetcher(organicAddress, phase) {
  return async (url, init = {}) => {
    const target = String(url);
    if (target.includes("generativelanguage.googleapis.com")) {
      const request = JSON.parse(init.body);
      const prompt = request.contents[0].parts[0].text;
      const count = Number(prompt.match(/analyzedPostCount must equal (\d+)/)?.[1]);
      return jsonResponse({
        modelVersion: "gemini-3.6-flash",
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          analyzedPostCount: count,
          substantiveProjectEvidenceShare: 0.5,
          coordinatedPromotionShare: 0.5,
          genericHypeShare: 0.5,
          bullishIntentShare: 0.5,
          riskWarningShare: 0.5,
          narrativeCoherence: 0.5,
          informationNovelty: 0.5,
          semanticConfidence: 0.5,
        }) }] } }],
      });
    }
    const address = decodeURIComponent(target.split("/topic/")[1].split("/")[0]);
    const isOrganic = address === organicAddress;
    const count = phase === "baseline" ? 5 : (isOrganic ? 10 : 5);
    return jsonResponse({
      config: { id: address, topic: address.toLowerCase(), type: "topic" },
      data: Array.from({ length: count }, (_, index) => ({
        creator_id: isOrganic && phase === "current"
          ? `organic-${index}` : `${address}-creator-${index % 5}`,
        post_title: `${phase}-${address}-${index}`,
        post_description: `${phase} post ${index}`,
        post_type: "tweet",
        post_sentiment: 4,
        post_created: Date.parse(isOrganic && phase === "current"
          ? "2026-08-03T23:10:00.000Z"
          : "2026-08-03T10:00:00.000Z") / 1_000,
        interactions_24h: isOrganic && phase === "current" ? 200 : 100,
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
