import { constants } from "fs";
import { access, appendFile, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { readGitLawbStatus, sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import { rebuildFullVaultSearchIndex, searchFullVaultSearchIndex } from "@/lib/services/obsidian/full-vault-search-index";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { listFilesMatchingTerms, searchTermsFromQuery } from "@/lib/services/search/ripgrep-search";
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

export const AGENT_MEMORY_COGNITIVE_STAGES = ["system1", "system2"] as const;
export type AgentMemoryCognitiveStage = (typeof AGENT_MEMORY_COGNITIVE_STAGES)[number];

export const AGENT_MEMORY_EVOLUTION_TYPES = ["override", "supplement", "temporal", "negate", "conflict"] as const;
export type AgentMemoryEvolutionType = (typeof AGENT_MEMORY_EVOLUTION_TYPES)[number];

export const AGENT_MEMORY_SOURCE_TYPES = ["explicit", "inferred", "composite"] as const;
export type AgentMemorySourceType = (typeof AGENT_MEMORY_SOURCE_TYPES)[number];

export type AgentMemoryChainItem = {
  id: string;
  title: string;
  content: string;
  status: AgentMemoryRecord["status"];
  notePath: string;
  createdAt: string;
  updatedAt: string;
  cognitiveStage?: AgentMemoryCognitiveStage;
  evolutionType?: AgentMemoryEvolutionType;
  evolutionReason?: string;
};

export type AgentMemoryRecord = {
  id: string;
  type: AgentMemoryType;
  title: string;
  content: string;
  confidence: number;
  status: "active" | "superseded" | "archived";
  cognitiveStage?: AgentMemoryCognitiveStage;
  supersedes?: string[];
  supersededBy?: string[];
  evolutionRootId?: string;
  evolutionType?: AgentMemoryEvolutionType;
  evolutionReason?: string;
  evidenceCount?: number;
  sourceType?: AgentMemorySourceType;
  metaTags?: string[];
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
  searchScore?: number;
  searchCollection?: string;
};

export type AgentMemoryProofMode = boolean | "auto";

export type AgentMemoryHit = AgentMemoryRecord & {
  score: number;
  matched: string[];
  excerpt: string;
  evolutionChain?: AgentMemoryChainItem[];
};

export type RememberAgentMemoryInput = {
  vaultPath?: string;
  type?: string;
  title?: string;
  content?: string;
  confidence?: number;
  cognitiveStage?: string;
  evidenceCount?: number;
  sourceType?: string;
  metaTags?: string[];
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

export type EvolveAgentMemoryInput = RememberAgentMemoryInput & {
  memoryId?: string;
  supersedes?: string[];
  evolutionType?: string;
  evolutionReason?: string;
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
  includeFullVault?: boolean;
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
const VALID_COGNITIVE_STAGES = new Set<AgentMemoryCognitiveStage>(AGENT_MEMORY_COGNITIVE_STAGES);
const VALID_EVOLUTION_TYPES = new Set<AgentMemoryEvolutionType>(AGENT_MEMORY_EVOLUTION_TYPES);
const VALID_SOURCE_TYPES = new Set<AgentMemorySourceType>(AGENT_MEMORY_SOURCE_TYPES);
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
    cognitiveStage?: AgentMemoryCognitiveStage;
    supersedes?: string[];
    supersededBy?: string[];
    evolutionRootId?: string;
    evolutionType?: AgentMemoryEvolutionType;
    evolutionReason?: string;
    evidenceCount?: number;
    sourceType?: AgentMemorySourceType;
    metaTags?: string[];
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
  cognitiveStage?: string;
  supersedes?: string[];
  supersededBy?: string[];
  evolutionRootId?: string;
  evolutionType?: string;
  evolutionReason?: string;
  evidenceCount?: number;
  sourceType?: string;
  metaTags?: string[];
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

function normalizeCognitiveStage(value?: string, fallback: AgentMemoryCognitiveStage = "system1") {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || fallback;
  if (!VALID_COGNITIVE_STAGES.has(normalized as AgentMemoryCognitiveStage)) {
    throw new Error(`Unsupported memory cognitive stage "${value}". Use one of: ${AGENT_MEMORY_COGNITIVE_STAGES.join(", ")}.`);
  }
  return normalized as AgentMemoryCognitiveStage;
}

function normalizeEvolutionType(value?: string) {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z]+/g, "-");
  if (!VALID_EVOLUTION_TYPES.has(normalized as AgentMemoryEvolutionType)) {
    throw new Error(`Unsupported memory evolution type "${value}". Use one of: ${AGENT_MEMORY_EVOLUTION_TYPES.join(", ")}.`);
  }
  return normalized as AgentMemoryEvolutionType;
}

function normalizeSourceType(value?: string) {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z]+/g, "-");
  if (!VALID_SOURCE_TYPES.has(normalized as AgentMemorySourceType)) {
    throw new Error(`Unsupported memory source type "${value}". Use one of: ${AGENT_MEMORY_SOURCE_TYPES.join(", ")}.`);
  }
  return normalized as AgentMemorySourceType;
}

