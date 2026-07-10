import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { readStoredAgentProfilesStrict } from "@/lib/services/agent-profile-store";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export type ConfiguredQueenProviderFallback = {
  provider: string;
  model: string;
  label: string;
  statusAgent: Pick<AgentProfile, "id" | "name" | "runtime" | "provider" | "model">;
};

type FallbackDependencies = {
  readProfiles?: () => Promise<AgentProfile[]>;
  credentialPresent?: (keyEnv: string) => Promise<boolean>;
};

/**
 * Reuse models the user already configured on another agent. This list only
 * discovers direct OpenAI-compatible API-key lanes; runtime-held OAuth and
 * adaptive routes retain their own execution paths.
 */
export async function configuredQueenProviderFallbacks(
  options: { excludeProvider?: string; excludeModel?: string; limit?: number } = {},
  dependencies: FallbackDependencies = {},
): Promise<ConfiguredQueenProviderFallback[]> {
  const readProfiles = dependencies.readProfiles ?? readStoredAgentProfilesStrict;
  const credentialPresent = dependencies.credentialPresent ?? (async (keyEnv: string) => (
    Boolean(await hiveEnvValue(keyEnv).catch(() => ""))
  ));
  const excludedProvider = options.excludeProvider?.trim().toLowerCase() ?? "";
  const excludedModel = options.excludeModel?.trim().toLowerCase() ?? "";
  const seen = new Set<string>();
  const fallbacks: ConfiguredQueenProviderFallback[] = [];

  for (const profile of await readProfiles().catch(() => [])) {
    const provider = profile.provider?.trim().toLowerCase() ?? "";
    const model = profile.model?.trim() ?? "";
    const key = `${provider}\n${model.toLowerCase()}`;
    if (
      !provider ||
      !model ||
      model.toLowerCase() === "adaptive" ||
      (provider === excludedProvider && model.toLowerCase() === excludedModel) ||
      seen.has(key)
    ) continue;
    const catalog = providerCatalogEntry(provider);
    if (!catalog?.baseUrl || !catalog.keyEnv || catalog.modelsAuth === "x-api-key") continue;
    if (!await credentialPresent(catalog.keyEnv)) continue;
    seen.add(key);
    fallbacks.push({
      provider,
      model,
      label: `${model} · ${catalog.name}`,
      statusAgent: {
        id: profile.id,
        name: profile.name,
        runtime: profile.runtime,
        provider,
        model,
      },
    });
    if (fallbacks.length >= Math.max(1, options.limit ?? 2)) break;
  }
  return fallbacks;
}

export async function runConfiguredQueenProviderFallback(
  options: { excludeProvider?: string; excludeModel?: string; limit?: number },
  run: (fallback: ConfiguredQueenProviderFallback) => Promise<string>,
  onError?: (fallback: ConfiguredQueenProviderFallback, error: unknown) => void,
) {
  for (const fallback of await configuredQueenProviderFallbacks(options)) {
    try {
      const text = await run(fallback);
      if (text.trim()) return { fallback, text };
    } catch (error) {
      onError?.(fallback, error);
    }
  }
  return null;
}
