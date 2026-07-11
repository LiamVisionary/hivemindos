import assert from "node:assert/strict";

import * as benchmarkModule from "../src/lib/services/hive-compute-benchmark.ts";

const { benchmarkHiveComputeModel } = benchmarkModule;

assert.equal(benchmarkModule.isHiveComputeBenchmarkableModel?.("text-embedding-nomic-embed-text-v1.5"), false, "embedding-only models must not enter the chat benchmark flow");
assert.equal(benchmarkModule.isHiveComputeBenchmarkableModel?.("swarm-sovereign-26b"), true, "chat generation models must remain benchmarkable");

const ollamaCalls = [];
let ollamaLoaded = false;
const ollamaBenchmark = await benchmarkHiveComputeModel({
  backend: { kind: "ollama", host: "http://127.0.0.1:11434" },
  model: "large/model-100b",
  fetchImpl: async (url, init) => {
    const requestUrl = String(url);
    const body = JSON.parse(String(init?.body || "{}"));
    ollamaCalls.push({ url: requestUrl, body });
    if (/\/api\/ps$/.test(requestUrl)) {
      return Response.json({ models: ollamaLoaded ? [{ model: "large/model-100b" }] : [] });
    }
    if (Array.isArray(body.messages) && body.messages.length === 0 && body.keep_alive === 0) {
      ollamaLoaded = false;
      return Response.json({ done: true, done_reason: "unload" });
    }
    ollamaLoaded = true;
    return Response.json({
      prompt_eval_count: 600,
      prompt_eval_duration: 3_000_000_000,
      eval_count: 40,
      eval_duration: 2_000_000_000,
    });
  },
  measuredAt: () => "2026-07-10T00:00:00.000Z",
});
const ollamaInferenceCalls = ollamaCalls.filter((call) => Array.isArray(call.body.messages) && call.body.messages.length > 0);
assert.equal(ollamaInferenceCalls.length, 4, "Ollama benchmarking needs one warmup and three measured samples");
assert.match(ollamaInferenceCalls[0].url, /\/api\/chat$/);
assert.equal(ollamaInferenceCalls[0].body.model, "large/model-100b");
assert.equal(ollamaLoaded, false, "a model loaded by the Ollama benchmark must be unloaded before the benchmark resolves");
assert.deepEqual(ollamaCalls.at(-1).body, { model: "large/model-100b", messages: [], keep_alive: 0, stream: false });
assert.equal(ollamaBenchmark.inputTokensPerSecond, 200);
assert.equal(ollamaBenchmark.outputTokensPerSecond, 20);
assert.equal(ollamaBenchmark.sampleSize, 3);
assert.equal(ollamaBenchmark.methodVersion, 2);
assert.equal(ollamaBenchmark.warmupCompleted, true);

let preloadedOllamaUnloadCalls = 0;
await benchmarkHiveComputeModel({
  backend: { kind: "ollama", host: "http://127.0.0.1:11434" },
  model: "already-loaded:latest",
  fetchImpl: async (url, init) => {
    const requestUrl = String(url);
    const body = JSON.parse(String(init?.body || "{}"));
    if (/\/api\/ps$/.test(requestUrl)) return Response.json({ models: [{ model: "already-loaded:latest" }] });
    if (Array.isArray(body.messages) && body.messages.length === 0 && body.keep_alive === 0) preloadedOllamaUnloadCalls += 1;
    return Response.json({
      prompt_eval_count: 600,
      prompt_eval_duration: 3_000_000_000,
      eval_count: 40,
      eval_duration: 2_000_000_000,
    });
  },
});
assert.equal(preloadedOllamaUnloadCalls, 0, "an Ollama model loaded before benchmarking must remain loaded");

const clock = [0, 1_000, 1_000, 3_000, 3_000, 4_000, 4_000, 8_000, 8_000, 8_960, 8_960, 10_880, 10_880, 11_360];
const openAiCalls = [];
const openAiBenchmark = await benchmarkHiveComputeModel({
  backend: { kind: "openai", host: "http://127.0.0.1:1234/v1" },
  model: "small/model-0.8b",
  now: () => clock.shift(),
  fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    openAiCalls.push({ url: String(url), body });
    return Response.json(body.max_tokens === 1
      ? { usage: { prompt_tokens: 400, completion_tokens: 1 }, choices: [{ message: { content: "ok" } }] }
      : { usage: { prompt_tokens: 20, completion_tokens: body.max_tokens === 8 ? 8 : 96 }, choices: [{ message: { content: "benchmark" } }] });
  },
  measuredAt: () => "2026-07-10T00:00:00.000Z",
});
assert.equal(openAiCalls.length, 7, "OpenAI-compatible benchmarking needs one warmup plus three prefill and three decode samples");
assert.ok(openAiCalls.every((call) => /\/chat\/completions$/.test(call.url)));
assert.equal(openAiBenchmark.inputTokensPerSecond, 200);
assert.equal(openAiBenchmark.outputTokensPerSecond, 100);
assert.equal(openAiBenchmark.sampleSize, 3);
assert.equal(openAiBenchmark.methodVersion, 2);
assert.equal(openAiBenchmark.warmupCompleted, true);

