import "server-only";

import {
  LOCAL_MODEL_INSTALL_CATALOG,
  localModelMatchesCatalogEntry,
} from "@/lib/config/local-model-install-catalog";
import {
  sanitizeChatThreadTitle,
  type ChatThreadTitleConfig,
  type ChatThreadTitleContext,
} from "@/lib/config/chat-thread-title";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { runOpenAiOAuthChatTurn } from "@/lib/services/openai-oauth";
import {
  configuredProviderBaseUrl,
  configuredProviderHeaders,
} from "@/lib/services/provider-model-discovery";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { resolveXaiOAuthChatEndpoint } from "@/lib/services/xai-oauth-inference";

const LOCAL_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

const THREAD_TITLE_SYSTEM_PROMPT = [
  "Write a concise title for this chat thread.",
  "Use 3 to 7 specific words in title case.",
  "Capture the user's intent, not the assistant's process.",
  "Do not use quotation marks, markdown, a trailing period, or labels such as Title.",
  "Return only the title.",
].join(" ");

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
  error?: { message?: string } | string;
};

function titleUserPrompt(context: ChatThreadTitleContext) {
  return [
    `First substantive user turn:\n${context.firstUserTurn}`,
    context.latestUserTurn !== context.firstUserTurn
      ? `Latest substantive user turn:\n${context.latestUserTurn}`
      : "",
    context.assistantReply ? `Existing assistant reply (secondary context only):\n${context.assistantReply}` : "",
  ].filter(Boolean).join("\n\n");
}

function openAiResponseText(data: OpenAIChatResponse | null) {
  const message = data?.choices?.[0]?.message;
  return String(message?.content || message?.reasoning_content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

function upstreamMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function postOpenAiTitle(
  url: string,
  headers: Record<string, string>,
  model: string,
  context: ChatThreadTitleContext,
  structured = false,
) {
  const body = {
    model,
    messages: [
      { role: "system", content: THREAD_TITLE_SYSTEM_PROMPT },
      { role: "user", content: titleUserPrompt(context) },
    ],
    max_tokens: 40,
    temperature: 0.2,
    ...(structured ? {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "chat_thread_title",
          strict: false,
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
    } : {}),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as OpenAIChatResponse | null;
  if (!response.ok) throw new Error(upstreamMessage(data, `Caption model returned HTTP ${response.status}.`));
  const text = openAiResponseText(data);
  if (!text) throw new Error("Caption model returned an empty title.");
  return text;
}

async function localLmStudioModel(config: ChatThreadTitleConfig) {
  const response = await fetch(`${LOCAL_LM_STUDIO_BASE_URL}/models`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as { data?: Array<{ id?: string }> } | null;
  const models = (data?.data ?? []).map((model) => String(model.id ?? "").trim()).filter(Boolean);
  if (!response?.ok || !models.length) {
    throw new Error("No loaded LM Studio model is available. Open title settings to install or load one.");
  }
  const exact = config.localModelKey && models.find((model) => model === config.localModelKey);
  if (exact) return exact;
  const catalog = LOCAL_MODEL_INSTALL_CATALOG.find((entry) => entry.id === config.localCatalogId);
  const catalogMatch = catalog && models.find((model) => localModelMatchesCatalogEntry({ key: model }, catalog));
  if (catalogMatch) return catalogMatch;
  if (config.localModelKey) {
    const normalized = config.localModelKey.toLowerCase();
    const fuzzy = models.find((model) => model.toLowerCase().includes(normalized) || normalized.includes(model.toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  throw new Error("The selected title model is not loaded in LM Studio.");
}

async function generateLocalTitle(config: ChatThreadTitleConfig, context: ChatThreadTitleContext) {
  const model = await localLmStudioModel(config);
  let raw = "";
  try {
    raw = await postOpenAiTitle(`${LOCAL_LM_STUDIO_BASE_URL}/chat/completions`, {}, model, context, true);
  } catch (structuredError) {
    raw = await postOpenAiTitle(`${LOCAL_LM_STUDIO_BASE_URL}/chat/completions`, {}, model, context, false)
      .catch(() => { throw structuredError; });
  }
  return { raw, model };
}

async function generateAnthropicTitle(model: string, key: string, context: ChatThreadTitleContext) {
  const entry = providerCatalogEntry("anthropic");
  const response = await fetch(`${entry?.baseUrl ?? "https://api.anthropic.com/v1"}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: THREAD_TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: titleUserPrompt(context) }],
      max_tokens: 40,
      temperature: 0.2,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) throw new Error(upstreamMessage(data, `Anthropic returned HTTP ${response.status}.`));
  const text = data?.content?.find((block) => block.type === "text")?.text?.trim() ?? "";
  if (!text) throw new Error("Anthropic returned an empty title.");
  return text;
}

async function generateCloudTitle(config: ChatThreadTitleConfig, context: ChatThreadTitleContext) {
  const route = config.cloudRoute;
  if (!route) throw new Error("Choose a cloud title model first.");
  const cloudContext: ChatThreadTitleContext = {
    firstUserTurn: redactSecretText(context.firstUserTurn).text,
    latestUserTurn: redactSecretText(context.latestUserTurn).text,
    ...(context.assistantReply ? { assistantReply: redactSecretText(context.assistantReply).text } : {}),
  };
  if (route.provider === "openai-codex" && route.auth === "oauth") {
    const raw = await runOpenAiOAuthChatTurn(route.model, [
      { role: "system", content: THREAD_TITLE_SYSTEM_PROMPT },
      { role: "user", content: titleUserPrompt(cloudContext) },
    ], { timeoutMs: 30_000 });
    return { raw, model: route.model };
  }
  if (route.provider === "xai-oauth" && route.auth === "oauth") {
    const endpoint = await resolveXaiOAuthChatEndpoint();
    const raw = await postOpenAiTitle(endpoint.url, { Authorization: `Bearer ${endpoint.key}` }, route.model, cloudContext);
    return { raw, model: route.model };
  }
  if (route.auth !== "api") throw new Error("Unsupported OAuth caption route.");
  const entry = providerCatalogEntry(route.provider);
  if (!entry?.keyEnv) throw new Error("This provider is not available for direct captioning.");
  const key = await hiveEnvValue(entry.keyEnv).catch(() => "");
  if (!key) throw new Error(`${entry.keyEnv} is not configured.`);
  if (route.provider === "anthropic") {
    return { raw: await generateAnthropicTitle(route.model, key, cloudContext), model: route.model };
  }
  const baseUrl = configuredProviderBaseUrl(route.provider, key);
  if (!baseUrl) throw new Error("This provider has no compatible chat endpoint.");
  const raw = await postOpenAiTitle(
    `${baseUrl}/chat/completions`,
    configuredProviderHeaders(route.provider, key),
    route.model,
    cloudContext,
  );
  return { raw, model: route.model };
}

export async function generateChatThreadTitle(config: ChatThreadTitleConfig, context: ChatThreadTitleContext) {
  if (config.mode === "off") throw new Error("Automatic thread titles are disabled.");
  const result = config.mode === "local"
    ? await generateLocalTitle(config, context)
    : await generateCloudTitle(config, context);
  const title = sanitizeChatThreadTitle(result.raw);
  if (!title) throw new Error("Caption model did not return a usable title.");
  return { title, model: result.model, mode: config.mode } as const;
}
