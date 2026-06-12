import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { HIVEMIND_OS_RUNTIME, type AgentProfile, type AgentRuntime } from "@/lib/types/agent-runtime";
import { resolveAdaptiveOpenRouterModels } from "./adaptive-openrouter-models";
import { adaptiveReliabilityKey, adaptiveReliabilityStates, type AdaptiveReliabilityState } from "./adaptive-model-reliability";

type IncomingMessage = {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: { url?: string };
    file?: { filename?: string; file_data?: string };
  }>;
};

type ModelsDevModel = {
  name?: string;
  cost?: Record<string, number | string | null | undefined>;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  status?: string;
};

type ModelsDevProvider = {
  name?: string;
  env?: string[];
  npm?: string;
  api?: string;
  models?: Record<string, ModelsDevModel>;
};

type ModelsDevCatalogCache = {
  updatedAt: string;
  data: Record<string, ModelsDevProvider>;
};

export type AdaptiveRouteCandidate = {
  runtime: Extract<AgentRuntime, "hermes" | typeof HIVEMIND_OS_RUNTIME>;
  provider: string;
  providerName: string;
  model: string;
  modelName?: string;
  gatewayUrl: string;
  chatPath: string;
  token?: string;
  headers?: Record<string, string>;
  source: string;
  score: number;
  free: boolean;
};

export type AdaptiveRoutePlan = {
  profile: AgentProfile;
  selected: AdaptiveRouteCandidate;
  candidates: AdaptiveRouteCandidate[];
};

const MODELS_DEV_CACHE_FILE = join(homedir(), ".hivemindos", "models-dev-cache.json");
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const DIRECT_RUNTIME: AdaptiveRouteCandidate["runtime"] = HIVEMIND_OS_RUNTIME;
const SUPPORTED_RUNTIMES = new Set<AdaptiveRouteCandidate["runtime"]>(["hermes", HIVEMIND_OS_RUNTIME]);

let modelsDevCache: ModelsDevCatalogCache | null = null;

function parseEnvFileValue(raw: string, key: string) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`, "m");
  const match = raw.match(pattern);
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function envValue(key: string) {
  const existing = process.env[key]?.trim();
  if (existing) return existing;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, key);
    if (value) return value;
  }
  return "";
}

async function readModelsDevCache() {
  if (modelsDevCache) return modelsDevCache.data;
  const raw = await readFile(MODELS_DEV_CACHE_FILE, "utf8").catch(() => "");
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Partial<ModelsDevCatalogCache>;
  if (!parsed.data || typeof parsed.data !== "object") return {};
  modelsDevCache = {
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    data: parsed.data,
  };
  return modelsDevCache.data;
}

async function writeModelsDevCache(data: Record<string, ModelsDevProvider>) {
  modelsDevCache = { updatedAt: new Date().toISOString(), data };
  await mkdir(dirname(MODELS_DEV_CACHE_FILE), { recursive: true }).catch(() => undefined);
  await writeFile(MODELS_DEV_CACHE_FILE, JSON.stringify(modelsDevCache, null, 2), "utf8").catch(() => undefined);
}

async function fetchModelsDevCatalog() {
  try {
    const response = await fetch("https://models.dev/api.json", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Models.dev returned ${response.status}.`);
    const data = await response.json().catch(() => null) as Record<string, ModelsDevProvider> | null;
    if (!data || typeof data !== "object") throw new Error("Models.dev returned an empty catalog.");
    await writeModelsDevCache(data);
    return data;
  } catch (error) {
    const cached = await readModelsDevCache().catch(() => ({}));
    if (Object.keys(cached).length) return cached;
    throw error instanceof Error ? error : new Error("Could not fetch Models.dev catalog.");
  }
}

