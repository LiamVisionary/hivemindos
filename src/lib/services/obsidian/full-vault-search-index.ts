import "server-only";

import { createHash, randomUUID } from "crypto";
import { constants } from "fs";
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { bm25TermCounts, bm25Tokens, scoreBm25Terms } from "@/lib/services/search/bm25-lite";

export const FULL_VAULT_SEARCH_INDEX_PATH = "Operations/Brain Services/Full Vault Search Index.jsonl";

const MAX_INDEXED_MARKDOWN_FILES = 50_000;
const MAX_INDEXED_MARKDOWN_BYTES = 1024 * 1024;
const MAX_INDEX_TERMS_PER_NOTE = 900;
const MAX_SEARCH_RESULTS = 500;
const VAULT_EXCLUDE_PARTS = new Set([".git", ".obsidian", ".trash", ".hivemindos-transfers", "node_modules"]);
const VAULT_EXCLUDE_PREFIXES = [
  "Operations/Runtime Mirrors/",
  "Operations/Brain Services/Agent Memory Index.jsonl",
  "Operations/Brain Services/Agent Memory Entity Index.jsonl",
  "Operations/Brain Services/Agent Memory Retrievals.jsonl",
  "Operations/Brain Services/Agent Memory Proofs.jsonl",
  "Operations/Brain Services/Agent Memory Embeddings.jsonl",
  FULL_VAULT_SEARCH_INDEX_PATH,
  "Operations/Vault Migrations/",
  "Archive/",
];
// An existing index older than this is rebuilt before answering, so notes
// written after the last rebuild stop being invisible to indexed recall.
// Override with HIVEMINDOS_FULL_VAULT_INDEX_TTL_MS (0 disables the check).
const DEFAULT_INDEX_TTL_MS = 6 * 60 * 60 * 1000;

function indexTtlMs() {
  const raw = process.env.HIVEMINDOS_FULL_VAULT_INDEX_TTL_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_INDEX_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INDEX_TTL_MS;
}
const STOP_WORDS = new Set([
  "about", "after", "again", "agent", "agents", "also", "and", "are", "brain", "but", "can", "codex", "for", "from",
  "has", "have", "hive", "hivemindos", "into", "its", "memory", "note", "notes", "not", "our", "shared", "that",
  "the", "their", "this", "use", "uses", "vault", "was", "were", "what", "when", "where", "with", "you", "your",
]);
const COLLECTION_DESCRIPTIONS: Record<string, string> = {
  intake: "Raw captures, requests, and source inboxes.",
  memory: "Durable memories, conversations, meetings, reviews, and imported sources.",
  projects: "Project notes and project-local context.",
  synthesis: "Drafts, compiled knowledge, reviewed wiki output, and agent packs.",
  ideas: "Idea notes and speculative working material.",
  operations: "Operational HivemindOS state, service notes, work boards, and secure references.",
  skills: "Shared skill instructions and reusable agent workflows.",
  templates: "Reusable HivemindOS note templates.",
  root: "Top-level shared context and vault contract notes.",
};

export type FullVaultSearchIndexRecord = {
  schema: "hivemindos.full-vault-search.v1";
  path: string;
  collection: string;
  title: string;
  headings: string[];
  tags: string[];
  frontmatterType?: string;
  mtimeMs: number;
  size: number;
  hash: string;
  indexedByteLimit: number;
  documentLength: number;
  terms: Record<string, number>;
  excerpt: string;
};

export type FullVaultSearchHit = FullVaultSearchIndexRecord & {
  score: number;
  matched: string[];
};

type ParsedSearchQuery = {
  terms: string[];
  negativeTerms: string[];
  phrases: string[];
  pathPrefixes: string[];
  collections: string[];
  tags: string[];
  types: string[];
};

type IndexCacheEntry = {
  file: string;
  mtimeMs: number;
  size: number;
  records: FullVaultSearchIndexRecord[];
};

