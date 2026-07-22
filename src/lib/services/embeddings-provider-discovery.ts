import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "@/lib/config/provider-catalog";
import { hiveEnvPresence } from "@/lib/services/shared-hive-env";
import { removeSharedHiveEnvValues, writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import { discoverLocalOpenAICompatibleServers } from "@/lib/services/runtime-adapters/openai-compatible";
import type { LocalOpenAICompatibleServer } from "@/lib/config/local-model-install-catalog";
import {
  invalidateAgentMemoryEmbeddingsConfigCache,
  publicEmbeddingsConfig,
  resolveAgentMemoryEmbeddingsConfig,
  type AgentMemoryEmbeddingsConfig,
} from "@/lib/services/obsidian/agent-memory/embeddings";
import type { AgentProfile } from "@/lib/types/agent-runtime";

// Embeddings provider picker backend: surfaces embedding-capable providers the
// same way the chat model picker surfaces chat providers — curated hosted
// entries from PROVIDER_CATALOG plus live-probed local OpenAI-compatible
// servers — and applies a selection by writing the HIVEMINDOS_EMBEDDINGS_*
// keys through the sanctioned shared-hive-env writer. The API key is never
// copied: hosted selections store a KEY_ENV pointer (e.g. OPENAI_API_KEY).

export type EmbeddingsModelOption = {
  id: string;
  label?: string;
  supportsDimensions?: boolean;
};

export type EmbeddingsProviderOption = {
  id: string;
  kind: "hosted" | "local";
  label: string;
  /** OpenAI-compatible base URL ending in /v1 (endpoint appends /embeddings). */
  baseUrl: string;
  keyEnv?: string;
  /** Hosted: key present. Local: server reachable with ≥1 embedding model. */
  configured: boolean;
  models: EmbeddingsModelOption[];
  iconPath?: string;
  iconMode?: "image" | "mask";
  fallback?: string;
  note?: string;
};

export type EmbeddingsProviderDiscovery = {
  options: EmbeddingsProviderOption[];
  current: AgentMemoryEmbeddingsConfig & { matchedOptionId?: string };
};

// Default reduced dimensions for hosted models that support the param; keeps
// the vector store small (matches the layer's original 256-dim default).
const HOSTED_DEFAULT_DIMENSIONS = 256;

function hostedOption(entry: ProviderCatalogEntry, keyPresent: boolean): EmbeddingsProviderOption | null {
  if (!entry.embeddingModels?.length || !entry.baseUrl) return null;
  return {
    id: entry.slug,
    kind: "hosted",
    label: entry.name,
    baseUrl: entry.baseUrl,
    keyEnv: entry.keyEnv,
    configured: keyPresent,
    models: entry.embeddingModels,
    iconPath: entry.iconPath,
    iconMode: entry.iconMode,
    fallback: entry.fallback,
    note: keyPresent ? undefined : `Add ${entry.keyEnv} to enable`,
  };
}

function localOption(server: LocalOpenAICompatibleServer): EmbeddingsProviderOption | null {
  const models = (server.models ?? [])
    .filter((model) => model.type === "embedding")
    .map((model) => ({ id: model.id, label: model.displayName || model.id }));
  return {
    id: `local:${server.baseUrl}`,
    kind: "local",
    label: server.label,
    baseUrl: `${server.baseUrl}/v1`,
    configured: Boolean(server.reachable && models.length),
    models,
    fallback: "LO",
    note: models.length ? undefined : "No embedding model loaded on this server",
  };
}

// Pure assembly (unit-testable without network).
export function buildEmbeddingsProviderOptions(input: {
  hosted: Array<{ entry: ProviderCatalogEntry; keyPresent: boolean }>;
  localServers: LocalOpenAICompatibleServer[];
}): EmbeddingsProviderOption[] {
  const hosted = input.hosted
    .map(({ entry, keyPresent }) => hostedOption(entry, keyPresent))
    .filter((option): option is EmbeddingsProviderOption => Boolean(option));
  const local = input.localServers
    .map(localOption)
    .filter((option): option is EmbeddingsProviderOption => Boolean(option));
  // Configured first, then locals (free) ahead of unconfigured hosted tiles.
  return [...hosted, ...local].sort((left, right) =>
    Number(right.configured) - Number(left.configured) || Number(left.kind === "hosted") - Number(right.kind === "hosted"));
}

export async function discoverEmbeddingsProviders(): Promise<EmbeddingsProviderDiscovery> {
  const hostedEntries = PROVIDER_CATALOG.filter((entry) => entry.embeddingModels?.length && entry.baseUrl);
  const keyEnvs = hostedEntries.map((entry) => entry.keyEnv).filter((key): key is string => Boolean(key));
  const [presence, localServers] = await Promise.all([
    hiveEnvPresence(keyEnvs).catch(() => []),
    discoverLocalOpenAICompatibleServers({} as AgentProfile).catch(() => []),
  ]);
  const presentKeys = new Set(presence.filter((item) => item.present).map((item) => item.key));
  const options = buildEmbeddingsProviderOptions({
    hosted: hostedEntries.map((entry) => ({ entry, keyPresent: Boolean(entry.keyEnv && presentKeys.has(entry.keyEnv)) })),
    localServers,
  });
  const resolved = await resolveAgentMemoryEmbeddingsConfig();
  const current = publicEmbeddingsConfig(resolved);
  const normalizedUrl = current.url?.replace(/\/+$/, "");
  const matched = normalizedUrl
    ? options.find((option) => option.baseUrl.replace(/\/+$/, "") === normalizedUrl)
    : undefined;
  return { options, current: { ...current, matchedOptionId: matched?.id } };
}

export async function applyEmbeddingsProviderSelection(input: { optionId: string; model: string; dimensions?: number }) {
  const discovery = await discoverEmbeddingsProviders();
  const option = discovery.options.find((candidate) => candidate.id === input.optionId);
  if (!option) throw new Error(`Unknown embeddings provider option: ${input.optionId}`);
  if (!option.configured) throw new Error(`${option.label} is not ready: ${option.note ?? "provider unavailable"}`);
  const model = option.models.find((candidate) => candidate.id === input.model);
  if (!model) throw new Error(`Model ${input.model} is not an embedding model on ${option.label}`);
  const dimensions = model.supportsDimensions
    ? Math.max(16, Math.trunc(input.dimensions ?? HOSTED_DEFAULT_DIMENSIONS))
    : undefined;
  await writeSharedHiveEnvValues({
    HIVEMINDOS_EMBEDDINGS_URL: option.baseUrl,
    HIVEMINDOS_EMBEDDINGS_MODEL: model.id,
    ...(option.keyEnv ? { HIVEMINDOS_EMBEDDINGS_KEY_ENV: option.keyEnv } : {}),
    ...(dimensions ? { HIVEMINDOS_EMBEDDINGS_DIMENSIONS: String(dimensions) } : {}),
  });
  const removals = [
    ...(option.keyEnv ? [] : ["HIVEMINDOS_EMBEDDINGS_KEY_ENV"]),
    ...(dimensions ? [] : ["HIVEMINDOS_EMBEDDINGS_DIMENSIONS"]),
  ];
  if (removals.length) await removeSharedHiveEnvValues(removals);
  invalidateAgentMemoryEmbeddingsConfigCache();
  return discoverEmbeddingsProviders();
}

export async function disableEmbeddingsProvider() {
  await removeSharedHiveEnvValues([
    "HIVEMINDOS_EMBEDDINGS_URL",
    "HIVEMINDOS_EMBEDDINGS_MODEL",
    "HIVEMINDOS_EMBEDDINGS_KEY_ENV",
    "HIVEMINDOS_EMBEDDINGS_DIMENSIONS",
  ]);
  invalidateAgentMemoryEmbeddingsConfigCache();
  return discoverEmbeddingsProviders();
}
