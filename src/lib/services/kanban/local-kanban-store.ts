import { mkdir, open, readFile, rename, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import {
  applyLoopReceipts,
  discoverLoop,
  loopCompletionBlock,
  loopMaxAttempts,
  mergeLoopReceipts,
  normalizeLoopReceipts,
  normalizeLoopSpec,
  recordLoopAntiPatterns,
  recordLoopExperiment,
} from "@/lib/services/kanban/loop-optimizer";
import { gitLawbProofForProject, readProjectRegistry } from "@/lib/services/projects/project-registry";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type {
  GitLawbProof,
  HivemindProject,
} from "@/lib/types/gitlawb";
import type {
  KanbanBoard,
  KanbanBoardMeta,
  KanbanComment,
  KanbanDeliverable,
  KanbanDeliverableKind,
  KanbanEvent,
  KanbanFailureReason,
  KanbanLoopReceipt,
  KanbanPriority,
  KanbanRunStatus,
  KanbanStatus,
  KanbanTask,
  KanbanTaskRun,
} from "@/lib/types/kanban";
import { KANBAN_STATUSES } from "@/lib/types/kanban";
import { moveTaskBetweenColumns, priorityWeight } from "@/lib/utils/kanban-board";

const ROOT_DIR = join(homedir(), ".hivemindos", "kanban");
const BOARDS_DIR = join(ROOT_DIR, "boards");
const DEFAULT_BOARD = "default";
const DEFAULT_VAULT_KANBAN_FOLDER = DEFAULT_SHARED_VAULT.kanbanFolder;
const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;
const DEFAULT_STALE_HEARTBEAT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 2;

type CreateTaskInput = {
  title: string;
  body?: string;
  assignee?: string;
  tenant?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  workspace?: KanbanTask["workspace"];
  skills?: string[];
  attachments?: KanbanTask["attachments"];
  linkedDirectories?: KanbanTask["linkedDirectories"];
  deliverables?: KanbanTask["deliverables"];
  targetMachine?: KanbanTask["targetMachine"];
  projectId?: string;
  proofs?: KanbanTask["proofs"];
  loop?: KanbanTask["loop"];
  loopReceipts?: KanbanTask["loopReceipts"];
  parents?: string[];
  idempotencyKey?: string;
  maxRuntimeMs?: number;
  maxAttempts?: number;
};

type PatchTaskInput = Partial<Pick<KanbanTask, "title" | "body" | "result" | "assignee" | "tenant" | "status" | "priority" | "workspace" | "skills" | "attachments" | "linkedDirectories" | "deliverables" | "targetMachine" | "projectId" | "proofs" | "loopReceipts" | "agentSession" | "reviewedBy" | "undoRequestedBy" | "maxRuntimeMs" | "maxAttempts">> & {
  loop?: KanbanTask["loop"] | null;
  reviewedAt?: number | null;
  undoRequestedAt?: number | null;
};

type ClaimTaskInput = {
  assignee?: string;
  runtime?: string;
  ttlMs?: number;
  claimer?: string;
  tenant?: string;
};

type FinishRunInput = {
  summary?: string;
  result?: string;
  metadata?: Record<string, unknown>;
  loopReceipts?: KanbanLoopReceipt[];
  error?: string;
  reason?: string;
  runId?: string;
  failureReason?: KanbanFailureReason;
};

type ClaimNextTaskInput = ClaimTaskInput & {
  tenant?: string;
  assignee?: string;
  targetMachineKey?: string;
};

export type KanbanStorageOptions = {
  vaultPath?: string | null;
  kanbanFolder?: string | null;
};

export type KanbanStorageInfo = {
  source: "obsidian" | "local";
  root: string;
  boardsRoot: string;
  file: string;
  fallbackReason?: string;
};

export function normalizeBoardSlug(input?: string | null) {
  const slug = (input || DEFAULT_BOARD).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
    throw new Error("Board slug must start with a letter or number and contain only lowercase letters, numbers, hyphens, or underscores.");
  }
  return slug;
}

export function resolveKanbanStorage(slugInput?: string | null, options: KanbanStorageOptions = {}): KanbanStorageInfo {
  const slug = normalizeBoardSlug(slugInput);
  const requestedVault: string | undefined = cleanOptional(options.vaultPath ?? undefined)
    ?? cleanOptional(DEFAULT_SHARED_VAULT.vaultPath ?? undefined);
  const explicitVault = Boolean(cleanOptional(options.vaultPath ?? undefined));
  const folder = normalizeKanbanFolder(options.kanbanFolder) || DEFAULT_VAULT_KANBAN_FOLDER;

  if (requestedVault) {
    const vaultRoot = resolveObsidianVaultPath(requestedVault);
    try {
      if (!statSync(vaultRoot).isDirectory()) throw new Error("Vault path is not a directory.");
      const root = join(vaultRoot, folder);
      const boardsRoot = join(root, "boards");
      return {
        source: "obsidian",
        root,
        boardsRoot,
        file: boardPathFor(root, boardsRoot, slug),
      };
    } catch (error) {
      if (explicitVault) {
        const message = error instanceof Error ? error.message : "Vault path is unavailable.";
        throw new Error(`Kanban vault path is unavailable: ${message}`);
      }
    }
  }

  return {
    source: "local",
    root: ROOT_DIR,
    boardsRoot: BOARDS_DIR,
    file: boardPathFor(ROOT_DIR, BOARDS_DIR, slug),
    fallbackReason: requestedVault ? "Default Obsidian vault path was unavailable." : "No Obsidian vault path configured.",
  };
}

export async function listBoards(options: KanbanStorageOptions = {}) {
  const storage = resolveKanbanStorage(DEFAULT_BOARD, options);
  await mkdir(storage.boardsRoot, { recursive: true, mode: 0o700 });
  const defaultMeta = await readBoardMeta(DEFAULT_BOARD, options);
  const boards = [defaultMeta];
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(storage.boardsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === DEFAULT_BOARD || entry.name === "_archived") continue;
      boards.push(await readBoardMeta(entry.name, options));
    }
  } catch {
    return boards;
  }
  return boards.sort((a, b) => a.name.localeCompare(b.name));
}

async function readBoardMeta(slugInput?: string | null, options: KanbanStorageOptions = {}) {
  const slug = normalizeBoardSlug(slugInput);
  const storage = resolveKanbanStorage(slug, options);
  if (!existsSync(storage.file)) return emptyBoard(slug).meta;
  return readBoardMetaFile(storage.file, slug);
}

async function projectMapForKanban(options: KanbanStorageOptions = {}) {
  try {
    const registry = await readProjectRegistry({ vaultPath: options.vaultPath });
    return new Map(registry.projects.map((project) => [project.id, project]));
  } catch {
    return new Map<string, HivemindProject>();
  }
}

function mergedProjectProofs(task: Pick<KanbanTask, "projectId" | "proofs">, projectsById: Map<string, HivemindProject>) {
  const proofs = Array.isArray(task.proofs) ? task.proofs.map((proof) => sanitizeGitLawbProof(proof) as GitLawbProof) : [];
  if (!task.projectId) return proofs;
  const project = projectsById.get(task.projectId);
  const projectProof = project ? gitLawbProofForProject(project) : null;
  if (!projectProof) return proofs;
  const targetIndex = proofs.findIndex((proof) => proof?.kind === "task");
  if (targetIndex === -1) return [projectProof, ...proofs];
  const target = proofs[targetIndex];
  const next = [...proofs];
  next[targetIndex] = sanitizeGitLawbProof({
    ...projectProof,
    ...target,
    repo: cleanOptional(target.repo) ?? projectProof.repo,
    branch: cleanOptional(target.branch) ?? projectProof.branch,
    title: cleanOptional(target.title) ?? projectProof.title,
    metadata: {
      ...(projectProof.metadata ?? {}),
      ...(target.metadata && typeof target.metadata === "object" ? target.metadata : {}),
    },
  }) as GitLawbProof;
  return next;
}

