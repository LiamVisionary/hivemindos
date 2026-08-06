#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerEvent,
  readLedger,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE,
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE,
  DEX_SURFACE_PULSE_RULE,
  buildDexSurfacePulseScorecard,
  captureDexSurfacePulse,
  createDexPulseEntryProviderPriceIntegrityRegistrationEvent,
  createDexSurfacePulseRegistrationEvent,
  dexPulseProviderPriceIntegrityReason,
  markOpenDexSurfacePulse,
  registerDexPulseEntryProviderPriceIntegrity,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-monitor-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await assert.rejects(
  registerDexSurfacePulse({ ledgerPath }, { now: new Date(DEX_SURFACE_PULSE_RULE.evidenceBoundary) }),
  /strictly after/,
);
const registration = await registerDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:30:10.000Z"),
});
const repeatedRegistration = await registerDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:30:11.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal(repeatedRegistration.status, "existing");
assert.equal(registration.registrationId, repeatedRegistration.registrationId);
await assert.rejects(
  registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
    now: new Date(DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const entryRegistration = await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:30:16.000Z"),
});
const repeatedEntryRegistration = await registerDexPulseEntryProviderPriceIntegrity(
  { ledgerPath },
  { now: new Date("2026-08-03T19:30:17.000Z") },
);
assert.equal(entryRegistration.status, "registered");
assert.equal(repeatedEntryRegistration.status, "existing");
assert.equal(entryRegistration.registrationId, repeatedEntryRegistration.registrationId);

await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-alpha-1",
  observedAt: "2026-08-03T12:30:20.000Z",
  tokenAddress: "PulseAlpha111",
  pairAddress: "pair-alpha",
  buySellTxnRatio: 2,
  hourlyTurnover: 0.7,
  priceChangeH1Pct: 5,
}));
const alpha1 = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:30:21.000Z"),
});
assert.equal(alpha1.status, "recorded");
assert.equal(alpha1.recordedForecasts, 1);
const duplicateCapture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:30:22.000Z"),
});
assert.equal(duplicateCapture.status, "skipped-existing-cadence");
assert.equal(duplicateCapture.recordedForecasts, 0);
assert.equal(duplicateCapture.existingForecasts, 1);
const pathMark = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:45:01.000Z"),
  fetcher: marketFetcher({ PulseAlpha111: ["pair-alpha", 1.1, 20_000] }),
});
assert.equal(pathMark.recordedObservations, 1);
assert.equal(pathMark.observations[0].grossReturnFromEntryPct, 10);
const repeatedPathMark = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:45:02.000Z"),
  fetcher: async () => { throw new Error("must spend zero requests"); },
});
assert.equal(repeatedPathMark.recordedObservations, 0);
assert.equal(repeatedPathMark.requestsAttempted, 0);
assert.equal(
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.selectedQuotePolicy,
  "lower-price-and-lower-liquidity",
);
const inconsistentPathMark = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:50:01.000Z"),
  fetcher: marketFetcher({
    PulseAlpha111: ["pair-alpha", 1.2, 20_000, 0.05, 20_000],
  }),
});
assert.equal(inconsistentPathMark.recordedObservations, 0);
assert.equal(inconsistentPathMark.requestsAttempted, 2);
assert.ok(inconsistentPathMark.failures.some((failure) => (
  failure.includes("cross-endpoint-price-disagreement")
)));
const retriedConsistentPathMark = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:50:02.000Z"),
  fetcher: marketFetcher({ PulseAlpha111: ["pair-alpha", 1.2, 20_000] }),
});
assert.equal(retriedConsistentPathMark.recordedObservations, 1);
assert.equal(retriedConsistentPathMark.observations[0].grossReturnFromEntryPct, 20);
let releaseConcurrentFetch;
let reportConcurrentFetchStarted;
const concurrentFetchStarted = new Promise((resolve) => {
  reportConcurrentFetchStarted = resolve;
});
const concurrentFetchRelease = new Promise((resolve) => {
  releaseConcurrentFetch = resolve;
});
const concurrentMarketFetcher = marketFetcher({ PulseAlpha111: ["pair-alpha", 1.25, 20_000] });
const firstConcurrentPathMark = markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:55:01.000Z"),
  fetcher: async (url) => {
    reportConcurrentFetchStarted();
    await concurrentFetchRelease;
    return concurrentMarketFetcher(url);
  },
});
await concurrentFetchStarted;
const secondConcurrentPathMark = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:55:02.000Z"),
  fetcher: async () => { throw new Error("concurrent bucket must spend zero requests"); },
});
assert.equal(secondConcurrentPathMark.recordedObservations, 0);
assert.equal(secondConcurrentPathMark.requestsAttempted, 0);
releaseConcurrentFetch();
const completedConcurrentPathMark = await firstConcurrentPathMark;
assert.equal(completedConcurrentPathMark.recordedObservations, 1);
const postConcurrentReplay = await markOpenDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T12:55:03.000Z"),
  fetcher: async () => { throw new Error("completed bucket must spend zero requests"); },
});
assert.equal(postConcurrentReplay.recordedObservations, 0);
assert.equal(postConcurrentReplay.requestsAttempted, 0);
assert.equal(verifyLedger(await readLedger(ledgerPath)).ok, true);
assert.equal(dexPulseProviderPriceIntegrityReason(
  dexPair("PulseAlpha111", "pair-alpha", 1, 20_000),
  dexPair("PulseAlpha111", "pair-alpha", 1.05, 21_000),
), null);
assert.equal(dexPulseProviderPriceIntegrityReason(
  dexPair("PulseAlpha111", "pair-alpha", 1, 20_000),
  dexPair("PulseAlpha111", "pair-alpha", 20, 20_000),
), "cross-endpoint-price-disagreement");
const transient = await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T13:30:21.000Z"),
  fetcher: async () => { throw new Error("temporary provider failure"); },
});
assert.equal(transient.recordedResolutions, 0);
assert.equal(transient.failures.length, 1);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T13:30:22.000Z"),
  fetcher: marketFetcher({ PulseAlpha111: ["pair-alpha", 1.2, 20_000] }),
});

