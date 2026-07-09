import type { GitLawbProof } from "@/lib/types/gitlawb";
import type {
  LoopAntiPattern,
  LoopBenchmark,
  LoopEvalGate,
  LoopEvalGateKind,
  LoopEvalGatePhase,
  LoopEvalGateStatus,
  LoopExperiment,
  LoopExperimentStatus,
  LoopFrontierItem,
  LoopFrontierStrategy,
  LoopFrontierStrategyKind,
  LoopMetricDirection,
  LoopMode,
  LoopObservation,
  LoopReceipt,
  LoopSpec,
} from "@/lib/types/loops";

export type KanbanStatus = "ideas" | "ready" | "working" | "needs-human" | "done" | "archived";

export type KanbanPriority = "low" | "normal" | "high" | "urgent";

export type KanbanFailureReason =
  | "agent-error"
  | "rate-limit"
  | "timeout"
  | "runtime-offline"
  | "runtime-recovery"
  | "local-directory-error"
  | "manual";

/** @deprecated Use LoopMode from "@/lib/types/loops". */
export type KanbanLoopMode = LoopMode;
/** @deprecated Use LoopEvalGatePhase from "@/lib/types/loops". */
export type KanbanEvalGatePhase = LoopEvalGatePhase;
/** @deprecated Use LoopEvalGateKind from "@/lib/types/loops". */
export type KanbanEvalGateKind = LoopEvalGateKind;
/** @deprecated Use LoopEvalGateStatus from "@/lib/types/loops". */
export type KanbanEvalGateStatus = LoopEvalGateStatus;
/** @deprecated Use LoopEvalGate from "@/lib/types/loops". */
export type KanbanEvalGate = LoopEvalGate;
/** @deprecated Use LoopMetricDirection from "@/lib/types/loops". */
export type KanbanLoopMetricDirection = LoopMetricDirection;
/** @deprecated Use LoopFrontierStrategyKind from "@/lib/types/loops". */
export type KanbanLoopFrontierStrategyKind = LoopFrontierStrategyKind;
/** @deprecated Use LoopFrontierStrategy from "@/lib/types/loops". */
export type KanbanLoopFrontierStrategy = LoopFrontierStrategy;
/** @deprecated Use LoopBenchmark from "@/lib/types/loops". */
export type KanbanLoopBenchmark = LoopBenchmark;
/** @deprecated Use LoopExperimentStatus from "@/lib/types/loops". */
export type KanbanLoopExperimentStatus = LoopExperimentStatus;
/** @deprecated Use LoopExperiment from "@/lib/types/loops". */
export type KanbanLoopExperiment = LoopExperiment;
/** @deprecated Use LoopAntiPattern from "@/lib/types/loops". */
export type KanbanLoopAntiPattern = LoopAntiPattern;
/** @deprecated Use LoopFrontierItem from "@/lib/types/loops". */
export type KanbanLoopFrontierItem = LoopFrontierItem;
/** @deprecated Use LoopObservation from "@/lib/types/loops". */
export type KanbanLoopObservation = LoopObservation;
/** @deprecated Use LoopSpec from "@/lib/types/loops". */
export type KanbanLoopSpec = LoopSpec;
/** @deprecated Use LoopReceipt from "@/lib/types/loops". */
export type KanbanLoopReceipt = LoopReceipt;

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
  /**
   * Display-only downscaled image preview (data URL) for image attachments that
   * are stored as path references (no `dataUrl` sent to the runtime). Never sent
   * to the agent — used purely to render the composer/thread thumbnail.
   */
  previewUrl?: string;
  referencePath?: string;
  referenceKind?: "file" | "directory";
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
  /**
   * Human "parked this" acknowledgement. Set on a needs-human task the operator
   * has SEEN and chosen to defer without deciding: the task keeps status
   * needs-human (so nothing re-routes it) but held tasks are filtered out of
   * re-asking — they leave the approval grid, stop pinging external channels,
   * and stop counting toward the autonomy-pause threshold (so a deferred pile
   * can't wedge the company at paused). Cleared when the task is answered.
   */
  held?: { at: number; by: string; note?: string };
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
