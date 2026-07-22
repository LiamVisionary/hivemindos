import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";
import type { IncidentEvent, IncidentInvestigation } from "./types";

type StoreOptions = {
  root?: string;
  now?: () => number;
  createId?: (prefix: string) => string;
};

const DEFAULT_ROOT = join(homedir(), ".hivemindos", "ops", "incidents");

function defaultId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid incident id.");
  return id;
}

export function createIncidentStore(options: StoreOptions = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? defaultId;
  const queues = new Map<string, Promise<unknown>>();
  const eventQueues = new Map<string, Promise<unknown>>();
  const incidentPath = (id: string) => join(root, `${safeId(id)}.json`);
  const eventPath = (id: string) => join(root, `${safeId(id)}.events.jsonl`);

  async function writeIncident(incident: IncidentInvestigation) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = incidentPath(incident.id);
    const temporary = `${path}.${process.pid}.${now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(incident, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    return incident;
  }

  async function readIncident(id: string): Promise<IncidentInvestigation | null> {
    const raw = await readFile(incidentPath(id), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw.trim()) return null;
    return JSON.parse(raw) as IncidentInvestigation;
  }

  async function mutateIncident(
    id: string,
    mutate: (incident: IncidentInvestigation) => IncidentInvestigation | Promise<IncidentInvestigation>,
  ) {
    const prior = queues.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const current = await readIncident(id);
      if (!current) throw new Error(`Incident ${id} was not found.`);
      return writeIncident(await mutate(current));
    });
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }

  async function listIncidents(limit = 100) {
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const incidents = await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.endsWith(".events.json"))
        .map((name) => readIncident(name.slice(0, -5))),
    );
    return incidents
      .filter((incident): incident is IncidentInvestigation => Boolean(incident))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 250)));
  }

  async function listEvents(incidentId: string, afterSequence = 0): Promise<IncidentEvent[]> {
    const raw = await readFile(eventPath(incidentId), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return raw.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const event = JSON.parse(line) as IncidentEvent;
        return event.sequence > afterSequence ? [event] : [];
      } catch {
        return [];
      }
    });
  }

  async function appendEvent(
    incidentId: string,
    input: Omit<IncidentEvent, "id" | "sequence" | "incidentId" | "at"> & { at?: number },
  ) {
    safeId(incidentId);
    const prior = eventQueues.get(incidentId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const existing = await listEvents(incidentId);
      const event: IncidentEvent = {
        ...input,
        id: createId("event"),
        sequence: (existing.at(-1)?.sequence ?? 0) + 1,
        incidentId,
        at: input.at ?? now(),
      };
      await mkdir(root, { recursive: true, mode: 0o700 });
      await appendFile(eventPath(incidentId), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      return event;
    });
    eventQueues.set(incidentId, next);
    try {
      return await next;
    } finally {
      if (eventQueues.get(incidentId) === next) eventQueues.delete(incidentId);
    }
  }

  return { root, createId, writeIncident, readIncident, mutateIncident, listIncidents, listEvents, appendEvent };
}

export type IncidentStore = ReturnType<typeof createIncidentStore>;
