export const CONTEXT_XRAY_SOURCE_KINDS = [
  "memory",
  "compiled-knowledge",
  "skill",
  "tool",
  "api-route",
  "file",
  "conversation",
  "user-message",
  "workspace-file",
] as const;

export const CONTEXT_XRAY_SOURCE_STATUSES = [
  "active",
  "pinned",
  "summarized",
  "evicted",
] as const;

export const CONTEXT_XRAY_LIFECYCLE_STAGES = [
  "available",
  "retrieved",
  "invoked",
  "relevant",
] as const;

export type ContextXraySourceKind = (typeof CONTEXT_XRAY_SOURCE_KINDS)[number];
export type ContextXraySourceStatus = (typeof CONTEXT_XRAY_SOURCE_STATUSES)[number];
export type ContextXrayLifecycleStage = (typeof CONTEXT_XRAY_LIFECYCLE_STAGES)[number];

export type ContextXrayLifecycle = {
  availableAt?: string;
  retrievedAt?: string;
  invokedAt?: string;
  relevantAt?: string;
  evidence?: string[];
};

export type ContextXraySource = {
  id: string;
  kind: ContextXraySourceKind;
  title: string;
  path?: string;
  route?: string;
  tokenEstimate: number;
  status: ContextXraySourceStatus;
  reason?: string;
  snippet?: string;
  redactedLabels?: string[];
  lifecycle?: ContextXrayLifecycle;
};

export type ContextXrayEvidenceEvent = {
  id: string;
  runId: string;
  sourceId: string;
  stage: ContextXrayLifecycleStage;
  evidence: string;
  createdAt: string;
};

export type ContextXrayManifest = {
  id: string;
  runId?: string;
  threadId?: string;
  createdAt: string;
  model?: string;
  totalEstimatedTokens: number;
  sources: ContextXraySource[];
  redactedLabels?: string[];
};

export type ContextXrayCreateInput = {
  runId?: unknown;
  threadId?: unknown;
  model?: unknown;
  sources?: unknown;
};

export type ContextXrayListFilter = {
  limit?: unknown;
  runId?: unknown;
  threadId?: unknown;
};

export type ContextXrayEvidenceInput = {
  runId?: unknown;
  sourceId?: unknown;
  stage?: unknown;
  evidence?: unknown;
  createdAt?: unknown;
};
