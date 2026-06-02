import type { RuntimeModelSelection } from "@/features/dashboard/dashboard-types";

type RuntimeModelProvider = RuntimeModelSelection["providers"][number];
type RuntimeModelOption = RuntimeModelProvider["models"][number];

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
  let score = 0;
  if (text.includes("adaptive")) score += 1000;
  if (text.includes("gpt-5")) score += 920;
  if (text.includes("codex")) score += 880;
  if (text.includes("claude-4") || text.includes("claude-sonnet-4") || text.includes("claude-opus-4")) score += 860;
  if (text.includes("qwen3.7") || text.includes("qwen3-7") || text.includes("qwen-3.7")) score += 840;
  if (text.includes("max")) score += 70;
  if (text.includes("pro")) score += 55;
  if (text.includes("sonnet")) score += 45;
  if (text.includes("reason")) score += 35;
  if (text.includes("mini")) score -= 80;
  if (text.includes("nano")) score -= 90;
  if (text.includes("small")) score -= 60;
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
