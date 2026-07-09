import { createHash } from "node:crypto";

import { isFreeHivemindosWalletPaidModel } from "@/lib/config/hivemindos-wallet-paid-models";

export type OpenAICompatibleInferenceCacheInput = {
  provider?: string | null;
  model?: string | null;
  cacheScope?: string | null;
};

export type OpenAICompatibleInferenceCacheHints = {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  modes: string[];
};

function normalizedProvider(provider: string | null | undefined) {
  const value = provider?.trim().toLowerCase() || "openai";
  if (value === "openai-api") return "openai";
  if (value === "grok") return "xai";
  if (value === "llamacpp" || value === "llama-cpp") return "llama.cpp";
  return value;
}

function normalizedModel(model: string | null | undefined) {
  return model?.trim() || "default";
}

export function inferencePromptCacheKey(input: OpenAICompatibleInferenceCacheInput) {
  const provider = normalizedProvider(input.provider);
  const model = normalizedModel(input.model);
  const scope = input.cacheScope?.trim() || "default";
  const digest = createHash("sha256")
    .update([provider, model, scope].join("\n"))
    .digest("hex")
    .slice(0, 40);
  return `hmos-pc-${digest}`;
}

export function openAICompatibleInferenceCacheHints(
  input: OpenAICompatibleInferenceCacheInput,
): OpenAICompatibleInferenceCacheHints {
  const provider = normalizedProvider(input.provider);
  const model = normalizedModel(input.model);
  const cacheKey = inferencePromptCacheKey({ provider, model, cacheScope: input.cacheScope });
  const body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const modes: string[] = [];

  if (provider === "openai") {
    body.prompt_cache_key = cacheKey;
    modes.push("openai:prompt_cache_key");
  }

  if (provider === "openrouter") {
    body.session_id = cacheKey;
    modes.push("openrouter:session_id");
  }

  if (provider === "xai") {
    headers["x-grok-conv-id"] = cacheKey;
    modes.push("xai:x-grok-conv-id");
  }

  if (
    provider === "llama.cpp" ||
    (provider === "hivemindos-models" && isFreeHivemindosWalletPaidModel(model))
  ) {
    body.cache_prompt = true;
    modes.push("llama.cpp:cache_prompt");
  }

  return { body, headers, modes };
}
