import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import type { SalesContentEvent } from "@/lib/services/sales-content/types";
import { dedupeEvents } from "@/lib/services/sales-content/signal-engine";

export type SalesContentEventStore = {
  version: 1;
  events: SalesContentEvent[];
};

export function salesContentEventsPath(): string {
  return path.join(homedir(), ".hivemindos", "sales-content-events.json");
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  await fs.rename(tmp, file);
}

function isEvent(value: unknown): value is SalesContentEvent {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<SalesContentEvent>;
  return Boolean(
    raw.id &&
    raw.companyId &&
    raw.sourceId &&
    raw.kind &&
    raw.occurredAt &&
    raw.title &&
    raw.summary &&
    Array.isArray(raw.evidence) &&
    raw.entity &&
    typeof raw.entity === "object",
  );
}

export async function readSalesContentEventStore(file = salesContentEventsPath()): Promise<SalesContentEventStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<SalesContentEventStore>;
    const events = Array.isArray(parsed.events) ? parsed.events.filter(isEvent) : [];
    return { version: 1, events: dedupeEvents(events) };
  } catch {
    return { version: 1, events: [] };
  }
}

export async function writeSalesContentEventStore(store: SalesContentEventStore, file = salesContentEventsPath()): Promise<void> {
  await writeFileAtomic(file, JSON.stringify({ version: 1, events: dedupeEvents(store.events) }, null, 2));
}

export async function readCompanySalesContentEvents(companyId: string, file = salesContentEventsPath()): Promise<SalesContentEvent[]> {
  const store = await readSalesContentEventStore(file);
  const id = companyId.trim();
  return store.events.filter((event) => event.companyId === id);
}

export async function upsertSalesContentEvents(
  companyId: string,
  events: readonly SalesContentEvent[],
  file = salesContentEventsPath(),
): Promise<{ events: SalesContentEvent[]; changed: boolean }> {
  const id = companyId.trim();
  const store = await readSalesContentEventStore(file);
  const before = JSON.stringify(store.events);
  const retained = store.events.filter((event) => event.companyId !== id || !events.some((candidate) => candidate.id === event.id));
  const next = dedupeEvents([...retained, ...events]);
  const changed = before !== JSON.stringify(next);
  if (changed) await writeSalesContentEventStore({ version: 1, events: next }, file);
  return { events: next.filter((event) => event.companyId === id), changed };
}

export async function appendSalesContentEvent(
  event: SalesContentEvent,
  file = salesContentEventsPath(),
): Promise<{ events: SalesContentEvent[]; changed: boolean }> {
  return upsertSalesContentEvents(event.companyId, [event], file);
}
