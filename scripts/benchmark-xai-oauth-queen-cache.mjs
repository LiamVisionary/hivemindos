#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { getXaiOAuthAccess } = await import("../src/lib/services/xai-oauth.ts");
const { xaiOAuthChatRequestOptions } = await import(
  "../src/lib/services/xai-oauth-inference-contract.ts"
);

const access = await getXaiOAuthAccess();
const url = `${access.baseUrl.replace(/\/+$/, "")}/chat/completions`;
const stablePrefix = Array.from(
  { length: 180 },
  (_, index) =>
    `Static Queen Bee operating invariant ${index + 1}: be concise, accurate, and preserve verified context.`,
).join("\n");

function usageSummary(usage = {}) {
  const inputDetails = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const outputDetails = usage.completion_tokens_details ?? usage.output_tokens_details ?? {};
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    cachedTokens: inputDetails.cached_tokens ?? null,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    reasoningTokens: outputDetails.reasoning_tokens ?? null,
  };
}

async function run(label, system, turn, cacheKey = "") {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "content-type": "application/json",
      ...(cacheKey ? { "x-grok-conv-id": cacheKey } : {}),
    },
    body: JSON.stringify({
      model: "grok-4.5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Reply with only OK. Benchmark turn ${turn}.` },
      ],
      ...xaiOAuthChatRequestOptions("grok-4.5"),
      max_completion_tokens: 80,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null);
  return {
    label,
    ok: response.ok,
    status: response.status,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    model: data?.model ?? null,
    ...usageSummary(data?.usage),
  };
}

const runId = Date.now();
const cacheKey = `hmos-queen-cache-benchmark-${runId}`;
const results = [];
results.push(await run("forced-miss-1", `unique-a-${runId}\n${stablePrefix}`, "A"));
results.push(await run("forced-miss-2", `unique-b-${runId}\n${stablePrefix}`, "B"));
results.push(await run("cache-write", stablePrefix, "C", cacheKey));
results.push(await run("cache-read-1", stablePrefix, "D", cacheKey));
results.push(await run("cache-read-2", stablePrefix, "E", cacheKey));

console.log(JSON.stringify(results, null, 2));
