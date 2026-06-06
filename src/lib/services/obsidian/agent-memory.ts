import { constants } from "fs";
import { access, appendFile, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { readGitLawbStatus, sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { GitLawbProof, GitLawbProofStatus, GitLawbStatus } from "@/lib/types/gitlawb";

export const AGENT_MEMORY_TYPES = [
  "instruction",
  "fact",
  "decision",
  "goal",
  "commitment",
  "preference",
  "relationship",
  "context",
  "event",
  "learning",
  "observation",
  "artifact",
  "error",
] as const;

export type AgentMemoryType = (typeof AGENT_MEMORY_TYPES)[number];

export type AgentMemoryRecord = {
  id: string;
  type: AgentMemoryType;
  title: string;
  content: string;
  confidence: number;
  status: "active" | "superseded" | "archived";
  tags: string[];
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  machineId?: string;
  tailnetId?: string;
  tailnetName?: string;
  tailnetDnsName?: string;
  collectorUrl?: string;
  sessionId?: string;
  project?: string;
  createdAt: string;
  updatedAt: string;
  notePath: string;
  proofId?: string;
  proofStatus?: GitLawbProofStatus;
  proofHash?: string;
  proofPath?: string;
  actorDid?: string;
};

export type AgentMemoryProofMode = boolean | "auto";

export type AgentMemoryHit = AgentMemoryRecord & {
  score: number;
  matched: string[];
  excerpt: string;
};

export type RememberAgentMemoryInput = {
  vaultPath?: string;
  type?: string;
  title?: string;
  content?: string;
  confidence?: number;
  tags?: string[];
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  machineId?: string;
  tailnetId?: string;
  tailnetName?: string;
  tailnetDnsName?: string;
  collectorUrl?: string;
  sessionId?: string;
  project?: string;
  proof?: AgentMemoryProofMode;
};

export type RecallAgentMemoryInput = {
  vaultPath?: string;
  query?: string;
  type?: string;
  tags?: string[];
  project?: string;
  limit?: number;
  includeArchived?: boolean;
  scope?: string;
};

export type RebuildAgentMemoryIndexInput = {
  vaultPath?: string;
};

const MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const INDEX_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Index.jsonl`;
const PROOF_INDEX_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Proofs.jsonl`;
const MAX_MEMORY_FILES = 1500;
const MAX_VAULT_NOTE_FILES = 5000;
const MAX_MEMORY_BYTES = 128 * 1024;
const MAX_VAULT_NOTE_BYTES = 256 * 1024;
const VAULT_RECORD_CACHE_TTL_MS = 30_000;
const TIERED_MEMORY_STRONG_SCORE = 32;
const TIERED_MEMORY_USABLE_SCORE = 24;
const TIERED_MEMORY_HIGH_CONFIDENCE = 0.85;
const VAULT_NOTE_EXCLUDE_PARTS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".hivemindos-transfers",
  "node_modules",
]);
const VAULT_NOTE_EXCLUDE_PREFIXES = [
  "Operations/Runtime Mirrors/",
  "Operations/Brain Services/Agent Memory Index.jsonl",
  "Operations/Brain Services/Agent Memory Proofs.jsonl",
  "Operations/Vault Migrations/",
  "Archive/",
];
const VAULT_NOTE_TYPE_MAP: Array<[RegExp, AgentMemoryType]> = [
  [/decision/i, "decision"],
  [/preference/i, "preference"],
  [/goal/i, "goal"],
  [/commitment/i, "commitment"],
  [/meeting|event/i, "event"],
  [/learn|lesson/i, "learning"],
  [/artifact|output/i, "artifact"],
  [/error|incident|bug/i, "error"],
  [/fact|source|research/i, "fact"],
  [/instruction|rule|policy/i, "instruction"],
];

const VALID_MEMORY_TYPES = new Set<AgentMemoryType>(AGENT_MEMORY_TYPES);
const AUTO_PROOF_TYPES = new Set<AgentMemoryType>(["instruction", "decision", "commitment", "preference", "artifact"]);
const LOW_SIGNAL_QUERY_WORDS = new Set(["agent", "agents", "brain", "hivemindos", "memory", "memories", "note", "notes", "shared", "vault"]);
const memoryIndexCache = new Map<string, MemoryIndexCacheEntry>();
const vaultRecordsCache = new Map<string, VaultRecordsCacheEntry>();
const recordSearchTextCache = new WeakMap<AgentMemoryRecord, string>();
const recordContentTextCache = new WeakMap<AgentMemoryRecord, string>();

