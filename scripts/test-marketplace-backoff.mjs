#!/usr/bin/env node
// Pure cadence math for the marketplace monitor: the default ladder walks
// 10s → 1m → 10m → base as quiet time grows, custom ladders normalize
// (sorted, floored, monotone intervals), and the reset window returns cadence
// to the base interval. No I/O.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  DEFAULT_MARKETPLACE_BACKOFF_LADDER,
  DEFAULT_MARKETPLACE_MONITOR_CONFIG,
  MARKETPLACE_MIN_POLL_INTERVAL_MS,
  computeMarketplacePollIntervalMs,
  normalizeMarketplaceBackoffLadder,
  normalizeMarketplaceMonitorConfig,
} = await import("../src/lib/services/marketplace/marketplace-types.ts");

const config = DEFAULT_MARKETPLACE_MONITOR_CONFIG;
const now = Date.parse("2026-07-18T12:00:00.000Z");
const quiet = (ms) => computeMarketplacePollIntervalMs(config, now - ms, now);

// ── default ladder walk ─────────────────────────────────────────────────────
assert.equal(quiet(0), 10_000, "just replied: every 10s");
assert.equal(quiet(299_999), 10_000, "still hot just under 5 min");
assert.equal(quiet(300_000), 60_000, "5 min quiet: every minute");
assert.equal(quiet(1_799_999), 60_000, "still per-minute under 30 min");
assert.equal(quiet(1_800_000), 600_000, "30 min quiet: every 10 minutes");
assert.equal(quiet(7_199_999), 600_000, "still 10-minute cadence under the reset window");
assert.equal(quiet(7_200_000), 3_600_000, "past ladderResetMs: back to hourly base");
assert.equal(quiet(86_400_000), 3_600_000, "long-idle stays at base");

// No activity recorded at all → base cadence.
assert.equal(computeMarketplacePollIntervalMs(config, undefined, now), 3_600_000);
assert.equal(computeMarketplacePollIntervalMs(config, Number.NaN, now), 3_600_000);

// The ladder only accelerates: an interval above base clamps down to base.
const slowLadder = { baseIntervalMs: 60_000, ladder: [{ afterQuietMs: 0, intervalMs: 600_000 }], ladderResetMs: 7_200_000 };
assert.equal(computeMarketplacePollIntervalMs(slowLadder, now, now), 60_000, "ladder never slows below base cadence");

// ── ladder normalization ────────────────────────────────────────────────────
assert.deepEqual(normalizeMarketplaceBackoffLadder(null), DEFAULT_MARKETPLACE_BACKOFF_LADDER, "non-array degrades to default");
assert.deepEqual(normalizeMarketplaceBackoffLadder([]), DEFAULT_MARKETPLACE_BACKOFF_LADDER, "empty degrades to default");
assert.deepEqual(
  normalizeMarketplaceBackoffLadder([{ afterQuietMs: "soon", intervalMs: 1000 }, "junk"]),
  DEFAULT_MARKETPLACE_BACKOFF_LADDER,
  "all-invalid degrades to default",
);

const normalized = normalizeMarketplaceBackoffLadder([
  { afterQuietMs: 600_000, intervalMs: 120_000 },
  { afterQuietMs: 0, intervalMs: 1_000 }, // below the 5s floor → clamped
  { afterQuietMs: 600_000, intervalMs: 999_999 }, // duplicate afterQuietMs → dropped
  { afterQuietMs: 1_200_000, intervalMs: 30_000 }, // narrower than the previous rung → raised
]);
assert.deepEqual(normalized, [
  { afterQuietMs: 0, intervalMs: MARKETPLACE_MIN_POLL_INTERVAL_MS },
  { afterQuietMs: 600_000, intervalMs: 120_000 },
  { afterQuietMs: 1_200_000, intervalMs: 120_000 },
]);

// ── config normalization ────────────────────────────────────────────────────
const roundTripped = normalizeMarketplaceMonitorConfig({ baseIntervalMs: 1_800_000, ladder: normalized, ladderResetMs: 3_600_000 });
assert.equal(roundTripped.baseIntervalMs, 1_800_000, "custom base interval respected");
assert.equal(roundTripped.ladderResetMs, 3_600_000);
assert.deepEqual(roundTripped.ladder, normalized);

