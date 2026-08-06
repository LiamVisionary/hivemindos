#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import { recordNansenDiscovery } from "./token-edge/onchain-forward-research.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-discovery-cadence-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
let providerCalls = 0;
const fetcher = async () => {
  providerCalls += 1;
  return { ok: true, status: 200, json: async () => ({ data: [{
    chain: "solana",
    token_address: "CadenceMint1111111111111111111111111111111",
    token_symbol: "CLOCK",
    token_age_days: 1,
    market_cap_usd: 1_000_000,
    liquidity: 100_000,
    price_usd: 0.01,
    price_change: 5,
    buy_volume: 20_000,
    sell_volume: 10_000,
    volume: 30_000,
    netflow: 8_000,
    fdv: 1_000_000,
  }] }) };
};
const options = {
  ledgerPath,
  chain: "solana",
  timeframe: "5m",
  maxNansenCredits: 1,
  nansenApiKey: "fixture-key",
};

const first = await recordNansenDiscovery(options, {
  now: new Date("2026-08-03T07:30:10.000Z"), fetcher,
});
const duplicate = await recordNansenDiscovery(options, {
  now: new Date("2026-08-03T07:43:33.000Z"), fetcher,
});
const nextBucket = await recordNansenDiscovery(options, {
  now: new Date("2026-08-03T07:45:00.000Z"), fetcher,
});

assert.equal(first.status, "recorded");
assert.equal(first.attemptedCredits, 1);
assert.equal(first.eligible.length, 1);
assert.equal(duplicate.status, "skipped-existing-cadence");
assert.equal(duplicate.attemptedCredits, 0);
assert.equal(duplicate.discoveryId, first.discoveryId);
assert.equal(duplicate.eligible.length, 0);
assert.equal(duplicate.existingEligibleCount, 1);
assert.equal(nextBucket.status, "recorded");
assert.notEqual(nextBucket.discoveryId, first.discoveryId);
assert.equal(providerCalls, 2);
const events = await readLedger(ledgerPath);
assert.equal(events.length, 2);
assert.equal(verifyLedger(events).ok, true);

console.log("Token-edge Nansen discovery cadence contract passes.");