type AgentMemoryProofReceipt = GitLawbProof & {
  kind: "agent-memory";
  metadata: {
    source: "agent-memory";
    memoryId: string;
    memoryType: AgentMemoryType;
    memoryTitle: string;
    notePath: string;
    contentHash: string;
    recordHash: string;
    previousProofHash?: string;
    agentName?: string;
    agentId?: string;
    runtime?: string;
    machineName?: string;
    machineId?: string;
    tailnetId?: string;
    tailnetName?: string;
    tailnetDnsName?: string;
    collectorUrl?: string;
    sessionId?: string;
    project?: string;
    createdAt: string;
    checkedAt: string;
    gitlawbCliInstalled: boolean;
    gitlawbNodeBindMode?: string;
    gitlawbNodeHealthy?: boolean;
    error?: string;
    proofHash?: string;
  };
};

type AgentMemoryIndexEntry = {
  action?: string;
  id?: string;
  memoryType?: string;
  title?: string;
  content?: string;
  status?: AgentMemoryRecord["status"];
  notePath?: string;
  confidence?: number;
  tags?: string[];
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  machineId?: string;
  tailnetId?: string;
  tailnetName?: string;
  tailnetDnsName?: string;
  collectorUrl?: string;
  sessionId?: string;
  project?: string;
  createdAt?: string;
  updatedAt?: string;
  proofId?: string;
  proofStatus?: GitLawbProofStatus;
  proofHash?: string;
  proofPath?: string;
  actorDid?: string;
};

type MemoryIndexCacheEntry = {
  file: string;
  mtimeMs: number;
  size: number;
  records: AgentMemoryRecord[];
};

type VaultRecordsCacheEntry = {
  cachedAt: number;
  records: AgentMemoryRecord[];
};

function toVaultPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(path) === resolve(root)) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected vault.");
  }
}

function safeSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "memory";
}

function compactContent(value: string, maxLength = 180) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

function normalizeMemoryType(value?: string): AgentMemoryType {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z]+/g, "-") || "context";
  if (!VALID_MEMORY_TYPES.has(normalized as AgentMemoryType)) {
    throw new Error(`Unsupported memory type "${value}". Use one of: ${AGENT_MEMORY_TYPES.join(", ")}.`);
  }
  return normalized as AgentMemoryType;
}

function normalizeConfidence(value?: number) {
  if (value === undefined) return 0.7;
  if (!Number.isFinite(value)) throw new Error("Memory confidence must be a number from 0 to 1.");
  return Math.min(1, Math.max(0, value));
}

function normalizeTags(values?: string[]) {
  return [...new Set((values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9][a-z0-9/_-]{0,48}$/.test(value)))]
    .slice(0, 12);
}

function shouldWriteProof(type: AgentMemoryType, confidence: number, mode?: AgentMemoryProofMode) {
  if (mode === true) return true;
  if (mode !== "auto") return false;
  return AUTO_PROOF_TYPES.has(type) || (type === "fact" && confidence >= 0.85);
}

