#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

// autonomous-worker.ts now statically imports the loop runner; register the TS loader.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { runQueenBeeAutonomousPickup, shouldAutonomouslyPickupQueenBeeTask } = await import(
  "../src/lib/services/queen-bee/autonomous-worker.ts"
);
const { buildLoopFromTemplate } = await import("../src/lib/services/loops/index.ts");

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

// --- Scenario 1: plain task, no loop → claim → chat → complete, output preserved as result.
{
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
      // No loop → no receipts attached.
      assert.equal(input.loopReceipts, undefined);
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
}

// --- Scenario 2: task with a loop (research: receipt:evidence + agent:judge). The pickup
//     must generate loop receipts from the worker output AND run an independent judge,
//     then pass passing receipts to complete().
const loop = buildLoopFromTemplate({ templateId: "research", goal: "Investigate the loop regression." });
const requiredGateIds = loop.evalGates.filter((gate) => gate.required).map((gate) => gate.id);
const loopTask = { ...task, id: "t_autonomous_loop", title: "Loop pickup", body: "Investigate and report.", loop };

const SUBSTANTIVE = "Detailed findings: I traced the routing recency bonus and documented the cause with file:line evidence. Result summary: confirmed and verified.";

function loopDeps({ judgeAccepts, onComplete }) {
  const calls = [];
  return {
    calls,
    deps: {
      claim: async (slug, taskId, input) => {
        calls.push({ kind: "claim" });
        return { task: { ...loopTask, status: "working", claimLock: input.claimer, currentRunId: "r_loop" }, board: {}, run: { id: "r_loop" } };
      },
      fetchJson: async (url, init) => {
        const body = JSON.parse(String(init.body));
        if (body.context?.queenBeeLoopJudge) {
          calls.push({ kind: "judge", gateId: body.context.gateId });
          return { ok: true, text: judgeAccepts ? '{"accepted": true, "reason": "meets the bar"}' : '{"accepted": false, "reason": "insufficient evidence"}' };
        }
        calls.push({ kind: "chat" });
        return { ok: true, text: SUBSTANTIVE };
      },
      complete: onComplete,
      block: async () => {
        throw new Error("block should not be called when the worker produced output");
      },
    },
  };
}

// 2a. Judge accepts → all required gates satisfied → completes with receipts.
{
  let captured = null;
  const { calls, deps } = loopDeps({
    judgeAccepts: true,
    onComplete: async (slug, taskId, input) => {
      captured = input;
      return { task: { ...loopTask, status: "done", result: input.result }, board: {} };
    },
  });
  const result = await runQueenBeeAutonomousPickup({ task: loopTask, delegation }, deps);
  assert.equal(result.status, "completed", "loop task should complete when all gates pass");
  assert(captured?.loopReceipts?.length >= requiredGateIds.length, "passing receipts should be attached to complete()");
  const passedIds = new Set(captured.loopReceipts.filter((r) => r.status === "passed").map((r) => r.gateId));
  for (const gateId of requiredGateIds) assert(passedIds.has(gateId), `gate ${gateId} should have a passing receipt`);
  assert(calls.some((c) => c.kind === "judge"), "an independent judge should run for the agent:judge gate");
}

// 2b. Judge rejects → agent:judge gate unsatisfied → completeTask blocks → pickup reports "blocked".
{
  const { deps } = loopDeps({
    judgeAccepts: false,
    onComplete: async (slug, taskId, input) => {
      // Faithfully simulate completeTask's gate check.
      const passedIds = new Set((input.loopReceipts ?? []).filter((r) => r.status === "passed").map((r) => r.gateId));
      const missing = requiredGateIds.filter((id) => !passedIds.has(id));
      if (missing.length) {
        return { task: { ...loopTask, status: "needs-human", result: `${input.result}\n\n⚠ blocked` }, board: {}, blocked: true, missingGateIds: missing };
      }
      return { task: { ...loopTask, status: "done", result: input.result }, board: {} };
    },
  });
  const result = await runQueenBeeAutonomousPickup({ task: loopTask, delegation }, deps);
  assert.equal(result.ok, false, "a rejected judge should not yield ok=true");
  assert.equal(result.status, "blocked", "unsatisfied required gate should report blocked");
  assert.match(result.error, /loop gates/i);
}

// --- Scenario 3: empty worker output is classified as an agent-health failure (re-route hint).
{
  let blockReason = null;
  const result = await runQueenBeeAutonomousPickup({ task, delegation }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => ({ ok: true, text: "   " }),
    complete: async () => {
      throw new Error("complete should not be called when the worker returned nothing");
    },
    block: async (slug, taskId, reason) => {
      blockReason = reason;
      return { task: { ...task, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(result.status, "blocked");
  assert.match(blockReason, /no final response/i, "empty output should be reported as an unhealthy-runtime failure");
  assert.match(blockReason, /re-route/i, "block reason should hint to re-route to a healthy agent");
}

// --- Scenario 4: first chat returns no final message; a retry recovers real output -> completes.
{
  let chatCount = 0;
  const result = await runQueenBeeAutonomousPickup({ task, delegation }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async (url, init) => {
      chatCount += 1;
      const body = JSON.parse(String(init.body));
      if (chatCount === 1) return { ok: true, text: "" }; // runtime returned no final message
      assert.match(body.message, /plain text|no final message/i, "the retry should use the concise fallback prompt");
      return { ok: true, text: "Recovered final answer." };
    },
    complete: async (slug, taskId, input) => {
      assert.equal(input.result, "Recovered final answer.");
      return { task: { ...task, status: "done", result: input.result }, board: {} };
    },
    block: async () => {
      throw new Error("block should not be called when the retry recovers output");
    },
  });
  assert.equal(result.status, "completed", "a recovered retry should complete the task");
  assert.equal(chatCount, 2, "exactly one retry should occur on an empty first response");
}

console.log("Queen Bee autonomous pickup + loop receipts contract test passed.");
