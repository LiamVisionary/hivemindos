import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { HIVEMIND_OS_RUNTIME, type AgentProfile } from "@/lib/types/agent-runtime";
import { bankrLlmAuthHeaders, isBankrLlmProfile } from "@/lib/services/bankr-llm";
import { checkUsePodModels, isUsePodProfile, resolveUsePodRuntimeConfig } from "@/lib/services/usepod";
import type { RuntimeAdapter } from "./types";

const execFileAsync = promisify(execFile);

type OpenAIModelList = {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
  error?: { message?: string } | string;
};

type LmStudioRawModel = {
  key?: string;
  modelKey?: string;
  display_name?: string;
  displayName?: string;
  type?: string;
  loaded_instances?: Array<{ id?: string }>;
  loadedInstanceIds?: string[];
  max_context_length?: number;
  maxContextLength?: number;
  params_string?: string | null;
  paramsString?: string | null;
  size_bytes?: number | null;
  sizeBytes?: number | null;
  format?: string | null;
};

type LmStudioModelInventory = {
  models?: LmStudioRawModel[];
  error?: { message?: string } | string;
};

export type NormalizedLmStudioModel = {
  key: string;
  displayName: string;
  type: string;
  loaded: boolean;
  loadedInstanceIds: string[];
  maxContextLength?: number;
  paramsString?: string | null;
  sizeBytes?: number | null;
  format?: string | null;
};

function cleanBaseUrl(profile: AgentProfile) {
  return (profile.gatewayUrl || "http://127.0.0.1:1234").trim().replace(/\/+$/, "");
}