function yamlValue(value: string | number | boolean | string[] | undefined) {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value) || typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function frontmatter(fields: Record<string, string | number | boolean | string[] | undefined>) {
  return [
    "---",
    ...Object.entries(fields).flatMap(([key, value]) => {
      const rendered = yamlValue(value);
      return rendered === undefined ? [] : [`${key}: ${rendered}`];
    }),
    "---",
  ].join("\n");
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
      else if (/^-?\d+(?:\.\d+)?$/.test(raw)) fields.set(field[1], Number(raw));
      else fields.set(field[1], raw.replace(/^["']|["']$/g, ""));
    }
  }
  return { fields, body: markdown.slice(match[0].length) };
}

function bodyContent(markdownBody: string) {
  const content = markdownBody
    .replace(/^#\s+.+$/m, "")
    .replace(/^## Metadata[\s\S]*$/m, "")
    .trim();
  return content;
}

function textWords(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length > 2 && !LOW_SIGNAL_QUERY_WORDS.has(word));
}

function recencyScore(createdAt: string) {
  const ageDays = (Date.now() - Date.parse(createdAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 4;
  if (ageDays <= 1) return 10;
  if (ageDays <= 7) return 7;
  if (ageDays <= 30) return 4;
  if (ageDays <= 180) return 2;
  return 0;
}

function recordSearchText(record: AgentMemoryRecord) {
  const cached = recordSearchTextCache.get(record);
  if (cached !== undefined) return cached;
  const searchText = [
    record.title,
    record.content,
    record.type,
    record.tags.join(" "),
    record.source,
    record.project,
    record.agentName,
    record.agentId,
    record.runtime,
    record.machineName,
    record.machineId,
    record.tailnetId,
    record.tailnetName,
    record.tailnetDnsName,
    record.collectorUrl,
  ].filter(Boolean).join(" ").toLowerCase();
  recordSearchTextCache.set(record, searchText);
  return searchText;
}

function recordContentText(record: AgentMemoryRecord) {
  const cached = recordContentTextCache.get(record);
  if (cached !== undefined) return cached;
  const contentText = record.content.toLowerCase();
  recordContentTextCache.set(record, contentText);
  return contentText;
}

function normalizedVaultPath(path: string) {
  return path.split(sep).join("/");
}

function inferVaultNoteType(notePath: string, frontmatterType?: unknown): AgentMemoryType {
  const haystack = `${notePath} ${typeof frontmatterType === "string" ? frontmatterType : ""}`;
  for (const [pattern, type] of VAULT_NOTE_TYPE_MAP) {
    if (pattern.test(haystack)) return type;
  }
  return "context";
}

function scoreMemory(record: AgentMemoryRecord, input: RecallAgentMemoryInput) {
  const query = input.query?.trim() ?? "";
  const queryWords = textWords(query);
  const haystack = recordSearchText(record);
  const contentText = recordContentText(record);
  const titleText = record.title.toLowerCase();
  const matched = new Set<string>();
  let score = 0;

  if (!query) score += 1;
  if (query && haystack.includes(query.toLowerCase())) {
    score += 30;
    matched.add("exact-query");
  }
  for (const word of queryWords) {
    if (titleText.includes(word)) {
      score += 8;
      matched.add(word);
    }
    if (record.tags.some((tag) => tag.includes(word))) {
      score += 6;
      matched.add(word);
    }
    if (contentText.includes(word)) {
      score += 4;
      matched.add(word);
    }
    if ((record.project ?? "").toLowerCase().includes(word) || (record.source ?? "").toLowerCase().includes(word)) {
      score += 2;
      matched.add(word);
    }
  }

  if (input.type && record.type === normalizeMemoryType(input.type)) score += 10;
  score += Math.round(record.confidence * 10);
  if (record.tags.includes("agent-memory") || record.notePath.startsWith(`${MEMORY_FOLDER}/`)) score += 4;
  if (record.tags.includes("vault-note")) score += 1;
  score += recencyScore(record.createdAt);
  return { score, matched: [...matched] };
}

async function walkMarkdown(root: string, dir = root, output: string[] = []): Promise<string[]> {
  if (output.length >= MAX_MEMORY_FILES) return output;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_MEMORY_FILES) break;
    const fullPath = join(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      await walkMarkdown(root, fullPath, output);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) output.push(fullPath);
  }
  return output;
}

function shouldSkipVaultPath(root: string, fullPath: string, isDirectory: boolean) {
  const rel = normalizedVaultPath(relative(root, fullPath));
  const name = basename(fullPath);
  if (VAULT_NOTE_EXCLUDE_PARTS.has(name)) return true;
  if (name.startsWith(".") && name !== ".") return true;
  if (rel === MEMORY_FOLDER || rel.startsWith(`${MEMORY_FOLDER}/`)) return true;
  if (isDirectory && VAULT_NOTE_EXCLUDE_PREFIXES.some((prefix) => prefix.endsWith("/") && (rel === prefix.slice(0, -1) || rel.startsWith(prefix)))) return true;
  if (!isDirectory && VAULT_NOTE_EXCLUDE_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix))) return true;
  return false;
}

async function walkVaultMarkdown(root: string, dir = root, output: string[] = []): Promise<string[]> {
  if (output.length >= MAX_VAULT_NOTE_FILES) return output;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_VAULT_NOTE_FILES) break;
    const fullPath = join(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      if (!shouldSkipVaultPath(root, fullPath, true)) {
        await walkVaultMarkdown(root, fullPath, output);
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && !shouldSkipVaultPath(root, fullPath, false)) {
      output.push(fullPath);
    }
  }
  return output;
}

