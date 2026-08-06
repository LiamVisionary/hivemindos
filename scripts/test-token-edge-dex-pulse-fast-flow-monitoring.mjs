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
  DEX_PULSE_FAST_FLOW_RULE,
  buildDexPulseFastFlowScorecard,
  registerDexPulseFastFlow,
} from "./token-edge/onchain-dex-pulse-fast-flow-monitoring.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-fast-flow-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await assert.rejects(
  registerDexPulseFastFlow({ ledgerPath }, { now: new Date(DEX_PULSE_FAST_FLOW_RULE.evidenceBoundary) }),
  /strictly after/,
);
const registration = await registerDexPulseFastFlow({ ledgerPath }, {
  now: new Date("2026-08-03T14:40:20.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseFastFlow({ ledgerPath }, {
  now: new Date("2026-08-03T14:40:21.000Z"),
})).status, "existing");

const winner = "FastFlowWinner111";
const loser = "FastFlowLoser222";
await appendLedgerEvent(ledgerPath, discovery(winner, loser));
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T14:41:01.000Z"),
});
assert.equal(capture.recordedForecasts, 2);
const captured = await readLedger(ledgerPath);
const winnerForecast = captured.find((event) => event.type === "dex-surface-pulse-forecast"
  && event.tokenAddress === winner);
assert.equal(winnerForecast.metrics.fiveMinuteBuySellTxnRatio, 2);
assert.equal(winnerForecast.metrics.fiveMinuteTurnover, 0.1);
assert.equal(winnerForecast.metrics.priceChangeM5Pct, 1);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T15:41:02.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [pair(winner, "pair-fast-winner", 1.25), pair(loser, "pair-fast-loser", 0.75)],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseFastFlowScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.candidateForecasts, 2);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
const consensus = scorecard.screens.find((screen) => screen.id === "five-minute-flow-consensus");
assert.equal(consensus.observations, 1);
assert.ok(consensus.screenAverageCapacityReturnPct > 0);
assert.ok(consensus.pairedCapacityDeltaPct > 0);
assert.equal(scorecard.screens.find((screen) => screen.id === "five-minute-buy-pressure").observations, 1);
assert.equal(scorecard.screens.find((screen) => screen.id === "five-minute-positive-momentum").observations, 1);

const forged = structuredClone(events);
forged.find((event) => event.id === winnerForecast.id).metrics.priceChangeM5Pct = -99;
const forgedScorecard = buildDexPulseFastFlowScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);

console.log("token-edge DEX pulse five-minute fast-flow monitoring checks passed.");

function discovery(winnerAddress, loserAddress) {
  return {
    type: "discovery",
    id: "discovery-fast-flow-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T14:41:00.000Z",
    availableAt: "2026-08-03T14:41:00.000Z",
    candidates: [
      candidate(winnerAddress, "WIN", "pair-fast-winner", {
        fiveMinuteBuySellTxnRatio: 2,
        fiveMinuteTurnover: 0.1,
        priceChangeM5Pct: 1,
        buysM5: 20,
        sellsM5: 10,
        volumeM5Usd: 2_000,
      }),
      candidate(loserAddress, "LOSE", "pair-fast-loser", {
        fiveMinuteBuySellTxnRatio: 0.5,
        fiveMinuteTurnover: 0.02,
        priceChangeM5Pct: -1,
        buysM5: 5,
        sellsM5: 10,
        volumeM5Usd: 400,
      }),
    ],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function candidate(tokenAddress, symbol, pairAddress, fast) {
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
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    ...fast,
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
