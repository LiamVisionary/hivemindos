import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { homedir } from "@/lib/home-dir";
import { contentAddressForText } from "@/lib/services/obsidian/content-address";
import {
  evolveAgentMemory,
  rememberAgentMemory,
  type EvolveAgentMemoryInput,
  type RememberAgentMemoryInput,
} from "@/lib/services/obsidian/agent-memory";
import { withCrossProcessFileLock } from "@/lib/services/obsidian/agent-memory/write-transactions";
import {
  BRAIN_REVIEW_EVIDENCE_SOURCE_TYPES,
  BRAIN_REVIEW_KINDS,
  BRAIN_REVIEW_RISKS,
  BRAIN_REVIEW_STATUSES,
  type BrainReviewEvidence,
  type BrainReviewKind,
  type BrainReviewProposal,
  type BrainReviewProposalInput,
  type BrainReviewQueueFile,
  type BrainReviewRisk,
  type BrainReviewStatus,
} from "@/lib/types/brain-review";
import type { ScopePolicy } from "@/lib/types/principal";
import type { KanbanTask } from "@/lib/types/kanban";

const BRAIN_REVIEW_QUEUE_FILE = join(homedir(), ".hivemindos", "brain-review-queue.json");
const BRAIN_REVIEW_QUEUE_LOCK_FILE = `${BRAIN_REVIEW_QUEUE_FILE}.lock`;
const MAX_TITLE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 1_000;
const MAX_CONTENT_LENGTH = 40_000;
const MAX_EVIDENCE_EXCERPT_LENGTH = 1_500;
const MAX_PATH_LENGTH = 500;

let brainReviewWriteQueue: Promise<unknown> = Promise.resolve();

export type BrainReviewListFilter = {
  status?: BrainReviewStatus | "all" | null;
  kind?: BrainReviewKind | "all" | null;
};

export type BrainReviewApplyPreview = {
  proposalId: string;
  kind: BrainReviewKind;
  status: BrainReviewStatus;
  canAutoApply: boolean;
  action: "remember" | "evolve" | "launch-autoresearch" | "manual";
  reason: string;
  targetPath?: string;
  supersedesMemoryId?: string;
};

export type BrainReviewApplyInput = {
  vaultPath?: unknown;
  kanbanFolder?: unknown;
  type?: unknown;
  memoryType?: unknown;
  confidence?: unknown;
  cognitiveStage?: unknown;
  evidenceCount?: unknown;
  sourceType?: unknown;
  metaTags?: unknown;
  tags?: unknown;
  entities?: unknown;
  aliases?: unknown;
  actorRole?: unknown;
  memoryOrigin?: unknown;
  source?: unknown;
  agentName?: unknown;
  agentId?: unknown;
  runtime?: unknown;
  machineName?: unknown;
  machineId?: unknown;
  tailnetId?: unknown;
  tailnetName?: unknown;
  tailnetDnsName?: unknown;
  collectorUrl?: unknown;
  sessionId?: unknown;
  project?: unknown;
  proof?: unknown;
  evolutionType?: unknown;
  evolutionReason?: unknown;
};

type NormalizedBrainReviewApplyInput = {
  vaultPath?: string;
  kanbanFolder?: string;
  type?: string;
  confidence?: number;
  cognitiveStage?: string;
  evidenceCount?: number;
  sourceType?: string;
  metaTags?: string[];
  tags?: string[];
  entities?: string[];
  aliases?: string[];
  actorRole?: string;
  memoryOrigin?: string;
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
  proof?: RememberAgentMemoryInput["proof"];
  evolutionType?: string;
  evolutionReason?: string;
};

type BrainReviewMemoryApplyResult =
  | Awaited<ReturnType<typeof rememberAgentMemory>>
  | Awaited<ReturnType<typeof evolveAgentMemory>>;

export type BrainReviewApplyResult = {
  applied: boolean;
  action: BrainReviewApplyPreview["action"];
  reason?: string;
  preview: BrainReviewApplyPreview;
  proposal: BrainReviewProposal;
  file: BrainReviewQueueFile;
  memory?: BrainReviewMemoryApplyResult;
  task?: KanbanTask;
};

