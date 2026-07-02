import { execFile } from "node:child_process";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { cpus, freemem, totalmem } from "os";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { getHeapSpaceStatistics, getHeapStatistics } from "node:v8";

import type {
  MemoryTelemetryAggregateSample,
  MemoryTelemetryPayload,
  MemoryTelemetryProcess,
  MemoryTelemetryProcessRole,
  MemoryTelemetrySuspect,
} from "@/lib/types/memory-telemetry";

const execFileAsync = promisify(execFile);
const MAX_AGGREGATE_SAMPLES = 720;
const MAX_PROCESS_SAMPLES = 180;
const PROCESS_RECENT_WINDOW_MS = 15 * 60_000;
const PROCESS_STALE_MS = 45 * 60_000;
const TRACKED_PROCESS_LIMIT = 80;
const TOP_SYSTEM_PROCESS_LIMIT = 12;
const TELEMETRY_SCHEMA_VERSION = 3;
const MEMORY_SAMPLES_FILE = join(homedir(), ".hivemindos", "telemetry", "memory-samples.jsonl");

type ProcessRow = {
  pid: number;
  ppid: number;
  rssKb: number;
  percentMemory: number;
  elapsed: string;
  comm: string;
  command: string;
};

type ProcessHistory = {
  pid: number;
  command: string;
  firstSeenAt: number;
  firstRssKb: number;
  maxRssKb: number;
  samples: Array<{ ts: number; rssKb: number }>;
};

type RelatedProcessSets = {
  ancestors: Set<number>;
  descendants: Set<number>;
  dashboard: Set<number>;
};

type MemoryTelemetryState = {
  schemaVersion: number;
  aggregateSamples: MemoryTelemetryAggregateSample[];
  processes: Map<string, ProcessHistory>;
};

const globalTelemetry = globalThis as typeof globalThis & {
  __hivemindosMemoryTelemetry?: MemoryTelemetryState;
};

const execFileSafe = (file: string, args: string[], timeout = 3_000) => execFileAsync(file, args, {
  timeout,
  maxBuffer: 3_000_000,
});

function state() {
  if (globalTelemetry.__hivemindosMemoryTelemetry?.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    globalTelemetry.__hivemindosMemoryTelemetry = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      aggregateSamples: [],
      processes: new Map(),
    };
  }
  globalTelemetry.__hivemindosMemoryTelemetry ??= {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    aggregateSamples: [],
    processes: new Map(),
  };
  return globalTelemetry.__hivemindosMemoryTelemetry;
}

