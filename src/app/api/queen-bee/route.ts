import { NextRequest, NextResponse } from "next/server";
import {
  initializeQueenBeeControlPlane,
  readQueenBeeState,
  submitQueenBeeMessage,
  type QueenBeeFleetMachine,
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
      fleetSnapshot: Array.isArray(body.fleetSnapshot) ? body.fleetSnapshot : await discoverFleetSnapshot(request),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

async function discoverFleetSnapshot(request: NextRequest): Promise<QueenBeeFleetMachine[]> {
  try {
    const url = new URL("/api/fleet/discover", request.nextUrl.origin);
    url.searchParams.set("includeSnapshots", "0");
    url.searchParams.set("fresh", "1");
    const token = request.headers.get("x-hivemindos-device-token");
    const response = await fetch(url, {
      cache: "no-store",
      headers: token ? { "x-hivemindos-device-token": token } : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null) as { machines?: QueenBeeFleetMachine[] } | null;
    return response.ok && Array.isArray(data?.machines) ? data.machines : [];
  } catch {
    return [];
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
