export const BRAIN_REVIEW_KINDS = [
  "memory",
  "memory-evolution",
  "skill",
  "instruction",
  "job",
] as const;

export const BRAIN_REVIEW_RISKS = ["low", "medium", "high"] as const;

export const BRAIN_REVIEW_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "applied",
] as const;

export const BRAIN_REVIEW_EVIDENCE_SOURCE_TYPES = [
  "conversation",
  "agent-run",
  "work-board",
  "manual",
] as const;

export type BrainReviewKind = (typeof BRAIN_REVIEW_KINDS)[number];
export type BrainReviewRisk = (typeof BRAIN_REVIEW_RISKS)[number];
export type BrainReviewStatus = (typeof BRAIN_REVIEW_STATUSES)[number];
export type BrainReviewEvidenceSourceType =
  (typeof BRAIN_REVIEW_EVIDENCE_SOURCE_TYPES)[number];

export type BrainReviewEvidence = {
  sourceType: BrainReviewEvidenceSourceType;
  sourceId?: string;
  excerpt: string;
};

export type BrainReviewProposal = {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: BrainReviewKind;
  title: string;
  summary: string;
  proposedContent: string;
  targetPath?: string;
  supersedesMemoryId?: string;
  evidence: BrainReviewEvidence[];
  risk: BrainReviewRisk;
  status: BrainReviewStatus;
  rejectionReason?: string;
  appliedAt?: string;
  appliedMemoryId?: string;
  appliedMemoryPath?: string;
};

export type BrainReviewProposalInput = {
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  proposedContent?: unknown;
  targetPath?: unknown;
  supersedesMemoryId?: unknown;
  evidence?: unknown;
  risk?: unknown;
};

export type BrainReviewQueueFile = {
  version: 1;
  proposals: BrainReviewProposal[];
  updatedAt: string;
};