export async function collectMemoryTelemetry(): Promise<MemoryTelemetryPayload> {
  const checkedAt = Date.now();
  const rows = await readProcessTable().catch(() => null);
  if (!rows) return collectBasicMemoryTelemetry(checkedAt);
  const processByPid = new Map(rows.map((row) => [row.pid, row]));
  const relatedPids = relatedProcessIds(processByPid);
  const cwd = process.cwd();
  const appName = basename(cwd);

  const appRows = rows.filter((row) => isDashboardProcess(row, relatedPids));
  const supportRows = rows.filter((row) => !isDashboardProcess(row, relatedPids) && isSupportProcess(row, cwd, appName));
  const systemRows = rows
    .filter((row) => !appRows.some((appRow) => appRow.pid === row.pid))
    .filter((row) => !supportRows.some((supportRow) => supportRow.pid === row.pid))
    .sort((left, right) => right.rssKb - left.rssKb)
    .slice(0, TOP_SYSTEM_PROCESS_LIMIT);
  const trackedRows = [...appRows, ...supportRows, ...systemRows].sort((left, right) => right.rssKb - left.rssKb).slice(0, TRACKED_PROCESS_LIMIT);

  const tracked = trackedRows.map((row) => updateProcessHistory(row, checkedAt, relatedPids));
  trimProcessHistory(checkedAt, new Set(trackedRows.map((row) => processKey(row))));

  const currentMemory = process.memoryUsage();
  const heapDiagnostics = collectHeapDiagnostics();
  const aggregateSample: MemoryTelemetryAggregateSample = {
    ts: checkedAt,
    appRssMb: kbToMb(appRows.reduce((total, row) => total + row.rssKb, 0)),
    currentRssMb: bytesToMb(currentMemory.rss),
    heapUsedMb: bytesToMb(currentMemory.heapUsed),
    heapTotalMb: bytesToMb(currentMemory.heapTotal),
    heapLimitMb: heapDiagnostics.heapLimitMb,
    oldSpaceUsedMb: heapDiagnostics.oldSpaceUsedMb,
    codeSpaceUsedMb: heapDiagnostics.codeSpaceUsedMb,
    largeObjectSpaceUsedMb: heapDiagnostics.largeObjectSpaceUsedMb,
    externalMb: bytesToMb(currentMemory.external),
    arrayBuffersMb: bytesToMb(currentMemory.arrayBuffers),
    nativeContexts: heapDiagnostics.nativeContexts,
    detachedContexts: heapDiagnostics.detachedContexts,
    trackedProcessCount: appRows.length,
  };
  const currentState = state();
  currentState.aggregateSamples.push(aggregateSample);
  currentState.aggregateSamples = currentState.aggregateSamples.slice(-MAX_AGGREGATE_SAMPLES);
  await persistMemorySample(aggregateSample, heapDiagnostics);

  const processes = tracked
    .filter((item) => item.isAppRelated)
    .sort((left, right) => right.rssMb - left.rssMb);
  const topGrowers = [...tracked]
    .sort((left, right) => right.recentGrowthMb - left.recentGrowthMb || right.growthMb - left.growthMb)
    .slice(0, 10);
  const topSystemProcesses = tracked
    .filter((item) => !item.isAppRelated)
    .sort((left, right) => right.rssMb - left.rssMb)
    .slice(0, TOP_SYSTEM_PROCESS_LIMIT);

  const resourceUsage = process.resourceUsage();
  const topGrower = topGrowers.find((item) => item.isAppRelated) ?? topGrowers[0];
  return {
    ok: true,
    checkedAt,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    processMemory: {
      rssMb: bytesToMb(currentMemory.rss),
      heapTotalMb: bytesToMb(currentMemory.heapTotal),
      heapUsedMb: bytesToMb(currentMemory.heapUsed),
      externalMb: bytesToMb(currentMemory.external),
      arrayBuffersMb: bytesToMb(currentMemory.arrayBuffers),
      heapLimitMb: heapDiagnostics.heapLimitMb,
      totalAvailableSizeMb: heapDiagnostics.totalAvailableSizeMb,
      mallocedMemoryMb: heapDiagnostics.mallocedMemoryMb,
      peakMallocedMemoryMb: heapDiagnostics.peakMallocedMemoryMb,
      nativeContexts: heapDiagnostics.nativeContexts,
      detachedContexts: heapDiagnostics.detachedContexts,
      heapSpaces: heapDiagnostics.heapSpaces,
    },
    resourceUsage: {
      maxRssMb: kbToMb(resourceUsage.maxRSS),
      userCpuSeconds: microsecondsToSeconds(resourceUsage.userCPUTime),
      systemCpuSeconds: microsecondsToSeconds(resourceUsage.systemCPUTime),
    },
    systemMemory: {
      totalMb: bytesToMb(totalmem()),
      freeMb: bytesToMb(freemem()),
      usedMb: bytesToMb(totalmem() - freemem()),
    },
    cleanup: {
      devGuardEnabled: process.env.NODE_ENV === "development" && process.env.HIVEMINDOS_DEV_MEMORY_GUARD !== "0",
      gcAvailable: typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === "function",
      forceGcEnabled: process.env.HIVEMINDOS_DEV_FORCE_GC === "1",
      maxOldSpaceMb: configuredMaxOldSpaceMb(),
    },
    summary: {
      appRssMb: aggregateSample.appRssMb,
      trackedProcessCount: appRows.length,
      topGrowerLabel: topGrower?.label ?? "No growth yet",
      topGrowerGrowthMb: topGrower?.recentGrowthMb ?? 0,
      sampleWindowMinutes: sampleWindowMinutes(currentState.aggregateSamples),
    },
    samples: currentState.aggregateSamples,
    processes,
    topGrowers,
    topSystemProcesses,
    suspects: buildSuspects(processes, topGrowers, aggregateSample, currentState.aggregateSamples),
  };
}

