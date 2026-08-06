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
  DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE,
  buildDexPulseCrossWindowReversalScorecard,
  registerDexPulseCrossWindowReversal,
} from "./token-edge/onchain-dex-pulse-cross-window-reversal.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-cross-window-reversal-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-04T00:59:20.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-04T00:59:25.000Z"),
});

const derivationOnly = "ReversalDerivationOnly000";
await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-cross-window-derivation-only",
  observedAt: "2026-08-04T01:00:40.000Z",
  candidates: [candidate(derivationOnly, "OLD", "pair-reversal-old", -5, 5)],
}));
assert.equal((await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T01:00:41.000Z"),
  fetcher: marketFetcher({
    [derivationOnly]: ["pair-reversal-old", 1, 22_000],
  }),
})).recordedForecasts, 1);

await assert.rejects(
  registerDexPulseCrossWindowReversal({ ledgerPath }, {
    now: new Date(DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseCrossWindowReversal({ ledgerPath }, {
  now: new Date("2026-08-04T01:10:10.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseCrossWindowReversal({ ledgerPath }, {
  now: new Date("2026-08-04T01:10:11.000Z"),
})).status, "existing");

const reversalWinner = "ReversalFutureWinner111";
const downtrendLoser = "ReversalDowntrendLoser222";
const chaseLoser = "ReversalChaseLoser333";
await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-cross-window-future",
  observedAt: "2026-08-04T01:15:20.000Z",
  candidates: [
    candidate(reversalWinner, "WIN", "pair-reversal-winner", -5, 5),
    candidate(downtrendLoser, "DOWN", "pair-reversal-downtrend", -5, -5),
    candidate(chaseLoser, "CHASE", "pair-reversal-chase", 5, 5),
  ],
}));
const entryMarkets = {
  [derivationOnly]: ["pair-reversal-old", 1, 22_000],
  [reversalWinner]: ["pair-reversal-winner", 1, 22_000],
  [downtrendLoser]: ["pair-reversal-downtrend", 1, 22_000],
  [chaseLoser]: ["pair-reversal-chase", 1, 22_000],
};
assert.equal((await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T01:15:21.000Z"),
  fetcher: marketFetcher(entryMarkets),
})).recordedForecasts, 3);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T02:00:42.000Z"),
  fetcher: marketFetcher({
    ...entryMarkets,
    [derivationOnly]: ["pair-reversal-old", 2, 20_000],
  }),
});
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T02:15:22.000Z"),
  fetcher: marketFetcher({
    ...entryMarkets,
    [derivationOnly]: ["pair-reversal-old", 2, 20_000],
    [reversalWinner]: ["pair-reversal-winner", 1.6, 20_000],
    [downtrendLoser]: ["pair-reversal-downtrend", 0.5, 20_000],
    [chaseLoser]: ["pair-reversal-chase", 0.8, 20_000],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseCrossWindowReversalScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.parentRegistrationId, registration.parentRegistrationId);
assert.equal(scorecard.candidateForecasts, 3);
assert.equal(scorecard.openForecasts, 0);
assert.equal(scorecard.eligibleLiveObservations, 3);
assert.equal(scorecard.portfolioWeightedObservations, 3);
assert.equal(scorecard.allPulseParentPolicy.observations, 3);
assert.equal(scorecard.crossWindowReversalPolicy.observations, 1);
assert.equal(scorecard.crossWindowReversalPolicy.uniqueTokens, 1);
assert.ok(scorecard.crossWindowReversalPolicy.averageCapacityReturnPct > 0);
assert.ok(scorecard.crossWindowReversalPolicy.stressAverageCapacityReturnPct > 0);
assert.ok(scorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
forged.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === reversalWinner
)).metrics.priceChangeH1Pct = -99;
const forgedScorecard = buildDexPulseCrossWindowReversalScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 2);
assert.equal(Object.values(forgedScorecard.sourcePulseRejectionCounts).reduce((sum, value) => (
  sum + value
), 0), 1);

console.log("token-edge DEX pulse cross-window reversal checks passed.");

function discovery({ id, observedAt, candidates }) {
  return {
    type: "discovery",
    id,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt,
    availableAt: observedAt,
    candidates,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress, priceChangeM5Pct, priceChangeH1Pct) {
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
    volumeM5Usd: 1_000,
    fiveMinuteTurnover: 0.05,
    buysH1: 200,
    sellsH1: 100,
    buySellTxnRatio: 2,
    buysM5: 10,
    sellsM5: 5,
    fiveMinuteBuySellTxnRatio: 2,
    priceChangeM5Pct,
    priceChangeH1Pct,
    priceChangeH24Pct: 10,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function marketFetcher(markets) {
  return async (url) => ({
    ok: true,
    json: async () => Object.entries(markets).map(([tokenAddress, market]) => ({
      baseToken: { address: tokenAddress },
      pairAddress: market[0],
      priceUsd: String(market[1]),
      liquidity: { usd: market[2] },
      endpointKind: String(url).includes("/token-pairs/") ? "direct" : "batch",
    })),
  });
}
