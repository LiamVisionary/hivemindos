import { NextRequest, NextResponse } from "next/server";
import {
  initializeQueenBeeControlPlane,
  readQueenBeeState,
  submitQueenBeeMessage,
} from "@/lib/services/queen-bee/control-plane";

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
    const result = await submitQueenBeeMessage({
      ...options,
      message: body.message,
      source: body.source,
      mode: body.mode,
      priority: body.priority,
      taskTitle: body.taskTitle,
      agentId: body.agentId,
      machineId: body.machineId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
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

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Queen Bee request failed.";
  return NextResponse.json({ ok: false, protocol: "hivemind-queen-bee", error: message }, { status: 400 });
}
