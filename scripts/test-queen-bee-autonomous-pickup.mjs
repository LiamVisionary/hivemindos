#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

// autonomous-worker.ts now statically imports the loop runner; register the TS loader.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  runQueenBeeAutonomousPickup,
  scheduleQueenBeeAutonomousPickup,
  shouldAutonomouslyPickupQueenBeeTask,
  pickupMachineKey,
  pickupChatTimeoutMs,
} = await import(
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

const fallbackDelegation = {
  status: "delegated",
  workerClass: "qa",
  agent: {
    id: "ada-lovelace",
    name: "Ada Lovelace",
    runtime: "hermes",
    workerClass: "qa",
    runtimeCapabilities: { chat: true },
  },
  machine: {
    key: "linux",
    collector: "http://collector-two.local:5055",
    device: {
      name: "Linux Box",
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
          assert.equal(url, "http://collector-two.local:5055/chat", "judge runs through a different delegate collector");
          assert.equal(body.agent.id, "ada-lovelace", "judge uses a different agent identity from the builder");
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
      reroute: async () => ({ task: { ...loopTask, status: "ready" }, board: {} }),
      fail: async () => ({ task: { ...loopTask, status: "needs-human" }, board: {}, retried: false }),
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
  const result = await runQueenBeeAutonomousPickup({ task: loopTask, delegation, delegationChain: [delegation, fallbackDelegation] }, deps);
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
  const result = await runQueenBeeAutonomousPickup({ task: loopTask, delegation, delegationChain: [delegation, fallbackDelegation] }, deps);
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

// --- Scenario 3b: an output that self-declares a human blocker lands as needs-human,
//     never as a completion (live 2026-07-06: a send batch blocked on a missing env
//     token finished "done", so no card ever pinged the human).
for (const askText of [
  "Reviewed prospects.\n\nACTION NEEDED: Set PORTFOLIO_OFFER_API_TOKEN in the shared env, then move this back to Ready.\nNEEDS: api-key PORTFOLIO_OFFER_API_TOKEN",
  "Blocked before prospect outreach. The required offer links are not live (offer API returned 401).",
]) {
  let blockReason = null;
  const result = await runQueenBeeAutonomousPickup({ task, delegation }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => ({ ok: true, text: askText }),
    complete: async () => {
      throw new Error("complete must not run when the agent asked for human input");
    },
    block: async (slug, taskId, reason) => {
      blockReason = reason;
      return { task: { ...task, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(result.status, "blocked", "a self-declared human blocker must land needs-human");
  assert.equal(blockReason, askText, "the agent's own ask text becomes the card");
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

// --- Scenario 5: first eligible worker fails; autonomous pickup reroutes to the next
//     eligible worker instead of immediately moving the card to needs-human.
{
  const calls = [];
  const result = await runQueenBeeAutonomousPickup({
    task,
    delegation,
    delegationChain: [delegation, fallbackDelegation],
  }, {
    claim: async (slug, taskId, input) => {
      calls.push({ kind: "claim", assignee: input.assignee });
      assert.equal(taskId, task.id);
      return {
        task: {
          ...task,
          status: "working",
          assignee: input.assignee,
          targetMachine: input.assignee === "Ada Lovelace"
            ? { key: "linux", name: "Linux Box", collectorUrl: "http://collector-two.local:5055" }
            : task.targetMachine,
          claimLock: input.claimer,
          currentRunId: `r_${calls.length}`,
        },
        board: {},
      };
    },
    fetchJson: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ kind: "chat", url, agent: body.agent.name });
      if (body.agent.name === "Grace Hopper") throw new Error("Bad Gateway");
      assert.equal(url, "http://collector-two.local:5055/chat");
      return { ok: true, text: "Ada completed after reroute." };
    },
    complete: async (slug, taskId, input) => {
      calls.push({ kind: "complete", result: input.result });
      assert.equal(input.result, "Ada completed after reroute.");
      return { task: { ...task, status: "done", assignee: "Ada Lovelace", result: input.result }, board: {} };
    },
    reroute: async (slug, taskId, input) => {
      calls.push({ kind: "reroute", input });
      assert.equal(taskId, task.id);
      assert.match(input.reason, /Bad Gateway/);
      assert.equal(input.failedAgentName, "Grace Hopper");
      assert.equal(input.nextAssignee, "Ada Lovelace");
      assert.equal(input.targetMachine.collectorUrl, "http://collector-two.local:5055");
      return {
        task: {
          ...task,
          status: "ready",
          assignee: "Ada Lovelace",
          targetMachine: input.targetMachine,
          result: input.reason,
        },
        board: {},
      };
    },
    block: async () => {
      throw new Error("block should not be called while an eligible fallback agent exists");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.agentName, "Ada Lovelace");
  assert.deepEqual(calls.map((call) => call.kind), ["claim", "chat", "reroute", "claim", "chat", "complete"]);
}

// --- Scenario 5b: a chain that fails ONLY on transient transport errors (client
//     timeout + collector 502) auto-retries via failTask instead of stranding the
//     company task on a human (the hel1-2 pile-up left a real task blocked ~16h).
{
  const calls = [];
  let failInput = null;
  const result = await runQueenBeeAutonomousPickup({
    task,
    delegation,
    delegationChain: [delegation, fallbackDelegation],
  }, {
    claim: async (slug, taskId, input) => {
      calls.push("claim");
      return { task: { ...task, status: "working", assignee: input.assignee, claimLock: input.claimer }, board: {} };
    },
    fetchJson: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push("chat");
      if (body.agent.name === "Grace Hopper") throw new Error("The operation was aborted due to timeout");
      throw new Error("Bad Gateway");
    },
    reroute: async (slug, taskId, input) => {
      calls.push("reroute");
      return { task: { ...task, status: "ready", assignee: "Ada Lovelace", targetMachine: input.targetMachine }, board: {} };
    },
    complete: async () => { throw new Error("complete should not run when every delegate fails"); },
    block: async () => { throw new Error("a transient-only exhaustion must NOT block to needs-human"); },
    fail: async (slug, taskId, input) => {
      failInput = input;
      return { task: { ...task, status: "ready", attempt: 2 }, board: {}, retried: true };
    },
  });
  assert.equal(result.status, "skipped", "a transient-only chain should auto-retry (skipped), not block");
  assert.equal(failInput?.failureReason, "timeout", "transient exhaustion should fail with the retryable 'timeout' reason");
  // The trailing reroute is the queen takeover (2026-07-18): after the retried
  // failTask, the task is re-pointed at the transient-failed delegate so the
  // next sweep runs it directly instead of re-burning the whole chain.
  assert.deepEqual(calls, ["claim", "chat", "reroute", "claim", "chat", "reroute"]);
}

// --- Scenario 5c: a transient-only exhaustion whose retry budget is spent →
//     failTask escalates to needs-human (retried:false) and the pickup reports blocked.
{
  let failCalled = false;
  const result = await runQueenBeeAutonomousPickup({ task, delegation }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => { throw new Error("The operation was aborted due to timeout"); },
    complete: async () => { throw new Error("complete should not run"); },
    reroute: async () => { throw new Error("reroute should not run with a single delegate"); },
    block: async () => { throw new Error("block should not be called when routing through failTask"); },
    fail: async (slug, taskId, input) => {
      failCalled = true;
      assert.equal(input.failureReason, "timeout");
      return { task: { ...task, status: "needs-human", result: input.summary }, board: {}, retried: false };
    },
  });
  assert.equal(failCalled, true, "transient exhaustion should route through failTask");
  assert.equal(result.status, "blocked", "an exhausted-retry transient failure should report blocked (needs-human)");
}

// --- Scenario 5d: a chain mixing a transient error with a REAL failure (no output)
//     must still escalate — the transient auto-retry only fires when EVERY delegate
//     failed on transport, so a genuine problem is never silently spun on.
{
  let blockCalled = false;
  const result = await runQueenBeeAutonomousPickup({
    task,
    delegation,
    delegationChain: [delegation, fallbackDelegation],
  }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", assignee: input.assignee, claimLock: input.claimer }, board: {} }),
    fetchJson: async (url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.agent.name === "Grace Hopper") throw new Error("The operation was aborted due to timeout");
      return { ok: true, text: "   " }; // Ada returns no usable output → a real failure
    },
    reroute: async (slug, taskId, input) => ({ task: { ...task, status: "ready", assignee: "Ada Lovelace", targetMachine: input.targetMachine }, board: {} }),
    complete: async () => { throw new Error("complete should not run for empty output"); },
    fail: async () => { throw new Error("a mixed chain must NOT route through the transient retry"); },
    block: async (slug, taskId, reason) => {
      blockCalled = true;
      return { task: { ...task, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(blockCalled, true, "a mixed chain (transient + real) must block to needs-human");
  assert.equal(result.status, "blocked");
}

// --- Scenario 5e: claim race — another dispatcher already holds the task, so the
//     losing pickup must back off entirely: no reroute (it would steal the winner's
//     claim), no block, no retry-attempt burn (WEBS interleaving, 2026-07-05).
{
  const result = await runQueenBeeAutonomousPickup({
    task,
    delegation,
    delegationChain: [delegation, fallbackDelegation],
  }, {
    claim: async () => { throw new Error("Task is not ready to claim."); },
    fetchJson: async () => { throw new Error("chat must not run when the claim lost the race"); },
    complete: async () => { throw new Error("complete must not run when the claim lost the race"); },
    reroute: async () => { throw new Error("reroute must not run — it would steal the other worker's claim"); },
    block: async () => { throw new Error("a claim race must not block the task to needs-human"); },
    fail: async () => { throw new Error("a claim race must not consume a retry attempt"); },
  });
  assert.equal(result.status, "skipped", "losing a claim race should skip, not escalate");
  assert.match(result.error, /another dispatcher/i);
}

// --- Scenario 5f: reroute conflict — a delegate fails, but before the reroute lands
//     another dispatcher claims the task. The store refuses to clobber the live claim
//     and the pickup backs off instead of fighting it.
{
  let blockCalled = false;
  const result = await runQueenBeeAutonomousPickup({
    task,
    delegation,
    delegationChain: [delegation, fallbackDelegation],
  }, {
    claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => { throw new Error("The operation was aborted due to timeout"); },
    reroute: async (slug, taskId, input) => {
      assert.match(input.failedClaimLock, /^queen-bee-autonomous:/, "reroute must carry the failing run's claim lock");
      throw new Error("Task is claimed by another worker; refusing to reroute over a live claim.");
    },
    complete: async () => { throw new Error("complete must not run"); },
    block: async () => {
      blockCalled = true;
      return { task: { ...task, status: "needs-human" }, board: {} };
    },
    fail: async () => { throw new Error("a reroute conflict must not consume a retry attempt"); },
  });
  assert.equal(result.status, "skipped", "a reroute conflict should back off, not escalate");
  assert.equal(blockCalled, false, "a reroute conflict must leave the board to the claim's owner");
  assert.match(result.error, /another worker claimed/i);
}

// --- Scenario 5g: a chain mixing machine-capacity skips with transport failures is
//     100% infrastructure and must auto-retry via failTask — NOT strand on a human.
//     (Live 2026-07-05, WEBS t_mr7nmkl4_vr67n: 2 capacity + 4 transport lines escalated
//     because capacity lines failed the transport-only transient regex.)
{
  process.env.QUEEN_BEE_MACHINE_SLOT_WAIT_MS = "0";
  try {
    // Saturate machine "mac" with a held chat so the chain's first delegate skips on capacity.
    let releaseHeldChat = () => {};
    const heldChat = new Promise((resolve) => { releaseHeldChat = resolve; });
    const holder = runQueenBeeAutonomousPickup({ task: { ...task, id: "t_mixed_hold" }, delegation }, {
      claim: async (slug, taskId, input) => ({ task: { ...task, id: "t_mixed_hold", status: "working", claimLock: input.claimer }, board: {} }),
      fetchJson: async () => { await heldChat; return { ok: true, text: "held done" }; },
      complete: async (slug, taskId, input) => ({ task: { ...task, id: "t_mixed_hold", status: "done", result: input.result }, board: {} }),
      block: async () => { throw new Error("holder must not block"); },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    let failInput = null;
    const result = await runQueenBeeAutonomousPickup({
      task: { ...task, id: "t_mixed_chain" },
      delegation,
      delegationChain: [delegation, fallbackDelegation],
    }, {
      claim: async (slug, taskId, input) => ({ task: { ...task, id: "t_mixed_chain", status: "working", assignee: input.assignee, claimLock: input.claimer }, board: {} }),
      fetchJson: async () => { throw new Error("The operation was aborted due to timeout"); },
      reroute: async () => { throw new Error("reroute should not run — the capacity skip advances the chain itself"); },
      complete: async () => { throw new Error("complete must not run"); },
      block: async () => { throw new Error("a capacity+transport chain is pure infrastructure and must NOT block to needs-human"); },
      fail: async (slug, taskId, input) => {
        failInput = input;
        return { task: { ...task, id: "t_mixed_chain", status: "ready", attempt: 2 }, board: {}, retried: true };
      },
    });
    assert.equal(result.status, "skipped", "a capacity+transport chain should auto-retry (skipped)");
    assert.equal(failInput?.failureReason, "timeout", "mixed infra exhaustion routes through the retryable 'timeout' reason");
    assert.match(failInput?.summary ?? "", /capacity/i, "the capacity line is preserved in the failure record");
    releaseHeldChat();
    assert.equal((await holder).status, "completed");
  } finally {
    delete process.env.QUEEN_BEE_MACHINE_SLOT_WAIT_MS;
  }
}

// --- Scenario 6: per-machine concurrency gate — two simultaneous pickups targeting the
//     same machine must serialize their collector chats (default cap: 1 per machine),
//     instead of starving each other on a small box (hel1-2 pile-up, 2026-07-03).
{
  let inFlight = 0;
  let maxInFlight = 0;
  const gateDeps = (id) => ({
    claim: async (slug, taskId, input) => ({ task: { ...task, id, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return { ok: true, text: "gated done" };
    },
    complete: async (slug, taskId, input) => ({ task: { ...task, id, status: "done", result: input.result }, board: {} }),
    block: async () => {
      throw new Error("block should not be called on successful gated pickups");
    },
  });
  const [first, second] = await Promise.all([
    runQueenBeeAutonomousPickup({ task: { ...task, id: "t_gate_a" }, delegation }, gateDeps("t_gate_a")),
    runQueenBeeAutonomousPickup({ task: { ...task, id: "t_gate_b" }, delegation }, gateDeps("t_gate_b")),
  ]);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(maxInFlight, 1, "chats to one machine must be serialized by the per-machine gate");
}

// --- Scenario 7: a machine at capacity with slot wait exhausted → the pickup SKIPS
//     (task stays ready for the next dispatch sweep) instead of blocking to needs-human.
{
  process.env.QUEEN_BEE_MACHINE_SLOT_WAIT_MS = "0";
  try {
    let releaseHeldChat = () => {};
    const heldChat = new Promise((resolve) => {
      releaseHeldChat = resolve;
    });
    const holder = runQueenBeeAutonomousPickup({ task: { ...task, id: "t_gate_hold" }, delegation }, {
      claim: async (slug, taskId, input) => ({ task: { ...task, id: "t_gate_hold", status: "working", claimLock: input.claimer }, board: {} }),
      fetchJson: async () => {
        await heldChat;
        return { ok: true, text: "held done" };
      },
      complete: async (slug, taskId, input) => ({ task: { ...task, id: "t_gate_hold", status: "done", result: input.result }, board: {} }),
      block: async () => {
        throw new Error("block should not be called for the slot holder");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 25)); // let the holder take the machine slot
    let blocked = false;
    const skipped = await runQueenBeeAutonomousPickup({ task: { ...task, id: "t_gate_skip" }, delegation }, {
      claim: async () => {
        throw new Error("claim must not run while the machine is saturated");
      },
      fetchJson: async () => {
        throw new Error("chat must not run while the machine is saturated");
      },
      complete: async () => {
        throw new Error("complete must not run while the machine is saturated");
      },
      block: async () => {
        blocked = true;
        return { task: { ...task, id: "t_gate_skip", status: "needs-human" }, board: {} };
      },
    });
    assert.equal(skipped.status, "skipped", "a capacity-only miss should skip, not block");
    assert.equal(blocked, false, "a capacity skip must leave the task ready (no needs-human)");
    assert.match(skipped.error, /capacity/i);
    releaseHeldChat();
    assert.equal((await holder).status, "completed");
  } finally {
    delete process.env.QUEEN_BEE_MACHINE_SLOT_WAIT_MS;
  }
}

// --- Scenario 8: schedule dedupe — a task with an in-flight pickup is not double-scheduled
//     (pickups can now wait on a machine slot while their task is still "ready", so the
//     driver's 5-minute re-dispatch sweep would otherwise double-run it).
{
  const schedTask = { ...task, id: "t_sched_dedupe" };
  let completions = 0;
  let notifyCompletion = () => {};
  const completed = (count) => new Promise((resolve) => {
    notifyCompletion = () => {
      if (completions >= count) resolve();
    };
    notifyCompletion();
  });
  const schedDeps = {
    claim: async (slug, taskId, input) => ({ task: { ...schedTask, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => ({ ok: true, text: "scheduled done" }),
    complete: async (slug, taskId, input) => {
      completions += 1;
      notifyCompletion();
      return { task: { ...schedTask, status: "done", result: input.result }, board: {} };
    },
    block: async () => {
      throw new Error("block should not be called for the scheduled pickup");
    },
  };
  assert.equal(scheduleQueenBeeAutonomousPickup({ task: schedTask, delegation }, schedDeps), true);
  assert.equal(
    scheduleQueenBeeAutonomousPickup({ task: schedTask, delegation }, schedDeps),
    false,
    "a task with an in-flight pickup must not be scheduled again",
  );
  await completed(1);
  await new Promise((resolve) => setTimeout(resolve, 10)); // let the finally clear the in-flight registry
  assert.equal(
    scheduleQueenBeeAutonomousPickup({ task: schedTask, delegation }, schedDeps),
    true,
    "a finished pickup frees the task for re-scheduling",
  );
  await completed(2);
}

// --- Scenario 9: machine identity — named machine wins; peer-proxy URLs resolve to the
//     REMOTE peer (not the local :8788 proxy); plain URLs fall back to their host.
{
  assert.equal(pickupMachineKey(delegation, "http://collector.local:5055"), "mac");
  assert.equal(
    pickupMachineKey({ status: "delegated" }, "http://127.0.0.1:8788/peer/100.64.0.9%3A8787/chat"),
    "100.64.0.9:8787",
    "peer-proxy URLs must gate on the remote peer identity",
  );
  assert.equal(pickupMachineKey({ status: "delegated" }, "http://ubuntu-box:8787"), "ubuntu-box:8787");
}

// --- Scenario 10: real-store reroute guard — rerouteTaskForAutonomousPickup must
//     refuse to clobber a DIFFERENT run's live claim, but still allow the claim
//     holder itself (and legacy callers that pass no lock) to reroute.
{
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createTask, claimTask, rerouteTaskForAutonomousPickup } = await import("../src/lib/services/kanban/local-kanban-store.ts");
  const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-pickup-reroute-guard-"));
  const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
  try {
    const { task: created } = await createTask(null, { title: "Guarded reroute", status: "ready" }, options);
    await claimTask(null, created.id, { claimer: "queen-bee-autonomous:guard:winner:1" }, options);

    await assert.rejects(
      rerouteTaskForAutonomousPickup(null, created.id, {
        reason: "loser run rerouting after a lost race",
        nextAssignee: "Ada Lovelace",
        failedClaimLock: "queen-bee-autonomous:guard:loser:1",
      }, options),
      /claimed by another worker/i,
      "a reroute carrying a different run's lock must be refused",
    );

    const { task: rerouted } = await rerouteTaskForAutonomousPickup(null, created.id, {
      reason: "claim holder rerouting its own failed delegate",
      nextAssignee: "Grace Hopper",
      failedClaimLock: "queen-bee-autonomous:guard:winner:1",
    }, options);
    assert.equal(rerouted.status, "ready", "the claim holder's own reroute must still work");
    assert.equal(rerouted.assignee, "Grace Hopper");

    await claimTask(null, created.id, { claimer: "queen-bee-autonomous:guard:winner:2" }, options);
    const { task: legacyRerouted } = await rerouteTaskForAutonomousPickup(null, created.id, {
      reason: "legacy caller with no lock",
      nextAssignee: "Ada Lovelace",
    }, options);
    assert.equal(legacyRerouted.status, "ready", "callers that pass no lock keep the old behavior");
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
}

// --- Scenario 11: long-task duration contract — the chat timeout honors the task's
//     own maxRuntimeMs (company tasks legitimately run 30+ minutes; the old fixed
//     240s default amputated them mid-work, live 2026-07-05).
{
  assert.equal(pickupChatTimeoutMs({ maxRuntimeMs: 45 * 60_000 }), 45 * 60_000, "task maxRuntimeMs is the chat duration contract");
  assert.equal(pickupChatTimeoutMs({}), 30 * 60_000, "no task contract → 30 min default, never a 240s amputation");
  process.env.QUEEN_BEE_AUTONOMOUS_CHAT_TIMEOUT_MS = "5000";
  try {
    assert.equal(pickupChatTimeoutMs({ maxRuntimeMs: 999_999 }), 5000, "operator env override wins over everything");
  } finally {
    delete process.env.QUEEN_BEE_AUTONOMOUS_CHAT_TIMEOUT_MS;
  }
}

// --- Scenario 12: a long-running chat heartbeats its claim so the stale-claim
//     reclaim never sweeps an actively-working pickup (the reclaim-stall class).
{
  process.env.QUEEN_BEE_PICKUP_HEARTBEAT_MS = "20";
  try {
    const beats = [];
    const result = await runQueenBeeAutonomousPickup({ task, delegation }, {
      claim: async (slug, taskId, input) => ({ task: { ...task, status: "working", claimLock: input.claimer }, board: {} }),
      heartbeat: async (slug, taskId, note, claimLock) => { beats.push(claimLock); },
      fetchJson: async () => {
        await new Promise((resolve) => setTimeout(resolve, 130));
        return { ok: true, text: "slow but real work" };
      },
      complete: async (slug, taskId, input) => ({ task: { ...task, status: "done", result: input.result }, board: {} }),
      block: async () => { throw new Error("block should not be called for a slow-but-successful chat"); },
    });
    assert.equal(result.status, "completed");
    assert(beats.length >= 2, `long chats must heartbeat the claim while in flight (got ${beats.length})`);
    assert(beats.every((lock) => /^queen-bee-autonomous:/.test(lock)), "heartbeats carry the run's claim lock");
  } finally {
    delete process.env.QUEEN_BEE_PICKUP_HEARTBEAT_MS;
  }
}

console.log("Queen Bee autonomous pickup + loop receipts contract test passed.");
