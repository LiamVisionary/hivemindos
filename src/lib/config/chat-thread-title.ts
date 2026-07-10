export const CHAT_THREAD_TITLE_CONFIG_STATE_KEY = "hivemindos.chatThreadTitle.config.v1";
export const CHAT_THREAD_TITLES_STATE_KEY = "hivemindos.chatThreadTitle.titles.v1";

export const DEFAULT_CHAT_THREAD_TITLE_LOCAL_CATALOG_ID = "chat-title-qwen3-5-0-8b-q4-k-m";

export type ChatThreadTitleMode = "off" | "local" | "cloud";
export type ChatThreadTitleAuthMode = "api" | "oauth";

export type ChatThreadTitleCloudRoute = {
  id: string;
  provider: string;
  providerFamily: string;
  providerLabel: string;
  model: string;
  auth: ChatThreadTitleAuthMode;
  source: "profile" | "live" | "oauth";
  score: number;
  recommended: boolean;
  recommendation?: string;
};

export type ChatThreadTitleConfig = {
  version: 1;
  mode: ChatThreadTitleMode;
  localCatalogId: string;
  localModelKey: string;
  cloudRoute: ChatThreadTitleCloudRoute | null;
};

export type StoredChatThreadTitle = {
  title: string;
  generatedAt: number;
  /** "manual" = the user renamed this thread by hand; it is never regenerated. */
  mode: "local" | "cloud" | "manual";
  model: string;
};

export type ChatThreadTitleContext = {
  firstUserTurn: string;
  latestUserTurn: string;
  assistantReply?: string;
};

export const CHAT_THREAD_TITLE_CLOUD_MODEL_RANKING = [
  { id: "openai-nano", pattern: /gpt-5\.4-nano|gpt-5-nano/i, score: 100, recommendation: "Lowest-cost OpenAI fit" },
  { id: "gemini-flash-lite", pattern: /gemini-3\.1-flash-lite|gemini-.*flash-lite/i, score: 98, recommendation: "Fast, economical cloud fit" },
  { id: "anthropic-haiku", pattern: /claude-haiku-4[.-]?5|claude.*haiku/i, score: 91, recommendation: "Fast Anthropic fit" },
  { id: "gemini-flash", pattern: /gemini-.*flash/i, score: 88, recommendation: "Fast model for short titles" },
  { id: "openai-mini", pattern: /gpt-.*mini|gpt-4\.1-mini/i, score: 84, recommendation: "Fast model for short titles" },
  { id: "grok-fast", pattern: /grok-.*fast|grok-3-mini/i, score: 80, recommendation: "Fast model for short titles" },
  { id: "small-qwen", pattern: /qwen.*(?:0\.5|0\.8|1\.5|3b|4b)/i, score: 76, recommendation: "Small model for short titles" },
  { id: "lightweight-generic", pattern: /nano|flash|haiku|mini|small|lite/i, score: 72, recommendation: "Fast model for short titles" },
] as const;

export const DEFAULT_CHAT_THREAD_TITLE_CONFIG: ChatThreadTitleConfig = {
  version: 1,
  mode: "off",
  localCatalogId: DEFAULT_CHAT_THREAD_TITLE_LOCAL_CATALOG_ID,
  localModelKey: "",
  cloudRoute: null,
};

const GENERIC_OPENERS = [
  /^(?:hi|hello|hey|hiya|yo|sup|good (?:morning|afternoon|evening))[!.?]*$/i,
  /^(?:can|could|would|will) you (?:help|assist)(?: me)?[!.?]*$/i,
  /^(?:i )?need (?:some )?help[!.?]*$/i,
  /^(?:help|help me|start|new chat)[!.?]*$/i,
  /^(?:are you there|anyone there|test|testing)[!.?]*$/i,
];

const NON_TEXT_PLACEHOLDERS = new Set([
  "media message",
  "image message",
  "file message",
]);

function compactText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function isSubstantiveChatUserTurn(value: unknown) {
  const text = compactText(value, 2_000);
  if (!text || text.length < 4 || NON_TEXT_PLACEHOLDERS.has(text.toLowerCase())) return false;
  return !GENERIC_OPENERS.some((pattern) => pattern.test(text));
}

export function buildChatThreadTitleContext(
  messages: Array<{ role?: string; content?: string; surface?: string; processEvents?: unknown; attachments?: unknown }>,
  assistantReply?: string,
): ChatThreadTitleContext | null {
  const substantiveUserTurns = messages
    .filter((message) => (
      message?.role === "user"
      && message.surface !== "process"
      && !message.processEvents
      && isSubstantiveChatUserTurn(message.content)
    ))
    .map((message) => compactText(message.content, 600));
  if (!substantiveUserTurns.length) return null;
  const firstUserTurn = substantiveUserTurns[0];
  const latestUserTurn = substantiveUserTurns.at(-1) ?? firstUserTurn;
  const assistant = compactText(assistantReply, 300);
  return {
    firstUserTurn,
    latestUserTurn,
    ...(assistant ? { assistantReply: assistant } : {}),
  };
}

