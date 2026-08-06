#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_CREATOR_RULE,
  buildDexPulseLunarCreatorScorecard,
  enrichDexSurfacePulseWithLunar,
  registerDexPulseLunar,
  registerDexPulseLunarCreator,
} from "./token-edge/onchain-dex-pulse-lunar-monitoring.mjs";
import { LUNARCRUSH_MOVE_ALERT_RULE } from "./token-edge/onchain-lunarcrush-provider.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-creator-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseLunar({ ledgerPath }, { now: new Date("2026-08-03T14:24:01.000Z") });
await assert.rejects(
  registerDexPulseLunarCreator({ ledgerPath }, {
    now: new Date(DEX_PULSE_LUNAR_CREATOR_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const creatorRegistration = await registerDexPulseLunarCreator({ ledgerPath }, {
  now: new Date("2026-08-03T14:24:02.000Z"),
});
assert.equal(creatorRegistration.status, "registered");
assert.equal((await registerDexPulseLunarCreator({ ledgerPath }, {
  now: new Date("2026-08-03T14:24:03.000Z"),
})).status, "existing");

const winner = "LunarCreatorWinner111";
const loser = "LunarCreatorLoser222";
await appendLedgerEvent(ledgerPath, discovery([winner, loser], "2026-08-03T14:25:00.000Z"));
let collectorOptions = null;
const enrichment = await enrichDexSurfacePulseWithLunar({ ledgerPath, apiKey: "test" }, {
  now: new Date("2026-08-03T14:25:02.000Z"),
  collector: async (options) => {
    collectorOptions = options;
    return collection([winner, loser]);
  },
});
assert.deepEqual(collectorOptions.creatorTokenAddresses, [winner, loser]);
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.creatorStatus, "recorded");
assert.equal(enrichment.creatorEvidence.length, 2);

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T14:25:04.000Z"),
});
assert.equal(capture.recordedForecasts, 2);
const eventsAfterCapture = await readLedger(ledgerPath);
const forecasts = eventsAfterCapture.filter((event) => event.type === "dex-surface-pulse-forecast");
assert.equal(forecasts.length, 2);
for (const forecast of forecasts) {
  assert.equal(forecast.lunarcrushCreatorRegistrationId, creatorRegistration.registrationId);
  assert.ok(forecast.lunarcrushCreatorEvidenceId);
  assert.equal(forecast.lunarcrushEnrichmentReceiptId, enrichment.receiptId);
}

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T15:25:05.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [
      pair(winner, "pair-creator-winner", 1.25),
      pair(loser, "pair-creator-loser", 0.75),
    ],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseLunarCreatorScorecard(events);
assert.equal(scorecard.registrationId, creatorRegistration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.uniqueTokens, 2);
const distributed = scorecard.screens.find((screen) => screen.id === "distributed-creator-swarm");
assert.equal(distributed.observations, 1);
assert.ok(distributed.screenAverageCapacityReturnPct > 0);
assert.ok(distributed.pairedCapacityDeltaPct > 0);
assert.equal(scorecard.screens.find((screen) => screen.id === "concentrated-creator-attention").observations, 1);

const forged = structuredClone(events);
const forgedForecast = forged.find((event) => event.tokenAddress === winner
  && event.type === "dex-surface-pulse-forecast");
const forgedCreator = forged.find((event) => event.id === forgedForecast.lunarcrushCreatorEvidenceId);
forgedCreator.creatorMetrics.topCreatorInteractionShare = 0.99;
const forgedScorecard = buildDexPulseLunarCreatorScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);
assert.equal(forgedScorecard.rejectionCounts["invalid-creator-aggregate"], 1);