function recordFromMarkdown(root: string, file: string, markdown: string): AgentMemoryRecord | null {
  const { fields, body } = parseFrontmatter(markdown);
  if (fields.get("type") !== "agent-memory") return null;
  const memoryType = normalizeMemoryType(String(fields.get("memoryType") ?? "context"));
  const now = new Date().toISOString();
  return {
    id: String(fields.get("id") ?? basename(file, ".md")),
    type: memoryType,
    title: String(fields.get("title") ?? basename(file, ".md")),
    content: bodyContent(body),
    confidence: normalizeConfidence(Number(fields.get("confidence") ?? 0.7)),
    status: fields.get("status") === "superseded" || fields.get("status") === "archived" ? fields.get("status") as AgentMemoryRecord["status"] : "active",
    tags: Array.isArray(fields.get("tags")) ? normalizeTags(fields.get("tags") as string[]) : [],
    source: typeof fields.get("source") === "string" ? String(fields.get("source")) : undefined,
    agentName: typeof fields.get("agentName") === "string" ? String(fields.get("agentName")) : undefined,
    agentId: typeof fields.get("agentId") === "string" ? String(fields.get("agentId")) : undefined,
    runtime: typeof fields.get("runtime") === "string" ? String(fields.get("runtime")) : undefined,
    machineName: typeof fields.get("machineName") === "string" ? String(fields.get("machineName")) : undefined,
    machineId: typeof fields.get("machineId") === "string" ? String(fields.get("machineId")) : undefined,
    tailnetId: typeof fields.get("tailnetId") === "string" ? String(fields.get("tailnetId")) : undefined,
    tailnetName: typeof fields.get("tailnetName") === "string" ? String(fields.get("tailnetName")) : undefined,
    tailnetDnsName: typeof fields.get("tailnetDnsName") === "string" ? String(fields.get("tailnetDnsName")) : undefined,
    collectorUrl: typeof fields.get("collectorUrl") === "string" ? String(fields.get("collectorUrl")) : undefined,
    sessionId: typeof fields.get("sessionId") === "string" ? String(fields.get("sessionId")) : undefined,
    project: typeof fields.get("project") === "string" ? String(fields.get("project")) : undefined,
    createdAt: typeof fields.get("createdAt") === "string" ? String(fields.get("createdAt")) : now,
    updatedAt: typeof fields.get("updatedAt") === "string" ? String(fields.get("updatedAt")) : now,
    notePath: toVaultPath(root, file),
    proofId: typeof fields.get("proofId") === "string" ? String(fields.get("proofId")) : undefined,
    proofStatus: typeof fields.get("proofStatus") === "string" ? fields.get("proofStatus") as GitLawbProofStatus : undefined,
    proofHash: typeof fields.get("proofHash") === "string" ? String(fields.get("proofHash")) : undefined,
    proofPath: typeof fields.get("proofPath") === "string" ? String(fields.get("proofPath")) : undefined,
    actorDid: typeof fields.get("actorDid") === "string" ? String(fields.get("actorDid")) : undefined,
  };
}

function recordFromVaultMarkdown(root: string, file: string, markdown: string, mtimeMs: number): AgentMemoryRecord | null {
  const notePath = toVaultPath(root, file);
  const { fields, body } = parseFrontmatter(markdown);
  const title = String(fields.get("title") ?? body.match(/^#\s+(.+)$/m)?.[1] ?? basename(file, ".md")).trim();
  const content = bodyContent(body) || markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!content) return null;
  const frontmatterType = fields.get("type");
  const memoryType = inferVaultNoteType(notePath, frontmatterType);
  const updatedAt = new Date(mtimeMs || Date.now()).toISOString();
  const rawTags = fields.get("tags");
  const tags = [
    "vault-note",
    ...notePath.split("/").slice(0, 3).map((part) => part.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")),
    ...(Array.isArray(rawTags) ? rawTags : []),
  ].filter((tag): tag is string => typeof tag === "string");
  return {
    id: `vault-${sha256(notePath).replace(/^sha256:/, "").slice(0, 16)}`,
    type: memoryType,
    title,
    content,
    confidence: 0.62,
    status: "active",
    tags: normalizeTags(tags),
    source: `Vault note: ${notePath}`,
    project: notePath.startsWith("Projects/") ? notePath.split("/")[1] : undefined,
    createdAt: typeof fields.get("created") === "string" ? String(fields.get("created")) : updatedAt,
    updatedAt,
    notePath,
  };
}

function cleanIndexString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordFromIndexEntry(entry: AgentMemoryIndexEntry): AgentMemoryRecord | null {
  if (entry.action !== "remember") return null;
  const id = cleanIndexString(entry.id);
  const title = cleanIndexString(entry.title);
  const content = cleanIndexString(entry.content);
  const notePath = cleanIndexString(entry.notePath);
  if (!id || !title || !content || !notePath) return null;
  const memoryType = normalizeMemoryType(entry.memoryType);
  const now = new Date().toISOString();
  const status = entry.status === "superseded" || entry.status === "archived" ? entry.status : "active";
  return {
    id,
    type: memoryType,
    title,
    content,
    confidence: normalizeConfidence(Number(entry.confidence ?? 0.7)),
    status,
    tags: Array.isArray(entry.tags) ? normalizeTags(entry.tags) : [],
    source: cleanIndexString(entry.source),
    agentName: cleanIndexString(entry.agentName),
    agentId: cleanIndexString(entry.agentId),
    runtime: cleanIndexString(entry.runtime),
    machineName: cleanIndexString(entry.machineName),
    machineId: cleanIndexString(entry.machineId),
    tailnetId: cleanIndexString(entry.tailnetId),
    tailnetName: cleanIndexString(entry.tailnetName),
    tailnetDnsName: cleanIndexString(entry.tailnetDnsName),
    collectorUrl: cleanIndexString(entry.collectorUrl),
    sessionId: cleanIndexString(entry.sessionId),
    project: cleanIndexString(entry.project),
    createdAt: cleanIndexString(entry.createdAt) ?? now,
    updatedAt: cleanIndexString(entry.updatedAt) ?? now,
    notePath,
    proofId: cleanIndexString(entry.proofId),
    proofStatus: typeof entry.proofStatus === "string" ? entry.proofStatus : undefined,
    proofHash: cleanIndexString(entry.proofHash),
    proofPath: cleanIndexString(entry.proofPath),
    actorDid: cleanIndexString(entry.actorDid),
  };
}

function indexEntryForRecord(record: AgentMemoryRecord) {
  return {
    timestamp: new Date().toISOString(),
    action: "remember",
    id: record.id,
    memoryType: record.type,
    title: record.title,
    content: record.content,
    status: record.status,
    notePath: record.notePath,
    confidence: record.confidence,
    tags: record.tags,
    source: record.source,
    agentName: record.agentName,
    agentId: record.agentId,
    runtime: record.runtime,
    machineName: record.machineName,
    machineId: record.machineId,
    tailnetId: record.tailnetId,
    tailnetName: record.tailnetName,
    tailnetDnsName: record.tailnetDnsName,
    collectorUrl: record.collectorUrl,
    sessionId: record.sessionId,
    project: record.project,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    proofId: record.proofId,
    proofStatus: record.proofStatus,
    proofHash: record.proofHash,
    proofPath: record.proofPath,
    actorDid: record.actorDid,
  };
}

async function readMemoryRecordsFromIndex(root: string) {
  const file = join(root, INDEX_PATH);
  assertInside(root, file);
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) return null;
  const cached = memoryIndexCache.get(root);
  if (cached && cached.file === file && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.records;
  }
  const raw = await readFile(file, "utf8").catch(() => "");
  const byId = new Map<string, AgentMemoryRecord>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = recordFromIndexEntry(JSON.parse(line) as AgentMemoryIndexEntry);
      if (record) byId.set(record.id, record);
    } catch {
      // Ignore corrupt append lines; markdown fallback still exists when no index records are usable.
    }
  }
  const records = [...byId.values()];
  memoryIndexCache.set(root, { file, mtimeMs: st.mtimeMs, size: st.size, records });
  return records.length ? records : null;
}

