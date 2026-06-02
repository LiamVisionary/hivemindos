import type { GitLawbProof } from "@/lib/types/gitlawb";

export type KanbanStatus = "ideas" | "ready" | "working" | "needs-human" | "done" | "archived";

export type KanbanPriority = "low" | "normal" | "high" | "urgent";

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
  skills: string[];
  attachments?: KanbanTaskAttachment[];
  linkedDirectories?: KanbanLinkedDirectory[];
  deliverables?: KanbanDeliverable[];
  targetMachine?: KanbanMachineTarget | null;
  projectId?: string;
  proofs?: GitLawbProof[];
  agentSession?: KanbanAgentSession | null;
  claimLock?: string;
  claimExpiresAt?: number;
  lastHeartbeatAt?: number;
  currentRunId?: string;
  maxRuntimeMs?: number;
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
