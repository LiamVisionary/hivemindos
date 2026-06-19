import type { GitLawbProof } from "@/lib/types/gitlawb";

export type KanbanStatus = "ideas" | "ready" | "working" | "needs-human" | "done" | "archived";

export type KanbanPriority = "low" | "normal" | "high" | "urgent";

export type KanbanFailureReason =
  | "agent-error"
  | "timeout"
  | "runtime-offline"
  | "runtime-recovery"
  | "local-directory-error"
  | "manual";

export type KanbanLoopMode = "closed" | "open" | "optimizer";

export type KanbanEvalGatePhase = "pre" | "post";

export type KanbanEvalGateKind = "command" | "test" | "artifact" | "agent" | "human" | "receipt";

export type KanbanEvalGateStatus = "pending" | "passed" | "failed" | "skipped";

export type KanbanEvalGate = {
  id: string;
  title: string;
  kind: KanbanEvalGateKind;
  phase: KanbanEvalGatePhase;
  required: boolean;
  status: KanbanEvalGateStatus;
  command?: string;
  verifier?: string;
  evidence?: string[];
  summary?: string;
  createdAt: number;
  updatedAt?: number;
};

export type KanbanLoopMetricDirection = "max" | "min";

export type KanbanLoopFrontierStrategyKind = "argmax" | "top_k" | "epsilon_greedy" | "softmax" | "pareto_per_task";

export type KanbanLoopFrontierStrategy = {
  kind: KanbanLoopFrontierStrategyKind;
  params?: Record<string, number>;
  seed?: number;
};

export type KanbanLoopBenchmark = {
  target?: string;
  command?: string;
  metricName?: string;
  metricDirection: KanbanLoopMetricDirection;
  scoreFloor?: number;
  resourceProfile?: string;
  instrumentation?: "sdk" | "inline" | "manual";
  discoveredAt: number;
  notes?: string[];
};

export type KanbanLoopExperimentStatus = "candidate" | "running" | "evaluated" | "committed" | "discarded" | "failed";