async function readMemoryRecordsFromMarkdown(root: string) {
  const folder = join(root, MEMORY_FOLDER);
  const files = await walkMarkdown(root, folder);
  const records: AgentMemoryRecord[] = [];
  for (const file of files) {
    const st = await stat(file).catch(() => null);
    if (!st || st.size > MAX_MEMORY_BYTES) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const record = recordFromMarkdown(root, file, markdown);
    if (record) records.push(record);
  }
  return records;
}

async function readVaultNoteRecords(root: string) {
  const cached = vaultRecordsCache.get(root);
  if (cached && Date.now() - cached.cachedAt <= VAULT_RECORD_CACHE_TTL_MS) return cached.records;
  const files = await walkVaultMarkdown(root);
  const records: AgentMemoryRecord[] = [];
  for (const file of files) {
    const st = await stat(file).catch(() => null);
    if (!st || st.size > MAX_VAULT_NOTE_BYTES) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const record = recordFromVaultMarkdown(root, file, markdown, st.mtimeMs);
    if (record) records.push(record);
  }
  vaultRecordsCache.set(root, { cachedAt: Date.now(), records });
  return records;
}

async function readMemoryRecords(root: string) {
  const indexedRecords = await readMemoryRecordsFromIndex(root);
  if (indexedRecords?.length) return indexedRecords;
  return readMemoryRecordsFromMarkdown(root);
}

async function readFullVaultRecords(root: string, memoryRecords: AgentMemoryRecord[]) {
  const vaultRecords = await readVaultNoteRecords(root);
  const byPath = new Map<string, AgentMemoryRecord>();
  for (const record of vaultRecords) byPath.set(record.notePath, record);
  for (const record of memoryRecords) byPath.set(record.notePath, record);
  return [...byPath.values()];
}

function normalizeRecallScope(value?: string) {
  const scope = value?.trim().toLowerCase();
  if (scope === "agent-memory" || scope === "memory" || scope === "typed") return "agent-memory";
  if (scope === "full-vault" || scope === "full" || scope === "vault" || scope === "all") return "full-vault";
  return "tiered";
}

