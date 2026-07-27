import "server-only";

import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import { evolveAgentMemory, rememberAgentMemory } from "@/lib/services/obsidian/agent-memory";
import {
  compactGenerationMetricIdentity,
  generationMetricKey,
  type GenerationMetricEntry,
  type GenerationMetricRecordInput,
  type GenerationMetricsSnapshot,
} from "@/lib/types/generation-metrics";

const GENERATION_METRICS_FILE = join(homedir(), ".hivemindos", "generation-metrics.json");
const MAX_ENTRIES = 160;
const MAX_RECENT_DURATIONS = 24;
const MAX_RECENT_RUN_IDS = 80;
const MIN_SHARED_BRAIN_SAMPLE_COUNT = 3;
const SHARED_BRAIN_SUMMARY_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

type GenerationMetricsSharedBrainSummary = {
  hash: string;
  writtenAt: string;
  sampleCount: number;
  memoryId?: string;
  notePath?: string;
  error?: string;
};

type GenerationMetricsFile = {
  version: 1;
  updatedAt: string;
  entries: Record<string, GenerationMetricEntry>;
  sharedBrainSummary?: GenerationMetricsSharedBrainSummary;
};

let cachedMetrics: GenerationMetricsFile | null = null;
let writeQueue: Promise<GenerationMetricsFile> = Promise.resolve(emptyMetricsFile());

function emptyMetricsFile(): GenerationMetricsFile {
  return { version: 1, updatedAt: new Date(0).toISOString(), entries: {} };
}

function percentile(values: number[], percent: number) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function normalizeEntry(key: string, value: unknown): GenerationMetricEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GenerationMetricEntry>;
  const identity = compactGenerationMetricIdentity(record);
  if (!identity) return null;
  const recentDurationsMs = Array.isArray(record.recentDurationsMs)
    ? record.recentDurationsMs.filter((item) => Number.isFinite(item) && item >= 0).slice(-MAX_RECENT_DURATIONS)
    : [];
  const count = Math.max(0, Math.trunc(Number(record.count) || recentDurationsMs.length));
  const averageDurationMs = Math.max(0, Math.round(Number(record.averageDurationMs) || 0));
  return {
    ...identity,
    key,
    count,
    averageDurationMs,
    minDurationMs: Math.max(0, Math.round(Number(record.minDurationMs) || averageDurationMs)),
    maxDurationMs: Math.max(0, Math.round(Number(record.maxDurationMs) || averageDurationMs)),
    p50DurationMs: Math.max(0, Math.round(Number(record.p50DurationMs) || percentile(recentDurationsMs, 50))),
    p95DurationMs: Math.max(0, Math.round(Number(record.p95DurationMs) || percentile(recentDurationsMs, 95))),
    lastDurationMs: Math.max(0, Math.round(Number(record.lastDurationMs) || recentDurationsMs.at(-1) || averageDurationMs)),
    recentDurationsMs,
    recentRunIds: Array.isArray(record.recentRunIds)
      ? record.recentRunIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(-MAX_RECENT_RUN_IDS)
      : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeMetricsFile(value: unknown): GenerationMetricsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyMetricsFile();
  const record = value as Partial<GenerationMetricsFile>;
  const entries = Object.fromEntries(Object.entries(record.entries ?? {})
    .map(([key, entry]) => [key, normalizeEntry(key, entry)] as const)
    .filter((item): item is readonly [string, GenerationMetricEntry] => Boolean(item[1])));
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    entries,
    sharedBrainSummary: normalizeSharedBrainSummary(record.sharedBrainSummary),
  };
}