function normalizedList(values?: string[]) {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function runtimeAllowed(profile: AgentProfile, runtime: AdaptiveRouteCandidate["runtime"]) {
  const allowed = normalizedList(profile.adaptiveRouting?.enabledRuntimes?.map(String));
  return !allowed.size || allowed.has(runtime);
}

function providerAllowed(profile: AgentProfile, provider: string) {
  return !normalizedList(profile.adaptiveRouting?.disabledProviders).has(provider.toLowerCase());
}

function zeroPriced(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function isFreeModel(model: ModelsDevModel) {
  const cost = model.cost ?? {};
  const values = Object.values(cost).filter((value) => value !== undefined && value !== null && value !== "");
  return values.length > 0 && values.every(zeroPriced);
}

function messageHasContent(message: IncomingMessage) {
  if (typeof message.content === "string") return Boolean(message.content.trim());
  return message.content.some((part) => {
    if (part.type === "text") return Boolean(part.text?.trim());
    if (part.type === "image_url") return Boolean(part.image_url?.url);
    if (part.type === "file") return Boolean(part.file?.file_data);
    return false;
  });
}

function latestUserMessage(messages: IncomingMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && messageHasContent(message));
}

function adaptiveUseCases(profile: AgentProfile, messages: IncomingMessage[]) {
  const configured = profile.adaptiveRouting?.useCase ?? profile.adaptiveOpenRouter?.useCase;
  if (configured && configured !== "auto") return [configured];
  const latest = latestUserMessage(messages);
  const latestText = typeof latest?.content === "string"
    ? latest.content
    : latest?.content?.map((part) => part.text ?? "").join(" ") ?? "";
  const hasImage = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "image_url");
  const hasFile = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "file");
  const text = [
    profile.workerClass,
    profile.name,
    profile.skillProfilePrompt,
    profile.preferredSkillSlugs?.join(" "),
    latestText,
  ].filter(Boolean).join(" ").toLowerCase();
  const cases = new Set<string>();
  if (hasImage) cases.add("vision");
  if (hasFile) cases.add("research");
  if (/\b(code|coding|program|developer|debug|repo|typescript|javascript|python|react|next\.?js|bug|test|refactor|cli|api|schema|sql)\b/.test(text)) cases.add("coding");
  if (/\b(write|writing|copy|essay|story|draft|edit|rewrite|tone|blog|newsletter|creative)\b/.test(text)) cases.add("writing");
  if (/\b(research|compare|summari[sz]e|sources?|search|evidence|market|analysis|report)\b/.test(text)) cases.add("research");
  if (/\b(image|draw|illustration|photo|visual|vision|screenshot|diagram)\b/.test(text)) cases.add(hasImage ? "vision" : "image");
  if (/\b(tool|function|agent|workflow|automation|shell|command|browser|github|filesystem)\b/.test(text)) cases.add("tool-use");
  if (!cases.size) cases.add("general");
  return [...cases];
}

function modelUseCaseScore(input: {
  provider: string;
  model: string;
  name?: string;
  modelMeta?: ModelsDevModel;
  useCases: string[];
}) {
  const haystack = `${input.provider} ${input.model} ${input.name ?? ""}`.toLowerCase();
  let score = 0;
  for (const useCase of input.useCases) {
    if (useCase === "coding" && /code|coding|coder|programming|developer|devstral|deepseek|qwen|kimi|agent|tools?/.test(haystack)) score += 42;
    if (useCase === "writing" && /write|writing|creative|story|copy|editor|chat|instruct/.test(haystack)) score += 30;
    if (useCase === "vision" && (/vision|visual|image|vlm|multimodal/.test(haystack) || input.modelMeta?.modalities?.input?.includes("image") || input.modelMeta?.attachment)) score += 44;
    if (useCase === "image" && (input.modelMeta?.modalities?.output?.includes("image") || /image|diffusion|flux|stable/.test(haystack))) score += 44;
    if (useCase === "research" && /research|search|reason|r1|thinking|analysis/.test(haystack)) score += 34;
    if (useCase === "tool-use" && (input.modelMeta?.tool_call || /tool|function/.test(haystack))) score += 32;
  }
  if (input.modelMeta?.tool_call) score += 14;
  if (input.modelMeta?.reasoning) score += 10;
  if (input.modelMeta?.structured_output) score += 4;
  if (/gpt-5|claude|sonnet|opus|gemini.*pro|qwen3.*coder|kimi|deepseek|glm-4\.6|minimax/.test(haystack)) score += 18;
  if (/latest|preview|turbo|pro|large|reason|thinking|instruct/.test(haystack)) score += 6;
  if (/mini|nano|small/.test(haystack)) score -= 20;
  if (input.modelMeta?.status === "deprecated") score -= 200;
  score += Math.min(24, Math.floor((input.modelMeta?.limit?.context ?? 0) / 32_000));
  return score;
}

