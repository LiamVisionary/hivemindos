#!/usr/bin/env node
// Hermetic coverage for the engine-side API budget snapshot store — the rail a
// company's own deterministic engine (maps-agency's bridge) uses to surface
// its in-process spend meter + provider-lockdown state to the ZHC Limits tab:
// - validateEngineBudgetSnapshot bounds-checks and clamps engine-pushed data
// - record + read round-trips per company, latest snapshot wins
// - a missing or corrupt store degrades to empty, never throws
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// The store binds HOME at module load — isolate before importing.
const tempHome = await mkdtemp(join(tmpdir(), "hivemind-engine-budget-home-"));
process.env.HOME = tempHome;
await mkdir(join(tempHome, ".hivemindos"), { recursive: true });

const {
  validateEngineBudgetSnapshot,
  recordCompanyEngineBudgetSnapshot,
  readCompanyEngineBudgetSnapshot,
} = await import("../src/lib/services/company-engine-budget.ts");

const valid = {
  providerKey: "google-places",
  label: "maps-agency Google Places meter",
  month: "2026-07",
  monthEstCostUsd: 1.25,
  monthlyCeilingUsd: 45,
  dayDate: "2026-07-26",
  dayCalls: { places_text_search: 12, places_details: 3 },
  dailyCallCaps: { places_text_search: 30, places_details: 10 },
  lockdown: true,
  lockdownReason: "PERMISSION_DENIED from Places API",
  configPath: "config/niches.json",
  updatedAt: "2026-07-26T12:00:00Z",
};

// --- validation ---
assert.equal(validateEngineBudgetSnapshot(null), null, "null is rejected");
assert.equal(validateEngineBudgetSnapshot("x"), null, "non-object is rejected");
assert.equal(validateEngineBudgetSnapshot({ ...valid, providerKey: "" }), null, "empty providerKey is rejected");
assert.equal(validateEngineBudgetSnapshot({ ...valid, monthEstCostUsd: Number.NaN }), null, "NaN cost is rejected");
assert.equal(validateEngineBudgetSnapshot({ ...valid, monthlyCeilingUsd: -1 }), null, "negative ceiling is rejected");
assert.equal(validateEngineBudgetSnapshot({ ...valid, updatedAt: "" }), null, "missing updatedAt is rejected");

const cleaned = validateEngineBudgetSnapshot({
  ...valid,
  lockdownReason: null, // engines send null when there is no lockdown
  dayCalls: { ok: 3.7, "  ": 5, bad: "x", negative: -2 },
  dailyCallCaps: { ["k".repeat(200)]: 9 },
});
assert.ok(cleaned, "a valid snapshot with messy counters still validates");
assert.equal(cleaned.lockdownReason, undefined, "null lockdownReason becomes undefined");
assert.deepEqual(cleaned.dayCalls, { ok: 3 }, "counters are floored and invalid entries dropped");
assert.equal(Object.keys(cleaned.dailyCallCaps)[0].length, 64, "counter keys are clamped to 64 chars");

const big = validateEngineBudgetSnapshot({
  ...valid,
  dayCalls: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`sku${index}`, 1])),
});
assert.equal(Object.keys(big.dayCalls).length, 32, "counter maps are capped at 32 entries");

// --- round trip ---
assert.equal(await readCompanyEngineBudgetSnapshot("company-a"), null, "missing store reads as null");
await recordCompanyEngineBudgetSnapshot("company-a", validateEngineBudgetSnapshot(valid));
const readBack = await readCompanyEngineBudgetSnapshot("company-a");
assert.ok(readBack, "recorded snapshot reads back");
assert.equal(readBack.providerKey, "google-places");
assert.equal(readBack.lockdown, true);
assert.equal(readBack.dayCalls.places_text_search, 12);
assert.equal(await readCompanyEngineBudgetSnapshot("company-b"), null, "other companies stay null");

await recordCompanyEngineBudgetSnapshot("company-a", validateEngineBudgetSnapshot({
  ...valid,
  lockdown: false,
  lockdownReason: undefined,
  monthEstCostUsd: 2.5,
}));
const updated = await readCompanyEngineBudgetSnapshot("company-a");
assert.equal(updated.monthEstCostUsd, 2.5, "latest snapshot wins");
assert.equal(updated.lockdown, false, "lockdown clears on the next report");

// --- corrupt store degrades to empty ---
await writeFile(join(tempHome, ".hivemindos", "company-engine-budgets.json"), "{not json", "utf8");
assert.equal(await readCompanyEngineBudgetSnapshot("company-a"), null, "corrupt store reads as empty, no throw");
await recordCompanyEngineBudgetSnapshot("company-c", validateEngineBudgetSnapshot(valid));
assert.ok(await readCompanyEngineBudgetSnapshot("company-c"), "recording over a corrupt store recovers it");

console.log("test-company-engine-budget: all assertions passed");
