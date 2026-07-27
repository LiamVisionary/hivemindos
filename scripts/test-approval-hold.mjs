#!/usr/bin/env node
// Hermetic test for the sticky-hold ("park a needs-human task") primitive:
//  - holdTask stamps `held` and KEEPS status needs-human (nothing re-routes it)
//  - answerHumanTask clears `held` and flips to ready
//  - countCompanyWaitingOnHuman EXCLUDES held tasks (so a parked pile can't wedge
//    the company at paused), and HIVEMINDOS_APPROVAL_HOLD=0 restores counting.
// Node >= 22.6 native TS type-stripping via the shared ts-relative-loader.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-approval-hold-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-approval-hold-vault-"));
process.env.HOME = tempHome;

const { countCompanyWaitingOnHuman } = await import("../src/lib/services/company-autonomy-driver.ts");
const { createTask, blockTask, answerHumanTask, readBoard } = await import(
  "../src/lib/services/kanban/local-kanban-store.ts"
);
const { holdTask, clearHold } = await import("../src/lib/services/kanban/task-hold.ts");

const kanbanOptions = { vaultPath, kanbanFolder: "Operations/Work Board" };

try {
  // ── countCompanyWaitingOnHuman excludes held tasks ────────────────────────
  const tasks = [
    { status: "needs-human", source: "company:co-one:r1" },
    { status: "needs-human", source: "company:co-one:r2" },
    { status: "needs-human", source: "company:co-one:r3", held: { at: 1, by: "dashboard" } },
    { status: "done", source: "company:co-one:r4" },
  ];
  assert.equal(
    countCompanyWaitingOnHuman(tasks, "co-one"),
    2,
    "a held needs-human task is excluded from the waiting count",
  );
  // Kill switch restores counting the held one.
  process.env.HIVEMINDOS_APPROVAL_HOLD = "0";
  assert.equal(
    countCompanyWaitingOnHuman(tasks, "co-one"),
    3,
    "HIVEMINDOS_APPROVAL_HOLD=0 counts held tasks again",
  );
  delete process.env.HIVEMINDOS_APPROVAL_HOLD;

  // ── holdTask → answer round-trip through the store ────────────────────────
  const created = await createTask(
    null,
    { title: "Approve warm outreach send", body: "held-test", source: "company:co-one:run" },
    kanbanOptions,
  );
  const taskId = created.task.id;
  // Move it to needs-human the way a blocked worker would.
  await blockTask(null, taskId, "Held for governance — approve the send or keep it held.", kanbanOptions);

  // Park it: held is stamped, status STAYS needs-human (so nothing re-routes it).
  const heldRes = await holdTask(null, taskId, { by: "liam", note: "decide tomorrow" }, kanbanOptions);
  assert.equal(heldRes.task.status, "needs-human", "hold keeps status needs-human");
  assert.ok(heldRes.task.held, "hold stamps the held marker");
  assert.equal(heldRes.task.held.by, "liam", "hold records who parked it");
  assert.equal(heldRes.task.held.note, "decide tomorrow", "hold records the note");

  // The held task drops out of the company waiting count (unwedges the pause).
  let board = await readBoard(null, kanbanOptions);
  assert.equal(
    countCompanyWaitingOnHuman(board.tasks, "co-one", { maxWaitingOnHuman: 1, countMode: "all" }),
    0,
    "the parked task no longer counts toward the pause threshold",
  );

  // hold only applies to needs-human — a fresh ready task is rejected.
  const readyTask = await createTask(null, { title: "not blocked", body: "x" }, kanbanOptions);
  await assert.rejects(
    () => holdTask(null, readyTask.task.id, {}, kanbanOptions),
    /only applies to Needs You/,
    "hold rejects a non-needs-human task",
  );

  // Answering supersedes the hold: status → ready, and clearHold (called on the
  // answer path in the route) drops the park so it can't stay filtered.
  const answered = await answerHumanTask(null, taskId, { answer: "approved — send it" }, kanbanOptions);
  assert.equal(answered.task.status, "ready", "answer flips a held task back to ready");
  const cleared = await clearHold(null, taskId, kanbanOptions);
  assert.equal(cleared.task.held, undefined, "clearHold drops the held marker");

  board = await readBoard(null, kanbanOptions);
  const back = board.tasks.find((t) => t.id === taskId);
  assert.equal(back.held, undefined, "persisted task has no held marker after answer + clearHold");
  assert.equal(back.status, "ready", "persisted task is ready after answer");

  // clearHold is a safe no-op on a task that was never held.
  const noop = await clearHold(null, readyTask.task.id, kanbanOptions);
  assert.ok(noop, "clearHold is a no-op (no throw) on a non-held task");

  console.log("approval sticky-hold tests passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
