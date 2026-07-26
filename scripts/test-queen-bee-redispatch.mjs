#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Routing/pickup tests below must never fire real network pickups.
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

const {
  isRedispatchableReadyTask,
  prepareQueenBeeResumeChainContext,
  rebuildQueenBeeResumeChain,
  routePendingQueenBeeTasks,
} = await import("../src/lib/services/queen-bee/control-plane.ts");

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

// ── resume-chain rebuild (2026-07-26) ───────────────────────────────────────
// Recovery and answer-resume rebuild a REAL delegation chain against the
// current fleet, so judge-gated tasks can staff an independent reviewer — the
// old fabricated one-element chain ran the work, then parked at needs-human.
const resumeVault = await mkdtemp(join(tmpdir(), "hivemind-queen-resume-"));
const resumeOptions = { vaultPath: resumeVault, kanbanFolder: "Operations/Work Board" };
const fleetMachine = (key, name, agents) => ({
  key,
  collector: "ready",
  device: { name, online: true, collectorUrl: `http://${key}.local:8787`, dnsName: `${key}.tail.ts.net` },
  capabilities: { chat: true },
  agents,
});
const resumeFleet = [
  fleetMachine("mac-one", "Mac One", [
    { id: "grace-x1", name: "Grace Worker X1", runtime: "hermes", beeRole: "worker", workerClass: "code", model: "claude-fable-5", runtimeCapabilities: { chat: true } },
    { id: "ada-x1", name: "Ada Worker X1", runtime: "hermes", beeRole: "worker", workerClass: "code", model: "gpt-6", runtimeCapabilities: { chat: true } },
  ]),
  fleetMachine("linux-two", "Linux Two", [
    { id: "linus-x1", name: "Linus Reviewer X1", runtime: "hermes", beeRole: "worker", workerClass: "qa", runtimeCapabilities: { chat: true } },
  ]),
];

assert.equal(
  await prepareQueenBeeResumeChainContext({ fleetSnapshot: [], companyMembers: new Map(), ...resumeOptions }),
  null,
  "no discoverable fleet -> no context (callers degrade to the single known delegate)",
);

const resumeContext = await prepareQueenBeeResumeChainContext({ fleetSnapshot: resumeFleet, companyMembers: new Map(), ...resumeOptions });
assert.ok(resumeContext, "an injected fleet snapshot yields a rebuild context");

const strandedTask = {
  title: "Fix the checkout bug in the repo",
  body: "code work",
  skills: [],
  source: "queen-bee:test",
  assignee: "Ada Worker X1",
  targetMachine: { key: "mac-one", name: "Mac One", collectorUrl: "http://mac-one.local:8787" },
};
const rebuilt = rebuildQueenBeeResumeChain(strandedTask, resumeContext);
assert.ok(rebuilt.length >= 2, "the rebuilt chain carries real fallback/reviewer delegates, not one element");
assert.equal(rebuilt[0].agent?.name, "Ada Worker X1", "the previously-assigned agent stays first");
assert.equal(rebuilt[0].agent?.id, "ada-x1", "the head entry carries real fleet metadata (id/model), not a fabricated stub");
assert.ok(
  rebuilt.slice(1).some((delegation) => delegation.agent?.name !== "Ada Worker X1"),
  "an independent reviewer candidate exists behind the worker",
);

const machinePinned = rebuildQueenBeeResumeChain(
  { ...strandedTask, assignee: "Linus Reviewer X1", requestedMachine: "linux-two" },
  resumeContext,
);
assert.ok(machinePinned.length >= 1, "a machine-pinned task still rebuilds");
assert.ok(machinePinned.every((delegation) => delegation.machine?.key === "linux-two"), "a machine pin restricts the chain to the pinned machine");

const agentPinned = rebuildQueenBeeResumeChain(
  { ...strandedTask, assignee: "Grace Worker X1", requestedAgent: "grace-x1" },
  resumeContext,
);
assert.ok(agentPinned.length >= 1, "an agent-pinned task still rebuilds");
assert.ok(agentPinned.every((delegation) => delegation.agent?.id === "grace-x1"), "an agent pin restricts the chain to the pinned agent");

const ghostAssignee = rebuildQueenBeeResumeChain({ ...strandedTask, assignee: "Ghost Agent" }, resumeContext);
assert.equal(ghostAssignee[0]?.agent?.name, "Ghost Agent", "an unroutable assignee stays first as the known delegate");
assert.equal(ghostAssignee[0]?.machine?.device?.collectorUrl, "http://mac-one.local:8787", "the fabricated head keeps the recorded target machine");
assert.ok(ghostAssignee.length >= 2, "ranked fleet delegates follow the unroutable assignee as fallbacks/reviewers");

