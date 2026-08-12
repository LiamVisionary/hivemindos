import "server-only";

import { optionalEnv } from "@/lib/config/env";
import {
  choosePreferredOpenAiChatRoute,
  executeOpenAiChatRoute,
  type PreferredOpenAiChatRoute,
} from "@/lib/config/openai-provider-routing";
import { openAICompatibleInferenceCacheHints } from "@/lib/services/chat/inference-cache-hints";
import {
  openAiOAuthConfigured,
  preferOpenAiApiKey,
  runOpenAiOAuthChatTurn,
} from "@/lib/services/openai-oauth";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { resilientHttpsFetch } from "@/lib/net/resilient-https-fetch";

export type PreferredOpenAiTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PreferredOpenAiTextTurnInput = {
  model: string;
  messages: PreferredOpenAiTextMessage[];
  cacheScope: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  errorContext: string;
  onTextDelta?: (chunk: string) => void;
};

export type PreferredOpenAiTextTurnResult = PreferredOpenAiChatRoute & {
  text: string;
};

export async function resolveOpenAiApiKeyChatEndpoint(): Promise<{
  url: string;
  key: string;
} | null> {
  const key = await hiveEnvValue("OPENAI_API_KEY").catch(() => "");
  return key ? { url: "https://api.openai.com/v1/chat/completions", key } : null;
}

export async function resolvePreferredOpenAiChatRoute(
  requestedModel: string,
): Promise<PreferredOpenAiChatRoute> {
  const [oauthConfigured, preferApiKey] = await Promise.all([
    openAiOAuthConfigured().catch(() => false),
    preferOpenAiApiKey().catch(() => false),
  ]);
  return choosePreferredOpenAiChatRoute({
    oauthConfigured,
    preferApiKey,
    requestedModel,
    oauthModel: optionalEnv("OPENAI_OAUTH_CHAT_MODEL"),
  });
}

function apiInferenceOptions(model: string, input: PreferredOpenAiTextTurnInput) {
  const reasoningModel = /^(o\d|gpt-5|codex)/i.test(model.trim());
  return reasoningModel
    ? { max_completion_tokens: input.maxTokens ?? 800, reasoning_effort: "low" }
    : { max_tokens: input.maxTokens ?? 800, temperature: input.temperature ?? 0.3 };
}

async function runApiKeyTextTurn(
  model: string,
  input: PreferredOpenAiTextTurnInput,
): Promise<PreferredOpenAiTextTurnResult> {
  const endpoint = await resolveOpenAiApiKeyChatEndpoint();
  if (!endpoint) throw new Error(`${input.errorContext} needs OPENAI_API_KEY because ChatGPT OAuth is unavailable or explicitly disabled.`);
  const cacheHints = openAICompatibleInferenceCacheHints({
    provider: "openai-api",
    model,
    cacheScope: input.cacheScope,
  });
  const response = await resilientHttpsFetch(endpoint.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.key}`,
      "content-type": "application/json",
      ...cacheHints.headers,
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      ...cacheHints.body,
      ...apiInferenceOptions(model, input),
      ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(detail || `${input.errorContext} returned HTTP ${response.status}.`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error(`${input.errorContext} returned an empty response.`);
  return { auth: "api-key", model, text };
}

export async function runPreferredOpenAiTextTurn(
  input: PreferredOpenAiTextTurnInput,
): Promise<PreferredOpenAiTextTurnResult> {
  const route = await resolvePreferredOpenAiChatRoute(input.model);
  return executeOpenAiChatRoute(
    route,
    {
      oauth: async (model) => {
        const text = await runOpenAiOAuthChatTurn(model, input.messages, {
          maxOutputTokens: input.maxTokens,
          onTextDelta: input.onTextDelta,
          timeoutMs: input.timeoutMs,
        });
        if (!text.trim()) throw new Error(`${input.errorContext} returned an empty OAuth response.`);
        return { auth: "oauth" as const, model, text: text.trim() };
      },
      apiKey: (model) => runApiKeyTextTurn(model, input),
    },
  );
}
