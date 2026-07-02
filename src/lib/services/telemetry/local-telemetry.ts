import { mkdir, appendFile, open, rename, stat } from "fs/promises";
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

export async function recordTelemetryBatch(inputs: TelemetryEventInput[]) {
  if (!localTelemetryEnabled() || inputs.length === 0) return 0;
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
