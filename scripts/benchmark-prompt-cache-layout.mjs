import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const MODEL = process.env.PROMPT_CACHE_LAYOUT_MODEL || "swarm-sovereign-scout-12b";
const URL = process.env.PROMPT_CACHE_LAYOUT_URL
  || `https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/free-models/${MODEL}/chat/completions`;
const DEVICE = process.env.PROMPT_CACHE_LAYOUT_DEVICE || `prompt-layout-bench-${randomUUID()}`;
const TIMEOUT_MS = Number(process.env.PROMPT_CACHE_LAYOUT_TIMEOUT_MS || 180_000);
const BASE_REPEATS = Number(process.env.PROMPT_CACHE_LAYOUT_BASE_REPEATS || 35);
const STABLE_AFTER_REPEATS = Number(process.env.PROMPT_CACHE_LAYOUT_STABLE_AFTER_REPEATS || 145);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function repeatBlock(title, repeats) {
  const paragraph = [
    `${title}.`,
    "Stable HivemindOS operating instructions for local-first agents, evidence-backed execution, wallet safety, tool discipline, runtime routing, shared brain usage, and completion reporting.",
    "This text is synthetic benchmark filler, not private context, and should remain byte-identical between write and read calls.",
  ].join(" ");
  return Array.from({ length: repeats }, (_, index) => `${index + 1}. ${paragraph}`).join("\n");
}

function volatileBlock(label) {
  return [
    "Volatile turn context:",
    `- Dynamic retrieval id: ${label}-${randomUUID()}`,
    `- Runtime session id: session-${randomUUID()}`,
    `- Latest user request hash: request-${randomUUID()}`,
    "This block intentionally changes between cache write and cache read.",
  ].join("\n");
}

const stableFront = [
  "Stable cache tier: HivemindOS base prompt.",
  repeatBlock("Base prompt static policy", BASE_REPEATS),
].join("\n\n");

const stableAfter = [
  "Stable cache tier: profile, tools, wallet, and reusable capability policy.",
  repeatBlock("Stable profile and tool context", STABLE_AFTER_REPEATS),
].join("\n\n");

function legacyPrompt(label) {
  return [
    stableFront,
    volatileBlock(`legacy-${label}`),
    stableAfter,
    "Final instruction: answer only the tiny benchmark question.",
  ].join("\n\n");
}

function optimizedPrompt(label) {
  return [
    stableFront,
    stableAfter,
    volatileBlock(`optimized-${label}`),
    "Final instruction: answer only the tiny benchmark question.",
  ].join("\n\n");
}

function usageFrom(json) {
  const usage = json?.usage || {};
  const timings = json?.timings || {};
  return {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? timings.prompt_n,
    completionTokens: usage.completion_tokens ?? usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens:
      usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.cached_tokens
      ?? timings.cache_n
      ?? json?.tokens_cached,
    promptMs: timings.prompt_ms,
    predictedMs: timings.predicted_ms,
    cacheN: timings.cache_n,
  };
}

function hitPercent(usage) {
  const promptTokens = Number(usage.promptTokens || 0);
  const cachedTokens = Number(usage.cachedTokens || 0);
  return promptTokens > 0 ? Number(((cachedTokens / promptTokens) * 100).toFixed(2)) : 0;
}

async function scoutCall(name, system) {
  const started = performance.now();
  const response = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-HivemindOS-Free-Device": DEVICE,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Return exactly: ${name} OK` },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 8,
      cache_prompt: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const latencyMs = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave text preview */
  }
  const usage = usageFrom(json);
  return {
    name,
    ok: response.ok,
    status: response.status,
    latencyMs,
    usage,
    hitPercent: hitPercent(usage),
    preview: String(json?.choices?.[0]?.message?.content || text || "").replace(/\s+/g, " ").trim().slice(0, 100),
    error: response.ok ? undefined : (json?.error?.message || json?.error || text.slice(0, 240)),
  };
}

const steps = [
  ["warmup", "Warmup only. Return exactly: warmup OK", 800],
  ["legacy-write", legacyPrompt("write"), 1_200],
  ["legacy-read", legacyPrompt("read"), 1_200],
  ["optimized-write", optimizedPrompt("write"), 1_200],
  ["optimized-read", optimizedPrompt("read"), 0],
];

const results = [];
for (const [name, system, delay] of steps) {
  console.error(`[prompt-cache-layout] ${name}`);
  results.push(await scoutCall(name, system));
  if (delay) await pause(delay);
}

const legacyRead = results.find((row) => row.name === "legacy-read");
const optimizedRead = results.find((row) => row.name === "optimized-read");

console.log(JSON.stringify({
  finishedAt: new Date().toISOString(),
  url: URL,
  model: MODEL,
  metric: "cache read hitPercent = cachedTokens / promptTokens * 100",
  comparison: {
    legacyHitPercent: legacyRead?.hitPercent,
    optimizedHitPercent: optimizedRead?.hitPercent,
    deltaPercentagePoints:
      typeof legacyRead?.hitPercent === "number" && typeof optimizedRead?.hitPercent === "number"
        ? Number((optimizedRead.hitPercent - legacyRead.hitPercent).toFixed(2))
        : undefined,
  },
  results,
}, null, 2));
