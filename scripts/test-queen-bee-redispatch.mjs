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

console.log("redispatch predicate tests passed");