async function collectBasicMemoryTelemetry(checkedAt: number): Promise<MemoryTelemetryPayload> {
  const currentMemory = process.memoryUsage();
  const heapDiagnostics = collectHeapDiagnostics();
  const aggregateSample: MemoryTelemetryAggregateSample = {
    ts: checkedAt,
    appRssMb: bytesToMb(currentMemory.rss),
    currentRssMb: bytesToMb(currentMemory.rss),
    heapUsedMb: bytesToMb(currentMemory.heapUsed),
    heapTotalMb: bytesToMb(currentMemory.heapTotal),
    heapLimitMb: heapDiagnostics.heapLimitMb,
    oldSpaceUsedMb: heapDiagnostics.oldSpaceUsedMb,
    codeSpaceUsedMb: heapDiagnostics.codeSpaceUsedMb,
    largeObjectSpaceUsedMb: heapDiagnostics.largeObjectSpaceUsedMb,
    externalMb: bytesToMb(currentMemory.external),
    arrayBuffersMb: bytesToMb(currentMemory.arrayBuffers),
    nativeContexts: heapDiagnostics.nativeContexts,
    detachedContexts: heapDiagnostics.detachedContexts,
    trackedProcessCount: 1,
  };
  const currentState = state();
  currentState.aggregateSamples.push(aggregateSample);
  currentState.aggregateSamples = currentState.aggregateSamples.slice(-MAX_AGGREGATE_SAMPLES);
  await persistMemorySample(aggregateSample, heapDiagnostics);

  const resourceUsage = process.resourceUsage();
  const currentProcess: MemoryTelemetryProcess = {
    pid: process.pid,
    ppid: process.ppid,
    role: "current",
    label: "Next.js server",
    command: "Current process",
    rssMb: aggregateSample.currentRssMb,
    percentMemory: totalmem() > 0 ? roundMb((currentMemory.rss / totalmem()) * 100) : 0,
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    sampleCount: 1,
    growthMb: 0,
    recentGrowthMb: 0,
    growthRateMbPerHour: 0,
    maxRssMb: aggregateSample.currentRssMb,
    trend: "flat",
    isCurrentProcess: true,
    isAppRelated: true,
  };

  return {
    ok: true,
    checkedAt,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    processMemory: {
      rssMb: aggregateSample.currentRssMb,
      heapTotalMb: aggregateSample.heapTotalMb,
      heapUsedMb: aggregateSample.heapUsedMb,
      externalMb: aggregateSample.externalMb,
      arrayBuffersMb: aggregateSample.arrayBuffersMb,
      heapLimitMb: heapDiagnostics.heapLimitMb,
      totalAvailableSizeMb: heapDiagnostics.totalAvailableSizeMb,
      mallocedMemoryMb: heapDiagnostics.mallocedMemoryMb,
      peakMallocedMemoryMb: heapDiagnostics.peakMallocedMemoryMb,
      nativeContexts: heapDiagnostics.nativeContexts,
      detachedContexts: heapDiagnostics.detachedContexts,
      heapSpaces: heapDiagnostics.heapSpaces,
    },
    resourceUsage: {
      maxRssMb: kbToMb(resourceUsage.maxRSS),
      userCpuSeconds: microsecondsToSeconds(resourceUsage.userCPUTime),
      systemCpuSeconds: microsecondsToSeconds(resourceUsage.systemCPUTime),
    },
    systemMemory: {
      totalMb: bytesToMb(totalmem()),
      freeMb: bytesToMb(freemem()),
      usedMb: bytesToMb(totalmem() - freemem()),
    },
    cleanup: {
      devGuardEnabled: process.env.NODE_ENV === "development" && process.env.HIVEMINDOS_DEV_MEMORY_GUARD !== "0",
      gcAvailable: typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === "function",
      forceGcEnabled: process.env.HIVEMINDOS_DEV_FORCE_GC === "1",
      maxOldSpaceMb: configuredMaxOldSpaceMb(),
    },
    summary: {
      appRssMb: aggregateSample.appRssMb,
      trackedProcessCount: 1,
      topGrowerLabel: currentProcess.label,
      topGrowerGrowthMb: 0,
      sampleWindowMinutes: sampleWindowMinutes(currentState.aggregateSamples),
    },
    samples: currentState.aggregateSamples,
    processes: [currentProcess],
    topGrowers: [currentProcess],
    topSystemProcesses: [],
    suspects: [{
      severity: "warning",
      title: "Process table telemetry is unavailable",
      detail: "HivemindOS returned current-process memory only because the OS process-table probe timed out or failed.",
      pid: process.pid,
    }],
  };
}

