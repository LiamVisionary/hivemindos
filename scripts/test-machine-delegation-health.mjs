#!/usr/bin/env node
// Hermetic: the fleet's missing signal — which machines are silently failing
// delegated work. Fixtures mirror the real 2026-07-05 hel1-2 pileup (6 unpinned
// agents, chat cap 1, every WEBS task bouncing to needs-human while the cell
// stayed green).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { deriveMachineDelegationHealth } = await import(
  "../src/components/fleet-hive/machine-delegation-health.ts"
);

const hel = { id: "m-hel", name: "hivemindos-ubuntu-8gb-hel1-2", agentNames: ["Grace Hopper", "Ada Lovelace", "HermesMain"] };
const mac = { id: "m-mac", name: "Liams-MacBook-Pro-21403.local", agentNames: ["Aeon"] };

// ── failures that NAME the box are attributed to it; a quiet box stays clean ──
{
  const tasks = [
    { status: "needs-human", assignee: "Grace Hopper", result: 'machine "hivemindos-ubuntu-8gb-hel1-2" is at its autonomous chat capacity' },
    { status: "needs-human", assignee: "Ada Lovelace", result: "The operation was aborted due to timeout on hivemindos-ubuntu-8gb-hel1-2" },
    { status: "needs-human", assignee: "HermesMain", result: "502 Bad Gateway: hivemind-linkd proxy error: dial tcp …:8787 — machine hivemindos-ubuntu-8gb-hel1-2" },
    { status: "done", assignee: "Grace Hopper", result: "shipped" },
  ];
  const health = deriveMachineDelegationHealth([hel, mac], tasks, { degradedThreshold: 3 });
  assert.equal(health.get("m-hel").blocked, 3, "all 3 needs-human failures naming hel1-2 count against it");
  assert.equal(health.get("m-hel").degraded, true, "3 >= threshold → degraded (would flip the cell off green)");
  assert.ok(health.get("m-hel").sampleFailure?.includes("chat capacity"), "carries a representative failure for the tooltip");
  assert.equal(health.get("m-mac").blocked, 0, "the quiet Mac is not implicated");
  assert.equal(health.get("m-mac").degraded, false);
}

// ── failure with no machine name falls back to the assignee's machine ─────────
{
  const tasks = [{ status: "needs-human", assignee: "Aeon", result: "Hermes produced no output (silent failure)." }];
  const health = deriveMachineDelegationHealth([hel, mac], tasks);
  assert.equal(health.get("m-mac").blocked, 1, "assignee-only attribution credits the right box");
  assert.equal(health.get("m-hel").blocked, 0);
}

// ── machine-name evidence wins: a task isn't double-counted onto the assignee's box ──
{
  // assignee is a hel1-2 agent, but the failure names the MAC — evidence wins.
  const tasks = [{ status: "needs-human", assignee: "Grace Hopper", result: 'machine "Liams-MacBook-Pro-21403.local" refused' }];
  const health = deriveMachineDelegationHealth([hel, mac], tasks);
  assert.equal(health.get("m-mac").blocked, 1);
  assert.equal(health.get("m-hel").blocked, 0, "named-machine evidence beats assignee membership");
}

// ── below threshold is blocked-but-not-degraded; empty board is all clean ─────
{
  const health = deriveMachineDelegationHealth([hel, mac], [
    { status: "needs-human", assignee: "Ada Lovelace", result: "timeout on hivemindos-ubuntu-8gb-hel1-2" },
  ], { degradedThreshold: 3 });
  assert.equal(health.get("m-hel").blocked, 1);
  assert.equal(health.get("m-hel").degraded, false, "1 < 3 → surfaced but not yet 'degraded'");

  const empty = deriveMachineDelegationHealth([hel, mac], []);
  assert.equal(empty.get("m-hel").blocked, 0);
  assert.equal(empty.get("m-mac").blocked, 0);
}

console.log("machine-delegation-health: all assertions passed");
