#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { compactRepeatedAssistantText, runtimePromptFromSessionMessage } = await import(
  "../src/features/dashboard/hooks/status-chat-input-helpers.ts"
);
const { promptUiFromMessage, respondedAgentPromptFromMessage } = await import(
  "../src/features/dashboard/views/chat/chat-panel-helpers.ts"
);
const { resolveChatFleetAccessAnswer } = await import(
  "../src/features/dashboard/chat-fleet-access.ts"
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

const fleetPreamble = "I’ve confirmed the assigned workspace is the existing minimal Next.js app and loaded both approved workflows.";
const fleetAccessMessage = [
  `${fleetPreamble}${fleetPreamble}ACTION NEEDED: Approve or deny this machine access before I continue.`,
  "FLEET ACCESS REQUEST: connectedApps",
  "OPTIONS: Allow 15 min | Always allow | Deny",
].join("\n");
const fleetAccessPrompt = promptUiFromMessage({}, fleetAccessMessage);
assert.deepEqual(
  fleetAccessPrompt?.options.map((option) => option.label),
  ["Allow 15 min", "Always allow", "Deny"],
  "the exact Fleet access response should render as three buttons instead of plain option text",
);
assert.equal(fleetAccessPrompt?.allowFreeText, false, "Fleet access accepts only the collector's supported decisions");
assert.doesNotMatch(fleetAccessPrompt?.displayText ?? "", /^OPTIONS:/m);
assert.doesNotMatch(fleetAccessPrompt?.displayText ?? "", /ACTION NEEDED:|FLEET ACCESS REQUEST:/);
assert.equal(
  fleetAccessPrompt?.displayText,
  `${fleetPreamble}\n\nAllow this agent to use other-machine apps?`,
  "Fleet control markers should become a clean, capability-specific question and repeated streamed prose should collapse",
);
assert.equal(
  compactRepeatedAssistantText(`${fleetPreamble}${fleetPreamble}ACTION NEEDED:`),
  `${fleetPreamble}ACTION NEEDED:`,
  "a substantial exact prefix repeated by a cumulative stream snapshot should render once",
);

const respondedFleetPrompt = respondedAgentPromptFromMessage(
  {},
  fleetAccessMessage,
  { label: "Allowed for 15 min", value: "Allow 15 min", respondedAt: 1_000 },
  "fleet-access-test",
);
assert.equal(respondedFleetPrompt?.question, `${fleetPreamble}\n\nAllow this agent to use other-machine apps?`);
const settledFleetAccessPrompt = promptUiFromMessage({ agentPrompt: respondedFleetPrompt ?? undefined }, fleetAccessMessage);
assert.equal(settledFleetAccessPrompt?.response?.label, "Allowed for 15 min");
assert.equal(settledFleetAccessPrompt?.options.length, 3, "a legacy text prompt should persist as a responded structured prompt");

let fleetPolicyRequest;
const fleetResolution = await resolveChatFleetAccessAnswer({
  answer: "Allow 15 min",
  collectorUrl: "http://127.0.0.1:8787",
  message: fleetAccessMessage,
}, async (url, init) => {
  fleetPolicyRequest = { url: String(url), body: JSON.parse(String(init?.body || "{}")) };
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
assert.deepEqual(fleetPolicyRequest, {
  url: "/api/fleet/policy",
  body: {
    action: "resolve-access",
    capability: "connectedApps",
    collectorUrl: "http://127.0.0.1:8787",
    decision: "allow-temporary",
  },
});
assert.equal(fleetResolution.handled, true);
assert.match(fleetResolution.prompt, /now allowed for 15 minutes/);

const controllerSource = await readFile(
  new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url),
  "utf8",
);
const chatRunTranscriptsSource = await readFile(new URL("../src/features/dashboard/chat-run-transcripts.ts", import.meta.url), "utf8");
const messageThreadSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url), "utf8");
const exchangeSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8");

assert.match(controllerSource, /runtimePromptFromSessionMessage\(sessionMessage\)/);
assert.match(controllerSource, /respondedAgentPromptFromMessage\(/);
assert.match(chatRunTranscriptsSource, /agentPrompt:\s*\(runtimePromptFromSessionMessage\(message\)/);
assert.match(messageThreadSource, /resolveChatFleetAccessAnswer\(\{ answer: prompt, collectorUrl, message \}\)/);
assert.match(messageThreadSource, /setSubmittingValue\(prompt\)[\s\S]*?<SpinnerIco size=\{13\}/);
assert.match(exchangeSource, /collectorUrl=\{collectorUrl\}[\s\S]*?onPromptError=\{flashToast\}/);

console.log("Structured runtime prompts survive session polling and reloads.");