const oldLedgerPath = path.join(directory, "old-ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath: oldLedgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseLunar({ ledgerPath: oldLedgerPath }, { now: new Date("2026-08-03T14:24:01.000Z") });
await registerDexPulseLunarCreator({ ledgerPath: oldLedgerPath }, { now: new Date("2026-08-03T14:24:02.000Z") });
await appendLedgerEvent(oldLedgerPath, discovery([winner], "2026-08-03T14:23:59.000Z"));
assert.equal((await enrichDexSurfacePulseWithLunar({ ledgerPath: oldLedgerPath, apiKey: "test" }, {
  now: new Date("2026-08-03T14:24:03.000Z"),
  collector: async () => { throw new Error("must not collect pre-boundary creator evidence"); },
})).status, "source-not-strictly-future");

console.log("token-edge DEX pulse LunarCrush creator monitoring checks passed.");

function discovery(addresses, observedAt) {
  return {
    type: "discovery",
    id: `discovery-creator-${digestValue({ addresses, observedAt }).slice(0, 16)}`,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt,
    availableAt: observedAt,
    candidates: addresses.map((tokenAddress, index) => ({
      chain: "solana",
      tokenAddress,
      symbol: index === 0 ? "WIN" : "LOSE",
      status: "eligible",
      blockers: [],
      sourceTypes: ["profile-latest"],
      sourceBreadth: 1,
      latestSourceTimestamp: observedAt,
      latestBoostAmount: 0,
      totalBoostAmount: 0,
      hasWebsite: true,
      hasTwitter: true,
      pairAddress: index === 0 ? "pair-creator-winner" : "pair-creator-loser",
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
      ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    })),
    researchOnly: true,
    mutationAllowed: false,
  };
}

function collection(addresses) {
  return {
    observedAt: "2026-08-03T14:25:02.000Z",
    availableAt: "2026-08-03T14:25:03.000Z",
    requestBudget: { maximum: 10, attempted: 10, succeeded: 10, failed: 0 },
    universe: { complete: true, rowsFetched: 5_466 },
    events: addresses.map((address, index) => socialEvent(address, index)),
    creatorEvents: [
      creatorEvent(addresses[0], {
        creatorCount: 20,
        interactions24h: 10_000,
        topCreatorInteractionShare: 0.2,
        creatorInteractionHhi: 0.1,
        medianCreatorFollowers: 10_000,
        medianCreatorRank: 200,
        networkCounts: { twitter: 20 },
      }),
      creatorEvent(addresses[1], {
        creatorCount: 3,
        interactions24h: 900,
        topCreatorInteractionShare: 0.8,
        creatorInteractionHhi: 0.7,
        medianCreatorFollowers: 250_000,
        medianCreatorRank: 50,
        networkCounts: { twitter: 3 },
      }),
    ],
  };
}

function socialEvent(address, index) {
  return {
    type: "lunarcrush-social-snapshot",
    id: `lunarcrush-social-creator-${index}`,
    observedAt: "2026-08-03T14:25:02.000Z",
    availableAt: "2026-08-03T14:25:03.000Z",
    provider: "lunarcrush",
    profile: "exact-mint-hourly",
    chain: "solana",
    tokenAddress: address,
    status: "blocked",
    blockers: ["synthetic history omitted"],
    ruleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    rule: LUNARCRUSH_MOVE_ALERT_RULE,
    identity: { matchStatus: "exact-single-contract-match", contractAddress: address },
    historyGeneratedAt: null,
    historyRows: [],
    socialFeatures: null,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function creatorEvent(address, creatorMetrics) {
  return {
    type: "lunarcrush-creator-aggregate",
    id: `lunarcrush-creator-${address}`,
    observedAt: "2026-08-03T14:25:02.000Z",
    availableAt: "2026-08-03T14:25:03.000Z",
    provider: "lunarcrush",
    profile: "social-discovery-creator-aggregate",
    chain: "solana",
    tokenAddress: address,
    status: "ready",
    blockers: [],
    identity: {
      matchStatus: "exact-single-contract-topic-match",
      contractAddress: address,
    },
    topicJoinStatus: "provider-coin-row-exact-contract-unique-topic",
    creatorGeneratedAt: "2026-08-03T14:25:02.000Z",
    providerGenerationReported: true,
    creatorAggregateDigest: digestValue(creatorMetrics),
    creatorMetrics,
    aggregateOnly: true,
    rawCreatorIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
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
