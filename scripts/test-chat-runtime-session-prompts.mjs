#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { runtimePromptFromSessionMessage } = await import(
  "../src/features/dashboard/hooks/status-chat-input-helpers.ts"
);
const { promptUiFromMessage } = await import(
  "../src/features/dashboard/views/chat/chat-panel-helpers.ts"
);

const prompt = runtimePromptFromSessionMessage({
  role: "assistant",
  content: "How should I make this video?",
  raw: {
    type: "chat.clarify",
    id: "video-creation-method",
    question: "How should I make this video?",
    choices: [
      { label: "Cloud AI video", value: "Use cloud video generation" },
      { label: "Local AI video", value: "Use local video generation" },
      { label: "HTML / HyperFrames", value: "Use HyperFrames HTML-based video rendering" },
    ],
    allowFreeText: true,
  },
});

assert.equal(prompt?.type, "clarify");
assert.equal(prompt?.choices?.length, 3);
assert.equal(prompt?.choices?.[2]?.label, "HTML / HyperFrames");

const coldFallbackPrompt = promptUiFromMessage({}, [
  "I can build this. Which production method would you prefer?",
  "",
  "- **Cloud AI** — using a hosted model via HivemindOS credits",
  "- **Local** — using your machine's GPUs",
  "- **HTML / HyperFrames** — programmatically rendered with code",
].join("\n"));

assert.equal(coldFallbackPrompt?.displayText, "I can build this. Which production method would you prefer?");
assert.deepEqual(
  coldFallbackPrompt?.options.map((option) => option.label),
  ["Cloud AI", "Local", "HTML / HyperFrames"],
  "an agent-authored decision list should become clickable chat choices",
);
assert.match(coldFallbackPrompt?.options[2]?.value ?? "", /programmatically rendered with code/);

const controllerSource = await readFile(
  new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url),
  "utf8",
);
const chatRunTranscriptsSource = await readFile(new URL("../src/features/dashboard/chat-run-transcripts.ts", import.meta.url), "utf8");

assert.match(controllerSource, /runtimePromptFromSessionMessage\(sessionMessage\)/);
assert.match(chatRunTranscriptsSource, /agentPrompt:\s*\(runtimePromptFromSessionMessage\(message\)/);

console.log("Structured runtime prompts survive session polling and reloads.");
