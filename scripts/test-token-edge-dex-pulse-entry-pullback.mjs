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
  DEX_PULSE_ENTRY_PULLBACK_RULE,
  DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE,
  buildDexPulseEntryPullbackScorecard,
  buildDexPulsePullbackPositiveMomentumScorecard,
  registerDexPulseEntryPullback,
  registerDexPulsePullbackPositiveMomentum,
} from "./token-edge/onchain-dex-pulse-entry-pullback.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-entry-pullback-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:30:16.000Z"),
});
await assert.rejects(
  registerDexPulseEntryPullback({ ledgerPath }, {
    now: new Date(DEX_PULSE_ENTRY_PULLBACK_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseEntryPullback({ ledgerPath }, {
  now: new Date("2026-08-03T20:00:21.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseEntryPullback({ ledgerPath }, {
  now: new Date("2026-08-03T20:00:22.000Z"),
})).status, "existing");

const pullback = "PullbackWinner111";
const chased = "NoPullbackLoser222";
await appendLedgerEvent(ledgerPath, discovery(pullback, chased));
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T20:00:31.000Z"),
  fetcher: marketFetcher({
    [pullback]: ["pair-pullback", 0.8, 20_000],
    [chased]: ["pair-chased", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
assert.equal(capture.requestsAttempted, 3);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:00:32.000Z"),
  fetcher: marketFetcher({
    [pullback]: ["pair-pullback", 1.2, 20_000],
    [chased]: ["pair-chased", 0.5, 20_000],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseEntryPullbackScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.entryPullbackPolicy.observations, 1);
assert.equal(scorecard.entryPullbackPolicy.uniqueTokens, 1);
assert.ok(scorecard.entryPullbackPolicy.averageCapacityReturnPct > 0);
assert.ok(scorecard.entryPullbackPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(scorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
const pullbackForecast = forged.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === pullback
));
pullbackForecast.discoveryEventId = "forged-discovery";
const forgedScorecard = buildDexPulseEntryPullbackScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);
assert.equal(forgedScorecard.sourcePulseRejectionCounts["source-discovery-mismatch"], 1);

await assert.rejects(
  registerDexPulsePullbackPositiveMomentum({ ledgerPath }, {
    now: new Date(DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const momentumRegistration = await registerDexPulsePullbackPositiveMomentum({ ledgerPath }, {
  now: new Date("2026-08-03T21:15:24.000Z"),
});
assert.equal(momentumRegistration.status, "registered");
assert.equal((await registerDexPulsePullbackPositiveMomentum({ ledgerPath }, {
  now: new Date("2026-08-03T21:15:25.000Z"),
})).status, "existing");

const positiveMomentum = "PullbackPositiveMomentum333";
const negativeMomentum = "PullbackNegativeMomentum444";
await appendLedgerEvent(ledgerPath, discovery(positiveMomentum, negativeMomentum, {
  id: "discovery-pullback-momentum-fixture",
  observedAt: "2026-08-03T21:15:30.000Z",
  firstPairAddress: "pair-pullback-positive",
  secondPairAddress: "pair-pullback-negative",
  firstPriceChangeM5Pct: 2,
  secondPriceChangeM5Pct: -2,
}));
const momentumCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:15:31.000Z"),
  fetcher: marketFetcher({
    [positiveMomentum]: ["pair-pullback-positive", 0.8, 20_000],
    [negativeMomentum]: ["pair-pullback-negative", 0.8, 20_000],
  }),
});
assert.equal(momentumCapture.recordedForecasts, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T22:15:32.000Z"),
  fetcher: marketFetcher({
    [positiveMomentum]: ["pair-pullback-positive", 1.2, 20_000],
    [negativeMomentum]: ["pair-pullback-negative", 0.6, 20_000],
  }),
});
const momentumEvents = await readLedger(ledgerPath);
assert.equal(verifyLedger(momentumEvents).ok, true);
const momentumScorecard = buildDexPulsePullbackPositiveMomentumScorecard(momentumEvents);
assert.equal(momentumScorecard.registrationId, momentumRegistration.registrationId);
assert.equal(momentumScorecard.eligibleLiveObservations, 2);
assert.equal(momentumScorecard.pullbackParentPolicy.observations, 2);
assert.equal(momentumScorecard.pullbackPositiveMomentumPolicy.observations, 1);
assert.ok(momentumScorecard.pullbackPositiveMomentumPolicy.averageCapacityReturnPct > 0);
assert.ok(momentumScorecard.pullbackPositiveMomentumPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(momentumScorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(momentumScorecard.provisionalGate, false);

console.log("token-edge DEX pulse entry-pullback checks passed.");

function discovery(pullbackAddress, chasedAddress, options = {}) {
  return {
    type: "discovery",
    id: options.id ?? "discovery-entry-pullback-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: options.observedAt ?? "2026-08-03T20:00:30.000Z",
    availableAt: options.observedAt ?? "2026-08-03T20:00:30.000Z",
    candidates: [
      candidate(
        pullbackAddress,
        "PULL",
        options.firstPairAddress ?? "pair-pullback",
        options.firstPriceChangeM5Pct ?? 2,
      ),
      candidate(
        chasedAddress,
        "CHASE",
        options.secondPairAddress ?? "pair-chased",
        options.secondPriceChangeM5Pct ?? 2,
      ),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress, priceChangeM5Pct) {
  return {
    chain: "solana", tokenAddress, symbol, status: "eligible", blockers: [],
    sourceTypes: ["boost-latest"], sourceBreadth: 1, latestSourceTimestamp: null,
    latestBoostAmount: 10, totalBoostAmount: 10, hasWebsite: true, hasTwitter: true,
    pairAddress, pairAgeMinutes: 120, priceUsd: 1, liquidityUsd: 20_000,
    marketCapUsd: 100_000, volumeH1Usd: 14_000, hourlyTurnover: 0.7,
    volumeM5Usd: 2_000, fiveMinuteTurnover: 0.1,
    buysH1: 200, sellsH1: 100, buySellTxnRatio: 2,
    buysM5: 20, sellsM5: 10, fiveMinuteBuySellTxnRatio: 2,
    priceChangeM5Pct, priceChangeH1Pct: 5, priceChangeH24Pct: 10,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function marketFetcher(markets) {
  return async (url) => ({
    ok: true,
    json: async () => Object.entries(markets).map(([tokenAddress, market]) => ({
      baseToken: { address: tokenAddress },
      pairAddress: market[0],
      priceUsd: String(String(url).includes("/token-pairs/") ? (market[3] ?? market[1]) : market[1]),
      liquidity: {
        usd: String(url).includes("/token-pairs/") ? (market[4] ?? market[2]) : market[2],
      },
    })),
  });
}
