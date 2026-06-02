import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";

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

const OPENROUTER_MODEL_CACHE_FILE = join(homedir(), ".hivemindos", "openrouter-models-cache.json");

let adaptiveOpenRouterModelInventoryCache: OpenRouterModelInventoryCache | null = null;

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
  if (/\b(image|draw|illustration|photo|visual|vision|screenshot|diagram)\b/.test(text)) cases.add(hasImage ? "vision" : "image");
  if (/\b(tool|function|agent|workflow|automation|shell|command|browser|github|filesystem)\b/.test(text)) cases.add("tool-use");
  if (!cases.size) cases.add("general");
  return [...cases];
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
  const candidates = inventory
    .filter((model) => model.id)
    .filter(isFreeOpenRouterModel)
    .filter((model) => requiredModalities.every((modality) => model.architecture?.input_modalities?.includes(modality)))
    .sort((left, right) => {
      const rightTools = right.supported_parameters?.includes("tools") ? 1 : 0;
      const leftTools = left.supported_parameters?.includes("tools") ? 1 : 0;
      return modelUseCaseScore(right, useCases) - modelUseCaseScore(left, useCases)
        || rightTools - leftTools
        || (right.context_length ?? 0) - (left.context_length ?? 0)
        || (right.created ?? 0) - (left.created ?? 0)
        || (left.name ?? left.id ?? "").localeCompare(right.name ?? right.id ?? "");
    });
  if (!candidates[0]?.id && !fallbackModel) throw new Error("OpenRouter did not report any free model that matches this Adaptive request.");
  const ids = candidates.map((model) => model.id!).filter(Boolean);
  return fallbackModel && !ids.includes(fallbackModel) ? [...ids, fallbackModel] : ids;
}

export async function resolveAdaptiveOpenRouterModel(profile: AgentProfile, messages: IncomingMessage[]) {
  const candidates = await resolveAdaptiveOpenRouterModels(profile, messages);
  return candidates[0];
}
