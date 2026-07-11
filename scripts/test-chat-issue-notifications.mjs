#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  chatAssistantIssue,
  chatIssueCompletionNotification,
} = await import("../src/features/dashboard/chat-issue-notifications.ts");

const bankrIssue = chatAssistantIssue([
  "**Bankr action unavailable**",
  "",
  "Set BANKR_API_KEY before using Bankr actions.",
  "",
  "Fix this blocker, then ask again.",
].join("\n"));
assert.equal(bankrIssue, "Set BANKR_API_KEY before using Bankr actions.");
assert.equal(chatAssistantIssue("Here is the completed YouTube plan."), "");

const notification = chatIssueCompletionNotification({
  agentId: "openclaw",
  agentName: "OpenClaw",
  chatLeaf: "working",
  issue: bankrIssue,
  runId: "run-1",
});
assert.equal(notification.title, "OpenClaw needs attention");
assert.equal(notification.initials, "!");
assert.deepEqual(notification.destination, {
  view: "chat",
  agentId: "openclaw",
  chatLeaf: "working",
});
assert.match(notification.message, /BANKR_API_KEY/);

console.log("PASS test-chat-issue-notifications");
