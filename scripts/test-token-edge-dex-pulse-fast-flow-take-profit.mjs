#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLedgerEvent, readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  captureDexSurfacePulse,
  markOpenDexSurfacePulse,
  registerDexPulseEntryProviderPriceIntegrity,
  registerDexSurfacePulse,
  resolveDexSurfacePulse,
} from "./token-edge/onchain-dex-pulse-monitoring.mjs";
import { registerDexPulseFastFlow } from "./token-edge/onchain-dex-pulse-fast-flow-monitoring.mjs";
import { registerDexPulseCrossWindowReversal } from "./token-edge/onchain-dex-pulse-cross-window-reversal.mjs";
import {
  DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE,
  DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE,
  DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE,
  buildDexPulseBuyPressureTakeProfitScorecard,
  buildDexPulseCadenceTolerantTakeProfitScorecard,
  buildDexPulseCrossWindowReversalTakeProfitScorecard,
  buildDexPulseScreenExitHypothesisAudit,
  registerDexPulseBuyPressureTakeProfit,
  registerDexPulseCadenceTolerantTakeProfit,
  registerDexPulseCrossWindowReversalTakeProfit,
} from "./token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-flow-tp-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseFastFlow({ ledgerPath }, { now: new Date("2026-08-03T14:40:20.000Z") });
await assert.rejects(
  registerDexPulseBuyPressureTakeProfit({ ledgerPath }, {
    now: new Date(DEX_PULSE_BUY_PRESSURE_TAKE_PROFIT_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseBuyPressureTakeProfit({ ledgerPath }, {
  now: new Date("2026-08-03T16:34:01.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseBuyPressureTakeProfit({ ledgerPath }, {
  now: new Date("2026-08-03T16:34:02.000Z"),
})).status, "existing");

const winner = "FlowTakeProfitWinner111";
const filteredWinner = "FlowTakeProfitFiltered222";
await appendLedgerEvent(ledgerPath, discovery(winner, filteredWinner));
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T18:35:01.000Z"),
});
assert.equal(capture.recordedForecasts, 2);

for (const mark of [
  ["2026-08-03T18:40:01.000Z", 1.05, 1.01],
  ["2026-08-03T18:45:01.000Z", 1.08, 1.015],
  ["2026-08-03T18:50:01.000Z", 1.12, 1.02],
  ["2026-08-03T19:00:01.000Z", 1.04, 1.03],
  ["2026-08-03T19:10:01.000Z", 0.95, 1.04],
  ["2026-08-03T19:20:01.000Z", 0.85, 1.1],
  ["2026-08-03T19:30:01.000Z", 0.82, 1.15],
]) {
  await markOpenDexSurfacePulse({ ledgerPath }, {
    now: new Date(mark[0]),
    fetcher: pairFetcher(winner, filteredWinner, mark[1], mark[2]),
  });
}
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T19:35:02.000Z"),
  fetcher: pairFetcher(winner, filteredWinner, 0.8, 1.2),
});