const indexCache = new Map<string, IndexCacheEntry>();

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || (resolve(path) !== resolve(root) && rel === "")) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected vault.");
  }
}

function toVaultPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function normalizedPath(path: string) {
  return path.split(sep).join("/");
}

function shouldSkipVaultPath(root: string, fullPath: string, isDirectory: boolean) {
  const rel = normalizedPath(relative(root, fullPath));
  const name = basename(fullPath);
  if (VAULT_EXCLUDE_PARTS.has(name)) return true;
  if (name.startsWith(".") && name !== ".") return true;
  // Sync-conflict copies are unresolved duplicates, not knowledge.
  if (name.includes(".sync-conflict-")) return true;
  if (isDirectory && VAULT_EXCLUDE_PREFIXES.some((prefix) => prefix.endsWith("/") && (rel === prefix.slice(0, -1) || rel.startsWith(prefix)))) return true;
  if (!isDirectory && VAULT_EXCLUDE_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix))) return true;
  return false;
}

async function walkVaultMarkdown(root: string, dir = root, output: string[] = []): Promise<string[]> {
  if (output.length >= MAX_INDEXED_MARKDOWN_FILES) return output;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_INDEXED_MARKDOWN_FILES) break;
    const fullPath = join(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      if (!shouldSkipVaultPath(root, fullPath, true)) await walkVaultMarkdown(root, fullPath, output);
    } else if (entry.isFile() && entry.name.endsWith(".md") && !shouldSkipVaultPath(root, fullPath, false)) {
      output.push(fullPath);
    }
  }
  return output;
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields = new Map<string, unknown>();
  if (!match) return { fields, body: markdown };
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    const raw = field[2].trim();
    try {
      fields.set(field[1], JSON.parse(raw));
    } catch {
      if (raw === "true") fields.set(field[1], true);
      else if (raw === "false") fields.set(field[1], false);
      else fields.set(field[1], raw.replace(/^["']|["']$/g, ""));
    }
  }
  return { fields, body: markdown.slice(match[0].length) };
}

function compact(value: string, max = 280) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function textTokens(value: string) {
  return bm25Tokens(value).filter((term) => !STOP_WORDS.has(term));
}

function termCounts(tokens: string[]) {
  return bm25TermCounts(tokens, MAX_INDEX_TERMS_PER_NOTE);
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase().replace(/^["']|["']$/g, "");
}

function parseSearchQuery(query?: string): ParsedSearchQuery {
  const raw = query?.trim() ?? "";
  const lexLines = raw.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith("lex:"))
    .map((line) => line.replace(/^lex:\s*/i, ""));
  const source = lexLines.length ? lexLines.join(" ") : raw;
  const phrases = [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim().toLowerCase()).filter(Boolean);
  const withoutPhrases = source.replace(/"([^"]+)"/g, " ");
  const terms: string[] = [];
  const negativeTerms: string[] = [];
  const pathPrefixes: string[] = [];
  const collections: string[] = [];
  const tags: string[] = [];
  const types: string[] = [];

  for (const part of withoutPhrases.split(/\s+/).filter(Boolean)) {
    const normalized = normalizeFilterValue(part);
    const [rawKey, ...rawRest] = normalized.split(":");
    const value = rawRest.join(":");
    if (rawRest.length && value) {
      if (rawKey === "collection" || rawKey === "c") collections.push(value);
      else if (rawKey === "path") pathPrefixes.push(value.replace(/^\/+/, ""));
      else if (rawKey === "tag") tags.push(value.replace(/^#/, ""));
      else if (rawKey === "type") types.push(value);
      else terms.push(...textTokens(value));
      continue;
    }
    if (normalized.startsWith("-")) negativeTerms.push(...textTokens(normalized.slice(1)));
    else terms.push(...textTokens(normalized));
  }

  return {
    terms: [...new Set(terms)],
    negativeTerms: [...new Set(negativeTerms)],
    phrases,
    pathPrefixes: [...new Set(pathPrefixes)],
    collections: [...new Set(collections)],
    tags: [...new Set(tags)],
    types: [...new Set(types)],
  };
}

function collectionForPath(notePath: string) {
  const first = notePath.split("/")[0]?.toLowerCase() || "root";
  if (first === "intake") return "intake";
  if (first === "memory") return "memory";
  if (first === "projects") return "projects";
  if (first === "synthesis") return "synthesis";
  if (first === "ideas") return "ideas";
  if (first === "operations") return "operations";
  if (first === "skills") return "skills";
  if (first === "templates") return "templates";
  return "root";
}

function markdownTitle(body: string, path: string, frontmatterTitle: unknown) {
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) return frontmatterTitle.trim();
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, ".md");
}

function frontmatterTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 24);
}

