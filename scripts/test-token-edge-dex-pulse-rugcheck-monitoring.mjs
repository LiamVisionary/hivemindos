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
  DEX_PULSE_RUGCHECK_RULE,
  buildDexPulseRugCheckScorecard,
  enrichDexSurfacePulseWithRugCheck,
  registerDexPulseRugCheck,
} from "./token-edge/onchain-dex-pulse-rugcheck-monitoring.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-rugcheck-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await assert.rejects(
  registerDexPulseRugCheck({ ledgerPath }, { now: new Date(DEX_PULSE_RUGCHECK_RULE.evidenceBoundary) }),
  /strictly after/,
);
const registration = await registerDexPulseRugCheck({ ledgerPath }, {
  now: new Date("2026-08-03T14:51:31.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseRugCheck({ ledgerPath }, {
  now: new Date("2026-08-03T14:51:32.000Z"),
})).status, "existing");

const winner = "RugCheckWinner111";
const loser = "RugCheckLoser222";
await appendLedgerEvent(ledgerPath, discovery(winner, loser));
const enrichment = await enrichDexSurfacePulseWithRugCheck({ ledgerPath, maxRequests: 2 }, {
  now: new Date("2026-08-03T14:52:02.000Z"),
  responseNow: () => new Date("2026-08-03T14:52:03.000Z"),
  reportReader: async (tokenAddress) => tokenAddress === winner
    ? report(winner, { score: 1, danger: [], insiders: 0, lockedPct: 100 })
    : report(loser, { score: 80, danger: ["Creator history of rugged tokens"], insiders: 100, lockedPct: 0 }),
});
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.evidence.length, 2);
const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T14:52:04.000Z"),
});
assert.equal(capture.recordedForecasts, 2);
const captured = await readLedger(ledgerPath);
const winnerForecast = captured.find((event) => event.type === "dex-surface-pulse-forecast"
  && event.tokenAddress === winner);
assert.equal(winnerForecast.rugCheckEnrichmentReceiptId, enrichment.receiptId);
assert.ok(winnerForecast.rugCheckEvidenceId);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T15:52:05.000Z"),
  fetcher: async () => ({
    ok: true,
    json: async () => [pair(winner, "pair-rug-winner", 1.25), pair(loser, "pair-rug-loser", 0.75)],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseRugCheckScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.eligibleLiveObservations, 2);
assert.equal(scorecard.independentHourlyFrames, 1);
for (const id of ["no-danger-risks", "low-provider-risk-score", "no-insider-graph", "main-liquidity-locked", "strict-rugcheck-consensus"]) {
  const screen = scorecard.screens.find((item) => item.id === id);
  assert.equal(screen.observations, 1);
  assert.ok(screen.screenAverageCapacityReturnPct > 0);
}

const forged = structuredClone(events);
forged.find((event) => event.id === winnerForecast.rugCheckEvidenceId).aggregate.graphInsidersDetected = 999;
const forgedScorecard = buildDexPulseRugCheckScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);
assert.equal(forgedScorecard.rejectionCounts["invalid-rugcheck-aggregate"], 1);

console.log("token-edge DEX pulse RugCheck monitoring checks passed.");

function discovery(winnerAddress, loserAddress) {
  return {
    type: "discovery",
    id: "discovery-rugcheck-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T14:52:00.000Z",
    availableAt: "2026-08-03T14:52:00.000Z",
    candidates: [candidate(winnerAddress, "WIN", "pair-rug-winner"), candidate(loserAddress, "LOSE", "pair-rug-loser")],
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

function report(mint, { score, danger, insiders, lockedPct }) {
  return {
    mint,
    score_normalised: score,
    rugged: false,
    detectedAt: "2026-08-03T14:51:00.000Z",
    graphInsidersDetected: insiders,
    totalHolders: 1_000,
    creatorBalance: 0,
    risks: danger.map((name) => ({ name, level: "danger", score: 1 })),
    markets: [{
      pubkey: mint.includes("Winner") ? "pair-rug-winner" : "pair-rug-loser",
      lp: { lpLockedPct: lockedPct, lpLockedUSD: 20_000 },
    }],
  };
}

function pair(address, pairAddress, priceUsd) {
  return { baseToken: { address }, pairAddress, priceUsd: String(priceUsd), liquidity: { usd: 20_000 } };
}
