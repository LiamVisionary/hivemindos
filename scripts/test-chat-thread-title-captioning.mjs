#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildChatThreadTitleContext,
  isSubstantiveChatUserTurn,
  openAiOAuthChatModelIds,
  parseChatThreadTitleConfig,
  sanitizeChatThreadTitle,
  scoreChatThreadTitleModel,
} from "../src/lib/config/chat-thread-title.ts";
import { LOCAL_MODEL_INSTALL_CATALOG, localModelMatchesCatalogEntry } from "../src/lib/config/local-model-install-catalog.ts";
import { compactChatSidebarText, isInternalChatSidebarTask } from "../src/features/chat/chat-sidebar-content.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

assert.equal(isSubstantiveChatUserTurn("hello"), false);
assert.equal(isSubstantiveChatUserTurn("Can you help?"), false);
assert.equal(isSubstantiveChatUserTurn("Help me design local chat thread titles"), true);

const longFirstTurn = `Design a private captioning system ${"x".repeat(800)}`;
const context = buildChatThreadTitleContext([
  { role: "system", content: "Never include this system prompt" },
  { role: "user", content: "hello", surface: "chat" },
  { role: "assistant", content: "Never include this assistant reply" },
  { role: "user", content: longFirstTurn, surface: "chat" },
  { role: "user", content: "tool output", surface: "process", processEvents: [{}] },
  { role: "user", content: "Prefer the 0.8B local model", surface: "chat" },
]);
assert.ok(context);
assert.equal(context.firstUserTurn.length, 600);
assert.equal(context.latestUserTurn, "Prefer the 0.8B local model");
assert.equal(context.assistantReply, undefined);

assert.deepEqual(
  buildChatThreadTitleContext([{ role: "user", content: "hello" }, { role: "user", content: "Can you help?" }]),
  null,
);
assert.equal(sanitizeChatThreadTitle('{"title":"Private Thread Title Models"}'), "Private Thread Title Models");
assert.equal(sanitizeChatThreadTitle("Title: Local Captioning Setup."), "Local Captioning Setup");
assert.ok(scoreChatThreadTitleModel("gpt-5.4-nano") > scoreChatThreadTitleModel("claude-opus-4.1"));
assert.ok(scoreChatThreadTitleModel("gemini-3.1-flash-lite") > scoreChatThreadTitleModel("gemini-3.1-pro"));
assert.deepEqual(
  openAiOAuthChatModelIds(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-image-1", "claude-opus-4.1", "gpt-5.6-luna"]),
  ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.4"],
);

const defaultConfig = parseChatThreadTitleConfig("not-json");
assert.equal(defaultConfig.mode, "off");
assert.equal(defaultConfig.localCatalogId, "chat-title-qwen3-5-0-8b-q4-k-m");

const titleModels = LOCAL_MODEL_INSTALL_CATALOG.filter((entry) => entry.roles.includes("chat-title"));
assert.deepEqual(titleModels.map((entry) => entry.params), ["0.8B", "4B"]);
assert.deepEqual(titleModels.map((entry) => entry.contextLength), [2048, 2048]);
assert.equal(localModelMatchesCatalogEntry({ key: "unrelated-model", format: "GGUF" }, titleModels[0]), false);
assert.equal(localModelMatchesCatalogEntry({ key: "Qwen3.5-0.8B-Q4_K_M.gguf", format: "GGUF" }, titleModels[0]), true);
assert.equal(
  compactChatSidebarText("Inspect the local machine and retrieve the installed xurl CLI version. Run only read-only commands.", 7),
  "Inspect the local machine and retrieve the",
);
assert.equal(isInternalChatSidebarTask({
  id: "subagent-session",
  agentId: "agent",
  title: "Inspect the local machine",
  lastMessage: "done",
  status: "completed",
  source: "hermes-state",
  sourceDetail: "subagent",
  startedAt: 1,
  updatedAt: 2,
}), true);
assert.equal(isInternalChatSidebarTask({
  id: "voice-session",
  agentId: "agent",
  title: "Voice",
  lastMessage: "done",
  status: "completed",
  source: "hermes-state",
  sourceDetail: "cli",
  startedAt: 1,
  updatedAt: 2,
  messages: [{ role: "user", content: "Queen Bee live voice override: for this voice turn, answer as Queen Bee." }],
}), true);
assert.equal(isInternalChatSidebarTask({
  id: "api-probe-session",
  agentId: "agent",
  title: "Inspect the machine and retrieve the installed xurl CLI version.",
  lastMessage: "Probe finished",
  status: "completed",
  source: "hermes-state",
  sourceDetail: "api_server",
  startedAt: 1,
  updatedAt: 2,
}), true);
assert.equal(isInternalChatSidebarTask({
  id: "normal-session",
  agentId: "agent",
  title: "Add local thread captions",
  lastMessage: "Implemented",
  status: "completed",
  source: "hermes-state",
  sourceDetail: "cli",
  startedAt: 1,
  updatedAt: 2,
}), false);
assert.equal(isInternalChatSidebarTask({
  id: "quoted-dashboard-session",
  agentId: "agent",
  title: "Why did this appear?",
  lastMessage: "Queen Bee live voice override: for this voice turn",
  status: "completed",
  source: "dashboard-chat",
  startedAt: 1,
  updatedAt: 2,
}), false);

const sendController = read("src/features/dashboard/hooks/use-status-chat-input-controller.tsx");
const appendIndex = sendController.indexOf("appendMessage(selectedAgent.id, outgoingUserMessage, selectedStorageKey)");
const captionIndex = sendController.indexOf("props.requestChatThreadTitle?.({");
assert.ok(appendIndex >= 0 && captionIndex > appendIndex, "caption generation should start after the user message is appended");
assert.match(sendController, /messages: \[\.\.\.messages\.filter\(isManualAgentChatMessage\), outgoingUserMessage\]/);

const titleService = read("src/lib/services/chat/thread-title.ts");
assert.match(titleService, /redactSecretText\(context\.firstUserTurn\)/);
assert.match(titleService, /LOCAL_LM_STUDIO_BASE_URL/);
assert.match(titleService, /runOpenAiOAuthChatTurn/);
assert.match(titleService, /resolveXaiOAuthChatEndpoint/);

const titleModelOptions = read("src/lib/services/chat/thread-title-model-options.ts");
assert.match(titleModelOptions, /openAiOAuthChatModelIds/);
assert.match(titleModelOptions, /provider === "openai-api"/);

const settings = read("src/features/dashboard/views/chat/exchange/ThreadTitleSettings.tsx");
assert.match(settings, /LmStudioModelManager/);
assert.match(settings, /catalogFilter=\{\(entry\) => entry\.roles\.includes\("chat-title"\)\}/);
assert.match(settings, /inventoryFilter=\{\(model\) => LOCAL_MODEL_INSTALL_CATALOG\.some/);
assert.match(settings, /Search models and providers/);
assert.match(settings, /route\.auth === "oauth" \? "OAuth" : "API"/);
assert.match(settings, /Recommended/);
assert.match(settings, /All available/);

// ConversationNav was an unshipped predecessor of ChatSidebar; it was deleted
// with the App workspace change, so its compaction assertions went with it.

console.log("Chat thread title captioning checks passed.");