const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseBuyPressureTakeProfitScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleCompletePathObservations, 2);
assert.equal(scorecard.portfolioWeightedObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
assert.equal(scorecard.entryScreenTradedObservations, 1);
assert.equal(scorecard.takeProfitExits, 1);
assert.ok(scorecard.parentFrameMeanNetReturnPct < 0);
assert.ok(scorecard.policyFrameMeanNetReturnPct > 0);
assert.ok(scorecard.pairedFrameMeanDeltaPct > 0);
assert.ok(scorecard.stressedPolicyFrameMeanNetReturnPct < 0);
assert.equal(scorecard.provisionalGate, false);

const forged = structuredClone(events);
forged.find((event) => event.type === "dex-surface-pulse-path"
  && event.tokenAddress === winner
  && event.bucketStartedAt === "2026-08-03T19:00:00.000Z").grossReturnFromEntryPct = 999;
const forgedScorecard = buildDexPulseBuyPressureTakeProfitScorecard(forged);
assert.equal(forgedScorecard.eligibleCompletePathObservations, 1);
assert.equal(forgedScorecard.pathExclusionCounts["path-return-mismatch"], 1);

const incomplete = events.filter((event) => !(event.type === "dex-surface-pulse-path"
  && event.tokenAddress === winner
  && event.bucketStartedAt === "2026-08-03T19:00:00.000Z"));
const incompleteScorecard = buildDexPulseBuyPressureTakeProfitScorecard(incomplete);
assert.equal(incompleteScorecard.eligibleCompletePathObservations, 1);
assert.equal(incompleteScorecard.pathExclusionCounts["path-cadence-gap"], 1);

const conflictingCollector = structuredClone(events);
conflictingCollector.push({
  type: "forecast-path-observation",
  tokenAddress: winner,
  bucketStartedAt: "2026-08-03T18:50:00.000Z",
  observedPairAddress: "pair-flow-tp-winner",
  observedPriceUsd: 0.05,
  observedLiquidityUsd: 20_000,
});
const conflictingCollectorScorecard = buildDexPulseBuyPressureTakeProfitScorecard(
  conflictingCollector,
);
assert.equal(conflictingCollectorScorecard.eligibleCompletePathObservations, 1);
assert.equal(
  conflictingCollectorScorecard.pathExclusionCounts["cross-collector-price-disagreement"],
  1,
);

const forgedProviderIntegrity = structuredClone(events);
forgedProviderIntegrity.find((event) => event.type === "dex-surface-pulse-path"
  && event.tokenAddress === winner
  && event.bucketStartedAt === "2026-08-03T18:50:00.000Z")
  .providerPriceIntegrity.directPriceUsd = 20;
const forgedProviderIntegrityScorecard = buildDexPulseBuyPressureTakeProfitScorecard(
  forgedProviderIntegrity,
);
assert.equal(forgedProviderIntegrityScorecard.eligibleCompletePathObservations, 1);
assert.equal(
  forgedProviderIntegrityScorecard.pathExclusionCounts["provider-price-integrity-mismatch"],
  1,
);

await assert.rejects(
  registerDexPulseCadenceTolerantTakeProfit({ ledgerPath }, {
    now: new Date(DEX_PULSE_CADENCE_TOLERANT_TAKE_PROFIT_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const cadenceRegistration = await registerDexPulseCadenceTolerantTakeProfit({ ledgerPath }, {
  now: new Date("2026-08-03T20:45:41.000Z"),
});
assert.equal(cadenceRegistration.status, "registered");
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:34:46.000Z"),
});

const cadenceWinner = "CadenceWinner333";
const cadenceFiltered = "CadenceFiltered444";
await appendLedgerEvent(ledgerPath, discovery(
  cadenceWinner,
  cadenceFiltered,
  "discovery-flow-take-profit-cadence-fixture",
  "2026-08-03T20:50:00.000Z",
));
await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T20:50:01.000Z"),
  fetcher: pairFetcher(cadenceWinner, cadenceFiltered, 1, 1),
});
for (const mark of [
  ["2026-08-03T20:55:01.000Z", 1.05, 1.01],
  ["2026-08-03T21:00:01.000Z", 1.08, 1.015],
  ["2026-08-03T21:10:01.200Z", 1.12, 1.02],
  ["2026-08-03T21:20:01.200Z", 1.04, 1.03],
  ["2026-08-03T21:30:01.200Z", 0.95, 1.04],
  ["2026-08-03T21:40:01.200Z", 0.85, 1.1],
  ["2026-08-03T21:45:01.200Z", 0.82, 1.15],
]) {
  await markOpenDexSurfacePulse({ ledgerPath }, {
    now: new Date(mark[0]),
    fetcher: pairFetcher(cadenceWinner, cadenceFiltered, mark[1], mark[2]),
  });
}
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T21:50:02.000Z"),
  fetcher: pairFetcher(cadenceWinner, cadenceFiltered, 0.8, 1.2),
});

const cadenceEvents = await readLedger(ledgerPath);
const strictAfterJitter = buildDexPulseBuyPressureTakeProfitScorecard(cadenceEvents);
assert.equal(strictAfterJitter.eligibleCompletePathObservations, 2);
assert.ok(strictAfterJitter.pathExclusionCounts["path-cadence-gap"] >= 1);
const cadenceScorecard = buildDexPulseCadenceTolerantTakeProfitScorecard(cadenceEvents);
assert.equal(cadenceScorecard.registrationId, cadenceRegistration.registrationId);
assert.equal(cadenceScorecard.candidateForecasts, 2);
assert.equal(cadenceScorecard.eligibleCompletePathObservations, 2);
assert.equal(cadenceScorecard.takeProfitExits, 1);
assert.equal(cadenceScorecard.pathExclusionCounts["path-cadence-gap"], undefined);

const exitAudit = buildDexPulseScreenExitHypothesisAudit(cadenceEvents);
assert.equal(exitAudit.status, "posthoc-hypothesis-audit-only");
assert.equal(exitAudit.promotionAllowed, false);
assert.equal(exitAudit.sourceScreenId, "buy-pressure-positive-momentum");
assert.ok(exitAudit.eligibleCompletePathObservations >= 4);
assert.ok(exitAudit.selectedWeightedObservations >= 4);
assert.equal(exitAudit.policies.hold.exits, 0);
assert.ok(exitAudit.policies.tailStop.exits >= 1);
assert.ok(exitAudit.policies.fullTakeProfit.exits >= 1);
assert.ok(exitAudit.policies.halfTrim.exits >= 1);
assert.ok(exitAudit.policies.asymmetricBracket.exits >= 1);
assert.equal(exitAudit.policies.hold.pairedVsHoldFrameMeanDeltaPct, 0);