function nextClock() {
  let now = 0;
  return () => {
    const current = now;
    now += 1_000;
    return current;
  };
}

const lmStudioLoaded = new Set();
const lmStudioEvents = [];
const lmStudioModelIds = ["model-a-12b", "model-b-26b", "already-loaded-8b"];
const lmStudioFetch = async (url, init) => {
  const requestUrl = String(url);
  const body = JSON.parse(String(init?.body || "{}"));
  if (/\/api\/v1\/models$/.test(requestUrl)) {
    return Response.json({
      models: lmStudioModelIds.map((key) => ({
        key,
        loaded_instances: lmStudioLoaded.has(key) ? [{ id: key }] : [],
      })),
    });
  }
  if (/\/api\/v1\/models\/unload$/.test(requestUrl)) {
    lmStudioEvents.push(`unload:${body.instance_id}`);
    lmStudioLoaded.delete(body.instance_id);
    return Response.json({ instance_id: body.instance_id });
  }
  if (/\/chat\/completions$/.test(requestUrl)) {
    if (!lmStudioLoaded.has(body.model)) lmStudioEvents.push(`load:${body.model}`);
    lmStudioEvents.push(`benchmark:${body.model}`);
    lmStudioLoaded.add(body.model);
    return Response.json({
      usage: { prompt_tokens: body.max_tokens === 1 ? 400 : 20, completion_tokens: body.max_tokens },
      choices: [{ message: { content: "benchmark" } }],
    });
  }
  return new Response("unexpected LM Studio test URL", { status: 500 });
};

for (const model of ["model-a-12b", "model-b-26b"]) {
  await benchmarkHiveComputeModel({
    backend: { kind: "lmstudio", host: "http://127.0.0.1:1234/v1" },
    model,
    now: nextClock(),
    fetchImpl: lmStudioFetch,
  });
}
assert(lmStudioEvents.indexOf("unload:model-a-12b") < lmStudioEvents.indexOf("benchmark:model-b-26b"), "LM Studio must unload one benchmark-owned model before the next starts");
assert.deepEqual([...lmStudioLoaded], [], "sequential LM Studio benchmarks must leave no benchmark-owned model loaded");

lmStudioLoaded.add("already-loaded-8b");
await benchmarkHiveComputeModel({
  backend: { kind: "lmstudio", host: "http://127.0.0.1:1234/v1" },
  model: "already-loaded-8b",
  now: nextClock(),
  fetchImpl: lmStudioFetch,
});
assert.equal(lmStudioLoaded.has("already-loaded-8b"), true, "a model loaded before benchmarking must remain loaded");
assert.equal(lmStudioEvents.includes("unload:already-loaded-8b"), false, "preloaded LM Studio instances must never be claimed by benchmark cleanup");

const failedModelState = new Set();
await assert.rejects(
  () => benchmarkHiveComputeModel({
    backend: { kind: "lmstudio", host: "http://127.0.0.1:1234/v1" },
    model: "failed-model-12b",
    fetchImpl: async (url, init) => {
      const requestUrl = String(url);
      const body = JSON.parse(String(init?.body || "{}"));
      if (/\/api\/v1\/models$/.test(requestUrl)) {
        return Response.json({ models: [{ key: "failed-model-12b", loaded_instances: failedModelState.has("failed-model-12b") ? [{ id: "failed-model-12b" }] : [] }] });
      }
      if (/\/api\/v1\/models\/unload$/.test(requestUrl)) {
        failedModelState.delete(body.instance_id);
        return Response.json({ instance_id: body.instance_id });
      }
      failedModelState.add("failed-model-12b");
      return new Response("backend failed", { status: 500 });
    },
  }),
  /benchmark.*HTTP 500/i,
  "benchmark failures must remain actionable",
);
assert.deepEqual([...failedModelState], [], "a model loaded before a failed benchmark response must still be unloaded");

await assert.rejects(
  () => benchmarkHiveComputeModel({
    backend: { kind: "openai", host: "http://127.0.0.1:1234/v1" },
    model: "broken/model",
    fetchImpl: async () => new Response("backend failed", { status: 500 }),
  }),
  /benchmark.*HTTP 500/i,
  "generic OpenAI-compatible benchmark failures must remain actionable",
);

console.log("Hive Compute local benchmark tests passed.");