function normalizeEvidenceCount(value?: number) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error("Memory evidenceCount must be a positive integer.");
  return Math.max(1, Math.trunc(value));
}

function normalizeTags(values?: string[]) {
  return [...new Set((values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9][a-z0-9/_-]{0,48}$/.test(value)))]
    .slice(0, 12);
}

function normalizeMemoryIds(values?: string[]) {
  return [...new Set((values ?? [])
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9._:-]{3,128}$/.test(value)))]
    .slice(0, 24);
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
    record.cognitiveStage,
    record.evolutionType,
    record.evolutionReason,
    record.sourceType,
    record.tags.join(" "),
    record.metaTags?.join(" "),
    record.supersedes?.join(" "),
    record.supersededBy?.join(" "),
    record.evolutionRootId,
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
  if (record.searchScore) score += Math.min(30, Math.max(0, Math.round(record.searchScore)));
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
    cognitiveStage: typeof fields.get("cognitiveStage") === "string" ? normalizeCognitiveStage(String(fields.get("cognitiveStage"))) : undefined,
    supersedes: normalizeMemoryIds(cleanStringArray(fields.get("supersedes"))),
    supersededBy: normalizeMemoryIds(cleanStringArray(fields.get("supersededBy"))),
    evolutionRootId: typeof fields.get("evolutionRootId") === "string" ? String(fields.get("evolutionRootId")) : undefined,
    evolutionType: typeof fields.get("evolutionType") === "string" ? normalizeEvolutionType(String(fields.get("evolutionType"))) : undefined,
    evolutionReason: typeof fields.get("evolutionReason") === "string" ? String(fields.get("evolutionReason")) : undefined,
    evidenceCount: typeof fields.get("evidenceCount") === "number" ? normalizeEvidenceCount(Number(fields.get("evidenceCount"))) : undefined,
    sourceType: typeof fields.get("sourceType") === "string" ? normalizeSourceType(String(fields.get("sourceType"))) : undefined,
    metaTags: normalizeTags(cleanStringArray(fields.get("metaTags"))),
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

function cleanStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : undefined;
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
    cognitiveStage: entry.cognitiveStage ? normalizeCognitiveStage(entry.cognitiveStage) : undefined,
    supersedes: normalizeMemoryIds(entry.supersedes),
    supersededBy: normalizeMemoryIds(entry.supersededBy),
    evolutionRootId: cleanIndexString(entry.evolutionRootId),
    evolutionType: entry.evolutionType ? normalizeEvolutionType(entry.evolutionType) : undefined,
    evolutionReason: cleanIndexString(entry.evolutionReason),
    evidenceCount: entry.evidenceCount === undefined ? undefined : normalizeEvidenceCount(Number(entry.evidenceCount)),
    sourceType: entry.sourceType ? normalizeSourceType(entry.sourceType) : undefined,
    metaTags: Array.isArray(entry.metaTags) ? normalizeTags(entry.metaTags) : [],
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
    cognitiveStage: record.cognitiveStage,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    evolutionRootId: record.evolutionRootId,
    evolutionType: record.evolutionType,
    evolutionReason: record.evolutionReason,
    evidenceCount: record.evidenceCount,
    sourceType: record.sourceType,
    metaTags: record.metaTags,
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

async function candidateVaultFiles(root: string, query?: string): Promise<string[]> {
  // Strict search policy: shortlist candidate notes with ripgrep (grep
  // fallback) so query recalls don't read the whole vault; only fall back to
  // the full fs walk when no search binary is usable or there is no query.
  const terms = searchTermsFromQuery(query);
  if (terms.length) {
    const matched = await listFilesMatchingTerms({ root, terms, maxResults: MAX_VAULT_NOTE_FILES })
      .catch(() => null);
    if (matched) {
      return matched.filter((file) => {
        assertInside(root, file);
        return !shouldSkipVaultPath(root, file, false);
      });
    }
  }
  return walkVaultMarkdown(root);
}