async function persistMemorySample(
  sample: MemoryTelemetryAggregateSample,
  heapDiagnostics: ReturnType<typeof collectHeapDiagnostics>,
) {
  const row = {
    ...sample,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    recordedAt: new Date(sample.ts).toISOString(),
    topHeapSpaces: [...heapDiagnostics.heapSpaces]
      .sort((left, right) => right.usedMb - left.usedMb)
      .slice(0, 8),
  };
  try {
    await mkdir(dirname(MEMORY_SAMPLES_FILE), { recursive: true, mode: 0o700 });
    // Append-only and never read back by the app — rotate on size so the log
    // can't grow without bound (observed 20MB+ after a few weeks).
    try {
      const { size } = await stat(MEMORY_SAMPLES_FILE);
      if (size > 10 * 1024 * 1024) await rename(MEMORY_SAMPLES_FILE, `${MEMORY_SAMPLES_FILE}.1`);
    } catch {
      // Missing file — first write.
    }
    await appendFile(MEMORY_SAMPLES_FILE, `${JSON.stringify(row)}\n`, "utf-8");
  } catch {
    // Memory telemetry should never fail the diagnostics endpoint.
  }
}

function collectHeapDiagnostics() {
  const heap = getHeapStatistics();
  const heapSpaces = getHeapSpaceStatistics().map((space) => ({
    name: space.space_name,
    usedMb: bytesToMb(space.space_used_size),
    sizeMb: bytesToMb(space.space_size),
    availableMb: bytesToMb(space.space_available_size),
    physicalMb: bytesToMb(space.physical_space_size),
  }));
  const usedByName = new Map(heapSpaces.map((space) => [space.name, space.usedMb]));
  return {
    heapLimitMb: bytesToMb(heap.heap_size_limit),
    totalAvailableSizeMb: bytesToMb(heap.total_available_size),
    mallocedMemoryMb: bytesToMb(heap.malloced_memory),
    peakMallocedMemoryMb: bytesToMb(heap.peak_malloced_memory),
    nativeContexts: heap.number_of_native_contexts,
    detachedContexts: heap.number_of_detached_contexts,
    oldSpaceUsedMb: usedByName.get("old_space") ?? 0,
    codeSpaceUsedMb: usedByName.get("code_space") ?? 0,
    largeObjectSpaceUsedMb: (usedByName.get("large_object_space") ?? 0) + (usedByName.get("code_large_object_space") ?? 0),
    heapSpaces,
  };
}

async function readProcessTable() {
  const { stdout } = await execFileSafe("ps", ["-axo", "pid=,ppid=,rss=,pmem=,etime=,comm=,command="]);
  return stdout
    .split("\n")
    .map(parseProcessRow)
    .filter((row): row is ProcessRow => Boolean(row));
}

function parseProcessRow(line: string): ProcessRow | null {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s*(.*)$/);
  if (!match) return null;
  const [, pid, ppid, rss, percentMemory, elapsed, comm, command] = match;
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    rssKb: Number(rss),
    percentMemory: Number(percentMemory),
    elapsed,
    comm,
    command: sanitizeCommand(command || comm),
  };
}

