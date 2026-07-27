import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalMemoryKey } from "./hive-brain-canonical.mjs";
import { redactSecrets } from "./hive-brain-scoring.mjs";

const MAX_EVENT_FILE_BYTES = 8 * 1024 * 1024;

function clean(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? redactSecrets(normalized) : undefined;
}

function outcome(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["success", "failure", "blocked", "cancelled"].includes(normalized) ? normalized : "unknown";
}

function eventPath() {
  return path.join(os.homedir(), ".hivemindos", "brain", "operational-events.jsonl");
}

function rotateIfOversized(file) {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size <= MAX_EVENT_FILE_BYTES) return;
  rmSync(`${file}.1`, { force: true });
  renameSync(file, `${file}.1`);
}

export function recordLocalOperationalEvent(input) {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();
  if (!title || !content) throw new Error("record-operation requires --title and --content.");
  const sensitiveSurface = [
    title,
    content,
    input.operationKey,
    input.failureKey,
    input.taskId,
    input.source,
    input.sessionId,
    ...(input.tags ?? []),
  ].filter(Boolean).join("\n");
  if (redactSecrets(sensitiveSurface) !== sensitiveSurface && !input.allowSensitiveContent) {
    throw new Error("Operational event content looks like it contains a secret or private Tailnet address. Store credential status by name only, never secret values.");
  }
  const occurredAt = new Date().toISOString();
  const safeTitle = clean(title);
  const event = {
    schema: "hivemindos.agent-operational-event.v1",
    id: `op-${occurredAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 10)}`,
    title: safeTitle.slice(0, 240),
    summary: clean(content).slice(0, 6_000),
    operationKey: canonicalMemoryKey({
      explicitKey: clean(input.operationKey),
      type: "operation",
      project: clean(input.project),
      title: safeTitle,
    }),
    failureKey: input.failureKey
      ? canonicalMemoryKey({ explicitKey: clean(input.failureKey), type: "failure", title: safeTitle })
      : undefined,
    outcome: outcome(input.outcome),
    taskId: clean(input.taskId),
    source: clean(input.source) || "hive-brain cli",
    agentName: clean(input.agentName),
    agentId: clean(input.agentId),
    runtime: clean(input.runtime),
    project: clean(input.project),
    sessionId: clean(input.sessionId),
    tags: [...new Set((input.tags ?? []).map(clean).filter(Boolean))].slice(0, 24),
    entities: [],
    occurredAt,
  };
  const file = eventPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  rotateIfOversized(file);
  appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ok: true, source: "local-fallback", durableMemoryWritten: false, event, path: file };
}