function hitsFromRecords(records: AgentMemoryRecord[], input: RecallAgentMemoryInput, limit: number) {
  const type = input.type ? normalizeMemoryType(input.type) : null;
  const tags = normalizeTags(input.tags);
  const project = input.project?.trim().toLowerCase();
  return records
    .filter((record) => input.includeArchived || record.status === "active")
    .filter((record) => !type || record.type === type)
    .filter((record) => !project || record.project?.toLowerCase() === project)
    .filter((record) => !tags.length || tags.every((tag) => record.tags.includes(tag)))
    .map((record) => {
      const scored = scoreMemory(record, input);
      return {
        ...record,
        score: scored.score,
        matched: scored.matched,
        excerpt: compactContent(record.content, 320),
      };
    })
    .filter((hit) => !input.query?.trim() || hit.matched.length > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

function shouldUseDistilledMemoryOnly(input: RecallAgentMemoryInput, hits: AgentMemoryHit[]) {
  if (!input.query?.trim()) return true;
  const topHit = hits[0];
  if (!topHit) return false;
  if (!topHit.matched.length) return false;
  if (topHit.score >= TIERED_MEMORY_STRONG_SCORE) return true;
  return topHit.score >= TIERED_MEMORY_USABLE_SCORE && topHit.confidence >= TIERED_MEMORY_HIGH_CONFIDENCE && topHit.matched.length >= 2;
}

function memoryMarkdown(record: AgentMemoryRecord) {
  return [
    frontmatter({
      type: "agent-memory",
      id: record.id,
      memoryType: record.type,
      title: record.title,
      status: record.status,
      confidence: record.confidence,
      tags: record.tags,
      source: record.source,
      agentName: record.agentName,
      agentId: record.agentId,
      runtime: record.runtime,
      machineName: record.machineName,
      machineId: record.machineId,
      tailnetId: record.tailnetId,
      tailnetName: record.tailnetName,
      tailnetDnsName: record.tailnetDnsName,
      collectorUrl: record.collectorUrl,
      sessionId: record.sessionId,
      project: record.project,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      proofId: record.proofId,
      proofStatus: record.proofStatus,
      proofHash: record.proofHash,
      proofPath: record.proofPath,
      actorDid: record.actorDid,
    }),
    "",
    `# ${record.title}`,
    "",
    record.content.trim(),
    "",
    "## Metadata",
    "",
    `- Type: ${record.type}`,
    `- Confidence: ${record.confidence.toFixed(2)}`,
    record.source ? `- Source: ${record.source}` : "",
    record.agentName ? `- Agent: ${record.agentName}` : "",
    record.machineName ? `- Machine: ${record.machineName}` : "",
    record.machineId ? `- Machine ID: ${record.machineId}` : "",
    record.tailnetId ? `- Tailnet ID: ${record.tailnetId}` : "",
    record.tailnetName ? `- Tailnet Name: ${record.tailnetName}` : "",
    record.tailnetDnsName ? `- Tailnet DNS: ${record.tailnetDnsName}` : "",
    record.collectorUrl ? `- Collector URL: ${record.collectorUrl}` : "",
    record.project ? `- Project: ${record.project}` : "",
    record.proofId ? `- GitLawb Memory Proof: ${record.proofId}` : "",
    record.proofStatus ? `- Proof Status: ${record.proofStatus}` : "",
    record.actorDid ? `- Actor DID: ${record.actorDid}` : "",
    record.proofHash ? `- Proof Hash: ${record.proofHash}` : "",
    "",
  ].filter((line) => line !== "").join("\n");
}

async function appendIndex(root: string, record: AgentMemoryRecord) {
  const file = join(root, INDEX_PATH);
  assertInside(root, file);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(indexEntryForRecord(record))}\n`, "utf8");
}

async function readPreviousProofHash(root: string) {
  const file = join(root, PROOF_INDEX_PATH);
  assertInside(root, file);
  const raw = await readFile(file, "utf8").catch(() => "");
  const lastLine = raw.trim().split("\n").filter(Boolean).at(-1);
  if (!lastLine) return undefined;
  try {
    const parsed = JSON.parse(lastLine) as { proofHash?: unknown; metadata?: { proofHash?: unknown } };
    return typeof parsed.proofHash === "string"
      ? parsed.proofHash
      : typeof parsed.metadata?.proofHash === "string"
        ? parsed.metadata.proofHash
        : undefined;
  } catch {
    return sha256(lastLine);
  }
}

function memoryRecordHash(record: AgentMemoryRecord) {
  return sha256(canonicalJson({
    id: record.id,
    type: record.type,
    title: record.title,
    contentHash: sha256(record.content.trim()),
    confidence: record.confidence,
    status: record.status,
    tags: record.tags,
    source: record.source,
    agentName: record.agentName,
    agentId: record.agentId,
    runtime: record.runtime,
    machineName: record.machineName,
    machineId: record.machineId,
    tailnetId: record.tailnetId,
    tailnetName: record.tailnetName,
    tailnetDnsName: record.tailnetDnsName,
    collectorUrl: record.collectorUrl,
    sessionId: record.sessionId,
    project: record.project,
    createdAt: record.createdAt,
    notePath: record.notePath,
  }));
}

async function safeGitLawbStatus(): Promise<GitLawbStatus | null> {
  try {
    return await readGitLawbStatus({ cache: true });
  } catch {
    return null;
  }
}

function proofStatusForGitLawb(status: GitLawbStatus | null): GitLawbProofStatus {
  if (status?.identity.did) return "verified";
  if (status?.cli.installed) return "ready";
  return "unavailable";
}

async function createMemoryProofReceipt(root: string, record: AgentMemoryRecord): Promise<AgentMemoryProofReceipt> {
  const [status, previousProofHash] = await Promise.all([
    safeGitLawbStatus(),
    readPreviousProofHash(root),
  ]);
  const actorDid = status?.identity.did;
  const checkedAt = new Date().toISOString();
  const contentHash = sha256(record.content.trim());
  const recordHash = memoryRecordHash(record);
  const proofId = `gitlawb-memory-${record.id}`;
  const proofStatus = proofStatusForGitLawb(status);
  const metadata: AgentMemoryProofReceipt["metadata"] = {
    source: "agent-memory",
    memoryId: record.id,
    memoryType: record.type,
    memoryTitle: record.title,
    notePath: record.notePath,
    contentHash,
    recordHash,
    previousProofHash,
    agentName: record.agentName,
    agentId: record.agentId,
    runtime: record.runtime,
    machineName: record.machineName,
    machineId: record.machineId,
    tailnetId: record.tailnetId,
    tailnetName: record.tailnetName,
    tailnetDnsName: record.tailnetDnsName,
    collectorUrl: record.collectorUrl,
    sessionId: record.sessionId,
    project: record.project,
    createdAt: record.createdAt,
    checkedAt,
    gitlawbCliInstalled: Boolean(status?.cli.installed),
    gitlawbNodeBindMode: status?.node.bindMode,
    gitlawbNodeHealthy: status?.node.healthy,
    error: actorDid ? undefined : status?.identity.error ?? status?.cli.error ?? "GitLawb DID is not available; receipt is locally chained but not DID-backed.",
  };
  const baseReceipt: AgentMemoryProofReceipt = sanitizeGitLawbProof({
    id: proofId,
    kind: "agent-memory",
    status: proofStatus,
    actorDid,
    title: record.title,
    verifiedAt: actorDid ? Date.now() : undefined,
    error: metadata.error,
    metadata,
  }) as AgentMemoryProofReceipt;
  const proofHash = sha256(canonicalJson(baseReceipt));
  return sanitizeGitLawbProof({
    ...baseReceipt,
    metadata: {
      ...baseReceipt.metadata,
      proofHash,
    },
  }) as AgentMemoryProofReceipt;
}

async function appendProof(root: string, receipt: AgentMemoryProofReceipt) {
  const file = join(root, PROOF_INDEX_PATH);
  assertInside(root, file);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...receipt,
    proofHash: receipt.metadata.proofHash,
  })}\n`, "utf8");
  return toVaultPath(root, file);
}