function relatedProcessIds(processByPid: Map<number, ProcessRow>): RelatedProcessSets {
  const ancestors = new Set<number>();
  const descendants = new Set<number>();
  const dashboard = new Set<number>([process.pid]);
  let cursor = process.pid;
  while (true) {
    const parent = processByPid.get(cursor)?.ppid;
    if (!parent || parent === 1 || ancestors.has(parent)) break;
    ancestors.add(parent);
    const row = processByPid.get(parent);
    if (row && isDashboardAncestor(row)) {
      dashboard.add(parent);
    }
    cursor = parent;
  }

  let changed = true;
  descendants.add(process.pid);
  while (changed) {
    changed = false;
    for (const row of processByPid.values()) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        if (!isTelemetryProbe(row)) dashboard.add(row.pid);
        changed = true;
      }
    }
  }
  return {
    ancestors,
    descendants,
    dashboard,
  };
}

function isDashboardAncestor(row: ProcessRow) {
  return /(?:^|\/)next(?:\s|$)|next dev|next\/dist\/bin\/next|scripts\/dev-server\.mjs|run-with-memory-limit\.sh|\bpnpm\s+(?:exec\s+next|dev)\b/i.test(row.command);
}

function isTelemetryProbe(row: ProcessRow) {
  return /^ps\s+-axo\b/.test(row.command);
}

function isDashboardProcess(row: ProcessRow, relatedPids: RelatedProcessSets) {
  return relatedPids.dashboard.has(row.pid) && !isTelemetryProbe(row);
}

function isSupportProcess(row: ProcessRow, cwd: string, appName: string) {
  const command = row.command.toLowerCase();
  const appNeedles = [
    cwd.toLowerCase(),
    cwd.replace(process.env.HOME ?? "", "~").toLowerCase(),
    appName.toLowerCase(),
    "hivemind-os",
    "hivemindos/bin/hivemind-linkd",
    "hivemind-os/bin/hivemind-linkd",
    "miroshark",
    "openclaw",
    ".hermes",
    "agent-telemetry-collector",
  ];
  return appNeedles.some((needle) => needle && command.includes(needle));
}

function updateProcessHistory(
  row: ProcessRow,
  checkedAt: number,
  relatedPids: RelatedProcessSets,
): MemoryTelemetryProcess {
  const key = processKey(row);
  const currentState = state();
  const existing = currentState.processes.get(key);
  const history = existing && existing.command === row.command
    ? existing
    : {
      pid: row.pid,
      command: row.command,
      firstSeenAt: checkedAt,
      firstRssKb: row.rssKb,
      maxRssKb: row.rssKb,
      samples: [],
    };
  history.maxRssKb = Math.max(history.maxRssKb, row.rssKb);
  history.samples.push({ ts: checkedAt, rssKb: row.rssKb });
  history.samples = history.samples
    .filter((sample) => checkedAt - sample.ts <= PROCESS_RECENT_WINDOW_MS)
    .slice(-MAX_PROCESS_SAMPLES);
  currentState.processes.set(key, history);

  const oldestRecent = history.samples[0] ?? { ts: checkedAt, rssKb: row.rssKb };
  const ageHours = Math.max((checkedAt - history.firstSeenAt) / 3_600_000, 1 / 60);
  const growthMb = kbToMb(row.rssKb - history.firstRssKb);
  const recentGrowthMb = kbToMb(row.rssKb - oldestRecent.rssKb);
  const role = processRole(row, relatedPids);
  return {
    pid: row.pid,
    ppid: row.ppid,
    role,
    label: processLabel(row, role),
    command: row.command,
    rssMb: kbToMb(row.rssKb),
    percentMemory: row.percentMemory,
    firstSeenAt: history.firstSeenAt,
    lastSeenAt: checkedAt,
    sampleCount: history.samples.length,
    growthMb,
    recentGrowthMb,
    growthRateMbPerHour: roundMb(growthMb / ageHours),
    maxRssMb: kbToMb(history.maxRssKb),
    trend: recentGrowthMb > 20 ? "growing" : recentGrowthMb < -20 ? "shrinking" : "flat",
    isCurrentProcess: row.pid === process.pid,
    isAppRelated: isDashboardProcess(row, relatedPids),
  };
}

