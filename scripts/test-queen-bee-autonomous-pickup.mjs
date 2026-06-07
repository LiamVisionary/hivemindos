#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  runQueenBeeAutonomousPickup,
  shouldAutonomouslyPickupQueenBeeTask,
} from "../src/lib/services/queen-bee/autonomous-worker.ts";

const task = {
  id: "t_autonomous_pickup_test",
  title: "Real autonomous pickup test",
  body: "Return the marker AUTONOMOUS_PICKUP_MARKER exactly.",
  assignee: "Grace Hopper",
  status: "ready",
  priority: "high",
  workspace: "scratch",
  skills: ["qa"],
  targetMachine: {
    key: "mac",
    name: "This Mac",
    collectorUrl: "http://collector.local:5055",
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const delegation = {
  status: "delegated",
  workerClass: "qa",
  agent: {
    id: "grace-hopper",
    name: "Grace Hopper",
    runtime: "hermes",
    workerClass: "qa",
    runtimeCapabilities: { chat: true },
  },
  machine: {
    key: "mac",
    device: {
      name: "This Mac",
      collectorUrl: "http://collector.local:5055",
    },
  },
};

assert.equal(shouldAutonomouslyPickupQueenBeeTask({ task, delegation }), true);

const calls = [];
const result = await runQueenBeeAutonomousPickup({ task, delegation, marker: "AUTONOMOUS_PICKUP_MARKER" }, {
  claim: async (slug, taskId, input) => {
    calls.push({ kind: "claim", slug, taskId, input });
    assert.equal(taskId, task.id);
    assert.match(input.claimer, /^queen-bee-autonomous:/);
    return { task: { ...task, status: "working", claimLock: input.claimer, currentRunId: "r_test" }, board: {}, run: { id: "r_test" } };
  },
  fetchJson: async (url, init) => {
    calls.push({ kind: "chat", url, init });
    assert.equal(url, "http://collector.local:5055/chat");
    const body = JSON.parse(String(init.body));
    assert.equal(body.stream, false);
    assert.equal(body.agent.name, "Grace Hopper");
    assert.equal(body.context.queenBeeAutonomousPickup, true);
    assert.match(body.message, /AUTONOMOUS_PICKUP_MARKER/);
    return { ok: true, text: "AUTONOMOUS_PICKUP_MARKER" };
  },
  complete: async (slug, taskId, input) => {
    calls.push({ kind: "complete", slug, taskId, input });
    assert.equal(taskId, task.id);
    assert.equal(input.metadata.queenBeeAutonomousPickup, true);
    assert.equal(input.metadata.markerSeen, true);
    assert.equal(input.result, "AUTONOMOUS_PICKUP_MARKER");
    return { task: { ...task, status: "done", result: input.result }, board: {} };
  },
  block: async () => {
    throw new Error("block should not be called on successful pickup");
  },
});

assert.deepEqual(calls.map((call) => call.kind), ["claim", "chat", "complete"]);
assert.equal(result.ok, true);
assert.equal(result.status, "completed");
assert.equal(result.agentName, "Grace Hopper");

console.log("Queen Bee autonomous pickup contract test passed.");