assert.deepEqual(
  rebuildQueenBeeResumeChain({ ...strandedTask, source: "company:co-x:r1" }, resumeContext),
  [],
  "a company task with unknown crew degrades (empty chain) rather than staffing outsiders",
);
const companyChain = rebuildQueenBeeResumeChain(
  { ...strandedTask, source: "company:co-x:r1", assignee: "Grace Worker X1" },
  { ...resumeContext, membersByCompany: new Map([["co-x", new Set(["grace-x1"])]]) },
);
assert.ok(companyChain.length >= 1, "a company task with known crew rebuilds");
assert.ok(companyChain.every((delegation) => delegation.agent?.id === "grace-x1"), "a company chain contains only crew members");

// ── pending sweep sees its OWN placements (2026-07-26) ──────────────────────
// Ranked against a frozen assignments snapshot, a burst of equal pending tasks
// all landed on the same top-ranked agent, then serialized behind its chat
// slot. The sweep now counts each placement before ranking the next task.
const { createTask, readBoard, blockTask } = await import("../src/lib/services/kanban/local-kanban-store.ts");
const uniq = Date.now().toString(36);
const agentA = `burst-a-${uniq}`;
const agentB = `burst-b-${uniq}`;
const sweepFleet = [{
  key: "sweep-machine",
  device: { name: "Sweep Machine", online: true, collectorUrl: "http://127.0.0.1:9/collector" },
  agents: [
    { id: agentA, name: agentA, runtime: "hermes" },
    { id: agentB, name: agentB, runtime: "hermes" },
  ],
}];
const burstOne = await createTask(null, {
  title: "General chore one", body: "queued burst work", status: "ready", priority: "normal",
  workspace: "scratch", assignee: "queen-bee", source: "queen-bee:burst", targetMachine: null,
}, resumeOptions);
const burstTwo = await createTask(null, {
  title: "General chore two", body: "queued burst work", status: "ready", priority: "normal",
  workspace: "scratch", assignee: "queen-bee", source: "queen-bee:burst", targetMachine: null,
}, resumeOptions);
await routePendingQueenBeeTasks(sweepFleet, { ...resumeOptions, now: Date.now() + 10 * 60_000, companyMembers: new Map() });
const sweepBoard = await readBoard(null, resumeOptions);
const firstAssignee = sweepBoard.tasks.find((task) => task.id === burstOne.task.id)?.assignee;
const secondAssignee = sweepBoard.tasks.find((task) => task.id === burstTwo.task.id)?.assignee;
assert.ok([agentA, agentB].includes(firstAssignee), "burst task one delegated to a fleet agent");
assert.ok([agentA, agentB].includes(secondAssignee), "burst task two delegated to a fleet agent");
assert.notEqual(firstAssignee, secondAssignee, "the sweep spreads a burst across equal agents instead of stacking one");

// ── answer-resume degrades (never blocks) when discovery is unavailable ─────
const { NextRequest } = await import("next/server");
const kanbanRoute = await import("../src/app/api/kanban/route.ts");
const answered = await (async () => {
  const created = await createTask(null, {
    title: "Judge-gated work", body: "resume with the same agent", status: "ready", priority: "normal",
    workspace: "scratch", assignee: "Resume Agent", source: "queen-bee:test",
    targetMachine: { key: "sweep-machine", name: "Sweep Machine", collectorUrl: "http://127.0.0.1:9/collector" },
  }, resumeOptions);
  await blockTask(null, created.task.id, "ACTION NEEDED: choose an option.", resumeOptions);
  const response = await kanbanRoute.POST(new NextRequest("http://127.0.0.1:9/api/kanban", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "answer", taskId: created.task.id, answer: "Proceed with option A.", ...resumeOptions }),
  }));
  return response.json();
})();
assert.equal(answered.ok, true, "answer-resume must not fail when fleet discovery is unavailable (degrade, don't block)");
assert.equal(answered.task.status, "ready", "the answered card returns to the dispatch queue");
assert.equal(answered.task.assignee, "Resume Agent", "answer-resume keeps the SAME agent");
assert.equal(answered.pickupScheduled, false, "autonomous pickup stays disabled in this hermetic run");

await rm(resumeVault, { recursive: true, force: true });

console.log("redispatch predicate tests passed");
