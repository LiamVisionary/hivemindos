import { hiveResearchSyncStatus, runHiveResearchSync } from "@/lib/services/hive-research-sync";

// Perpetual driver for the Hive Research brain sync. Mirrors the
// inbox-triage-driver runner shape (globalThis-backed so dev HMR reloads don't
// spawn duplicates) and skips the machine-wide lease: every import is
// idempotent (memoryKey + local ledger), so a concurrent tick at worst
// re-reads a page and skips everything in it. An unpaired machine's tick is a
// single state-file read.

export type HiveResearchSyncDriverStatus = {
  status: "running" | "stopped";
  startedAt?: string;
  tickCount?: number;
  lastTickAt?: string;
  lastRunConnected?: boolean;
  lastError?: string;
};

type Runner = HiveResearchSyncDriverStatus & { stopRequested: boolean; stopped: Promise<void> };

const globalState = globalThis as typeof globalThis & {
  __hivemindResearchSyncDriver?: Runner;
};

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Six-hour cadence: research memories are durable artifacts, not live state,
// and the page itself can trigger an immediate sync through the app UI.
const tickIntervalMs = () => envNum("HIVEMINDOS_RESEARCH_SYNC_TICK_MS", 6 * 60 * 60 * 1000);

export function hiveResearchSyncDriverDisabled(): boolean {
  // Same accepted values as the instrumentation autostart kill switch.
  const value = (process.env.HIVEMINDOS_RESEARCH_SYNC || "").trim().toLowerCase();
  return value === "0" || value === "false";
}

function sleepUnlessStopped(runner: Runner, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (runner.stopRequested || Date.now() - started >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    try {
      const connected = (await hiveResearchSyncStatus()).connected;
      const result = connected ? await runHiveResearchSync() : { connected: false as const };
      runner.tickCount = (runner.tickCount ?? 0) + 1;
      runner.lastTickAt = new Date().toISOString();
      runner.lastRunConnected = result.connected;
      runner.lastError = result.connected ? (result as { lastError?: string }).lastError : undefined;
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    if (runner.stopRequested) break;
    await sleepUnlessStopped(runner, tickIntervalMs());
  }
}

export function startHiveResearchSyncDriver(): HiveResearchSyncDriverStatus {
  if (hiveResearchSyncDriverDisabled()) {
    return { status: "stopped", lastError: "Disabled via HIVEMINDOS_RESEARCH_SYNC=0" };
  }
  const existing = globalState.__hivemindResearchSyncDriver;
  if (existing?.status === "running") return getHiveResearchSyncDriverStatus();

  const runner: Runner = {
    status: "running",
    startedAt: new Date().toISOString(),
    tickCount: 0,
    stopRequested: false,
    stopped: Promise.resolve(),
  };
  runner.stopped = loop(runner)
    .then(() => {
      runner.status = "stopped";
    })
    .catch((error) => {
      runner.status = "stopped";
      runner.lastError = error instanceof Error ? error.message : String(error);
    });
  globalState.__hivemindResearchSyncDriver = runner;
  return getHiveResearchSyncDriverStatus();
}

export async function stopHiveResearchSyncDriver(): Promise<HiveResearchSyncDriverStatus> {
  const runner = globalState.__hivemindResearchSyncDriver;
  if (runner && runner.status === "running") {
    runner.stopRequested = true;
    await runner.stopped;
  }
  return getHiveResearchSyncDriverStatus();
}

export function getHiveResearchSyncDriverStatus(): HiveResearchSyncDriverStatus {
  const runner = globalState.__hivemindResearchSyncDriver;
  if (!runner) return { status: "stopped" };
  return {
    status: runner.status,
    startedAt: runner.startedAt,
    tickCount: runner.tickCount,
    lastTickAt: runner.lastTickAt,
    lastRunConnected: runner.lastRunConnected,
    lastError: runner.lastError,
  };
}
