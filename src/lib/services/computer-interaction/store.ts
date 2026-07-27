import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";
import type { ComputerInteractionEvent, ComputerInteractionRun } from "./types";

type StoreOptions = {
  root?: string;
  now?: () => number;
  createId?: (prefix: string) => string;
};

const DEFAULT_ROOT = join(homedir(), ".hivemindos", "runtime-runs", "computer-interaction");

function defaultId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid computer interaction run id.");
  return id;
}

export function createComputerInteractionRunStore(options: StoreOptions = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? defaultId;
  const queues = new Map<string, Promise<unknown>>();
  const eventQueues = new Map<string, Promise<unknown>>();
  const operationQueues = new Map<string, Promise<unknown>>();

  const runPath = (id: string) => join(root, `${safeId(id)}.json`);
  const eventPath = (id: string) => join(root, `${safeId(id)}.events.jsonl`);

  async function writeRun(run: ComputerInteractionRun) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = runPath(run.id);
    const temporary = `${path}.${process.pid}.${now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    return run;
  }

  async function readRun(id: string): Promise<ComputerInteractionRun | null> {
    const raw = await readFile(runPath(id), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw.trim()) return null;
    return JSON.parse(raw) as ComputerInteractionRun;
  }

  async function mutateRun(
    id: string,
    mutate: (run: ComputerInteractionRun) => ComputerInteractionRun | Promise<ComputerInteractionRun>,
  ): Promise<ComputerInteractionRun> {
    const prior = queues.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const current = await readRun(id);
      if (!current) throw new Error(`Computer interaction run ${id} was not found.`);
      return writeRun(await mutate(current));
    });
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }

  async function runExclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    safeId(id);
    const prior = operationQueues.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    operationQueues.set(id, next);
    try {
      return await next;
    } finally {
      if (operationQueues.get(id) === next) operationQueues.delete(id);
    }
  }

  async function appendEvent(runId: string, input: Omit<ComputerInteractionEvent, "id" | "sequence" | "runId" | "at"> & { at?: number }) {
    safeId(runId);
    const prior = eventQueues.get(runId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const existing = await listEvents(runId);
      const event: ComputerInteractionEvent = {
        ...input,
        id: createId("event"),
        sequence: (existing.at(-1)?.sequence ?? 0) + 1,
        runId,
        at: input.at ?? now(),
      };
      await mkdir(root, { recursive: true, mode: 0o700 });
      await appendFile(eventPath(runId), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      return event;
    });
    eventQueues.set(runId, next);
    try {
      return await next;
    } finally {
      if (eventQueues.get(runId) === next) eventQueues.delete(runId);
    }
  }

  async function listEvents(runId: string, afterSequence = 0): Promise<ComputerInteractionEvent[]> {
    const raw = await readFile(eventPath(runId), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return raw.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const event = JSON.parse(line) as ComputerInteractionEvent;
        return event.sequence > afterSequence ? [event] : [];
      } catch {
        return [];
      }
    });
  }

  async function listRuns(): Promise<ComputerInteractionRun[]> {
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const runs = await Promise.all(names.filter((name) => name.endsWith(".json") && !name.endsWith(".events.json")).map((name) => readRun(name.slice(0, -5))));
    return runs.filter((run): run is ComputerInteractionRun => Boolean(run)).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  return {
    root,
    createId,
    writeRun,
    readRun,
    mutateRun,
    runExclusive,
    appendEvent,
    listEvents,
    listRuns,
  };
}

export type ComputerInteractionRunStore = ReturnType<typeof createComputerInteractionRunStore>;
