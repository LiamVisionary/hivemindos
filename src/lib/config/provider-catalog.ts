import { MODEL_PROVIDER_GATEWAYS } from "./model-provider-gateways";

/**
 * Canonical, runtime-independent catalog of first-class model providers for the
 * chat model picker. It guarantees a provider tile shows even when the active
 * runtime's inventory hasn't surfaced it (e.g. an OpenRouter key that lives only
 * in the shared hive env), so users can discover a provider and onboard its key
 * inline instead of the provider being hidden.
 *
 * Slugs align with Hermes provider slugs so `set-model` / routing stay correct.
 * Only API-key providers are listed; OAuth / subscription providers
 * (xai-oauth, copilot, openai-codex) use dedicated OAuth/runtime setup paths
 * rather than pretending they have a hive-env API key.
 */
export type ProviderCatalogEntry = {
  slug: string;
  name: string;
  /** Shared hive-env var holding the API key; absent for keyless/virtual providers. */
  keyEnv?: string;
  iconPath?: string;
  iconMode?: "image" | "mask";
  fallback: string;
  /** OpenAI-compatible local servers need no key. */
  keyless?: boolean;
  /** Routing-only providers with no single API key (e.g. Hive Fusion). */
  virtual?: boolean;
  /** Providers with a dedicated guided setup instead of the plain key input. */
  guidedSetup?: "venice" | "usepod";
  /** Base URL for a live `/models` fetch once the key is configured. */
  baseUrl?: string;
  /** Auth header style for the `/models` fetch (default: bearer). */
  modelsAuth?: "bearer" | "x-api-key";
  /** Extra headers for the `/models` fetch (e.g. anthropic-version). */
  modelsHeaders?: Record<string, string>;
  /**
   * Embedding models servable from this provider's OpenAI-compatible
   * `/embeddings` endpoint (shared-brain semantic recall). Curated, not
   * live-fetched: hosted embedding lineups are small and stable.
   */
  embeddingModels?: Array<{ id: string; label?: string; supportsDimensions?: boolean }>;
};

// Gateways that carry their key outside a `hermes` block need their keyEnv here.
const GATEWAY_KEY_ENV: Record<string, string> = { openrouter: "OPENROUTER_API_KEY" };
// Gateways that support a live `/models` fetch (UsePod resolves a tokenized
// proxy URL at request time, so it is handled in the route, not here).
const GATEWAY_BASE_URL: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  venice: "https://api.venice.ai/api/v1",
};
const VIRTUAL_SLUGS = new Set(["hive-fusion"]);
const GUIDED_SETUP: Record<string, "venice" | "usepod"> = { venice: "venice", usepod: "usepod" };

function gatewayCatalogEntry(slug: string): ProviderCatalogEntry | null {
  const gateway = MODEL_PROVIDER_GATEWAYS[slug];
  if (!gateway) return null;
  const virtual = VIRTUAL_SLUGS.has(slug);
  const keyEnv = virtual ? undefined : GATEWAY_KEY_ENV[slug] ?? (gateway.hermes?.keyEnv?.trim() || undefined);
  return {
    slug,
    name: gateway.name,
    keyEnv,
    iconPath: gateway.iconPath,
    iconMode: gateway.iconMode,
    fallback: gateway.fallback,
    keyless: !virtual && !keyEnv,
    virtual,
    guidedSetup: GUIDED_SETUP[slug],
    baseUrl: GATEWAY_BASE_URL[slug],
  };
}

// Key-based providers not represented as MODEL_PROVIDER_GATEWAYS gateways today.
const EXTRA_PROVIDERS: ProviderCatalogEntry[] = [
  {
    slug: "openai-api",
    name: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    iconPath: "/icons/runtimes/openai.svg",
    iconMode: "mask",
    fallback: "AI",
    baseUrl: "https://api.openai.com/v1",
    embeddingModels: [
      { id: "text-embedding-3-small", label: "Embedding 3 Small", supportsDimensions: true },
      { id: "text-embedding-3-large", label: "Embedding 3 Large", supportsDimensions: true },
      { id: "text-embedding-ada-002", label: "Ada 002 (legacy)" },
    ],
  },
  { slug: "anthropic", name: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", fallback: "AN", baseUrl: "https://api.anthropic.com/v1", modelsAuth: "x-api-key", modelsHeaders: { "anthropic-version": "2023-06-01" } },
  { slug: "groq", name: "Groq", keyEnv: "GROQ_API_KEY", fallback: "GQ", baseUrl: "https://api.groq.com/openai/v1" },
  { slug: "gemini", name: "Gemini", keyEnv: "GEMINI_API_KEY", fallback: "GM", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  // xAI (Grok) — OpenAI-compatible chat, used as a spoken-turn brain (no realtime/TTS API).
  { slug: "xai", name: "Grok (xAI)", keyEnv: "XAI_API_KEY", fallback: "GK", baseUrl: "https://api.x.ai/v1" },
];

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  ...Object.keys(MODEL_PROVIDER_GATEWAYS)
    .map(gatewayCatalogEntry)
    .filter((entry): entry is ProviderCatalogEntry => Boolean(entry)),
  ...EXTRA_PROVIDERS,
];

const CATALOG_BY_SLUG = new Map(PROVIDER_CATALOG.map((entry) => [entry.slug, entry]));

export function providerCatalogEntry(slug: string | undefined | null): ProviderCatalogEntry | undefined {
  return slug ? CATALOG_BY_SLUG.get(slug) : undefined;
}

export function providerKeyEnv(slug: string | undefined | null): string | undefined {
  return providerCatalogEntry(slug)?.keyEnv;
}