function modelSupportsRequest(model: ModelsDevModel, messages: IncomingMessage[]) {
  const latest = latestUserMessage(messages);
  const requiresImage = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "image_url");
  if (!requiresImage) return true;
  return Boolean(model.attachment || model.modalities?.input?.includes("image"));
}

function openAICompatibleEndpointForModelsDevApi(api: string) {
  const clean = api.replace(/\/+$/, "");
  const suffix = "/chat/completions";
  if (clean.toLowerCase().endsWith(suffix)) {
    return {
      gatewayUrl: clean.slice(0, -suffix.length) || clean,
      chatPath: suffix,
    };
  }
  return {
    gatewayUrl: clean,
    chatPath: suffix,
  };
}

async function openRouterCandidates(profile: AgentProfile, messages: IncomingMessage[], useCases: string[]) {
  if (!providerAllowed(profile, "openrouter")) return [];
  const token = await envValue("OPENROUTER_API_KEY");
  if (!token) return [];
  const directRuntime = runtimeAllowed(profile, DIRECT_RUNTIME) ? DIRECT_RUNTIME : null;
  const hermesRuntime = profile.runtime === "hermes" && runtimeAllowed(profile, "hermes") ? "hermes" as const : null;
  const runtime = hermesRuntime ?? directRuntime;
  if (!runtime) return [];
  const modelIds = await resolveAdaptiveOpenRouterModels(profile, messages).catch(() => []);
  return modelIds.map((model, index) => ({
    runtime,
    provider: "openrouter",
    providerName: "OpenRouter",
    model,
    gatewayUrl: runtime === "hermes" ? profile.gatewayUrl : "https://openrouter.ai/api",
    chatPath: runtime === "hermes" ? profile.chatPath || "/chat" : "/v1/chat/completions",
    token: runtime === "hermes" ? profile.token : token,
    source: "openrouter-live-models",
    free: !profile.adaptiveRouting?.fallbackModel || model !== profile.adaptiveRouting.fallbackModel,
    score: modelUseCaseScore({ provider: "openrouter", model, useCases }) + Math.max(0, 80 - index),
  })) satisfies AdaptiveRouteCandidate[];
}

async function modelsDevCandidates(profile: AgentProfile, messages: IncomingMessage[], useCases: string[]) {
  if (!runtimeAllowed(profile, DIRECT_RUNTIME)) return [];
  const catalog: Record<string, ModelsDevProvider> = await fetchModelsDevCatalog().catch(() => ({}));
  const candidates: AdaptiveRouteCandidate[] = [];
  for (const [providerId, provider] of Object.entries(catalog)) {
    if (providerId === "openrouter") continue;
    if (!providerAllowed(profile, providerId)) continue;
    if (!provider.api || !provider.npm?.includes("openai-compatible")) continue;
    const envKey = provider.env?.find(Boolean);
    if (!envKey) continue;
    const token = await envValue(envKey);
    if (!token) continue;
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (model.status === "deprecated") continue;
      if (!isFreeModel(model)) continue;
      if (!modelSupportsRequest(model, messages)) continue;
      const endpoint = openAICompatibleEndpointForModelsDevApi(provider.api);
      candidates.push({
        runtime: DIRECT_RUNTIME,
        provider: providerId,
        providerName: provider.name || providerId,
        model: modelId,
        modelName: model.name,
        gatewayUrl: endpoint.gatewayUrl,
        chatPath: endpoint.chatPath,
        token,
        source: "models.dev",
        free: true,
        score: modelUseCaseScore({ provider: providerId, model: modelId, name: model.name, modelMeta: model, useCases }),
      });
    }
  }
  return candidates;
}

