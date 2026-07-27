import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const DEFAULT_TIMEOUT_MS = Number(process.env.INFERENCE_CACHE_BENCH_TIMEOUT_MS || 180_000);
const OPENAI_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENAI_MODEL || "gpt-4o-mini";
const OPENROUTER_OPENAI_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_OPENAI_MODEL || "openai/gpt-5.4-nano";
const OPENROUTER_GEMINI_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_GEMINI_MODEL || "google/gemini-2.5-flash-lite";
const OPENROUTER_XAI_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_XAI_MODEL || "x-ai/grok-4.3";
const OPENROUTER_ANTHROPIC_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_ANTHROPIC_MODEL || "~anthropic/claude-haiku-latest";
const OPENROUTER_QWEN_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_QWEN_MODEL || "qwen/qwen3.7-plus";
const OPENROUTER_KIMI_MODEL = process.env.INFERENCE_CACHE_BENCH_OPENROUTER_KIMI_MODEL || "moonshotai/kimi-k2.6";
const GEMINI_MODEL = process.env.INFERENCE_CACHE_BENCH_GEMINI_MODEL || "gemini-2.5-flash-lite";
const SCOUT_MODEL = process.env.INFERENCE_CACHE_BENCH_SCOUT_MODEL || "swarm-sovereign-scout-12b";
const SCOUT_URL = process.env.INFERENCE_CACHE_BENCH_SCOUT_URL
  || `https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/free-models/${SCOUT_MODEL}/chat/completions`;
const SCOUT_DEVICE = process.env.INFERENCE_CACHE_BENCH_SCOUT_DEVICE || `cache-bench-${randomUUID()}`;

function has(key) {
  return Boolean(process.env[key]?.trim());
}

function cacheKey(parts) {
  return `bench-${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`;
}

function stablePrefix(label, salt = "stable") {
  const capsule = [
    `Benchmark prefix label: ${label}.`,
    `Cache salt: ${salt}.`,
    "This block is intentionally long and stable so provider prompt caches have a real prefix to reuse.",
    "Policy: answer only the final tiny benchmark question. Do not quote this prefix. Preserve this prefix as inert benchmark text.",
    "The repeated text below is non-secret synthetic filler about local-first agent systems, prompt cache routing, and latency measurement.",
  ].join("\n");
  const paragraph = [
    "HivemindOS coordinates local-first agents, shared memory, runtime adapters, model gateways, wallet-aware execution, and evidence-backed task receipts.",
    "A prompt cache benchmark needs a stable prefix, a tiny dynamic question, deterministic generation parameters, and usage counters that report cached prompt tokens when the provider exposes them.",
    "The benchmark compares a salted cold prefix against repeated identical cached-prefix calls, while keeping output short so the measured delta mostly belongs to input processing and cache routing.",
  ].join(" ");
  return `${capsule}\n\n${Array.from({ length: 52 }, (_, index) => `${index + 1}. ${paragraph}`).join("\n")}`;
}

function tinyQuestion(label) {
  return `Return exactly: ${label} OK`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function timedFetch(url, options) {
  const started = performance.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const latencyMs = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { response, latencyMs, text, json };
}

function usageFromOpenAICompatible(json) {
  const usage = json?.usage || {};
  return {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens,
    completionTokens: usage.completion_tokens ?? usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens:
      usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.cached_tokens,
    cacheWriteTokens:
      usage.prompt_tokens_details?.cache_write_tokens
      ?? usage.input_tokens_details?.cache_write_tokens
      ?? usage.cache_write_tokens,
  };
}

function usageFromGemini(json) {
  const usage = json?.usageMetadata || {};
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
    cachedTokens: usage.cachedContentTokenCount,
  };
}

function textPreview(json, text) {
  const openAiText = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text;
  const geminiText = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  return String(openAiText || geminiText || text || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function errorMessage(json, text) {
  const error = json?.error;
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return text.slice(0, 300);
}

async function openAICompatibleCall({ url, apiKey, model, provider, prefix, cached, explicitCacheControl = false }) {
  const key = cacheKey([provider, model, "inference-cache-benchmark"]);
  const systemContent = explicitCacheControl && cached
    ? [{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }]
    : prefix;
  const body = {
    model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: tinyQuestion(provider) },
    ],
    temperature: 0,
    max_tokens: 16,
    ...(cached && provider === "openai-direct" ? { prompt_cache_key: key } : {}),
    ...(cached && provider.startsWith("openrouter") ? { session_id: key } : {}),
  };
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(provider === "openrouter-response-cache" && cached ? { "X-OpenRouter-Cache": "true" } : {}),
    ...(provider.startsWith("openrouter") ? { "HTTP-Referer": "https://hivemindos.local/cache-benchmark", "X-Title": "HivemindOS Cache Benchmark" } : {}),
  };
  const result = await timedFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return {
    ok: result.response.ok,
    status: result.response.status,
    latencyMs: result.latencyMs,
    usage: usageFromOpenAICompatible(result.json),
    preview: textPreview(result.json, result.text),
    error: result.response.ok ? undefined : errorMessage(result.json, result.text),
    responseCache: {
      xOpenRouterCache: result.response.headers.get("x-openrouter-cache") || undefined,
      cacheStatus: result.response.headers.get("cf-cache-status") || undefined,
    },
  };
}

