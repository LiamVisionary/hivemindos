import { NextRequest, NextResponse } from "next/server";
import {
  initializeQueenBeeControlPlane,
  readQueenBeeState,
  submitQueenBeeMessage,
} from "@/lib/services/queen-bee/control-plane";
import { recordAgentOperationalEvent } from "@/lib/services/obsidian/agent-memory/events";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import { createQueenBeePrdTasks } from "@/lib/services/queen-bee/prd-decomposition";
import {
  createQueenBeePrdVisualPlan,
  createQueenBeeVisualPlan,
  visualPlanReceipt,
} from "@/lib/services/visual-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const options = optionsFromRequest(request);
    const result = await readQueenBeeState(options);
    return NextResponse.json({ ok: true, protocol: "hivemind-queen-bee", ...publicState(result) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    if (body.action === "init") {
      const result = await initializeQueenBeeControlPlane(options);
      return NextResponse.json({ ok: true, protocol: "hivemind-queen-bee", ...publicState(result) });
    }
    const fleetSnapshot = Array.isArray(body.fleetSnapshot)
      ? body.fleetSnapshot
      : await discoverQueenBeeFleetSnapshot(request.nextUrl.origin, request.headers.get("x-hivemindos-device-token"));
    if (body.action === "decompose-prd") {
      const result = await createQueenBeePrdTasks({
        ...options,
        prd: body.prd ?? body.message,
        title: body.title ?? body.taskTitle,
        source: body.source,
        priority: body.priority,
        projectId: body.projectId,
        maxTasks: body.maxTasks,
        preview: Boolean(body.preview),
        fleetSnapshot,
      });
      if (!body.preview && Array.isArray(result.tasks) && result.tasks.length) {
        await recordQueenBeeOperationalEvent(options.vaultPath, {
          title: `Queen Bee decomposed ${result.tasks.length} PRD task${result.tasks.length === 1 ? "" : "s"}`,
          content: [
            `Queen Bee decomposed a PRD into ${result.tasks.length} Work Board task${result.tasks.length === 1 ? "" : "s"}.`,
            result.epic?.id ? `Epic task: ${result.epic.id}.` : "",
            result.tasks.slice(0, 6).map((task: { id?: string; title?: string }) => `Task: ${task.id ?? "unknown"} - ${task.title ?? "Untitled"}.`).join("\n"),
          ].filter(Boolean).join("\n"),
          source: "Queen Bee PRD receipt",
          operationKey: "queen-bee/prd-decomposition",
          taskId: result.epic?.id,
        });
      }
      const visualPlan = !body.preview && Array.isArray(result.tasks) && result.tasks.length
        ? await createQueenBeePrdVisualPlan({
          title: result.decomposition?.title ?? body.title ?? body.taskTitle,
          source: result.decomposition?.source ?? body.source,
          decomposition: result.decomposition,
          epic: result.epic,
          tasks: result.tasks,
          vaultPath: options.vaultPath,
        }).then(visualPlanReceipt, () => undefined)
        : undefined;
      return NextResponse.json({ ok: true, protocol: "hivemind-queen-bee", ...result, visualPlan });
    }
    const result = await submitQueenBeeMessage({
      ...options,
      message: body.message,
      source: body.source,
      mode: body.mode,
      priority: body.priority,
      loop: body.loop,
      workspace: normalizeWorkspace(body.workspace),
      taskTitle: body.taskTitle,
      agentId: body.agentId,
      machineId: body.machineId,
      skills: Array.isArray(body.skills) ? body.skills.filter((skill: unknown) => typeof skill === "string") : undefined,
      fleetSnapshot,
    });
    if (result.created) {
      await recordQueenBeeOperationalEvent(options.vaultPath, {
        title: `Queen Bee queued ${result.task.title}`,
        content: [
          result.receipt?.summary || "Queen Bee queued a Work Board task.",
          `Task: ${result.task.id}.`,
          `Assignee: ${result.route?.assignee ?? result.task.assignee ?? "queen-bee"}.`,
          result.route?.targetMachine?.name ? `Machine: ${result.route.targetMachine.name}.` : "",
          result.route?.delegation?.workerClass ? `Worker class: ${result.route.delegation.workerClass}.` : "",
        ].filter(Boolean).join("\n"),
        source: "Queen Bee receipt",
        operationKey: `queen-bee/task-queued/${result.route?.delegation?.workerClass ?? "unassigned"}`,
        taskId: result.task.id,
      });
    }
    const visualPlan = result.created
      ? await createQueenBeeVisualPlan({
        title: result.task?.title ?? body.taskTitle,
        message: body.message,
        source: body.source,
        mode: body.mode,
        fingerprint: result.fingerprint,
        task: result.task,
        route: result.route,
        receipt: result.receipt,
        vaultPath: options.vaultPath,
      }).then(visualPlanReceipt, () => undefined)
      : undefined;
    return NextResponse.json({ ok: true, ...result, visualPlan });
  } catch (error) {
    return errorResponse(error);
  }
}

async function recordQueenBeeOperationalEvent(vaultPath: string | undefined, input: { title: string; content: string; source: string; operationKey: string; taskId?: string }) {
  await recordAgentOperationalEvent({
    vaultPath,
    title: input.title,
    content: input.content,
    source: input.source,
    operationKey: input.operationKey,
    outcome: "success",
    taskId: input.taskId,
    agentName: "Queen Bee",
    agentId: "queen-bee",
    runtime: "hivemindos",
    project: "HivemindOS",
    tags: ["queen-bee", "receipt"],
    entities: ["Queen Bee", "Work Board", "HivemindOS"],
  }).catch(() => undefined);
}

function optionsFromRequest(request: NextRequest, body?: { vaultPath?: string; brainServicesFolder?: string; kanbanFolder?: string }) {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    brainServicesFolder: request.nextUrl.searchParams.get("brainServicesFolder") ?? body?.brainServicesFolder,
    kanbanFolder: request.nextUrl.searchParams.get("kanbanFolder") ?? body?.kanbanFolder,
  };
}

function publicState(result: Awaited<ReturnType<typeof readQueenBeeState>>) {
  return {
    state: result.state,
    paths: {
      root: result.paths.root,
      state: result.paths.state,
      currentState: result.paths.currentState,
      intentDedupe: result.paths.intentDedupe,
      leases: result.paths.leases,
      receipts: result.paths.receipts,
    },
  };
}

function normalizeWorkspace(value: unknown) {
  if (value === "scratch" || value === "worktree") return value;
  if (typeof value === "string" && value.startsWith("dir:")) return value as `dir:${string}`;
  return undefined;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Queen Bee request failed.";
  return NextResponse.json({ ok: false, protocol: "hivemind-queen-bee", error: message }, { status: 400 });
}