function normalizeSharedBrainSummary(value: unknown): GenerationMetricsSharedBrainSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<GenerationMetricsSharedBrainSummary>;
  const hash = typeof record.hash === "string" ? record.hash.trim() : "";
  const writtenAt = typeof record.writtenAt === "string" ? record.writtenAt : "";
  if (!hash || !writtenAt) return undefined;
  return {
    hash,
    writtenAt,
    sampleCount: Math.max(0, Math.trunc(Number(record.sampleCount) || 0)),
    memoryId: typeof record.memoryId === "string" ? record.memoryId : undefined,
    notePath: typeof record.notePath === "string" ? record.notePath : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

async function loadMetricsFile() {
  if (cachedMetrics) return cachedMetrics;
  try {
    const raw = await readFile(GENERATION_METRICS_FILE, "utf8");
    cachedMetrics = normalizeMetricsFile(JSON.parse(raw) as unknown);
  } catch {
    cachedMetrics = emptyMetricsFile();
  }
  return cachedMetrics;
}

async function writeMetricsFile(metrics: GenerationMetricsFile) {
  cachedMetrics = metrics;
  await mkdir(dirname(GENERATION_METRICS_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${GENERATION_METRICS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(metrics, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, GENERATION_METRICS_FILE);
}

function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function entryLabel(entry: GenerationMetricEntry) {
  return [
    entry.appName || entry.appId || "unknown app",
    entry.modelName,
    entry.machineName,
    entry.machineSpecs,
  ].filter(Boolean).join(" / ");
}

function sampleCountFor(entries: Record<string, GenerationMetricEntry>) {
  return Object.values(entries).reduce((total, entry) => total + Math.max(0, Math.trunc(entry.count || 0)), 0);
}

export function summarizeGenerationMetrics(entries: Record<string, GenerationMetricEntry>, kind?: string) {
  const ranked = Object.values(entries)
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => entry.count > 0 && entry.averageDurationMs > 0)
    .sort((left, right) => left.averageDurationMs - right.averageDurationMs)
    .slice(0, 5);
  if (!ranked.length) return "No completed generation timing samples have been recorded yet.";
  const [fastest] = ranked;
  return [
    `Fastest ${kind ?? "generation"} path: ${entryLabel(fastest)} averages ${formatDuration(fastest.averageDurationMs)} over ${fastest.count} run${fastest.count === 1 ? "" : "s"} (p95 ${formatDuration(fastest.p95DurationMs || fastest.averageDurationMs)}).`,
    ranked.slice(1).map((entry) => `- ${entryLabel(entry)}: avg ${formatDuration(entry.averageDurationMs)}, p50 ${formatDuration(entry.p50DurationMs || entry.averageDurationMs)}, p95 ${formatDuration(entry.p95DurationMs || entry.averageDurationMs)}, ${entry.count} runs`).join("\n"),
  ].filter(Boolean).join("\n");
}

function sharedBrainSummaryContent(metrics: GenerationMetricsFile) {
  const imageSummary = summarizeGenerationMetrics(metrics.entries, "image");
  const overallSummary = summarizeGenerationMetrics(metrics.entries);
  return [
    "HivemindOS generation performance summary.",
    "",
    `Updated: ${metrics.updatedAt}`,
    `Total recorded generation samples: ${sampleCountFor(metrics.entries)}`,
    "",
    "Image generation:",
    imageSummary,
    "",
    "Overall generation:",
    overallSummary,
    "",
    "Source: compact aggregate timing metrics from ~/.hivemindos/generation-metrics.json. Raw run telemetry stays in app state; Shared Brain should use this as a durable operational conclusion only.",
  ].join("\n");
}

function hashSummary(content: string) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function persistSharedBrainSummaryMarker(metrics: GenerationMetricsFile, marker: GenerationMetricsSharedBrainSummary) {
  const update = async () => {
    const latest = await loadMetricsFile();
    const nextMetrics: GenerationMetricsFile = {
      ...latest,
      sharedBrainSummary: marker,
    };
    await writeMetricsFile(nextMetrics);
    return nextMetrics;
  };
  writeQueue = writeQueue.catch(() => metrics).then(update);
  await writeQueue;
}

async function maybeWriteSharedBrainSummary(metrics: GenerationMetricsFile) {
  const totalSamples = sampleCountFor(metrics.entries);
  if (totalSamples < MIN_SHARED_BRAIN_SAMPLE_COUNT) return;
  const content = sharedBrainSummaryContent(metrics);
  const hash = hashSummary(content);
  const previous = metrics.sharedBrainSummary;
  if (previous?.hash === hash && !previous.error) return;
  const previousWrittenAt = previous?.writtenAt ? Date.parse(previous.writtenAt) : 0;
  if (Number.isFinite(previousWrittenAt) && Date.now() - previousWrittenAt < SHARED_BRAIN_SUMMARY_MIN_INTERVAL_MS) return;
  try {
    // This summary is a rolling snapshot with a stable title: evolve the
    // previous version instead of accumulating near-duplicate siblings.
    const previousMemoryId = previous?.memoryId;
    const shared = {
      type: "learning",
      title: "HivemindOS generation performance summary",
      content,
      confidence: 0.8,
      tags: ["hivemindos", "generation-metrics", "local-apps"],
      source: "HivemindOS generation metrics service",
      project: "hivemind-os",
      proof: "auto" as const,
    };
    const result = previousMemoryId
      ? await evolveAgentMemory({
        ...shared,
        memoryId: previousMemoryId,
        evolutionType: "temporal",
        evolutionReason: "Rolling generation metrics snapshot refresh.",
      }).catch(async (error) => {
        // The prior memory id may have been pruned/archived; fall back to a
        // fresh write rather than losing the snapshot.
        if (error instanceof Error && /could not find memory id/i.test(error.message)) {
          return rememberAgentMemory({ ...shared, allowDuplicate: true });
        }
        throw error;
      })
      : await rememberAgentMemory({ ...shared, allowDuplicate: true });
    if (!result.record) throw new Error("blockReason" in result && result.blockReason ? result.blockReason : "Shared Brain write was blocked.");
    await persistSharedBrainSummaryMarker(metrics, {
      hash,
      writtenAt: new Date().toISOString(),
      sampleCount: totalSamples,
      memoryId: result.record.id,
      notePath: result.record.notePath,
    });
  } catch (error) {
    await persistSharedBrainSummaryMarker(metrics, {
      hash,
      writtenAt: new Date().toISOString(),
      sampleCount: totalSamples,
      error: error instanceof Error ? error.message : "Could not write Shared Brain generation metrics summary.",
    });
  }
}

export async function readGenerationMetrics(kind?: string): Promise<GenerationMetricsSnapshot> {
  const metrics = await loadMetricsFile();
  return {
    ok: true,
    version: 1,
    updatedAt: metrics.updatedAt,
    entries: metrics.entries,
    summary: summarizeGenerationMetrics(metrics.entries, kind),
  };
}

export async function recordGenerationMetric(input: GenerationMetricRecordInput): Promise<GenerationMetricsSnapshot> {
  const identity = compactGenerationMetricIdentity(input);
  const key = identity ? generationMetricKey(identity) : "";
  const durationMs = Math.round(Number(input.durationMs) || 0);
  if (!identity || !key || !Number.isFinite(durationMs) || durationMs < 500) {
    return readGenerationMetrics(input.kind);
  }
  const write = async () => {
    const metrics = await loadMetricsFile();
    const now = new Date(input.completedAt || Date.now()).toISOString();
    const previous = metrics.entries[key];
    if (input.runId && previous?.recentRunIds?.includes(input.runId)) return metrics;
    const count = (previous?.count ?? 0) + 1;
    const recentDurationsMs = [...(previous?.recentDurationsMs ?? []), durationMs].slice(-MAX_RECENT_DURATIONS);
    const recentRunIds = input.runId ? [...(previous?.recentRunIds ?? []), input.runId].slice(-MAX_RECENT_RUN_IDS) : previous?.recentRunIds;
    const averageDurationMs = previous
      ? Math.round(((previous.averageDurationMs * previous.count) + durationMs) / count)
      : durationMs;
    const nextEntry: GenerationMetricEntry = {
      ...identity,
      key,
      count,
      averageDurationMs,
      minDurationMs: Math.min(previous?.minDurationMs ?? durationMs, durationMs),
      maxDurationMs: Math.max(previous?.maxDurationMs ?? durationMs, durationMs),
      p50DurationMs: percentile(recentDurationsMs, 50),
      p95DurationMs: percentile(recentDurationsMs, 95),
      lastDurationMs: durationMs,
      recentDurationsMs,
      recentRunIds,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const entries = Object.fromEntries(Object.entries({ ...metrics.entries, [key]: nextEntry }).slice(-MAX_ENTRIES));
    const nextMetrics = { version: 1 as const, updatedAt: now, entries, sharedBrainSummary: metrics.sharedBrainSummary };
    await writeMetricsFile(nextMetrics);
    return nextMetrics;
  };
  writeQueue = writeQueue.catch(() => emptyMetricsFile()).then(write);
  await writeQueue;
  void writeQueue.then((metrics) => maybeWriteSharedBrainSummary(metrics)).catch(() => undefined);
  return readGenerationMetrics(input.kind);
}

export async function generationMetricsContext(query: string) {
  if (!/\b(?:image|generation|generator|generate|fastest|slowest|duration|how long|progress|average|p95)\b/i.test(query)) return "";
  const kind = /\b(?:image|picture|photo|visual|txt2img)\b/i.test(query) ? "image" : undefined;
  const snapshot = await readGenerationMetrics(kind);
  return [
    "Generation performance metrics:",
    `- ${snapshot.summary}`,
    "- Raw timing data comes from local HivemindOS app-state aggregates in ~/.hivemindos/generation-metrics.json. Use it for speed/ETA answers; only compact durable conclusions are promoted to Shared Brain Memory.",
    "- Current metrics are also available to tool-capable runtimes at GET /api/generation-metrics.",
  ].join("\n");
}
