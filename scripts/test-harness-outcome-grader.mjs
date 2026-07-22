#!/usr/bin/env node
import assert from "node:assert/strict";

import { scenarios } from "./benchmark-context-savings.mjs";
import { gradeBenchmarkOutcome } from "./lib/repository-plan-outcome.mjs";

const chatbotScenario = scenarios.find((scenario) => scenario.id === "chatbot-build");
assert(chatbotScenario, "chatbot benchmark scenario should exist");

const historicalTargetedAnswer = JSON.stringify({
  answer: "Add a dashboard chatbot through new API, runtime selector, and streaming hook files.",
  files: [
    "src/pages/api/chatbot.ts",
    "src/components/DashboardChatbot.tsx",
    "src/lib/agents/runtimeSelector.ts",
    "src/lib/hooks/useStreamingChat.ts",
    "tests/api/chatbot.test.ts",
  ],
  tests: ["npm run test -- tests/api/chatbot.test.ts"],
  safety: ["sanitize input"],
  confidence: 0.9,
});
const historicalGrade = gradeBenchmarkOutcome({ scenario: chatbotScenario, content: historicalTargetedAnswer, root: process.cwd() });
assert.equal(historicalGrade.ok, false, "nonexistent path claims must not count as a successful harness outcome");
assert.equal(historicalGrade.existingPaths.length, 0);
assert(historicalGrade.missingPaths.includes("src/pages/api/chatbot.ts"));

const groundedAnswer = JSON.stringify({
  answer: "Extend the existing chat runtime and retrieval owners.",
  files: [
    "src/app/api/chat/agent-runtime/route.ts",
    "src/lib/services/chat/shared-brain-memory-context.ts",
    "src/lib/services/runtime-adapters/registry.ts",
    "src/features/dashboard/hooks/use-status-chat-input-controller.tsx",
    "scripts/test-chat-runtime-session-prompts.mjs",
  ],
  tests: ["pnpm test:chat-runtime-session-prompts"],
  safety: ["preserve capability approval"],
  confidence: 0.8,
});
const groundedGrade = gradeBenchmarkOutcome({ scenario: chatbotScenario, content: groundedAnswer, root: process.cwd() });
assert.equal(groundedGrade.ok, true);
assert.equal(groundedGrade.missingPaths.length, 0);
assert.equal(groundedGrade.missingOwners.length, 0);

const memoryScenario = scenarios.find((scenario) => scenario.id === "brain-recall");
assert(memoryScenario);
const memoryGrade = gradeBenchmarkOutcome({
  scenario: memoryScenario,
  content: JSON.stringify({ answer: "Run hive-brain answer before relying on context. Recall checks typed Agent Memory first and uses full-vault augmentation when needed." }),
  root: process.cwd(),
});
assert.equal(memoryGrade.ok, true);

console.log("harness accepted-outcome grader checks passed");
