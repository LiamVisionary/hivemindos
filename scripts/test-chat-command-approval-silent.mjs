#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { commandApprovalEvent } from "../src/app/api/chat/agent-runtime/runtime-helpers.ts";
import { compactChatMessagesForStorage, parseStoredChatMessages } from "../src/features/dashboard/dashboard-storage.ts";
import { runtimePromptFromPayload } from "../src/features/dashboard/hooks/status-chat-input-helpers.ts";
import { isSilentCommandApprovalMessage, promptUiFromMessage } from "../src/features/dashboard/views/chat/chat-panel-helpers.ts";

const approvalEvent = commandApprovalEvent({
  command: "mkdir",
  args: ["-p", "/tmp/hivemindos-silent-approval"],
  commandLine: "mkdir -p /tmp/hivemindos-silent-approval",
  label: "Create the requested directory",
});
const runtimePrompt = runtimePromptFromPayload({ event: approvalEvent });
assert.ok(runtimePrompt, "the local command approval event should become an interactive prompt");

const promptUi = promptUiFromMessage({ agentPrompt: runtimePrompt }, runtimePrompt.question);
assert.ok(promptUi, "the runtime approval should render as interactive prompt UI");
const approveOption = promptUi.options.find((option) => option.label === "Approve once");
const rejectOption = promptUi.options.find((option) => option.label === "Reject");
assert.equal(approveOption?.suppressUserMessage, true, "approving a local command should send its runtime prompt silently");
assert.notEqual(rejectOption?.suppressUserMessage, true, "rejecting a command should retain the ordinary visible-response behavior");

const stored = parseStoredChatMessages({
  "hivemindos.chatMessages.v1": JSON.stringify(compactChatMessagesForStorage({
    scout: [{ role: "assistant", content: runtimePrompt.question, agentPrompt: runtimePrompt }],
  })),
});
const restoredUi = promptUiFromMessage(stored.scout?.[0] ?? {}, runtimePrompt.question);
assert.equal(
  restoredUi?.options.find((option) => option.label === "Approve once")?.suppressUserMessage,
  true,
  "silent approval delivery should survive persisted chat reloads",
);
assert.equal(
  isSilentCommandApprovalMessage({ role: "user", content: approveOption?.value }),
  true,
  "previously stored command approvals should be hidden from the rendered transcript",
);
assert.equal(
  isSilentCommandApprovalMessage({ role: "user", content: "Please approve this command" }),
  false,
  "ordinary user messages should remain visible",
);

const [threadSource, controllerSource, exchangeSource] = await Promise.all([
  readFile(new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8"),
]);
assert.match(
  threadSource,
  /suppressUserMessage:\s*option\.suppressUserMessage/,
  "interactive prompt controls should forward silent-delivery intent",
);
assert.match(
  controllerSource,
  /suppressOutgoingUserMessage:\s*input\.suppressUserMessage\s*===\s*true/,
  "the chat turn should translate silent-delivery intent into outgoing-message suppression",
);
assert.match(
  controllerSource,
  /let outgoingUserMessagePublished = suppressOutgoingUserMessage;[\s\S]*?if \(outgoingUserMessagePublished\) return;[\s\S]*?appendMessage\(selectedAgent\.id, outgoingUserMessage, selectedStorageKey\)/,
  "silent prompt responses should skip the visible user message while retaining runtime submission",
);
assert.match(
  exchangeSource,
  /filter\(\(message\) => !isSilentCommandApprovalMessage\(message\)\)/,
  "the chat route should hide legacy stored approval responses without deleting runtime history",
);

console.log("silent local command approval checks passed");
