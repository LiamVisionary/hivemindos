import { booleanEnv } from "@/lib/config/env";

const MEMORY_GUARD_KEY = Symbol.for("hivemindos.devMemoryGuard");
const MB = 1024 * 1024;
const MEMORY_PRESSURE_FILE = ".hivemindos/telemetry/memory-pressure.jsonl";

type MemoryGuardGlobal = typeof globalThis & {
  [MEMORY_GUARD_KEY]?: boolean;
  gc?: () => void;
};

type HeapStatistics = {
  heap_size_limit: number;
  total_available_size: number;
  used_heap_size: number;
  number_of_native_contexts: number;
  number_of_detached_contexts: number;
};

type RuntimeRequire = <T = unknown>(id: string) => T;

function numericEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mb(bytes: number) {
  return Math.round(bytes / MB);
}

function runGc() {
  const runtime = globalThis as MemoryGuardGlobal;
  if (typeof runtime.gc !== "function") return false;
  if (!booleanEnv("HIVEMINDOS_DEV_FORCE_GC")) return false;
  const heap = readHeapStatistics();
  if (heap.used_heap_size / heap.heap_size_limit > 0.75) return false;
  runtime.gc();
  setTimeout(() => runtime.gc?.(), 500).unref?.();
  return true;
}

function runtimeRequire(): RuntimeRequire | null {
  try {
    return (0, eval)("require") as RuntimeRequire;
  } catch {
    return null;
  }
}

function readHeapStatistics(): HeapStatistics {
  const fallback = {
    heap_size_limit: 0,
    total_available_size: 0,
    used_heap_size: process.memoryUsage().heapUsed,
    number_of_native_contexts: 0,
    number_of_detached_contexts: 0,
  };
  try {
    const require = runtimeRequire();
    if (!require) return fallback;
    const v8 = require<{ getHeapStatistics: () => HeapStatistics }>("v8");
    return v8.getHeapStatistics();
  } catch {
    return fallback;
  }
}

function recordMemoryPressure(reason: string) {
  const memory = process.memoryUsage();
  const heap = readHeapStatistics();
  const payload = {
    ts: new Date().toISOString(),
    reason,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    heapLimitMb: mb(heap.heap_size_limit),
    totalAvailableSizeMb: mb(heap.total_available_size),
    nativeContexts: heap.number_of_native_contexts,
    detachedContexts: heap.number_of_detached_contexts,
    forceGcEnabled: booleanEnv("HIVEMINDOS_DEV_FORCE_GC"),
  };
  try {
    const require = runtimeRequire();
    if (!require) return payload;
    const fs = require<{ appendFileSync: (path: string, data: string, encoding: BufferEncoding) => void; mkdirSync: (path: string, options: { recursive: boolean; mode: number }) => void }>("fs");
    const os = require<{ homedir: () => string }>("os");
    const path = require<{ dirname: (path: string) => string; join: (...parts: string[]) => string }>("path");
    const file = path.join(os.homedir(), MEMORY_PRESSURE_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf-8");
  } catch {
    // Last-gasp diagnostics must not make memory pressure worse.
  }
  return payload;
}

export function maybeCollectDevGarbage(reason = "manual") {
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.HIVEMINDOS_DEV_MEMORY_GUARD === "0") return false;
  const before = recordMemoryPressure(reason);
  const collected = runGc();
  if (collected && process.env.HIVEMINDOS_MEMORY_GUARD_DEBUG === "1") {
    const after = process.memoryUsage();
    console.info(`[memory-guard] collected ${reason}: rss=${mb(after.rss)}MB heap=${mb(after.heapUsed)}MB external=${mb(after.external)}MB`);
  } else if (process.env.HIVEMINDOS_MEMORY_GUARD_DEBUG === "1") {
    console.info(`[memory-guard] sampled ${reason}: rss=${before.rssMb}MB heap=${before.heapUsedMb}MB limit=${before.heapLimitMb}MB`);
  }
  return collected;
}

export function registerDevMemoryGuard() {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.HIVEMINDOS_DEV_MEMORY_GUARD === "0") return;

  const runtime = globalThis as MemoryGuardGlobal;
  if (runtime[MEMORY_GUARD_KEY]) return;
  runtime[MEMORY_GUARD_KEY] = true;

  const intervalMs = numericEnv("HIVEMINDOS_DEV_MEMORY_GUARD_INTERVAL_MS", 60_000);
  const rssThresholdMb = numericEnv("HIVEMINDOS_DEV_MEMORY_GUARD_RSS_MB", 2_500);
  const heapThresholdMb = numericEnv("HIVEMINDOS_DEV_MEMORY_GUARD_HEAP_MB", 2_048);
  const externalThresholdMb = numericEnv("HIVEMINDOS_DEV_MEMORY_GUARD_EXTERNAL_MB", 900);

  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    const rssMb = mb(memory.rss);
    const heapMb = mb(memory.heapUsed);
    const externalMb = mb(memory.external);
    if (rssMb < rssThresholdMb && heapMb < heapThresholdMb && externalMb < externalThresholdMb) return;
    maybeCollectDevGarbage(`threshold rss=${rssMb}MB heap=${heapMb}MB external=${externalMb}MB`);
  }, intervalMs);
  timer.unref?.();
}