async function readVaultNoteRecords(root: string, query?: string) {
  const cacheKey = `${root}::${searchTermsFromQuery(query).join(" ")}`;
  const cached = vaultRecordsCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt <= VAULT_RECORD_CACHE_TTL_MS) return cached.records;
  const indexed = query?.trim()
    ? await searchFullVaultSearchIndex({ root, query, limit: 400 }).catch(() => null)
    : null;
  if (indexed?.hits.length) {
    const records: AgentMemoryRecord[] = [];
    for (const hit of indexed.hits) {
      const file = join(root, hit.path);
      assertInside(root, file);
      if (shouldSkipVaultPath(root, file, false)) continue;
      const st = await stat(file).catch(() => null);
      if (!st || st.size > MAX_VAULT_NOTE_BYTES) continue;
      const markdown = await readFile(file, "utf8").catch(() => "");
      const record = recordFromVaultMarkdown(root, file, markdown, st.mtimeMs);
      if (record) {
        record.searchScore = hit.score;
        record.searchCollection = hit.collection;
        records.push(record);
      }
    }
    vaultRecordsCache.set(cacheKey, { cachedAt: Date.now(), records });
    return records;
  }
  const files = await candidateVaultFiles(root, query);
  const records: AgentMemoryRecord[] = [];
  for (const file of files) {
    const st = await stat(file).catch(() => null);
    if (!st || st.size > MAX_VAULT_NOTE_BYTES) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const record = recordFromVaultMarkdown(root, file, markdown, st.mtimeMs);
    if (record) records.push(record);
  }
  vaultRecordsCache.set(cacheKey, { cachedAt: Date.now(), records });
  return records;
}

async function readMemoryRecords(root: string) {
  const indexedRecords = await readMemoryRecordsFromIndex(root);
  if (indexedRecords?.length) return indexedRecords;
  return readMemoryRecordsFromMarkdown(root);
}

async function readFullVaultRecords(root: string, memoryRecords: AgentMemoryRecord[], query?: string) {
  const vaultRecords = await readVaultNoteRecords(root, query);
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

function chainItemForRecord(record: AgentMemoryRecord): AgentMemoryChainItem {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    status: record.status,
    notePath: record.notePath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cognitiveStage: record.cognitiveStage,
    evolutionType: record.evolutionType,
    evolutionReason: record.evolutionReason,
  };
}

function traceEvolutionChain(record: AgentMemoryRecord, byId: Map<string, AgentMemoryRecord>, visited = new Set<string>()): AgentMemoryRecord[] {
  if (visited.has(record.id)) return [];
  visited.add(record.id);
  const ancestors = (record.supersedes ?? [])
    .map((id) => byId.get(id))
    .filter((ancestor): ancestor is AgentMemoryRecord => Boolean(ancestor))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .flatMap((ancestor) => traceEvolutionChain(ancestor, byId, visited));
  return [record, ...ancestors];
}