export async function rebuildAgentMemoryIndex(input: RebuildAgentMemoryIndexInput = {}) {
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);
  const records = await readMemoryRecordsFromMarkdown(root);
  const file = join(root, INDEX_PATH);
  assertInside(root, file);
  await mkdir(dirname(file), { recursive: true });
  const startedAt = new Date().toISOString();
  const lines = records.map((record) => JSON.stringify({
    ...indexEntryForRecord(record),
    indexedFrom: "markdown-rebuild",
    rebuiltAt: startedAt,
  }));
  await appendFile(file, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  memoryIndexCache.delete(root);
  const st = await stat(file).catch(() => null);
  return {
    vaultPath: root,
    indexPath: INDEX_PATH,
    scanned: records.length,
    appended: lines.length,
    bytes: st?.size ?? 0,
    rebuiltAt: startedAt,
  };
}

export async function rememberAgentMemory(input: RememberAgentMemoryInput) {
  const content = input.content?.trim();
  if (!content) throw new Error("Memory content is required.");
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);
  const type = normalizeMemoryType(input.type);
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(`${type}\n${content}`).digest("hex").slice(0, 10);
  const title = input.title?.trim() || compactContent(content, 80);
  const id = `mem-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${hash}`;
  const folder = join(root, MEMORY_FOLDER, type);
  const file = join(folder, `${now.slice(0, 10)}-${safeSlug(title)}-${hash}.md`);
  assertInside(root, file);
  await mkdir(folder, { recursive: true });

  const record: AgentMemoryRecord = {
    id,
    type,
    title,
    content,
    confidence: normalizeConfidence(input.confidence),
    status: "active",
    tags: normalizeTags(input.tags),
    source: input.source?.trim() || undefined,
    agentName: input.agentName?.trim() || undefined,
    agentId: input.agentId?.trim() || undefined,
    runtime: input.runtime?.trim() || undefined,
    machineName: input.machineName?.trim() || undefined,
    machineId: input.machineId?.trim() || undefined,
    tailnetId: input.tailnetId?.trim() || undefined,
    tailnetName: input.tailnetName?.trim() || undefined,
    tailnetDnsName: input.tailnetDnsName?.trim() || undefined,
    collectorUrl: input.collectorUrl?.trim() || undefined,
    sessionId: input.sessionId?.trim() || undefined,
    project: input.project?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    notePath: toVaultPath(root, file),
  };

  const possibleConflicts = (await recallAgentMemory({
    vaultPath: input.vaultPath,
    query: content,
    type,
    limit: 5,
    scope: "agent-memory",
  })).hits.filter((hit) => hit.score >= 24);

  const proofReceipt = shouldWriteProof(type, record.confidence, input.proof)
    ? await createMemoryProofReceipt(root, record)
    : undefined;
  if (proofReceipt) {
    record.proofId = proofReceipt.id;
    record.proofStatus = proofReceipt.status;
    record.proofHash = proofReceipt.metadata.proofHash;
    record.proofPath = PROOF_INDEX_PATH;
    record.actorDid = proofReceipt.actorDid;
  }

  await writeFile(file, memoryMarkdown(record), { encoding: "utf8", mode: 0o600 });
  if (proofReceipt) {
    record.proofPath = await appendProof(root, proofReceipt);
  }
  await appendIndex(root, record);
  return { vaultPath: root, record, possibleConflicts, proof: proofReceipt };
}

