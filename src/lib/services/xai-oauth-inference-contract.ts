import { inferencePromptCacheKey } from "@/lib/services/chat/inference-cache-hints";

const XAI_OAUTH_PROVIDER_SLUGS = new Set([
  "xai-oauth",
  "xai oauth",
  "grok-oauth",
  "x-ai-oauth",
]);

export function isXaiOAuthProvider(provider: string | null | undefined) {
  return XAI_OAUTH_PROVIDER_SLUGS.has(provider?.trim().toLowerCase() ?? "");
}

export function xaiOAuthChatRequestOptions(model: string) {
  const normalized = model.trim().toLowerCase();
  if (/^grok-4\.(?:3|5)(?:$|-)/.test(normalized)) {
    return {
      max_completion_tokens: 700,
      reasoning_effort: "low",
    } as const;
  }
  return {
    max_tokens: 500,
    temperature: 0.4,
  } as const;
}

export function xaiOAuthVoiceRequestOptions(model: string) {
  const options = xaiOAuthChatRequestOptions(model);
  if ("max_completion_tokens" in options) {
    return { ...options, max_completion_tokens: 300 };
  }
  return { ...options, max_tokens: 300 };
}

function normalizeXHandle(handle: string) {
  const normalized = handle.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(normalized)) {
    throw new Error("A valid X handle is required for X search.");
  }
  return normalized;
}

export function buildLatestXSearchRequest(input: {
  handle: string;
  query?: string;
  cacheScope?: string;
}) {
  const handle = normalizeXHandle(input.handle);
  return {
    model: "grok-4.20-0309-non-reasoning",
    input: [
      {
        role: "system",
        content:
          "Return the newest original X post from the allowed account. Exclude replies and reposts. Give its exact text, UTC timestamp, and canonical x.com URL. Do not substitute an older post.",
      },
      {
        role: "user",
        content: input.query?.trim() || `Fetch @${handle}'s newest original X post.`,
      },
    ],
    tools: [{ type: "x_search", allowed_x_handles: [handle] }],
    store: false,
    max_output_tokens: 500,
    prompt_cache_key: inferencePromptCacheKey({
      provider: "xai-oauth",
      model: "grok-4.20-0309-non-reasoning",
      cacheScope: input.cacheScope?.trim() || `latest-x:${handle.toLowerCase()}`,
    }),
  } as const;
}

export function xaiResponsesText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
  };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}
