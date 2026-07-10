#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildLatestXSearchRequest,
  isXaiOAuthProvider,
  xaiOAuthChatRequestOptions,
  xaiOAuthVoiceRequestOptions,
} = await import("../src/lib/services/xai-oauth-inference-contract.ts");
const { configuredQueenProviderFallbacks } = await import(
  "../src/lib/services/queen-bee/provider-fallback.ts"
);

const configuredFallbacks = await configuredQueenProviderFallbacks(
  { excludeProvider: "xai-oauth", excludeModel: "grok-4.5" },
  {
    readProfiles: async () => [
      { id: "queen", name: "Queen", runtime: "hermes", provider: "xai-oauth", model: "grok-4.5" },
      { id: "adaptive", name: "Adaptive", runtime: "hermes", provider: "openrouter", model: "adaptive" },
      { id: "anthropic", name: "Anthropic", runtime: "hermes", provider: "anthropic", model: "claude" },
      { id: "ready", name: "Ready", runtime: "hermes", provider: "openrouter", model: "google/gemini-test" },
      { id: "duplicate", name: "Duplicate", runtime: "hermes", provider: "openrouter", model: "google/gemini-test" },
    ],
    credentialPresent: async (keyEnv) => keyEnv === "OPENROUTER_API_KEY",
  },
);
assert.deepEqual(
  configuredFallbacks.map(({ provider, model }) => ({ provider, model })),
  [{ provider: "openrouter", model: "google/gemini-test" }],
  "fallback discovery should reuse configured direct providers without pinning a model in Queen code",
);

assert.equal(isXaiOAuthProvider("xai-oauth"), true);
assert.equal(isXaiOAuthProvider("XAI OAuth"), true);
assert.equal(isXaiOAuthProvider("xai"), false, "API-key xAI remains a separate auth mode");

assert.deepEqual(xaiOAuthChatRequestOptions("grok-4.5"), {
  max_completion_tokens: 700,
  reasoning_effort: "low",
});
assert.deepEqual(xaiOAuthChatRequestOptions("grok-4.3"), {
  max_completion_tokens: 700,
  reasoning_effort: "low",
});
assert.deepEqual(xaiOAuthChatRequestOptions("grok-4.20-0309-non-reasoning"), {
  max_tokens: 500,
  temperature: 0.4,
});
assert.deepEqual(xaiOAuthVoiceRequestOptions("grok-4.5"), {
  max_completion_tokens: 300,
  reasoning_effort: "low",
});

const latestRequest = buildLatestXSearchRequest({
  handle: "@0xLiamVisionary",
  query: "What is the latest original post?",
  cacheScope: "queen-latest-x",
});
assert.equal(latestRequest.model, "grok-4.20-0309-non-reasoning");
assert.equal(latestRequest.store, false);
assert.equal(latestRequest.tools.length, 1);
assert.equal(latestRequest.tools[0].type, "x_search");
assert.deepEqual(latestRequest.tools[0].allowed_x_handles, ["0xLiamVisionary"]);
assert.match(latestRequest.prompt_cache_key, /^hmos-pc-[a-f0-9]{40}$/);

const xaiOauthSource = readFileSync(
  new URL("../src/lib/services/xai-oauth.ts", import.meta.url),
  "utf8",
);
assert.match(xaiOauthSource, /export async function getXaiOAuthAccess/);

const streamHttpSource = readFileSync(
  new URL("../src/app/api/chat/agent-runtime/stream-http-runtime.ts", import.meta.url),
  "utf8",
);
assert.match(streamHttpSource, /resolveXaiOAuthRuntimeProfile/);
assert.match(streamHttpSource, /isXaiOAuthProvider/);
assert.doesNotMatch(
  streamHttpSource,
  /xAccountReadAnswer|latestOwnXPostAnswer/,
  "generic agent chat must let the model select the X account operation instead of intercepting wording",
);

const openAiCompatibleSource = readFileSync(
  new URL("../src/app/api/chat/agent-runtime/stream-openai-compatible.ts", import.meta.url),
  "utf8",
);
assert.match(openAiCompatibleSource, /X_ACCOUNT_RUNTIME_TOOL_DEFINITION/);
assert.match(openAiCompatibleSource, /runXAccountRuntimeTool/);
assert.match(openAiCompatibleSource, /call\.name === X_ACCOUNT_RUNTIME_TOOL_NAME/);
assert.match(openAiCompatibleSource, /offerXAccountTool \? 3/, "generic agents get a bounded multi-read X tool loop");

const xAccountRuntimeToolSource = readFileSync(
  new URL("../src/app/api/chat/agent-runtime/x-account-runtime-tool.ts", import.meta.url),
  "utf8",
);
assert.match(xAccountRuntimeToolSource, /X_ACCOUNT_READ_CHAT_TOOL/);
assert.match(xAccountRuntimeToolSource, /runXAccountReadTool/);

const typedQueenSource = readFileSync(
  new URL("../src/lib/services/queen-bee/typed-chat-turn.ts", import.meta.url),
  "utf8",
);
assert.match(typedQueenSource, /resolveXaiOAuthChatEndpoint/);
assert.match(typedQueenSource, /configuredBrainFailure/);
assert.doesNotMatch(
  typedQueenSource,
  /resolveXaiOAuthChatEndpoint\(\)\.catch\(\(\) => null\)/,
  "a broken selected Grok OAuth brain must not disappear silently",
);
assert.doesNotMatch(
  typedQueenSource,
  /xAccountReadAnswer|queenLatestXFastReply|latestOwnXPostAnswer/,
  "typed Queen chat must preserve model-selected chronology instead of intercepting wording",
);
assert.match(
  typedQueenSource,
  /configuredQueenProviderFallbacks/,
  "typed Queen chat should try another configured tool-capable provider when the selected OAuth brain is unusable",
);

const voiceQueenSource = readFileSync(
  new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
  "utf8",
);
assert.match(voiceQueenSource, /resolveXaiOAuthChatEndpoint/);
assert.match(voiceQueenSource, /stream_options:\s*\{ include_usage: true \}/);
assert.match(voiceQueenSource, /queen_voice\.inference/);
assert.doesNotMatch(
  voiceQueenSource,
  /xAccountReadAnswer|exactLatestXReply|voiceTranscriptRequestsImmediateAnswer/,
  "Queen voice must preserve model-selected capability use instead of intercepting wording",
);
assert.match(
  voiceQueenSource,
  /runConfiguredQueenProviderFallback/,
  "Queen voice should retain intelligent tool use through a configured provider fallback",
);

console.log("xAI OAuth inference routing contract ok");
