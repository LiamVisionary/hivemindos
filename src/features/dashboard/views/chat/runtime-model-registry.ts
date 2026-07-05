import type { RuntimeModelSelection } from "@/features/dashboard/dashboard-types";
import { scoreModelStrength } from "@/lib/config/model-strength";

type RuntimeModelProvider = RuntimeModelSelection["providers"][number];
type RuntimeModelOption = RuntimeModelProvider["models"][number];

const BANKR_BASE_MODEL_ID = "gemini-3-flash";
const BANKR_ADAPTIVE_MODEL_ID = "adaptive";

export function summarizeRuntimeModelRegistry(providers: RuntimeModelProvider[], selectedProviderSlug?: string) {
  const providerCount = providers.length;
  const visibleModelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const totalModelCount = providers.reduce((sum, provider) => sum + Math.max(provider.totalModels || 0, provider.models.length), 0);
  const selectedProvider = providers.find((provider) => provider.slug === selectedProviderSlug) ?? providers[0];
  return {
    providerCount,
    visibleModelCount,
    totalModelCount,
    selectedProviderName: selectedProvider?.name ?? "",
    selectedProviderModelCount: selectedProvider?.models.length ?? 0,
  };
}

function modelSearchText(model: RuntimeModelOption) {
  return `${model.id} ${model.name ?? ""}`.toLowerCase();
}

function scoreModel(model: RuntimeModelOption) {
  const text = modelSearchText(model);
  // Family ranking is single-sourced in the model-strength matrix; only the
  // catalog-specific demotions (previews, deprecations) live here.
  let score = scoreModelStrength(text).score;
  if (text.includes("preview")) score -= 15;
  if (text.includes("deprecated")) score -= 200;
  return score;
}

export function selectBestRuntimeModel(provider: RuntimeModelProvider | undefined, options: {
  currentModel?: string;
  defaultModel?: string;
  runtimeSelectedModel?: string;
  preferAdaptive?: boolean;
} = {}) {
  const models = provider?.models ?? [];
  if (!provider || !models.length) return options.defaultModel || options.currentModel || options.runtimeSelectedModel || "";

  const candidates = [
    options.defaultModel,
    options.currentModel,
    options.runtimeSelectedModel,
  ].map((value) => value?.trim()).filter(Boolean);
  const exactCandidate = candidates.find((candidate) => models.some((model) => model.id === candidate));
  if (exactCandidate) return exactCandidate;
  if (options.preferAdaptive && provider.slug === "openrouter") return "adaptive";

  return [...models].sort((left, right) => scoreModel(right) - scoreModel(left))[0]?.id ?? "";
}

export function gateBankrModelsForCredits(models: RuntimeModelOption[], lowCredits: boolean) {
  if (!lowCredits) return models;
  return models.map((model) => {
    const credited = model.id === BANKR_ADAPTIVE_MODEL_ID || (model.group ?? model.subtitle ?? "").toLowerCase().includes("max mode");
    return credited && model.id !== BANKR_BASE_MODEL_ID
      ? { ...model, disabled: true, disabledReason: "Top up credits" }
      : model;
  });
}