await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-alpha-2",
  observedAt: "2026-08-03T12:45:20.000Z",
  tokenAddress: "PulseAlpha111",
  pairAddress: "pair-alpha",
  buySellTxnRatio: 2,
  hourlyTurnover: 0.7,
  priceChangeH1Pct: 5,
}));
await captureDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:45:21.000Z") });
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T13:45:22.000Z"),
  fetcher: marketFetcher({ PulseAlpha111: ["pair-alpha", 1.2, 20_000] }),
});

await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-beta",
  observedAt: "2026-08-03T18:31:20.000Z",
  tokenAddress: "PulseBeta111",
  pairAddress: "pair-beta",
  buySellTxnRatio: 0.5,
  hourlyTurnover: 0.1,
  priceChangeH1Pct: -5,
}));
await captureDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T18:31:21.000Z") });
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T19:31:22.000Z"),
  fetcher: marketFetcher({ PulseBeta111: ["pair-beta", 0.9, 20_000] }),
});

await appendLedgerEvent(ledgerPath, discovery({
  id: "discovery-gamma",
  observedAt: "2026-08-03T19:31:20.000Z",
  tokenAddress: "PulseGamma111",
  pairAddress: "pair-gamma",
  buySellTxnRatio: 2,
  hourlyTurnover: 0.7,
  priceChangeH1Pct: 5,
}));
const rejectedStaleEntry = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T19:31:21.000Z"),
  fetcher: marketFetcher({
    PulseGamma111: ["pair-gamma", 1, 20_000, 20, 20_000],
  }),
});
assert.equal(rejectedStaleEntry.status, "entry-integrity-rejected");
assert.equal(rejectedStaleEntry.recordedForecasts, 0);
assert.equal(rejectedStaleEntry.requestsAttempted, 2);
assert.ok(rejectedStaleEntry.failures.some((failure) => (
  failure.includes("cross-endpoint-price-disagreement")
)));
const freshEntry = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T19:31:22.000Z"),
  fetcher: marketFetcher({
    PulseGamma111: ["pair-gamma", 0.82, 20_000, 0.8, 19_000],
  }),
});
assert.equal(freshEntry.status, "recorded");
assert.equal(freshEntry.recordedForecasts, 1);
assert.equal(freshEntry.requestsAttempted, 2);
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T20:31:23.000Z"),
  fetcher: marketFetcher({
    PulseGamma111: ["pair-gamma", 0.9, 20_000, 0.88, 19_500],
  }),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexSurfacePulseScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 4);
assert.equal(scorecard.eligibleLiveObservations, 4);
assert.equal(scorecard.portfolioWeightedObservations, 3);
assert.equal(scorecard.sameAssetOverlappingObservations, 1);
assert.equal(scorecard.independentHourlyFrames, 3);
assert.equal(scorecard.uniqueTokens, 3);
assert.equal(scorecard.parent.observations, 3);
const pressure = scorecard.screens.find((screen) => screen.id === "transaction-buy-pressure");
assert.equal(pressure.observations, 2);
assert.equal(pressure.independentTradedFrames, 2);
assert.equal(pressure.riseRate, 1);
assert.equal(pressure.netWinRate, 1);
assert.ok(pressure.pairedCapacityDeltaPct > 0);
assert.ok(pressure.pairedStressCapacityDeltaPct > 0);
const betaResolution = events.find((event) => (
  event.type === "dex-surface-pulse-resolution" && event.tokenAddress === "PulseBeta111"
));
assert.equal(
  betaResolution.providerPriceIntegrity.ruleVersion,
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.version,
);
assert.equal(betaResolution.providerPriceIntegrity.priceRatio, 1);
const forgedIntegrity = structuredClone(events);
const forgedBetaResolution = forgedIntegrity.find((event) => event.id === betaResolution.id);
forgedBetaResolution.providerPriceIntegrity.directPriceUsd = 20;
const forgedIntegrityScorecard = buildDexSurfacePulseScorecard(forgedIntegrity);
assert.equal(forgedIntegrityScorecard.eligibleLiveObservations, 3);
assert.equal(forgedIntegrityScorecard.rejectionCounts["provider-price-integrity-mismatch"], 1);

