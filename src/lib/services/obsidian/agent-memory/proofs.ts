import "server-only";

import { createHash } from "crypto";
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join, relative, resolve, sep } from "path";
import { readGitLawbStatus, sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import { contentAddressForText } from "@/lib/services/obsidian/content-address";
import type {
  AgentMemoryActorRole,
  AgentMemoryCognitiveStage,
  AgentMemoryEvolutionType,
  AgentMemoryOrigin,
  AgentMemoryRecord,
  AgentMemorySourceType,
  AgentMemoryType,
} from "@/lib/services/obsidian/agent-memory/types";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { GitLawbProof, GitLawbProofStatus, GitLawbStatus } from "@/lib/types/gitlawb";

export const AGENT_MEMORY_PROOF_INDEX_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Proofs.jsonl`;

export type AgentMemoryProofReceipt = GitLawbProof & {
  kind: "agent-memory";
  metadata: {
    source: "agent-memory";
    memoryId: string;
    memoryType: AgentMemoryType;
    memoryTitle: string;
    memoryKey?: string;
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
    entities?: string[];
    aliases?: string[];
    actorRole?: AgentMemoryActorRole;
    memoryOrigin?: AgentMemoryOrigin;
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

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(path) === resolve(root)) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected vault.");
  }
}

async function readPreviousProofHash(root: string) {
  const file = join(root, AGENT_MEMORY_PROOF_INDEX_PATH);
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
    memoryKey: record.memoryKey,
    contentHash: record.contentHash ?? contentAddressForText(record.content),
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

export async function safeGitLawbStatus(): Promise<GitLawbStatus | null> {
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

export async function createMemoryProofReceipt(root: string, record: AgentMemoryRecord): Promise<AgentMemoryProofReceipt> {
  const [status, previousProofHash] = await Promise.all([safeGitLawbStatus(), readPreviousProofHash(root)]);
  const actorDid = status?.identity.did;
  const checkedAt = new Date().toISOString();
  const contentHash = record.contentHash ?? contentAddressForText(record.content);
  const metadata: AgentMemoryProofReceipt["metadata"] = {
    source: "agent-memory",
    memoryId: record.id,
    memoryType: record.type,
    memoryTitle: record.title,
    memoryKey: record.memoryKey,
    notePath: record.notePath,
    contentHash,
    recordHash: memoryRecordHash(record),
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
  const baseReceipt = sanitizeGitLawbProof({
    id: `gitlawb-memory-${record.id}`,
    kind: "agent-memory",
    status: proofStatusForGitLawb(status),
    actorDid,
    title: record.title,
    verifiedAt: actorDid ? Date.now() : undefined,
    error: metadata.error,
    metadata,
  }) as AgentMemoryProofReceipt;
  const proofHash = sha256(canonicalJson(baseReceipt));
  return sanitizeGitLawbProof({
    ...baseReceipt,
    metadata: { ...baseReceipt.metadata, proofHash },
  }) as AgentMemoryProofReceipt;
}

export async function appendMemoryProof(root: string, receipt: AgentMemoryProofReceipt) {
  const file = join(root, AGENT_MEMORY_PROOF_INDEX_PATH);
  assertInside(root, file);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...receipt,
    proofHash: receipt.metadata.proofHash,
  })}\n`, "utf8");
  return relative(root, file).split(sep).join("/");
}
