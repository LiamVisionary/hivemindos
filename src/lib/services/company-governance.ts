import "server-only";

import { promises as fs } from "fs";
import { statSync } from "fs";
import { createHash } from "crypto";
import { hostname } from "os";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { readGitLawbStatus, sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { GitLawbProof, GitLawbProofStatus, GitLawbStatus } from "@/lib/types/gitlawb";

/**
 * Governance trail for zero-human companies, in two layers that mirror the
 * shared-brain memory split ("the vault remembers the work, GitLawb proves it"):
 *
 * 1. Config history — an append-only JSONL ledger of company DEFINITION changes
 *    (charter, apex goal, crew, budgets, policy flags) with per-field before/after
 *    diffs. Lives in the shared vault so the whole fleet can audit who changed
 *    what; hot operational writes (dispatch stamps, metric readings) never land
 *    here by construction — they don't touch the definition file.
 *
 * 2. Governance proofs — hash-chained GitLawb-style receipts (contentHash,
 *    recordHash, previousProofHash, actor DID when available) for config changes
 *    and dispatches, in the same shape as Agent Memory Proofs. Receipts store
 *    hashes and sanitized provenance, never charter bodies or secrets.
 *
 * Everything here is best-effort: a missing vault, absent GitLawb CLI, or broken
 * DID must never block company config writes or dispatches (callers fire-and-log).
 */

const VAULT_HISTORY_FILE = path.join("Operations", "Companies", "company-config-history.jsonl");
const VAULT_PROOFS_FILE = path.join("Operations", "Brain Services", "Company Governance Proofs.jsonl");
const LOCAL_HISTORY_FILE = path.join(homedir(), ".hivemindos", "company-config-history.jsonl");
const LOCAL_PROOFS_FILE = path.join(homedir(), ".hivemindos", "company-governance-proofs.jsonl");

const MAX_TAIL_BYTES = 512 * 1024;
/** Per-field diff payloads stay bounded so one giant charter edit can't bloat the ledger. */
const MAX_FIELD_JSON_CHARS = 2_000;

export type CompanyConfigAction = "created" | "updated" | "deleted" | "migrated";

export type CompanyConfigHistoryEntry = {
  at: number;
  iso: string;
  companyId: string;
  companyName: string;
  action: CompanyConfigAction;
  /** Top-level definition fields that changed (e.g. ["charter", "apexGoal"]). */
  changedFields: string[];
  /** Changed fields only, truncated — the definitions file holds full state. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  machineName?: string;
  /** What made the change, e.g. "api:upsert", "api:set-agents", "migration". */
  source?: string;
};

function vaultRootOrNull(): string | null {
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (!configured) return null;
  const root = resolveObsidianVaultPath(configured);
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function historyFile(): string {
  const root = vaultRootOrNull();
  return root ? path.join(root, VAULT_HISTORY_FILE) : LOCAL_HISTORY_FILE;
}

function proofsFile(): string {
  const root = vaultRootOrNull();
  return root ? path.join(root, VAULT_PROOFS_FILE) : LOCAL_PROOFS_FILE;
}

async function appendJsonlLine(file: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
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

function truncateFieldValue(value: unknown): unknown {
  const json = canonicalJson(value);
  if (json.length <= MAX_FIELD_JSON_CHARS) return value;
  return `${json.slice(0, MAX_FIELD_JSON_CHARS)}… [truncated]`;
}

/**
 * Field-level diff of two definition snapshots. Returns null when nothing
 * changed, so callers can skip both the history entry and the proof.
 */
export function diffCompanyDefinitions(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { changedFields: string[]; before?: Record<string, unknown>; after?: Record<string, unknown> } | null {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  keys.delete("updatedAt"); // bumps on every write; never a config change by itself
  const changedFields: string[] = [];
  const beforeChanged: Record<string, unknown> = {};
  const afterChanged: Record<string, unknown> = {};
  for (const key of [...keys].sort()) {
    const left = before?.[key];
    const right = after?.[key];
    if (canonicalJson(left) === canonicalJson(right)) continue;
    changedFields.push(key);
    if (left !== undefined) beforeChanged[key] = truncateFieldValue(left);
    if (right !== undefined) afterChanged[key] = truncateFieldValue(right);
  }
  if (changedFields.length === 0) return null;
  return {
    changedFields,
    before: Object.keys(beforeChanged).length ? beforeChanged : undefined,
    after: Object.keys(afterChanged).length ? afterChanged : undefined,
  };
}

export async function appendCompanyConfigHistory(
  entry: Omit<CompanyConfigHistoryEntry, "at" | "iso" | "machineName"> & { at?: number },
): Promise<CompanyConfigHistoryEntry> {
  const at = entry.at ?? Date.now();
  const record: CompanyConfigHistoryEntry = {
    at,
    iso: new Date(at).toISOString(),
    companyId: entry.companyId,
    companyName: entry.companyName,
    action: entry.action,
    changedFields: entry.changedFields,
    before: entry.before,
    after: entry.after,
    machineName: hostname(),
    source: entry.source,
  };
  await appendJsonlLine(historyFile(), record);
  return record;
}

/** Newest-last tail of the config-history ledger (bounded read, corrupt lines skipped). */
export async function readCompanyConfigHistory(
  opts: { companyId?: string; limit?: number } = {},
): Promise<CompanyConfigHistoryEntry[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 2_000));
  const file = historyFile();
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_TAIL_BYTES) {
      const handle = await fs.open(file, "r");
      try {
        const buffer = new Uint8Array(MAX_TAIL_BYTES);
        await handle.read(buffer, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES);
        raw = Buffer.from(buffer).toString("utf8");
        raw = raw.slice(raw.indexOf("\n") + 1);
      } finally {
        await handle.close();
      }
    } else {
      raw = await fs.readFile(file, "utf8");
    }
  } catch {
    return [];
  }
  const records: CompanyConfigHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as CompanyConfigHistoryEntry;
      if (!parsed || typeof parsed.at !== "number" || typeof parsed.companyId !== "string") continue;
      if (opts.companyId && parsed.companyId !== opts.companyId) continue;
      records.push(parsed);
    } catch {
      // Skip a corrupt line rather than losing the ledger.
    }
  }
  return records.slice(-limit);
}

