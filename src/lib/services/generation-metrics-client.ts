import {
  generationMetricKey,
  type GenerationMetricEntry,
  type GenerationMetricIdentity,
  type GenerationMetricRecordInput,
  type GenerationMetricsSnapshot,
} from "@/lib/types/generation-metrics";

const GENERATION_METRICS_ENDPOINT = "/api/generation-metrics";

let cachedSnapshot: GenerationMetricsSnapshot | null = null;
let pendingSnapshot: Promise<GenerationMetricsSnapshot | null> | null = null;

function emptySnapshot(): GenerationMetricsSnapshot {
  return {
    ok: true,
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    summary: "No completed generation timing samples have been recorded yet.",
  };
}

export function cachedGenerationMetric(input: Partial<GenerationMetricIdentity>): GenerationMetricEntry | null {
  const key = generationMetricKey(input);
  return key ? cachedSnapshot?.entries[key] ?? null : null;
}

export async function loadGenerationMetricsSnapshot(force = false) {
  if (cachedSnapshot && !force) return cachedSnapshot;
  if (pendingSnapshot && !force) return pendingSnapshot;
  pendingSnapshot = fetch(GENERATION_METRICS_ENDPOINT, {
    cache: "no-store",
    headers: { accept: "application/json" },
  })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      cachedSnapshot = data?.ok ? data as GenerationMetricsSnapshot : emptySnapshot();
      return cachedSnapshot;
    })
    .catch(() => {
      cachedSnapshot = cachedSnapshot ?? emptySnapshot();
      return cachedSnapshot;
    })
    .finally(() => {
      pendingSnapshot = null;
    });
  return pendingSnapshot;
}

export async function recordGenerationMetric(input: GenerationMetricRecordInput) {
  const response = await fetch(GENERATION_METRICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as GenerationMetricsSnapshot | null;
  if (response?.ok && data?.ok) {
    cachedSnapshot = data;
    return data;
  }
  return cachedSnapshot ?? emptySnapshot();
}
