import { createHash } from "crypto";
import { appendFile, mkdir, readFile, stat } from "fs/promises";
import { dirname, join } from "path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AgentMemoryRecord } from "./types";

// Optional semantic recall layer. Strictly best-effort: it activates only when
// HIVEMINDOS_EMBEDDINGS_URL points at an OpenAI-compatible /embeddings
// endpoint, and every failure degrades to lexical-only recall. GBrain remains
// the whole-vault semantic alternative; this layer covers typed Agent Memory
// with per-memory vectors stored beside the other brain indexes.

export const AGENT_MEMORY_EMBEDDINGS_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Embeddings.jsonl`;

const EMBEDDINGS_SCHEMA = "hivemindos.agent-memory-embedding.v1";
const QUERY_TIMEOUT_MS = 3_500;
const WRITE_TIMEOUT_MS = 8_000;
const MAX_BATCH = 16;
const MAX_EMBED_CHARS = 6_000;

type EmbeddingRow = {
  schema: typeof EMBEDDINGS_SCHEMA;
  memoryId: string;
  model: string;
  contentHash: string;
  dimensions: number;
  vector: number[];
  updatedAt: string;
};

type EmbeddingsCacheEntry = {
  mtimeMs: number;
  size: number;
  rows: Map<string, EmbeddingRow>;
};

const embeddingsCache = new Map<string, EmbeddingsCacheEntry>();

export type AgentMemoryEmbeddingsConfig = {
  enabled: boolean;
  url?: string;
  model: string;
  dimensions: number;
  hasApiKey: boolean;
};

export function agentMemoryEmbeddingsConfig(): AgentMemoryEmbeddingsConfig {
  const url = process.env.HIVEMINDOS_EMBEDDINGS_URL?.trim();
  return {
    enabled: Boolean(url),
    url: url || undefined,
    model: process.env.HIVEMINDOS_EMBEDDINGS_MODEL?.trim() || "text-embedding-3-small",
    dimensions: Math.max(16, Math.trunc(Number(process.env.HIVEMINDOS_EMBEDDINGS_DIMENSIONS || 256)) || 256),
    hasApiKey: Boolean(process.env.HIVEMINDOS_EMBEDDINGS_API_KEY?.trim()),
  };
}

function embeddingsEndpoint(url: string) {
  return /\/embeddings\/?$/.test(url) ? url : `${url.replace(/\/+$/, "")}/embeddings`;
}

function contentHashFor(record: Pick<AgentMemoryRecord, "title" | "content">) {
  return `sha256:${createHash("sha256").update(`${record.title}\n${record.content}`).digest("hex")}`;
}

async function embedTexts(texts: string[], timeoutMs: number): Promise<number[][] | null> {
  const config = agentMemoryEmbeddingsConfig();
  if (!config.enabled || !config.url || !texts.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(embeddingsEndpoint(config.url), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.hasApiKey ? { authorization: `Bearer ${process.env.HIVEMINDOS_EMBEDDINGS_API_KEY?.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: texts.map((text) => text.slice(0, MAX_EMBED_CHARS)),
        dimensions: config.dimensions,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
    if (!Array.isArray(payload.data) || payload.data.length !== texts.length) return null;
    const vectors: number[][] = new Array(texts.length);
    for (const [position, item] of payload.data.entries()) {
      const index = typeof item.index === "number" ? item.index : position;
      if (!Array.isArray(item.embedding) || index < 0 || index >= texts.length) return null;
      vectors[index] = item.embedding;
    }
    return vectors.every(Boolean) ? vectors : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readEmbeddingRows(root: string) {
  const file = join(root, AGENT_MEMORY_EMBEDDINGS_PATH);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return new Map<string, EmbeddingRow>();
  const cached = embeddingsCache.get(root);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.rows;
  const rows = new Map<string, EmbeddingRow>();
  const raw = await readFile(file, "utf8").catch(() => "");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as EmbeddingRow;
      if (parsed.schema === EMBEDDINGS_SCHEMA && parsed.memoryId && Array.isArray(parsed.vector)) {
        rows.set(parsed.memoryId, parsed);
      }
    } catch {
      // Ignore corrupt rows; backfill rewrites them.
    }
  }
  embeddingsCache.set(root, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

async function appendEmbeddingRows(root: string, rows: EmbeddingRow[]) {
  if (!rows.length) return;
  const file = join(root, AGENT_MEMORY_EMBEDDINGS_PATH);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  embeddingsCache.delete(root);
}

function embeddingText(record: Pick<AgentMemoryRecord, "title" | "content" | "type" | "tags">) {
  return [record.title, record.type, (record.tags ?? []).join(" "), record.content].filter(Boolean).join("\n");
}

// Fire-and-forget from the write path; never blocks or fails a memory write.
export async function upsertAgentMemoryEmbedding(root: string, record: AgentMemoryRecord) {
  const config = agentMemoryEmbeddingsConfig();
  if (!config.enabled) return { embedded: false, reason: "disabled" as const };
  try {
    const hash = contentHashFor(record);
    const existing = (await readEmbeddingRows(root)).get(record.id);
    if (existing && existing.contentHash === hash && existing.model === config.model) {
      return { embedded: false, reason: "unchanged" as const };
    }
    const vectors = await embedTexts([embeddingText(record)], WRITE_TIMEOUT_MS);
    if (!vectors) return { embedded: false, reason: "embed-failed" as const };
    await appendEmbeddingRows(root, [{
      schema: EMBEDDINGS_SCHEMA,
      memoryId: record.id,
      model: config.model,
      contentHash: hash,
      dimensions: vectors[0].length,
      vector: vectors[0],
      updatedAt: new Date().toISOString(),
    }]);
    return { embedded: true as const };
  } catch {
    return { embedded: false, reason: "embed-failed" as const };
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// Conversation archives answer many questions through paraphrase that lexical
// matching cannot reach ("Emma's ceremony" for a weddings query). Lazily embed
// the vault's conversation-note candidates (content-hashed, so repeat recalls
// are cache hits) and score them alongside typed-memory vectors; bounded and
// strictly best-effort like the rest of this layer.
const MAX_VAULT_SEMANTIC_CANDIDATES = 400;

export async function fullVaultSemanticScores(
  root: string,
  query: string,
  records: AgentMemoryRecord[],
  baseScores: Map<string, number>,
) {
  const config = agentMemoryEmbeddingsConfig();
  if (!config.enabled || !query.trim() || !records.length) return baseScores;
  const conversationRecords = records
    .filter((record) => record.notePath.startsWith("Memory/Conversations/"))
    .slice(0, MAX_VAULT_SEMANTIC_CANDIDATES);
  if (conversationRecords.length) {
    await backfillAgentMemoryEmbeddings(root, conversationRecords).catch(() => undefined);
  }
  const scores = await semanticScoresForRecords(root, query, records);
  for (const [id, value] of baseScores) {
    if (!scores.has(id)) scores.set(id, value);
  }
  return scores;
}

// Query-time similarity map (memoryId -> 0..1). Empty map on any failure so
// recall quality degrades to lexical instead of erroring.
export async function semanticScoresForRecords(root: string, query: string, records: AgentMemoryRecord[]) {
  const scores = new Map<string, number>();
  const config = agentMemoryEmbeddingsConfig();
  if (!config.enabled || !query.trim() || !records.length) return scores;
  const rows = await readEmbeddingRows(root).catch(() => new Map<string, EmbeddingRow>());
  if (!rows.size) return scores;
  const vectors = await embedTexts([query], QUERY_TIMEOUT_MS);
  const queryVector = vectors?.[0];
  if (!queryVector) return scores;
  for (const record of records) {
    const row = rows.get(record.id);
    if (!row) continue;
    const similarity = cosineSimilarity(queryVector, row.vector);
    if (similarity > 0) scores.set(record.id, Math.max(0, Math.min(1, similarity)));
  }
  return scores;
}

// Backfill missing/stale vectors (rebuild-index and consolidation call this).
export async function backfillAgentMemoryEmbeddings(root: string, records: AgentMemoryRecord[]) {
  const config = agentMemoryEmbeddingsConfig();
  if (!config.enabled) return { enabled: false, embedded: 0, skipped: records.length, failed: 0 };
  const rows = await readEmbeddingRows(root);
  const pending = records.filter((record) => {
    const existing = rows.get(record.id);
    return !existing || existing.contentHash !== contentHashFor(record) || existing.model !== config.model;
  });
  let embedded = 0;
  let failed = 0;
  for (let start = 0; start < pending.length; start += MAX_BATCH) {
    const batch = pending.slice(start, start + MAX_BATCH);
    const vectors = await embedTexts(batch.map(embeddingText), WRITE_TIMEOUT_MS);
    if (!vectors) {
      failed += batch.length;
      continue;
    }
    const now = new Date().toISOString();
    await appendEmbeddingRows(root, batch.map((record, index) => ({
      schema: EMBEDDINGS_SCHEMA,
      memoryId: record.id,
      model: config.model,
      contentHash: contentHashFor(record),
      dimensions: vectors[index].length,
      vector: vectors[index],
      updatedAt: now,
    })));
    embedded += batch.length;
  }
  return { enabled: true, embedded, skipped: records.length - pending.length, failed };
}

export async function agentMemoryEmbeddingsCoverage(root: string, records: AgentMemoryRecord[]) {
  const rows = await readEmbeddingRows(root).catch(() => new Map<string, EmbeddingRow>());
  const covered = records.filter((record) => rows.has(record.id)).length;
  return { config: agentMemoryEmbeddingsConfig(), stored: rows.size, covered, records: records.length };
}
