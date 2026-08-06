import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  LOCAL_MODEL_RUNTIME_CAPABILITIES,
  SIE_PROVIDER_ID,
} from "@/lib/config/local-model-runtimes";

export type SieModelState = "available" | "loading" | "loaded" | "unloading" | "failed";
export type SieWarmKind = "chat" | "embedding";

export type SieModelCapabilities = {
  grammar?: string[];
  tools?: boolean;
  loraAdapters?: string[];
  profileLoraAdapters?: Record<string, string[]>;
  code?: boolean;
  sql?: boolean;
  guard?: boolean;
};

export type NormalizedSieModel = {
  key: string;
  displayName: string;
  type: string;
  state: SieModelState;
  loaded: boolean;
  inputs: string[];
  outputs: string[];
  tasks: string[];
  dims?: Record<string, number>;
  maxContextLength?: number;
  revision?: string | null;
  profiles: string[];
  capabilities?: SieModelCapabilities;
  lastError?: string;
  canWarm: boolean;
  warmKind?: SieWarmKind;
  chatCompatible: boolean;
};

export type SieWorkerStatus = {
  name: string;
  url?: string;
  gpu?: string;
  gpuCount: number;
  readyGpuSlots: number;
  healthy: boolean;
  queueDepth: number;
  pendingCost: number;
  inflightBatches: number;
  loadedModels: string[];
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  bundle?: string;
};

export type SieClusterStatus = {
  status?: string;
  type?: string;
  workerCount: number;
  gpuCount: number;
  modelsLoaded: number;
  totalQps: number;
  configuredGpuTypes: string[];
  liveGpuTypes: string[];
};

export type SieProviderStatus = {
  baseUrl: string;
  models: NormalizedSieModel[];
  workers: SieWorkerStatus[];
  cluster: SieClusterStatus;
  error?: string;
  healthError?: string;
  checkedAt: string;
};

type SieRawModel = {
  id?: unknown;
  name?: unknown;
  loaded?: unknown;
  state?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  dims?: unknown;
  max_sequence_length?: unknown;
  maxContextLength?: unknown;
  revision?: unknown;
  profiles?: unknown;
  capabilities?: unknown;
  last_error?: unknown;
  lastError?: unknown;
};

type SieModelsPayload = {
  data?: Array<{ id?: unknown }>;
  models?: SieRawModel[];
  error?: unknown;
};

type SieHealthPayload = {
  status?: unknown;
  type?: unknown;
  cluster?: unknown;
  configured_gpu_types?: unknown;
  live_gpu_types?: unknown;
  workers?: unknown;
  error?: unknown;
};

type FetchLike = typeof fetch;

const SIE_MODEL_STATES = new Set<SieModelState>(["available", "loading", "loaded", "unloading", "failed"]);
const EMBEDDING_OUTPUTS = new Set(["dense", "sparse", "multivector", "embedding", "embeddings", "vector"]);
const SCORE_OUTPUTS = new Set(["score", "scores", "rank", "ranking"]);
const EXTRACT_OUTPUTS = new Set(["entity", "entities", "relation", "relations", "class", "classes", "object", "objects", "bbox", "boxes", "markdown"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeModelState(value: unknown, loaded: boolean): SieModelState {
  const state = String(value ?? "").trim().toLowerCase() as SieModelState;
  if (SIE_MODEL_STATES.has(state)) return state;
  return loaded ? "loaded" : "available";
}

function normalizeModelCapabilities(value: unknown): SieModelCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    grammar: stringArray(raw.grammar),
    tools: Boolean(raw.tools),
    loraAdapters: stringArray(raw.lora_adapters ?? raw.loraAdapters),
    profileLoraAdapters: Object.fromEntries(Object.entries(asRecord(raw.profile_lora_adapters ?? raw.profileLoraAdapters)).map(([key, entries]) => [key, stringArray(entries)])),
    code: Boolean(raw.code),
    sql: Boolean(raw.sql),
    guard: Boolean(raw.guard),
  };
}

