#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { isRedispatchableReadyTask } = await import("../src/lib/services/queen-bee/control-plane.ts");

const now = 1_800_000_000_000;
const old = now - 300_000; // ready for 5 min
const base = {
  status: "ready",
  assignee: "Grace Hopper",
  targetMachine: { collectorUrl: "http://ubuntu:8787", key: "ubuntu", name: "Ubuntu" },
  loop: { mode: "closed" },
  source: "queen-bee:abc",
  updatedAt: old,
};

assert.equal(isRedispatchableReadyTask(base, now), true, "a stranded ready autonomous task should be re-dispatchable");
assert.equal(isRedispatchableReadyTask({ ...base, status: "working" }, now), false, "working tasks are not re-dispatched");
assert.equal(isRedispatchableReadyTask({ ...base, status: "done" }, now), false, "done tasks are not re-dispatched");
assert.equal(isRedispatchableReadyTask({ ...base, targetMachine: undefined }, now), false, "no collector URL -> skip");
assert.equal(isRedispatchableReadyTask({ ...base, assignee: "queen-bee" }, now), false, "unassigned (queen-bee) -> skip");
assert.equal(isRedispatchableReadyTask({ ...base, assignee: undefined }, now), false, "no assignee -> skip");
assert.equal(isRedispatchableReadyTask({ ...base, loop: undefined, source: "manual" }, now), false, "non-autonomous task -> skip");
assert.equal(isRedispatchableReadyTask({ ...base, loop: undefined, source: "loop:xyz" }, now), true, "loop-sourced task -> re-dispatchable");
assert.equal(isRedispatchableReadyTask({ ...base, updatedAt: now - 1000 }, now), false, "freshly-ready task -> skip (don't race the original pickup)");

// ── queen takeover on exhausted chains (Liam's rule, 2026-07-18) ────────────
// A mixed exhausted chain — broken-config delegates up front, healthy agents
// dying on "fetch failed" after the broken spawns saturated the machine — must
// RETRY (targeted at the transient-failed delegate) instead of stranding
// needs-human. Attempts still bound the loop.
const { pickupExhaustionRetryReason, preferredExhaustionRetryDelegation } = await import(
  "../src/lib/services/queen-bee/autonomous-worker.ts"
);

const configFailure = "BankrAgent [this mac]: agent failed: Unknown provider 'bankr'. Check 'hermes model' for available providers.";
const transportFailure = "Solara [this mac]: fetch failed";
const noOutputFailure = "Mr Artisse [this mac]: hermes -z: no final response was produced; treating the run as failed.";

assert.equal(pickupExhaustionRetryReason([]), undefined, "no failures -> no retry classification");
assert.equal(pickupExhaustionRetryReason([configFailure]), undefined, "pure config failures still escalate to a human");
assert.equal(pickupExhaustionRetryReason([configFailure, transportFailure]), "timeout", "ANY infrastructure failure in the chain retries (queen takeover)");
assert.equal(pickupExhaustionRetryReason([transportFailure]), "timeout", "all-transient chains retry as before");

const chain = [
  { agent: { name: "BankrAgent" }, machine: { key: "this-mac" } },
  { agent: { name: "Mr Artisse" }, machine: { key: "this-mac" } },
  { agent: { name: "Solara" }, machine: { key: "this-mac" } },
];
assert.equal(
  preferredExhaustionRetryDelegation(chain, [configFailure, noOutputFailure, transportFailure])?.agent?.name,
  "Solara",
  "the takeover targets the pure-TRANSPORT delegate (never ran) over a no-output runtime flake",
);
assert.equal(
  preferredExhaustionRetryDelegation(chain, [configFailure, noOutputFailure])?.agent?.name,
  "Mr Artisse",
  "with no transport failure, the broader infra/no-output delegate is the fallback target",
);
assert.equal(
  preferredExhaustionRetryDelegation(chain, [configFailure]),
  undefined,
  "a chain of only deterministic failures has no takeover target",
);

// ── performance policy yields to a hard machine pin ─────────────────────────
// A pinned task has no alternative machine: live-usage limits (CPU/RAM/disk)
// must deprioritize, never hard-block (a marketplace task pinned to the only
// machine with the signed-in browser sat pending at "CPU is 100%"). Manual
// ignore remains absolute.
const { rankQueenBeeDelegates } = await import("../src/lib/services/queen-bee/router.ts");
const hotMachine = (overrides = {}) => ({
  key: "hot-mac",
  collector: "ready",
  device: { self: true, name: "This Mac", dnsName: "hivemindos-hot-mac.tail1.ts.net", online: true },
  capabilities: { chat: true },
  system: { cpuPct: 100 },
  fleetPolicy: { configured: true, performance: { enabled: true, maxCpuPct: 85, ...(overrides.performance ?? {}) } },
  agents: [{ name: "Solara", runtime: "hermes", runtimeCapabilities: { chat: true } }],
});
const intent = { title: "Marketplace create-listing", body: "post the listing", skills: [] };
assert.equal(
  rankQueenBeeDelegates(intent, [hotMachine()], {}).length,
  0,
  "an over-CPU machine is excluded from UNPINNED routing",
);
assert.ok(
  rankQueenBeeDelegates(intent, [hotMachine()], { targetMachineKey: "hivemindos-hot-mac" }).length > 0,
  "a hard pin overrides the live-usage limit — the pinned work has nowhere else to run",
);
assert.equal(
  rankQueenBeeDelegates(intent, [hotMachine({ performance: { ignore: true } })], { targetMachineKey: "hivemindos-hot-mac" }).length,
  0,
  "manual ignore is always honored, pin or not",
);

console.log("redispatch predicate tests passed");
