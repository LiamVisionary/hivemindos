import "server-only";

import {
  chatThreadTitleCloudRouteId,
  chatThreadTitleProviderFamily,
  chatThreadTitleRecommendation,
  scoreChatThreadTitleModel,
  type ChatThreadTitleAuthMode,
  type ChatThreadTitleCloudRoute,
} from "@/lib/config/chat-thread-title";
import { PROVIDER_CATALOG, providerCatalogEntry } from "@/lib/config/provider-catalog";
import { discoverConfiguredProviderModels } from "@/lib/services/provider-model-discovery";
import { openAiOAuthStatus } from "@/lib/services/openai-oauth";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { xaiOAuthStatus } from "@/lib/services/xai-oauth";

export type ChatThreadTitleModelHint = {
  provider?: string;
  model?: string;
};

const API_PROVIDER_ALIASES: Record<string, string> = {
  openai: "openai-api",
  "openai-api": "openai-api",
  google: "gemini",
  "google-gemini": "gemini",
  gemini: "gemini",
  anthropic: "anthropic",
  groq: "groq",
  xai: "xai",
  openrouter: "openrouter",
};

function canonicalApiProvider(provider: string) {
  return API_PROVIDER_ALIASES[provider] ?? provider;
}

function makeRoute(input: {
  provider: string;
  providerLabel: string;
  model: string;
  auth: ChatThreadTitleAuthMode;
  source: ChatThreadTitleCloudRoute["source"];
}) {
  const score = scoreChatThreadTitleModel(input.model);
  return {
    id: chatThreadTitleCloudRouteId(input.provider, input.model, input.auth),
    provider: input.provider,
    providerFamily: chatThreadTitleProviderFamily(input.provider),
    providerLabel: input.providerLabel,
    model: input.model,
    auth: input.auth,
    source: input.source,
    score,
    recommended: score >= 70,
    recommendation: chatThreadTitleRecommendation(input.model) || undefined,
  } satisfies ChatThreadTitleCloudRoute;
}

export async function discoverChatThreadTitleCloudRoutes(hints: ChatThreadTitleModelHint[]) {
  const [openAiOAuth, xaiOAuth] = await Promise.all([
    openAiOAuthStatus().catch(() => ({ connected: false })),
    xaiOAuthStatus({ syncFromHermes: false, validateAccess: true }).catch(() => ({ connected: false, usable: false })),
  ]);
  const apiProviders = [...new Set(PROVIDER_CATALOG
    .filter((provider) => provider.keyEnv && !provider.virtual)
    .map((provider) => provider.slug))];
  const providerPresence = await Promise.all(apiProviders.map(async (provider) => {
    const entry = providerCatalogEntry(provider);
    const configured = Boolean(entry?.keyEnv && await hiveEnvValue(entry.keyEnv).catch(() => ""));
    if (!configured) return { provider, configured: false, models: [] as Array<{ id: string }> };
    const discovery = await discoverConfiguredProviderModels(provider).catch(() => null);
    return { provider, configured: true, models: discovery?.models ?? [] };
  }));
  const configuredApiProviders = new Set(providerPresence.filter((item) => item.configured).map((item) => item.provider));
  const routes = new Map<string, ChatThreadTitleCloudRoute>();
  const addRoute = (route: ChatThreadTitleCloudRoute) => {
    if (route.score < 0) return;
    const existing = routes.get(route.id);
    if (!existing || (existing.source === "profile" && route.source !== "profile")) routes.set(route.id, route);
  };

  for (const item of providerPresence) {
    if (!item.configured) continue;
    const entry = providerCatalogEntry(item.provider);
    for (const model of item.models.slice(0, 1_000)) {
      addRoute(makeRoute({
        provider: item.provider,
        providerLabel: entry?.name ?? item.provider,
        model: model.id,
        auth: "api",
        source: "live",
      }));
    }
  }

  for (const hint of hints.slice(0, 300)) {
    const provider = String(hint.provider ?? "").trim();
    const model = String(hint.model ?? "").trim();
    if (!provider || !model) continue;
    if (provider === "openai-codex" && openAiOAuth.connected) {
      addRoute(makeRoute({ provider, providerLabel: "OpenAI", model, auth: "oauth", source: "profile" }));
      continue;
    }
    if (provider === "xai-oauth" && xaiOAuth.usable) {
      addRoute(makeRoute({ provider, providerLabel: "Grok (xAI)", model, auth: "oauth", source: "profile" }));
      continue;
    }
    const apiProvider = canonicalApiProvider(provider);
    if (!configuredApiProviders.has(apiProvider)) continue;
    addRoute(makeRoute({
      provider: apiProvider,
      providerLabel: providerCatalogEntry(apiProvider)?.name ?? apiProvider,
      model,
      auth: "api",
      source: "profile",
    }));
  }

  if (openAiOAuth.connected) {
    addRoute(makeRoute({ provider: "openai-codex", providerLabel: "OpenAI", model: "gpt-5.4", auth: "oauth", source: "oauth" }));
  }
  if (xaiOAuth.usable) {
    addRoute(makeRoute({ provider: "xai-oauth", providerLabel: "Grok (xAI)", model: "grok-4.3", auth: "oauth", source: "oauth" }));
  }

  return [...routes.values()].sort((left, right) => (
    right.score - left.score
    || left.providerLabel.localeCompare(right.providerLabel)
    || left.model.localeCompare(right.model)
    || left.auth.localeCompare(right.auth)
  ));
}
