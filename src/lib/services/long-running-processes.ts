import "server-only";

import { randomUUID } from "node:crypto";
import type { LongRunningProcess, LongRunningProcessProgress, LongRunningProcessSnapshot } from "@/lib/types/long-running-processes";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";

type LongRunningProcessStore = {
  revision: number;
  processes: Map<string, LongRunningProcess>;
};

type LongRunningProcessGlobal = typeof globalThis & {
  __hivemindLongRunningProcesses?: LongRunningProcessStore;
};

type StartLongRunningProcessInput = {
  id?: string;
  kind: string;
  title: string;
  destination: DashboardRouteTarget;
  progress?: LongRunningProcessProgress;
};

const PROCESS_RETENTION_MS = 60 * 60_000;
const MAX_RETAINED_PROCESSES = 100;
const processGlobal = globalThis as LongRunningProcessGlobal;
const store = processGlobal.__hivemindLongRunningProcesses ??= {
  revision: 0,
  processes: new Map<string, LongRunningProcess>(),
};

function nextRevision(): number {
  store.revision += 1;
  return store.revision;
}

function processView(process: LongRunningProcess): LongRunningProcess {
  return {
    ...process,
    destination: { ...process.destination },
    progress: process.progress ? { ...process.progress } : null,
  };
}

function pruneProcesses(now: number): void {
  for (const [id, process] of store.processes) {
    if (process.status !== "running" && now - process.updatedAt > PROCESS_RETENTION_MS) {
      store.processes.delete(id);
    }
  }
  if (store.processes.size <= MAX_RETAINED_PROCESSES) return;
  const finished = [...store.processes.values()]
    .filter((process) => process.status !== "running")
    .sort((left, right) => left.updatedAt - right.updatedAt);
  for (const process of finished) {
    if (store.processes.size <= MAX_RETAINED_PROCESSES) break;
    store.processes.delete(process.id);
  }
}

function requiredProcess(id: string): LongRunningProcess {
  const process = store.processes.get(id);
  if (!process) throw new Error(`Unknown long-running process: ${id}`);
  return process;
}

export function startLongRunningProcess(input: StartLongRunningProcessInput): LongRunningProcess {
  const now = Date.now();
  pruneProcesses(now);
  const id = input.id?.trim() || randomUUID();
  const process: LongRunningProcess = {
    id,
    kind: input.kind,
    title: input.title,
    status: "running",
    progress: input.progress ? { ...input.progress } : null,
    completionMessage: null,
    error: null,
    destination: { ...input.destination },
    revision: nextRevision(),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  store.processes.set(id, process);
  return processView(process);
}

export function updateLongRunningProcess(
  id: string,
  progress: LongRunningProcessProgress,
): LongRunningProcess {
  const process = requiredProcess(id);
  if (process.status !== "running") return processView(process);
  process.progress = { ...progress };
  process.updatedAt = Date.now();
  process.revision = nextRevision();
  return processView(process);
}

export function completeLongRunningProcess(id: string, completionMessage: string): LongRunningProcess {
  const process = requiredProcess(id);
  const now = Date.now();
  process.status = "succeeded";
  process.completionMessage = completionMessage;
  process.error = null;
  process.completedAt = now;
  process.updatedAt = now;
  process.revision = nextRevision();
  return processView(process);
}

export function failLongRunningProcess(id: string, error: string): LongRunningProcess {
  const process = requiredProcess(id);
  const now = Date.now();
  process.status = "failed";
  process.error = error;
  process.completedAt = now;
  process.updatedAt = now;
  process.revision = nextRevision();
  return processView(process);
}

export function listLongRunningProcesses(afterRevision = 0): LongRunningProcessSnapshot {
  pruneProcesses(Date.now());
  return {
    revision: store.revision,
    processes: [...store.processes.values()]
      .filter((process) => process.revision > afterRevision)
      .sort((left, right) => left.revision - right.revision)
      .map(processView),
  };
}
