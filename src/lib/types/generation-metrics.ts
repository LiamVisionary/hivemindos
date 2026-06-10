export type GenerationMetricKind = "image" | "music" | "tts" | "model3d" | "video";

export type GenerationMetricIdentity = {
  kind: GenerationMetricKind;
  appId?: string;
  appName?: string;
  serviceKind?: string;
  modelName?: string;
  machineName?: string;
  machineSpecs?: string;
};

export type GenerationMetricRecordInput = GenerationMetricIdentity & {
  durationMs: number;
  runId?: string;
  completedAt?: number;
};

export type GenerationMetricEntry = GenerationMetricIdentity & {
  key: string;
  count: number;
  averageDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  lastDurationMs: number;
  recentDurationsMs: number[];
  recentRunIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type GenerationMetricsSnapshot = {
  ok: true;
  version: 1;
  updatedAt: string;
  entries: Record<string, GenerationMetricEntry>;
  summary: string;
};

function cleanMetricPart(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function generationMetricKey(input: Partial<GenerationMetricIdentity>) {
  const parts = [
    input.kind,
    cleanMetricPart(input.appId) || cleanMetricPart(input.appName),
    cleanMetricPart(input.serviceKind),
    cleanMetricPart(input.modelName),
    cleanMetricPart(input.machineName),
    cleanMetricPart(input.machineSpecs),
  ].map((part) => cleanMetricPart(part).toLowerCase()).filter(Boolean);
  return parts.length >= 3 ? parts.join("\u001f") : "";
}

export function compactGenerationMetricIdentity(input: Partial<GenerationMetricIdentity>): GenerationMetricIdentity | null {
  const kind = input.kind === "image" || input.kind === "music" || input.kind === "tts" || input.kind === "model3d" || input.kind === "video"
    ? input.kind
    : null;
  if (!kind) return null;
  return {
    kind,
    appId: cleanMetricPart(input.appId) || undefined,
    appName: cleanMetricPart(input.appName) || undefined,
    serviceKind: cleanMetricPart(input.serviceKind) || undefined,
    modelName: cleanMetricPart(input.modelName) || undefined,
    machineName: cleanMetricPart(input.machineName) || undefined,
    machineSpecs: cleanMetricPart(input.machineSpecs) || undefined,
  };
}
