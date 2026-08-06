#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildSieWarmRequest,
  discoverSieProviderModels,
  normalizeSieHealth,
  normalizeSieModels,
  runSieAction,
} from "../src/lib/services/runtime-adapters/sie.ts";
import {
  LOCAL_MODEL_RUNTIME_CAPABILITIES,
  SIE_PROVIDER_ID,
} from "../src/lib/config/local-model-runtimes.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");

const modelPayload = {
  data: [
    { id: "acme/chat-7b" },
    { id: "acme/embed-1b" },
    { id: "acme/rerank-1b" },
    { id: "acme/legacy-unknown" },
  ],
  models: [
    {
      name: "acme/chat-7b",
      loaded: true,
      state: "loaded",
      inputs: ["text"],
      outputs: ["text"],
      max_sequence_length: 32768,
      profiles: { default: { is_default: true }, fp8: { is_default: false } },
      capabilities: { grammar: ["json_schema"], tools: true, code: true, sql: false, guard: false },
    },
    {
      name: "acme/embed-1b",
      state: "available",
      inputs: ["text"],
      outputs: ["dense", "sparse"],
      dims: { dense: 1024, sparse: 250002 },
      capabilities: null,
    },
    {
      name: "acme/rerank-1b",
      state: "failed",
      inputs: ["text"],
      outputs: ["score"],
      last_error: { code: "oom", message: "GPU memory exhausted", attempts: 2 },
      capabilities: null,
    },
  ],
};

const healthPayload = {
  status: "healthy",
  type: "gateway",
  cluster: { worker_count: 1, gpu_count: 2, models_loaded: 1, total_qps: 3.5 },
  configured_gpu_types: ["l4"],
  live_gpu_types: ["l4"],
  workers: [{
    name: "worker-a",
    url: "http://worker-a:8080",
    gpu: "l4",
    gpu_count: 2,
    ready_gpu_slots: 1,
    healthy: true,
    queue_depth: 3,
    pending_cost: 5,
    inflight_batches: 1,
    loaded_models: ["acme/chat-7b"],
    memory_used_bytes: 12_000_000_000,
    memory_total_bytes: 24_000_000_000,
    bundle: "mixed",
  }],
};

const models = normalizeSieModels(modelPayload);
assert.equal(models.length, 4, "native models and unmatched OpenAI rows should remain visible");
const chat = models.find((model) => model.key === "acme/chat-7b");
const embedding = models.find((model) => model.key === "acme/embed-1b");
const reranker = models.find((model) => model.key === "acme/rerank-1b");
const unknown = models.find((model) => model.key === "acme/legacy-unknown");
assert.deepEqual(chat?.tasks, ["chat"]);
assert.equal(chat?.loaded, true);
assert.equal(chat?.chatCompatible, true);
assert.equal(chat?.maxContextLength, 32768);
assert.deepEqual(chat?.profiles, ["default", "fp8"]);
assert.deepEqual(embedding?.tasks, ["embedding"]);
assert.equal(embedding?.warmKind, "embedding");
assert.equal(reranker?.state, "failed");
assert.match(reranker?.lastError || "", /oom.*GPU memory exhausted.*2 attempts/);
assert.equal(reranker?.canWarm, false, "task-specific rerank calls must not be faked with a chat warm-up");
assert.equal(unknown?.chatCompatible, false, "an unmatched OpenAI row must not be guessed to be a chat model");

const health = normalizeSieHealth(healthPayload);
assert.equal(health.cluster.workerCount, 1);
assert.equal(health.cluster.gpuCount, 2);
assert.equal(health.cluster.modelsLoaded, 1);
assert.equal(health.workers[0]?.queueDepth, 3);
assert.deepEqual(health.workers[0]?.loadedModels, ["acme/chat-7b"]);

