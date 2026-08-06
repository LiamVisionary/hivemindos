#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLedgerEvent, readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_RULE,
  buildDexPulseLunarScorecard,
  enrichDexSurfacePulseWithLunar,
  registerDexPulseLunar,
} from "./token-edge/onchain-dex-pulse-lunar-monitoring.mjs";
import {
  LUNARCRUSH_MOVE_ALERT_RULE,
  deriveLunarCrushMoveAlertFeatures,
} from "./token-edge/onchain-lunarcrush-provider.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-lunar-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await assert.rejects(
  registerDexPulseLunar({ ledgerPath }, { now: new Date(DEX_PULSE_LUNAR_RULE.evidenceBoundary) }),
  /strictly after/,
);
const registration = await registerDexPulseLunar({ ledgerPath }, {
  now: new Date("2026-08-03T12:40:10.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseLunar({ ledgerPath }, {
  now: new Date("2026-08-03T12:40:11.000Z"),
})).status, "existing");

const tokenAddress = "LunarPulseAlpha111";
const discoveryEvent = discovery(tokenAddress);
await appendLedgerEvent(ledgerPath, discoveryEvent);
const enrichment = await enrichDexSurfacePulseWithLunar({ ledgerPath, apiKey: "test" }, {
  now: new Date("2026-08-03T12:41:02.000Z"),
  collector: async () => collection(tokenAddress),
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.tokenCount, 1);
assert.equal(enrichment.evidence.length, 1);
assert.equal((await enrichDexSurfacePulseWithLunar({ ledgerPath, apiKey: "test" }, {
  now: new Date("2026-08-03T12:41:03.000Z"),
  collector: async () => { throw new Error("must not recollect"); },
})).status, "skipped-existing-cadence");

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:41:04.000Z"),
});
assert.equal(capture.recordedForecasts, 1);
const eventsAfterCapture = await readLedger(ledgerPath);
const forecast = eventsAfterCapture.find((event) => event.type === "dex-surface-pulse-forecast");
assert.equal(forecast.lunarcrushEnrichmentReceiptId, enrichment.receiptId);
assert.equal(forecast.lunarcrushEvidenceId, enrichment.evidence[0].evidenceEventId);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T13:41:05.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [{
      baseToken: { address: tokenAddress },
      pairAddress: "pair-lunar-alpha",
      priceUsd: "1.2",
      liquidity: { usd: 20_000 },
    }],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseLunarScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 1);
assert.equal(scorecard.eligibleLiveObservations, 1);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.uniqueTokens, 1);
assert.equal(scorecard.screens.find((screen) => screen.id === "large-move-alert").observations, 1);
assert.equal(scorecard.screens.find((screen) => screen.id === "interactions-accelerating").observations, 1);
assert.equal(scorecard.screens.find((screen) => screen.id === "flow-social-consensus").observations, 1);

const forged = structuredClone(events);
forged.find((event) => event.id === forecast.lunarcrushEvidenceId).socialFeatures.interactionsZ = -999;
const forgedScorecard = buildDexPulseLunarScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 0);
assert.equal(forgedScorecard.rejectionCounts["invalid-ready-evidence"], 1);

console.log("token-edge DEX pulse LunarCrush monitoring checks passed.");

function discovery(address) {
  return {
    type: "discovery",
    id: "discovery-lunar-pulse-alpha",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T12:41:00.000Z",
    availableAt: "2026-08-03T12:41:00.000Z",
    candidates: [{
      chain: "solana",
      tokenAddress: address,
      symbol: "LPA",
      status: "eligible",
      blockers: [],
      sourceTypes: ["profile-latest"],
      sourceBreadth: 1,
      latestSourceTimestamp: "2026-08-03T12:40:59.000Z",
      latestBoostAmount: 0,
      totalBoostAmount: 0,
      hasWebsite: true,
      hasTwitter: true,
      pairAddress: "pair-lunar-alpha",
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
    }],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function collection(address) {
  const historyRows = Array.from({ length: 25 }, (_, index) => ({
    time: 1_785_700_000 + (index * 3_600),
    interactions: index === 24 ? 1_000 : 100 + (index % 3),
    postsActive: index === 24 ? 200 : 20 + (index % 3),
    contributorsActive: index === 24 ? 100 : 10 + (index % 2),
    altRank: index === 24 ? 50 : 500,
    galaxyScore: index === 24 ? 80 : 40,
    sentiment: 90,
    spam: 10,
    socialDominance: 0.1,
    close: 1,
  }));
  const socialFeatures = deriveLunarCrushMoveAlertFeatures(historyRows);
  assert.equal(socialFeatures.largeMoveAlert, true);
  return {
    observedAt: "2026-08-03T12:41:02.000Z",
    availableAt: "2026-08-03T12:41:03.000Z",
    requestBudget: { maximum: 10, attempted: 7, succeeded: 7, failed: 0 },
    universe: { complete: true, rowsFetched: 5_466 },
    events: [{
      type: "lunarcrush-social-snapshot",
      id: "lunarcrush-social-lunar-pulse-alpha",
      observedAt: "2026-08-03T12:41:02.000Z",
      availableAt: "2026-08-03T12:41:03.000Z",
      provider: "lunarcrush",
      profile: "exact-mint-hourly",
      chain: "solana",
      tokenAddress: address,
      status: "ready",
      blockers: [],
      ruleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
      rule: LUNARCRUSH_MOVE_ALERT_RULE,
      identity: {
        matchStatus: "exact-single-contract-match",
        contractAddress: address,
      },
      historyGeneratedAt: "2026-08-03T12:41:02.000Z",
      historyRows,
      socialFeatures,
      researchOnly: true,
      mutationAllowed: false,
    }],
  };
}