export function parseChatThreadTitleConfig(value: unknown): ChatThreadTitleConfig {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return DEFAULT_CHAT_THREAD_TITLE_CONFIG;
    }
  }
  if (!raw || typeof raw !== "object") return DEFAULT_CHAT_THREAD_TITLE_CONFIG;
  const record = raw as Partial<ChatThreadTitleConfig>;
  const mode: ChatThreadTitleMode = record.mode === "local" || record.mode === "cloud" || record.mode === "off"
    ? record.mode
    : "off";
  const cloudRoute = parseChatThreadTitleCloudRoute(record.cloudRoute);
  return {
    version: 1,
    mode,
    localCatalogId: compactText(record.localCatalogId, 180) || DEFAULT_CHAT_THREAD_TITLE_LOCAL_CATALOG_ID,
    localModelKey: compactText(record.localModelKey, 300),
    cloudRoute,
  };
}

export function parseChatThreadTitleCloudRoute(value: unknown): ChatThreadTitleCloudRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as Partial<ChatThreadTitleCloudRoute>;
  const auth = route.auth === "oauth" ? "oauth" : route.auth === "api" ? "api" : null;
  const provider = compactText(route.provider, 120);
  const model = compactText(route.model, 240);
  if (!auth || !provider || !model) return null;
  const providerFamily = compactText(route.providerFamily, 120) || chatThreadTitleProviderFamily(provider);
  const providerLabel = compactText(route.providerLabel, 120) || providerFamily;
  const source = route.source === "live" || route.source === "oauth" ? route.source : "profile";
  const score = Number.isFinite(Number(route.score)) ? Number(route.score) : scoreChatThreadTitleModel(model);
  return {
    id: compactText(route.id, 500) || chatThreadTitleCloudRouteId(provider, model, auth),
    provider,
    providerFamily,
    providerLabel,
    model,
    auth,
    source,
    score,
    recommended: Boolean(route.recommended ?? score >= 70),
    recommendation: compactText(route.recommendation, 180) || undefined,
  };
}

export function parseStoredChatThreadTitles(value: unknown): Record<string, StoredChatThreadTitle> {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const titles: Record<string, StoredChatThreadTitle> = {};
  for (const [storageKey, candidate] of Object.entries(raw)) {
    if (!storageKey || !candidate || typeof candidate !== "object") continue;
    const record = candidate as Partial<StoredChatThreadTitle>;
    const title = sanitizeChatThreadTitle(record.title);
    if (!title || (record.mode !== "local" && record.mode !== "cloud" && record.mode !== "manual")) continue;
    titles[storageKey] = {
      title,
      generatedAt: Number.isFinite(Number(record.generatedAt)) ? Number(record.generatedAt) : 0,
      mode: record.mode,
      model: compactText(record.model, 240),
    };
  }
  return titles;
}

export function chatThreadTitleProviderFamily(provider: string) {
  if (provider === "openai-api" || provider === "openai-codex") return "openai";
  if (provider === "xai" || provider === "xai-oauth") return "xai";
  return provider;
}

export function chatThreadTitleCloudRouteId(provider: string, model: string, auth: ChatThreadTitleAuthMode) {
  return `${provider}\u001f${model}\u001f${auth}`;
}

export function scoreChatThreadTitleModel(model: string) {
  const id = model.toLowerCase();
  let score: number = CHAT_THREAD_TITLE_CLOUD_MODEL_RANKING.find((rule) => rule.pattern.test(id))?.score ?? 35;
  if (/embed|embedding|image|audio|video|realtime|tts|transcrib|moderation/.test(id)) score -= 100;
  if (/opus|pro|max|ultra|70b|72b|120b|235b|405b/.test(id)) score -= 30;
  if (/thinking|reasoning|deepseek-r1|o1|o3|o4/.test(id)) score -= 24;
  return score;
}

export function chatThreadTitleRecommendation(model: string) {
  return CHAT_THREAD_TITLE_CLOUD_MODEL_RANKING.find((rule) => rule.pattern.test(model))?.recommendation ?? "";
}

export function sanitizeChatThreadTitle(value: unknown) {
  let text = compactText(value, 160)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:title|caption)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { title?: unknown };
      text = compactText(parsed.title, 160);
    } catch {
      const match = text.match(/"title"\s*:\s*"([^"]+)"/i);
      if (match) text = match[1];
    }
  }
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\s*[.!?:;,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").filter(Boolean).slice(0, 7);
  return words.join(" ").slice(0, 64).trim();
}
