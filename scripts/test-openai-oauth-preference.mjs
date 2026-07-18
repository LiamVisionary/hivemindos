#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const routing = await import(
  new URL("../src/lib/config/openai-provider-routing.ts", import.meta.url)
).catch(() => null);

assert.ok(routing, "the canonical OpenAI provider-routing matrix must exist");

const oauthDefault = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: false,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(oauthDefault, {
  auth: "oauth",
  model: "gpt-5.4",
}, "connected OAuth must win and select an OAuth-served model");

const oauthRequestedModel = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: false,
  requestedModel: "gpt-5.4",
});
assert.deepEqual(oauthRequestedModel, {
  auth: "oauth",
  model: "gpt-5.4",
}, "an OAuth-served requested model must be preserved");

const explicitApiKey = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: true,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(explicitApiKey, {
  auth: "api-key",
  model: "gpt-4o-mini",
}, "OPENAI_PREFER_API_KEY must remain the explicit override");

const disconnected = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: false,
  preferApiKey: false,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(disconnected, {
  auth: "api-key",
  model: "gpt-4o-mini",
}, "the API key remains the fallback when OAuth is disconnected");

const calls = [];
const oauthResult = await routing.runPreferredOpenAiChatRoute(
  {
    oauthConfigured: true,
    preferApiKey: false,
    requestedModel: "gpt-4o-mini",
  },
  {
    oauth: async (model) => {
      calls.push(`oauth:${model}`);
      return "oauth result";
    },
    apiKey: async (model) => {
      calls.push(`api-key:${model}`);
      return "api result";
    },
  },
);
assert.equal(oauthResult, "oauth result");
assert.deepEqual(calls, ["oauth:gpt-5.4"], "the OAuth route must execute without touching the API key");

const oauthFirstServices = [
  "src/lib/services/companies-goal-planner.ts",
  "src/lib/services/queen-bee/pilot-turn.ts",
  "src/lib/services/queen-bee/email-qa-reviewer.ts",
  "src/lib/services/queen-bee/issue-explainer.ts",
  "src/lib/services/x-transcript/summarize.ts",
];

for (const relativePath of oauthFirstServices) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  assert.match(source, /runPreferredOpenAiTextTurn/, `${relativePath} must use the OAuth-first chat adapter`);
  assert.doesNotMatch(source, /api\.openai\.com\/v1\/chat\/completions/, `${relativePath} must not bypass provider routing`);
  assert.doesNotMatch(source, /transcriptionApiKey/, `${relativePath} must not use the STT key resolver for chat`);
}

const voiceTurn = readFileSync(
  new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
  "utf8",
);
assert.match(
  voiceTurn,
  /runPreferredOpenAiTextTurn/,
  "Queen's conversational last-resort path must use the OAuth-first chat adapter",
);
assert.doesNotMatch(
  voiceTurn,
  /async function runOpenAiAgentTurn[\s\S]*?fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/,
  "Queen's agent fallback must not call the API-key endpoint directly",
);

const voiceRoute = readFileSync(
  new URL("../src/app/api/queen-bee/voice/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  voiceRoute,
  /openAiOAuthSupportsChatModel/,
  "Queen voice brain selection must use the canonical OAuth capability matrix",
);
assert.doesNotMatch(
  voiceRoute,
  /const oauthServable = \/\^\(gpt-5\|o\\d\|codex\)\/i/,
  "Queen voice brain selection must not duplicate the OAuth model-family rule",
);

const directChatFetches = [];
for (const relativePath of [
  ...oauthFirstServices,
  "src/lib/services/queen-bee/voice-turn.ts",
]) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  if (/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/.test(source)) {
    directChatFetches.push(relativePath);
  }
}
assert.deepEqual(directChatFetches, [], "feature services must not bypass the canonical OpenAI text adapter");