export async function recallAgentMemory(input: RecallAgentMemoryInput = {}) {
  const root = resolveObsidianVaultPath(input.vaultPath);
  await access(root, constants.R_OK);
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 8)), 1), 50);
  const scope = normalizeRecallScope(input.scope);
  const memoryRecords = await readMemoryRecords(root);
  const memoryHits = hitsFromRecords(memoryRecords, input, limit);
  if (scope === "agent-memory" || (scope === "tiered" && shouldUseDistilledMemoryOnly(input, memoryHits))) {
    return {
      vaultPath: root,
      query: input.query?.trim() || "",
      recallScope: "agent-memory",
      augmentedFromVault: false,
      hits: memoryHits,
    };
  }
  const records = await readFullVaultRecords(root, memoryRecords);
  const hits = hitsFromRecords(records, input, limit);
  return {
    vaultPath: root,
    query: input.query?.trim() || "",
    recallScope: "full-vault",
    augmentedFromVault: scope === "tiered",
    memoryHitCount: memoryHits.length,
    hits,
  };
}

export async function answerFromAgentMemory(input: RecallAgentMemoryInput = {}) {
  const result = await recallAgentMemory(input);
  const answer = result.hits.length
    ? [
      `Found ${result.hits.length} relevant shared-brain memor${result.hits.length === 1 ? "y/note" : "ies/notes"}.`,
      ...result.hits.slice(0, 6).map((hit, index) => `${index + 1}. ${hit.title} (${hit.type}, confidence ${hit.confidence.toFixed(2)}, score ${hit.score}) - ${hit.excerpt}`),
    ].join("\n")
    : "No matching shared-brain memories or vault notes were found.";
  const context = result.hits.map((hit, index) => [
    `Memory ${index + 1}: ${hit.title}`,
    `Type: ${hit.type}`,
    `Path: ${hit.notePath}`,
    `Confidence: ${hit.confidence.toFixed(2)}`,
    hit.agentName ? `Agent: ${hit.agentName}` : "",
    hit.machineName ? `Machine: ${hit.machineName}` : "",
    hit.machineId ? `Machine ID: ${hit.machineId}` : "",
    hit.tailnetId ? `Tailnet ID: ${hit.tailnetId}` : "",
    hit.tailnetName ? `Tailnet Name: ${hit.tailnetName}` : "",
    hit.tailnetDnsName ? `Tailnet DNS: ${hit.tailnetDnsName}` : "",
    hit.collectorUrl ? `Collector URL: ${hit.collectorUrl}` : "",
    hit.proofId ? `GitLawb Memory Proof: ${hit.proofId}` : "",
    hit.proofStatus ? `Proof Status: ${hit.proofStatus}` : "",
    hit.actorDid ? `Actor DID: ${hit.actorDid}` : "",
    hit.proofHash ? `Proof Hash: ${hit.proofHash}` : "",
    `Created: ${hit.createdAt}`,
    `Content: ${hit.excerpt}`,
  ].filter(Boolean).join("\n")).join("\n\n");
  return { ...result, answer, context };
}
