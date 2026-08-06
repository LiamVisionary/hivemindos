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
  DEX_PULSE_GOPLUS_RULE,
  buildDexPulseGoPlusScorecard,
  enrichDexSurfacePulseWithGoPlus,
  registerDexPulseGoPlus,
} from "./token-edge/onchain-dex-pulse-goplus-monitoring.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-goplus-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await assert.rejects(
  registerDexPulseGoPlus({ ledgerPath }, { now: new Date(DEX_PULSE_GOPLUS_RULE.evidenceBoundary) }),
  /strictly after/,
);
const registration = await registerDexPulseGoPlus({ ledgerPath }, {
  now: new Date("2026-08-03T13:40:10.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseGoPlus({ ledgerPath }, {
  now: new Date("2026-08-03T13:40:11.000Z"),
})).status, "existing");

await appendLedgerEvent(ledgerPath, discovery());
const securityByToken = {
  SafePulse111: security({ holderConcentrationPct: 15 }),
  MissingHolders111: security({ holderConcentrationPct: null }),
};
const enrichment = await enrichDexSurfacePulseWithGoPlus({ ledgerPath, maxRequests: 2 }, {
  now: new Date("2026-08-03T13:41:02.000Z"),
  responseNow: () => new Date("2026-08-03T13:41:03.000Z"),
  securityReader: async (_network, tokenAddress) => securityByToken[tokenAddress],
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.tokenCount, 2);
assert.equal(enrichment.requestBudget.attempted, 2);
const enrichedEvents = await readLedger(ledgerPath);
assert.equal(enrichedEvents.filter((event) => (
  event.type === "goplus-token-security-snapshot"
)).every((event) => event.availableAt === "2026-08-03T13:41:03.000Z"), true);
assert.equal((await enrichDexSurfacePulseWithGoPlus({ ledgerPath, maxRequests: 2 }, {
  now: new Date("2026-08-03T13:41:03.000Z"),
  securityReader: async () => { throw new Error("must not recollect"); },
})).status, "skipped-existing-discovery");

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T13:41:04.000Z"),
});
assert.equal(capture.recordedForecasts, 2);
const eventsAfterCapture = await readLedger(ledgerPath);
const forecasts = eventsAfterCapture.filter((event) => event.type === "dex-surface-pulse-forecast");
assert.equal(forecasts.every((forecast) => (
  forecast.goPlusEnrichmentReceiptId === enrichment.receiptId
  && typeof forecast.goPlusEvidenceId === "string"
)), true);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T14:41:05.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [
      pair("SafePulse111", "pair-safe", 1.2, 20_000),
      pair("MissingHolders111", "pair-missing", 0.1, 2_000),
    ],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseGoPlusScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.uniqueTokens, 2);
assert.equal(screen(scorecard, "exact-mint-security-covered").observations, 2);
assert.equal(screen(scorecard, "reported-holder-distribution").observations, 1);
assert.equal(screen(scorecard, "security-holder-consensus").observations, 1);
assert.ok(screen(scorecard, "security-holder-consensus").screenAverageCapacityReturnPct > 0);
assert.ok(screen(scorecard, "security-holder-consensus").pairedCapacityDeltaPct > 0);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === "SafePulse111"
)).goPlusEvidenceId = "forged-evidence";
const forgedScorecard = buildDexPulseGoPlusScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);
assert.equal(forgedScorecard.rejectionCounts["missing-or-mismatched-exact-mint-evidence"], 1);

console.log("token-edge DEX pulse GoPlus monitoring checks passed.");

function screen(scorecard, id) {
  return scorecard.screens.find((candidate) => candidate.id === id);
}

function security(overrides) {
  return {
    provider: "goplus",
    coverage: "complete",
    hardRiskFlags: [],
    cautionFlags: [],
    holderConcentrationPct: null,
    buyTaxPct: null,
    sellTaxPct: null,
    ...overrides,
  };
}

function pair(tokenAddress, pairAddress, priceUsd, liquidityUsd) {
  return {
    baseToken: { address: tokenAddress },
    pairAddress,
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
  };
}

function discovery() {
  return {
    type: "discovery",
    id: "discovery-goplus-pulse",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T13:41:00.000Z",
    availableAt: "2026-08-03T13:41:00.000Z",
    candidates: [
      candidate("SafePulse111", "SAFE", "pair-safe"),
      candidate("MissingHolders111", "MISSING", "pair-missing"),
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
    sourceTypes: ["profile-latest"],
    sourceBreadth: 1,
    latestSourceTimestamp: "2026-08-03T13:40:59.000Z",
    latestBoostAmount: 0,
    totalBoostAmount: 0,
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
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}