function processRole(row: ProcessRow, relatedPids: RelatedProcessSets): MemoryTelemetryProcessRole {
  if (row.pid === process.pid) return "current";
  if (relatedPids.dashboard.has(row.pid) && relatedPids.ancestors.has(row.pid)) return "ancestor";
  if (relatedPids.dashboard.has(row.pid) && relatedPids.descendants.has(row.pid)) return "descendant";
  if (/miroshark|openclaw|hermes|hivemind-linkd|agent-telemetry/i.test(row.command)) return "runtime";
  if (/hivemind-os|hivemindos|next|node|pnpm/i.test(row.command)) return "app";
  return "system";
}

function processLabel(row: ProcessRow, role: MemoryTelemetryProcessRole) {
  if (role === "current") return "Next.js server";
  if (role === "ancestor") return `${processName(row)} parent`;
  if (role === "descendant") return `${processName(row)} child`;
  if (/miroshark/i.test(row.command)) return "MiroShark companion";
  if (/openclaw/i.test(row.command)) return "OpenClaw runtime";
  if (/hermes/i.test(row.command)) return "Hermes runtime";
  if (/next/i.test(row.command)) return "Next.js process";
  return processName(row);
}

function processName(row: ProcessRow) {
  return basename(row.comm || row.command).slice(0, 48) || "process";
}

function buildSuspects(
  processes: MemoryTelemetryProcess[],
  topGrowers: MemoryTelemetryProcess[],
  aggregate: MemoryTelemetryAggregateSample,
  samples: MemoryTelemetryAggregateSample[],
): MemoryTelemetrySuspect[] {
  const suspects: MemoryTelemetrySuspect[] = [];
  const firstSample = samples[0];
  const oldSpaceGrowthMb = firstSample ? aggregate.oldSpaceUsedMb - firstSample.oldSpaceUsedMb : 0;
  const heapLimitPercent = aggregate.heapLimitMb > 0 ? (aggregate.heapUsedMb / aggregate.heapLimitMb) * 100 : 0;
  if (aggregate.appRssMb > 4_000) {
    suspects.push({
      severity: "critical",
      title: "Dashboard process tree is near the 5 GB kill limit",
      detail: `Tracked dashboard server processes are using ${aggregate.appRssMb.toFixed(0)} MB RSS.`,
    });
  } else if (aggregate.appRssMb > 1_500) {
    suspects.push({
      severity: "warning",
      title: "Dashboard process tree is above the target budget",
      detail: `Tracked dashboard server processes are using ${aggregate.appRssMb.toFixed(0)} MB RSS. The target budget is roughly 1.5 GB.`,
    });
  }

  for (const processInfo of topGrowers.filter((item) => item.isAppRelated && item.recentGrowthMb > 50).slice(0, 4)) {
    suspects.push({
      severity: processInfo.recentGrowthMb > 250 ? "critical" : "warning",
      title: `${processInfo.label} is growing`,
      detail: `PID ${processInfo.pid} grew ${processInfo.recentGrowthMb.toFixed(1)} MB in the recent sample window and is now ${processInfo.rssMb.toFixed(1)} MB RSS.`,
      pid: processInfo.pid,
    });
  }

  const current = processes.find((item) => item.isCurrentProcess);
  if (heapLimitPercent > 85) {
    suspects.push({
      severity: "critical",
      title: "V8 heap is close to its configured limit",
      detail: `Heap used is ${aggregate.heapUsedMb.toFixed(1)} MB, ${heapLimitPercent.toFixed(0)}% of the ${aggregate.heapLimitMb.toFixed(0)} MB V8 limit. This is the direct precondition for the out-of-memory crash.`,
      pid: current?.pid,
    });
  } else if (heapLimitPercent > 70) {
    suspects.push({
      severity: "warning",
      title: "V8 heap is getting close to its limit",
      detail: `Heap used is ${aggregate.heapUsedMb.toFixed(1)} MB, ${heapLimitPercent.toFixed(0)}% of the ${aggregate.heapLimitMb.toFixed(0)} MB V8 limit.`,
      pid: current?.pid,
    });
  }
  if (aggregate.oldSpaceUsedMb > 700 || oldSpaceGrowthMb > 100) {
    suspects.push({
      severity: aggregate.oldSpaceUsedMb > 1_200 ? "critical" : "warning",
      title: "Old-space retained objects dominate the heap",
      detail: `V8 old_space is ${aggregate.oldSpaceUsedMb.toFixed(1)} MB${oldSpaceGrowthMb > 0 ? `, up ${oldSpaceGrowthMb.toFixed(1)} MB across the sample window` : ""}. Old-space growth usually means long-lived compiled modules, caches, or retained request/session objects.`,
      pid: current?.pid,
    });
  }
  if (aggregate.nativeContexts > 80 || aggregate.detachedContexts > 0) {
    suspects.push({
      severity: aggregate.detachedContexts > 0 || aggregate.nativeContexts > 200 ? "warning" : "info",
      title: "Many V8 contexts are alive",
      detail: `V8 reports ${aggregate.nativeContexts} native contexts and ${aggregate.detachedContexts} detached contexts. Context growth fits repeated server module evaluation, VM sandbox creation, or dev compiler churn.`,
      pid: current?.pid,
    });
  }
  if (current && current.rssMb - aggregate.heapUsedMb > 500 && current.recentGrowthMb > 50) {
    suspects.push({
      severity: "warning",
      title: "RSS is growing faster than the JavaScript heap",
      detail: `Current process RSS is ${current.rssMb.toFixed(1)} MB while heap used is ${aggregate.heapUsedMb.toFixed(1)} MB. That usually points at native buffers, cached compiled assets, or child-process output rather than retained React objects.`,
      pid: current.pid,
    });
  }
  if (current && aggregate.heapUsedMb - current.rssMb > 750) {
    suspects.push({
      severity: aggregate.heapUsedMb > 1_500 ? "warning" : "info",
      title: "V8 heap is much larger than resident RSS",
      detail: `V8 reports ${aggregate.heapUsedMb.toFixed(1)} MB of JS heap used while the OS reports ${current.rssMb.toFixed(1)} MB RSS for the Next process. That usually means a large logical JS heap, dev compiler cache, or memory that has been paged/compressed rather than currently resident RAM.`,
      pid: current.pid,
    });
  }

  if (suspects.length === 0) {
    suspects.push({
      severity: "info",
      title: "No strong memory growth signal yet",
      detail: "Leave the dashboard open. The sampler will keep a bounded timeline and promote growing processes here.",
    });
  }
  return suspects;
}