function profileForCandidate(profile: AgentProfile, candidate: AdaptiveRouteCandidate): AgentProfile {
  return {
    ...profile,
    runtime: candidate.runtime,
    provider: candidate.provider,
    model: candidate.model,
    gatewayUrl: candidate.gatewayUrl,
    chatPath: candidate.chatPath,
    token: candidate.token ?? profile.token,
  };
}

function candidateSort(
  left: AdaptiveRouteCandidate,
  right: AdaptiveRouteCandidate,
  reliability: Map<string, AdaptiveReliabilityState>,
) {
  const leftState = reliability.get(adaptiveReliabilityKey(left.provider, left.model));
  const rightState = reliability.get(adaptiveReliabilityKey(right.provider, right.model));
  // Observed reliability outranks keyword scoring across every provider:
  // models in a failure cooldown sink, quality-demoted models sink below
  // never-tried ones, and the most recent quality-passing winner leads.
  return Number(right.free) - Number(left.free)
    || Number(leftState?.cooling ?? false) - Number(rightState?.cooling ?? false)
    || Number(leftState?.poorQuality ?? false) - Number(rightState?.poorQuality ?? false)
    || Number(rightState?.recentWinner ?? false) - Number(leftState?.recentWinner ?? false)
    || ((rightState?.recentWinner ? rightState.lastSuccessAt : 0) - (leftState?.recentWinner ? leftState.lastSuccessAt : 0))
    || right.score - left.score
    || left.providerName.localeCompare(right.providerName)
    || left.model.localeCompare(right.model);
}

export function isAdaptiveProviderProfile(profile: AgentProfile) {
  return profile.provider?.trim().toLowerCase() === "adaptive";
}

export async function resolveAdaptiveRoutePlan(profile: AgentProfile, messages: IncomingMessage[]): Promise<AdaptiveRoutePlan> {
  const runtime = profile.runtime as AdaptiveRouteCandidate["runtime"];
  if (profile.adaptiveRouting?.enabledRuntimes?.length) {
    const supported = profile.adaptiveRouting.enabledRuntimes.filter((item): item is AdaptiveRouteCandidate["runtime"] => SUPPORTED_RUNTIMES.has(item as AdaptiveRouteCandidate["runtime"]));
    if (!supported.length) throw new Error("Adaptive routing has no supported runtimes enabled.");
  } else if (!SUPPORTED_RUNTIMES.has(runtime) && !runtimeAllowed(profile, DIRECT_RUNTIME)) {
    throw new Error(`${profile.runtime} does not support Adaptive provider routing yet.`);
  }
  const useCases = adaptiveUseCases(profile, messages);
  const [openRouter, modelsDev] = await Promise.all([
    openRouterCandidates(profile, messages, useCases),
    modelsDevCandidates(profile, messages, useCases),
  ]);
  const unsorted = [...openRouter, ...modelsDev];
  const reliability = await adaptiveReliabilityStates(
    unsorted.map((candidate) => adaptiveReliabilityKey(candidate.provider, candidate.model)),
  ).catch(() => new Map<string, AdaptiveReliabilityState>());
  const candidates = unsorted.sort((left, right) => candidateSort(left, right, reliability));
  const selected = candidates[0];
  if (!selected) {
    throw new Error("Adaptive could not find a ready free model. Configure OPENROUTER_API_KEY or another Models.dev OpenAI-compatible provider key, then try again.");
  }
  return {
    profile: profileForCandidate(profile, selected),
    selected,
    candidates,
  };
}