async function hydrateBoardProjectProofs(board: KanbanBoard, options: KanbanStorageOptions = {}) {
  if (!board.tasks.some((task) => task.projectId)) return board;
  const projectsById = await projectMapForKanban(options);
  if (!projectsById.size) return board;
  return {
    ...board,
    tasks: board.tasks.map((task) => ({
      ...task,
      proofs: mergedProjectProofs(task, projectsById),
    })),
  };
}

export async function readBoard(slugInput?: string | null, options: KanbanStorageOptions = {}): Promise<KanbanBoard> {
  const slug = normalizeBoardSlug(slugInput);
  const storage = resolveKanbanStorage(slug, options);
  if (!existsSync(storage.file)) {
    const defaultVaultBoard = await readDefaultVaultBoardIfPopulated(slug, options, storage);
    if (defaultVaultBoard) return hydrateBoardProjectProofs(defaultVaultBoard, options);
    const localPath = boardPathFor(ROOT_DIR, BOARDS_DIR, slug);
    if (storage.source === "obsidian" && existsSync(localPath)) {
      const migrated = normalizeBoard(await readBoardFile(localPath), slug);
      migrated.events.unshift(event("board.migrated", "Migrated board from local dashboard storage into the shared Obsidian vault."));
      await writeBoard(migrated, options);
      return hydrateBoardProjectProofs(migrated, options);
    }
    const board = emptyBoard(slug);
    await writeBoard(board, options);
    return hydrateBoardProjectProofs(board, options);
  }
  const board = normalizeBoard(await readBoardFile(storage.file), slug);
  if (storage.source === "obsidian" && board.tasks.length === 0) {
    const defaultVaultBoard = await readDefaultVaultBoardIfPopulated(slug, options, storage);
    if (defaultVaultBoard) return hydrateBoardProjectProofs(defaultVaultBoard, options);
  }
  return hydrateBoardProjectProofs(board, options);
}

async function readBoardFile(path: string) {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as KanbanBoard;
}

async function readBoardMetaFile(path: string, slug: string) {
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const match = head.match(/"meta"\s*:\s*(\{[\s\S]*?\})\s*,\s*"tasks"/);
    if (match) {
      return { ...emptyBoard(slug).meta, ...JSON.parse(match[1]), slug } as KanbanBoardMeta;
    }
  } finally {
    await handle.close();
  }
  return normalizeBoard(await readBoardFile(path), slug).meta;
}

async function readDefaultVaultBoardIfPopulated(slug: string, options: KanbanStorageOptions, currentStorage: KanbanStorageInfo) {
  if (currentStorage.source !== "obsidian") return null;
  const requestedFolder = safeVaultFolder(options.kanbanFolder);
  if (!requestedFolder || requestedFolder === safeVaultFolder(DEFAULT_VAULT_KANBAN_FOLDER)) return null;
  for (const fallbackSlug of [slug, DEFAULT_BOARD]) {
    const defaultStorage = resolveKanbanStorage(fallbackSlug, { ...options, kanbanFolder: DEFAULT_VAULT_KANBAN_FOLDER });
    if (defaultStorage.file === currentStorage.file || !existsSync(defaultStorage.file)) continue;
    const defaultBoard = normalizeBoard(await readBoardFile(defaultStorage.file), fallbackSlug);
    if (defaultBoard.tasks.length > 0) return defaultBoard;
  }
  return null;
}

function normalizeBoard(parsed: KanbanBoard, slug: string): KanbanBoard {
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [];
  const board = {
    ...emptyBoard(slug),
    ...parsed,
    meta: { ...emptyBoard(slug).meta, ...parsed.meta, slug },
    tasks,
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    links: Array.isArray(parsed.links) ? parsed.links : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs.map(normalizeRun) : [],
  };
  rollUpCompletedChildDeliverables(board);
  return board;
}

function normalizeTask(task: KanbanTask): KanbanTask {
  const storedDeliverables = Array.isArray(task.deliverables)
    ? task.deliverables.map(normalizeDeliverable).filter(Boolean) as KanbanDeliverable[]
    : [];
  const normalizedStatus = normalizeKanbanStatus(task.status);
  const extractedDeliverables = normalizedStatus === "done" ? extractTaskDeliverables(task, task.result, task.updatedAt) : [];
  return {
    ...task,
    status: normalizedStatus,
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    linkedDirectories: Array.isArray(task.linkedDirectories) ? task.linkedDirectories : [],
    deliverables: filterSourceDeliverables(task, storedDeliverables.length ? storedDeliverables : extractedDeliverables),
    targetMachine: task.targetMachine?.key ? task.targetMachine : null,
    projectId: cleanOptional(task.projectId),
    proofs: Array.isArray(task.proofs) ? task.proofs.map((proof) => sanitizeGitLawbProof(proof)) : [],
    loop: normalizeLoopSpec(task.loop, task.maxAttempts, task.maxRuntimeMs),
    loopReceipts: normalizeLoopReceipts(task.loopReceipts),
    claimLock: cleanOptional(task.claimLock),
    currentRunId: cleanOptional(task.currentRunId),
    attempt: positiveInteger(task.attempt) ?? 1,
    maxAttempts: positiveInteger(task.maxAttempts) ?? loopMaxAttempts(task.loop) ?? DEFAULT_MAX_ATTEMPTS,
    lastFailureReason: normalizeFailureReason(task.lastFailureReason),
  };
}

function normalizeDeliverable(value: unknown): KanbanDeliverable | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<KanbanDeliverable>;
  const target = item.path || item.url;
  if (!target) return null;
  const kind = normalizeDeliverableKind(item.kind, item.path, item.url);
  return {
    id: cleanOptional(item.id) ?? deliverableId(target),
    label: cleanOptional(item.label) ?? deliverableLabel(target, kind),
    kind,
    path: cleanOptional(item.path),
    url: cleanOptional(item.url),
    exists: typeof item.exists === "boolean" ? item.exists : item.path ? existsSync(item.path) : undefined,
    createdAt: positiveNumber(item.createdAt) ?? Date.now(),
  };
}

function normalizeRun(run: KanbanTaskRun): KanbanTaskRun {
  return {
    ...run,
    status: normalizeRunStatus(run.status),
    outcome: run.outcome ? normalizeRunStatus(run.outcome) : run.outcome,
    attempt: positiveInteger(run.attempt),
    parentRunId: cleanOptional(run.parentRunId),
    failureReason: normalizeFailureReason(run.failureReason),
  };
}

function normalizeRunStatus(status: string): KanbanRunStatus {
  return ["running", "completed", "blocked", "reclaimed", "failed"].includes(status) ? status as KanbanRunStatus : "failed";
}

