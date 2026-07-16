#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  parsePhoneShortcutAction,
  runPhoneShortcutAction,
  shortcutQueenPrompt,
} = await import("../src/lib/services/phone/shortcut-actions.ts");

assert.deepEqual(
  parsePhoneShortcutAction({
    action: "shortcut-action",
    kind: "brain-capture",
    actionId: "shortcut-123",
    text: "A durable idea",
    createdAt: "2026-07-13T12:34:56.000Z",
  }),
  {
    kind: "brain-capture",
    actionId: "shortcut-123",
    text: "A durable idea",
    createdAt: "2026-07-13T12:34:56.000Z",
  },
);

assert.deepEqual(
  parsePhoneShortcutAction({
    action: "shortcut-action",
    kind: "queen-query",
    query: "daily-brief",
    actionId: "shortcut-brief",
  }),
  {
    kind: "queen-query",
    query: "daily-brief",
    actionId: "shortcut-brief",
  },
);

assert.throws(
  () => parsePhoneShortcutAction({ action: "shortcut-action", kind: "brain-capture", text: "missing id" }),
  /action id/i,
);
assert.throws(
  () => parsePhoneShortcutAction({ action: "shortcut-action", kind: "brain-capture", actionId: "bad/id", text: "x" }),
  /action id/i,
);
assert.throws(
  () => parsePhoneShortcutAction({ action: "shortcut-action", kind: "task-capture", actionId: "x", text: "" }),
  /text/i,
);
assert.throws(
  () => parsePhoneShortcutAction({ action: "shortcut-action", kind: "queen-query", actionId: "x", query: "ask" }),
  /question/i,
);

assert.equal(
  shortcutQueenPrompt({ kind: "queen-query", query: "daily-brief", actionId: "brief" }),
  "Give me a concise spoken daily Hive briefing: the most important active work, blockers, pending approvals, and the single best next action.",
);
assert.equal(
  shortcutQueenPrompt({ kind: "queen-query", query: "ask", actionId: "ask", text: "What needs attention?" }),
  "What needs attention?",
);

const calls = [];
const dependencies = {
  async captureNote(input) {
    calls.push({ type: "capture", input });
    return { notePath: "Intake/mobile.md", title: "A durable idea", createdAt: input.now.toISOString(), created: true };
  },
  async processCapture(input) {
    calls.push({ type: "process", input });
    return {
      brainDropId: "drop-1",
      category: "idea",
      confidence: "high",
      reason: "idea-language",
      title: "A durable idea",
      routedNotePath: "Ideas/a-durable-idea.md",
      relatedNotePaths: [],
      created: true,
    };
  },
  async discoverFleet(origin, deviceToken) {
    calls.push({ type: "discover", origin, deviceToken });
    return [{ key: "machine" }];
  },
  async submitTask(input) {
    calls.push({ type: "task", input });
    return { created: true, task: { id: "task-1", title: input.taskTitle }, receipt: { summary: "Queued." } };
  },
  async runQueenTurn(origin, message) {
    calls.push({ type: "queen", origin, message });
    return { speech: "Three tasks are active.", detail: { source: "queen" } };
  },
};

const brainResult = await runPhoneShortcutAction({
  body: {
    action: "shortcut-action",
    kind: "brain-capture",
    actionId: "shortcut-123",
    text: "A durable idea",
    createdAt: "2026-07-13T12:34:56.000Z",
    inputMode: "voice",
  },
  origin: "http://hive.local",
  deviceToken: "device-token",
  dependencies,
});
assert.equal(brainResult.kind, "brain-capture");
assert.equal(brainResult.note.notePath, "Intake/mobile.md");
assert.equal(brainResult.processing.category, "idea");
assert.deepEqual(calls.at(-2).input.tags, ["hivemindos-note", "iphone-shortcut", "voice-input"]);
assert.equal(calls.at(-2).input.source, "iphone-shortcut");
assert.equal(calls.at(-2).input.idempotencyKey, "shortcut-123");
assert.equal(calls.at(-1).type, "process");
assert.equal(calls.at(-1).input.capture.notePath, "Intake/mobile.md");
assert.deepEqual(calls.at(-1).input.inputTags, ["iphone-shortcut", "voice-input"]);

const taskResult = await runPhoneShortcutAction({
  body: {
    action: "shortcut-action",
    kind: "task-capture",
    actionId: "shortcut-task-1",
    text: "Fix the overnight telemetry exporter",
    createdAt: "2026-07-13T12:34:56.000Z",
  },
  origin: "http://hive.local",
  deviceToken: "device-token",
  dependencies,
});
assert.equal(taskResult.task.id, "task-1");
assert.equal(calls.at(-1).input.source, "iphone-shortcut:shortcut-task-1");
assert.deepEqual(calls.at(-1).input.fleetSnapshot, [{ key: "machine" }]);

const queenResult = await runPhoneShortcutAction({
  body: {
    action: "shortcut-action",
    kind: "queen-query",
    query: "daily-brief",
    actionId: "shortcut-brief",
  },
  origin: "http://hive.local",
  deviceToken: "device-token",
  dependencies,
});
assert.deepEqual(queenResult, {
  kind: "queen-query",
  text: "Three tasks are active.",
  detail: { source: "queen" },
});

const phoneRoute = await readFile(new URL("../src/app/api/phone/route.ts", import.meta.url), "utf8");
assert.match(phoneRoute, /body\.action === "shortcut-action"/);
assert.match(phoneRoute, /runPhoneShortcutAction/);

console.log("Phone shortcut action parsing, prompts, and route wiring checks passed.");
