#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  registerDexPulseEntryProviderPriceIntegrity,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import {
  enrichDexSurfacePulseWithLunar,
  registerDexPulseLunar,
  registerDexPulseLunarCreator,
} from "./token-edge/onchain-dex-pulse-lunar-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE,
  buildDexPulseLunarCreatorAccelerationScorecard,
  registerDexPulseLunarCreatorAcceleration,
} from "./token-edge/onchain-dex-pulse-lunar-creator-acceleration.mjs";
import {
  LUNARCRUSH_MOVE_ALERT_RULE,
  deriveLunarCrushMoveAlertFeatures,
} from "./token-edge/onchain-lunarcrush-provider.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-creator-acceleration-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseLunar({ ledgerPath }, { now: new Date("2026-08-03T14:24:01.000Z") });
await registerDexPulseLunarCreator({ ledgerPath }, { now: new Date("2026-08-03T14:24:02.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:30:16.000Z"),
});
await assert.rejects(
  registerDexPulseLunarCreatorAcceleration({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseLunarCreatorAcceleration({ ledgerPath }, {
  now: new Date("2026-08-03T20:24:46.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseLunarCreatorAcceleration({ ledgerPath }, {
  now: new Date("2026-08-03T20:24:47.000Z"),
})).status, "existing");

const winner = "CreatorAccelerationWinner111";
const loser = "CreatorAccelerationLoser222";
await appendLedgerEvent(ledgerPath, discovery([winner, loser]));
await enrichDexSurfacePulseWithLunar({ ledgerPath, apiKey: "test" }, {
  now: new Date("2026-08-03T20:25:02.000Z"),
  collector: async () => collection([winner, loser]),
});
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T20:25:04.000Z"),
  fetcher: marketFetcher({
    [winner]: ["pair-creator-acceleration-winner", 1, 20_000],
    [loser]: ["pair-creator-acceleration-loser", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:25:05.000Z"),
  fetcher: marketFetcher({
    [winner]: ["pair-creator-acceleration-winner", 1.3, 20_000],
    [loser]: ["pair-creator-acceleration-loser", 0.5, 20_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseLunarCreatorAccelerationScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.creatorAccelerationPolicy.observations, 1);
assert.equal(scorecard.creatorAccelerationPolicy.uniqueTokens, 1);
assert.ok(scorecard.parentPolicy.averageCapacityReturnPct < 0);
assert.ok(scorecard.creatorAccelerationPolicy.averageCapacityReturnPct > 0);
assert.ok(scorecard.creatorAccelerationPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(scorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
const winnerForecast = forged.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === winner
));
const creatorEvidence = forged.find((event) => event.id === winnerForecast.lunarcrushCreatorEvidenceId);
creatorEvidence.creatorMetrics.topCreatorInteractionShare = 0.99;
const forgedScorecard = buildDexPulseLunarCreatorAccelerationScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 2);
assert.equal(forgedScorecard.creatorAccelerationPolicy.observations, 0);
assert.equal(forgedScorecard.sourceCreatorRejectionCounts["invalid-creator-aggregate"], 1);

console.log("token-edge DEX pulse Lunar creator-acceleration checks passed.");

function discovery(addresses) {
  return {
    type: "discovery",
    id: "discovery-creator-acceleration-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T20:25:00.000Z",
    availableAt: "2026-08-03T20:25:00.000Z",
    candidates: addresses.map((tokenAddress, index) => ({
      chain: "solana",
      tokenAddress,
      symbol: index === 0 ? "WIN" : "LOSE",
      status: "eligible",
      blockers: [],
      sourceTypes: ["profile-latest"],
      sourceBreadth: 1,
      latestSourceTimestamp: "2026-08-03T20:24:59.000Z",
      latestBoostAmount: 0,
      totalBoostAmount: 0,
      hasWebsite: true,
      hasTwitter: true,
      pairAddress: index === 0
        ? "pair-creator-acceleration-winner" : "pair-creator-acceleration-loser",
      pairAgeMinutes: 120,
      priceUsd: 1,
      liquidityUsd: 20_000,
      marketCapUsd: 100_000,
      volumeH1Usd: 14_000,
      hourlyTurnover: 0.7,
      volumeM5Usd: 2_000,
      fiveMinuteTurnover: 0.1,
      buysH1: 200,
      sellsH1: 100,
      buySellTxnRatio: 2,
      buysM5: 20,
      sellsM5: 10,
      fiveMinuteBuySellTxnRatio: 2,
      priceChangeM5Pct: 2,
      priceChangeH1Pct: 5,
      priceChangeH24Pct: 10,
      ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    })),
    researchOnly: true,
    mutationAllowed: false,
  };
}

function collection(addresses) {
  return {
    observedAt: "2026-08-03T20:25:02.000Z",
    availableAt: "2026-08-03T20:25:03.000Z",
    requestBudget: { maximum: 10, attempted: 10, succeeded: 10, failed: 0 },
    universe: { complete: true, rowsFetched: 5_466 },
    events: addresses.map((address, index) => socialEvent(address, index)),
    creatorEvents: [
      creatorEvent(addresses[0], {
        creatorCount: 20,
        interactions24h: 10_000,
        topCreatorInteractionShare: 0.2,
        creatorInteractionHhi: 0.1,
        medianCreatorFollowers: 2_000,
        medianCreatorRank: 10,
        networkCounts: { unspecified: 20 },
      }),
      creatorEvent(addresses[1], {
        creatorCount: 3,
        interactions24h: 1_000,
        topCreatorInteractionShare: 0.8,
        creatorInteractionHhi: 0.7,
        medianCreatorFollowers: 200_000,
        medianCreatorRank: 2,
        networkCounts: { unspecified: 3 },
      }),
    ],
  };
}

function socialEvent(address, index) {
  const historyRows = Array.from({ length: 25 }, (_, rowIndex) => ({
    time: 1_785_700_000 + (rowIndex * 3_600),
    interactions: rowIndex === 24 ? 1_000 + index : 100 + (rowIndex % 3),
    postsActive: rowIndex === 24 ? 200 + index : 20 + (rowIndex % 3),
    contributorsActive: rowIndex === 24 ? 100 + index : 10 + (rowIndex % 2),
    altRank: rowIndex === 24 ? 50 : 500,
    galaxyScore: rowIndex === 24 ? 80 : 40,
    sentiment: 90,
    spam: 10,
    socialDominance: 0.1,
    close: 1,
  }));
  return {
    type: "lunarcrush-social-snapshot",
    id: `lunarcrush-social-creator-acceleration-${index}`,
    observedAt: "2026-08-03T20:25:02.000Z",
    availableAt: "2026-08-03T20:25:03.000Z",
    provider: "lunarcrush",
    profile: "exact-mint-hourly",
    chain: "solana",
    tokenAddress: address,
    status: "ready",
    blockers: [],
    ruleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    rule: LUNARCRUSH_MOVE_ALERT_RULE,
    identity: { matchStatus: "exact-single-contract-match", contractAddress: address },
    historyGeneratedAt: "2026-08-03T20:25:02.000Z",
    historyRows,
    socialFeatures: deriveLunarCrushMoveAlertFeatures(historyRows),
    researchOnly: true,
    mutationAllowed: false,
  };
}

function creatorEvent(address, creatorMetrics) {
  return {
    type: "lunarcrush-creator-aggregate",
    id: `lunarcrush-creator-acceleration-${address}`,
    observedAt: "2026-08-03T20:25:02.000Z",
    availableAt: "2026-08-03T20:25:03.000Z",
    provider: "lunarcrush",
    profile: "social-discovery-creator-aggregate",
    chain: "solana",
    tokenAddress: address,
    status: "ready",
    blockers: [],
    identity: { matchStatus: "exact-single-contract-topic-match", contractAddress: address },
    topicJoinStatus: "provider-coin-row-exact-contract-unique-topic",
    creatorGeneratedAt: "2026-08-03T20:25:02.000Z",
    providerGenerationReported: true,
    creatorAggregateDigest: digestValue(creatorMetrics),
    creatorMetrics,
    aggregateOnly: true,
    rawCreatorIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function marketFetcher(markets) {
  return async () => ({
    ok: true,
    json: async () => Object.entries(markets).map(([tokenAddress, market]) => ({
      baseToken: { address: tokenAddress },
      pairAddress: market[0],
      priceUsd: String(market[1]),
      liquidity: { usd: market[2] },
    })),
  });
}