const genericProviders = readFileSync(
  new URL("../src/lib/providers.ts", import.meta.url),
  "utf8",
);
assert.match(
  genericProviders,
  /resolvePreferredOpenAiChatRoute/,
  "the generic AI SDK chat provider must use the canonical OAuth-first router",
);
assert.match(
  genericProviders,
  /openAiOAuthFetch/,
  "the generic AI SDK chat provider must reuse the canonical OAuth transport",
);
assert.doesNotMatch(genericProviders, /chatgpt\.com\/backend-api\/codex/, "OAuth backend ownership must stay in openai-oauth.ts");
assert.doesNotMatch(genericProviders, /OpenAI-Beta|originator|chatgpt-account-id/, "OAuth headers must stay in openai-oauth.ts");
const genericAgentRoute = readFileSync(
  new URL("../src/app/api/chat/agent/route.ts", import.meta.url),
  "utf8",
);
assert.match(genericAgentRoute, /await getLanguageModel\(\)/, "the generic chat route must await OAuth resolution");

function sourceFiles(directoryUrl) {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [url] : [];
  });
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
function repositoryRelativePath(url) {
  return relative(repositoryRoot, fileURLToPath(url)).split(sep).join("/");
}

const oauthBackendOwners = sourceFiles(new URL("../src/", import.meta.url))
  .filter((url) => /chatgpt\.com\/backend-api\/codex/.test(readFileSync(url, "utf8")))
  .map(repositoryRelativePath);
assert.deepEqual(
  oauthBackendOwners,
  ["src/lib/services/openai-oauth.ts"],
  "the OAuth transport must be the only source file that owns the ChatGPT backend URL",
);

const directOpenAiChatEndpoints = sourceFiles(new URL("../src/", import.meta.url))
  .filter((url) => /api\.openai\.com\/v1\/chat\/completions/.test(readFileSync(url, "utf8")))
  .map(repositoryRelativePath);
assert.deepEqual(
  directOpenAiChatEndpoints,
  ["src/lib/services/openai-preferred-chat.ts"],
  "the canonical adapter must be the only source file that owns the OpenAI chat-completions endpoint",
);

assert.doesNotMatch(
  voiceTurn,
  /transcriptionApiKey/,
  "Queen chat routing must not obtain chat credentials from the STT key resolver",
);
const typedChat = readFileSync(
  new URL("../src/lib/services/queen-bee/typed-chat-turn.ts", import.meta.url),
  "utf8",
);
assert.match(
  typedChat,
  /resolvePreferredOpenAiChatRoute/,
  "Queen typed-chat fallback selection must use the canonical OAuth-first router",
);
assert.doesNotMatch(
  typedChat,
  /transcriptionApiKey/,
  "Queen typed chat must not obtain chat credentials from the STT key resolver",
);
assert.match(
  typedChat,
  /runOpenAiOAuthChatTurnDetailed/,
  "Queen typed chat must preserve tool calls when the preferred OAuth brain answers",
);
const oauthTransport = readFileSync(
  new URL("../src/lib/services/openai-oauth.ts", import.meta.url),
  "utf8",
);
assert.match(oauthTransport, /runOpenAiOAuthChatTurnDetailed/, "the OAuth transport must expose structured turns");
assert.match(oauthTransport, /response\.output_item\.done/, "the OAuth transport must collect Responses tool calls");
assert.match(oauthTransport, /function_call/, "the OAuth transport must normalize function calls");

const transcriptService = readFileSync(
  new URL("../src/lib/services/x-transcript/x-transcript-service.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  transcriptService,
  /yt-dlp video transcription failed/,
  "X transcript warnings must not blame yt-dlp when the downstream STT provider fails",
);
assert.doesNotMatch(
  transcriptService,
  /Video download via X API failed/,
  "X transcript warnings must not blame the X download when fallback STT fails",
);

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
assert.match(packageJson, /"test:openai-oauth-preference"/, "package scripts must expose the OAuth preference guard");
const testGate = readFileSync(new URL("./test-gate.mjs", import.meta.url), "utf8");
assert.match(testGate, /"test:openai-oauth-preference"/, "the repository gate must run the OAuth preference guard");

console.log("OpenAI OAuth preference contract ok");
