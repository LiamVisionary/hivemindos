import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

import { optionalEnv } from "@/lib/config/env";
import {
  OPENAI_OAUTH_RESPONSES_BASE_URL,
  openAiOAuthFetch,
} from "@/lib/services/openai-oauth";
import { resolvePreferredOpenAiChatRoute } from "@/lib/services/openai-preferred-chat";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

async function credential(key: string): Promise<string> {
  return optionalEnv(key) || await hiveEnvValue(key).catch(() => "");
}

async function chatGptOAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body !== "string") return openAiOAuthFetch(input, init);
  const body = JSON.parse(init.body) as Record<string, unknown>;
  // The subscription backend rejects sampling and output-limit parameters
  // that the public Responses API accepts. HivemindOS bounds the route itself.
  delete body.temperature;
  delete body.max_output_tokens;
  body.store = false;
  body.reasoning = { effort: "low" };
  return openAiOAuthFetch(input, { ...init, body: JSON.stringify(body) });
}

/**
 * Resolves the chat model using the canonical OpenAI preference first, then
 * the remaining environment providers in their existing order:
 * ChatGPT OAuth → OPENAI_API_KEY → OpenAI
 * ANTHROPIC_API_KEY → Anthropic
 * GROQ_API_KEY → Groq
 * LOCAL_OPENAI_BASE_URL → local OpenAI-compatible /v1
 * OLLAMA_BASE_URL → Ollama (OpenAI-compatible /v1)
 */
export async function getLanguageModel(): Promise<LanguageModel> {
  const requestedOpenAiModel = optionalEnv("OPENAI_MODEL") || "gpt-4o";
  const openAiRoute = await resolvePreferredOpenAiChatRoute(requestedOpenAiModel);
  if (openAiRoute.auth === "oauth") {
    const openai = createOpenAI({
      baseURL: OPENAI_OAUTH_RESPONSES_BASE_URL,
      // The SDK requires a value, but the canonical fetch injects the refreshed
      // OAuth credential after stripping any caller-owned authorization header.
      apiKey: "oauth-managed",
      name: "chatgpt-oauth",
      fetch: chatGptOAuthFetch,
    });
    return openai.responses(openAiRoute.model);
  }

  const openAiApiKey = await credential("OPENAI_API_KEY");
  if (openAiApiKey) {
    const openai = createOpenAI({ apiKey: openAiApiKey });
    return openai(openAiRoute.model);
  }

  const anthropicApiKey = await credential("ANTHROPIC_API_KEY");
  if (anthropicApiKey) {
    const anthropic = createAnthropic({
      apiKey: anthropicApiKey,
    });
    return anthropic(optionalEnv("ANTHROPIC_MODEL") || "claude-3-5-sonnet-20241022");
  }

  const groqApiKey = await credential("GROQ_API_KEY");
  if (groqApiKey) {
    const groq = createGroq({ apiKey: groqApiKey });
    return groq(optionalEnv("GROQ_MODEL") || "llama-3.3-70b-versatile");
  }

  const localOpenAiBaseUrl = optionalEnv("LOCAL_OPENAI_BASE_URL");
  if (localOpenAiBaseUrl) {
    const base = localOpenAiBaseUrl.replace(/\/$/, "");
    const localOpenAI = createOpenAI({
      baseURL: `${base}/v1`,
      apiKey: optionalEnv("LOCAL_OPENAI_API_KEY") || "local",
      name: "local-openai",
    });
    return localOpenAI(optionalEnv("LOCAL_OPENAI_MODEL") || "local-model");
  }

  const ollamaBaseUrl = optionalEnv("OLLAMA_BASE_URL");
  if (ollamaBaseUrl) {
    const base = ollamaBaseUrl.replace(/\/$/, "");
    const ollama = createOpenAI({
      baseURL: `${base}/v1`,
      apiKey: "ollama",
      name: "ollama",
    });
    return ollama(optionalEnv("OLLAMA_MODEL") || "llama3.2");
  }

  throw new Error(
    "No LLM configured. Connect ChatGPT OAuth or set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, LOCAL_OPENAI_BASE_URL, or OLLAMA_BASE_URL.",
  );
}
