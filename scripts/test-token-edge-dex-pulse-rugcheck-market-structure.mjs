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
  DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE,
  buildDexPulseRugCheckMarketStructureScorecard,
  enrichDexSurfacePulseWithRugCheckMarketStructure,
  registerDexPulseRugCheckMarketStructure,
} from "./token-edge/onchain-dex-pulse-rugcheck-market-structure.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "dex-pulse-rugcheck-structure-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
await registerDexSurfacePulse({ ledgerPath }, { now: new Date("2026-08-03T12:30:10.000Z") });
await registerDexPulseEntryProviderPriceIntegrity({ ledgerPath }, {
  now: new Date("2026-08-03T19:30:16.000Z"),
});
await assert.rejects(
  registerDexPulseRugCheckMarketStructure({ ledgerPath }, {
    now: new Date(DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.evidenceBoundary),
  }),
  /strictly after/,
);
const registration = await registerDexPulseRugCheckMarketStructure({ ledgerPath }, {
  now: new Date("2026-08-03T19:48:16.000Z"),
});
assert.equal(registration.status, "registered");
assert.equal((await registerDexPulseRugCheckMarketStructure({ ledgerPath }, {
  now: new Date("2026-08-03T19:48:17.000Z"),
})).status, "existing");

const winner = "StructureWinner111";
const loser = "StructureLoser222";
await appendLedgerEvent(ledgerPath, discovery(winner, loser));
const enrichment = await enrichDexSurfacePulseWithRugCheckMarketStructure(
  { ledgerPath, maxRequests: 2 },
  {
    now: new Date("2026-08-03T19:50:02.000Z"),
    responseNow: () => new Date("2026-08-03T19:50:03.000Z"),
    reportReader: async (tokenAddress) => tokenAddress === winner
      ? report(winner, { distributed: true, broad: true, revoked: true, immutable: true })
      : report(loser, { distributed: false, broad: false, revoked: false, immutable: false }),
  },
);
assert.equal(enrichment.status, "recorded");
assert.equal(enrichment.evidence.length, 2);
assert.deepEqual(enrichment.requestBudget, { maximum: 2, attempted: 2, succeeded: 2, failed: 0 });

const capture = await captureDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T19:50:04.000Z"),
  fetcher: marketFetcher({
    [winner]: ["pair-structure-winner", 1, 20_000],
    [loser]: ["pair-structure-loser", 1, 20_000],
  }),
});
assert.equal(capture.recordedForecasts, 2);
const captured = await readLedger(ledgerPath);
const winnerForecast = captured.find((event) => (
  event.type === "dex-surface-pulse-forecast" && event.tokenAddress === winner
));
assert.equal(winnerForecast.rugCheckStructureEnrichmentReceiptId, enrichment.receiptId);
assert.ok(winnerForecast.rugCheckStructureEvidenceId);

await resolveDexSurfacePulse({ ledgerPath }, {
  now: new Date("2026-08-03T20:50:05.000Z"),
  fetcher: marketFetcher({
    [winner]: ["pair-structure-winner", 1.25, 20_000],
    [loser]: ["pair-structure-loser", 0.75, 20_000],
  }),
});
const events = await readLedger(ledgerPath);
assert.equal(verifyLedger(events).ok, true);
const scorecard = buildDexPulseRugCheckMarketStructureScorecard(events);
assert.equal(scorecard.registrationId, registration.registrationId);
assert.equal(scorecard.eligibleLiveObservations, 2);
for (const id of [
  "known-account-adjusted-top20-at-most-30-percent",
  "multiple-reported-markets",
  "multiple-reported-market-types",
  "mint-and-freeze-authorities-revoked",
  "immutable-token-metadata",
  "pumpfun-amm-present",
]) {
  const screen = scorecard.screens.find((item) => item.id === id);
  assert.equal(screen.observations, 1, id);
  assert.ok(screen.screenAverageCapacityReturnPct > 0, id);
}

const serialized = JSON.stringify(events.filter((event) => (
  event.type === "rugcheck-market-structure-snapshot"
)));
assert.equal(serialized.includes("KnownHolderAddress111"), false);
assert.equal(serialized.includes("KnownOwnerAddress111"), false);
const forged = structuredClone(events);
forged.find((event) => event.id === winnerForecast.rugCheckStructureEvidenceId)
  .aggregate.unknownTop20Pct = 99;
const forgedScorecard = buildDexPulseRugCheckMarketStructureScorecard(forged);
assert.equal(forgedScorecard.eligibleLiveObservations, 1);
assert.equal(forgedScorecard.rejectionCounts["invalid-rugcheck-market-structure-aggregate"], 1);

console.log("token-edge DEX pulse RugCheck market-structure checks passed.");

function discovery(winnerAddress, loserAddress) {
  return {
    type: "discovery",
    id: "discovery-rugcheck-market-structure-fixture",
    provider: "dexscreener-early-surface",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    observedAt: "2026-08-03T19:50:00.000Z",
    availableAt: "2026-08-03T19:50:00.000Z",
    candidates: [
      candidate(winnerAddress, "WIN", "pair-structure-winner"),
      candidate(loserAddress, "LOSE", "pair-structure-loser"),
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
    volumeM5Usd: 2_000, fiveMinuteTurnover: 0.1,
    buysH1: 200, sellsH1: 100, buySellTxnRatio: 2,
    buysM5: 20, sellsM5: 10, fiveMinuteBuySellTxnRatio: 2,
    priceChangeM5Pct: 2, priceChangeH1Pct: 5, priceChangeH24Pct: 10,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
}

function report(mint, { distributed, broad, revoked, immutable }) {
  const knownAddress = "KnownHolderAddress111";
  const knownOwner = "KnownOwnerAddress111";
  const markets = broad
    ? [
      { pubkey: mint.includes("Winner") ? "pair-structure-winner" : "pair-structure-loser", marketType: "pump_fun_amm" },
      { pubkey: "secondary-market", marketType: "meteora_damm_v2" },
    ]
    : [{ pubkey: "pair-structure-loser", marketType: "orca" }];
  return {
    mint,
    token: {
      mintAuthority: revoked ? null : "mint-authority",
      freezeAuthority: revoked ? null : "freeze-authority",
    },
    tokenMeta: { mutable: !immutable },
    topHolders: [
      { address: knownAddress, owner: knownOwner, pct: 40, insider: false },
      { address: "UnretainedHolder222", owner: "UnretainedOwner222", pct: distributed ? 20 : 50, insider: false },
    ],
    knownAccounts: { [knownAddress]: { name: "pool", type: "AMM" } },
    markets,
    totalLPProviders: broad ? 3 : 1,
    launchpad: { platform: broad ? "pump_fun" : "other" },
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
