import type { CompanyFrontierLabStage, CompanyProduct } from "@/lib/types/company";

export type CompanyRunKind =
  | "dispatch"
  | "flow"
  | "task-outcome"
  | "pricing"
  | "preview-review"
  | "deliverable-review"
  | "revenue"
  | "replay"
  | "manual";

export type CompanyRunStatus = "running" | "completed" | "blocked" | "failed" | "canceled";

export type CompanyProposalKind =
  | "pricing-change"
  | "human-input"
  | "preview-review"
  | "deliverable-redirect"
  | "revenue-share"
  | "replay"
  | "manual";

export type CompanyProposalStatus = "pending" | "approved" | "rejected" | "applied" | "superseded";

export type CompanyProposalRisk = "low" | "medium" | "high";

export interface CompanyRunEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  taskId?: string;
  proposalId?: string;
  data?: Record<string, unknown>;
}

export interface CompanyRunArtifact {
  id: string;
  label: string;
  kind: string;
  taskId?: string;
  path?: string;
  url?: string;
}

export interface CompanyRunSnapshot {
  companyName?: string;
  apexGoal?: string;
  apexMetric?: string;
  apexTarget?: string;
  productCount?: number;
  products?: Pick<CompanyProduct, "key" | "name" | "amountUsd" | "interval" | "kind" | "recommended">[];
  directiveCount?: number;
  agentCount?: number;
  autonomy?: boolean;
  frozen?: boolean;
  frontierLab?: {
    stage: CompanyFrontierLabStage;
    availableSlots: number;
    remainingTokens: number;
    blockedReason?: string;
  };
}

export interface CompanyRun {
  id: string;
  companyId: string;
  kind: CompanyRunKind;
  status: CompanyRunStatus;
  title: string;
  summary?: string;
  actor?: string;
  parentRunId?: string;
  replayOfRunId?: string;
  sourceTaskId?: string;
  flowRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  snapshot?: CompanyRunSnapshot;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidence?: string[];
  artifacts?: CompanyRunArtifact[];
  events?: CompanyRunEvent[];
}

export interface CompanyProposal {
  id: string;
  companyId: string;
  kind: CompanyProposalKind;
  status: CompanyProposalStatus;
  title: string;
  summary?: string;
  runId?: string;
  sourceTaskId?: string;
  idempotencyKey?: string;
  risk?: CompanyProposalRisk;
  proposedChange?: Record<string, unknown>;
  evidence?: string[];
  links?: { label: string; url: string }[];
  createdBy?: string;
  decidedBy?: string;
  decision?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
}

export interface CompanyRunLedgerFile {
  version: 1;
  companyId: string;
  updatedAt: string;
  runs: CompanyRun[];
  proposals: CompanyProposal[];
}
