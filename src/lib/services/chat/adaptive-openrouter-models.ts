import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import { RUNTIME_CAPABILITIES, type AgentProfile } from "@/lib/types/agent-runtime";
import { orderAdaptiveModelsByReliability } from "@/lib/services/chat/adaptive-model-reliability";

type IncomingMessage = {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: { url?: string };
    file?: { filename?: string; file_data?: string };
  }>;
};

type OpenRouterModelRecord = {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string | number | null | undefined>;
  supported_parameters?: string[];
};

type OpenRouterModelInventoryCache = {
  updatedAt: string;
  data: OpenRouterModelRecord[];
};

type OpenRouterEndpointRecord = {
  status?: number;
  uptime_last_5m?: number | null;
  uptime_last_30m?: number | null;
  throughput_last_30m?: {
    p50?: number;
    p90?: number;
  } | null;
  latency_last_30m?: {
    p50?: number;
    p90?: number;
  } | null;
};

type OpenRouterModelEndpointCache = {
  updatedAt: string;
  data: Record<string, OpenRouterEndpointRecord[]>;
};

const OPENROUTER_MODEL_CACHE_FILE = join(homedir(), ".hivemindos", "openrouter-models-cache.json");
const OPENROUTER_ENDPOINT_CACHE_FILE = join(homedir(), ".hivemindos", "openrouter-model-endpoints-cache.json");
const OPENROUTER_ENDPOINT_HEALTH_LIMIT = 24;

let adaptiveOpenRouterModelInventoryCache: OpenRouterModelInventoryCache | null = null;
let adaptiveOpenRouterEndpointCache: OpenRouterModelEndpointCache | null = null;