const futureEntryForecast = events.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === "PulseGamma111"
));
assert.equal(futureEntryForecast.sourceDiscoveryObservedAt, "2026-08-03T19:31:20.000Z");
assert.equal(futureEntryForecast.entryObservedAt, futureEntryForecast.createdAt);
assert.equal(futureEntryForecast.entryPriceUsd, 0.8);
assert.equal(futureEntryForecast.entryLiquidityUsd, 19_000);
assert.equal(futureEntryForecast.entryIntegrityRegistrationId, entryRegistration.registrationId);
assert.equal(
  futureEntryForecast.entryProviderPriceIntegrity.ruleVersion,
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.version,
);
const forgedEntryIntegrity = structuredClone(events);
const forgedFutureEntry = forgedEntryIntegrity.find((event) => event.id === futureEntryForecast.id);
forgedFutureEntry.entryProviderPriceIntegrity.batchPriceUsd = 50;
const forgedEntryIntegrityScorecard = buildDexSurfacePulseScorecard(forgedEntryIntegrity);
assert.equal(forgedEntryIntegrityScorecard.eligibleLiveObservations, 3);
assert.equal(
  forgedEntryIntegrityScorecard.rejectionCounts["entry-provider-price-integrity-mismatch"],
  1,
);

const forged = structuredClone(events);
const forgedForecast = forged.find((event) => event.type === "dex-surface-pulse-forecast");
forgedForecast.metrics.totalBoostAmount = 999;
const forgedScorecard = buildDexSurfacePulseScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 3);
assert.equal(forgedScorecard.rejectionCounts["source-candidate-mismatch"], 1);

const expectedRegistration = createDexSurfacePulseRegistrationEvent(
  new Date("2026-08-03T12:30:10.000Z"),
);
assert.equal(expectedRegistration.id, registration.registrationId);
assert.equal(expectedRegistration.rule.parentDecision, "paper-long-every-eligible-surface-candidate");
const expectedEntryRegistration = createDexPulseEntryProviderPriceIntegrityRegistrationEvent(
  new Date("2026-08-03T19:30:16.000Z"),
);
assert.equal(expectedEntryRegistration.id, entryRegistration.registrationId);

console.log("token-edge fixed-cadence DEX surface pulse monitoring checks passed.");

function discovery(input) {
  const candidate = {
    chain: "solana",
    tokenAddress: input.tokenAddress,
    symbol: input.tokenAddress.includes("Alpha") ? "ALPHA" : "BETA",
    status: "eligible",
    blockers: [],
    sourceTypes: ["boost-latest"],
    sourceBreadth: 1,
    latestSourceTimestamp: input.observedAt,
    latestBoostAmount: 10,
    totalBoostAmount: 10,
    hasWebsite: true,
    hasTwitter: true,
    pairAddress: input.pairAddress,
    pairAgeMinutes: 120,
    priceUsd: 1,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
    volumeH1Usd: 14_000,
    hourlyTurnover: input.hourlyTurnover,
    buysH1: Math.round(input.buySellTxnRatio * 100),
    sellsH1: 100,
    buySellTxnRatio: input.buySellTxnRatio,
    priceChangeH1Pct: input.priceChangeH1Pct,
    priceChangeH24Pct: 10,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
  return {
    type: "discovery",
    id: input.id,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: input.observedAt,
    availableAt: input.observedAt,
    candidates: [candidate],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function marketFetcher(markets) {
  return async (url) => ({
    ok: true,
    json: async () => Object.entries(markets).map(([tokenAddress, market]) => dexPair(
      tokenAddress,
      market[0],
      String(url).includes("/token-pairs/") ? (market[3] ?? market[1]) : market[1],
      String(url).includes("/token-pairs/") ? (market[4] ?? market[2]) : market[2],
    )),
  });
}

function dexPair(tokenAddress, pairAddress, priceUsd, liquidityUsd) {
  return {
    baseToken: { address: tokenAddress },
    pairAddress,
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
  };
}
