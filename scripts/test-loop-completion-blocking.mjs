#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildLoopFromTemplate } = await import("../src/lib/services/loops/index.ts");
const { claimTask, completeTask, createTask, readBoard } = await import(
  "../src/lib/services/kanban/local-kanban-store.ts"
);

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-loop-block-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const boardSlug = "loop-block";

const WORKER_OUTPUT = [
  "I completed the research on the loop system and documented the recency-bias finding.",
  "Deliverable: /Users/liam/out/loop-report.md",
  "Verification: traced the call chain and confirmed the cause with file:line references.",
].join("\n");

try {
  const loop = buildLoopFromTemplate({
    templateId: "research", // required gates: receipt:evidence + agent:judge
    goal: "Investigate the loop routing regression.",
  });

  const created = await createTask(
    boardSlug,
    {
      title: "Loop gate preservation test",
      body: "Investigate and report with evidence.",
      status: "ready",
      priority: "normal",
      workspace: "scratch",
      loop,
    },
    options,
  );
  const taskId = created.task.id;

  // The stored loop is normalized; read back the real required gate ids.
  const storedLoop = created.task.loop;
  assert(storedLoop, "task should carry a loop");
  const requiredGateIds = storedLoop.evalGates.filter((gate) => gate.required).map((gate) => gate.id);
  assert(requiredGateIds.length >= 2, "research loop should have at least 2 required gates");

  await claimTask(boardSlug, taskId, { assignee: "Octavia Butler", claimer: "loop-block-claim", runtime: "test" }, options);

  // 1. Complete with NO passing receipts → must block, but PRESERVE the worker output.
  const blocked = await completeTask(
    boardSlug,
    taskId,
    { summary: "Queen Bee autonomous pickup completed by Octavia Butler.", result: WORKER_OUTPUT, loopReceipts: [] },
    options,
  );
  assert.equal(blocked.blocked, true, "missing required receipts should block completion");
  assert.equal(blocked.task.status, "needs-human", "blocked task should move to needs-human");
  assert(blocked.task.result.includes("loop-report.md"), "worker output must be PRESERVED in the blocked result, not discarded");
  assert(blocked.task.result.includes("traced the call chain"), "the verification detail must survive the block");
  assert(/loop gate block/i.test(blocked.task.result), "blocked result should explain the missing gates");
  assert(
    (blocked.task.deliverables ?? []).some((d) => (d.path ?? d.url ?? "").includes("loop-report.md")),
    "artifacts must be extracted even when blocked",
  );

  // 2. Now attach passing receipts for every required gate → completes.
  const receipts = requiredGateIds.map((gateId, index) => ({
    gateId,
    status: "passed",
    summary: `Gate ${gateId} satisfied`,
    evidence: [`evidence for ${gateId}`],
    createdAt: 1_800_000_000_000 + index,
  }));
  const done = await completeTask(
    boardSlug,
    taskId,
    { summary: "Re-completed with receipts.", result: WORKER_OUTPUT, loopReceipts: receipts },
    options,
  );
  assert.equal(done.task.status, "done", "task with all required gate receipts should complete");
  assert(!done.blocked, "completion should not be blocked once receipts are present");
  assert(done.task.result.includes("loop-report.md"), "completed result still carries the worker output");

  // 3. Receipts applied to the loop gate statuses are visible on the done task.
  const board = await readBoard(boardSlug, options);
  const finalTask = board.tasks.find((t) => t.id === taskId);
  assert.equal(finalTask.status, "done");
  const passedGates = (finalTask.loop?.evalGates ?? []).filter((gate) => gate.status === "passed");
  assert(passedGates.length >= requiredGateIds.length, "required gates should show as passed after receipts applied");

  console.log("loop completion blocking + preservation tests passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