const junkConfig = normalizeMarketplaceMonitorConfig({ baseIntervalMs: -5, ladder: "no", ladderResetMs: "later" });
assert.deepEqual(junkConfig, { ...DEFAULT_MARKETPLACE_MONITOR_CONFIG, ladder: DEFAULT_MARKETPLACE_BACKOFF_LADDER });
assert.equal(normalizeMarketplaceMonitorConfig({ baseIntervalMs: 5_000 }).baseIntervalMs, 60_000, "base interval floors at 1 minute");
assert.deepEqual(normalizeMarketplaceMonitorConfig(undefined), DEFAULT_MARKETPLACE_MONITOR_CONFIG);

// Custom ladder + custom base end-to-end: a 30-minute base with a single hot rung.
const custom = normalizeMarketplaceMonitorConfig({
  baseIntervalMs: 1_800_000,
  ladder: [{ afterQuietMs: 0, intervalMs: 15_000 }],
  ladderResetMs: 600_000,
});
assert.equal(computeMarketplacePollIntervalMs(custom, now - 1_000, now), 15_000);
assert.equal(computeMarketplacePollIntervalMs(custom, now - 600_000, now), 1_800_000, "custom reset window returns to custom base");

// ── monitor tick gate (mutual exclusion + posted-unverified promotion) ──────
const { computeMarketplaceTickGate } = await import("../src/lib/services/marketplace/marketplace-types.ts");
const iso = (ms) => new Date(ms).toISOString();
const gate = (runtime, listings) =>
  computeMarketplaceTickGate({ runtime, listings, nowMs: now, inFlightStaleMs: 45 * 60_000, postingStaleMs: 75 * 60_000 });

// A fresh in-flight op suppresses the whole wake.
assert.deepEqual(gate({ inFlightOp: "work-inbox", inFlightSince: iso(now - 60_000) }, []), {
  skip: "in-flight",
  clearStaleInFlight: false,
  verifyPostedUnverified: false,
  pollDue: false,
});
// A stale in-flight marker (crash mid-session) clears and the wake proceeds.
const staleInFlight = gate({ inFlightOp: "work-inbox", inFlightSince: iso(now - 46 * 60_000) }, []);
assert.equal(staleInFlight.skip, null);
assert.equal(staleInFlight.clearStaleInFlight, true);
assert.equal(staleInFlight.pollDue, true, "no nextPollAt means the poll is due");

// A "posting" listing = a dispatched agent session may own the profile's
// browser RIGHT NOW (possibly dispatched from another machine — the listing
// state is vault-replicated, the local profile lock is not). Everything defers.
assert.deepEqual(gate({}, [{ state: "posting", updatedAt: iso(now - 60_000) }]), {
  skip: "posting-session",
  clearStaleInFlight: false,
  verifyPostedUnverified: false,
  pollDue: false,
});
// A wedged "posting" older than the session cap stops muting the monitor.
assert.equal(gate({}, [{ state: "posting", updatedAt: iso(now - 76 * 60_000) }]).skip, null, "a crashed posting session cannot defer forever");
// An unparseable posting timestamp is treated as live (defer) — fail safe.
assert.equal(gate({}, [{ state: "posting", updatedAt: "garbage" }]).skip, "posting-session");

// posted-unverified triggers the owning machine's promotion pass even when the
// poll cadence is not due — deferred claims never wait on the ladder.
assert.deepEqual(gate({ nextPollAt: iso(now + 3_600_000) }, [{ state: "posted-unverified", updatedAt: iso(now - 60_000) }]), {
  skip: null,
  clearStaleInFlight: false,
  verifyPostedUnverified: true,
  pollDue: false,
});
// Ordinary listings gate nothing; the poll respects nextPollAt.
assert.deepEqual(gate({ nextPollAt: iso(now - 1) }, [{ state: "active", updatedAt: iso(now) }]), {
  skip: null,
  clearStaleInFlight: false,
  verifyPostedUnverified: false,
  pollDue: true,
});
assert.equal(gate({ nextPollAt: iso(now + 1) }, []).pollDue, false);

console.log("marketplace backoff tests passed");