assert.equal(LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID].explicitLoad, false);
assert.equal(LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID].explicitUnload, false);
assert.equal(LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID].warmOnDemand, true);
assert.equal(LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID].automaticEviction, true);
assert.equal(buildSieWarmRequest(chat)?.path, "/v1/chat/completions");
assert.equal(buildSieWarmRequest(embedding)?.path, "/v1/embeddings");
assert.equal(buildSieWarmRequest(reranker), null);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const calls = [];
const fetcher = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
  if (url.endsWith("/v1/models")) return jsonResponse(modelPayload);
  if (url.endsWith("/health")) return jsonResponse(healthPayload);
  if (url.endsWith("/v1/chat/completions")) return jsonResponse({ choices: [{ message: { content: "OK" } }] });
  if (url.endsWith("/v1/embeddings")) return jsonResponse({ data: [{ embedding: [0, 1] }] });
  return jsonResponse({ error: { message: "not found" } }, 404);
};

const agent = {
  id: "sie-test",
  runtime: "hivemind-os",
  provider: "sie",
  gatewayUrl: "http://127.0.0.1:18080/",
  chatPath: "/v1/chat/completions",
  statusPath: "/v1/models",
  token: "",
};
const status = await discoverSieProviderModels(agent, fetcher);
assert.equal(status.baseUrl, "http://127.0.0.1:18080");
assert.equal(status.models.length, 4);
assert.equal(status.workers.length, 1);
assert.equal(status.error, undefined);
assert.equal(status.healthError, undefined);

const chatWarm = await runSieAction(agent, "warm-model", { model: "acme/chat-7b" }, fetcher);
assert.equal(chatWarm.ok, true);
assert.equal(calls.at(-1)?.url, "http://127.0.0.1:18080/v1/chat/completions");
assert.deepEqual(calls.at(-1)?.body?.messages, [{ role: "user", content: "Reply with OK." }]);

const embeddingWarm = await runSieAction(agent, "warm-model", { model: "acme/embed-1b" }, fetcher);
assert.equal(embeddingWarm.ok, true);
assert.equal(calls.at(-1)?.url, "http://127.0.0.1:18080/v1/embeddings");
assert.equal(calls.at(-1)?.body?.input, "warmup");

const callsBeforeUnsupportedWarm = calls.length;
const unsupportedWarm = await runSieAction(agent, "warm-model", { model: "acme/rerank-1b" }, fetcher);
assert.equal(unsupportedWarm.ok, false);
assert.match(unsupportedWarm.error || "", /first task-specific SIE request/);
assert.equal(calls.length, callsBeforeUnsupportedWarm + 2, "unsupported warm-up should only refresh models and health");

const uiSource = await readFile(join(rootDir, "src/features/dashboard/views/chat/SieModelManager.tsx"), "utf8");
const collectorSource = await readFile(join(rootDir, "scripts/agent-telemetry-collector.mjs"), "utf8");
const modalSource = await readFile(join(rootDir, "src/features/dashboard/views/chat/AgentSettingsModal.tsx"), "utf8");
const gatewaySource = await readFile(join(rootDir, "src/lib/config/model-provider-gateways.ts"), "utf8");
const integrationSource = await readFile(join(rootDir, "src/lib/services/runtime-integrations.ts"), "utf8");
assert.match(uiSource, /Models load on first use/);
assert.match(uiSource, /worker\.memoryUsedBytes/);
assert.match(uiSource, /model\.chatCompatible/);
assert.doesNotMatch(uiSource, />Unload</, "SIE must not expose an unload control the API cannot honor");
assert.match(collectorSource, /provider === "sie"/);
assert.match(collectorSource, /readSieStatus/);
assert.match(collectorSource, /HERMES_GATEWAY_PROVIDERS[\s\S]*sie:/, "new remote Hermes profiles should define the SIE gateway");
assert.match(collectorSource, /providerStatus: sieStatus \? \{ sie: sieStatus \}/, "remote Hermes status should carry SIE telemetry");
assert.match(collectorSource, /localModelProvider === "sie"/, "remote warm actions should route through the local-model bridge");
assert.match(modalSource, /<SieModelManager/);
assert.match(gatewaySource, /slug: "sie"[\s\S]*Shared-GPU lazy model runtime/);
assert.match(integrationSource, /runSieAction/);
assert.match(integrationSource, /sieProviderBase/, "custom SIE endpoints should reach Hermes provider setup");

console.log("SIE model runtime integration tests passed.");
