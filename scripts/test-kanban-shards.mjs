#!/usr/bin/env node
// Hermetic test for the merge-friendly kanban shard engine
// (src/lib/services/kanban/board-shards.ts): one-shot migration from a legacy
// kanban.json, per-task shard writes, lifting external snapshot edits and
// Syncthing conflict copies back into the shards, tombstone semantics for
// deletes, cross-machine folds, deterministic materialization, and the
// HIVEMINDOS_KANBAN_SHARDS=0 kill switch.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_KANBAN_MACHINE_KEY = "testmachinea";

const {
  addComment,
  createTask,
  deleteTask,
  moveTask,
  readBoard,
} = await import("../src/lib/services/kanban/local-kanban-store.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-kanban-shards-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const boardDir = join(vaultPath, "Operations", "Work Board");
const snapshotPath = join(boardDir, "kanban.json");
const shardsDir = join(boardDir, "shards");

const readSnapshot = async () => JSON.parse(await readFile(snapshotPath, "utf-8"));
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

try {
  // 1) Legacy migration: seed a raw single-file board with no shards, then read.
  await mkdir(boardDir, { recursive: true });
  const now = Date.now();
  const legacyTask = {
    id: "t_legacy_00001",
    title: "Legacy task",
    body: "seeded before shards existed",
    status: "ready",
    priority: "normal",
    workspace: "scratch",
    skills: [],
    attachments: [],
    linkedDirectories: [],
    deliverables: [],
    targetMachine: null,
    proofs: [],
    createdAt: now - 1000,
    updatedAt: now - 1000,
  };
  const legacyEvent = {
    id: "e_legacy_00001",
    kind: "task.created",
    message: "Created Legacy task",
    taskId: legacyTask.id,
    createdAt: now - 1000,
  };
  await writeFile(
    snapshotPath,
    JSON.stringify(
      {
        meta: { slug: "default", name: "Default", createdAt: now - 2000, updatedAt: now - 1000 },
        tasks: [legacyTask],
        comments: [],
        links: [],
        events: [legacyEvent],
        runs: [],
      },
      null,
      2,
    ) + "\n",
  );
  const migrated = await readBoard(null, options);
  assert.equal(migrated.tasks.length, 1, "migration should keep the legacy task");
  assert.equal(migrated.tasks[0].id, legacyTask.id);
  assert.ok(existsSync(join(shardsDir, "tasks", "t_legacy_00001.json")), "task shard should exist");
  assert.ok(existsSync(join(shardsDir, "logs", "testmachinea.jsonl")), "own log should exist");
  assert.ok(existsSync(snapshotPath), "legacy snapshot must remain as rollback/compat");

  // 2) Store mutations write shards + rematerialize the snapshot.
  const created = await createTask(null, { title: "Sharded task", status: "ready" }, options);
  const shardedId = created.task.id;
  assert.ok(
    existsSync(join(shardsDir, "tasks", `${shardedId}.json`)),
    "new task should get its own shard file",
  );
  let snapshot = await readSnapshot();
  assert.deepEqual(
    new Set(snapshot.tasks.map((task) => task.id)),
    new Set([legacyTask.id, shardedId]),
    "materialized snapshot should contain both tasks",
  );

  // 3) External old-store writer: rewrite kanban.json directly (status flip +
  // fresh event). The next read must lift it into the shards.
  await settle();
  const external = await readSnapshot();
  const externalTask = external.tasks.find((task) => task.id === legacyTask.id);
  externalTask.status = "needs-human";
  externalTask.updatedAt = Date.now() + 5;
  external.events.unshift({
    id: "e_external_00001",
    kind: "task.blocked",
    message: "Blocked externally",
    taskId: legacyTask.id,
    createdAt: Date.now(),
  });
  await writeFile(snapshotPath, JSON.stringify(external, null, 2) + "\n");
  const afterLift = await readBoard(null, options);
  assert.equal(
    afterLift.tasks.find((task) => task.id === legacyTask.id)?.status,
    "needs-human",
    "external snapshot edit should be lifted into shards",
  );
  assert.ok(
    afterLift.events.some((entry) => entry.id === "e_external_00001"),
    "external event should be lifted",
  );

  // 4) Syncthing conflict copy: diverged fork with a newer task edit and a
  // unique event. Reading must merge it and delete the conflict file.
  await settle();
  const fork = await readSnapshot();
  const forkTask = fork.tasks.find((task) => task.id === shardedId);
  forkTask.title = "Sharded task (edited on machine B)";
  forkTask.updatedAt = Date.now() + 10;
  fork.events.unshift({
    id: "e_fork_00001",
    kind: "task.updated",
    message: "Updated on machine B",
    taskId: shardedId,
    createdAt: Date.now(),
  });
  const conflictPath = join(boardDir, "kanban.sync-conflict-20260703-000000-TESTDEV.json");
  await writeFile(conflictPath, JSON.stringify(fork, null, 2) + "\n");
  const afterConflict = await readBoard(null, options);
  assert.equal(
    afterConflict.tasks.find((task) => task.id === shardedId)?.title,
    "Sharded task (edited on machine B)",
    "newer conflict-copy edit should win by updatedAt",
  );
  assert.ok(
    afterConflict.events.some((entry) => entry.id === "e_fork_00001"),
    "conflict-copy event should be merged",
  );
  assert.ok(!existsSync(conflictPath), "conflict file should be deleted after merge");

  // 5) Tombstones: deleteTask must stick even when a stale snapshot
  // containing the task is written back by an old machine.
  await addComment(null, shardedId, "about to be deleted", "tester", options);
  await deleteTask(null, shardedId, options);
  const afterDelete = await readBoard(null, options);
  assert.ok(
    !afterDelete.tasks.some((task) => task.id === shardedId),
    "deleted task should be gone",
  );
  const shardRaw = JSON.parse(
    await readFile(join(shardsDir, "tasks", `${shardedId}.json`), "utf-8"),
  );
  assert.equal(shardRaw.tombstone, true, "deleted task shard should be a tombstone");
  await settle();
  const stale = { ...fork, tasks: fork.tasks, events: [] };
  stale.tasks = fork.tasks.map((task) =>
    task.id === shardedId ? { ...task, updatedAt: Date.now() + 60_000 } : task,
  );
  await writeFile(snapshotPath, JSON.stringify(stale, null, 2) + "\n");
  const afterStale = await readBoard(null, options);
  assert.ok(
    !afterStale.tasks.some((task) => task.id === shardedId),
    "tombstoned task must not resurrect from a stale external snapshot",
  );
  assert.ok(
    !afterStale.comments.some((comment) => comment.taskId === shardedId),
    "comments of a tombstoned task should drop from the board",
  );

  // 6) Cross-machine fold: shards written by another machine (task file +
  // its own log + stamp) appear on the next read.
  const foreignTask = {
    ...legacyTask,
    id: "t_foreign_00001",
    title: "Foreign machine task",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await writeFile(
    join(shardsDir, "tasks", "t_foreign_00001.json"),
    JSON.stringify(foreignTask, null, 2) + "\n",
  );
  await writeFile(
    join(shardsDir, "logs", "testmachineb.jsonl"),
    JSON.stringify({
      k: "event",
      v: {
        id: "e_foreign_00001",
        kind: "task.created",
        message: "Created Foreign machine task",
        taskId: foreignTask.id,
        createdAt: Date.now(),
      },
    }) + "\n",
  );
  await writeFile(
    join(shardsDir, "stamps", "testmachineb.json"),
    JSON.stringify({ writtenAt: Date.now() }) + "\n",
  );
  const afterForeign = await readBoard(null, options);
  assert.ok(
    afterForeign.tasks.some((task) => task.id === foreignTask.id),
    "task shard written by another machine should fold in",
  );
  assert.ok(
    afterForeign.events.some((entry) => entry.id === "e_foreign_00001"),
    "another machine's log records should fold in",
  );

  // 7) Determinism: repeated reads must not churn the materialized snapshot.
  const bytesA = await readFile(snapshotPath, "utf-8");
  await readBoard(null, options);
  const bytesB = await readFile(snapshotPath, "utf-8");
  assert.equal(bytesA, bytesB, "rematerialization must be byte-stable");

  // 8) Kill switch: with shards disabled, a fresh board stays single-file.
  process.env.HIVEMINDOS_KANBAN_SHARDS = "0";
  await createTask("killswitch", { title: "Legacy-mode task" }, options);
  const killswitchDir = join(boardDir, "boards", "killswitch");
  assert.ok(
    existsSync(join(killswitchDir, "kanban.json")),
    "kill-switch board should write kanban.json",
  );
  assert.ok(
    !existsSync(join(killswitchDir, "shards")),
    "kill-switch board must not create shards",
  );
  delete process.env.HIVEMINDOS_KANBAN_SHARDS;

  // 9) Sharded board move still round-trips through the public store API.
  const moved = await moveTask(null, foreignTask.id, "archived", options);
  assert.equal(moved.task.status, "archived");
  const finalSnapshot = await readSnapshot();
  assert.equal(
    finalSnapshot.tasks.find((task) => task.id === foreignTask.id)?.status,
    "archived",
    "archive move should materialize into the snapshot",
  );

  const logNames = await readdir(join(shardsDir, "logs"));
  assert.ok(logNames.includes("testmachinea.jsonl"), "own machine log should persist");

  console.log("Kanban shard engine tests passed.");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