export type KanbanLoopExperiment = {
  id: string;
  parentId?: string;
  runId?: string;
  title?: string;
  hypothesis: string;
  status: KanbanLoopExperimentStatus;
  score?: number;
  taskScores?: Record<string, number>;
  taskDirections?: Record<string, KanbanLoopMetricDirection>;
  gateReceipts?: KanbanLoopReceipt[];
  agent?: string;
  result?: string;
  discardedReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type KanbanLoopAntiPattern = {
  id: string;
  title: string;
  reason: string;
  sourceExperimentId?: string;
  evidence: string[];
  createdAt: number;
};

export type KanbanLoopFrontierItem = {
  id: string;
  rank: number;
  score?: number;
  hypothesis: string;
  status: KanbanLoopExperimentStatus;
  parentId?: string;
  reason?: string;
};

export type KanbanLoopObservation = {
  totalExperiments: number;
  committedExperiments: number;
  discardedExperiments: number;
  failedExperiments: number;
  bestExperimentId?: string;
  bestScore?: number;
  runningBestExperimentIds: string[];
  frontier: KanbanLoopFrontierItem[];
  antiPatternCount: number;
  pendingRequiredGateCount: number;
  updatedAt: number;
};

export type KanbanLoopSpec = {
  mode: KanbanLoopMode;
  goal: string;
  successCriteria: string[];
  evalGates: KanbanEvalGate[];
  benchmark?: KanbanLoopBenchmark;
  frontierStrategy?: KanbanLoopFrontierStrategy;
  experiments?: KanbanLoopExperiment[];
  antiPatterns?: KanbanLoopAntiPattern[];
  observation?: KanbanLoopObservation;
  budget?: {
    maxAttempts?: number;
    maxRuntimeMs?: number;
    maxTokens?: number;
    maxCostUsd?: number;
  };
  retryPolicy?: {
    maxAttempts?: number;
    onFailure?: "retry" | "needs-human";
  };
  handoffRules?: string[];
  evidenceRequired?: string[];
};

export type KanbanLoopReceipt = {
  id: string;
  gateId?: string;
  status: "passed" | "failed" | "skipped";
  summary: string;
  evidence: string[];
  verifier?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type KanbanColumn = {
  id: KanbanStatus;
  title: string;
  description: string;
};

export type KanbanComment = {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: number;
};

export type KanbanEvent = {
  id: string;
  taskId?: string;
  runId?: string;
  kind: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

export type KanbanLink = {
  parentId: string;
  childId: string;
  createdAt: number;
};

export type KanbanAgentSession = {
  agentId: string;
  agentName: string;
  runtime?: string;
  telemetryUrl?: string;
  sessionId: string;
  source?: string;
  startedAt: number;
  updatedAt: number;
  lastMessageCount?: number;
};

export type KanbanTaskAttachment = {
  id: string;
  kind: "image" | "audio" | "file";
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  referencePath?: string;
  referenceOnly?: boolean;
  lastModified?: number;
};

export type KanbanLinkedDirectory = {
  id: string;
  name: string;
  path?: string;
  machineName?: string;
  machineKey?: string;
  lastUsedAt?: number;
};

export type KanbanMachineTarget = {
  key: string;
  name: string;
  collectorUrl?: string;
};

export type KanbanDeliverableKind = "website" | "video" | "image" | "audio" | "document" | "directory" | "file" | "url";

export type KanbanDeliverable = {
  id: string;
  label: string;
  kind: KanbanDeliverableKind;
  path?: string;
  url?: string;
  exists?: boolean;
  createdAt: number;
};

export type KanbanTask = {
  id: string;
  title: string;
  body: string;
  result?: string;
  assignee?: string;
  tenant?: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  workspace: "scratch" | "worktree" | `dir:${string}`;
  /** Origin tag, e.g. "flow:<runId>:<nodeId>", so completion can advance an agent flow. */
  source?: string;
  skills: string[];
  attachments?: KanbanTaskAttachment[];
  linkedDirectories?: KanbanLinkedDirectory[];
  deliverables?: KanbanDeliverable[];
  targetMachine?: KanbanMachineTarget | null;
  projectId?: string;
  proofs?: GitLawbProof[];
  loop?: KanbanLoopSpec;
  loopReceipts?: KanbanLoopReceipt[];
  agentSession?: KanbanAgentSession | null;
  claimLock?: string;
  claimExpiresAt?: number;
  lastHeartbeatAt?: number;
  currentRunId?: string;
  maxRuntimeMs?: number;
  attempt?: number;
  maxAttempts?: number;
  lastFailureReason?: KanbanFailureReason;
  idempotencyKey?: string;
  reviewedAt?: number;
  reviewedBy?: string;
  undoRequestedAt?: number;
  undoRequestedBy?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type KanbanRunStatus = "running" | "completed" | "blocked" | "reclaimed" | "failed";

export type KanbanTaskRun = {
  id: string;
  taskId: string;
  status: KanbanRunStatus;
  assignee?: string;
  runtime?: string;
  claimLock?: string;
  claimExpiresAt?: number;
  startedAt: number;
  endedAt?: number;
  lastHeartbeatAt?: number;
  outcome?: KanbanRunStatus;
  summary?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  attempt?: number;
  parentRunId?: string;
  failureReason?: KanbanFailureReason;
};

export type KanbanBoardMeta = {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  createdAt: number;
  updatedAt: number;
};

export type KanbanBoard = {
  meta: KanbanBoardMeta;
  tasks: KanbanTask[];
  comments: KanbanComment[];
  links: KanbanLink[];
  events: KanbanEvent[];
  runs: KanbanTaskRun[];
};

export type KanbanColumnGroup = KanbanColumn & {
  tasks: KanbanTask[];
};

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "ideas", title: "Ideas", description: "Capture rough thoughts. Nothing runs from here." },
  { id: "ready", title: "Waiting for Queen", description: "Ready for the Queen Bee to assign or take on." },
  { id: "working", title: "Working", description: "Claimed by an agent and actively being handled." },
  { id: "needs-human", title: "Needs You", description: "Blocked on access, approval, or a decision." },
  { id: "done", title: "Done", description: "Finished with notes, evidence, or a result." },
  { id: "archived", title: "Archived", description: "Hidden from the main board, kept for history." },
];

export const KANBAN_STATUSES = KANBAN_COLUMNS.map((column) => column.id);