function normalizeKanbanStatus(status: string): KanbanStatus {
  if (status === "triage") return "ideas";
  if (status === "todo") return "ready";
  if (status === "running") return "working";
  if (status === "blocked") return "needs-human";
  return KANBAN_STATUSES.includes(status as KanbanStatus) ? status as KanbanStatus : "ideas";
}

export async function createBoard(input: Partial<KanbanBoardMeta> & { slug: string }, options: KanbanStorageOptions = {}) {
  const slug = normalizeBoardSlug(input.slug);
  const board = await readBoard(slug, options);
  board.meta = {
    ...board.meta,
    name: input.name?.trim() || board.meta.name,
    description: input.description?.trim() || board.meta.description,
    icon: input.icon?.trim() || board.meta.icon,
    updatedAt: Date.now(),
  };
  board.events.unshift(event("board.created", `Created board ${board.meta.name}`));
  await writeBoard(board, options);
  return board;
}

export async function archiveBoard(slugInput: string, options: KanbanStorageOptions = {}) {
  const slug = normalizeBoardSlug(slugInput);
  if (slug === DEFAULT_BOARD) throw new Error("The default board cannot be archived.");
  const storage = resolveKanbanStorage(slug, options);
  const from = boardDirFor(storage.root, storage.boardsRoot, slug);
  if (!existsSync(from)) throw new Error("Board not found.");
  const archivedDir = join(storage.boardsRoot, "_archived");
  await mkdir(archivedDir, { recursive: true, mode: 0o700 });
  await rename(from, join(archivedDir, `${slug}-${Date.now()}`));
}

