#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  blockTask,
  claimTask,
  createTask,
  readBoard,
} = await import("../src/lib/services/kanban/local-kanban-store.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-kanban-race-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const boardSlug = "race";

try {
  const created = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createTask(boardSlug, {
        title: `Concurrent task ${index + 1}`,
        body: "Created in parallel to prove Kanban read-modify-write serialization.",
        status: "ready",
        priority: "high",
        workspace: "scratch",
        assignee: index % 2 === 0 ? "Ada Lovelace" : "AdaptiveAgent",
        targetMachine: {
          key: "local",
          name: "This Mac",
          collectorUrl: "http://127.0.0.1:8789",
        },
      }, options),
    ),
  );
  const taskIds = created.map((result) => result.task.id);
  const afterCreate = await readBoard(boardSlug, options);
  assert.equal(afterCreate.tasks.length, taskIds.length, "parallel creates should not drop cards");
  assert.deepEqual(
    [...new Set(afterCreate.tasks.map((task) => task.id).filter((id) => taskIds.includes(id)))].sort(),
    [...taskIds].sort(),
    "every created task should remain on the board",
  );

  await Promise.all(
    taskIds.map(async (taskId, index) => {
      await claimTask(boardSlug, taskId, {
        assignee: index % 2 === 0 ? "Ada Lovelace" : "AdaptiveAgent",
        claimer: `concurrent-claim-${index}`,
        runtime: "test",
      }, options);
      await blockTask(boardSlug, taskId, `Concurrent block ${index + 1}`, options);
    }),
  );

  const afterPickup = await readBoard(boardSlug, options);
  assert.equal(afterPickup.tasks.length, taskIds.length, "parallel claim/block should not drop cards");
  assert.ok(
    afterPickup.tasks.every((task) => task.status === "needs-human"),
    "all concurrently blocked tasks should remain needs-human",
  );
  assert.equal(afterPickup.runs.length, taskIds.length, "each claimed task should retain a run record");

  console.log("Kanban concurrent mutation tests passed.");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