await registerDexPulseCrossWindowReversal({ ledgerPath }, {
  now: new Date("2026-08-04T01:23:02.879Z"),
});
await assert.rejects(
  registerDexPulseCrossWindowReversalTakeProfit({ ledgerPath }, {
    now: new Date(DEX_PULSE_CROSS_WINDOW_REVERSAL_TAKE_PROFIT_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const reversalTakeProfitRegistration = await registerDexPulseCrossWindowReversalTakeProfit(
  { ledgerPath },
  { now: new Date("2026-08-04T04:34:24.000Z") },
);
assert.equal(reversalTakeProfitRegistration.status, "registered");
assert.equal((await registerDexPulseCrossWindowReversalTakeProfit(
  { ledgerPath },
  { now: new Date("2026-08-04T04:34:25.000Z") },
)).status, "existing");

const reversalWinner = "ReversalTakeProfitWinner555";
const reversalCash = "ReversalTakeProfitCash666";
const reversalDiscovery = discovery(
  reversalWinner,
  reversalCash,
  "discovery-reversal-take-profit-fixture",
  "2026-08-04T04:40:00.000Z",
);
reversalDiscovery.candidates[0].priceChangeM5Pct = -1;
reversalDiscovery.candidates[0].priceChangeH1Pct = 5;
reversalDiscovery.candidates[1].priceChangeM5Pct = null;
reversalDiscovery.candidates[1].priceChangeH1Pct = 5;
await appendLedgerEvent(ledgerPath, reversalDiscovery);
await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T04:40:01.000Z"),
  fetcher: pairFetcher(reversalWinner, reversalCash, 1, 1),
});
for (const mark of [
  ["2026-08-04T04:45:01.000Z", 1.03, 1.01],
  ["2026-08-04T04:50:01.000Z", 1.08, 1.01],
  ["2026-08-04T04:55:01.000Z", 1.2, 1.01],
  ["2026-08-04T05:05:01.000Z", 1.04, 1.01],
  ["2026-08-04T05:15:01.000Z", 0.95, 1.01],
  ["2026-08-04T05:25:01.000Z", 0.85, 1.01],
  ["2026-08-04T05:35:01.000Z", 0.82, 1.01],
]) {
  await markOpenDexSurfacePulse({ ledgerPath }, {
    now: new Date(mark[0]),
    fetcher: pairFetcher(reversalWinner, reversalCash, mark[1], mark[2]),
  });
}
await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-04T05:40:02.000Z"),
  fetcher: pairFetcher(reversalWinner, reversalCash, 0.8, 1.01),
});

const reversalTakeProfitScorecard = buildDexPulseCrossWindowReversalTakeProfitScorecard(
  await readLedger(ledgerPath),
);
assert.equal(
  reversalTakeProfitScorecard.registrationId,
  reversalTakeProfitRegistration.registrationId,
);
assert.equal(reversalTakeProfitScorecard.candidateForecasts, 2);
assert.equal(reversalTakeProfitScorecard.eligibleCompletePathObservations, 2);
assert.equal(reversalTakeProfitScorecard.entryScreenTradedObservations, 1);
assert.equal(reversalTakeProfitScorecard.entryScreenCashObservations, 1);
assert.deepEqual(reversalTakeProfitScorecard.sourceCashCounts, {
  "missing-or-invalid-five-minute-momentum": 1,
});
assert.equal(
  reversalTakeProfitScorecard.observationsDetail.find((row) => !row.entryTraded)
    .entrySourceReason,
  "missing-or-invalid-five-minute-momentum",
);
assert.equal(reversalTakeProfitScorecard.takeProfitExits, 1);
assert.ok(reversalTakeProfitScorecard.parentFrameMeanNetReturnPct < 0);
assert.ok(reversalTakeProfitScorecard.policyFrameMeanNetReturnPct > 0);
assert.ok(reversalTakeProfitScorecard.stressedPolicyFrameMeanNetReturnPct > 0);
assert.ok(reversalTakeProfitScorecard.pairedFrameMeanDeltaPct > 0);
assert.equal(reversalTakeProfitScorecard.provisionalGate, false);

console.log("token-edge DEX pulse buy-pressure take-profit checks passed.");

function discovery(
  winnerAddress,
  filteredAddress,
  id = "discovery-flow-take-profit-fixture",
  observedAt = "2026-08-03T18:35:00.000Z",
) {
  return {
    type: "discovery",
    id,
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt,
    availableAt: observedAt,
    candidates: [
      candidate(winnerAddress, "TPWIN", "pair-flow-tp-winner", 2, 20, 10),
      candidate(filteredAddress, "FILTER", "pair-flow-tp-filter", 0.5, 5, 10),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress, ratio, buys, sells) {
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
    fiveMinuteBuySellTxnRatio: ratio,
    fiveMinuteTurnover: 0.1,
    priceChangeM5Pct: 1,
    buysM5: buys,
    sellsM5: sells,
    volumeM5Usd: 2_000,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function pairFetcher(winnerAddress, filteredAddress, winnerPrice, filteredPrice) {
  return async () => ({
    ok: true,
    json: async () => [
      pair(winnerAddress, "pair-flow-tp-winner", winnerPrice),
      pair(filteredAddress, "pair-flow-tp-filter", filteredPrice),
    ],
  });
}

function pair(address, pairAddress, priceUsd) {
  return {
    baseToken: { address },
    pairAddress,
    priceUsd: String(priceUsd),
    liquidity: { usd: 20_000 },
  };
}
