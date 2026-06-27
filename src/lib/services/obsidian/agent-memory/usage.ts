import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AgentMemoryRecord, AgentMemoryUsageSummary, RecordAgentMemoryUsageInput } from "./types";

export const AGENT_MEMORY_RETRIEVALS_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Retrievals.jsonl`;

type UsageRow = {
  timestamp?: string;
  memoryId?: string;
  usageType?: "retrieved" | "final-answer";
};

export async function readAgentMemoryUsage(root: string, records: AgentMemoryRecord[]) {
  const ids = new Set(records.map((record) => record.id));
  const summary = new Map<string, AgentMemoryUsageSummary>();
  const raw = await readFile(join(root, AGENT_MEMORY_RETRIEVALS_PATH), "utf8").catch(() => "");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as UsageRow;
      if (!row.memoryId || !ids.has(row.memoryId)) continue;
      const current = summary.get(row.memoryId) ?? {};
      if (row.usageType === "final-answer") {
        current.finalAnswerCount = (current.finalAnswerCount ?? 0) + 1;
        if (row.timestamp && (!current.lastUsedAt || row.timestamp > current.lastUsedAt)) current.lastUsedAt = row.timestamp;
      } else {
        current.retrievalCount = (current.retrievalCount ?? 0) + 1;
        if (row.timestamp && (!current.lastRetrievedAt || row.timestamp > current.lastRetrievedAt)) current.lastRetrievedAt = row.timestamp;
      }
      summary.set(row.memoryId, current);
    } catch {
      // Ignore corrupt append lines; usage only nudges ranking.
    }
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

export async function appendAgentMemoryUsage(root: string, input: RecordAgentMemoryUsageInput) {
  const memoryIds = [...new Set((input.memoryIds ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (!memoryIds.length) return { recorded: 0 };
  const timestamp = new Date().toISOString();
  const rows = memoryIds.map((memoryId) => ({
    timestamp,
    schema: "hivemindos.agent-memory-retrieval.v1",
    memoryId,
    usageType: input.usageType === "final-answer" ? "final-answer" : "retrieved",
    query: input.query?.trim() || undefined,
    usageContext: input.usageContext?.trim() || undefined,
    agentName: input.agentName?.trim() || undefined,
    runtime: input.runtime?.trim() || undefined,
    sessionId: input.sessionId?.trim() || undefined,
  }));
  const file = join(root, AGENT_MEMORY_RETRIEVALS_PATH);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return { recorded: rows.length };
}
