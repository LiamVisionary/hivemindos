import { NextRequest, NextResponse } from "next/server";
import type { KanbanStatus } from "@/lib/types/kanban";
import {
  addComment,
  addLink,
  answerHumanTask,
  archiveBoard,
  blockTask,
  bulkPatchTasks,
  claimTask,
  claimNextTask,
  completeTask,
  createBoard,
  createTask,
  deleteTask,
  discoverTaskLoop,
  failTask,
  heartbeatTask,
  listBoards,
  moveTask,
  patchTask,
  promoteTask,
  readBoard,
  recordTaskLoop,
  reclaimStaleTasks,
  resolveKanbanStorage,
  unblockTask,
  type KanbanStorageOptions,
} from "@/lib/services/kanban/local-kanban-store";
import { holdTask, clearHold } from "@/lib/services/kanban/task-hold";
import { buildLoopFromTemplate, listLoopTemplates, stripProtectedIntegrityReceipts, type LoopTemplateId } from "@/lib/services/loops";
import { filterKanbanTasks, groupKanbanTasks } from "@/lib/utils/kanban-board";
import { recordTaskSkillOutcome } from "@/lib/services/skills/skill-autoresearch";
import { resolveFleetMachineAccessAnswer } from "@/lib/services/fleet/machine-access-approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const boardSlug = request.nextUrl.searchParams.get("board");
    const includeBoards = request.nextUrl.searchParams.get("include_boards") !== "false";
    const boardsOnly = request.nextUrl.searchParams.get("boards_only") === "true";
    const includeArchived = request.nextUrl.searchParams.get("include_archived") === "true";
    const tenant = request.nextUrl.searchParams.get("tenant") || undefined;
    const assignee = request.nextUrl.searchParams.get("assignee") || undefined;
    const query = request.nextUrl.searchParams.get("q") || undefined;
    const storageOptions = storageOptionsFromRequest(request);
    if (boardsOnly) {
      const boards = await listBoards(storageOptions);
      const storage = resolveKanbanStorage(boardSlug, storageOptions);
      return NextResponse.json({ ok: true, boards, storage });
    }

    const board = await readBoard(boardSlug, storageOptions);
    const tasks = filterKanbanTasks(board, { tenant, assignee, query, includeArchived });
    const tenants = [...new Set(board.tasks.map((task) => task.tenant).filter(Boolean))].sort();
    const assignees = [...new Set(board.tasks.map((task) => task.assignee).filter(Boolean))].sort();
    const storage = resolveKanbanStorage(board.meta.slug, storageOptions);
    const boards = includeBoards ? await listBoards(storageOptions) : undefined;
    const responseBoard = trimKanbanBoardForResponse({ ...board, tasks });

    return NextResponse.json({
      ok: true,
      ...(boards ? { boards } : {}),
      board: responseBoard,
      columns: groupKanbanTasks(tasks, includeArchived),
      tenants,
      assignees,
      storage,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // The HTTP route is the untrusted boundary: the autonomous worker completes
    // in-process, so anything arriving here (dashboard, an agent via MCP/API) must
    // not be able to POST a forged server-only integrity receipt to overwrite a
    // stored hard-fail and self-complete a parked task.
    sanitizeClientLoopReceipts(body);
    const boardSlug = request.nextUrl.searchParams.get("board") || body.board;
    const storageOptions = storageOptionsFromRequest(request, body);
    if (body.action === "create-board") {
      const board = await createBoard(body, storageOptions);
      return NextResponse.json({ ok: true, board, storage: resolveKanbanStorage(board.meta.slug, storageOptions) });
    }
    if (body.action === "archive-board") {
      await archiveBoard(body.slug, storageOptions);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "comment") {
      const result = await addComment(boardSlug, body.taskId, body.body, body.author, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "link") {
      const result = await addLink(boardSlug, body.parentId, body.childId, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "bulk") {
      const result = await bulkPatchTasks(boardSlug, Array.isArray(body.ids) ? body.ids : [], body.patch ?? {}, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "claim") {
      const result = await claimTask(boardSlug, body.taskId, body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "claim-next") {
      const result = await claimNextTask(boardSlug, body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "heartbeat") {
      const result = await heartbeatTask(boardSlug, body.taskId, body.note, body.claimLock, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "complete") {
      const result = await completeTask(boardSlug, body.taskId, body, storageOptions);
      const skillAutoresearch = await recordTaskSkillOutcome(
        result.task,
        result.blocked ? "blocked" : "completed",
        body.summary ?? body.result ?? undefined,
        { vaultPath: storageOptions.vaultPath ?? undefined },
      ).catch(() => undefined);
      return NextResponse.json({ ok: true, ...result, skillAutoresearch, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "loop-discover") {
      const result = await discoverTaskLoop(boardSlug, body.taskId, body.loop ?? body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "loop-record") {
      const result = await recordTaskLoop(boardSlug, body.taskId, body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "block") {
      const result = await blockTask(boardSlug, body.taskId, body.reason ?? body.summary ?? "Blocked.", storageOptions);
      const skillAutoresearch = await recordTaskSkillOutcome(result.task, "blocked", body.reason ?? body.summary ?? undefined, { vaultPath: storageOptions.vaultPath ?? undefined }).catch(() => undefined);
      return NextResponse.json({ ok: true, ...result, skillAutoresearch, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "fail") {
      const result = await failTask(boardSlug, body.taskId, body, storageOptions);
      const skillAutoresearch = await recordTaskSkillOutcome(result.task, "failed", body.summary ?? body.error ?? body.reason ?? undefined, { vaultPath: storageOptions.vaultPath ?? undefined }).catch(() => undefined);
      return NextResponse.json({ ok: true, ...result, skillAutoresearch, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "unblock") {
      const result = await unblockTask(boardSlug, body.taskId, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "answer") {
      const currentBoard = await readBoard(boardSlug, storageOptions);
      const currentTask = currentBoard.tasks.find((task) => task.id === body.taskId);
      if (!currentTask) throw new Error("Task not found.");
      if (currentTask.status !== "needs-human") {
        throw new Error(`Task is '${currentTask.status}'; answer only applies to Needs You tasks.`);
      }
      // A machine-policy answer must reach the collector authority before the
      // task is resumed. If that enforcement fails, leave the card parked in
      // Needs You instead of telling the same agent to retry without access.
      const fleetAccessResolution = await resolveFleetMachineAccessAnswer(currentTask, body.answer);
      const result = await answerHumanTask(boardSlug, body.taskId, { answer: body.answer, author: body.author }, storageOptions);
      // A real answer supersedes any prior "parked" state so it doesn't stay
      // filtered after the task flows on (or if it later re-blocks).
      await clearHold(boardSlug, body.taskId, storageOptions).catch(() => undefined);
      // Resume with the SAME agent that asked: when the card still carries a
      // delegated target, schedule an immediate autonomous pickup instead of
      // waiting for the next re-dispatch sweep (same delegation shape as
      // redispatchReadyQueenBeeTasks).
      const task = result.task;
      const assignee = task.assignee?.trim();
      const collectorUrl = task.targetMachine?.collectorUrl;
      let pickupScheduled = false;
      if (assignee && assignee !== "queen-bee" && collectorUrl) {
        const { scheduleQueenBeeAutonomousPickup } = await import("@/lib/services/queen-bee/autonomous-worker");
        pickupScheduled = scheduleQueenBeeAutonomousPickup({
          task,
          delegation: {
            status: "delegated",
            agent: { name: assignee, runtime: "hermes", runtimeCapabilities: { chat: true } },
            machine: { key: task.targetMachine?.key, device: { name: task.targetMachine?.name, collectorUrl } },
          },
          vaultPath: storageOptions.vaultPath,
          kanbanFolder: storageOptions.kanbanFolder,
        });
      }
      return NextResponse.json({ ok: true, ...result, fleetAccessResolution, pickupScheduled, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "hold") {
      const result = await holdTask(boardSlug, body.taskId, { by: body.author, note: body.note ?? body.reason }, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "promote") {
      const result = await promoteTask(boardSlug, body.taskId, body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    if (body.action === "reclaim-stale") {
      const result = await reclaimStaleTasks(boardSlug, body, storageOptions);
      return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }
    applyLoopTemplate(body);
    const result = await createTask(boardSlug, body, storageOptions);
    return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    sanitizeClientLoopReceipts(body);
    const boardSlug = request.nextUrl.searchParams.get("board") || body.board;
    const storageOptions = storageOptionsFromRequest(request, body);
    if (!body.taskId) throw new Error("taskId is required.");
    const result = body.status
      ? await moveTask(boardSlug, body.taskId, body.status as KanbanStatus, storageOptions)
      : await patchTask(boardSlug, body.taskId, body.patch ?? body, storageOptions);
    return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const boardSlug = request.nextUrl.searchParams.get("board") || body.board;
    const storageOptions = storageOptionsFromRequest(request, body);
    if (!body.taskId) throw new Error("taskId is required.");
    const result = await deleteTask(boardSlug, body.taskId, storageOptions);
    return NextResponse.json({ ok: true, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
  } catch (error) {
    return errorResponse(error);
  }
}

function applyLoopTemplate(body: Record<string, unknown>) {
  if (typeof body.loopTemplateId !== "string" || !body.loopTemplateId.trim()) return;
  const templateId = body.loopTemplateId.trim() as LoopTemplateId;
  if (!listLoopTemplates().some((template) => template.id === templateId)) {
    throw new Error(`Unknown loop template: ${templateId}.`);
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Engineering task";
  const detail = typeof body.body === "string" && body.body.trim() ? body.body.trim() : title;
  body.loop = buildLoopFromTemplate({ templateId, title, goal: detail });
}

/** Strip server-only integrity receipts from a client request body (top-level and
 *  inside a patch) so a forged `passed` receipt can't overwrite a stored hard-fail.
 *  Non-integrity receipts pass through untouched. */
function sanitizeClientLoopReceipts(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as { loopReceipts?: unknown; patch?: { loopReceipts?: unknown } };
  if (Array.isArray(record.loopReceipts)) {
    record.loopReceipts = stripProtectedIntegrityReceipts(record.loopReceipts);
  }
  if (record.patch && typeof record.patch === "object" && Array.isArray(record.patch.loopReceipts)) {
    record.patch.loopReceipts = stripProtectedIntegrityReceipts(record.patch.loopReceipts);
  }
}

function storageOptionsFromRequest(request: NextRequest, body?: { vaultPath?: string; kanbanFolder?: string }): KanbanStorageOptions {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    kanbanFolder: request.nextUrl.searchParams.get("kanbanFolder") ?? body?.kanbanFolder,
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Kanban request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function trimKanbanBoardForResponse(board: Awaited<ReturnType<typeof readBoard>>) {
  const taskIds = new Set(board.tasks.map((task) => task.id));
  return {
    ...board,
    comments: board.comments
      .filter((comment) => taskIds.has(comment.taskId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 120),
    events: board.events
      .filter((event) => !event.taskId || taskIds.has(event.taskId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 160),
    runs: board.runs
      .filter((run) => taskIds.has(run.taskId))
      .sort((a, b) => (b.endedAt ?? b.lastHeartbeatAt ?? b.startedAt) - (a.endedAt ?? a.lastHeartbeatAt ?? a.startedAt))
      .slice(0, 80),
  };
}
