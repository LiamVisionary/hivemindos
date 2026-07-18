#!/usr/bin/env node
// Hermetic coverage for the driver's infra-rescue sweep (queen-bee/infra-rescue.ts):
// needs-human tasks stranded by infrastructure-ONLY pickup failures are re-queued
// through the answer rail once their target collector is healthy — with a fresh
// attempt budget, a bounded rescue count, and no touch on genuine human asks.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { rescueInfraStrandedTasks, isInfrastructureOnlyExhaustion, isInfraStrandedResult, INFRA_RESCUE_MARKER } = await import("../src/lib/services/queen-bee/infra-rescue.ts");
const { createTask, claimTask, blockTask, completeTask, patchTask, readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const INFRA_RESULT = [
  "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
  "Failures:",
  '- HermesMain: machine "this mac" is at its autonomous chat capacity',
  "- Grace Hopper: The operation was aborted due to timeout",
  "- Octavia Butler: 502 Bad Gateway: hivemind-linkd proxy error: EOF",
  "ACTION NEEDED: Review the delegate failures above.",
].join("\n");

// "No final response" is a runtime flake (the tool loop ended without emitting
// text — the work never got a real attempt), reclassified as infrastructure on
// 2026-07-16 after 57 live WEBS tasks stranded on it at attempt 1/3. A chain
// containing it now rescues like any transport failure.
const NO_OUTPUT_RESULT = [
  "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
  "Failures:",
  "- Grace Hopper: The operation was aborted due to timeout",
  '- Ada Lovelace: Agent "Ada Lovelace" returned no final response after a retry',
  "ACTION NEEDED: Review the delegate failures above.",
].join("\n");

// A genuine content/config failure — the work or the agent's configuration is
// wrong, and no retry fixes it. This must always stay with the human.
const CONTENT_RESULT = [
  "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
  "Failures:",
  "- Grace Hopper: The operation was aborted due to timeout",
  "- HermesAgent01: The agent's selected model (venice / venice-uncensored-role-play) cannot run on this machine's hermes config: Unknown provider 'venice'.",
  "ACTION NEEDED: Review the delegate failures above.",
].join("\n");

// Stale-claim reclaim stranding: the claimed run's host process died (server
// restart) — the reclaim's exact needs-human format (live t_mr7nml51_xvj4a).
const RECLAIM_RESULT = "Reclaimed after 3824s without worker progress. Failure reason: timeout. Attempts: 3/3.";

// Single-delegate strandings carry a one-line result instead of the exhausted
// format — the shape of 74 of WEBS's 115 needs-human tasks on 2026-07-16.
const SINGLE_NO_OUTPUT_RESULT =
  "Queen Bee autonomous pickup failed for HermesMain: hermes -z: no final response was produced; treating the run as failed.";
const SINGLE_TIMEOUT_RESULT =
  "Queen Bee autonomous pickup failed for Grace Hopper: The operation was aborted due to timeout";
const SINGLE_CONTENT_RESULT =
  "Queen Bee autonomous pickup failed for HermesMain: hermes -z: agent failed: Unknown provider 'venice'. Check 'hermes model' for available providers.";

// ── Classifier unit checks ───────────────────────────────────────────────────
assert.equal(isInfrastructureOnlyExhaustion(INFRA_RESULT), true, "capacity + transport = infrastructure-only");
assert.equal(isInfrastructureOnlyExhaustion(NO_OUTPUT_RESULT), true, "no-final-response is a runtime flake — retry, don't page the human");
assert.equal(isInfrastructureOnlyExhaustion(CONTENT_RESULT), false, "a config/content failure makes the chain a real failure");
assert.equal(isInfrastructureOnlyExhaustion("ACTION NEEDED: Provide the STRIPE_API_KEY."), false, "genuine human asks are untouched");
assert.equal(isInfrastructureOnlyExhaustion(undefined), false);
assert.equal(isInfraStrandedResult(RECLAIM_RESULT), true, "a stale-claim reclaim stranding is infrastructure");
assert.equal(isInfraStrandedResult("Reclaimed after 100s without worker progress. Failure reason: agent-error. Attempts: 3/3."), false, "non-infra reclaim reasons are not rescued");
assert.equal(isInfraStrandedResult(CONTENT_RESULT), false, "content failures stay with the human");
assert.equal(isInfraStrandedResult(SINGLE_NO_OUTPUT_RESULT), true, "single-delegate no-final-response stranding is rescueable");
assert.equal(isInfraStrandedResult(SINGLE_TIMEOUT_RESULT), true, "single-delegate timeout stranding is rescueable");
assert.equal(isInfraStrandedResult(SINGLE_CONTENT_RESULT), false, "single-delegate config failures stay with the human");

// ── Behavioral checks against the real store in a temp vault ────────────────
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-infra-rescue-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const MACHINE = { key: "this-mac", name: "This Mac", collectorUrl: "http://127.0.0.1:8787" };

async function seedBlocked(title, result, { rescues = 0, rescueAgeMs = 60_000, targetMachine = MACHINE } = {}) {
  // Mirror answerHumanTask's stamp header — the budget counts THESE, per rolling 24h.
  const bodyStamps = Array.from({ length: rescues }, () =>
    `— Automatic rescue (${new Date(Date.now() - rescueAgeMs).toISOString()}) —\n${INFRA_RESCUE_MARKER}: earlier rescue.`,
  ).join("\n");
  const { task } = await createTask(null, {
    title,
    body: `Do the thing.${bodyStamps ? `\n\n${bodyStamps}` : ""}`,
    status: "ready",
    targetMachine,
    maxAttempts: 3,
  }, options);
  await claimTask(null, task.id, { claimer: `test:${task.id}` }, options);
  await blockTask(null, task.id, result, options);
  return task.id;
}

try {
  const infraId = await seedBlocked("Infra-stranded task", INFRA_RESULT);
  const reclaimId = await seedBlocked("Reclaim-stalled task", RECLAIM_RESULT);
  const contentId = await seedBlocked("Real failure task", CONTENT_RESULT);
  const spentId = await seedBlocked("Rescue budget spent", INFRA_RESULT, { rescues: 3 });
  const staleSpentId = await seedBlocked("Old rescues expired", INFRA_RESULT, { rescues: 3, rescueAgeMs: 25 * 60 * 60 * 1000 });
  const noMachineId = await seedBlocked("No target machine", INFRA_RESULT, { targetMachine: null });

  // 1) Healthy collector → only the eligible infra tasks are rescued.
  const probed = [];
  const sweep = await rescueInfraStrandedTasks({
    probeHealth: async (url) => { probed.push(url); return true; },
    vaultPath, kanbanFolder: "Operations/Work Board",
  });
  assert.deepEqual(sweep.rescued.map((r) => r.taskId).sort(), [infraId, reclaimId, staleSpentId].sort(), "exhaustion + reclaim-stall strandings are rescued; a budget spent >24h ago has rolled off");
  assert.equal(sweep.skipped, 2, "recent-budget-spent + machine-less candidates are skipped (content failure is not a candidate)");
  assert.deepEqual(probed, [MACHINE.collectorUrl], "one health probe per distinct collector");
  const reclaimBoard = await readBoard(null, options);
  assert.equal(reclaimBoard.tasks.find((t) => t.id === reclaimId).status, "ready", "reclaim-stalled task is back in the queue");

  const board = await readBoard(null, options);
  const rescuedTask = board.tasks.find((t) => t.id === infraId);
  assert.equal(rescuedTask.status, "ready", "rescued task is back in the queue");
  assert.equal(rescuedTask.attempt, 1, "rescue restores the attempt budget");
  assert.match(rescuedTask.body, new RegExp(INFRA_RESCUE_MARKER), "rescue stamps its marker into the body");
  assert.match(rescuedTask.body, /Automatic rescue/, "the body stamp is honest about being automatic, not a human answer");
  assert.equal(board.tasks.find((t) => t.id === contentId).status, "needs-human", "real failures stay with the human");
  assert.equal(board.tasks.find((t) => t.id === spentId).status, "needs-human", "rescue budget caps ping-pong");
  assert.equal(board.tasks.find((t) => t.id === noMachineId).status, "needs-human", "no collector to verify → no rescue");

  // 2) Collector still down → nothing moves.
  const downId = await seedBlocked("Machine still down", INFRA_RESULT);
  const downSweep = await rescueInfraStrandedTasks({
    probeHealth: async () => false,
    vaultPath, kanbanFolder: "Operations/Work Board",
  });
  assert.equal(downSweep.rescued.length, 0, "an unhealthy collector rescues nothing");
  const downBoard = await readBoard(null, options);
  assert.equal(downBoard.tasks.find((t) => t.id === downId).status, "needs-human");

  // 3) Kill switch.
  process.env.HIVEMINDOS_COMPANY_INFRA_RESCUE = "0";
  try {
    const killed = await rescueInfraStrandedTasks({ probeHealth: async () => true, vaultPath, kanbanFolder: "Operations/Work Board" });
    assert.equal(killed.rescued.length, 0, "HIVEMINDOS_COMPANY_INFRA_RESCUE=0 disables the sweep");
  } finally {
    delete process.env.HIVEMINDOS_COMPANY_INFRA_RESCUE;
  }

  // ── Completion integrity: a result byte-identical to ANOTHER task's result is a
  // misattributed session output (live: Bankr wallet dumps stamped on 3 tasks at
  // once, twice) and must be rejected on every completion path.
  {
    const DUMP = `**Bankr read complete** · Wallet portfolio\n${JSON.stringify({ success: true, balances: { fake: true } })}\n`.padEnd(300, "x");
    const { task: first } = await createTask(null, { title: "Legit first task", status: "ready", maxAttempts: 3 }, options);
    await claimTask(null, first.id, { claimer: "test:first" }, options);
    await completeTask(null, first.id, { result: DUMP }, options);

    const { task: second } = await createTask(null, { title: "Victim task", status: "ready", maxAttempts: 3 }, options);
    await claimTask(null, second.id, { claimer: "test:second" }, options);
    await assert.rejects(
      completeTask(null, second.id, { result: DUMP }, options),
      /misattributed session output/i,
      "completeTask rejects a duplicate substantial result",
    );
    await assert.rejects(
      patchTask(null, second.id, { status: "done", result: DUMP }, options),
      /misattributed session output/i,
      "patch-to-done rejects a duplicate substantial result",
    );
    const guardBoard = await readBoard(null, options);
    assert.equal(guardBoard.tasks.find((t) => t.id === second.id).status, "working", "the victim task stays claimed for an honest attempt");
    // Distinct substantial results and short identical ones still complete fine.
    await completeTask(null, second.id, { result: `${DUMP} — but genuinely different content for task two.` }, options);
    assert.equal((await readBoard(null, options)).tasks.find((t) => t.id === second.id).status, "done");
  }

  console.log("infra-rescue: all assertions passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
