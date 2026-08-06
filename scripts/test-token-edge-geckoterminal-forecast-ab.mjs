#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  registerGeckoTerminalNewPoolActivation,
  watchGeckoTerminalNewPools,
} from "./token-edge/onchain-geckoterminal-new-pool-activation.mjs";
import {
  registerGeckoTerminalNewPoolDelayedShadow,
  resolveGeckoTerminalNewPoolDelayedShadows,
} from "./token-edge/onchain-geckoterminal-new-pool-delayed-shadow.mjs";
import {
  buildGeckoTerminalNewPoolForecastAbScorecard,
  captureGeckoTerminalNewPoolForecastAb,
  registerGeckoTerminalNewPoolForecastAb,
} from "./token-edge/onchain-geckoterminal-new-pool-forecast-ab.mjs";
import {
  buildGeckoTerminalNewPoolForecastPostsRescueScorecard,
  captureGeckoTerminalNewPoolForecastPostsRescue,
  registerGeckoTerminalNewPoolForecastPostsRescue,
} from "./token-edge/onchain-geckoterminal-new-pool-forecast-posts-rescue.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-gecko-forecast-ab-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:00.000Z") },
  );
  const earlierWatchAt = new Date("2026-08-04T03:59:00.000Z");
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: earlierWatchAt,
      clock: () => earlierWatchAt,
      fetcher: newPoolFetcher([poolRow({
        tokenAddress: "BeforeForecast111111111111111111111111111",
        pairAddress: "PoolBeforeForecast111111111111111111111111",
        poolCreatedAt: "2026-08-04T03:58:30.000Z",
        priceUsd: 0.00005,
        liquidityUsd: 4_000,
      })]),
    },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolForecastAb(
      { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
      { now: new Date("2026-08-04T04:00:00.000Z") },
    ),
    /strictly after its evidence boundary/,
  );
  const registration = await registerGeckoTerminalNewPoolForecastAb(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:01.000Z") },
  );
  assert.equal(registration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolForecastAb(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:02.000Z") },
  )).status, "existing");
  await registerGeckoTerminalNewPoolDelayedShadow(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:01.000Z" },
    { now: new Date("2026-08-04T04:00:03.000Z") },
  );

  const excluded = await captureGeckoTerminalNewPoolForecastAb(
    {
      ledgerPath,
      lunarcrushApiKey: "test-lunar",
      geminiApiKey: "test-gemini",
    },
    {
      now: new Date("2026-08-04T04:00:04.000Z"),
      fetcher: async () => {
        throw new Error("pre-registration discovery must not use a provider");
      },
    },
  );
  assert.equal(excluded.status, "no-strictly-future-discovery");
  assert.equal(excluded.requestsAttempted, 0);

  const watchAt = new Date("2026-08-04T04:05:00.000Z");
  const births = [
    poolRow({
      tokenAddress: "ForecastToken1111111111111111111111111111",
      pairAddress: "ForecastPool11111111111111111111111111111",
      poolCreatedAt: "2026-08-04T04:04:00.000Z",
      priceUsd: 0.0001,
      liquidityUsd: 8_000,
    }),
    poolRow({
      tokenAddress: "ForecastToken2222222222222222222222222222",
      pairAddress: "ForecastPool22222222222222222222222222222",
      poolCreatedAt: "2026-08-04T04:04:10.000Z",
      priceUsd: 0.0002,
      liquidityUsd: 12_000,
    }),
    poolRow({
      tokenAddress: "ForecastToken3333333333333333333333333333",
      pairAddress: "ForecastPool33333333333333333333333333333",
      poolCreatedAt: "2026-08-04T04:04:20.000Z",
      priceUsd: 0.0003,
      liquidityUsd: 6_000,
    }),
  ];
  const watch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    { now: watchAt, clock: () => watchAt, fetcher: newPoolFetcher(births) },
  );
  assert.equal(watch.watchedCandidates, 3);

  let providerCalls = 0;
  let topicCalls = 0;
  const forecastAt = new Date("2026-08-04T04:05:02.000Z");
  const captured = await captureGeckoTerminalNewPoolForecastAb(
    {
      ledgerPath,
      lunarcrushApiKey: "test-lunar",
      geminiApiKey: "test-gemini",
    },
    {
      now: forecastAt,
      clock: () => forecastAt,
      fetcher: async (url, request = {}) => {
        providerCalls += 1;
        if (String(url).includes("/coins/list/v1")) {
          return jsonResponse({
            config: { generated: Math.floor(forecastAt.getTime() / 1_000) },
            data: births.map((row, index) => ({
              id: index + 1,
              symbol: `F${index + 1}`,
              name: `Forecast ${index + 1}`,
              alt_rank: 10 + index,
              galaxy_score: 70 + index,
              blockchains: [{
                network: "solana",
                address: row.relationships.base_token.data.id.slice("solana_".length),
              }],
            })),
          });
        }
        if (String(url).includes("/topic/") && String(url).endsWith("/v1")) {
          topicCalls += 1;
          const tokenAddress = decodeURIComponent(String(url).split("/topic/")[1].split("/v1")[0]);
          if (topicCalls === 2) {
            return jsonResponse({ data: null });
          }
          return jsonResponse({
            data: {
              topic: tokenAddress,
              title: tokenAddress,
              interactions_24h: 1_200,
              num_contributors: 24,
              num_posts: 12,
              trend: "up",
              types_count: { tweet: 12 },
              types_interactions: { tweet: 1_200 },
              types_sentiment: { tweet: 72 },
            },
          });
        }
        if (String(url).includes(":generateContent")) {
          const body = JSON.parse(request.body);
          const prompt = body.contents[0].parts[0].text;
          const social = prompt.includes('"featureArm":"market-plus-lunar"');
          return jsonResponse({
            modelVersion: "gemini-3.6-flash",
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify(social ? {
                    predictedRise: true,
                    riseProbability: 0.8,
                    predictedReturnPct: 50,
                    confidence: 0.8,
                  } : {
                    predictedRise: false,
                    riseProbability: 0.4,
                    predictedReturnPct: -10,
                    confidence: 0.6,
                  }),
                }],
              },
            }],
          });
        }
        throw new Error(`Unexpected provider URL: ${url}`);
      },
    },
  );
  assert.equal(captured.status, "recorded");
  assert.equal(captured.selectedCandidates, 2);
  assert.equal(captured.recordedForecasts, 4);
  assert.equal(captured.requestsAttempted, 6);
  assert.equal(providerCalls, 6);
  assert.equal(captured.forecasts.filter((event) => event.status === "ready").length, 3);
  assert.deepEqual(
    [...new Set(captured.forecasts.map((event) => event.featureArm))].sort(),
    ["market-only", "market-plus-lunar"],
  );
  const marketOnly = captured.forecasts.filter((event) => event.featureArm === "market-only");
  const social = captured.forecasts.filter((event) => event.featureArm === "market-plus-lunar");
  assert.ok(marketOnly.every((event) => (
    event.socialFeatures === null
      && event.socialDataExcluded === true
      && event.paperDecision === "paper-cash"
      && event.prediction.predictedRise === false
  )));
  const readySocial = social.filter((event) => event.status === "ready");
  const blockedSocial = social.filter((event) => event.status === "blocked");
  assert.equal(readySocial.length, 1);
  assert.equal(blockedSocial.length, 1);
  assert.ok(readySocial.every((event) => (
    event.socialFeatures.interactions24h === 1_200
      && event.socialFeatures.posts === 12
      && event.socialFeatures.creators === 24
      && Number.isFinite(event.socialFeatures.altRank)
      && Number.isFinite(event.socialFeatures.galaxyScore)
      && event.paperDecision === "paper-long"
      && event.prediction.predictedRise === true
  )));
  assert.ok(blockedSocial.every((event) => (
    event.paperDecision === "unavailable"
      && event.prediction === null
      && event.blockers.includes("exact-contract-lunar-social-evidence-unavailable")
  )));
  assert.ok(captured.forecasts.every((event) => (
    event.dueAt === "2026-08-04T05:05:00.000Z"
      && event.rawModelResponseRetained === false
      && event.decisionAuthority === false
      && event.promotionAuthority === false
      && event.tradingAuthority === false
      && event.mutationAllowed === false
  )));

  const repeated = await captureGeckoTerminalNewPoolForecastAb(
    { ledgerPath, lunarcrushApiKey: "test-lunar", geminiApiKey: "test-gemini" },
    {
      now: new Date("2026-08-04T04:06:00.000Z"),
      fetcher: async () => {
        throw new Error("sealed discovery must not call providers twice");
      },
    },
  );
  assert.equal(repeated.status, "no-unsealed-future-discovery");
  assert.equal(repeated.requestsAttempted, 0);

  const openScore = buildGeckoTerminalNewPoolForecastAbScorecard(await readLedger(ledgerPath));
  assert.equal(openScore.candidateForecasts, 4);
  assert.equal(openScore.arms["market-only"].openOutcomes, 2);
  assert.equal(openScore.arms["market-plus-lunar"].openOutcomes, 2);
  assert.equal(openScore.arms["market-only"].rootMeanSquaredErrorPct, null);
  assert.equal(openScore.pairedComparison.observedPairs, 0);

  const selectedBirths = captured.forecasts
    .filter((event) => event.featureArm === "market-only")
    .map((event, index) => {
      const source = births.find((row) => (
        row.attributes.address === event.pairAddress
      ));
      return poolRow({
        tokenAddress: event.tokenAddress,
        pairAddress: event.pairAddress,
        poolCreatedAt: event.poolCreatedAt,
        priceUsd: Number(source.attributes.base_token_price_usd) * (index === 0 ? 2 : 1.5),
        liquidityUsd: Number(source.attributes.reserve_in_usd) * 1.2,
      });
    });
  const resolved = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T05:05:30.000Z"),
      clock: () => new Date("2026-08-04T05:05:31.000Z"),
      fetcher: async () => jsonResponse({ data: selectedBirths }),
    },
  );
  assert.equal(resolved.requestsAttempted, 1);
  assert.equal(resolved.observedOutcomes, 2);

  const events = await readLedger(ledgerPath);
  assert.deepEqual(verifyLedger(events), { ok: true, errors: [], eventCount: events.length });
  const score = buildGeckoTerminalNewPoolForecastAbScorecard(events);
  assert.equal(score.arms["market-only"].observedOutcomes, 2);
  assert.equal(score.arms["market-only"].paperObservedOutcomes, 2);
  assert.equal(score.arms["market-only"].forecastAvailabilityCoverage, 1);
  assert.equal(score.arms["market-only"].directionAccuracy, 0);
  assert.equal(score.arms["market-only"].meanAbsoluteErrorPct, 85);
  assert.equal(score.arms["market-only"].paperLongForecasts, 0);
  assert.equal(score.arms["market-only"].averageBaseReturnPct, 0);
  assert.equal(score.arms["market-plus-lunar"].observedOutcomes, 1);
  assert.equal(score.arms["market-plus-lunar"].paperObservedOutcomes, 2);
  assert.equal(score.arms["market-plus-lunar"].forecastAvailabilityCoverage, 0.5);
  assert.equal(score.arms["market-plus-lunar"].directionAccuracy, 1);
  assert.equal(score.arms["market-plus-lunar"].meanAbsoluteErrorPct, 50);
  assert.equal(score.arms["market-plus-lunar"].paperLongForecasts, 1);
  assert.ok(score.arms["market-plus-lunar"].averageBaseReturnPct > 0);
  assert.equal(score.pairedComparison.observedPairs, 1);
  assert.equal(score.pairedComparison.socialDirectionAccuracyDelta, 1);
  assert.equal(score.pairedComparison.socialMeanAbsoluteErrorImprovementPct, 60);
  assert.equal(score.statisticalCandidateGate, false);
  assert.equal(score.promotionAuthority, false);
  assert.equal(score.tradingAuthority, false);

  const postsRegistration = await registerGeckoTerminalNewPoolForecastPostsRescue(
    { ledgerPath, evidenceBoundary: "2026-08-04T05:58:00.000Z" },
    { now: new Date("2026-08-04T05:59:00.000Z") },
  );
  assert.equal(postsRegistration.status, "registered");

  const postsBirths = [
    poolRow({
      tokenAddress: "PostsRescueToken1111111111111111111111111",
      pairAddress: "PostsRescuePool11111111111111111111111111",
      poolCreatedAt: "2026-08-04T06:00:00.000Z",
      priceUsd: 0.0001,
      liquidityUsd: 9_000,
    }),
    poolRow({
      tokenAddress: "PostsRescueToken2222222222222222222222222",
      pairAddress: "PostsRescuePool22222222222222222222222222",
      poolCreatedAt: "2026-08-04T06:00:05.000Z",
      priceUsd: 0.0002,
      liquidityUsd: 11_000,
    }),
  ];
  const postsWatchAt = new Date("2026-08-04T06:00:30.000Z");
  const postsWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: postsWatchAt,
      clock: () => postsWatchAt,
      fetcher: newPoolFetcher(postsBirths),
    },
  );
  assert.equal(postsWatch.watchedCandidates, 2);

  let parentProviderCalls = 0;
  const postsParentAt = new Date("2026-08-04T06:00:32.000Z");
  const postsParent = await captureGeckoTerminalNewPoolForecastAb(
    { ledgerPath, lunarcrushApiKey: "test-lunar", geminiApiKey: "test-gemini" },
    {
      now: postsParentAt,
      clock: () => postsParentAt,
      fetcher: async (url, request = {}) => {
        parentProviderCalls += 1;
        if (String(url).includes("/coins/list/v1")) {
          return jsonResponse({ config: { generated: 1_775_518_432 }, data: [] });
        }
        if (String(url).includes("/topic/") && String(url).endsWith("/v1")) {
          return jsonResponse({ data: null });
        }
        if (String(url).includes(":generateContent")) {
          const prompt = JSON.parse(request.body).contents[0].parts[0].text;
          assert.match(prompt, /"featureArm":"market-only"/);
          return jsonResponse({
            modelVersion: "gemini-3.6-flash",
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              predictedRise: false,
              riseProbability: 0.3,
              predictedReturnPct: -10,
              confidence: 0.7,
            }) }] } }],
          });
        }
        throw new Error(`Unexpected parent provider URL: ${url}`);
      },
    },
  );
  assert.equal(parentProviderCalls, 5);
  assert.equal(postsParent.readyForecasts, 2);
  assert.equal(postsParent.blockedForecasts, 2);

  let postsProviderCalls = 0;
  let postCalls = 0;
  const postsCaptured = await captureGeckoTerminalNewPoolForecastPostsRescue(
    { ledgerPath, lunarcrushApiKey: "test-lunar", geminiApiKey: "test-gemini" },
    {
      now: new Date("2026-08-04T06:00:35.000Z"),
      clock: () => new Date("2026-08-04T06:00:35.000Z"),
      fetcher: async (url) => {
        postsProviderCalls += 1;
        if (String(url).includes("/posts/v1")) {
          postCalls += 1;
          const tokenAddress = decodeURIComponent(String(url).split("/topic/")[1].split("/posts/v1")[0]);
          if (postCalls === 2) {
            return jsonResponse({ config: { id: tokenAddress, topic: tokenAddress }, data: [] });
          }
          return jsonResponse({
            config: { id: tokenAddress, topic: tokenAddress },
            data: [{
              interactions_24h: 1_500,
              creator_id: "creator-not-retained",
              post_type: "tweet",
              post_sentiment: 4,
              post_created: "2026-08-04T05:55:00.000Z",
            }],
          });
        }
        if (String(url).includes(":generateContent")) {
          return jsonResponse({
            modelVersion: "gemini-3.6-flash",
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              predictedRise: true,
              riseProbability: 0.8,
              predictedReturnPct: 50,
              confidence: 0.8,
            }) }] } }],
          });
        }
        throw new Error(`Unexpected posts provider URL: ${url}`);
      },
    },
  );
  assert.equal(postsCaptured.status, "recorded");
  assert.equal(postsCaptured.discoveryEventId, postsParent.discoveryEventId);
  assert.equal(postsCaptured.eligibleTopicBlockedParents, 2);
  assert.equal(postsCaptured.requestsAttempted, 3);
  assert.equal(postsProviderCalls, 3);
  assert.equal(postsCaptured.readyForecasts, 1);
  assert.equal(postsCaptured.blockedForecasts, 1);
  const readyPosts = postsCaptured.forecasts.find((event) => event.status === "ready");
  assert.equal(readyPosts.socialFeatures.interactions24h, 1_500);
  assert.equal(readyPosts.socialFeatures.posts, 1);
  assert.equal(readyPosts.socialFeatures.creators, 1);
  assert.equal(readyPosts.rawModelResponseRetained, false);
  assert.equal(readyPosts.paperDecision, "paper-long");
  assert.equal(readyPosts.tradingAuthority, false);

  const postsSelectedBirths = postsParent.forecasts
    .filter((event) => event.featureArm === "market-only")
    .map((event, index) => {
      const source = postsBirths.find((row) => row.attributes.address === event.pairAddress);
      return poolRow({
        tokenAddress: event.tokenAddress,
        pairAddress: event.pairAddress,
        poolCreatedAt: event.poolCreatedAt,
        priceUsd: Number(source.attributes.base_token_price_usd) * (index === 0 ? 2 : 1.5),
        liquidityUsd: Number(source.attributes.reserve_in_usd) * 1.2,
      });
    });
  const postsResolved = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T07:00:40.000Z"),
      clock: () => new Date("2026-08-04T07:00:41.000Z"),
      fetcher: async () => jsonResponse({ data: postsSelectedBirths }),
    },
  );
  assert.equal(postsResolved.observedOutcomes, 2);

  const postsScore = buildGeckoTerminalNewPoolForecastPostsRescueScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(postsScore.eligibleTopicBlockedParents, 2);
  assert.equal(postsScore.arms["market-only"].observedOutcomes, 2);
  assert.equal(postsScore.arms["market-plus-lunar-posts-rescue"].observedOutcomes, 1);
  assert.equal(postsScore.arms["market-plus-lunar-posts-rescue"].paperObservedOutcomes, 2);
  assert.equal(postsScore.arms["market-plus-lunar-posts-rescue"].forecastAvailabilityCoverage, 0.5);
  assert.equal(postsScore.pairedComparison.observedPairs, 1);
  assert.equal(postsScore.pairedComparison.postsDirectionAccuracyDelta, 1);
  assert.equal(postsScore.statisticalCandidateGate, false);
  assert.equal(postsScore.promotionAuthority, false);
  assert.equal(postsScore.tradingAuthority, false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("token-edge GeckoTerminal paired forecast A/B checks passed.");

function newPoolFetcher(rows) {
  return async () => jsonResponse({ data: rows });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function poolRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceUsd,
  liquidityUsd,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "FORECAST / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: String(priceUsd),
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: "100000",
      price_change_percentage: { m5: "2", h1: "4", h24: "8" },
      volume_usd: { m5: "1000", h1: "2000", h24: "4000" },
      transactions: {
        m5: { buys: 12, sells: 5 },
        h1: { buys: 30, sells: 15 },
      },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}` } },
      quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112" } },
    },
  };
}
