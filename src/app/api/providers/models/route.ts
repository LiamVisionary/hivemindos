import { requireAuth } from "@/lib/utils/server-auth";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { discoverConfiguredProviderModels } from "@/lib/services/provider-model-discovery";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";

/**
 * Live model list for a configured catalog provider. Resolves the provider's
 * base URL (from the provider catalog) and its API key (from the shared hive
 * env, never returned to the client) and calls `/models`, so configured
 * providers (OpenRouter, OpenAI, Anthropic, Groq, Gemini, Venice) show their real, current
 * models instead of the Hermes-configured subset. Fetched lazily so it never
 * blocks the settings status sweep. (UsePod is intentionally excluded: its
 * token is per-agent and its own guided setup owns model discovery.)
 */
export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const slug = new URL(request.url).searchParams.get("provider")?.trim() ?? "";
  const entry = providerCatalogEntry(slug);
  if (!entry?.keyEnv) {
    return errorJson("Provider does not support live model discovery.");
  }

  try {
    const discovery = await discoverConfiguredProviderModels(slug);
    if (!discovery.configured) return errorJson(`${entry.keyEnv} is not configured.`);
    return okJson({ provider: slug, models: discovery.models });
  } catch (error) {
    return upstreamErrorJson("Model fetch failed", error);
  }
}