export async function createTask(slug: string | null, input: CreateTaskInput, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const projectsById = await projectMapForKanban(options);
  const title = input.title?.trim();
  if (!title) throw new Error("Task title is required.");
  if (input.idempotencyKey) {
    const existing = board.tasks.find((task) => task.idempotencyKey === input.idempotencyKey);
    if (existing) return { board, task: existing, created: false };
  }
  const now = Date.now();
  const requestedStatus = input.status && KANBAN_STATUSES.includes(input.status) ? input.status : "ideas";
  const parents = input.parents ?? [];
  const existingTasksById = new Map(board.tasks.map((task) => [task.id, task]));
  const hasUnfinishedParents = parents.some((parentId) => {
    const parent = existingTasksById.get(parentId);
    return parent && parent.status !== "done" && parent.status !== "archived";
  });
  const loop = normalizeLoopSpec(input.loop, input.maxAttempts, input.maxRuntimeMs);
  const taskBase: KanbanTask = {
    id: `t_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    body: input.body?.trim() ?? "",
    assignee: cleanOptional(input.assignee),
    tenant: cleanOptional(input.tenant),
    status: hasUnfinishedParents ? "ideas" : requestedStatus,
    priority: input.priority ?? "normal",
    workspace: input.workspace ?? "scratch",
    skills: input.skills ?? [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    linkedDirectories: Array.isArray(input.linkedDirectories) ? input.linkedDirectories : [],
    deliverables: Array.isArray(input.deliverables) ? input.deliverables : [],
    targetMachine: input.targetMachine?.key ? input.targetMachine : null,
    projectId: cleanOptional(input.projectId),
    proofs: Array.isArray(input.proofs) ? input.proofs.map((proof) => sanitizeGitLawbProof(proof)) : [],
    loop,
    loopReceipts: normalizeLoopReceipts(input.loopReceipts),
    maxRuntimeMs: positiveNumber(input.maxRuntimeMs) ?? loop?.budget?.maxRuntimeMs,
    attempt: 1,
    maxAttempts: positiveInteger(input.maxAttempts) ?? loopMaxAttempts(loop) ?? DEFAULT_MAX_ATTEMPTS,
    idempotencyKey: cleanOptional(input.idempotencyKey),
    createdAt: now,
    updatedAt: now,
  };
  const task: KanbanTask = {
    ...taskBase,
    proofs: mergedProjectProofs(taskBase, projectsById),
  };
  board.tasks.unshift(task);
  for (const parentId of parents) {
    board.links.push({ parentId, childId: task.id, createdAt: now });
  }
  board.events.unshift(event("task.created", `Created ${task.title}`, task.id));
  promoteReadyChildren(board, "dependency.auto-promote");
  await writeBoard(touch(board), options);
  return { board, task, created: true };
}

export async function patchTask(slug: string | null, taskId: string, patch: PatchTaskInput, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const projectsById = await projectMapForKanban(options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const fromStatus = task.status;
  const nextStatus = patch.status && KANBAN_STATUSES.includes(patch.status) ? patch.status : undefined;
  const retryingWorking = nextStatus === "working" && isRetryBlockerResult(task.result);
  const changedBase = {
    ...task,
    ...patch,
    status: nextStatus ?? task.status,
    title: patch.title?.trim() || task.title,
    body: patch.body ?? task.body,
    assignee: patch.assignee === "" ? undefined : patch.assignee ?? task.assignee,
    tenant: patch.tenant === "" ? undefined : patch.tenant ?? task.tenant,
    attachments: patch.attachments ?? task.attachments,
    linkedDirectories: patch.linkedDirectories ?? task.linkedDirectories,
    deliverables: patch.deliverables ?? task.deliverables,
    targetMachine: patch.targetMachine === null ? null : patch.targetMachine ?? task.targetMachine,
    projectId: patch.projectId === "" ? undefined : patch.projectId ?? task.projectId,
    proofs: Array.isArray(patch.proofs) ? patch.proofs.map((proof) => sanitizeGitLawbProof(proof)) : task.proofs,
    loop: patch.loop === null ? undefined : patch.loop !== undefined ? normalizeLoopSpec(patch.loop, patch.maxAttempts ?? task.maxAttempts, patch.maxRuntimeMs ?? task.maxRuntimeMs) : task.loop,
    loopReceipts: patch.loopReceipts ? normalizeLoopReceipts(patch.loopReceipts) : task.loopReceipts,
    result: retryingWorking ? patch.result ?? "" : patch.result ?? task.result,
    agentSession: retryingWorking ? patch.agentSession ?? undefined : patch.agentSession ?? task.agentSession,
    reviewedAt: patch.reviewedAt === null ? undefined : patch.reviewedAt ?? task.reviewedAt,
    reviewedBy: patch.reviewedBy === "" ? undefined : patch.reviewedBy ?? task.reviewedBy,
    undoRequestedAt: patch.undoRequestedAt === null ? undefined : patch.undoRequestedAt ?? task.undoRequestedAt,
    undoRequestedBy: patch.undoRequestedBy === "" ? undefined : patch.undoRequestedBy ?? task.undoRequestedBy,
    maxAttempts: positiveInteger(patch.maxAttempts) ?? loopMaxAttempts(patch.loop ?? task.loop) ?? task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    updatedAt: Date.now(),
    completedAt: nextStatus ? (nextStatus === "done" ? Date.now() : undefined) : task.completedAt,
  };
  const changed = {
    ...changedBase,
    proofs: mergedProjectProofs(changedBase, projectsById),
  };
  if (changed.status === "done") {
    changed.deliverables = mergeDeliverables(
      changed.deliverables,
      extractTaskDeliverables(changed, changed.result, changed.completedAt ?? changed.updatedAt),
    );
  } else if (nextStatus && nextStatus !== "done" && !patch.deliverables) {
    changed.deliverables = [];
  }
  if (nextStatus && nextStatus !== "working") {
    changed.claimLock = undefined;
    changed.claimExpiresAt = undefined;
    changed.lastHeartbeatAt = nextStatus === "ready" ? undefined : changed.lastHeartbeatAt;
    if (task.currentRunId && ["done", "needs-human", "archived"].includes(nextStatus)) {
      finishActiveRun(board, task.id, nextStatus === "done" ? "completed" : nextStatus === "needs-human" ? "blocked" : "reclaimed", {
        summary: patch.result ?? task.result,
        reason: nextStatus,
      });
      changed.currentRunId = undefined;
    }
  }
  if (isUnpollableAcceptedWorking(changed)) {
    changed.status = "needs-human";
    changed.result = "Agent accepted the task but did not attach a pollable session or return output. Check the agent runtime/auth, then move this card back to Ready for Queen.";
  }
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  if (changed.status === "done") rollUpCompletedChildDeliverables(board, changed.id, true);
  board.events.unshift(event(
    nextStatus && nextStatus !== fromStatus ? "task.moved" : "task.updated",
    nextStatus && nextStatus !== fromStatus ? `Moved ${changed.title} from ${fromStatus} to ${nextStatus}` : `Updated ${changed.title}`,
    taskId,
  ));
  if (changed.status === "done") {
    createVisualHandoffChild(board, changed, changed.result);
    promoteReadyChildren(board, "dependency.auto-promote");
  }
  await writeBoard(touch(board), options);
  return { board, task: changed };
}

export async function moveTask(slug: string | null, taskId: string, status: KanbanStatus, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  board.tasks = moveTaskBetweenColumns(board.tasks, taskId, status);
  const moved = board.tasks.find((item) => item.id === taskId);
  if (moved && status === "ready") {
    moved.assignee = undefined;
    moved.tenant = undefined;
    moved.agentSession = null;
    moved.claimLock = undefined;
    moved.claimExpiresAt = undefined;
    moved.lastHeartbeatAt = undefined;
    moved.currentRunId = undefined;
  }
  if (moved && status === "working" && isRetryBlockerResult(moved.result)) {
    moved.result = "";
    moved.agentSession = null;
  }
  if (moved && status === "done") {
    moved.deliverables = mergeDeliverables(
      moved.deliverables,
      extractTaskDeliverables(moved, moved.result, Date.now()),
    );
    rollUpCompletedChildDeliverables(board, moved.id, true);
  } else if (moved && status !== "done") {
    moved.deliverables = [];
  }
  if (moved && isUnpollableAcceptedWorking(moved)) {
    moved.status = "needs-human";
    moved.result = "This task cannot be marked Working because the assigned agent has no active session. Fix the agent runtime/auth, then move it back to Waiting for Queen.";
    board.events.unshift(event("task.blocked", `${moved.title} needs agent runtime/auth before it can work`, taskId));
  }
  if (task.currentRunId && ["ready", "needs-human", "done", "archived"].includes(moved?.status ?? status)) {
    finishActiveRun(board, taskId, status === "done" ? "completed" : status === "needs-human" ? "blocked" : "reclaimed", {
      summary: moved?.result ?? task.result,
      reason: `moved to ${status}`,
    });
    if (moved) moved.currentRunId = undefined;
  }
  board.events.unshift(event("task.moved", `Moved ${task.title} to ${status}`, taskId));
  if (moved?.status === "done") promoteReadyChildren(board, "dependency.auto-promote");
  await writeBoard(touch(board), options);
  return { board, task: board.tasks.find((item) => item.id === taskId)! };
}

export async function claimTask(slug: string | null, taskId: string, input: ClaimTaskInput = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const result = await claimReadyTask(board, task, input, options);
  await writeBoard(touch(board), options);
  return result;
}

export async function claimNextTask(slug: string | null, input: ClaimNextTaskInput = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = nextClaimCandidate(board, input);
  if (!task) return { board, task: null, run: null, claimed: false };
  const result = await claimReadyTask(board, task, input, options);
  await writeBoard(touch(board), options);
  return { ...result, claimed: true };
}

function nextClaimCandidate(board: KanbanBoard, input: ClaimNextTaskInput = {}) {
  const tenant = cleanOptional(input.tenant);
  const assignee = cleanOptional(input.assignee);
  const targetMachineKey = cleanOptional(input.targetMachineKey);
  return board.tasks
    .filter((task) => task.status === "ready" && !task.claimLock)
    .filter((task) => !tenant || task.tenant === tenant || !task.tenant)
    .filter((task) => !assignee || task.assignee === assignee || !task.assignee)
    .filter((task) => !targetMachineKey || task.targetMachine?.key === targetMachineKey || !task.targetMachine?.key)
    .filter((task) => unfinishedParentIds(board, task.id).length === 0)
    .sort((left, right) => {
      const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
      return priorityDelta || left.createdAt - right.createdAt || left.updatedAt - right.updatedAt;
    })[0];
}

async function claimReadyTask(board: KanbanBoard, task: KanbanTask, input: ClaimTaskInput = {}, options: KanbanStorageOptions = {}) {
  if (task.status !== "ready" || task.claimLock) throw new Error("Task is not ready to claim.");
  const blockingParents = unfinishedParentIds(board, task.id);
  if (blockingParents.length) {
    task.status = "ideas";
    board.events.unshift(event("task.claim-rejected", `${task.title} is waiting on parent tasks.`, task.id, { parents: blockingParents }));
    await writeBoard(touch(board), options);
    throw new Error(`Task has unfinished parent dependencies: ${blockingParents.join(", ")}`);
  }
  const now = Date.now();
  const claimLock = input.claimer?.trim() || `claim_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const attempt = positiveInteger(task.attempt) ?? 1;
  const run: KanbanTaskRun = {
    id: `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: task.id,
    status: "running",
    assignee: cleanOptional(input.assignee) ?? task.assignee,
    runtime: cleanOptional(input.runtime),
    claimLock,
    claimExpiresAt: now + (positiveNumber(input.ttlMs) ?? task.maxRuntimeMs ?? DEFAULT_CLAIM_TTL_MS),
    startedAt: now,
    lastHeartbeatAt: now,
    attempt,
  };
  board.runs.unshift(run);
  const changed: KanbanTask = {
    ...task,
    status: "working",
    assignee: run.assignee ?? task.assignee,
    tenant: cleanOptional(input.tenant) ?? task.tenant,
    claimLock,
    claimExpiresAt: run.claimExpiresAt,
    lastHeartbeatAt: now,
    currentRunId: run.id,
    attempt,
    updatedAt: now,
  };
  board.tasks = board.tasks.map((item) => item.id === task.id ? changed : item);
  board.events.unshift(event("task.claimed", `Claimed ${task.title}`, task.id, { lock: claimLock, runId: run.id, expiresAt: run.claimExpiresAt }, run.id));
  return { board, task: changed, run };
}

export async function heartbeatTask(slug: string | null, taskId: string, note?: string, claimLock?: string, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "working") throw new Error("Task is not working.");
  if (claimLock && task.claimLock && claimLock !== task.claimLock) throw new Error("Claim lock does not match.");
  const now = Date.now();
  const expiresAt = now + (task.maxRuntimeMs ?? DEFAULT_CLAIM_TTL_MS);
  task.lastHeartbeatAt = now;
  task.claimExpiresAt = expiresAt;
  task.updatedAt = now;
  const run = task.currentRunId ? board.runs.find((item) => item.id === task.currentRunId) : undefined;
  if (run && run.status === "running") {
    run.lastHeartbeatAt = now;
    run.claimExpiresAt = expiresAt;
  }
  board.events.unshift(event("task.heartbeat", note?.trim() || `Heartbeat for ${task.title}`, task.id, { note: note?.trim() || undefined }, run?.id));
  await writeBoard(touch(board), options);
  return { board, task, run };
}

export async function completeTask(slug: string | null, taskId: string, input: FinishRunInput = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const now = Date.now();
  const result = input.result ?? input.summary ?? task.result;
  const loopReceipts = mergeLoopReceipts(task.loopReceipts, input.loopReceipts);
  const gateBlock = loopCompletionBlock(task.loop, loopReceipts);
  if (gateBlock) {
    const summary = `${input.summary ?? result ?? "Completion blocked."} Missing passing eval receipts: ${gateBlock.missingGateTitles.join(", ")}.`;
    finishActiveRun(board, taskId, "blocked", { ...input, summary, reason: summary });
    const changed: KanbanTask = {
      ...task,
      status: "needs-human",
      result: summary,
      loopReceipts,
      claimLock: undefined,
      claimExpiresAt: undefined,
      currentRunId: undefined,
      updatedAt: now,
    };
    board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
    board.events.unshift(event("loop.eval-blocked", `${task.title} needs eval evidence before completion`, task.id, { missingGateIds: gateBlock.missingGateIds, missingGateTitles: gateBlock.missingGateTitles }, input.runId ?? task.currentRunId));
    await writeBoard(touch(board), options);
    return { board, task: changed, blocked: true, missingGateIds: gateBlock.missingGateIds };
  }
  finishActiveRun(board, taskId, "completed", input);
  const changed: KanbanTask = {
    ...task,
    status: "done",
    result,
    loop: applyLoopReceipts(task.loop, loopReceipts),
    loopReceipts,
    deliverables: mergeDeliverables(
      task.deliverables,
      extractTaskDeliverables(task, result, now),
    ),
    claimLock: undefined,
    claimExpiresAt: undefined,
    currentRunId: undefined,
    updatedAt: now,
    completedAt: now,
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  rollUpCompletedChildDeliverables(board, taskId, true);
  board.events.unshift(event("task.completed", `Completed ${task.title}`, task.id, { summary: input.summary ?? result }, input.runId ?? task.currentRunId));
  createVisualHandoffChild(board, changed, result);
  promoteReadyChildren(board, "dependency.auto-promote");
  await writeBoard(touch(board), options);
  return { board, task: changed };
}

export async function discoverTaskLoop(slug: string | null, taskId: string, input: Record<string, unknown> = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const now = Date.now();
  const loop = discoverLoop(task.loop, input);
  const changed: KanbanTask = {
    ...task,
    loop,
    maxRuntimeMs: positiveNumber(task.maxRuntimeMs) ?? loop.budget?.maxRuntimeMs,
    maxAttempts: positiveInteger(task.maxAttempts) ?? loopMaxAttempts(loop) ?? DEFAULT_MAX_ATTEMPTS,
    updatedAt: now,
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event("loop.discovered", `Discovered loop benchmark for ${task.title}`, task.id, {
    benchmark: loop.benchmark,
    frontierStrategy: loop.frontierStrategy,
    gateCount: loop.evalGates.length,
  }));
  await writeBoard(touch(board), options);
  return { board, task: changed, observation: loop.observation };
}

export async function recordTaskLoop(slug: string | null, taskId: string, input: { experiment?: Record<string, unknown>; antiPatterns?: unknown[] } = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  let loop = task.loop;
  if (input.experiment?.hypothesis) {
    loop = recordLoopExperiment(loop, input.experiment as Parameters<typeof recordLoopExperiment>[1]);
  }
  if (Array.isArray(input.antiPatterns)) {
    loop = recordLoopAntiPatterns(loop, input.antiPatterns);
  }
  if (!loop) throw new Error("Loop record requires an experiment or anti-pattern.");
  const changed: KanbanTask = {
    ...task,
    loop,
    updatedAt: Date.now(),
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event("loop.recorded", `Recorded loop evidence for ${task.title}`, task.id, {
    experimentId: input.experiment?.id,
    experimentStatus: input.experiment?.status,
    score: input.experiment?.score,
    antiPatternCount: Array.isArray(input.antiPatterns) ? input.antiPatterns.length : 0,
    observation: loop.observation,
  }));
  await writeBoard(touch(board), options);
  return { board, task: changed, observation: loop.observation };
}

export async function failTask(slug: string | null, taskId: string, input: FinishRunInput = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const now = Date.now();
  const failureReason = normalizeFailureReason(input.failureReason) ?? classifyKanbanFailure(input.error ?? input.reason ?? input.summary ?? input.result);
  const summary = input.summary ?? input.error ?? input.reason ?? input.result ?? "Task failed.";
  const run = finishActiveRun(board, taskId, "failed", { ...input, summary, failureReason });
  const { task: changed, retried } = transitionTaskAfterFailure(task, failureReason, summary, now);
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event(
    retried ? "task.retry-queued" : "task.failed",
    retried ? `Queued retry for ${task.title}` : `${task.title} needs human review after failure`,
    task.id,
    { failureReason, attempt: changed.attempt, maxAttempts: changed.maxAttempts, summary },
    run?.id ?? input.runId ?? task.currentRunId,
  ));
  await writeBoard(touch(board), options);
  return { board, task: changed, run, retried, failureReason };
}

export async function blockTask(slug: string | null, taskId: string, reason: string, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const now = Date.now();
  finishActiveRun(board, taskId, "blocked", { reason, summary: reason });
  const changed: KanbanTask = {
    ...task,
    status: "needs-human",
    result: reason.trim() || task.result,
    claimLock: undefined,
    claimExpiresAt: undefined,
    currentRunId: undefined,
    updatedAt: now,
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event("task.blocked", `${task.title} needs human input`, task.id, { reason }));
  await writeBoard(touch(board), options);
  return { board, task: changed };
}

export async function unblockTask(slug: string | null, taskId: string, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const status: KanbanStatus = unfinishedParentIds(board, taskId).length ? "ideas" : "ready";
  const changed: KanbanTask = {
    ...task,
    status,
    claimLock: undefined,
    claimExpiresAt: undefined,
    lastHeartbeatAt: undefined,
    currentRunId: undefined,
    updatedAt: Date.now(),
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event("task.unblocked", `Unblocked ${task.title}`, task.id, { status }));
  await writeBoard(touch(board), options);
  return { board, task: changed };
}

export async function promoteTask(slug: string | null, taskId: string, input: { force?: boolean; reason?: string; dryRun?: boolean } = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  if (!["ideas", "needs-human"].includes(task.status)) throw new Error(`Task is '${task.status}'; promote only applies to Ideas or Needs You tasks.`);
  const blockingParents = unfinishedParentIds(board, taskId);
  if (blockingParents.length && !input.force) throw new Error(`Task has unfinished parent dependencies: ${blockingParents.join(", ")}`);
  if (input.dryRun) return { board, task, promoted: true };
  const changed: KanbanTask = {
    ...task,
    status: "ready",
    claimLock: undefined,
    claimExpiresAt: undefined,
    lastHeartbeatAt: undefined,
    currentRunId: undefined,
    updatedAt: Date.now(),
  };
  board.tasks = board.tasks.map((item) => item.id === taskId ? changed : item);
  board.events.unshift(event("task.promoted", `Promoted ${task.title} to Ready`, task.id, { reason: input.reason, forced: Boolean(input.force) }));
  await writeBoard(touch(board), options);
  return { board, task: changed, promoted: true };
}

export async function reclaimStaleTasks(slug: string | null, input: { staleMs?: number } = {}, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const staleMs = positiveNumber(input.staleMs) ?? DEFAULT_STALE_HEARTBEAT_MS;
  const now = Date.now();
  const reclaimed: KanbanTask[] = [];
  board.tasks = board.tasks.map((task) => {
    if (task.status !== "working") return task;
    const lastProgress = task.lastHeartbeatAt ?? task.agentSession?.updatedAt ?? task.updatedAt;
    const expired = Boolean(task.claimExpiresAt && task.claimExpiresAt <= now);
    const quiet = now - lastProgress >= staleMs;
    if (!expired && !quiet) return task;
    const summary = `Reclaimed after ${Math.round((now - lastProgress) / 1000)}s without worker progress.`;
    finishActiveRun(board, task.id, "reclaimed", { summary, failureReason: "timeout" });
    const { task: changed, retried } = transitionTaskAfterFailure(task, "timeout", summary, now);
    reclaimed.push(changed);
    board.events.unshift(event(
      retried ? "task.reclaimed" : "task.reclaim-exhausted",
      retried ? `Reclaimed stale task ${task.title}` : `${task.title} exhausted stale-task retries`,
      task.id,
      { staleMs, lastProgressAt: lastProgress, attempt: changed.attempt, maxAttempts: changed.maxAttempts },
      task.currentRunId,
    ));
    return changed;
  });
  if (reclaimed.length) await writeBoard(touch(board), options);
  return { board, reclaimed };
}

export async function bulkPatchTasks(slug: string | null, ids: string[], patch: PatchTaskInput, options: KanbanStorageOptions = {}) {
  const results: Array<{ taskId: string; ok: boolean; task?: KanbanTask; error?: string }> = [];
  let latestBoard: KanbanBoard | null = null;
  for (const taskId of [...new Set(ids)]) {
    try {
      const result = patch.status
        ? await moveTask(slug, taskId, patch.status, options)
        : await patchTask(slug, taskId, patch, options);
      latestBoard = result.board;
      results.push({ taskId, ok: true, task: result.task });
    } catch (error) {
      results.push({ taskId, ok: false, error: error instanceof Error ? error.message : "Task update failed." });
    }
  }
  return { board: latestBoard ?? await readBoard(slug, options), results };
}

export async function deleteTask(slug: string | null, taskId: string, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  board.tasks = board.tasks.filter((item) => item.id !== taskId);
  board.comments = board.comments.filter((comment) => comment.taskId !== taskId);
  board.links = board.links.filter((link) => link.parentId !== taskId && link.childId !== taskId);
  board.events.unshift(event("task.deleted", `Deleted ${task.title}`));
  await writeBoard(touch(board), options);
  return { board, task };
}

export async function addComment(slug: string | null, taskId: string, body: string, author = "dashboard", options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  const comment: KanbanComment = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    author: author.trim() || "dashboard",
    body: body.trim(),
    createdAt: Date.now(),
  };
  if (!comment.body) throw new Error("Comment body is required.");
  board.comments.push(comment);
  board.events.unshift(event("comment.created", `${comment.author} commented on ${task.title}`, taskId));
  await writeBoard(touch(board), options);
  return { board, comment };
}

export async function addLink(slug: string | null, parentId: string, childId: string, options: KanbanStorageOptions = {}) {
  const board = await readBoard(slug, options);
  const ids = new Set(board.tasks.map((task) => task.id));
  if (!ids.has(parentId) || !ids.has(childId)) throw new Error("Both linked tasks must exist.");
  if (!board.links.some((link) => link.parentId === parentId && link.childId === childId)) {
    board.links.push({ parentId, childId, createdAt: Date.now() });
    board.events.unshift(event("task.linked", `Linked ${parentId} -> ${childId}`, childId));
    await writeBoard(touch(board), options);
  }
  return { board };
}

async function writeBoard(board: KanbanBoard, options: KanbanStorageOptions = {}) {
  const storage = resolveKanbanStorage(board.meta.slug, options);
  const dir = boardDirFor(storage.root, storage.boardsRoot, board.meta.slug);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const data = JSON.stringify(board, null, 2) + "\n";
  const tmp = `${storage.file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, storage.file);
}

function emptyBoard(slug: string): KanbanBoard {
  const now = Date.now();
  return {
    meta: { slug, name: slug === DEFAULT_BOARD ? "Default" : titleize(slug), createdAt: now, updatedAt: now },
    tasks: [],
    comments: [],
    links: [],
    events: [],
    runs: [],
  };
}

function event(kind: string, message: string, taskId?: string, payload?: Record<string, unknown>, runId?: string): KanbanEvent {
  return {
    id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    runId,
    kind,
    message,
    payload,
    createdAt: Date.now(),
  };
}

function touch(board: KanbanBoard) {
  return { ...board, meta: { ...board.meta, updatedAt: Date.now() } };
}

function boardDirFor(root: string, boardsRoot: string, slug: string) {
  return slug === DEFAULT_BOARD ? root : join(boardsRoot, slug);
}

function boardPathFor(root: string, boardsRoot: string, slug: string) {
  return join(boardDirFor(root, boardsRoot, slug), "kanban.json");
}

function cleanOptional(value?: string | null) {
  return value?.trim() || undefined;
}

function positiveNumber(value?: number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveInteger(value?: number | null) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeFailureReason(value?: string | null): KanbanFailureReason | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return ["agent-error", "timeout", "runtime-offline", "runtime-recovery", "local-directory-error", "manual"].includes(normalized)
    ? normalized as KanbanFailureReason
    : undefined;
}

function classifyKanbanFailure(value?: string | null): KanbanFailureReason {
  const normalized = value?.toLowerCase() ?? "";
  if (/local directory|workdir|workspace path|folder|enoent|permission denied/.test(normalized)) return "local-directory-error";
  if (/orphan|recover|reclaim|daemon restart|runtime recovery/.test(normalized)) return "runtime-recovery";
  if (/offline|unreachable|connection refused|network|econnrefused|not available/.test(normalized)) return "runtime-offline";
  if (/timeout|timed out|expired|stale|heartbeat|no progress|without worker progress/.test(normalized)) return "timeout";
  if (/manual|cancelled|canceled|user requested/.test(normalized)) return "manual";
  return "agent-error";
}

function isRetryableFailureReason(reason: KanbanFailureReason) {
  return ["timeout", "runtime-offline", "runtime-recovery", "local-directory-error"].includes(reason);
}

function transitionTaskAfterFailure(task: KanbanTask, failureReason: KanbanFailureReason, summary: string, now = Date.now()) {
  const attempt = positiveInteger(task.attempt) ?? 1;
  const maxAttempts = positiveInteger(task.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS;
  const nextAttempt = attempt + 1;
  const retried = isRetryableFailureReason(failureReason) && attempt < maxAttempts;
  const taskBase: KanbanTask = {
    ...task,
    assignee: retried ? undefined : task.assignee,
    tenant: retried ? undefined : task.tenant,
    agentSession: null,
    claimLock: undefined,
    claimExpiresAt: undefined,
    lastHeartbeatAt: undefined,
    currentRunId: undefined,
    lastFailureReason: failureReason,
    maxAttempts,
    updatedAt: now,
  };
  if (retried) {
    return {
      retried,
      task: {
        ...taskBase,
        status: "ready" as const,
        attempt: nextAttempt,
        result: `Auto-retry ${nextAttempt}/${maxAttempts} queued after ${failureReason}: ${summary}`,
      },
    };
  }
  return {
    retried,
    task: {
      ...taskBase,
      status: "needs-human" as const,
      attempt,
      result: `${summary} Failure reason: ${failureReason}. Attempts: ${attempt}/${maxAttempts}.`,
    },
  };
}

function simpleStableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function deliverableId(target: string) {
  return `d_${simpleStableHash(target)}`;
}

function normalizeDeliverableKind(kind?: string, path?: string, url?: string): KanbanDeliverableKind {
  if (kind && ["website", "video", "image", "audio", "document", "directory", "file", "url"].includes(kind)) {
    return kind as KanbanDeliverableKind;
  }
  if (url && !url.startsWith("file:")) return "url";
  if (path && existsSync(path)) {
    try {
      if (statSync(path).isDirectory()) return "directory";
    } catch {
      // Fall through to extension-based detection.
    }
  }
  const target = (path || url || "").toLowerCase().split(/[?#]/)[0];
  if (/\.(?:html?)$/.test(target)) return "website";
  if (/\.(?:mp4|mov|m4v|webm|avi|mkv)$/.test(target)) return "video";
  if (/\.(?:png|jpe?g|gif|webp|svg|avif)$/.test(target)) return "image";
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/.test(target)) return "audio";
  if (/\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|md)$/.test(target)) return "document";
  return path ? "file" : "url";
}

function deliverableLabel(target: string, kind: KanbanDeliverableKind) {
  const clean = target.replace(/^file:\/\//, "").split(/[?#]/)[0].replace(/\/+$/, "");
  return clean.split(/[\\/]/).filter(Boolean).at(-1) || kind;
}

function deliverableFromTarget(target: string, label?: string, createdAt = Date.now()): KanbanDeliverable | null {
  const trimmed = target.trim().replace(/[),.;:]+$/, "");
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    if (/^https?:\/\/(?:www\.)?w3\.org\/2000\/svg\b/i.test(trimmed)) return null;
    const kind = normalizeDeliverableKind(undefined, undefined, trimmed);
    return { id: deliverableId(trimmed), label: label?.trim() || deliverableLabel(trimmed, kind), kind, url: trimmed, createdAt };
  }
  const fileUrl = trimmed.match(/^file:\/\/(.+)/i)?.[1];
  const path = decodeURIComponent(fileUrl || trimmed);
  if (!isAbsolute(path)) return null;
  const kind = normalizeDeliverableKind(undefined, path);
  return {
    id: deliverableId(path),
    label: label?.trim() || deliverableLabel(path, kind),
    kind,
    path,
    exists: existsSync(path),
    createdAt,
  };
}

function extractKanbanDeliverables(text: string, createdAt = Date.now()): KanbanDeliverable[] {
  const deliverables = new Map<string, KanbanDeliverable>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const labeled = line.match(/^\s*(?:[-*]\s*)?([^:\n]{3,80}?)\s*:\s*(file:\/\/\/[^\s]+|https?:\/\/[^\s]+|\/[^\s"'<>]+(?:\s+[^\s"'<>]+)*?)(?:\s*)$/i);
    if (labeled) {
      const item = deliverableFromTarget(labeled[2], labeled[1], createdAt);
      if (item) deliverables.set(item.path || item.url || item.id, item);
    }
  }
  const targetPattern = /(?:file:\/\/\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+|\/(?:Users|Volumes|tmp|var|private|home|opt)\/[^\s"'<>]+(?:\s[^\s"'<>]+)*?(?=\s{2,}|\n|$|[),.;]))/gi;
  for (const match of text.matchAll(targetPattern)) {
    const item = deliverableFromTarget(match[0], undefined, createdAt);
    if (item) deliverables.set(item.path || item.url || item.id, item);
  }
  return [...deliverables.values()].slice(0, 12);
}

function mergeDeliverables(existing: KanbanDeliverable[] | undefined, next: KanbanDeliverable[]) {
  const merged = new Map<string, KanbanDeliverable>();
  for (const item of existing ?? []) {
    const normalized = normalizeDeliverable(item);
    if (normalized) merged.set(normalized.path || normalized.url || normalized.id, normalized);
  }
  for (const item of next) {
    const key = item.path || item.url || item.id;
    if (!merged.has(key)) merged.set(key, item);
  }
  return [...merged.values()].slice(0, 12);
}

function extractTaskDeliverables(task: Pick<KanbanTask, "body" | "result" | "idempotencyKey" | "title" | "skills">, result?: string, createdAt = Date.now()) {
  const resultText = result ?? task.result ?? "";
  const resultDeliverables = extractKanbanDeliverables(resultText, createdAt);
  if (resultDeliverables.length) return filterSourceDeliverables(task, resultDeliverables);
  return filterSourceDeliverables(task, extractKanbanDeliverables(stripSourceResultBlocks(task.body ?? ""), createdAt));
}

function stripSourceResultBlocks(text: string) {
  return text.replace(/\n\s*Source result:\s*\n[\s\S]*?(?=\n\s*(?:VISUAL[_ -]?BRIEF|Source task|Source agent|Create the image|Create the visual|Files created|Verification)\b|$)/gi, "\n");
}

function sourceDeliverableKeys(task: Pick<KanbanTask, "body" | "idempotencyKey" | "title" | "skills">) {
  if (!isVisualHandoffTask(task as KanbanTask)) return new Set<string>();
  const keys = new Set<string>();
  const body = task.body ?? "";
  const sourceBlocks = [...body.matchAll(/\n\s*Source result:\s*\n([\s\S]*?)(?=\n\s*(?:VISUAL[_ -]?BRIEF|Source task|Source agent|Create the image|Create the visual|Files created|Verification)\b|$)/gi)];
  for (const block of sourceBlocks) {
    for (const item of extractKanbanDeliverables(block[1] ?? "", Date.now())) {
      keys.add(item.path || item.url || item.id);
    }
  }
  return keys;
}

function filterSourceDeliverables(task: Pick<KanbanTask, "body" | "idempotencyKey" | "title" | "skills">, deliverables: KanbanDeliverable[]) {
  const sourceKeys = sourceDeliverableKeys(task);
  if (!sourceKeys.size) return deliverables;
  return deliverables.filter((item) => !sourceKeys.has(item.path || item.url || item.id));
}

function isPlanningDeliverable(item: KanbanDeliverable) {
  const target = `${item.path ?? ""} ${item.url ?? ""} ${item.label ?? ""}`;
  return item.kind === "document" && /(?:^|[/. -])(?:implementation[- ]?plan|plan)\.(?:md|txt|pdf)\b|\/\.hermes\/plans\//i.test(target);
}

function rollUpCompletedChildDeliverables(board: KanbanBoard, completedChildId?: string, recordEvents = false) {
  const tasksById = new Map(board.tasks.map((task) => [task.id, task]));
  const parentDeliverables = new Map<string, KanbanDeliverable[]>();
  for (const link of board.links) {
    if (completedChildId && link.childId !== completedChildId) continue;
    const child = tasksById.get(link.childId);
    if (!child || !["done", "archived"].includes(child.status) || !child.deliverables?.length) continue;
    const childDeliverables = filterSourceDeliverables(child, child.deliverables).filter((item) => !isPlanningDeliverable(item));
    if (!childDeliverables.length) continue;
    parentDeliverables.set(link.parentId, mergeDeliverables(parentDeliverables.get(link.parentId), childDeliverables));
  }
  for (const [parentId, childDeliverables] of parentDeliverables) {
    const parent = tasksById.get(parentId);
    if (!parent) continue;
    const parentBase = childDeliverables.some((item) => item.kind !== "document")
      ? (parent.deliverables ?? []).filter((item) => !isPlanningDeliverable(item))
      : parent.deliverables;
    parent.deliverables = mergeDeliverables(parentBase, childDeliverables);
    for (const link of board.links.filter((item) => item.parentId === parentId)) {
      const child = tasksById.get(link.childId);
      if (child?.status === "done" && isVisualHandoffTask(child)) {
        child.status = "archived";
        child.updatedAt = Date.now();
        if (recordEvents) {
          board.events.unshift(event("task.handoff-converged", `Rolled ${child.title} deliverables into ${parent.title}`, child.id, { parentId }));
        }
      }
    }
  }
}

function extractVisualBrief(text?: string) {
  const match = text?.match(/(?:^|\n)\s*VISUAL[\s_-]*BRIEF\s*:\s*([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z0-9_ -]{2,}|Resume this session with|Session|Duration|Messages|---RESULT_LENGTH---)\s*:|\n\s*╰|$)/i);
  const brief = match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return brief.length > 20 ? brief.slice(0, 2000) : "";
}

function isVisualHandoffTask(task: KanbanTask) {
  return Boolean(task.idempotencyKey?.startsWith("handoff:visual:"))
    || (/^generate image for:/i.test(task.title) && (task.skills ?? []).some((skill) => /image generation|visual asset|art direction/i.test(skill)));
}

function createVisualHandoffChild(board: KanbanBoard, parent: KanbanTask, result?: string) {
  if (isVisualHandoffTask(parent)) return null;
  const visualBrief = extractVisualBrief(result ?? parent.result);
  if (!visualBrief) return null;
  const idempotencyKey = `handoff:visual:${parent.id}:${simpleStableHash(visualBrief)}`;
  const existing = board.tasks.find((task) => task.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const now = Date.now();
  const task: KanbanTask = {
    id: `t_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: `Generate image for: ${parent.title}`,
    body: [
      `Source task: ${parent.title}`,
      parent.assignee ? `Source agent: ${parent.assignee}` : "",
      "Create the image or image asset that best fits this handoff brief. Use image-generation/art tools when available. If raster generation is unavailable, create the best concrete visual asset your runtime can produce and report the exact file path.",
      `VISUAL_BRIEF: ${visualBrief}`,
      result || parent.result ? `Source result:\n${(result || parent.result || "").slice(0, 4000)}` : "",
    ].filter(Boolean).join("\n\n"),
    assignee: undefined,
    tenant: undefined,
    status: "ready",
    priority: parent.priority,
    workspace: parent.workspace,
    skills: ["image generation", "art direction", "visual asset", "handoff"],
    attachments: parent.attachments ?? [],
    linkedDirectories: parent.linkedDirectories ?? [],
    targetMachine: null,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  board.tasks.unshift(task);
  board.links.push({ parentId: parent.id, childId: task.id, createdAt: now });
  board.events.unshift(event("task.handoff-created", `Created artist handoff for ${parent.title}`, task.id, { parentId: parent.id, visualBrief }));
  return task;
}

function unfinishedParentIds(board: KanbanBoard, taskId: string) {
  const tasksById = new Map(board.tasks.map((task) => [task.id, task]));
  return board.links
    .filter((link) => link.childId === taskId)
    .map((link) => link.parentId)
    .filter((parentId) => {
      const parent = tasksById.get(parentId);
      return parent && parent.status !== "done" && parent.status !== "archived";
    });
}

function promoteReadyChildren(board: KanbanBoard, kind: string) {
  const now = Date.now();
  const tasksById = new Map(board.tasks.map((task) => [task.id, task]));
  const promotedIds = new Set<string>();
  for (const task of board.tasks) {
    if (task.status !== "ideas" && task.status !== "needs-human") continue;
    const parents = board.links.filter((link) => link.childId === task.id);
    if (!parents.length) continue;
    const ready = parents.every((link) => {
      const parent = tasksById.get(link.parentId);
      return parent?.status === "done" || parent?.status === "archived";
    });
    if (!ready) continue;
    task.status = "ready";
    task.updatedAt = now;
    task.claimLock = undefined;
    task.claimExpiresAt = undefined;
    task.lastHeartbeatAt = undefined;
    task.currentRunId = undefined;
    promotedIds.add(task.id);
  }
  for (const taskId of promotedIds) {
    const task = tasksById.get(taskId);
    board.events.unshift(event(kind, `Promoted ${task?.title ?? taskId} after parent tasks completed.`, taskId));
  }
  return promotedIds.size;
}

function finishActiveRun(board: KanbanBoard, taskId: string, status: KanbanRunStatus, input: FinishRunInput = {}) {
  const task = board.tasks.find((item) => item.id === taskId);
  const runId = input.runId ?? task?.currentRunId;
  const now = Date.now();
  let run = runId ? board.runs.find((item) => item.id === runId) : undefined;
  if (!run && (input.summary || input.result || input.reason || input.error)) {
    run = {
      id: `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      status: "running",
      assignee: task?.assignee,
      startedAt: task?.lastHeartbeatAt ?? task?.updatedAt ?? now,
      attempt: task ? positiveInteger(task.attempt) ?? 1 : undefined,
    };
    board.runs.unshift(run);
  }
  if (!run) return undefined;
  run.status = status;
  run.outcome = status;
  run.endedAt = now;
  run.claimLock = undefined;
  run.claimExpiresAt = undefined;
  run.summary = input.summary ?? input.result ?? input.reason ?? run.summary;
  run.metadata = input.metadata ?? run.metadata;
  run.error = input.error ?? (status === "blocked" ? input.reason : undefined) ?? run.error;
  run.failureReason = normalizeFailureReason(input.failureReason) ?? run.failureReason;
  run.attempt = positiveInteger(run.attempt) ?? (task ? positiveInteger(task.attempt) ?? 1 : undefined);
  return run;
}

function isUnpollableAcceptedWorking(task: KanbanTask) {
  return task.status === "working"
    && !task.agentSession?.sessionId
    && /produced no output|no pollable session|auth is failing|needs Hermes\/Codex|accepted the runtime connection|waiting for telemetry|dashboard timeout/i.test(task.result ?? "");
}

function isRetryBlockerResult(result?: string) {
  return /cannot be marked Working|signed out of Codex|auth is failing|no active session|no pollable session|needs Hermes\/Codex|no assistant response|terminal\/tool output|tool output|session is updating|without a worker update/i.test(result ?? "");
}

function safeVaultFolder(folder?: string | null) {
  const value = folder?.trim();
  if (!value) return "";
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Kanban folder must be a relative path inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function normalizeKanbanFolder(folder?: string | null) {
  const value = safeVaultFolder(folder);
  return /^kanban$/i.test(value) ? DEFAULT_VAULT_KANBAN_FOLDER : value;
}

function titleize(slug: string) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