export type CompanyGovernanceEvent = `config-${CompanyConfigAction}` | "dispatch";

export type CompanyGovernanceProofInput = {
  companyId: string;
  companyName: string;
  event: CompanyGovernanceEvent;
  /** What the proof attests to (diff, dispatch summary). Hashed, then stored sanitized. */
  payload: Record<string, unknown>;
  at?: number;
};

export type CompanyGovernanceProofReceipt = GitLawbProof & {
  kind: "company-governance";
  metadata: Record<string, unknown> & {
    source: "company-governance";
    companyId: string;
    event: CompanyGovernanceEvent;
    contentHash: string;
    recordHash: string;
    previousProofHash?: string;
    proofHash?: string;
  };
};

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

async function readPreviousProofHash(file: string): Promise<string | undefined> {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
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

/**
 * Append a hash-chained governance receipt. Same guarantees as Agent Memory
 * Proofs: locally chained always; DID-backed only when a GitLawb identity
 * exists; sanitized so no secrets, Tailnet IPs, or private paths land in it.
 */
export async function appendCompanyGovernanceProof(
  input: CompanyGovernanceProofInput,
): Promise<CompanyGovernanceProofReceipt> {
  const at = input.at ?? Date.now();
  const file = proofsFile();
  const [status, previousProofHash] = await Promise.all([safeGitLawbStatus(), readPreviousProofHash(file)]);
  const actorDid = status?.identity.did;
  const contentHash = sha256(canonicalJson(input.payload));
  const recordHash = sha256(canonicalJson({ companyId: input.companyId, event: input.event, at, contentHash }));
  const metadata: CompanyGovernanceProofReceipt["metadata"] = {
    source: "company-governance",
    companyId: input.companyId,
    companyName: input.companyName,
    event: input.event,
    contentHash,
    recordHash,
    previousProofHash,
    machineName: hostname(),
    createdAt: new Date(at).toISOString(),
    checkedAt: new Date().toISOString(),
    gitlawbCliInstalled: Boolean(status?.cli.installed),
    gitlawbNodeBindMode: status?.node.bindMode,
    gitlawbNodeHealthy: status?.node.healthy,
    error: actorDid
      ? undefined
      : status?.identity.error ?? status?.cli.error ?? "GitLawb DID is not available; receipt is locally chained but not DID-backed.",
  };
  const baseReceipt = sanitizeGitLawbProof({
    id: `gitlawb-company-${input.companyId}-${at.toString(36)}`,
    kind: "company-governance" as const,
    status: proofStatusForGitLawb(status),
    actorDid,
    title: `${input.companyName}: ${input.event}`,
    verifiedAt: actorDid ? at : undefined,
    error: metadata.error as string | undefined,
    metadata,
  }) as CompanyGovernanceProofReceipt;
  const proofHash = sha256(canonicalJson(baseReceipt));
  const receipt = sanitizeGitLawbProof({
    ...baseReceipt,
    metadata: { ...baseReceipt.metadata, proofHash },
  }) as CompanyGovernanceProofReceipt;
  await appendJsonlLine(file, { timestamp: new Date().toISOString(), ...receipt, proofHash });
  return receipt;
}

/**
 * Record one company config change end-to-end: field diff → history entry →
 * chained proof. No-op when nothing actually changed. Callers should
 * fire-and-log — this must never block a company write.
 */
export async function recordCompanyConfigChange(input: {
  action: CompanyConfigAction;
  companyId: string;
  companyName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source?: string;
}): Promise<void> {
  const diff =
    input.action === "updated"
      ? diffCompanyDefinitions(input.before, input.after)
      : { changedFields: Object.keys(input.after ?? input.before ?? {}).sort() };
  if (!diff) return;
  const entry = await appendCompanyConfigHistory({
    companyId: input.companyId,
    companyName: input.companyName,
    action: input.action,
    changedFields: diff.changedFields,
    before: "before" in diff ? diff.before : undefined,
    after: "after" in diff ? diff.after : undefined,
    source: input.source,
  });
  await appendCompanyGovernanceProof({
    companyId: input.companyId,
    companyName: input.companyName,
    event: `config-${input.action}`,
    payload: { changedFields: entry.changedFields, before: entry.before, after: entry.after, iso: entry.iso },
    at: entry.at,
  });
}

export function companyGovernanceLocations() {
  return { historyFile: historyFile(), proofsFile: proofsFile() };
}
