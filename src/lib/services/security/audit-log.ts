import "server-only";

import { appendFile, mkdir, open, rename, stat } from "fs/promises";
import { dirname, join } from "path";

import { homedir } from "@/lib/home-dir";
import type { AuthorizationDecision, PrincipalContext } from "@/lib/types/principal";

/**
 * Durable authorization audit.
 *
 * Separate from the telemetry log on purpose. Telemetry is chatty development
 * data that a thread purge is allowed to rewrite whole; the audit trail answers
 * "which agent did this, and was it permitted" and must not be erasable as a
 * side effect of deleting a chat. Nothing in this module deletes or rewrites —
 * it appends, and rotates one generation when it grows.
 *
 * Storage follows the telemetry conventions deliberately (single .1 sibling
 * rotation, bounded tail reads, one in-process write chain) so there is one
 * shape of local append-only log in the codebase rather than two.
 */
const AUDIT_FILE = join(homedir(), ".hivemindos", "audit", "events.jsonl");

const AUDIT_MAX_FILE_BYTES = Number(
  process.env.HIVEMINDOS_AUDIT_MAX_FILE_BYTES || 25 * 1024 * 1024,
);
const AUDIT_QUERY_TAIL_BYTES = Number(
  process.env.HIVEMINDOS_AUDIT_QUERY_TAIL_BYTES || 4 * 1024 * 1024,
);

export type AuditRecord = {
  id: string;
  ts: number;
  type: string;
  /** Who acted. Null only when a decision was reached with no principal at all. */
  principalId: string | null;
  principalKind: string | null;
  /** What was attempted. */
  target: string | null;
  /** allow | deny | needs-approval, when the event came from an authorization. */
  outcome: string | null;
  reason: string | null;
  runId: string | null;
  payload: Record<string, unknown>;
};

let auditWrites: Promise<unknown> = Promise.resolve();

function serializeAuditWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = auditWrites.then(task, task);
  auditWrites = next.catch(() => undefined);
  return next;
}

async function rotateIfNeeded() {
  try {
    const stats = await stat(AUDIT_FILE);
    if (stats.size < AUDIT_MAX_FILE_BYTES) return;
    // One generation back, matching the telemetry log: the previous file stays
    // greppable on disk rather than being truncated away.
    await rename(AUDIT_FILE, `${AUDIT_FILE}.1`);
  } catch {
    // Missing file is the normal first-write case.
  }
}

export function auditLogPath() {
  return AUDIT_FILE;
}

export async function appendAuditRecord(input: {
  type: string;
  principal?: PrincipalContext | null;
  decision?: AuthorizationDecision | null;
  target?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown>;
  now?: number;
}): Promise<AuditRecord> {
  const record: AuditRecord = {
    id: crypto.randomUUID(),
    ts: input.now ?? Date.now(),
    type: input.type,
    principalId: input.principal?.principalId ?? null,
    principalKind: input.principal?.kind ?? null,
    target: input.target ?? null,
    outcome: input.decision?.status ?? null,
    reason: input.decision?.reason ?? null,
    runId: input.runId ?? null,
    payload: input.payload ?? {},
  };
  await serializeAuditWrite(async () => {
    await mkdir(dirname(AUDIT_FILE), { recursive: true });
    await rotateIfNeeded();
    await appendFile(AUDIT_FILE, `${JSON.stringify(record)}\n`, "utf8");
  });
  return record;
}

/** Reads the bounded tail so query memory stays flat regardless of file size. */
async function readTail(file: string, bytes: number): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    if (size === 0) return "";
    const start = Math.max(0, size - bytes);
    const length = size - start;
    // Uint8Array + TextDecoder, matching local-telemetry: Buffer.alloc's typing
    // admits a SharedArrayBuffer that fs.read's signature rejects.
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

export async function queryAuditRecords(options: {
  limit?: number;
  principalId?: string;
  outcome?: string;
  type?: string;
} = {}): Promise<AuditRecord[]> {
  const raw = await readTail(AUDIT_FILE, AUDIT_QUERY_TAIL_BYTES);
  const records: AuditRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AuditRecord;
      if (options.principalId && parsed.principalId !== options.principalId) continue;
      if (options.outcome && parsed.outcome !== options.outcome) continue;
      if (options.type && parsed.type !== options.type) continue;
      records.push(parsed);
    } catch {
      // A torn final line from a concurrent append is expected; skip it rather
      // than failing the whole query.
    }
  }
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  return records.slice(-limit).reverse();
}