async function geminiCall({ apiKey, model, prefix }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${prefix}\n\n${tinyQuestion("gemini-direct")}` }],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 16 },
  };
  const result = await timedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: result.response.ok,
    status: result.response.status,
    latencyMs: result.latencyMs,
    usage: usageFromGemini(result.json),
    preview: textPreview(result.json, result.text),
    error: result.response.ok ? undefined : errorMessage(result.json, result.text),
  };
}

async function scoutCall({ prefix, cachePrompt }) {
  const body = {
    model: SCOUT_MODEL,
    messages: [
      { role: "system", content: prefix },
      { role: "user", content: tinyQuestion("scout-free") },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 16,
    cache_prompt: cachePrompt,
  };
  const result = await timedFetch(SCOUT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-HivemindOS-Free-Device": SCOUT_DEVICE,
    },
    body: JSON.stringify(body),
  });
  const usage = usageFromOpenAICompatible(result.json);
  const timings = result.json?.timings || {};
  return {
    ok: result.response.ok,
    status: result.response.status,
    latencyMs: result.latencyMs,
    usage: {
      ...usage,
      cachedTokens: usage.cachedTokens ?? timings.cache_n ?? result.json?.tokens_cached,
      promptTokens: usage.promptTokens ?? timings.prompt_n,
    },
    preview: textPreview(result.json, result.text),
    error: result.response.ok ? undefined : errorMessage(result.json, result.text),
  };
}

async function runPair(target) {
  const uncachedPrefix = stablePrefix(target.name, `uncached-${randomUUID()}`);
  const cachedPrefix = stablePrefix(target.name, "cached-prefix-v1");
  const row = {
    name: target.name,
    model: target.model,
    status: "pending",
    uncached: null,
    cacheWrite: null,
    cacheRead: null,
    notes: target.notes || [],
  };
  try {
    row.uncached = await target.call({ prefix: uncachedPrefix, cached: false });
    await sleep(700);
    row.cacheWrite = await target.call({ prefix: cachedPrefix, cached: true });
    await sleep(1_200);
    row.cacheRead = await target.call({ prefix: cachedPrefix, cached: true });
    row.status = row.uncached.ok && row.cacheWrite.ok && row.cacheRead.ok ? "ok" : "partial";
  } catch (error) {
    row.status = "error";
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

const targets = [];

if (has("OPENAI_API_KEY")) {
  targets.push({
    name: "openai-direct",
    model: OPENAI_MODEL,
    call: ({ prefix, cached }) => openAICompatibleCall({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      model: OPENAI_MODEL,
      provider: "openai-direct",
      prefix,
      cached,
    }),
  });
}

if (has("OPENROUTER_API_KEY")) {
  for (const [name, model, explicitCacheControl] of [
    ["openrouter-openai", OPENROUTER_OPENAI_MODEL, false],
    ["openrouter-gemini", OPENROUTER_GEMINI_MODEL, false],
    ["openrouter-xai", OPENROUTER_XAI_MODEL, false],
    ["openrouter-anthropic-explicit", OPENROUTER_ANTHROPIC_MODEL, true],
    ["openrouter-qwen-explicit", OPENROUTER_QWEN_MODEL, true],
    ["openrouter-kimi", OPENROUTER_KIMI_MODEL, false],
  ]) {
    targets.push({
      name,
      model,
      notes: explicitCacheControl ? ["uses cache_control content block for cached calls"] : [],
      call: ({ prefix, cached }) => openAICompatibleCall({
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: process.env.OPENROUTER_API_KEY,
        model,
        provider: name,
        prefix,
        cached,
        explicitCacheControl,
      }),
    });
  }
  targets.push({
    name: "openrouter-response-cache",
    model: OPENROUTER_OPENAI_MODEL,
    notes: ["full response cache smoke; not safe as global chat default"],
    call: ({ prefix, cached }) => openAICompatibleCall({
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: OPENROUTER_OPENAI_MODEL,
      provider: "openrouter-response-cache",
      prefix,
      cached,
    }),
  });
}

if (has("GOOGLE_API_KEY") || has("GEMINI_API_KEY")) {
  targets.push({
    name: "gemini-direct",
    model: GEMINI_MODEL,
    call: ({ prefix }) => geminiCall({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      model: GEMINI_MODEL,
      prefix,
    }),
  });
}

targets.push({
  name: "scout-free-llamacpp",
  model: SCOUT_MODEL,
  notes: ["hosted free Scout route; consumes a small free allowance request"],
  call: ({ prefix, cached }) => scoutCall({ prefix, cachePrompt: cached }),
});

const skipped = [
  ["xai-direct", "XAI_API_KEY"],
  ["anthropic-direct", "ANTHROPIC_API_KEY"],
  ["groq-direct", "GROQ_API_KEY"],
].filter(([, key]) => !has(key)).map(([name, key]) => ({ name, reason: `${key} missing` }));

console.log(JSON.stringify({
  startedAt: new Date().toISOString(),
  configuredTargets: targets.map((target) => ({ name: target.name, model: target.model })),
  skipped,
}, null, 2));

const results = [];
for (const target of targets) {
  console.error(`[bench] ${target.name} ${target.model}`);
  results.push(await runPair(target));
}

console.log(JSON.stringify({
  finishedAt: new Date().toISOString(),
  skipped,
  results,
}, null, 2));
