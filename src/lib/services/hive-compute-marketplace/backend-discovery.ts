import { isHiveComputeBenchmarkableModel } from "@/lib/services/hive-compute-benchmark";
import {
  joinUrl,
  readSavedEnvValue,
} from "@/lib/services/hive-compute-marketplace/shared-io";
import {
  isHiveComputeBenchmarkCurrent,
  resolveHiveComputeModelPrice,
} from "@/lib/services/hive-compute-pricing";
import { isFleetCollectorUrl } from "@/lib/services/local-collector-url";
import { readLocalLmStudioLinkMap } from "@/lib/services/runtime-adapters/openai-compatible";
import type {
  HiveComputeHostModel,
  HiveComputeHostRunConfig,
  HiveComputeHostTarget,
  HiveComputeLocalBackendStatus,
} from "@/lib/types/hive-compute-marketplace";

/** Local/remote model-backend discovery for Hive Compute hosting. A machine can
 * run LM Studio (or another OpenAI-compatible server) and Ollama at the same
 * time, so discovery probes every candidate and merges their models with a
 * per-model backendKind; the worker routes each job to that model's engine. */

export type HiveComputeDiscoveryResult = {
  /** Primary backend, kept for compatibility: first reachable with models. */
  backend: HiveComputeLocalBackendStatus;
  /** Every probed candidate with its reachability message. */
  backends: HiveComputeLocalBackendStatus[];
  /** Models merged across every reachable backend (deduped by provider id). */
  models: HiveComputeHostModel[];
};

function normalizeOpenAiLocalBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export async function localBackendCandidates(): Promise<HiveComputeLocalBackendStatus[]> {
  const localOpenAiBase = normalizeOpenAiLocalBaseUrl(
    await readSavedEnvValue("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL") ||
    await readSavedEnvValue("LOCAL_OPENAI_BASE_URL") ||
    await readSavedEnvValue("NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL") ||
    "http://127.0.0.1:1234/v1",
  );
  const ollamaBase = (await readSavedEnvValue("OLLAMA_HOST") || await readSavedEnvValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434")
    .trim()
    .replace(/\/+$/, "");
  const candidates: HiveComputeLocalBackendStatus[] = [
    {
      kind: /1234(?:\/v1)?$/i.test(localOpenAiBase) ? "lmstudio" : "openai",
      label: /1234(?:\/v1)?$/i.test(localOpenAiBase) ? "LM Studio" : "OpenAI-compatible",
      host: localOpenAiBase,
      reachable: false,
      message: "",
    },
    {
      kind: "ollama",
      label: "Ollama",
      host: ollamaBase,
      reachable: false,
      message: "",
    },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.host}`;
    if (!candidate.host || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Every HivemindOS collector reverse-proxies its machine's local LM Studio
// (:1234) and arbitrary loopback ports (Ollama :11434) at /app-proxy/<port>/*,
// so a remote fleet machine's backend is reachable over Tailscale without any
// per-machine URL setup (see src/lib/services/fleet/lmstudio-model-hosts.ts).
function remoteBackendCandidates(collectorUrl: string): HiveComputeLocalBackendStatus[] {
  const base = collectorUrl.trim().replace(/\/+$/, "");
  return [
    { kind: "lmstudio", label: "LM Studio", host: `${base}/app-proxy/1234/v1`, reachable: false, message: "" },
    { kind: "ollama", label: "Ollama", host: `${base}/app-proxy/11434`, reachable: false, message: "" },
  ];
}

function modelName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  return name;
}

function extractOpenAiModels(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const models: Array<{ id: string; name?: string }> = [];
  const seen = new Set<string>();
  for (const item of rawModels) {
    const id = typeof item === "string"
      ? item.trim()
      : item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
        ? String((item as Record<string, unknown>).id).trim()
        : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: modelName(item) || undefined });
  }
  return models;
}

function extractOllamaModels(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawModels = Array.isArray(record.models) ? record.models : [];
  const models: Array<{ id: string; name?: string; sizeBytes?: number }> = [];
  const seen = new Set<string>();
  for (const item of rawModels) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = row && typeof row.name === "string"
      ? row.name.trim()
      : row && typeof row.model === "string"
        ? row.model.trim()
        : typeof item === "string"
          ? item.trim()
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const size = Number(row?.size);
    models.push({ id, ...(Number.isFinite(size) && size > 0 ? { sizeBytes: Math.round(size) } : {}) });
  }
  return models;
}

// LM Studio's OpenAI-compatible /v1/models omits sizes, but its native REST
// surface (/api/v0/models) can report them. Best-effort: any failure or absent
// field simply yields no size.
async function lmStudioModelSizes(host: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  try {
    const root = host.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const response = await fetch(joinUrl(root, "/api/v0/models"), {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return sizes;
    const payload = await response.json().catch(() => null) as { data?: unknown; models?: unknown } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    for (const item of rows) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? row.key ?? row.modelKey ?? "").trim();
      const size = Number(row.size_bytes ?? row.sizeBytes ?? row.size);
      if (id && Number.isFinite(size) && size > 0) sizes.set(id, Math.round(size));
    }
  } catch {
    // Size stays unknown; the memory-fit warning simply won't render.
  }
  return sizes;
}

async function probeBackend(candidate: HiveComputeLocalBackendStatus, config: HiveComputeHostRunConfig) {
  const url = candidate.kind === "ollama" ? joinUrl(candidate.host, "/api/tags") : joinUrl(candidate.host, "/models");
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        backend: { ...candidate, reachable: false, message: `${candidate.label} returned HTTP ${response.status}.` },
        models: [] as HiveComputeHostModel[],
      };
    }
    const parsedModels = (candidate.kind === "ollama" ? extractOllamaModels(data) : extractOpenAiModels(data))
      .filter((model) => isHiveComputeBenchmarkableModel(model.id));
    const sizeByModel: Map<string, number> = candidate.kind === "ollama" || !parsedModels.length
      ? new Map()
      : await lmStudioModelSizes(candidate.host);
    return {
      backend: {
        ...candidate,
        reachable: true,
        message: parsedModels.length
          ? `${candidate.label} reported ${parsedModels.length} model${parsedModels.length === 1 ? "" : "s"}.`
          : `${candidate.label} is reachable but did not report models.`,
      },
      models: parsedModels.map((model): HiveComputeHostModel => {
        const price = resolveHiveComputeModelPrice(model.id, config);
        const sizeBytes = (model as { sizeBytes?: number }).sizeBytes ?? sizeByModel.get(model.id);
        return {
          id: model.id,
          name: model.name,
          providerModelId: model.id,
          backendKind: candidate.kind,
          inputPer1m: price.inputUsdMicroPerMTok,
          outputPer1m: price.outputUsdMicroPerMTok,
          minimumJobUsdMicro: price.minimumJobUsdMicro,
          pricingSource: price.source,
          ...(sizeBytes && sizeBytes > 0 ? { sizeBytes } : {}),
          ...(isHiveComputeBenchmarkCurrent(config.modelBenchmarks[model.id]) ? { benchmark: config.modelBenchmarks[model.id] } : {}),
        };
      }),
    };
  } catch (error) {
    return {
      backend: {
        ...candidate,
        reachable: false,
        message: error instanceof Error && error.name === "TimeoutError"
          ? `${candidate.label} did not answer before timeout.`
          : `${candidate.label} is not reachable at ${candidate.host}.`,
      },
      models: [] as HiveComputeHostModel[],
    };
  }
}

export function isRemoteCollectorTarget(
  target?: HiveComputeHostTarget | null,
): target is HiveComputeHostTarget & { collectorUrl: string } {
  if (!target?.collectorUrl || target.isSelf) return false;
  const url = target.collectorUrl.trim();
  if (!url) return false;
  // A linkd peer-proxy URL (…/peer/<ip>:<port>) is loopback-hosted but reaches a
  // remote machine, so it stays eligible; a plain loopback collector is the local
  // host and should be probed directly instead.
  const isPeerProxy = /\/peer\//i.test(url);
  if (!isPeerProxy && /^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?|0\.0\.0\.0)(:|\/|$)/i.test(url)) return false;
  return isFleetCollectorUrl(url);
}

// A target was meant for a remote machine (not the dashboard host) even if we
// cannot reach its collector — used to keep the UI honest instead of silently
// showing the local host's models.
export function isRemoteTargetIntent(target?: HiveComputeHostTarget | null): boolean {
  return Boolean(target && target.isSelf === false);
}

// Tag LM Studio models that are actually served from a linked device (LM Link)
// with that device's friendly name, since the local /v1/models endpoint flattens
// them as if they were local on-disk models. Only OpenAI-compatible models can
// be LM Link entries, so Ollama models pass through untouched.
async function enrichLocalLmLinkModels(models: HiveComputeHostModel[]): Promise<HiveComputeHostModel[]> {
  if (!models.some((model) => model.backendKind !== "ollama")) return models;
  const linkMap = await readLocalLmStudioLinkMap().catch(() => null);
  if (!linkMap || !linkMap.byKey.size) return models;
  const lookup = (id: string) => {
    const direct = linkMap.byKey.get(id);
    if (direct) return direct;
    for (const [key, entry] of linkMap.byKey) {
      if (key === id || key.endsWith(`/${id}`) || id.endsWith(`/${key}`)) return entry;
    }
    return null;
  };
  return models.map((model) => {
    if (model.backendKind === "ollama") return model;
    const entry = lookup(model.providerModelId) ?? lookup(model.id);
    if (entry?.remote) {
      return { ...model, remote: true, ...(entry.hostDeviceName ? { hostDeviceName: entry.hostDeviceName } : {}) };
    }
    return model;
  });
}

const UNPROBED_FALLBACK: HiveComputeLocalBackendStatus = {
  kind: "openai",
  label: "OpenAI-compatible",
  host: "http://127.0.0.1:1234/v1",
  reachable: false,
  message: "No local OpenAI-compatible backend was checked.",
};

export async function discoverHiveComputeBackend(
  config: HiveComputeHostRunConfig,
  target?: HiveComputeHostTarget | null,
): Promise<HiveComputeDiscoveryResult> {
  const remote = isRemoteCollectorTarget(target);
  // Remote machine we can't reach over its collector — surface that instead of
  // falling back to the local host's models (the mismatch we're fixing).
  if (!remote && isRemoteTargetIntent(target)) {
    const unreachable: HiveComputeLocalBackendStatus = {
      kind: "openai",
      label: "Remote machine",
      host: target?.collectorUrl || "",
      reachable: false,
      message: `Can't reach ${target?.machineName || "that machine"}'s collector over Tailscale to list its models.`,
    };
    return { backend: unreachable, backends: [unreachable], models: [] };
  }
  const candidates = remote ? remoteBackendCandidates(target.collectorUrl) : await localBackendCandidates();
  const checked = await Promise.all(candidates.map((candidate) => probeBackend(candidate, config)));
  const backends = checked.map((candidate) => candidate.backend);
  const primary = checked.find((candidate) => candidate.backend.reachable && candidate.models.length)?.backend ??
    checked.find((candidate) => candidate.backend.reachable)?.backend ??
    backends[0] ??
    UNPROBED_FALLBACK;

  // Merge every reachable backend's models; on an id collision the first
  // candidate (LM Studio / OpenAI-compatible) wins.
  const merged: HiveComputeHostModel[] = [];
  const seen = new Set<string>();
  for (const candidate of checked) {
    for (const model of candidate.models) {
      if (seen.has(model.providerModelId)) continue;
      seen.add(model.providerModelId);
      merged.push(model);
    }
  }

  if (remote) {
    return {
      backend: primary,
      backends,
      models: merged.map((model) => ({
        ...model,
        remote: true,
        ...(target.machineName ? { hostDeviceName: target.machineName } : {}),
        ...(target.location ? { hostLocation: target.location } : {}),
      })),
    };
  }
  return { backend: primary, backends, models: await enrichLocalLmLinkModels(merged) };
}
