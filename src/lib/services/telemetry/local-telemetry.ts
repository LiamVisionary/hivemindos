import { mkdir, readFile, appendFile } from "fs/promises";
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

export async function recordTelemetryBatch(inputs: TelemetryEventInput[]) {
  if (!localTelemetryEnabled() || inputs.length === 0) return 0;
  await mkdir(dirname(TELEMETRY_FILE), { recursive: true, mode: 0o700 });
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
  const raw = await readFile(TELEMETRY_FILE, "utf-8").catch(() => "");
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
