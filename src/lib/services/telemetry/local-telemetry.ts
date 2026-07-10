import { mkdir, appendFile, open, readFile, rename, stat, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";

export type TelemetrySource = "client" | "route" | "runtime" | "stream";

export type TelemetryEventInput = {
  source: TelemetrySource;
  type: string;
  threadId?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown>;
};

export type TelemetryEvent = TelemetryEventInput & {
  id: string;
  ts: number;
};

const TELEMETRY_FILE = join(homedir(), ".hivemindos", "telemetry", "events.jsonl");
// The events log is append-only and dev telemetry is chatty, so without a cap
// it grows without bound (observed: a 586MB file — and the old whole-file read
// below allocated all of it per query, ballooning the server past a GB).
// Rotate to a single .1 sibling instead of truncating so the previous
// generation stays greppable on disk.
const TELEMETRY_MAX_FILE_BYTES = Number(
  process.env.HIVEMINDOS_TELEMETRY_MAX_FILE_BYTES || 25 * 1024 * 1024,
);
// Queries only ever return the newest ≤1000 events, which live at the file
// tail — reading a bounded tail keeps query memory flat no matter how large
// the file has grown.
const TELEMETRY_QUERY_TAIL_BYTES = Number(
  process.env.HIVEMINDOS_TELEMETRY_QUERY_TAIL_BYTES || 4 * 1024 * 1024,
);

// Appends and thread purges both mutate the same file, and a purge rewrites it
// whole — an interleaved appendFile would be silently dropped by the rewrite.
// Every writer in this process funnels through one chain so a delete can never
// race a concurrent chat turn's telemetry. (Only this Next server writes the
// log, so an in-process chain is sufficient.)
let telemetryWrites: Promise<unknown> = Promise.resolve();

function serializeTelemetryWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = telemetryWrites.then(task, task);
  telemetryWrites = next.catch(() => undefined);
  return next;
}

export async function recordTelemetryBatch(inputs: TelemetryEventInput[]) {
  if (!localTelemetryEnabled() || inputs.length === 0) return 0;
  return serializeTelemetryWrite(async () => {
    await mkdir(dirname(TELEMETRY_FILE), { recursive: true, mode: 0o700 });
    await rotateIfOversized();
    const now = Date.now();
    const rows = inputs.map((input, index): TelemetryEvent => ({
      id: `${now.toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: now,
      source: input.source,
      type: input.type,
      threadId: input.threadId ?? null,
      runId: input.runId ?? null,
      payload: input.payload ?? {},
    }));
    await appendFile(TELEMETRY_FILE, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf-8");
    return rows.length;
  });
}

/**
 * Pure line filter behind {@link purgeThreadTelemetryEvents}: drop every JSONL
 * row whose `threadId` matches, keep everything else byte-for-byte. Lines that
 * fail to parse are KEPT — a truncated or hand-edited row is not ours to
 * discard, and dropping it would lose unrelated telemetry.
 */
export function telemetryLinesWithoutThread(raw: string, threadId: string) {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  let removed = 0;
  const kept = lines.filter((line) => {
    const event = safeParseTelemetry(line);
    if (!event || event.threadId !== threadId) return true;
    removed += 1;
    return false;
  });
  return { removed, contents: kept.length ? `${kept.join("\n")}\n` : "" };
}

/**
 * Erase a chat thread's telemetry rows from the event log. Covers the rotated
 * `.1` generation too, otherwise the previous generation keeps the deleted
 * thread's events greppable on disk.
 *
 * Deliberately NOT gated on `localTelemetryEnabled()`: the log outlives the
 * flag, and a user deleting a thread wants those rows gone either way.
 * Returns the number of rows removed.
 */
export async function purgeThreadTelemetryEvents(threadId: string): Promise<number> {
  const key = (threadId ?? "").trim();
  if (!key) return 0;
  return serializeTelemetryWrite(async () => {
    let removed = 0;
    for (const file of [TELEMETRY_FILE, `${TELEMETRY_FILE}.1`]) {
      const raw = await readFile(file, "utf-8").catch(() => "");
      if (!raw) continue;
      const result = telemetryLinesWithoutThread(raw, key);
      if (result.removed === 0) continue;
      await writeFile(file, result.contents, "utf-8").catch(() => undefined);
      removed += result.removed;
    }
    return removed;
  });
}

async function rotateIfOversized() {
  try {
    const { size } = await stat(TELEMETRY_FILE);
    if (size <= TELEMETRY_MAX_FILE_BYTES) return;
    await rename(TELEMETRY_FILE, `${TELEMETRY_FILE}.1`);
  } catch {
    // Missing file (first write) or a concurrent rotation — either way, append
    // proceeds against a fresh/small file.
  }
}

export async function queryTelemetryEvents(options: {
  threadId?: string | null;
  runId?: string | null;
  type?: string | null;
  source?: TelemetrySource | null;
  since?: number | null;
  limit?: number | null;
} = {}) {
  if (!localTelemetryEnabled()) return { file: TELEMETRY_FILE, events: [] as TelemetryEvent[] };
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  // Rotation means a `since` far in the past may not reach events that have
  // aged into the .1 generation; queries are for recent debugging, so the
  // bounded tail is the right trade.
  const raw = await readFileTail(TELEMETRY_FILE, TELEMETRY_QUERY_TAIL_BYTES);
  const events = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => safeParseTelemetry(line))
    .filter((event): event is TelemetryEvent => Boolean(event))
    .filter((event) => !options.threadId || event.threadId === options.threadId)
    .filter((event) => !options.runId || event.runId === options.runId)
    .filter((event) => !options.type || event.type === options.type)
    .filter((event) => !options.source || event.source === options.source)
    .filter((event) => !options.since || event.ts >= options.since)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
  return { file: TELEMETRY_FILE, events };
}

async function readFileTail(file: string, maxBytes: number) {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    if (size === 0) return "";
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buffer = new Uint8Array(length);
    await handle.read(buffer, 0, length, start);
    let text = new TextDecoder().decode(buffer);
    if (start > 0) {
      // Drop the partial first line a mid-file cut leaves behind.
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return text;
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function localTelemetryEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.HIVEMINDOS_TELEMETRY === "true";
}

function safeParseTelemetry(line: string) {
  try {
    const parsed = JSON.parse(line) as TelemetryEvent;
    return parsed && typeof parsed.type === "string" && typeof parsed.ts === "number" ? parsed : null;
  } catch {
    return null;
  }
}