function modelFailureMessage(value: unknown) {
  if (typeof value === "string") return value.trim();
  const error = asRecord(value);
  const message = String(error.message ?? "").trim();
  const code = String(error.code ?? "").trim();
  const attempts = finiteNumber(error.attempts);
  return [code, message, attempts > 0 ? `${attempts} attempt${attempts === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" · ");
}

function inferSieModelTasks(inputs: string[], outputs: string[], capabilities?: SieModelCapabilities) {
  const tasks = new Set<string>();
  const outputSet = new Set(outputs.map((item) => item.toLowerCase()));
  if (capabilities) tasks.add("chat");
  if (outputs.some((item) => EMBEDDING_OUTPUTS.has(item.toLowerCase()))) tasks.add("embedding");
  if (outputs.some((item) => SCORE_OUTPUTS.has(item.toLowerCase()))) tasks.add("rerank");
  if (outputs.some((item) => EXTRACT_OUTPUTS.has(item.toLowerCase()))) tasks.add("extract");
  if (inputs.some((item) => item.toLowerCase() === "image")) tasks.add("vision");
  if (inputs.some((item) => ["audio", "speech"].includes(item.toLowerCase()))) tasks.add("audio");
  if (!tasks.size && outputSet.has("text")) tasks.add("text");
  if (!tasks.size) tasks.add("inference");
  return [...tasks];
}

export function normalizeSieModels(payload: SieModelsPayload | SieRawModel[]): NormalizedSieModel[] {
  const container = Array.isArray(payload) ? { models: payload } : payload;
  const nativeModels = Array.isArray(container.models) ? container.models : [];
  const normalized = nativeModels.map((raw): NormalizedSieModel | null => {
    const key = String(raw.name ?? raw.id ?? "").trim();
    if (!key) return null;
    const loaded = Boolean(raw.loaded);
    const state = normalizeModelState(raw.state, loaded);
    const inputs = stringArray(raw.inputs);
    const outputs = stringArray(raw.outputs);
    const capabilities = normalizeModelCapabilities(raw.capabilities);
    const tasks = inferSieModelTasks(inputs, outputs, capabilities);
    const chatCompatible = tasks.includes("chat");
    const warmKind: SieWarmKind | undefined = chatCompatible
      ? "chat"
      : tasks.includes("embedding")
        ? "embedding"
        : undefined;
    const dims: Record<string, number> = {};
    for (const [name, value] of Object.entries(asRecord(raw.dims))) {
      const dimension = finiteNumber(value);
      if (dimension > 0) dims[name] = dimension;
    }
    const maxContextLength = finiteNumber(raw.max_sequence_length ?? raw.maxContextLength);
    const profiles = Array.isArray(raw.profiles)
      ? stringArray(raw.profiles)
      : Object.keys(asRecord(raw.profiles));
    return {
      key,
      displayName: key,
      type: tasks[0] ?? "inference",
      state,
      loaded: state === "loaded" || loaded,
      inputs,
      outputs,
      tasks,
      dims: Object.keys(dims).length ? dims : undefined,
      maxContextLength: maxContextLength > 0 ? maxContextLength : undefined,
      revision: raw.revision == null ? null : String(raw.revision),
      profiles,
      capabilities,
      lastError: modelFailureMessage(raw.last_error ?? raw.lastError) || undefined,
      canWarm: Boolean(warmKind) && state !== "loading" && state !== "unloading",
      warmKind,
      chatCompatible,
    };
  }).filter((model): model is NormalizedSieModel => Boolean(model));

  // A gateway normally returns the native `models` array alongside its OpenAI
  // `data` list. Keep unmatched OpenAI rows visible, but do not guess that an
  // unknown model is chat- or embedding-compatible.
  const known = new Set(normalized.map((model) => model.key));
  for (const entry of Array.isArray(container.data) ? container.data : []) {
    const key = String(entry?.id ?? "").trim();
    if (!key || known.has(key)) continue;
    normalized.push({
      key,
      displayName: key,
      type: "inference",
      state: "available",
      loaded: false,
      inputs: [],
      outputs: [],
      tasks: ["inference"],
      profiles: [],
      canWarm: false,
      chatCompatible: false,
    });
  }
  return normalized.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function normalizeSieHealth(payload: SieHealthPayload | null | undefined): Pick<SieProviderStatus, "workers" | "cluster"> {
  const rawCluster = asRecord(payload?.cluster);
  const workers = (Array.isArray(payload?.workers) ? payload.workers : []).map((value): SieWorkerStatus | null => {
    const worker = asRecord(value);
    const name = String(worker.name ?? worker.url ?? "").trim();
    if (!name) return null;
    return {
      name,
      url: String(worker.url ?? "").trim() || undefined,
      gpu: String(worker.gpu ?? "").trim() || undefined,
      gpuCount: finiteNumber(worker.gpu_count ?? worker.gpuCount),
      readyGpuSlots: finiteNumber(worker.ready_gpu_slots ?? worker.readyGpuSlots),
      healthy: worker.healthy !== false,
      queueDepth: finiteNumber(worker.queue_depth ?? worker.queueDepth),
      pendingCost: finiteNumber(worker.pending_cost ?? worker.pendingCost),
      inflightBatches: finiteNumber(worker.inflight_batches ?? worker.inflightBatches),
      loadedModels: stringArray(worker.loaded_models ?? worker.loadedModels),
      memoryUsedBytes: finiteNumber(worker.memory_used_bytes ?? worker.memoryUsedBytes),
      memoryTotalBytes: finiteNumber(worker.memory_total_bytes ?? worker.memoryTotalBytes),
      bundle: String(worker.bundle ?? "").trim() || undefined,
    };
  }).filter((worker): worker is SieWorkerStatus => Boolean(worker));
  return {
    workers,
    cluster: {
      status: String(payload?.status ?? "").trim() || undefined,
      type: String(payload?.type ?? "").trim() || undefined,
      workerCount: finiteNumber(rawCluster.worker_count ?? rawCluster.workerCount, workers.filter((worker) => worker.healthy).length),
      gpuCount: finiteNumber(rawCluster.gpu_count ?? rawCluster.gpuCount, workers.reduce((total, worker) => total + worker.gpuCount, 0)),
      modelsLoaded: finiteNumber(rawCluster.models_loaded ?? rawCluster.modelsLoaded, new Set(workers.flatMap((worker) => worker.loadedModels)).size),
      totalQps: finiteNumber(rawCluster.total_qps ?? rawCluster.totalQps),
      configuredGpuTypes: stringArray(payload?.configured_gpu_types),
      liveGpuTypes: stringArray(payload?.live_gpu_types),
    },
  };
}

function cleanSieBaseUrl(profile: AgentProfile) {
  const configured = String(profile.gatewayUrl ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return configured || LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID].defaultBaseUrl;
}

function sieHeaders(profile: AgentProfile): Record<string, string> {
  return profile.token ? { Authorization: `Bearer ${profile.token}` } : {};
}

function responseError(payload: unknown, fallback: string) {
  const error = asRecord(payload).error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const message = String(asRecord(error).message ?? "").trim();
  return message || fallback;
}

async function fetchSieJson(fetcher: FetchLike, url: string, profile: AgentProfile, timeoutMs = 8_000) {
  const response = await fetcher(url, {
    headers: sieHeaders(profile),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(payload, `SIE returned HTTP ${response.status}.`));
  return payload;
}

export async function discoverSieProviderModels(profile: AgentProfile, fetcher: FetchLike = fetch): Promise<SieProviderStatus> {
  const baseUrl = cleanSieBaseUrl(profile);
  const checkedAt = new Date().toISOString();
  let models: NormalizedSieModel[] = [];
  let modelError = "";
  let healthError = "";
  const [modelsResult, healthResult] = await Promise.allSettled([
    fetchSieJson(fetcher, `${baseUrl}/v1/models`, profile),
    fetchSieJson(fetcher, `${baseUrl}/health`, profile),
  ]);
  if (modelsResult.status === "fulfilled") models = normalizeSieModels(modelsResult.value as SieModelsPayload);
  else modelError = modelsResult.reason instanceof Error ? modelsResult.reason.message : "SIE model discovery failed.";
  const health = healthResult.status === "fulfilled"
    ? normalizeSieHealth(healthResult.value as SieHealthPayload)
    : normalizeSieHealth(undefined);
  if (healthResult.status === "rejected") {
    healthError = healthResult.reason instanceof Error ? healthResult.reason.message : "SIE health telemetry failed.";
  }
  return {
    baseUrl,
    models,
    ...health,
    error: modelError || undefined,
    healthError: healthError || undefined,
    checkedAt,
  };
}

export function buildSieWarmRequest(model: NormalizedSieModel) {
  if (model.warmKind === "chat") {
    return {
      path: "/v1/chat/completions",
      body: {
        model: model.key,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
        temperature: 0,
      },
    };
  }
  if (model.warmKind === "embedding") {
    return {
      path: "/v1/embeddings",
      body: { model: model.key, input: "warmup" },
    };
  }
  return null;
}

export async function runSieAction(
  profile: AgentProfile,
  action: string,
  input: Record<string, unknown>,
  fetcher: FetchLike = fetch,
) {
  if (action !== "warm-model" && action !== "smoke-test-local-model") {
    return { ok: false, error: `Unsupported SIE action: ${action}` };
  }
  const modelKey = String(input.model ?? "").trim();
  if (!modelKey) return { ok: false, error: "Model is required." };
  const status = await discoverSieProviderModels(profile, fetcher);
  if (status.error) return { ok: false, error: status.error };
  const model = status.models.find((entry) => entry.key === modelKey);
  if (!model) return { ok: false, error: `${modelKey} is not present in the SIE model inventory.` };
  const warmRequest = buildSieWarmRequest(model);
  if (!warmRequest) {
    return {
      ok: false,
      error: `${modelKey} cannot be warmed from this chat surface. Its ${model.tasks.join("/")} task loads on the first task-specific SIE request.`,
    };
  }
  const response = await fetcher(`${status.baseUrl}${warmRequest.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sieHeaders(profile) },
    body: JSON.stringify(warmRequest.body),
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: responseError(payload, `SIE warm-up returned HTTP ${response.status}.`) };
  return {
    ok: true,
    message: action === "smoke-test-local-model"
      ? `${modelKey} answered the SIE smoke test.`
      : `${modelKey} is warm on SIE. SIE will keep or evict it according to GPU demand.`,
  };
}