function recordFromMarkdown(root: string, file: string, markdown: string, mtimeMs: number, size: number): FullVaultSearchIndexRecord | null {
  const notePath = toVaultPath(root, file);
  const { fields, body } = parseFrontmatter(markdown);
  const title = markdownTitle(body, notePath, fields.get("title"));
  const headings = [...body.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 32);
  const tags = frontmatterTags(fields.get("tags"));
  const frontmatterType = typeof fields.get("type") === "string" ? String(fields.get("type")) : undefined;
  const text = [
    title,
    headings.join(" "),
    tags.join(" "),
    frontmatterType,
    body.replace(/^#\s+.+$/gm, " "),
  ].filter(Boolean).join("\n");
  const tokens = textTokens(text);
  if (!tokens.length) return null;
  return {
    schema: "hivemindos.full-vault-search.v1",
    path: notePath,
    collection: collectionForPath(notePath),
    title,
    headings,
    tags,
    frontmatterType,
    mtimeMs,
    size,
    hash: createHash("sha256").update(markdown).digest("hex"),
    indexedByteLimit: MAX_INDEXED_MARKDOWN_BYTES,
    documentLength: tokens.length,
    terms: termCounts(tokens),
    excerpt: compact(body.replace(/^#\s+.+$/gm, " ")),
  };
}

function indexPath(root: string) {
  return join(root, FULL_VAULT_SEARCH_INDEX_PATH);
}

async function readIndex(root: string) {
  const file = indexPath(root);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return null;
  const cached = indexCache.get(root);
  if (cached && cached.file === file && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.records;
  const raw = await readFile(file, "utf8").catch(() => "");
  const records: FullVaultSearchIndexRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as FullVaultSearchIndexRecord;
      if (
        parsed.schema === "hivemindos.full-vault-search.v1" &&
        parsed.path &&
        parsed.terms &&
        parsed.indexedByteLimit === MAX_INDEXED_MARKDOWN_BYTES
      ) records.push(parsed);
    } catch {
      // Ignore corrupt rows; rebuild can repair the generated index.
    }
  }
  indexCache.set(root, { file, mtimeMs: st.mtimeMs, size: st.size, records });
  return records.length ? records : null;
}

async function writeIndexFileAtomically(file: string, payload: string) {
  await mkdir(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, file);
  } finally {
    await unlink(temporaryFile).catch(() => undefined);
  }
}

/**
 * Pure line filter behind {@link removeFullVaultSearchIndexPaths}: drop every
 * row whose `path` is in `paths`, keep everything else byte-for-byte. Lines
 * that fail to parse are KEPT, matching the telemetry purge — a truncated or
 * hand-edited row is not ours to discard.
 */
export function fullVaultIndexLinesWithoutPaths(raw: string, paths: Iterable<string>) {
  const drop = new Set(paths);
  let removed = 0;
  const kept = raw.split("\n").filter((line) => {
    if (!line.trim()) return false;
    let parsed: { path?: unknown };
    try {
      parsed = JSON.parse(line) as { path?: unknown };
    } catch {
      return true;
    }
    if (typeof parsed.path !== "string" || !drop.has(parsed.path)) return true;
    removed += 1;
    return false;
  });
  return { removed, contents: kept.length ? `${kept.join("\n")}\n` : "" };
}

/**
 * Drop generated search rows for notes a caller just deleted. Anything that
 * removes vault markdown MUST call this in the same operation: a row carries
 * the note's `excerpt`, `headings`, `tags`, and full term vector, so a stale
 * row keeps a deleted note's content searchable — and answerable — until the
 * next TTL rebuild (default 6h). Returns the number of rows removed.
 */
export async function removeFullVaultSearchIndexPaths(root: string, paths: Iterable<string>) {
  const resolvedRoot = resolve(root);
  const drop = new Set(paths);
  if (!drop.size) return 0;
  const file = indexPath(resolvedRoot);
  const raw = await readFile(file, "utf8").catch(() => "");
  if (!raw) return 0;
  const result = fullVaultIndexLinesWithoutPaths(raw, drop);
  if (!result.removed) return 0;
  await writeIndexFileAtomically(file, result.contents);
  indexCache.delete(resolvedRoot);
  return result.removed;
}

export async function rebuildFullVaultSearchIndex(input: { root: string }) {
  const root = resolve(input.root);
  await access(root, constants.R_OK);
  const files = await walkVaultMarkdown(root);
  const records: FullVaultSearchIndexRecord[] = [];
  for (const file of files) {
    const st = await stat(file).catch(() => null);
    if (!st?.isFile() || st.size > MAX_INDEXED_MARKDOWN_BYTES) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const record = recordFromMarkdown(root, file, markdown, st.mtimeMs, st.size);
    if (record) records.push(record);
  }
  const file = indexPath(root);
  const payload = records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
  await writeIndexFileAtomically(file, payload);
  indexCache.delete(root);
  const st = await stat(file).catch(() => null);
  return {
    indexPath: FULL_VAULT_SEARCH_INDEX_PATH,
    collections: collectionSummary(records),
    scanned: files.length,
    indexed: records.length,
    bytes: st?.size ?? 0,
    rebuiltAt: new Date().toISOString(),
  };
}

function collectionSummary(records: FullVaultSearchIndexRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.collection, (counts.get(record.collection) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => ({ id, count, description: COLLECTION_DESCRIPTIONS[id] ?? "Vault markdown collection." }));
}

async function readOrBuildIndex(root: string) {
  const ttl = indexTtlMs();
  if (ttl > 0) {
    const st = await stat(indexPath(root)).catch(() => null);
    if (st?.isFile() && Date.now() - st.mtimeMs > ttl) {
      await rebuildFullVaultSearchIndex({ root }).catch(() => undefined);
    }
  }
  return await readIndex(root) ?? (await rebuildFullVaultSearchIndex({ root }), await readIndex(root)) ?? [];
}

export async function fullVaultSearchIndexStatus(root: string) {
  const st = await stat(indexPath(resolve(root))).catch(() => null);
  const records = st?.isFile() ? await readIndex(resolve(root)) : null;
  return {
    exists: Boolean(st?.isFile()),
    indexPath: FULL_VAULT_SEARCH_INDEX_PATH,
    bytes: st?.size ?? 0,
    ageMs: st ? Math.max(0, Date.now() - st.mtimeMs) : null,
    ttlMs: indexTtlMs(),
    stale: Boolean(st?.isFile() && indexTtlMs() > 0 && Date.now() - st.mtimeMs > indexTtlMs()),
    indexed: records?.length ?? 0,
    syncConflictEntries: records?.filter((record) => record.path.includes(".sync-conflict-")).length ?? 0,
  };
}

function recordMatchesFilters(record: FullVaultSearchIndexRecord, parsed: ParsedSearchQuery) {
  if (parsed.collections.length && !parsed.collections.includes(record.collection)) return false;
  if (parsed.pathPrefixes.length && !parsed.pathPrefixes.some((prefix) => record.path.toLowerCase().startsWith(prefix))) return false;
  if (parsed.tags.length && !parsed.tags.every((tag) => record.tags.includes(tag))) return false;
  if (parsed.types.length && (!record.frontmatterType || !parsed.types.includes(record.frontmatterType.toLowerCase()))) return false;
  if (parsed.negativeTerms.some((term) => record.terms[term])) return false;
  return true;
}

function queryTermCoverageScore(parsed: ParsedSearchQuery, matched: Set<string>) {
  if (parsed.terms.length <= 1) return 0;
  const matchedTermCount = parsed.terms.filter((term) => matched.has(term)).length;
  if (!matchedTermCount) return 0;
  const coverage = matchedTermCount / parsed.terms.length;
  let score = coverage * 6;
  if (matchedTermCount === parsed.terms.length) score += 3;
  if (parsed.terms.length >= 4 && coverage < 0.5) score -= (parsed.terms.length - matchedTermCount) * 0.75;
  return score;
}

function bm25Score(record: FullVaultSearchIndexRecord, parsed: ParsedSearchQuery, documentCount: number, docFreq: Map<string, number>, averageLength: number) {
  const matched = new Set<string>();
  let score = 0;
  const lowerTitle = record.title.toLowerCase();
  const lowerHeadings = record.headings.join(" ").toLowerCase();
  const lowerPath = record.path.toLowerCase();
  const lowerExcerpt = record.excerpt.toLowerCase();
  for (const term of parsed.terms) {
    const frequency = record.terms[term] ?? 0;
    if (!frequency) continue;
    score += scoreBm25Terms({
      terms: [term],
      documentTerms: record.terms,
      documentLength: record.documentLength,
      documentCount,
      docFreq,
      averageLength,
    });
    if (lowerTitle.includes(term)) score += 3;
    if (lowerHeadings.includes(term)) score += 1.5;
    if (lowerPath.includes(term)) score += 1;
    matched.add(term);
  }
  for (const phrase of parsed.phrases) {
    if (lowerTitle.includes(phrase)) {
      score += 8;
      matched.add(`"${phrase}"`);
    } else if (lowerHeadings.includes(phrase) || lowerExcerpt.includes(phrase) || lowerPath.includes(phrase)) {
      score += 4;
      matched.add(`"${phrase}"`);
    }
  }
  score += queryTermCoverageScore(parsed, matched);
  if (parsed.collections.includes(record.collection)) score += 2;
  return { score: Math.round(score * 100) / 10, matched: [...matched] };
}

export async function searchFullVaultSearchIndex(input: { root: string; query?: string; limit?: number }) {
  const root = resolve(input.root);
  const parsed = parseSearchQuery(input.query);
  const records = (await readOrBuildIndex(root)).filter((record) => recordMatchesFilters(record, parsed));
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? MAX_SEARCH_RESULTS)), 1), MAX_SEARCH_RESULTS);
  const documentCount = Math.max(records.length, 1);
  const averageLength = records.reduce((sum, record) => sum + record.documentLength, 0) / documentCount;
  const docFreq = new Map<string, number>();
  for (const term of parsed.terms) {
    docFreq.set(term, records.reduce((count, record) => count + (record.terms[term] ? 1 : 0), 0));
  }
  const queryHasSearchTerms = parsed.terms.length || parsed.phrases.length;
  const hits: FullVaultSearchHit[] = records
    .map((record) => {
      const scored = bm25Score(record, parsed, documentCount, docFreq, averageLength);
      return { ...record, score: scored.score, matched: scored.matched };
    })
    .filter((hit) => !queryHasSearchTerms || hit.matched.length > 0)
    .sort((left, right) => right.score - left.score || right.mtimeMs - left.mtimeMs)
    .slice(0, limit);
  return {
    query: input.query?.trim() ?? "",
    indexPath: FULL_VAULT_SEARCH_INDEX_PATH,
    searchMode: "bm25-lite" as const,
    collections: collectionSummary(records),
    totalIndexed: records.length,
    hits,
  };
}