function buildRuntimeUrl(profile: AgentProfile, path: string) {
  const base = cleanBaseUrl(profile);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function errorMessage(data: OpenAIModelList | null, fallback: string) {
  if (typeof data?.error === "string") return data.error;
  return data?.error?.message || fallback;
}

function providerName(profile: AgentProfile) {
  return isUsePodProfile(profile)
    ? "UsePod"
    : isBankrLlmProfile(profile)
      ? "Bankr LLM"
      : profile.provider === "ollama"
        ? "Ollama"
        : profile.provider === "vllm"
          ? "vLLM"
          : profile.provider === "llamacpp"
            ? "llama.cpp"
            : profile.provider === "lm-studio"
              ? "Local OpenAI"
              : "OpenAI-compatible";
}

function configuredModelFallback(profile: AgentProfile) {
  const model = profile.model?.trim();
  return model ? [model] : [];
}

function authHeaders(profile: AgentProfile): Record<string, string> {
  return profile.token ? { Authorization: `Bearer ${profile.token}` } : {};
}

export function localOpenAIProviderProfile(profile: AgentProfile): AgentProfile {
  if (profile.runtime === HIVEMIND_OS_RUNTIME) return profile;
  return {
    ...profile,
    runtime: HIVEMIND_OS_RUNTIME,
    gatewayUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    provider: "lm-studio",
    token: "",
  };
}

function lmsProcessEnv() {
  return {
    ...process.env,
    PATH: [join(homedir(), ".lmstudio", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
  };
}

async function resolveLmsBin() {
  const candidates = [
    join(homedir(), ".lmstudio", "bin", "lms"),
    "/opt/homebrew/bin/lms",
    "/usr/local/bin/lms",
    "lms",
  ];
  for (const candidate of candidates) {
    if (candidate === "lms") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next common LM Studio CLI location.
    }
  }
  return "lms";
}

async function runLmsJson(args: string[], timeout = 15_000) {
  const { stdout } = await execFileAsync(await resolveLmsBin(), args, {
    timeout,
    maxBuffer: 8_000_000,
    env: lmsProcessEnv(),
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as unknown;
}

async function fetchModels(profile: AgentProfile): Promise<OpenAIModelList> {
  const usePodConfig = await resolveUsePodRuntimeConfig(profile);
  const runtimeProfile = usePodConfig
    ? { ...profile, gatewayUrl: usePodConfig.baseUrl, statusPath: usePodConfig.statusPath, token: "" }
    : profile;
  const bankrHeaders = isBankrLlmProfile(runtimeProfile) ? await bankrLlmAuthHeaders(runtimeProfile) : {};
  if (isBankrLlmProfile(runtimeProfile) && !bankrHeaders["X-API-Key"]) {
    throw new Error("BANKR_LLM_KEY is required to list Bankr LLM models.");
  }
  const response = await fetch(buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"), {
    headers: {
      ...authHeaders(runtimeProfile),
      ...bankrHeaders,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as OpenAIModelList | null;
  if (!response.ok) throw new Error(errorMessage(data, `OpenAI-compatible runtime returned ${response.status}`));
  return data ?? {};
}

async function fetchLmStudioInventory(profile: AgentProfile): Promise<LmStudioModelInventory> {
  const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models"), {
    headers: authHeaders(profile),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as LmStudioModelInventory | null;
  if (!response.ok) throw new Error(errorMessage(data as OpenAIModelList | null, `LM Studio REST API returned ${response.status}`));
  return data ?? {};
}

function normalizeLmStudioModels(payload: LmStudioModelInventory | LmStudioRawModel[]): NormalizedLmStudioModel[] {
  const rawModels = Array.isArray(payload) ? payload : payload.models ?? [];
  const normalized = rawModels
    .map((model) => {
      const key = model.key?.trim() || model.modelKey?.trim() || "";
      if (!key) return null;
      const loadedInstanceIds = Array.isArray(model.loaded_instances)
        ? model.loaded_instances
          .map((instance) => instance.id?.trim())
          .filter((id): id is string => Boolean(id))
        : (model.loadedInstanceIds ?? []).map((id) => id.trim()).filter(Boolean);
      const maxContextLength = Number(model.max_context_length ?? model.maxContextLength);
      const sizeBytes = Number(model.size_bytes ?? model.sizeBytes);
      return {
        key,
        displayName: model.display_name || model.displayName || key,
        type: model.type || "llm",
        loaded: loadedInstanceIds.length > 0,
        loadedInstanceIds,
        maxContextLength: Number.isFinite(maxContextLength) ? maxContextLength : undefined,
        paramsString: model.params_string ?? model.paramsString ?? null,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
        format: model.format,
      };
    })
    .filter((model): model is NonNullable<typeof model> => Boolean(model));
  const seen = new Set<string>();
  return normalized.filter((model) => {
    if (seen.has(model.key)) return false;
    seen.add(model.key);
    return true;
  });
}

function markLoadedLmStudioModels(models: NormalizedLmStudioModel[], loadedModels: unknown[]) {
  const loadedRefs = new Set(loadedModels.flatMap((model) => {
    if (!model || typeof model !== "object") return [];
    const row = model as Record<string, unknown>;
    return [row.identifier, row.modelKey, row.key, row.path, row.displayName]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }));
  return models.map((model) => (
    loadedRefs.has(model.key) || loadedRefs.has(model.displayName)
      ? { ...model, loaded: true, loadedInstanceIds: model.loadedInstanceIds.length ? model.loadedInstanceIds : [model.key] }
      : model
  ));
}

async function readLmStudioCliInventory() {
  const [models, loaded] = await Promise.all([
    runLmsJson(["ls", "--json"]),
    runLmsJson(["ps", "--json"]).catch(() => []),
  ]);
  return markLoadedLmStudioModels(
    normalizeLmStudioModels(Array.isArray(models) ? models as LmStudioRawModel[] : []),
    Array.isArray(loaded) ? loaded : [],
  );
}

async function runLmStudioCliAction(action: string, input: Record<string, unknown>) {
  if (action === "load-model") {
    const model = String(input.model ?? "").trim();
    if (!model) return { ok: false, error: "Model is required." };
    const contextLength = Number(input.contextLength ?? 0);
    const args = ["load", "--identifier", model, "--yes"];
    if (Number.isFinite(contextLength) && contextLength > 0) args.push("--context-length", String(contextLength));
    args.push(model);
    await execFileAsync(await resolveLmsBin(), args, {
      timeout: 180_000,
      maxBuffer: 2_000_000,
      env: lmsProcessEnv(),
    });
    return { ok: true, message: `Loaded ${model} in LM Studio.` };
  }
  if (action === "unload-model") {
    const instanceId = String(input.instanceId ?? input.model ?? "").trim();
    if (!instanceId) return { ok: false, error: "Loaded model instance is required." };
    await execFileAsync(await resolveLmsBin(), ["unload", instanceId], {
      timeout: 60_000,
      maxBuffer: 2_000_000,
      env: lmsProcessEnv(),
    });
    return { ok: true, message: `Unloaded ${instanceId} from LM Studio.` };
  }
  return { ok: false, error: `Unsupported LM Studio action: ${action}` };
}

async function runLmStudioRestAction(profile: AgentProfile, action: string, input: Record<string, unknown>) {
  if (action === "load-model") {
    const model = String(input.model ?? "").trim();
    if (!model) return { ok: false, error: "Model is required." };
    const contextLength = Number(input.contextLength ?? 0);
    const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models/load"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(profile) },
      body: JSON.stringify({
        model,
        ...(Number.isFinite(contextLength) && contextLength > 0 ? { context_length: contextLength } : {}),
        echo_load_config: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json().catch(() => null) as { error?: { message?: string } | string; instance_id?: string } | null;
    if (!response.ok) return { ok: false, error: errorMessage(data as OpenAIModelList | null, `LM Studio returned ${response.status}`) };
    return { ok: true, message: `Loaded ${data?.instance_id || model} in LM Studio.` };
  }
  if (action === "unload-model") {
    const instanceId = String(input.instanceId ?? input.model ?? "").trim();
    if (!instanceId) return { ok: false, error: "Loaded model instance is required." };
    const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models/unload"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(profile) },
      body: JSON.stringify({ instance_id: instanceId }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => null) as { error?: { message?: string } | string; instance_id?: string } | null;
    if (!response.ok) return { ok: false, error: errorMessage(data as OpenAIModelList | null, `LM Studio returned ${response.status}`) };
    return { ok: true, message: `Unloaded ${data?.instance_id || instanceId} from LM Studio.` };
  }
  return { ok: false, error: `Unsupported LM Studio action: ${action}` };
}

export async function discoverLmStudioProviderModels(profile: AgentProfile) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  let modelDiscoveryError = "";
  let lmStudioModels: NormalizedLmStudioModel[] = [];
  let lmStudioModelSource = "";
  try {
    lmStudioModels = await readLmStudioCliInventory();
    if (lmStudioModels.length) lmStudioModelSource = "lms ls --json";
  } catch (error) {
    modelDiscoveryError = error instanceof Error ? error.message : "LM Studio CLI inventory failed.";
  }
  if (!lmStudioModels.length) {
    try {
      lmStudioModels = normalizeLmStudioModels(await fetchLmStudioInventory(runtimeProfile));
      if (lmStudioModels.length) {
        lmStudioModelSource = buildRuntimeUrl(runtimeProfile, "/api/v1/models");
        modelDiscoveryError = "";
      }
    } catch (error) {
      const restError = error instanceof Error ? error.message : "LM Studio REST inventory failed.";
      modelDiscoveryError = modelDiscoveryError ? `${modelDiscoveryError}; ${restError}` : restError;
    }
  }
  const llmModels = lmStudioModels.filter((model) => model.type === "llm");
  return {
    runtimeProfile,
    lmStudioModels,
    modelDiscoveryError,
    lmStudioModelSource,
    models: llmModels.map((model) => model.key),
  };
}

export async function runLmStudioAction(profile: AgentProfile, action: string, input: Record<string, unknown>) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  const cliResult = await runLmStudioCliAction(action, input).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "LM Studio CLI action failed.",
  }));
  if (cliResult.ok) return cliResult;
  const restResult = await runLmStudioRestAction(runtimeProfile, action, input).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "LM Studio REST action failed.",
  }));
  if (restResult.ok) return restResult;
  return {
    ok: false,
    error: `LM Studio action failed. CLI: ${cliResult.error || "unavailable"} REST: ${restResult.error || "unavailable"}`,
  };
}

