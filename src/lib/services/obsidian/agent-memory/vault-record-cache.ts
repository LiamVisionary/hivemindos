import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { AgentMemoryRecord } from "@/lib/services/obsidian/agent-memory/types";

const MAX_QUERY_ENTRIES = 100;
const MAX_FILE_ENTRIES = 10_000;

type QueryCacheEntry = {
  cachedAt: number;
  records: AgentMemoryRecord[];
};

const queryCache = new Map<string, QueryCacheEntry>();
const fileCache = new Map<string, { mtimeMs: number; size: number; record: AgentMemoryRecord | null }>();

function evictOldestEntry<T>(cache: Map<string, T>, maximum: number) {
  while (cache.size >= maximum) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedVaultQueryRecords(cacheKey: string) {
  return queryCache.get(cacheKey);
}

export function cacheVaultQueryRecords(cacheKey: string, records: AgentMemoryRecord[]) {
  if (!queryCache.has(cacheKey)) evictOldestEntry(queryCache, MAX_QUERY_ENTRIES);
  queryCache.set(cacheKey, { cachedAt: Date.now(), records });
}

export async function readCachedVaultRecord(
  root: string,
  file: string,
  maximumBytes: number,
  parse: (markdown: string, mtimeMs: number) => AgentMemoryRecord | null,
) {
  const rel = relative(root, file);
  if (rel.startsWith("..") || resolve(file) === resolve(root)) {
    if (resolve(file) !== resolve(root)) throw new Error("Path escaped the selected vault.");
  }
  const fileStat = await stat(file).catch(() => null);
  if (!fileStat || fileStat.size > maximumBytes) return null;
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) return cached.record;
  const markdown = await readFile(file, "utf8").catch(() => "");
  const record = parse(markdown, fileStat.mtimeMs);
  if (!cached) evictOldestEntry(fileCache, MAX_FILE_ENTRIES);
  fileCache.set(file, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, record });
  return record;
}