function attachEvolutionChains(hits: AgentMemoryHit[], memoryRecords: AgentMemoryRecord[]) {
  const byId = new Map(memoryRecords.map((record) => [record.id, record]));
  return hits.map((hit) => {
    const sourceRecord = byId.get(hit.id);
    if (!sourceRecord) return hit;
    const chain = traceEvolutionChain(sourceRecord, byId);
    if (chain.length <= 1) return hit;
    return {
      ...hit,
      evolutionChain: chain.map(chainItemForRecord),
    };
  });
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
      cognitiveStage: record.cognitiveStage,
      supersedes: record.supersedes,
      supersededBy: record.supersededBy,
      evolutionRootId: record.evolutionRootId,
      evolutionType: record.evolutionType,
      evolutionReason: record.evolutionReason,
      evidenceCount: record.evidenceCount,
      sourceType: record.sourceType,
      metaTags: record.metaTags,
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
    record.cognitiveStage ? `- Cognitive Stage: ${record.cognitiveStage}` : "",
    record.evolutionType ? `- Evolution Type: ${record.evolutionType}` : "",
    record.evolutionReason ? `- Evolution Reason: ${record.evolutionReason}` : "",
    record.evolutionRootId ? `- Evolution Root: ${record.evolutionRootId}` : "",
    record.supersedes?.length ? `- Supersedes: ${record.supersedes.join(", ")}` : "",
    record.supersededBy?.length ? `- Superseded By: ${record.supersededBy.join(", ")}` : "",
    record.evidenceCount ? `- Evidence Count: ${record.evidenceCount}` : "",
    record.sourceType ? `- Source Type: ${record.sourceType}` : "",
    record.metaTags?.length ? `- Meta Tags: ${record.metaTags.join(", ")}` : "",
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
    cognitiveStage: record.cognitiveStage,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    evolutionRootId: record.evolutionRootId,
    evolutionType: record.evolutionType,
    evolutionReason: record.evolutionReason,
    evidenceCount: record.evidenceCount,
    sourceType: record.sourceType,
    metaTags: record.metaTags,
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
    cognitiveStage: record.cognitiveStage,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    evolutionRootId: record.evolutionRootId,
    evolutionType: record.evolutionType,
    evolutionReason: record.evolutionReason,
    evidenceCount: record.evidenceCount,
    sourceType: record.sourceType,
    metaTags: record.metaTags,
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
  const [st, fullVaultIndex] = await Promise.all([
    stat(file).catch(() => null),
    input.includeFullVault === false ? Promise.resolve(undefined) : rebuildFullVaultSearchIndex({ root }),
  ]);
  return {
    vaultPath: root,
    indexPath: INDEX_PATH,
    scanned: records.length,
    appended: lines.length,
    bytes: st?.size ?? 0,
    fullVaultIndex,
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
    cognitiveStage: normalizeCognitiveStage(input.cognitiveStage),
    evidenceCount: normalizeEvidenceCount(input.evidenceCount),
    sourceType: normalizeSourceType(input.sourceType),
    metaTags: normalizeTags(input.metaTags),
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

function requireSupersededRecords(records: AgentMemoryRecord[], input: EvolveAgentMemoryInput) {
  const ids = normalizeMemoryIds([
    ...(input.supersedes ?? []),
    ...(input.memoryId ? [input.memoryId] : []),
  ]);
  if (!ids.length) throw new Error("evolve requires memoryId or supersedes.");
  const byId = new Map(records.map((record) => [record.id, record]));
  const selected = ids.map((id) => byId.get(id));
  const missing = ids.filter((id, index) => !selected[index]);
  if (missing.length) throw new Error(`Could not find memory id${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  return selected.filter((record): record is AgentMemoryRecord => Boolean(record));
}

function mergeEvolutionTags(input: EvolveAgentMemoryInput, previous: AgentMemoryRecord[]) {
  return normalizeTags([
    ...previous.flatMap((record) => record.tags),
    ...(input.tags ?? []),
    "evolved",
  ]);
}

export async function evolveAgentMemory(input: EvolveAgentMemoryInput) {
  const content = input.content?.trim();
  if (!content) throw new Error("Evolved memory content is required.");
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);
  const memoryRecords = await readMemoryRecords(root);
  const previousRecords = requireSupersededRecords(memoryRecords, input);
  const primary = previousRecords[0];
  const type = input.type ? normalizeMemoryType(input.type) : primary.type;
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(`${type}\n${content}`).digest("hex").slice(0, 10);
  const title = input.title?.trim() || primary.title || compactContent(content, 80);
  const id = `mem-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${hash}`;
  const folder = join(root, MEMORY_FOLDER, type);
  const file = join(folder, `${now.slice(0, 10)}-${safeSlug(title)}-${hash}.md`);
  assertInside(root, file);
  await mkdir(folder, { recursive: true });

  const previousIds = previousRecords.map((record) => record.id);
  const record: AgentMemoryRecord = {
    id,
    type,
    title,
    content,
    confidence: normalizeConfidence(input.confidence ?? Math.max(...previousRecords.map((item) => item.confidence), 0.7)),
    status: "active",
    cognitiveStage: normalizeCognitiveStage(input.cognitiveStage, "system2"),
    supersedes: previousIds,
    evolutionRootId: primary.evolutionRootId || primary.id,
    evolutionType: normalizeEvolutionType(input.evolutionType) ?? "override",
    evolutionReason: input.evolutionReason?.trim() || undefined,
    evidenceCount: normalizeEvidenceCount(input.evidenceCount) ?? previousRecords.reduce((sum, item) => sum + (item.evidenceCount ?? 1), 0),
    sourceType: normalizeSourceType(input.sourceType) ?? "composite",
    metaTags: normalizeTags([...(primary.metaTags ?? []), ...(input.metaTags ?? []), "recently_changed"]),
    tags: mergeEvolutionTags(input, previousRecords),
    source: input.source?.trim() || primary.source,
    agentName: input.agentName?.trim() || primary.agentName,
    agentId: input.agentId?.trim() || primary.agentId,
    runtime: input.runtime?.trim() || primary.runtime,
    machineName: input.machineName?.trim() || primary.machineName,
    machineId: input.machineId?.trim() || primary.machineId,
    tailnetId: input.tailnetId?.trim() || primary.tailnetId,
    tailnetName: input.tailnetName?.trim() || primary.tailnetName,
    tailnetDnsName: input.tailnetDnsName?.trim() || primary.tailnetDnsName,
    collectorUrl: input.collectorUrl?.trim() || primary.collectorUrl,
    sessionId: input.sessionId?.trim() || primary.sessionId,
    project: input.project?.trim() || primary.project,
    createdAt: now,
    updatedAt: now,
    notePath: toVaultPath(root, file),
  };

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

  const supersededRecords = previousRecords.map((previous) => ({
    ...previous,
    status: "superseded" as const,
    supersededBy: normalizeMemoryIds([...(previous.supersededBy ?? []), id]),
    updatedAt: now,
  }));

  for (const superseded of supersededRecords) {
    const supersededFile = join(root, superseded.notePath);
    assertInside(root, supersededFile);
    await writeFile(supersededFile, memoryMarkdown(superseded), { encoding: "utf8", mode: 0o600 });
    await appendIndex(root, superseded);
  }

  await writeFile(file, memoryMarkdown(record), { encoding: "utf8", mode: 0o600 });
  if (proofReceipt) {
    record.proofPath = await appendProof(root, proofReceipt);
  }
  await appendIndex(root, record);
  return {
    vaultPath: root,
    record,
    superseded: supersededRecords,
    evolutionChain: traceEvolutionChain(record, new Map([...memoryRecords, record, ...supersededRecords].map((item) => [item.id, item]))).map(chainItemForRecord),
    proof: proofReceipt,
  };
}

export async function recallAgentMemory(input: RecallAgentMemoryInput = {}) {
  const root = resolveObsidianVaultPath(input.vaultPath);
  await access(root, constants.R_OK);
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 8)), 1), 50);
  const scope = normalizeRecallScope(input.scope);
  const memoryRecords = await readMemoryRecords(root);
  const memoryHits = attachEvolutionChains(hitsFromRecords(memoryRecords, input, limit), memoryRecords);
  if (scope === "agent-memory" || (scope === "tiered" && shouldUseDistilledMemoryOnly(input, memoryHits))) {
    return {
      vaultPath: root,
      query: input.query?.trim() || "",
      recallScope: "agent-memory",
      augmentedFromVault: false,
      hits: memoryHits,
    };
  }
  const records = await readFullVaultRecords(root, memoryRecords, input.query);
  const hits = attachEvolutionChains(hitsFromRecords(records, input, limit), memoryRecords);
  return {
    vaultPath: root,
    query: input.query?.trim() || "",
    recallScope: "full-vault",
    augmentedFromVault: scope === "tiered",
    memoryHitCount: memoryHits.length,
    hits,
  };
}

function hitSummary(hit: AgentMemoryHit, index: number) {
  const evolved = hit.evolutionChain && hit.evolutionChain.length > 1
    ? `, evolved ${hit.evolutionChain.length} versions`
    : "";
  return `${index + 1}. ${hit.title} (${hit.type}, confidence ${hit.confidence.toFixed(2)}, score ${hit.score}${evolved}) - ${hit.excerpt}`;
}

function chainContext(hit: AgentMemoryHit) {
  if (!hit.evolutionChain || hit.evolutionChain.length <= 1) return "";
  return [
    "Evolution Chain:",
    ...hit.evolutionChain.map((item, index) => {
      const label = index === 0 ? "Latest" : `Previous ${index}`;
      const reason = item.evolutionReason ? `; reason: ${item.evolutionReason}` : "";
      const stage = item.cognitiveStage ? `; stage: ${item.cognitiveStage}` : "";
      return `- ${label}: ${item.title} (${item.status}${stage}${reason}) - ${compactContent(item.content, 220)}`;
    }),
  ].join("\n");
}

export async function answerFromAgentMemory(input: RecallAgentMemoryInput = {}) {
  const result = await recallAgentMemory(input);
  const answer = result.hits.length
    ? [
      `Found ${result.hits.length} relevant shared-brain memor${result.hits.length === 1 ? "y/note" : "ies/notes"}.`,
      ...result.hits.slice(0, 6).map(hitSummary),
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
    hit.searchCollection ? `Collection: ${hit.searchCollection}` : "",
    hit.searchScore ? `Lexical Score: ${hit.searchScore.toFixed(1)}` : "",
    hit.proofId ? `GitLawb Memory Proof: ${hit.proofId}` : "",
    hit.proofStatus ? `Proof Status: ${hit.proofStatus}` : "",
    hit.actorDid ? `Actor DID: ${hit.actorDid}` : "",
    hit.proofHash ? `Proof Hash: ${hit.proofHash}` : "",
    chainContext(hit),
    `Created: ${hit.createdAt}`,
    `Content: ${hit.excerpt}`,
  ].filter(Boolean).join("\n")).join("\n\n");
  return { ...result, answer, context };
}
