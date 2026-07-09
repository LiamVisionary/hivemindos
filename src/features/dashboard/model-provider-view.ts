import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { PROVIDER_CATALOG } from "@/lib/config/provider-catalog";

export type ProviderCredentialMode = "api-key" | "oauth";

export const XAI_PROVIDER_SLUG = "xai";
export const XAI_OAUTH_PROVIDER_SLUG = "xai-oauth";
export const XAI_OAUTH_DEFAULT_MODEL = "grok-4.3";

type ProviderCredentialGroup = {
  displaySlug: string;
  modes: Partial<Record<ProviderCredentialMode, string>>;
};

const PROVIDER_CREDENTIAL_GROUPS: Record<string, ProviderCredentialGroup> = {
  [XAI_PROVIDER_SLUG]: {
    displaySlug: XAI_PROVIDER_SLUG,
    modes: {
      "api-key": XAI_PROVIDER_SLUG,
      oauth: XAI_OAUTH_PROVIDER_SLUG,
    },
  },
};

const RUNTIME_PROVIDER_TO_GROUP = new Map<string, { group: ProviderCredentialGroup; mode: ProviderCredentialMode }>();
for (const group of Object.values(PROVIDER_CREDENTIAL_GROUPS)) {
  for (const [mode, runtimeSlug] of Object.entries(group.modes) as Array<[ProviderCredentialMode, string | undefined]>) {
    if (runtimeSlug) RUNTIME_PROVIDER_TO_GROUP.set(runtimeSlug, { group, mode });
  }
}

const PROVIDER_SORT_INDEX = new Map(PROVIDER_CATALOG.map((provider, index) => [provider.slug, index]));
const FIRST_CLASS_PROVIDER_SLUGS = new Set(PROVIDER_CATALOG.map((entry) => entry.slug));

export type RuntimeModelProviderLike<TModel extends { id?: string } = { id?: string }> = {
  slug: string;
  name?: string;
  models?: readonly TModel[];
  totalModels?: number;
  isCurrent?: boolean;
  isUserDefined?: boolean;
  source?: string;
};

export function configuredProviderDisplayName(slug: string) {
  const displaySlug = dashboardProviderSlug(slug);
  const gateway = MODEL_PROVIDER_GATEWAYS[displaySlug];
  if (gateway) return gateway.name;
  const catalog = PROVIDER_CATALOG.find((entry) => entry.slug === displaySlug);
  if (catalog) return catalog.name;
  return displaySlug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      part === "openai" ? "OpenAI" : part === "ai" ? "AI" : part === "llm" ? "LLM" : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ") || displaySlug;
}

export function stableProviderDisplayName(slug: string, runtimeName?: string | null) {
  const displaySlug = dashboardProviderSlug(slug);
  if (MODEL_PROVIDER_GATEWAYS[displaySlug] || FIRST_CLASS_PROVIDER_SLUGS.has(displaySlug)) {
    return configuredProviderDisplayName(displaySlug);
  }
  const name = runtimeName?.trim();
  return name || configuredProviderDisplayName(displaySlug);
}

export function dashboardProviderSlug(slug?: string | null) {
  const runtimeSlug = slug || "";
  return RUNTIME_PROVIDER_TO_GROUP.get(runtimeSlug)?.group.displaySlug ?? runtimeSlug;
}

export function providerCredentialMode(slug?: string | null): ProviderCredentialMode {
  const runtimeSlug = slug || "";
  return RUNTIME_PROVIDER_TO_GROUP.get(runtimeSlug)?.mode ?? "api-key";
}

export function runtimeProviderForCredentialMode(displaySlug: string, mode: ProviderCredentialMode) {
  return PROVIDER_CREDENTIAL_GROUPS[displaySlug]?.modes[mode] ?? displaySlug;
}

export function providerSupportsCredentialMode(displaySlug: string, mode: ProviderCredentialMode) {
  return Boolean(PROVIDER_CREDENTIAL_GROUPS[displaySlug]?.modes[mode]);
}

export function modelProviderSelection(slug?: string | null) {
  const runtimeSlug = slug || "";
  const displaySlug = dashboardProviderSlug(runtimeSlug);
  const credentialMode = providerCredentialMode(runtimeSlug);
  return {
    credentialMode,
    displaySlug,
    runtimeSlug,
  };
}

export function providerSortIndex(slug: string) {
  return PROVIDER_SORT_INDEX.get(dashboardProviderSlug(slug)) ?? 10_000;
}

export function mergeProviderModels<T extends { id?: string }>(primary: readonly T[] = [], secondary: readonly T[] = []) {
  const seen = new Set<string>();
  const models: T[] = [];
  for (const model of [...primary, ...secondary]) {
    const id = String(model?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(model);
  }
  return models;
}

export function collapseDashboardProviderAliases<TProvider extends RuntimeModelProviderLike>(
  providersBySlug: Map<string, TProvider>,
  selectedProviderSlug?: string | null,
) {
  const xaiOAuthProvider = providersBySlug.get(XAI_OAUTH_PROVIDER_SLUG);
  if (!xaiOAuthProvider) return;
  const xaiProvider = providersBySlug.get(XAI_PROVIDER_SLUG);
  const models = mergeProviderModels(xaiProvider?.models, xaiOAuthProvider.models);
  providersBySlug.set(XAI_PROVIDER_SLUG, {
    ...(xaiProvider ?? {
      slug: XAI_PROVIDER_SLUG,
      name: configuredProviderDisplayName(XAI_PROVIDER_SLUG),
      isUserDefined: true,
      source: "catalog",
    }),
    slug: XAI_PROVIDER_SLUG,
    name: stableProviderDisplayName(XAI_PROVIDER_SLUG, xaiProvider?.name),
    models,
    totalModels: models.length,
    isCurrent: Boolean(
      xaiProvider?.isCurrent ||
      xaiOAuthProvider.isCurrent ||
      dashboardProviderSlug(selectedProviderSlug) === XAI_PROVIDER_SLUG
    ),
    source: xaiProvider?.source === "catalog"
      ? xaiOAuthProvider.source || xaiProvider.source
      : xaiProvider?.source || xaiOAuthProvider.source,
  } as TProvider);
  providersBySlug.delete(XAI_OAUTH_PROVIDER_SLUG);
}
