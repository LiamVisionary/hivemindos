import { createHash } from "crypto";
import { appendFile, mkdir, readFile, stat } from "fs/promises";
import { dirname, join } from "path";
import { readSharedHiveEnvValues } from "@/lib/services/shared-hive-env";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AgentMemoryRecord } from "./types";

// Optional semantic recall layer. Strictly best-effort: it activates only when
// HIVEMINDOS_EMBEDDINGS_URL points at an OpenAI-compatible /embeddings
// endpoint, and every failure degrades to lexical-only recall. GBrain remains
// the whole-vault semantic alternative; this layer covers typed Agent Memory
// with per-memory vectors stored beside the other brain indexes.

export const AGENT_MEMORY_EMBEDDINGS_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Embeddings.jsonl`;

const EMBEDDINGS_SCHEMA = "hivemindos.agent-memory-embedding.v1";
const EMBEDDING_IDENTITY_SCHEMA = "hivemindos.embedding-identity.v1";
const QUERY_TIMEOUT_MS = 3_500;
const WRITE_TIMEOUT_MS = 8_000;
const MAX_BATCH = 16;
const MAX_EMBED_CHARS = 6_000;
// Long records embed as multiple chunks with the title/type/tags header
// prepended to each (contextual retrieval), so content past the single-input
// cap stays reachable by paraphrase. Rows without a chunk field are chunk 0.
const CHUNK_CONTENT_CHARS = 2_400;
const MAX_CHUNKS_PER_RECORD = 12;

type EmbeddingRow = {
  schema: typeof EMBEDDINGS_SCHEMA;
  memoryId: string;
  model: string;
  configHash?: string;
  contentHash: string;
  chunk?: number;
  chunkCount?: number;
  dimensions: number;
  vector: number[];
  updatedAt: string;
};

type EmbeddingsCacheEntry = {
  mtimeMs: number;
  size: number;
  rows: Map<string, Map<number, EmbeddingRow>>;
};

const embeddingsCache = new Map<string, EmbeddingsCacheEntry>();

export type AgentMemoryEmbeddingsConfig = {
  enabled: boolean;
  url?: string;
  model: string;
  /** Sent to the provider only when set (local servers reject unknown dims). */
  dimensions?: number;
  hasApiKey: boolean;
  /** Name of the env key the API key is read from (indirection, no copies). */
  keyEnv?: string;
  source: "process-env" | "shared-hive-env" | "disabled";
};

type ResolvedEmbeddingsConfig = AgentMemoryEmbeddingsConfig & { apiKey?: string };

// Selection lives in the shared hive env so every machine's recall agrees;
// process env stays the override lane (tests, one-off experiments).
const EMBEDDINGS_ENV_KEYS = {
  url: "HIVEMINDOS_EMBEDDINGS_URL",
  model: "HIVEMINDOS_EMBEDDINGS_MODEL",
  dimensions: "HIVEMINDOS_EMBEDDINGS_DIMENSIONS",
  apiKey: "HIVEMINDOS_EMBEDDINGS_API_KEY",
  keyEnv: "HIVEMINDOS_EMBEDDINGS_KEY_ENV",
} as const;

const CONFIG_CACHE_TTL_MS = 10_000;
let configCache: { at: number; value: ResolvedEmbeddingsConfig } | null = null;

export function invalidateAgentMemoryEmbeddingsConfigCache() {
  configCache = null;
}

function parseDimensions(raw: string | undefined) {
  const parsed = Math.trunc(Number(raw ?? ""));
  return Number.isFinite(parsed) && parsed >= 16 ? parsed : undefined;
}

export async function resolveAgentMemoryEmbeddingsConfig(): Promise<ResolvedEmbeddingsConfig> {
  const envUrl = process.env[EMBEDDINGS_ENV_KEYS.url]?.trim();
  // The cache only amortizes the shared-env file read; the process-env
  // override path is free and must react to env changes immediately.
  if (!envUrl && configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) return configCache.value;
  const shared = envUrl ? {} : await readSharedHiveEnvValues().catch(() => ({} as Record<string, string>));
  const read = (key: string) => process.env[key]?.trim() || shared[key]?.trim() || undefined;
  const url = read(EMBEDDINGS_ENV_KEYS.url);
  const keyEnv = read(EMBEDDINGS_ENV_KEYS.keyEnv);
  const apiKey = read(EMBEDDINGS_ENV_KEYS.apiKey) || (keyEnv ? read(keyEnv) : undefined);
  const value: ResolvedEmbeddingsConfig = {
    enabled: Boolean(url),
    url,
    model: read(EMBEDDINGS_ENV_KEYS.model) || "text-embedding-3-small",
    dimensions: parseDimensions(read(EMBEDDINGS_ENV_KEYS.dimensions)),
    hasApiKey: Boolean(apiKey),
    keyEnv,
    source: !url ? "disabled" : envUrl ? "process-env" : "shared-hive-env",
    apiKey,
  };
  if (!envUrl) configCache = { at: Date.now(), value };
  return value;
}

export function publicEmbeddingsConfig(config: ResolvedEmbeddingsConfig): AgentMemoryEmbeddingsConfig {
  const clone: ResolvedEmbeddingsConfig = { ...config };
  delete clone.apiKey;
  return clone;
}

export type AgentMemoryEmbeddingIdentity = {
  schema: typeof EMBEDDING_IDENTITY_SCHEMA;
  provider: "openai-compatible";
  model: string;
  requestedDimensions: number;
  maxInputCharacters: number;
  chunkContentCharacters: number;
  maxChunksPerRecord: number;
  endpointHash?: string;
  configHash: string;
};

// Sync, process-env-only view; the async resolver adds the shared-hive-env
// fallback and the actual key. Prefer resolveAgentMemoryEmbeddingsConfig.
export function agentMemoryEmbeddingsConfig(): AgentMemoryEmbeddingsConfig {
  const url = process.env[EMBEDDINGS_ENV_KEYS.url]?.trim();
  return {
    enabled: Boolean(url),
    url: url || undefined,
    model: process.env[EMBEDDINGS_ENV_KEYS.model]?.trim() || "text-embedding-3-small",
    dimensions: parseDimensions(process.env[EMBEDDINGS_ENV_KEYS.dimensions]?.trim()),
    hasApiKey: Boolean(process.env[EMBEDDINGS_ENV_KEYS.apiKey]?.trim()),
    keyEnv: process.env[EMBEDDINGS_ENV_KEYS.keyEnv]?.trim() || undefined,
    source: url ? "process-env" : "disabled",
  };
}

export function agentMemoryEmbeddingIdentity(config = agentMemoryEmbeddingsConfig()): AgentMemoryEmbeddingIdentity {
  let endpointHash: string | undefined;
  if (config.url) {
    try {
      const parsed = new URL(embeddingsEndpoint(config.url));
      endpointHash = `sha256:${createHash("sha256").update(`${parsed.origin}${parsed.pathname}`).digest("hex")}`;
    } catch {
      endpointHash = `sha256:${createHash("sha256").update(config.url.split("?")[0]).digest("hex")}`;
    }
  }
  const identity = {
    schema: EMBEDDING_IDENTITY_SCHEMA as typeof EMBEDDING_IDENTITY_SCHEMA,
    provider: "openai-compatible" as const,
    model: config.model,
    // 0 = provider-default dimensions (no dimensions param sent).
    requestedDimensions: config.dimensions ?? 0,
    maxInputCharacters: MAX_EMBED_CHARS,
    chunkContentCharacters: CHUNK_CONTENT_CHARS,
    maxChunksPerRecord: MAX_CHUNKS_PER_RECORD,
    endpointHash,
  };
  return {
    ...identity,
    configHash: `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
  };
}

