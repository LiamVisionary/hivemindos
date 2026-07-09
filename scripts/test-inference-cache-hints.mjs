import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function source(path) {
  return readFile(join(root, path), "utf8");
}

function includes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include ${needle}`);
}

function runTsxAssertion(code, label) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

const [
  helper,
  runtime,
  pageAgent,
  fusion,
  typedQueen,
  voiceQueen,
  modelsRoute,
] = await Promise.all([
  source("src/lib/services/chat/inference-cache-hints.ts"),
  source("src/app/api/chat/agent-runtime/stream-openai-compatible.ts"),
  source("src/app/api/page-agent/chat/completions/route.ts"),
  source("src/lib/services/fusion/client.ts"),
  source("src/lib/services/queen-bee/typed-chat-turn.ts"),
  source("src/lib/services/queen-bee/voice-turn.ts"),
  source("src/app/api/hivemindos/models/chat/completions/route.ts"),
]);

includes(helper, "body.prompt_cache_key", "OpenAI cache key body hint");
includes(helper, "body.session_id", "OpenRouter sticky session body hint");
includes(helper, "headers[\"x-grok-conv-id\"]", "xAI cache-routing header");
includes(helper, "body.cache_prompt = true", "llama.cpp prompt-cache body hint");
includes(helper, "openAICompatibleMessageCacheControlSupported", "explicit message cache-control support helper");
includes(runtime, "openAICompatibleInferenceCacheHints", "agent runtime cache hint wiring");
includes(runtime, "...winningRequest.cacheBody", "agent runtime continuation cache hints");
includes(pageAgent, "provider: \"openrouter\"", "Page Agent OpenRouter cache hints");
includes(fusion, "cacheScope: `fusion:${member.id}`", "Fusion per-member cache scope");
includes(typedQueen, "queenBrainCacheHints", "Queen typed cache hints");
includes(typedQueen, "QueenTypedSystemPrompt", "Queen typed stable/volatile prompt split");
includes(typedQueen, "openAICompatibleMessageCacheControlSupported", "Queen typed explicit cache-control blocks");
includes(voiceQueen, "cacheScope: `queen-voice:${target.provider}:${target.model}`", "Queen voice cache hints");
includes(voiceQueen, "conversationSystemContent", "Queen voice stable/volatile prompt split");
includes(voiceQueen, "cacheScope: \"queen-agent-turn-fallback\"", "Queen voice agent-turn fallback cache hints");
includes(modelsRoute, "cache_prompt: typeof body.cache_prompt === \"boolean\" ? body.cache_prompt : true", "free Scout proxy cache default");

runTsxAssertion(`
  import assert from "node:assert/strict";
  import {
    openAICompatibleInferenceCacheHints,
    openAICompatibleMessageCacheControlSupported,
  } from "./src/lib/services/chat/inference-cache-hints.ts";

  const openai = openAICompatibleInferenceCacheHints({ provider: "openai-api", model: "gpt-5.5", cacheScope: "scope" });
  assert.equal(typeof openai.body.prompt_cache_key, "string");
  assert.match(String(openai.body.prompt_cache_key), /^hmos-pc-[a-f0-9]{40}$/);
  assert.equal(openai.modes.includes("openai:prompt_cache_key"), true);

  const openrouter = openAICompatibleInferenceCacheHints({ provider: "openrouter", model: "openai/gpt-5.5", cacheScope: "scope" });
  assert.match(String(openrouter.body.session_id), /^hmos-pc-[a-f0-9]{40}$/);
  assert.equal(openrouter.modes.includes("openrouter:session_id"), true);

  const xai = openAICompatibleInferenceCacheHints({ provider: "xai", model: "grok-4.5", cacheScope: "scope" });
  assert.equal(typeof xai.headers["x-grok-conv-id"], "string");
  assert.equal(xai.modes.includes("xai:x-grok-conv-id"), true);

  const scout = openAICompatibleInferenceCacheHints({ provider: "hivemindos-models", model: "hivemindos/swarm-sovereign-scout", cacheScope: "scope" });
  assert.equal(scout.body.cache_prompt, true);
  assert.equal(scout.modes.includes("llama.cpp:cache_prompt"), true);

  assert.equal(openAICompatibleMessageCacheControlSupported({ provider: "openrouter", model: "~anthropic/claude-haiku-latest" }), true);
  assert.equal(openAICompatibleMessageCacheControlSupported({ provider: "openrouter", model: "qwen/qwen3.7-plus" }), true);
  assert.equal(openAICompatibleMessageCacheControlSupported({ provider: "openrouter", model: "openai/gpt-5.4-nano" }), false);
  assert.equal(openAICompatibleMessageCacheControlSupported({ provider: "openai", model: "gpt-4o-mini" }), false);
`, "cache hint behavior");

console.log("inference cache hints checks passed");