export const openAICompatibleAdapter: RuntimeAdapter = {
  runtime: HIVEMIND_OS_RUNTIME,
  label: "HivemindOS",
  kind: "interactive",
  capabilities: {
    status: true,
    chat: true,
    modelSelection: true,
  },
  defaultProfile: {
    gatewayUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    provider: "lm-studio",
    model: process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ?? "",
  },
  async getStatus(profile) {
    const usePodStatus = isUsePodProfile(profile) ? await checkUsePodModels(profile) : null;
    const usePodConfig = !usePodStatus ? await resolveUsePodRuntimeConfig(profile) : null;
    const runtimeProfile = usePodConfig
      ? { ...profile, gatewayUrl: usePodConfig.baseUrl, statusPath: usePodConfig.statusPath, token: "" }
      : profile;
    let modelDiscoveryError = "";
    let lmStudioModels: NormalizedLmStudioModel[] = [];
    let lmStudioModelSource = "";
    let models = configuredModelFallback(profile);
    if (usePodStatus) {
      models = usePodStatus.models.map((model) => model.id);
    } else if (profile.provider === "lm-studio") {
      const discovery = await discoverLmStudioProviderModels(runtimeProfile);
      lmStudioModels = discovery.lmStudioModels;
      lmStudioModelSource = discovery.lmStudioModelSource;
      modelDiscoveryError = discovery.modelDiscoveryError;
      models = discovery.models.length ? discovery.models : configuredModelFallback(profile);
    } else {
      try {
        models = (await fetchModels(runtimeProfile)).data
          ?.map((model) => model.id)
          .filter((model): model is string => Boolean(model)) ?? configuredModelFallback(profile);
      } catch (error) {
        modelDiscoveryError = error instanceof Error ? error.message : "Model discovery failed.";
      }
    }
    const name = providerName(profile);
    return {
      baseUrl: cleanBaseUrl(runtimeProfile),
      chatPath: runtimeProfile.chatPath || "/v1/chat/completions",
      models,
      diagnostics: modelDiscoveryError ? [`${name} model discovery unavailable: ${modelDiscoveryError}`] : undefined,
      providerStatus: usePodStatus ? {
        usePod: {
          tokenEnvName: usePodStatus.tokenEnvName,
          tokenPresent: usePodStatus.tokenPresent,
          tokenSource: usePodStatus.tokenSource,
          depositAddress: usePodStatus.depositAddress,
          depositCode: usePodStatus.depositCode,
          dashboardUrl: usePodStatus.dashboardUrl,
          balanceRemaining: usePodStatus.balanceRemaining,
          route: usePodStatus.route,
          checkedAt: usePodStatus.checkedAt,
          status: usePodStatus.status,
          message: usePodStatus.message,
          httpStatus: usePodStatus.httpStatus,
          modelCount: usePodStatus.modelCount,
        },
      } : profile.provider === "lm-studio" ? {
        lmStudio: {
          baseUrl: cleanBaseUrl(runtimeProfile),
          models: lmStudioModels,
          error: modelDiscoveryError || undefined,
          checkedAt: new Date().toISOString(),
        },
      } : undefined,
      modelSelection: {
        provider: profile.provider || "openai-compatible",
        model: profile.model || models[0] || "",
        providers: [{
          slug: profile.provider || "openai-compatible",
          name,
          models: models.map((id) => {
            const lmStudioModel = lmStudioModels.find((model) => model.key === id);
            return lmStudioModel
              ? {
                id,
                name: lmStudioModel.displayName,
                subtitle: lmStudioModel.loaded ? "Loaded" : "Downloaded",
                group: lmStudioModel.paramsString || undefined,
                badge: lmStudioModel.loaded ? "Loaded" : undefined,
              }
              : { id };
          }),
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: profile.provider === "lm-studio"
            ? lmStudioModelSource || buildRuntimeUrl(runtimeProfile, "/api/v1/models")
            : buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"),
        }],
      },
    };
  },
  async runIntegrationAction(profile, action, input) {
    if (!profile) return { ok: false, error: "Agent profile is required." };
    if (profile.provider !== "lm-studio") return { ok: false, error: `${providerName(profile)} does not expose load/unload controls here yet.` };
    return runLmStudioAction(profile, action, input);
  },
};
