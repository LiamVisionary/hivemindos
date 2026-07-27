import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  HiveComputeEarningsEvent,
  HiveComputeEarningsModelTotal,
  HiveComputeEarningsSummary,
} from "@/lib/types/hive-compute-marketplace";

/** Written by the generated worker (worker.mjs) next to its own module files.
 * The worker is the only writer; the dashboard only reads. */
export const HIVE_COMPUTE_EARNINGS_SUMMARY_FILENAME = "earnings-summary.json";

const RECENT_EVENTS_SHOWN = 20;

type RawDayTotals = { usdMicro?: unknown; jobs?: unknown };

type RawEarningsFile = {
  version?: unknown;
  totalUsdMicro?: unknown;
  totalJobs?: unknown;
  days?: Record<string, RawDayTotals>;
  models?: Record<string, RawDayTotals>;
  recent?: unknown;
  updatedAt?: unknown;
};

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function sumDaysWithin(days: Record<string, RawDayTotals>, nowMs: number, windowDays: number): number {
  const oldestMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const [day, totals] of Object.entries(days)) {
    const dayMs = Date.parse(`${day}T00:00:00.000Z`);
    // A day counts while any part of it is inside the window.
    if (Number.isFinite(dayMs) && dayMs + 24 * 60 * 60 * 1000 > oldestMs && dayMs <= nowMs) {
      total += nonNegativeInteger(totals?.usdMicro);
    }
  }
  return total;
}

function normalizeRecent(value: unknown): HiveComputeEarningsEvent[] {
  if (!Array.isArray(value)) return [];
  const events: HiveComputeEarningsEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const at = typeof record.at === "string" ? record.at : "";
    const jobId = typeof record.jobId === "string" ? record.jobId : "";
    if (!at || !jobId) continue;
    events.push({
      at,
      jobId,
      ...(typeof record.model === "string" && record.model ? { model: record.model } : {}),
      usdMicro: nonNegativeInteger(record.usdMicro),
    });
  }
  return events;
}

/** Pure aggregation over the worker-maintained earnings file contents. */
export function summarizeHiveComputeEarnings(
  raw: unknown,
  nowMs: number = Date.now(),
): HiveComputeEarningsSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const file = raw as RawEarningsFile;
  const days = file.days && typeof file.days === "object" && !Array.isArray(file.days) ? file.days : {};
  const models = file.models && typeof file.models === "object" && !Array.isArray(file.models) ? file.models : {};
  const today = days[utcDayKey(nowMs)];
  const byModel: HiveComputeEarningsModelTotal[] = Object.entries(models)
    .map(([model, totals]) => ({
      model,
      usdMicro: nonNegativeInteger(totals?.usdMicro),
      jobs: nonNegativeInteger(totals?.jobs),
    }))
    .filter((entry) => entry.model && (entry.usdMicro > 0 || entry.jobs > 0))
    .sort((left, right) => right.usdMicro - left.usdMicro || right.jobs - left.jobs);
  return {
    totalUsdMicro: nonNegativeInteger(file.totalUsdMicro),
    totalJobs: nonNegativeInteger(file.totalJobs),
    todayUsdMicro: nonNegativeInteger(today?.usdMicro),
    todayJobs: nonNegativeInteger(today?.jobs),
    last7dUsdMicro: sumDaysWithin(days, nowMs, 7),
    last30dUsdMicro: sumDaysWithin(days, nowMs, 30),
    byModel,
    recent: normalizeRecent(file.recent).slice(-RECENT_EVENTS_SHOWN).reverse(),
    ...(typeof file.updatedAt === "string" && file.updatedAt ? { updatedAt: file.updatedAt } : {}),
  };
}

/** Read + aggregate the local worker earnings summary; null when absent/invalid. */
export async function readHiveComputeEarningsSummary(
  moduleDir: string,
  nowMs: number = Date.now(),
): Promise<HiveComputeEarningsSummary | null> {
  const raw = await readFile(join(moduleDir, HIVE_COMPUTE_EARNINGS_SUMMARY_FILENAME), "utf8").catch(() => "");
  if (!raw) return null;
  try {
    return summarizeHiveComputeEarnings(JSON.parse(raw), nowMs);
  } catch {
    return null;
  }
}
