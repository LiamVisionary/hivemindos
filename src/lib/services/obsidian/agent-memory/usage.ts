import { appendFile, mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { redactSensitiveText } from "@/lib/services/obsidian/agent-memory/redact";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AgentMemoryRecord, AgentMemoryUsageSummary, RecordAgentMemoryUsageInput } from "./types";

export const AGENT_MEMORY_RETRIEVALS_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Retrievals.jsonl`;

// Logged queries are evidence, not archives: keep them short and redacted so
// raw prompts (which may embed secrets) never persist verbatim in the vault.
const MAX_LOGGED_QUERY_CHARS = 200;
// Rotate before the log becomes expensive to parse on every recall.
const MAX_RETRIEVALS_BYTES = 4 * 1024 * 1024;
const ROTATED_KEEP_LINES = 4_000;
// Retrieval counts older than this stop nudging ranking (they reflect stale
// ranker behavior); final-answer usage always counts.
const RETRIEVAL_SIGNAL_WINDOW_MS = 45 * 86_400_000;

type UsageRow = {
  timestamp?: string;
  memoryId?: string;
  usageType?: "retrieved" | "final-answer";
};

type UsageCacheEntry = {
  mtimeMs: number;
  size: number;
  summary: Map<string, AgentMemoryUsageSummary>;
};

const usageCache = new Map<string, UsageCacheEntry>();

async function readUsageSummaries(root: string) {
  const file = join(root, AGENT_MEMORY_RETRIEVALS_PATH);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return new Map<string, AgentMemoryUsageSummary>();
  const cached = usageCache.get(root);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.summary;
  const summary = new Map<string, AgentMemoryUsageSummary>();
  const raw = await readFile(file, "utf8").catch(() => "");
  const retrievalCutoff = new Date(Date.now() - RETRIEVAL_SIGNAL_WINDOW_MS).toISOString();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as UsageRow;
      if (!row.memoryId) continue;
      const current = summary.get(row.memoryId) ?? {};
      if (row.usageType === "final-answer") {
        current.finalAnswerCount = (current.finalAnswerCount ?? 0) + 1;
        if (row.timestamp && (!current.lastUsedAt || row.timestamp > current.lastUsedAt)) current.lastUsedAt = row.timestamp;
      } else {
        if (!row.timestamp || row.timestamp >= retrievalCutoff) {
          current.retrievalCount = (current.retrievalCount ?? 0) + 1;
        }
        if (row.timestamp && (!current.lastRetrievedAt || row.timestamp > current.lastRetrievedAt)) current.lastRetrievedAt = row.timestamp;
      }
      summary.set(row.memoryId, current);
    } catch {
      // Ignore corrupt append lines; usage only nudges ranking.
    }
  }
  usageCache.set(root, { mtimeMs: st.mtimeMs, size: st.size, summary });
  return summary;
}

export async function readAgentMemoryUsage(root: string, records: AgentMemoryRecord[]) {
  const ids = new Set(records.map((record) => record.id));
  const all = await readUsageSummaries(root);
  const summary = new Map<string, AgentMemoryUsageSummary>();
  for (const [memoryId, value] of all) {
    if (ids.has(memoryId)) summary.set(memoryId, value);
  }
  return summary;
}

export async function withAgentMemoryUsage(root: string, records: AgentMemoryRecord[]) {
  const usage = await readAgentMemoryUsage(root, records);
  return records.map((record) => {
    const summary = usage.get(record.id);
    return summary ? { ...record, usage: summary } : record;
  });
}

async function rotateRetrievalsIfOversized(file: string) {
  const st = await stat(file).catch(() => null);
  if (!st?.isFile() || st.size <= MAX_RETRIEVALS_BYTES) return;
  const raw = await readFile(file, "utf8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);
  const kept = lines.slice(-ROTATED_KEEP_LINES);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  await rename(tmp, file);
}

export async function appendAgentMemoryUsage(root: string, input: RecordAgentMemoryUsageInput) {
  const memoryIds = [...new Set((input.memoryIds ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (!memoryIds.length) return { recorded: 0 };
  const timestamp = new Date().toISOString();
  const query = input.query?.trim() ? redactSensitiveText(input.query.trim().replace(/\s+/g, " ")).slice(0, MAX_LOGGED_QUERY_CHARS) : undefined;
  const rows = memoryIds.map((memoryId) => ({
    timestamp,
    schema: "hivemindos.agent-memory-retrieval.v1",
    memoryId,
    usageType: input.usageType === "final-answer" ? "final-answer" : "retrieved",
    query,
    usageContext: input.usageContext?.trim() || undefined,
    agentName: input.agentName?.trim() || undefined,
    runtime: input.runtime?.trim() || undefined,
    sessionId: input.sessionId?.trim() || undefined,
  }));
  const file = join(root, AGENT_MEMORY_RETRIEVALS_PATH);
  await mkdir(dirname(file), { recursive: true });
  await rotateRetrievalsIfOversized(file);
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  usageCache.delete(root);
  return { recorded: rows.length };
}
