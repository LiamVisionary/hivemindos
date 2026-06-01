import type { AgentProfile } from "@/lib/types/agent-runtime";
import { checkUsePodModels, isUsePodProfile, resolveUsePodRuntimeConfig } from "@/lib/services/usepod";
import type { RuntimeAdapter } from "./types";

type OpenAIModelList = {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
  error?: { message?: string } | string;
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

async function fetchModels(profile: AgentProfile): Promise<OpenAIModelList> {
  const usePodConfig = await resolveUsePodRuntimeConfig(profile);
  const runtimeProfile = usePodConfig
    ? { ...profile, gatewayUrl: usePodConfig.baseUrl, statusPath: usePodConfig.statusPath, token: "" }
    : profile;
  const response = await fetch(buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"), {
    headers: {
      ...(runtimeProfile.token ? { Authorization: `Bearer ${runtimeProfile.token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as OpenAIModelList | null;
  if (!response.ok) throw new Error(errorMessage(data, `OpenAI-compatible runtime returned ${response.status}`));
  return data ?? {};
}

export const openAICompatibleAdapter: RuntimeAdapter = {
  runtime: "openai-compatible",
  label: "Local OpenAI",
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
    const models = usePodStatus
      ? usePodStatus.models.map((model) => model.id)
      : (await fetchModels(runtimeProfile)).data
        ?.map((model) => model.id)
        .filter((model): model is string => Boolean(model)) ?? [];
    const providerName = isUsePodProfile(profile)
      ? "UsePod"
      : profile.provider === "ollama"
        ? "Ollama"
        : profile.provider === "vllm"
          ? "vLLM"
          : profile.provider === "llamacpp"
            ? "llama.cpp"
            : profile.provider === "lm-studio"
              ? "LM Studio"
              : "OpenAI-compatible";
    return {
      baseUrl: cleanBaseUrl(runtimeProfile),
      chatPath: runtimeProfile.chatPath || "/v1/chat/completions",
      models,
      providerStatus: usePodStatus ? {
        usePod: {
          tokenEnvName: usePodStatus.tokenEnvName,
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
      } : undefined,
      modelSelection: {
        provider: profile.provider || "openai-compatible",
        model: profile.model || models[0] || "",
        providers: [{
          slug: profile.provider || "openai-compatible",
          name: providerName,
          models: models.map((id) => ({ id })),
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"),
        }],
      },
    };
  },
};
