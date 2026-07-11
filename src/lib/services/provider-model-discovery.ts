import "server-only";

import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { buildUsePodProxyBaseUrl } from "@/lib/services/usepod";

const CHAT_MODEL_TYPES = new Set(["text", "llm", "chat", "language"]);

export type ConfiguredProviderModelDiscovery = {
  provider: string;
  providerLabel: string;
  keyEnv: string;
  configured: boolean;
  baseUrl: string;
  /** vision true/false when the provider's /models row declares input modalities; absent = unknown. */
  models: Array<{ id: string; vision?: boolean }>;
};

export function configuredProviderBaseUrl(slug: string, key: string) {
  if (slug === "usepod") return buildUsePodProxyBaseUrl(key, "openai").replace(/\/+$/, "");
  const entry = providerCatalogEntry(slug);
  return (entry?.baseUrl || MODEL_PROVIDER_GATEWAYS[slug]?.hermes?.baseUrl || "").replace(/\/+$/, "");
}

export function configuredProviderHeaders(slug: string, key: string) {
  const entry = providerCatalogEntry(slug);
  if (!entry) return { Accept: "application/json" };
  return {
    Accept: "application/json",
    ...(entry.modelsHeaders ?? {}),
    ...(slug === "usepod"
      ? {}
      : entry.modelsAuth === "x-api-key"
        ? { "x-api-key": key }
        : { Authorization: `Bearer ${key}` }),
  };
}

/**
 * Whether a /models row declares image input support. OpenRouter exposes
 * architecture.input_modalities (and the legacy "text+image->text" modality
 * string); Venice exposes model_spec.capabilities.supportsVision. Providers
 * whose rows carry no modality metadata (OpenAI, Anthropic, Groq, Gemini
 * OpenAI-compat, xAI) return undefined = unknown, never false.
 */
function rowVisionCapability(row: unknown): boolean | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as {
    architecture?: { input_modalities?: unknown; modality?: unknown };
    model_spec?: { capabilities?: { supportsVision?: unknown } };
  };
  const inputModalities = record.architecture?.input_modalities;
  if (Array.isArray(inputModalities)) {
    return inputModalities.some((item) => typeof item === "string" && item.toLowerCase() === "image");
  }
  const modality = record.architecture?.modality;
  if (typeof modality === "string" && modality.includes("->")) {
    return /image/i.test(modality.split("->")[0] ?? "");
  }
  const supportsVision = record.model_spec?.capabilities?.supportsVision;
  return typeof supportsVision === "boolean" ? supportsVision : undefined;
}

function modelDiscoveryError(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

export async function discoverConfiguredProviderModels(slug: string): Promise<ConfiguredProviderModelDiscovery> {
  const entry = providerCatalogEntry(slug);
  if (!entry?.keyEnv) throw new Error("Provider does not support configured model discovery.");
  const key = await hiveEnvValue(entry.keyEnv).catch(() => "");
  if (!key) {
    return {
      provider: slug,
      providerLabel: entry.name,
      keyEnv: entry.keyEnv,
      configured: false,
      baseUrl: "",
      models: [],
    };
  }
  const baseUrl = configuredProviderBaseUrl(slug, key);
  if (!baseUrl) throw new Error("Provider does not expose a model discovery endpoint.");
  const response = await fetch(`${baseUrl}/models`, {
    headers: configuredProviderHeaders(slug, key),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as { data?: unknown; models?: unknown } | null;
  if (!response.ok) throw new Error(modelDiscoveryError(data, `HTTP ${response.status}`));
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const models = rows
    .map((row) => {
      if (typeof row === "string") return { id: row, type: "", vision: undefined as boolean | undefined };
      const record = row as { id?: unknown; name?: unknown; type?: unknown };
      return {
        id: String(record?.id ?? record?.name ?? "").trim(),
        type: typeof record?.type === "string" ? record.type.toLowerCase() : "",
        vision: rowVisionCapability(row),
      };
    })
    .filter((model) => model.id && (!model.type || CHAT_MODEL_TYPES.has(model.type)))
    .map((model) => ({ id: model.id, ...(typeof model.vision === "boolean" ? { vision: model.vision } : {}) }));
  return {
    provider: slug,
    providerLabel: entry.name,
    keyEnv: entry.keyEnv,
    configured: true,
    baseUrl,
    models,
  };
}