function emptyQueue(): BrainReviewQueueFile {
  return {
    version: 1,
    proposals: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export async function readBrainReviewQueue(): Promise<BrainReviewQueueFile> {
  try {
    const raw = await readFile(BRAIN_REVIEW_QUEUE_FILE, "utf8");
    if (!raw.trim()) return emptyQueue();
    return normalizeQueueFile(JSON.parse(raw) as unknown);
  } catch {
    return emptyQueue();
  }
}

export async function listBrainReviewProposals(filter: BrainReviewListFilter = {}) {
  const queue = await readBrainReviewQueue();
  const proposals = queue.proposals.filter((proposal) => {
    if (filter.status && filter.status !== "all" && proposal.status !== filter.status) {
      return false;
    }
    if (filter.kind && filter.kind !== "all" && proposal.kind !== filter.kind) {
      return false;
    }
    return true;
  });
  return { ...queue, proposals };
}

export async function createBrainReviewProposal(input: BrainReviewProposalInput) {
  const normalized = normalizeProposalInput(input);
  const contentHash = contentAddressForText(normalized.proposedContent);
  const proposal = {
    ...normalized,
    metadata: { ...(normalized.metadata ?? {}), contentHash },
  };
  return enqueueBrainReviewWrite(async () => {
    const queue = await readBrainReviewQueue();
    const existing = queue.proposals.find((item) =>
      item.kind === proposal.kind
      && (item.status === "pending" || item.status === "approved")
      && proposalDedupeScope(item) === proposalDedupeScope(proposal)
      && (item.metadata?.contentHash === contentHash || contentAddressForText(item.proposedContent) === contentHash));
    if (existing) return { file: queue, proposal: existing, deduplicated: true as const };
    const now = new Date().toISOString();
    const nextProposal: BrainReviewProposal = {
      id: `review_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      ...proposal,
    };
    const next = {
      version: 1 as const,
      proposals: [nextProposal, ...queue.proposals],
      updatedAt: now,
    };
    await writeBrainReviewQueue(next);
    return { file: next, proposal: nextProposal, deduplicated: false as const };
  });
}

function proposalDedupeScope(proposal: Pick<BrainReviewProposal, "kind" | "targetPath" | "supersedesMemoryId" | "metadata">) {
  const metadataString = (key: string) => {
    const value = proposal.metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
  };
  return JSON.stringify({
    vaultPath: metadataString("vaultPath"),
    project: metadataString("project"),
    targetPath: proposal.kind === "memory" ? "" : proposal.targetPath ?? "",
    supersedesMemoryId: proposal.supersedesMemoryId ?? "",
  });
}

export async function approveBrainReviewProposal(id: string) {
  return updateBrainReviewProposalStatus(id, "approved");
}

export async function rejectBrainReviewProposal(id: string, reason?: unknown) {
  const rejectionReason = cleanOptional(reason);
  return updateBrainReviewProposalStatus(id, "rejected", rejectionReason);
}

export async function updateBrainReviewProposalStatus(
  id: string,
  status: BrainReviewStatus,
  rejectionReason?: string,
) {
  const nextStatus = normalizeStatus(status);
  return enqueueBrainReviewWrite(async () => {
    const queue = await readBrainReviewQueue();
    const now = new Date().toISOString();
    let updated: BrainReviewProposal | undefined;
    const proposals = queue.proposals.map((proposal) => {
      if (proposal.id !== id) return proposal;
      updated = {
        ...proposal,
        status: nextStatus,
        rejectionReason: nextStatus === "rejected" ? rejectionReason : undefined,
        updatedAt: now,
      };
      return updated;
    });
    if (!updated) throw new Error("Brain review proposal not found.");
    const next = { version: 1 as const, proposals, updatedAt: now };
    await writeBrainReviewQueue(next);
    return { file: next, proposal: updated };
  });
}

export async function previewBrainReviewApply(id: string): Promise<BrainReviewApplyPreview> {
  const queue = await readBrainReviewQueue();
  const proposal = queue.proposals.find((item) => item.id === id);
  if (!proposal) throw new Error("Brain review proposal not found.");
  return previewBrainReviewProposal(proposal);
}

export async function applyBrainReviewProposal(
  id: string,
  input: BrainReviewApplyInput = {},
): Promise<BrainReviewApplyResult> {
  const memoryInput = normalizeApplyInput(input);
  return enqueueBrainReviewWrite(async () => {
    const queue = await readBrainReviewQueue();
    const proposalIndex = queue.proposals.findIndex((item) => item.id === id);
    const proposal = queue.proposals[proposalIndex];
    if (!proposal) throw new Error("Brain review proposal not found.");
    const preview = previewBrainReviewProposal(proposal);

    if (proposal.status === "applied") {
      throw new Error("Brain review proposal has already been applied.");
    }
    if (proposal.status !== "approved") {
      throw new Error("Approve this brain review proposal before applying it.");
    }
    if (!preview.canAutoApply) {
      return {
        applied: false,
        action: preview.action,
        reason: preview.reason,
        preview,
        proposal,
        file: queue,
      };
    }

    if (preview.action === "launch-autoresearch") {
      const { launchSkillAutoresearchTask } = await import("@/lib/services/skills/skill-autoresearch-task");
      const launched = await launchSkillAutoresearchTask(proposal, {
        vaultPath: memoryInput.vaultPath,
        kanbanFolder: memoryInput.kanbanFolder,
      });
      const now = new Date().toISOString();
      const updated: BrainReviewProposal = {
        ...proposal,
        status: "applied",
        rejectionReason: undefined,
        appliedAt: now,
        appliedTaskId: launched.task.id,
        updatedAt: now,
      };
      const proposals = [...queue.proposals];
      proposals[proposalIndex] = updated;
      const next = { version: 1 as const, proposals, updatedAt: now };
      await writeBrainReviewQueue(next);
      return {
        applied: true,
        action: preview.action,
        preview,
        proposal: updated,
        file: next,
        task: launched.task,
      };
    }

    const memory = proposal.kind === "memory"
      ? await rememberAgentMemory(rememberInputForProposal(proposal, memoryInput))
      : await evolveAgentMemory(evolveInputForProposal(proposal, memoryInput));
    if (!memory.record) {
      // Duplicate gate: surface the evolve hint to the reviewer instead of
      // silently writing a sibling of an existing memory.
      return {
        applied: false,
        action: preview.action,
        reason: "blocked" in memory && memory.blockReason ? memory.blockReason : "Memory write was blocked as a suspected duplicate.",
        preview,
        proposal,
        file: queue,
        memory,
      };
    }
    const now = new Date().toISOString();
    const updated: BrainReviewProposal = {
      ...proposal,
      status: "applied",
      rejectionReason: undefined,
      appliedAt: now,
      appliedMemoryId: memory.record.id,
      appliedMemoryPath: memory.record.notePath,
      updatedAt: now,
    };
    const proposals = [...queue.proposals];
    proposals[proposalIndex] = updated;
    const next = { version: 1 as const, proposals, updatedAt: now };
    await writeBrainReviewQueue(next);
    return {
      applied: true,
      action: preview.action,
      preview,
      proposal: updated,
      file: next,
      memory,
    };
  });
}

function previewBrainReviewProposal(proposal: BrainReviewProposal): BrainReviewApplyPreview {
  const statusReason = applyStatusReason(proposal.status);
  if (proposal.kind === "memory") {
    return {
      proposalId: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      canAutoApply: proposal.status === "approved",
      action: "remember",
      reason: proposal.status === "approved"
        ? "Approved memory proposals can be applied through /api/brain/memory action remember."
        : statusReason,
      targetPath: proposal.targetPath,
    };
  }
  if (proposal.kind === "memory-evolution") {
    const missingSupersedes = !proposal.supersedesMemoryId;
    return {
      proposalId: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      canAutoApply: proposal.status === "approved" && !missingSupersedes,
      action: "evolve",
      reason: proposal.status !== "approved"
        ? statusReason
        : !missingSupersedes
        ? "Approved memory-evolution proposals can be applied through /api/brain/memory action evolve."
        : "Memory-evolution proposals need supersedesMemoryId before applying.",
      targetPath: proposal.targetPath,
      supersedesMemoryId: proposal.supersedesMemoryId,
    };
  }
  if (proposal.kind === "skill-evolution") {
    const hasTarget = typeof proposal.metadata?.skillSlug === "string" && Boolean(proposal.metadata.skillSlug.trim());
    return {
      proposalId: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      canAutoApply: proposal.status === "approved" && hasTarget,
      action: "launch-autoresearch",
      reason: proposal.status !== "approved"
        ? statusReason
        : hasTarget
          ? "Applying this proposal launches a review-gated Work Board optimizer task; it does not install the winning skill."
          : "Skill-evolution proposals need metadata.skillSlug before launching.",
      targetPath: proposal.targetPath,
    };
  }
  return {
    proposalId: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    canAutoApply: false,
    action: "manual",
    reason: proposal.status === "approved"
      ? "Skill, instruction, and job proposals require manual review/application."
      : statusReason,
    targetPath: proposal.targetPath,
  };
}

function applyStatusReason(status: BrainReviewStatus) {
  if (status === "applied") return "This proposal has already been applied.";
  if (status === "rejected") return "Rejected proposals cannot be applied unless approved again.";
  return "Approve this proposal before applying it.";
}

function rememberInputForProposal(
  proposal: BrainReviewProposal,
  input: NormalizedBrainReviewApplyInput,
): RememberAgentMemoryInput {
  return {
    ...baseMemoryInputForProposal(proposal, input),
    title: proposalMetadataString(proposal, "originalTitle") ?? proposal.title,
    content: proposal.proposedContent,
  };
}

function evolveInputForProposal(
  proposal: BrainReviewProposal,
  input: NormalizedBrainReviewApplyInput,
): EvolveAgentMemoryInput {
  if (!proposal.supersedesMemoryId) {
    throw new Error("Memory-evolution proposals need supersedesMemoryId before applying.");
  }
  return {
    ...baseMemoryInputForProposal(proposal, input),
    title: proposal.title,
    content: proposal.proposedContent,
    supersedes: [proposal.supersedesMemoryId],
    evolutionType: input.evolutionType,
    evolutionReason: input.evolutionReason ?? proposal.summary,
  };
}

function baseMemoryInputForProposal(
  proposal: BrainReviewProposal,
  input: NormalizedBrainReviewApplyInput,
): RememberAgentMemoryInput {
  const metadataType = proposalMetadataString(proposal, "memoryType");
  const metadataConfidence = proposalMetadataNumber(proposal, "confidence");
  return {
    vaultPath: input.vaultPath ?? proposalMetadataString(proposal, "vaultPath"),
    type: input.type ?? metadataType,
    memoryKey: proposalMetadataString(proposal, "memoryKey"),
    confidence: input.confidence ?? metadataConfidence,
    cognitiveStage: input.cognitiveStage,
    evidenceCount: input.evidenceCount ?? (proposal.evidence.length || undefined),
    sourceType: input.sourceType ?? (proposal.evidence.length ? "composite" : "explicit"),
    metaTags: input.metaTags,
    tags: mergeApplyTags(input.tags ?? proposalMetadataStringList(proposal, "tags")),
    entities: input.entities ?? proposalMetadataStringList(proposal, "entities"),
    aliases: input.aliases,
    actorRole: input.actorRole ?? "agent",
    memoryOrigin: input.memoryOrigin ?? "agent-action",
    source: input.source ?? `brain-review:${proposal.id}`,
    agentName: input.agentName,
    agentId: input.agentId,
    runtime: input.runtime,
    machineName: input.machineName,
    machineId: input.machineId,
    tailnetId: input.tailnetId,
    tailnetName: input.tailnetName,
    tailnetDnsName: input.tailnetDnsName,
    collectorUrl: input.collectorUrl,
    sessionId: input.sessionId,
    project: input.project ?? proposalMetadataString(proposal, "project"),
    proof: input.proof ?? "auto",
  };
}

function proposalMetadataString(proposal: BrainReviewProposal, key: string) {
  const value = proposal.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function proposalMetadataNumber(proposal: BrainReviewProposal, key: string) {
  const value = proposal.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function proposalMetadataStringList(proposal: BrainReviewProposal, key: string) {
  const value = proposal.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : undefined;
}

function normalizeApplyInput(input: BrainReviewApplyInput): NormalizedBrainReviewApplyInput {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return {
    vaultPath: cleanOptional(record.vaultPath),
    kanbanFolder: cleanOptional(record.kanbanFolder),
    type: cleanOptional(record.type) ?? cleanOptional(record.memoryType),
    confidence: cleanNumber(record.confidence),
    cognitiveStage: cleanOptional(record.cognitiveStage),
    evidenceCount: cleanPositiveInteger(record.evidenceCount),
    sourceType: cleanOptional(record.sourceType),
    metaTags: cleanStringList(record.metaTags),
    tags: cleanStringList(record.tags),
    entities: cleanStringList(record.entities),
    aliases: cleanStringList(record.aliases),
    actorRole: cleanOptional(record.actorRole),
    memoryOrigin: cleanOptional(record.memoryOrigin),
    source: cleanOptional(record.source),
    agentName: cleanOptional(record.agentName),
    agentId: cleanOptional(record.agentId),
    runtime: cleanOptional(record.runtime),
    machineName: cleanOptional(record.machineName),
    machineId: cleanOptional(record.machineId),
    tailnetId: cleanOptional(record.tailnetId),
    tailnetName: cleanOptional(record.tailnetName),
    tailnetDnsName: cleanOptional(record.tailnetDnsName),
    collectorUrl: cleanOptional(record.collectorUrl),
    sessionId: cleanOptional(record.sessionId),
    project: cleanOptional(record.project),
    proof: normalizeProof(record.proof),
    evolutionType: cleanOptional(record.evolutionType),
    evolutionReason: cleanOptional(record.evolutionReason),
  };
}

function mergeApplyTags(tags?: string[]) {
  return [...new Set([...(tags ?? []), "brain-review", "reviewed"])];
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.map(cleanOptional).filter(Boolean) as string[];
  return cleaned.length ? cleaned : undefined;
}

function cleanNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanPositiveInteger(value: unknown) {
  const numeric = cleanNumber(value);
  if (numeric === undefined) return undefined;
  return numeric > 0 ? Math.trunc(numeric) : undefined;
}

function normalizeProof(value: unknown): RememberAgentMemoryInput["proof"] {
  if (value === true || value === false || value === "auto") return value;
  return undefined;
}

function normalizeQueueFile(value: unknown): BrainReviewQueueFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyQueue();
  const record = value as Partial<BrainReviewQueueFile>;
  const proposals = Array.isArray(record.proposals)
    ? record.proposals.map(normalizeStoredProposal).filter(Boolean)
    : [];
  return {
    version: 1,
    proposals: proposals as BrainReviewProposal[],
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeStoredProposal(value: unknown): BrainReviewProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<BrainReviewProposal>;
  const id = cleanOptional(item.id);
  const title = cleanBounded(item.title, MAX_TITLE_LENGTH);
  const summary = cleanBounded(item.summary, MAX_SUMMARY_LENGTH);
  const proposedContent = cleanBounded(item.proposedContent, MAX_CONTENT_LENGTH);
  if (!id || !title || !summary || !proposedContent) return null;
  return {
    id,
    title,
    summary,
    proposedContent,
    kind: normalizeKind(item.kind),
    targetPath: cleanStoredPath(item.targetPath),
    supersedesMemoryId: cleanOptional(item.supersedesMemoryId),
    evidence: normalizeEvidenceList(item.evidence),
    risk: normalizeRisk(item.risk),
    status: normalizeStatus(item.status),
    rejectionReason: cleanBounded(item.rejectionReason, MAX_SUMMARY_LENGTH),
    appliedAt: cleanOptional(item.appliedAt),
    appliedMemoryId: cleanOptional(item.appliedMemoryId),
    appliedMemoryPath: cleanStoredPath(item.appliedMemoryPath),
    appliedTaskId: cleanOptional(item.appliedTaskId),
    metadata: cleanMetadata(item.metadata),
    createdByPrincipalId: cleanOptional(item.createdByPrincipalId),
    scope: normalizeScope(item.scope),
    createdAt: cleanOptional(item.createdAt) ?? new Date(0).toISOString(),
    updatedAt: cleanOptional(item.updatedAt) ?? new Date(0).toISOString(),
  };
}

function normalizeProposalInput(input: BrainReviewProposalInput) {
  const title = cleanBounded(input.title, MAX_TITLE_LENGTH);
  if (!title) throw new Error("Brain review proposal title is required.");
  const summary = cleanBounded(input.summary, MAX_SUMMARY_LENGTH);
  if (!summary) throw new Error("Brain review proposal summary is required.");
  const proposedContent = cleanBounded(input.proposedContent, MAX_CONTENT_LENGTH);
  if (!proposedContent) throw new Error("Brain review proposedContent is required.");
  const kind = normalizeKind(input.kind);
  const supersedesMemoryId = cleanOptional(input.supersedesMemoryId);
  if (kind === "memory-evolution" && !supersedesMemoryId) {
    throw new Error("Memory-evolution proposals require supersedesMemoryId.");
  }
  return {
    kind,
    title,
    summary,
    proposedContent,
    targetPath: cleanInputPath(input.targetPath),
    supersedesMemoryId,
    metadata: cleanMetadata(input.metadata),
    evidence: normalizeEvidenceList(input.evidence),
    risk: normalizeRisk(input.risk),
    createdByPrincipalId: cleanOptional(input.createdByPrincipalId),
    scope: normalizeScope(input.scope),
  };
}

function normalizeScope(value: unknown): ScopePolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<ScopePolicy>;
  const visibility = record.visibility;
  if (visibility !== "private" && visibility !== "workspace" && visibility !== "team" && visibility !== "public") {
    return undefined;
  }
  return {
    visibility,
    ownerPrincipalId: cleanOptional(record.ownerPrincipalId),
    allowedPrincipalIds: cleanStringList(record.allowedPrincipalIds),
    requiredClaims: cleanStringList(record.requiredClaims),
    tags: cleanStringList(record.tags),
  };
}

function normalizeEvidenceList(value: unknown): BrainReviewEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEvidence).filter(Boolean) as BrainReviewEvidence[];
}

function normalizeEvidence(value: unknown): BrainReviewEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<BrainReviewEvidence>;
  const excerpt = cleanBounded(item.excerpt, MAX_EVIDENCE_EXCERPT_LENGTH);
  if (!excerpt) return null;
  const sourceType = BRAIN_REVIEW_EVIDENCE_SOURCE_TYPES.includes(item.sourceType as BrainReviewEvidence["sourceType"])
    ? (item.sourceType as BrainReviewEvidence["sourceType"])
    : "manual";
  return {
    sourceType,
    sourceId: cleanOptional(item.sourceId),
    excerpt,
  };
}

function normalizeKind(value: unknown): BrainReviewKind {
  return BRAIN_REVIEW_KINDS.includes(value as BrainReviewKind)
    ? (value as BrainReviewKind)
    : "memory";
}

function normalizeRisk(value: unknown): BrainReviewRisk {
  return BRAIN_REVIEW_RISKS.includes(value as BrainReviewRisk)
    ? (value as BrainReviewRisk)
    : "low";
}

function normalizeStatus(value: unknown): BrainReviewStatus {
  return BRAIN_REVIEW_STATUSES.includes(value as BrainReviewStatus)
    ? (value as BrainReviewStatus)
    : "pending";
}

function cleanInputPath(value: unknown) {
  const text = cleanBounded(value, MAX_PATH_LENGTH);
  if (!text) return undefined;
  if (isAbsolute(text) || text.startsWith("~") || /[\0\r\n]/.test(text)) {
    throw new Error("Brain review targetPath must be a relative project or vault path.");
  }
  return text;
}

function cleanStoredPath(value: unknown) {
  const text = cleanBounded(value, MAX_PATH_LENGTH);
  if (!text || isAbsolute(text) || text.startsWith("~") || /[\0\r\n]/.test(text)) {
    return undefined;
  }
  return text;
}

function cleanBounded(value: unknown, maxLength: number) {
  const text = cleanOptional(value);
  return text && text.length <= maxLength ? text : undefined;
}

function cleanOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length > 20_000) return undefined;
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function enqueueBrainReviewWrite<T>(operation: () => Promise<T>): Promise<T> {
  // The promise chain only serializes writers inside this process; the dev
  // server, agent server, and Tauri sidecar each run their own copy, so every
  // read-modify-write also holds the cross-process lockfile or concurrent
  // processes silently drop each other's proposals.
  const next = brainReviewWriteQueue
    .catch(() => undefined)
    .then(() => withCrossProcessFileLock(BRAIN_REVIEW_QUEUE_LOCK_FILE, operation, {
      label: "cross-process brain review queue write",
    }));
  brainReviewWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function writeBrainReviewQueue(file: BrainReviewQueueFile) {
  await mkdir(dirname(BRAIN_REVIEW_QUEUE_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${BRAIN_REVIEW_QUEUE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, BRAIN_REVIEW_QUEUE_FILE);
}