function embeddingsEndpoint(url: string) {
  return /\/embeddings\/?$/.test(url) ? url : `${url.replace(/\/+$/, "")}/embeddings`;
}

function contentHashFor(record: Pick<AgentMemoryRecord, "title" | "content">) {
  return `sha256:${createHash("sha256").update(`${record.title}\n${record.content}`).digest("hex")}`;
}

async function embedTexts(texts: string[], timeoutMs: number, config: ResolvedEmbeddingsConfig): Promise<number[][] | null> {
  if (!config.enabled || !config.url || !texts.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(embeddingsEndpoint(config.url), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: texts.map((text) => text.slice(0, MAX_EMBED_CHARS)),
        ...(config.dimensions ? { dimensions: config.dimensions } : {}),
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
  if (!st?.isFile()) return new Map<string, Map<number, EmbeddingRow>>();
  const cached = embeddingsCache.get(root);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.rows;
  const rows = new Map<string, Map<number, EmbeddingRow>>();
  const raw = await readFile(file, "utf8").catch(() => "");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as EmbeddingRow;
      if (parsed.schema === EMBEDDINGS_SCHEMA && parsed.memoryId && Array.isArray(parsed.vector)) {
        const chunks = rows.get(parsed.memoryId) ?? new Map<number, EmbeddingRow>();
        chunks.set(parsed.chunk ?? 0, parsed);
        rows.set(parsed.memoryId, chunks);
      }
    } catch {
      // Ignore corrupt rows; backfill rewrites them.
    }
  }
  embeddingsCache.set(root, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

function currentChunkRows(
  chunks: Map<number, EmbeddingRow> | undefined,
  record: Pick<AgentMemoryRecord, "title" | "content">,
  identity: AgentMemoryEmbeddingIdentity,
) {
  if (!chunks?.size) return [];
  const hash = contentHashFor(record);
  return [...chunks.values()].filter((row) => row.contentHash === hash && row.configHash === identity.configHash && row.model === identity.model);
}

async function appendEmbeddingRows(root: string, rows: EmbeddingRow[]) {
  if (!rows.length) return;
  const file = join(root, AGENT_MEMORY_EMBEDDINGS_PATH);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  embeddingsCache.delete(root);
}

function embeddingHeader(record: Pick<AgentMemoryRecord, "title" | "type" | "tags">) {
  return [record.title, record.type, (record.tags ?? []).join(" ")].filter(Boolean).join("\n");
}

// One text per chunk, each prefixed with the record header so a tangent
// paragraph deep in a long note still embeds with its topic attached. Short
// records produce a single chunk identical to the pre-chunking format.
function embeddingChunkTexts(record: Pick<AgentMemoryRecord, "title" | "content" | "type" | "tags">) {
  const header = embeddingHeader(record);
  const whole = [header, record.content].filter(Boolean).join("\n");
  if (whole.length <= MAX_EMBED_CHARS) return [whole];
  const paragraphs = record.content.split(/\n{2,}/);
  const segments: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CONTENT_CHARS) {
      push();
      for (let start = 0; start < paragraph.length; start += CHUNK_CONTENT_CHARS) {
        segments.push(paragraph.slice(start, start + CHUNK_CONTENT_CHARS).trim());
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > CHUNK_CONTENT_CHARS) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  // Coverage bound: content past MAX_CHUNKS_PER_RECORD * CHUNK_CONTENT_CHARS
  // is not embedded; chunkCount on the rows records the truncation.
  return segments.slice(0, MAX_CHUNKS_PER_RECORD).map((segment) => `${header}\n\n${segment}`);
}

// Fire-and-forget from the write path; never blocks or fails a memory write.
export async function upsertAgentMemoryEmbedding(root: string, record: AgentMemoryRecord) {
  const config = await resolveAgentMemoryEmbeddingsConfig();
  if (!config.enabled) return { embedded: false, reason: "disabled" as const };
  try {
    const hash = contentHashFor(record);
    const identity = agentMemoryEmbeddingIdentity(config);
    const existing = currentChunkRows((await readEmbeddingRows(root)).get(record.id), record, identity);
    if (existing.length) {
      return { embedded: false, reason: "unchanged" as const };
    }
    const texts = embeddingChunkTexts(record);
    const vectors = await embedTexts(texts, WRITE_TIMEOUT_MS, config);
    if (!vectors) return { embedded: false, reason: "embed-failed" as const };
    const now = new Date().toISOString();
    await appendEmbeddingRows(root, vectors.map((vector, chunk) => ({
      schema: EMBEDDINGS_SCHEMA,
      memoryId: record.id,
      model: config.model,
      configHash: identity.configHash,
      contentHash: hash,
      chunk,
      chunkCount: vectors.length,
      dimensions: vector.length,
      vector,
      updatedAt: now,
    })));
    return { embedded: true as const };
  } catch {
    return { embedded: false, reason: "embed-failed" as const };
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) return 0;
  const length = left.length;
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
  const config = await resolveAgentMemoryEmbeddingsConfig();
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
  const config = await resolveAgentMemoryEmbeddingsConfig();
  if (!config.enabled || !query.trim() || !records.length) return scores;
  const rows = await readEmbeddingRows(root).catch(() => new Map<string, Map<number, EmbeddingRow>>());
  if (!rows.size) return scores;
  const identity = agentMemoryEmbeddingIdentity(config);
  const vectors = await embedTexts([query], QUERY_TIMEOUT_MS, config);
  const queryVector = vectors?.[0];
  if (!queryVector) return scores;
  for (const record of records) {
    const chunkRows = currentChunkRows(rows.get(record.id), record, identity)
      .filter((row) => row.dimensions === queryVector.length);
    if (!chunkRows.length) continue;
    // A record matches as strongly as its best chunk: one relevant tangent
    // paragraph is enough, and averaging would drown it in unrelated chunks.
    let best = 0;
    for (const row of chunkRows) {
      const similarity = cosineSimilarity(queryVector, row.vector);
      if (similarity > best) best = similarity;
    }
    if (best > 0) scores.set(record.id, Math.max(0, Math.min(1, best)));
  }
  return scores;
}

// Backfill missing/stale vectors (rebuild-index and consolidation call this).
export async function backfillAgentMemoryEmbeddings(root: string, records: AgentMemoryRecord[]) {
  const config = await resolveAgentMemoryEmbeddingsConfig();
  if (!config.enabled) return { enabled: false, embedded: 0, skipped: records.length, failed: 0 };
  const rows = await readEmbeddingRows(root);
  const identity = agentMemoryEmbeddingIdentity(config);
  const pending = records.filter((record) => !currentChunkRows(rows.get(record.id), record, identity).length);
  let embedded = 0;
  let failed = 0;
  // Batch at the chunk level so a long record cannot blow the request size.
  const chunkJobs = pending.flatMap((record) => {
    const hash = contentHashFor(record);
    const texts = embeddingChunkTexts(record);
    return texts.map((text, chunk) => ({ record, hash, text, chunk, chunkCount: texts.length }));
  });
  const failedRecordIds = new Set<string>();
  for (let start = 0; start < chunkJobs.length; start += MAX_BATCH) {
    const batch = chunkJobs.slice(start, start + MAX_BATCH);
    const vectors = await embedTexts(batch.map((job) => job.text), WRITE_TIMEOUT_MS, config);
    if (!vectors) {
      for (const job of batch) failedRecordIds.add(job.record.id);
      continue;
    }
    const now = new Date().toISOString();
    await appendEmbeddingRows(root, batch.map((job, index) => ({
      schema: EMBEDDINGS_SCHEMA,
      memoryId: job.record.id,
      model: config.model,
      configHash: identity.configHash,
      contentHash: job.hash,
      chunk: job.chunk,
      chunkCount: job.chunkCount,
      dimensions: vectors[index].length,
      vector: vectors[index],
      updatedAt: now,
    })));
  }
  failed = failedRecordIds.size;
  embedded = pending.length - failed;
  return { enabled: true, embedded, skipped: records.length - pending.length, failed };
}

export async function agentMemoryEmbeddingsCoverage(root: string, records: AgentMemoryRecord[]) {
  const rows = await readEmbeddingRows(root).catch(() => new Map<string, Map<number, EmbeddingRow>>());
  const resolved = await resolveAgentMemoryEmbeddingsConfig();
  const config = publicEmbeddingsConfig(resolved);
  const identity = agentMemoryEmbeddingIdentity(resolved);
  const covered = records.filter((record) => currentChunkRows(rows.get(record.id), record, identity).length > 0).length;
  const mismatched = records.filter((record) => {
    const chunks = rows.get(record.id);
    return Boolean(chunks?.size && !currentChunkRows(chunks, record, identity).length);
  }).length;
  return { config, identity, stored: rows.size, covered, mismatched, records: records.length };
}