function zeroPriced(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function isFreeOpenRouterModel(model: OpenRouterModelRecord) {
  if (model.id?.endsWith(":free")) return true;
  const pricing = model.pricing ?? {};
  return ["prompt", "completion", "request", "image", "web_search", "internal_reasoning"].every((key) => zeroPriced(pricing[key]));
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

async function readOpenRouterModelInventoryCache() {
  if (adaptiveOpenRouterModelInventoryCache?.data.length) return adaptiveOpenRouterModelInventoryCache.data;
  const raw = await readFile(OPENROUTER_MODEL_CACHE_FILE, "utf8").catch(() => "");
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Partial<OpenRouterModelInventoryCache>;
  if (!Array.isArray(parsed.data) || !parsed.data.length) return [];
  adaptiveOpenRouterModelInventoryCache = {
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    data: parsed.data,
  };
  return adaptiveOpenRouterModelInventoryCache.data;
}

async function writeOpenRouterModelInventoryCache(data: OpenRouterModelRecord[]) {
  if (!data.length) return;
  adaptiveOpenRouterModelInventoryCache = { updatedAt: new Date().toISOString(), data };
  await mkdir(dirname(OPENROUTER_MODEL_CACHE_FILE), { recursive: true }).catch(() => undefined);
  await writeFile(OPENROUTER_MODEL_CACHE_FILE, JSON.stringify(adaptiveOpenRouterModelInventoryCache, null, 2), "utf8").catch(() => undefined);
}

async function readOpenRouterEndpointCache() {
  if (adaptiveOpenRouterEndpointCache) return adaptiveOpenRouterEndpointCache.data;
  const raw = await readFile(OPENROUTER_ENDPOINT_CACHE_FILE, "utf8").catch(() => "");
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Partial<OpenRouterModelEndpointCache>;
  if (!parsed.data || typeof parsed.data !== "object") return {};
  adaptiveOpenRouterEndpointCache = {
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    data: parsed.data,
  };
  return adaptiveOpenRouterEndpointCache.data;
}

async function writeOpenRouterEndpointCache(data: Record<string, OpenRouterEndpointRecord[]>) {
  adaptiveOpenRouterEndpointCache = { updatedAt: new Date().toISOString(), data };
  await mkdir(dirname(OPENROUTER_ENDPOINT_CACHE_FILE), { recursive: true }).catch(() => undefined);
  await writeFile(OPENROUTER_ENDPOINT_CACHE_FILE, JSON.stringify(adaptiveOpenRouterEndpointCache, null, 2), "utf8").catch(() => undefined);
}

async function fetchOpenRouterModelInventory() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=all", {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`OpenRouter model inventory returned ${response.status}.`);
      const payload = await response.json().catch(() => null) as { data?: OpenRouterModelRecord[] } | null;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      if (!data.length) throw new Error("OpenRouter model inventory was empty.");
      await writeOpenRouterModelInventoryCache(data);
      return data;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  const cached = await readOpenRouterModelInventoryCache().catch(() => []);
  if (cached.length) return cached;
  throw lastError instanceof Error ? lastError : new Error("Could not fetch OpenRouter's free model inventory for Adaptive mode.");
}

async function fetchOpenRouterModelEndpoints(modelId: string) {
  const cached: Record<string, OpenRouterEndpointRecord[]> = await readOpenRouterEndpointCache().catch(() => ({}));
  if (cached[modelId]?.length) return cached[modelId];
  const [author, ...slugParts] = modelId.split("/");
  const slug = slugParts.join("/");
  if (!author || !slug) return [];
  const response = await fetch(`https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { data?: { endpoints?: OpenRouterEndpointRecord[] } } | null;
  const endpoints = Array.isArray(payload?.data?.endpoints) ? payload.data.endpoints : [];
  if (!endpoints.length) return [];
  await writeOpenRouterEndpointCache({ ...cached, [modelId]: endpoints }).catch(() => undefined);
  return endpoints;
}

function configuredAdaptiveUseCase(profile: AgentProfile) {
  const useCase = profile.adaptiveOpenRouter?.useCase;
  return useCase && useCase !== "auto" ? [useCase] : null;
}

function adaptiveUseCases(profile: AgentProfile, messages: IncomingMessage[]) {
  const configured = configuredAdaptiveUseCase(profile);
  if (configured) return configured;
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
  if (/\b(image|draw|illustration|photo|visual|vision|screenshot|diagram)\b/.test(text)) {
    cases.add(hasImage ? "vision" : profileHasNativeImageGeneration(profile) ? "tool-use" : "image");
  }
  if (/\b(tool|function|agent|workflow|automation|shell|command|browser|github|filesystem)\b/.test(text)) cases.add("tool-use");
  if (!cases.size) cases.add("general");
  return [...cases];
}

function profileHasNativeImageGeneration(profile: AgentProfile) {
  const matrixCapabilities = RUNTIME_CAPABILITIES[profile.runtime];
  return profile.runtime === "hermes"
    || Boolean(matrixCapabilities?.imageGeneration)
    || Boolean(matrixCapabilities?.skillCapabilities?.some((capability) => capability === "image-generation" || capability === "media-generation"))
    || Boolean(profile.runtimeCapabilities?.imageGeneration)
    || Boolean(profile.runtimeCapabilities?.skillCapabilities?.some((capability) => capability === "image-generation" || capability === "media-generation"));
}

function modelUseCaseScore(model: OpenRouterModelRecord, useCases: string[]) {
  const haystack = `${model.id ?? ""} ${model.name ?? ""} ${model.description ?? ""} ${(model.supported_parameters ?? []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const useCase of useCases) {
    if (useCase === "coding" && /code|coding|coder|programming|developer|devstral|deepseek|qwen|kimi|agent|tools?/.test(haystack)) score += 40;
    if (useCase === "writing" && /write|writing|creative|story|copy|editor|chat|instruct/.test(haystack)) score += 32;
    if (useCase === "vision" && (/vision|visual|image|vlm|multimodal/.test(haystack) || model.architecture?.input_modalities?.includes("image"))) score += 44;
    if (useCase === "image" && (model.architecture?.output_modalities?.includes("image") || /image|diffusion|flux|stable/.test(haystack))) score += 44;
    if (useCase === "research" && /research|search|reason|r1|thinking|analysis/.test(haystack)) score += 34;
    if (useCase === "tool-use" && ((model.supported_parameters ?? []).includes("tools") || /tool|function/.test(haystack))) score += 30;
  }
  if ((model.supported_parameters ?? []).includes("tools")) score += 10;
  if ((model.supported_parameters ?? []).includes("reasoning")) score += 8;
  if (/latest|preview|turbo|pro|large|reason|thinking|instruct/.test(haystack)) score += 6;
  return score;
}

function endpointHealthScore(endpoints: OpenRouterEndpointRecord[]) {
  if (!endpoints.length) return 0;
  const best = endpoints.reduce((score, endpoint) => {
    let current = 0;
    if (endpoint.status === 0) current += 28;
    else if (typeof endpoint.status === "number" && endpoint.status < 0) current -= 45;
    const uptime = endpoint.uptime_last_5m ?? endpoint.uptime_last_30m;
    if (typeof uptime === "number") {
      if (uptime >= 99) current += 24;
      else if (uptime >= 95) current += 12;
      else if (uptime < 90) current -= 35;
    }
    const throughput = endpoint.throughput_last_30m?.p50;
    if (typeof throughput === "number") current += Math.min(16, Math.floor(throughput / 12));
    const latency = endpoint.latency_last_30m?.p90 ?? endpoint.latency_last_30m?.p50;
    if (typeof latency === "number" && latency > 12_000) current -= 12;
    return Math.max(score, current);
  }, -60);
  return best;
}

async function rankCandidatesWithEndpointHealth(candidates: OpenRouterModelRecord[], useCases: string[]) {
  const ranked = candidates.map((model, index) => ({ model, index, baseScore: modelUseCaseScore(model, useCases) }));
  const top = ranked.slice(0, OPENROUTER_ENDPOINT_HEALTH_LIMIT);
  const health = await Promise.all(top.map(async (entry) => ({
    id: entry.model.id,
    score: endpointHealthScore(await fetchOpenRouterModelEndpoints(entry.model.id!).catch(() => [])),
  })));
  const healthById = new Map(health.map((entry) => [entry.id, entry.score]));
  return ranked.sort((left, right) => {
    const leftTools = left.model.supported_parameters?.includes("tools") ? 1 : 0;
    const rightTools = right.model.supported_parameters?.includes("tools") ? 1 : 0;
    return (right.baseScore + (healthById.get(right.model.id) ?? 0)) - (left.baseScore + (healthById.get(left.model.id) ?? 0))
      || rightTools - leftTools
      || (right.model.context_length ?? 0) - (left.model.context_length ?? 0)
      || (right.model.created ?? 0) - (left.model.created ?? 0)
      || (left.model.name ?? left.model.id ?? "").localeCompare(right.model.name ?? right.model.id ?? "");
  }).map((entry) => entry.model);
}

export async function resolveAdaptiveOpenRouterModels(profile: AgentProfile, messages: IncomingMessage[]) {
  const fallbackModel = profile.adaptiveOpenRouter?.fallbackModel?.trim();
  const inventory = await fetchOpenRouterModelInventory().catch((error: unknown) => {
    if (fallbackModel) return [] as OpenRouterModelRecord[];
    throw error;
  });
  const latest = latestUserMessage(messages);
  const requiresImage = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "image_url");
  const requiredModalities = requiresImage ? ["text", "image"] : ["text"];
  const useCases = adaptiveUseCases(profile, messages);
  const openRouterImageFallback = useCases.includes("image") && !profileHasNativeImageGeneration(profile);
  const candidates = inventory
    .filter((model) => model.id)
    .filter(isFreeOpenRouterModel)
    .filter((model) => requiredModalities.every((modality) => model.architecture?.input_modalities?.includes(modality)))
    .filter((model) => !openRouterImageFallback || model.architecture?.output_modalities?.includes("image"));
  const rankedCandidates = await rankCandidatesWithEndpointHealth(candidates, useCases);
  if (!rankedCandidates[0]?.id && !fallbackModel) throw new Error(openRouterImageFallback
    ? "OpenRouter did not report any free image-output model that matches this Adaptive request."
    : "OpenRouter did not report any free model that matches this Adaptive request.");
  const ids = rankedCandidates.map((model) => model.id!).filter(Boolean);
  // Observed reliability beats keyword ranking: stick with the most recent
  // model that actually completed a request, and push rate-limited models to
  // the back until their cooldown expires.
  const ordered = await orderAdaptiveModelsByReliability(ids).catch(() => ids);
  return fallbackModel && !ordered.includes(fallbackModel) ? [...ordered, fallbackModel] : ordered;
}

export async function resolveAdaptiveOpenRouterModel(profile: AgentProfile, messages: IncomingMessage[]) {
  const candidates = await resolveAdaptiveOpenRouterModels(profile, messages);
  return candidates[0];
}
