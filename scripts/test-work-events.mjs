#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const home = await mkdtemp(join(tmpdir(), "hivemindos-work-events-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-work-events-vault-"));
process.env.HOME = home;

const {
  createWorkEventTrigger,
  publishWorkEvent,
  readWorkEventsState,
} = await import("../src/lib/services/work-events.ts");

try {
  const triggerResult = await createWorkEventTrigger({
    eventName: "Deploy_Done",
    board: "mcp_events",
    title: "Review {{EVENT_NAME}} from {{EVENT_SOURCE}}",
    body: [
      "Payload:",
      "{{EVENT_PAYLOAD}}",
      "",
      "FAQ:",
      "{{EVENT_FAQ}}",
    ].join("\n"),
    assignee: "docs",
    priority: "high",
    status: "ready",
    skills: ["docs", "qa"],
    emitEventName: "review_done",
  });

  assert.equal(triggerResult.event.name, "deploy_done");
  assert.equal(triggerResult.trigger.enabled, true);

  const published = await publishWorkEvent(
    {
      eventName: "deploy_done",
      source: "test-harness",
      payload: { version: "0.2.4", channel: "latest" },
      faq: [{ question: "Smoke tested?", answer: "Yes." }],
    },
    { vaultPath },
  );

  assert.equal(published.matchedTriggers, 1);
  assert.equal(published.tasks.length, 1);
  assert.equal(published.tasks[0].board, "mcp_events");
  assert.equal(published.tasks[0].created, true);

  const task = published.tasks[0].task;
  assert.equal(task.status, "ready");
  assert.equal(task.priority, "high");
  assert.deepEqual(task.skills, ["docs", "qa"]);
  assert.equal(task.assignee, "docs");
  assert.match(task.title, /deploy_done/);
  assert.match(task.title, /test-harness/);
  assert.match(task.body, /"version": "0.2.4"/);
  assert.match(task.body, /Q: Smoke tested\?/);
  assert.match(task.body, /publish HivemindOS work event `review_done`/);

  const state = await readWorkEventsState();
  assert.equal(state.events.length, 1);
  assert.equal(state.triggers.length, 1);
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(vaultPath, { recursive: true, force: true });
}

console.log("Work event fanout tests passed.");