function trimProcessHistory(checkedAt: number, liveKeys: Set<string>) {
  const currentState = state();
  for (const [key, history] of currentState.processes) {
    if (!liveKeys.has(key) && checkedAt - (history.samples.at(-1)?.ts ?? history.firstSeenAt) > PROCESS_STALE_MS) {
      currentState.processes.delete(key);
    }
  }
}

function sampleWindowMinutes(samples: MemoryTelemetryAggregateSample[]) {
  if (samples.length < 2) return 0;
  return Math.round((samples[samples.length - 1].ts - samples[0].ts) / 60_000);
}

function processKey(row: ProcessRow) {
  return `pid:${row.pid}`;
}

function sanitizeCommand(command: string) {
  const home = process.env.HOME ?? "";
  return command
    .replaceAll(home, "~")
    .replace(/([?&](?:token|key|secret|password|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(--(?:token|key|secret|password|api-key)\s+)\S+/gi, "$1[redacted]")
    .replace(/((?:token|key|secret|password|api_key)=)\S+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 240);
}

function bytesToMb(bytes: number) {
  return roundMb(bytes / 1024 / 1024);
}

function kbToMb(kb: number) {
  return roundMb(kb / 1024);
}

function roundMb(value: number) {
  return Math.round(value * 10) / 10;
}

function microsecondsToSeconds(value: number) {
  return Math.round((value / 1_000_000) * 10) / 10;
}

function configuredMaxOldSpaceMb() {
  const match = (process.env.NODE_OPTIONS ?? "").match(/--max-old-space-size=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function memoryTelemetryCapabilities() {
  return {
    cpuCount: cpus().length,
    sampleWindowMs: PROCESS_RECENT_WINDOW_MS,
    maxAggregateSamples: MAX_AGGREGATE_SAMPLES,
  };
}
