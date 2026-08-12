#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildSwarmGoalPrompt,
  parseSwarmGoalCommand,
  swarmGoalTaskTitle,
} = await import("../src/features/chat/swarm-goal-prompt.ts");
const {
  handleDashboardSwarmGoalCommand,
} = await import("../src/features/dashboard/hooks/dashboard-swarm-goal-command.ts");

assert.equal(parseSwarmGoalCommand("/swarm-goal build me a rollercoaster sim"), "build me a rollercoaster sim");
assert.equal(parseSwarmGoalCommand("build me a rollercoaster sim"), "build me a rollercoaster sim");

const rollerCoasterPrompt = buildSwarmGoalPrompt("build me a rollercoaster sim");
assert.match(rollerCoasterPrompt, /Build a first-person roller coaster POV ride in Three\.js\./);
assert.match(rollerCoasterPrompt, /looping track with drops, banked turns, and at least one inversion/);
assert.match(rollerCoasterPrompt, /sound effects/i);
assert.match(rollerCoasterPrompt, /write yourself a new goal and spawn agents in parallel/);
assert.match(rollerCoasterPrompt, /Give each agent its own dedicated \/goal\./);

const dashboardPrompt = buildSwarmGoalPrompt("dashboard for agent budgets");
assert.match(dashboardPrompt, /Build a dashboard for agent budgets in Next\.js and TypeScript\./);
assert.match(dashboardPrompt, /core dashboard views/);
assert.match(dashboardPrompt, /production-like app shell/);

assert.equal(swarmGoalTaskTitle("build me a rollercoaster sim"), "Swarm goal: Rollercoaster Sim");

let capturedRequest = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  capturedRequest = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    ok: true,
    task: {
      id: "task-smoke",
      title: capturedRequest.body.taskTitle,
      assignee: "Ada Lovelace",
      targetMachine: { name: "This Mac" },
    },
    route: {
      autonomousPickupScheduled: true,
      reason: "Selected code worker for smoke test.",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const messagesByKey = { "agent:leaf": [] };
let preview = { agentId: "agent", leafKey: "leaf", messages: [] };
let clearedText = "not-cleared";
await handleDashboardSwarmGoalCommand({
  prompt: "/swarm-goal build me a rollercoaster sim",
  selectedAgent: { id: "agent" },
  selectedChatLeafKey: "leaf",
  selectedStorageKey: "agent:leaf",
  sharedVault: {
    vaultPath: "/tmp/test-vault",
    brainServicesFolder: "Operations/Brain Services",
    kanbanFolder: "Operations/Work Board",
  },
  appendMessage(agentId, message, storageKey = "agent:leaf") {
    assert.equal(agentId, "agent");
    messagesByKey[storageKey] = [...(messagesByKey[storageKey] ?? []), message];
  },
  appendPreviewMessages(agentId, leafKey, messages) {
    assert.equal(agentId, "agent");
    assert.equal(leafKey, "leaf");
    preview = { ...preview, messages: [...preview.messages, ...messages] };
  },
  setText(value) {
    clearedText = value;
  },
  setAttachmentError(value) {
    assert.equal(value, "");
  },
  setAttachmentMenuOpen(value) {
    assert.equal(value, false);
  },
  setMessagesByAgent(updater) {
    Object.assign(messagesByKey, updater(messagesByKey));
  },
  setSelectedChatPreview(updater) {
    preview = updater(preview);
  },
});
globalThis.fetch = originalFetch;

assert.equal(clearedText, "");
assert.equal(capturedRequest.url, "/api/queen-bee");
assert.equal(capturedRequest.body.mode, "act");
assert.equal(capturedRequest.body.priority, "high");
assert.equal(capturedRequest.body.source, "dashboard-swarm-goal");
assert.equal(capturedRequest.body.loopTemplateId, "app-build-harness", "swarm goals request the server-owned app-build evidence loop");
assert.deepEqual(capturedRequest.body.skills, ["planner", "code", "qa"]);
assert.match(capturedRequest.body.message, /Build a first-person roller coaster POV ride in Three\.js\./);
assert.match(capturedRequest.body.message, /Give each agent its own dedicated \/goal\./);
assert.match(messagesByKey["agent:leaf"].at(-1).content, /Submitted swarm goal to Queen Bee/);
assert.match(messagesByKey["agent:leaf"].at(-1).content, /Autonomous pickup: scheduled/);

console.log("Swarm goal prompt rewrite checks passed.");
