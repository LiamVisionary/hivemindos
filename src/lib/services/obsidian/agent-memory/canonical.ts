import type { AgentMemoryRecord, AgentMemoryType } from "./types";

const MAX_MEMORY_KEY_LENGTH = 180;

function keySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

export function normalizeCanonicalMemoryKey(value: string) {
  const segments = value
    .split(/[/:]+/)
    .map(keySegment)
    .filter(Boolean);
  return segments.join("/").slice(0, MAX_MEMORY_KEY_LENGTH);
}

export function canonicalMemoryKey(input: {
  explicitKey?: string;
  type: AgentMemoryType | string;
  title: string;
  project?: string;
}) {
  const explicit = input.explicitKey?.trim();
  if (explicit) {
    const normalized = normalizeCanonicalMemoryKey(explicit);
    if (!normalized) throw new Error("Memory key must contain letters or numbers.");
    return normalized;
  }
  const normalized = [input.type, input.project || "global", input.title]
    .map((value) => keySegment(String(value)))
    .filter(Boolean)
    .join("/")
    .slice(0, MAX_MEMORY_KEY_LENGTH);
  if (!normalized) throw new Error("Could not derive a canonical memory key.");
  return normalized;
}

function recordTime(record: AgentMemoryRecord) {
  const updated = Date.parse(record.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(record.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export type CanonicalMemoryHeadConflict = {
  memoryKey: string;
  headId: string;
  memberIds: string[];
  memberTitles: string[];
};

export function selectCanonicalMemoryHeads(records: AgentMemoryRecord[]) {
  const passthrough = records.filter((record) => record.status !== "active" || !record.memoryKey);
  const byKey = new Map<string, AgentMemoryRecord[]>();
  for (const record of records) {
    if (record.status !== "active" || !record.memoryKey) continue;
    byKey.set(record.memoryKey, [...(byKey.get(record.memoryKey) ?? []), record]);
  }
  const heads: AgentMemoryRecord[] = [];
  const conflicts: CanonicalMemoryHeadConflict[] = [];
  for (const [memoryKey, group] of byKey) {
    const sorted = [...group].sort((left, right) => recordTime(right) - recordTime(left) || right.id.localeCompare(left.id));
    heads.push(sorted[0]);
    if (sorted.length > 1) {
      conflicts.push({
        memoryKey,
        headId: sorted[0].id,
        memberIds: sorted.map((record) => record.id),
        memberTitles: sorted.map((record) => record.title),
      });
    }
  }
  return {
    records: [...passthrough, ...heads],
    conflicts: conflicts.sort((left, right) => right.memberIds.length - left.memberIds.length || left.memoryKey.localeCompare(right.memoryKey)),
  };
}
