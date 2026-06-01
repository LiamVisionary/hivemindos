import type { RuntimeModelSelection } from "@/features/dashboard/dashboard-types";

type RuntimeModelProvider = RuntimeModelSelection["providers"][number];

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
