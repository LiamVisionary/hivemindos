import "server-only";

import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { discoverChatThreadTitleCloudRoutes } from "@/lib/services/chat/thread-title-model-options";
import { runOpenAiOAuthChatTurn } from "@/lib/services/openai-oauth";
import { resolveProviderChatEndpoint } from "@/lib/services/queen-bee/voice-turn";

type ContentStudioBrainMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ContentStudioBrainRequest = {
  prompt?: string;
  provider?: string;
  model?: string;
  auth?: "api" | "oauth";
  promptHelper?: boolean;
  walkthrough?: boolean;
  confirmed?: boolean;
  history?: ContentStudioBrainMessage[];
  attachments?: Array<{ name?: string; type?: string; size?: number; order?: number }>;
  imageSelection?: { provider?: string; model?: string };
  videoSelection?: { provider?: string; model?: string };
};

type BrainRoute = Awaited<ReturnType<typeof discoverChatThreadTitleCloudRoutes>>[number];

const CONTENT_STUDIO_SYSTEM_PROMPT = `You are the planning brain for Hivemind Content Studio. Turn the user's request into a precise, executable content-production brief. Choose only from the supplied lane and provider catalogs. Do not claim that media has been generated.

Return JSON only. Use exactly one mode:
- questions: {"mode":"questions","message":"...","questions":["..."]}
- confirmation: {"mode":"confirmation","message":"...","draft":{...}}
- brief: {"mode":"brief","message":"...","draft":{...}}

The draft contract is:
{"lane":"first-frame-animation-ad|stickman-performance-ad|static-text-ad|animation|faceless|clip|social-post","title":"...","concept":"...","audience":"...","goal":"...","tone":"...","aspect_ratio":"9:16|4:5|1:1|16:9","runtime_seconds":15,"scenes":[{"title":"...","beat":"...","voice":"...","overlay":"...","duration_seconds":4,"image_prompt":"...","motion_prompt":"..."}],"voice":{"enabled":true,"delivery":"..."},"subtitles":{"enabled":true,"position":"bottom","font_size":56},"providers":{"image":"...","motion":"..."},"provider_options":{},"publish":{"platforms":[],"caption":"","cta":""}}

When prompt helper is enabled, retain the user's intent but expand vague creative direction into production-ready scene, image, motion, voice, and pacing detail. When walkthrough is enabled and confirmed is false, ask only high-value missing questions or return confirmation mode; never return brief mode. Attached images are ordered reference assets. The first can be a start frame, the last can be an end frame, and intervening images can be references only when the chosen generation model supports those roles. Never invent a provider reference-image limit.`;

function clean(value: unknown, maximum = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizedHistory(value: unknown): ContentStudioBrainMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ContentStudioBrainMessage>;
    const role = row.role === "assistant" ? "assistant" : "user";
    const content = clean(row.content, 8_000);
    return content ? [{ role, content }] : [];
  });
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const body = payload as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
  };
  return clean(body.choices?.[0]?.message?.content ?? body.content?.map((item) => item.text ?? "").join("\n"));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The selected brain did not return a JSON production plan.");
  const value = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The selected brain returned an invalid production plan.");
  return value as Record<string, unknown>;
}

async function callOpenAiCompatible(route: BrainRoute, messages: Array<{ role: string; content: string }>) {
  const endpoint = await resolveProviderChatEndpoint(route.provider);
  if (!endpoint) throw new Error(`${route.providerLabel} is no longer available.`);
  if (route.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": endpoint.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: 4_096,
        system: messages.find((message) => message.role === "system")?.content ?? "",
        messages: messages.filter((message) => message.role !== "system"),
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${route.providerLabel} returned HTTP ${response.status}.`);
    return extractText(payload);
  }
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify({ model: route.model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${route.providerLabel} returned HTTP ${response.status}.`);
  return extractText(payload);
}

async function availableBrainRoutes() {
  return discoverChatThreadTitleCloudRoutes([]);
}

function planningRouteBlocker(route: BrainRoute) {
  const directProvider = route.provider === "openai-codex"
    || route.provider === "xai-oauth"
    || Boolean(providerCatalogEntry(route.provider)?.baseUrl);
  if (!directProvider) return "This HivemindOS gateway is detected but does not yet expose a bounded local-app planning call.";
  if (/(?:^|\/)(?:sora|whisper|tts|dall-e|gpt-image|text-embedding|omni-moderation|lyria)(?:-|$)/i.test(route.model)) {
    return "This is not a text-planning model.";
  }
  return "";
}

export async function contentStudioBrainCatalog() {
  const routes = await availableBrainRoutes();
  const groups = new Map<string, { slug: string; name: string; models: Array<{ id: string; auth: string; recommended: boolean; disabled: boolean; disabledReason?: string; recommendation?: string }> }>();
  for (const route of routes) {
    const group = groups.get(route.provider) ?? { slug: route.provider, name: route.providerLabel, models: [] };
    const disabledReason = planningRouteBlocker(route);
    group.models.push({
      id: route.model,
      auth: route.auth,
      recommended: route.recommended,
      disabled: Boolean(disabledReason),
      ...(disabledReason ? { disabledReason } : {}),
      ...(route.recommendation ? { recommendation: route.recommendation } : {}),
    });
    groups.set(route.provider, group);
  }
  return [...groups.values()];
}

export async function planContentStudioRequest(input: ContentStudioBrainRequest) {
  const prompt = clean(input.prompt);
  if (!prompt) throw new Error("Enter what you want to create.");
  const provider = clean(input.provider, 120);
  const model = clean(input.model, 300);
  const routes = await availableBrainRoutes();
  const route = routes.find((item) => item.provider === provider && item.model === model && (!input.auth || item.auth === input.auth));
  if (!route) throw new Error("The selected brain is not in HivemindOS's current available-model catalog.");
  const blocked = planningRouteBlocker(route);
  if (blocked) throw new Error(blocked);

  const history = normalizedHistory(input.history);
  const context = {
    request: prompt,
    prompt_helper: input.promptHelper !== false,
    walkthrough: input.walkthrough === true,
    confirmed: input.confirmed === true,
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 30) : [],
    requested_image_route: input.imageSelection ?? { provider: "automatic", model: "automatic" },
    requested_video_route: input.videoSelection ?? { provider: "automatic", model: "automatic" },
    available_lanes: ["first-frame-animation-ad", "stickman-performance-ad", "static-text-ad", "animation", "faceless", "clip", "social-post"],
    available_media_providers: ["stickman-renderer", "static-text-renderer", "comfyui", "openai-gpt-image", "openai-gpt-image-oauth", "xai-imagine-api", "xai-imagine-oauth", "media-studio-mcp", "hivemindos-hosted-media", "muapi", "higgsfield-cloud", "higgsfield-consumer"],
  };
  const messages = [
    { role: "system", content: CONTENT_STUDIO_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: JSON.stringify(context) },
  ];
  const raw = route.auth === "oauth" && route.provider === "openai-codex"
    ? await runOpenAiOAuthChatTurn(route.model, messages as Array<{ role: "system" | "user" | "assistant"; content: string }>, { timeoutMs: 120_000 })
    : await callOpenAiCompatible(route, messages);
  if (!raw) throw new Error("The selected brain returned no production plan.");
  const result = parseJsonObject(raw);
  const mode = result.mode === "questions" || result.mode === "confirmation" || result.mode === "brief" ? result.mode : "brief";
  if (input.walkthrough && !input.confirmed && mode === "brief") result.mode = "confirmation";
  return {
    ...result,
    brain: { provider: route.provider, providerLabel: route.providerLabel, model: route.model, auth: route.auth },
  };
}
