import { randomUUID } from "crypto";
import { appendFile, mkdir, readFile, rename, rm, stat } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";
import { canonicalMemoryKey } from "./canonical";
import { detectSensitiveContent, redactSensitiveText } from "./redact";
import type {
  AgentOperationalEvent,
  ListAgentOperationalEventsInput,
  RecordAgentOperationalEventInput,
} from "./types";

const MAX_EVENT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_TEXT_CHARS = 6_000;
// Well above the event count a full current+rotated journal (2 x 8MB of
// ~400+ byte rows) can contain, so mining normally sees the whole journal.
const MAX_MINING_EVENTS = 100_000;
let operationalEventWriteQueue: Promise<unknown> = Promise.resolve();

export function agentOperationalEventsPath() {
  return join(homedir(), ".hivemindos", "brain", "operational-events.jsonl");
}

function cleanStrings(values?: string[]) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 24);
}

function normalizeOutcome(value?: string): AgentOperationalEvent["outcome"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "success" || normalized === "failure" || normalized === "blocked" || normalized === "cancelled"
    ? normalized
    : "unknown";
}

async function rotateIfOversized(file: string) {
  const size = await stat(file).then((value) => value.size, () => 0);
  if (size <= MAX_EVENT_FILE_BYTES) return;
  await rm(`${file}.1`, { force: true }).catch(() => undefined);
  await rename(file, `${file}.1`);
}

function enqueueOperationalEventWrite<T>(write: () => Promise<T>) {
  const result = operationalEventWriteQueue.then(write, write);
  operationalEventWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function recordAgentOperationalEvent(input: RecordAgentOperationalEventInput) {
  const title = input.title?.trim();
  const content = input.content?.trim();
  if (!title || !content) throw new Error("Operational event title and content are required.");
  const sensitive = detectSensitiveContent([
    title,
    content,
    input.operationKey,
    input.failureKey,
    input.taskId,
    input.source,
    input.sessionId,
    ...(input.tags ?? []),
    ...(input.entities ?? []),
  ].filter(Boolean).join("\n"));
  if (sensitive.blockers.length && input.allowSensitiveContent !== true) {
    throw new Error(`Operational event content looks like it contains ${sensitive.blockers.join(", ")}. Store credential status by name only, never secret values.`);
  }
  const occurredAt = new Date().toISOString();
  const event: AgentOperationalEvent = {
    schema: "hivemindos.agent-operational-event.v1",
    id: `op-${occurredAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 10)}`,
    title: redactSensitiveText(title).slice(0, 240),
    summary: redactSensitiveText(content).slice(0, MAX_EVENT_TEXT_CHARS),
    operationKey: canonicalMemoryKey({
      explicitKey: input.operationKey ? redactSensitiveText(input.operationKey) : undefined,
      type: "operation",
      project: input.project,
      title,
    }),
    failureKey: input.failureKey ? canonicalMemoryKey({ explicitKey: redactSensitiveText(input.failureKey), type: "failure", title }) : undefined,
    outcome: normalizeOutcome(input.outcome),
    taskId: input.taskId ? redactSensitiveText(input.taskId.trim()) || undefined : undefined,
    source: input.source ? redactSensitiveText(input.source.trim()) || undefined : undefined,
    agentName: input.agentName?.trim() || undefined,
    agentId: input.agentId?.trim() || undefined,
    runtime: input.runtime?.trim() || undefined,
    project: input.project?.trim() || undefined,
    sessionId: input.sessionId ? redactSensitiveText(input.sessionId.trim()) || undefined : undefined,
    tags: cleanStrings(input.tags?.map(redactSensitiveText)),
    entities: cleanStrings(input.entities?.map(redactSensitiveText)),
    occurredAt,
  };
  const file = agentOperationalEventsPath();
  await enqueueOperationalEventWrite(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await rotateIfOversized(file);
    await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  return { event, path: file };
}

function parseEventLines(raw: string) {
  const events: AgentOperationalEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as AgentOperationalEvent;
      if (event.schema === "hivemindos.agent-operational-event.v1" && event.id && event.title && event.occurredAt) events.push(event);
    } catch {
      // Ignore corrupt append rows; the remaining event journal stays usable.
    }
  }
  return events;
}

async function collectAgentOperationalEvents(input: Omit<ListAgentOperationalEventsInput, "limit">) {
  const file = agentOperationalEventsPath();
  const [current, rotated] = await Promise.all([
    readFile(file, "utf8").catch(() => ""),
    readFile(`${file}.1`, "utf8").catch(() => ""),
  ]);
  const queryTerms = (input.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
  const sinceMs = input.since ? Date.parse(input.since) : Number.NaN;
  const events = parseEventLines(`${rotated}\n${current}`)
    .filter((event) => !input.project || event.project?.toLowerCase() === input.project.trim().toLowerCase())
    .filter((event) => !Number.isFinite(sinceMs) || Date.parse(event.occurredAt) >= sinceMs)
    .filter((event) => {
      if (!queryTerms.length) return true;
      const text = `${event.title} ${event.summary} ${event.operationKey} ${event.failureKey ?? ""} ${event.tags.join(" ")}`.toLowerCase();
      return queryTerms.every((term) => text.includes(term));
    })
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  return { path: file, events };
}

export async function listAgentOperationalEvents(input: ListAgentOperationalEventsInput = {}) {
  const { path, events } = await collectAgentOperationalEvents(input);
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 200)), 1), 1_000);
  return { path, events: events.slice(0, limit) };
}

// Internal full-journal listing for pattern mining: occurrence and cadence
// statistics need every retained event, so this bypasses the public list
// clamp above. The guard cap only bounds memory and sits above what the
// size-rotated journal can physically hold, so `truncated` stays honest.
export async function listAgentOperationalEventsForMining(
  input: Omit<ListAgentOperationalEventsInput, "limit"> & { maxEvents?: number } = {},
) {
  const { path, events } = await collectAgentOperationalEvents(input);
  const maxEvents = Math.max(1, Math.trunc(Number(input.maxEvents ?? MAX_MINING_EVENTS)));
  return {
    path,
    events: events.slice(0, maxEvents),
    totalMatching: events.length,
    truncated: events.length > maxEvents,
  };
}
