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
assert.match(streamHttpSource, /latestOwnXPostAnswer/);

const typedQueenSource = readFileSync(
  new URL("../src/lib/services/queen-bee/typed-chat-turn.ts", import.meta.url),
  "utf8",
);
assert.match(typedQueenSource, /resolveXaiOAuthChatEndpoint/);

const voiceQueenSource = readFileSync(
  new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
  "utf8",
);
assert.match(voiceQueenSource, /resolveXaiOAuthChatEndpoint/);
assert.match(voiceQueenSource, /stream_options:\s*\{ include_usage: true \}/);
assert.match(voiceQueenSource, /queen_voice\.inference/);

console.log("xAI OAuth inference routing contract ok");
