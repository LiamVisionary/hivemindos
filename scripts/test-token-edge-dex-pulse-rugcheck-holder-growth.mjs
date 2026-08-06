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
  enrichDexSurfacePulseWithRugCheck,
  registerDexPulseRugCheck,
} from "./token-edge/onchain-dex-pulse-rugcheck-monitoring.mjs";
import {
  DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE,
  buildDexPulseRugCheckHolderGrowthScorecard,
  registerDexPulseRugCheckHolderGrowth,
} from "./token-edge/onchain-dex-pulse-rugcheck-holder-growth.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-holder-growth-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseRugCheck({ ledgerPath }, { now: new Date("2026-08-03T14:51:31.000Z") });
await assert.rejects(
  registerDexPulseRugCheckHolderGrowth({ ledgerPath }, {
    now: new Date(DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseRugCheckHolderGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T16:45:01.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseRugCheckHolderGrowth({ ledgerPath }, {
  now: new Date("2026-08-03T16:45:02.000Z"),
})).status, "existing");

const growing = "HolderGrowthWinner111";
const declining = "HolderGrowthDecliner222";
await appendLedgerEvent(ledgerPath, discovery(
  "discovery-holder-growth-prior",
  "2026-08-03T16:46:00.000Z",
  growing,
  declining,
));
await enrichDexSurfacePulseWithRugCheck({ ledgerPath, maxRequests: 2 }, {
  now: new Date("2026-08-03T16:46:02.000Z"),
  responseNow: () => new Date("2026-08-03T16:46:03.000Z"),
  reportReader: async (tokenAddress) => report(tokenAddress, 1_000),
});
await captureDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T16:46:04.000Z") });

await appendLedgerEvent(ledgerPath, discovery(
  "discovery-holder-growth-current",
  "2026-08-03T17:01:00.000Z",
  growing,
  declining,
));
await enrichDexSurfacePulseWithRugCheck({ ledgerPath, maxRequests: 2 }, {
  now: new Date("2026-08-03T17:01:02.000Z"),
  responseNow: () => new Date("2026-08-03T17:01:03.000Z"),
  reportReader: async (tokenAddress) => report(
    tokenAddress,
    tokenAddress === growing ? 1_010 : 990,
  ),
});
await captureDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T17:01:04.000Z") });

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T17:46:05.000Z"),
  fetcher: pairFetcher(growing, declining, 1, 1),
});
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T18:01:05.000Z"),
  fetcher: pairFetcher(growing, declining, 1.25, 0.75),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseRugCheckHolderGrowthScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 4);
assert.equal(scorecard.eligibleHolderComparisons, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.screen.observations, 1);
assert.equal(scorecard.screen.uniqueTokens, 1);
assert.ok(scorecard.screen.screenAverageCapacityReturnPct > 0);
assert.ok(scorecard.screen.pairedCapacityDeltaPct > 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
const prior = forged.find((event) => event.type === "rugcheck-token-risk-snapshot"
  && event.discoveryEventId === "discovery-holder-growth-prior"
  && event.tokenAddress === growing);
prior.aggregate.totalHolders = 9_999;
const forgedScorecard = buildDexPulseRugCheckHolderGrowthScorecard(forged);
assert.equal(forgedScorecard.eligibleHolderComparisons, 1);
assert.equal(forgedScorecard.evidenceRejectionCounts["invalid-rugcheck-aggregate"], 1);

console.log("token-edge DEX pulse RugCheck holder-growth checks passed.");

function discovery(id, observedAt, winnerAddress, loserAddress) {
  return {
    type: "discovery",
    id,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt,
    availableAt: observedAt,
    candidates: [
      candidate(winnerAddress, "GROW", "pair-holder-growth"),
      candidate(loserAddress, "FALL", "pair-holder-decline"),
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
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function report(mint, totalHolders) {
  return {
    mint,
    score_normalised: 1,
    rugged: false,
    detectedAt: "2026-08-03T16:45:00.000Z",
    graphInsidersDetected: 0,
    totalHolders,
    creatorBalance: 0,
    risks: [],
    markets: [{
      pubkey: mint.includes("Winner") ? "pair-holder-growth" : "pair-holder-decline",
      lp: { lpLockedPct: 100, lpLockedUSD: 20_000 },
    }],
  };
}

function pairFetcher(winnerAddress, loserAddress, winnerPrice, loserPrice) {
  return async () => ({
    ok: true,
    json: async () => [
      pair(winnerAddress, "pair-holder-growth", winnerPrice),
      pair(loserAddress, "pair-holder-decline", loserPrice),
    ],
  });
}

function pair(address, pairAddress, priceUsd) {
  return {
    baseToken: { address }, pairAddress, priceUsd: String(priceUsd), liquidity: { usd: 20_000 },
  };
}
