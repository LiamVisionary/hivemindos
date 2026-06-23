import { NextRequest, NextResponse } from "next/server";

import {
  createDashboardPin,
  deleteDashboardPin,
  listDashboardPins,
  sendDashboardPinToWorkBoard,
  updateDashboardPinStatus,
} from "@/lib/services/dashboard-pins";
import type { DashboardPinStatus } from "@/lib/types/dashboard-pins";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const status = request.nextUrl.searchParams.get("status");
    const route = request.nextUrl.searchParams.get("route");
    const pins = await listDashboardPins({
      status: status as DashboardPinStatus | "all" | null,
      route,
    });
    return NextResponse.json({
      ok: true,
      pins: pins.pins,
      updatedAt: pins.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "create" || !body.action) {
      const result = await createDashboardPin(body);
      return NextResponse.json({
        ok: true,
        pin: result.pin,
        pins: result.file.pins,
        updatedAt: result.file.updatedAt,
      });
    }
    if (body.action === "update-status") {
      const result = await updateDashboardPinStatus(body.id, body.status);
      return NextResponse.json({
        ok: true,
        pin: result.pin,
        pins: result.file.pins,
        updatedAt: result.file.updatedAt,
      });
    }
    if (body.action === "delete") {
      const result = await deleteDashboardPin(body.id);
      return NextResponse.json({
        ok: true,
        pins: result.pins,
        updatedAt: result.updatedAt,
      });
    }
    if (body.action === "send-to-work-board") {
      const result = await sendDashboardPinToWorkBoard(body.id, {
        board: body.board,
        kanban: {
          vaultPath: body.vaultPath,
          kanbanFolder: body.kanbanFolder,
        },
      });
      return NextResponse.json({
        ok: true,
        pin: result.pin,
        taskId: result.taskId,
        created: result.created,
        pins: result.file.pins,
        updatedAt: result.file.updatedAt,
      });
    }
    return NextResponse.json({
      ok: false,
      error: `Unsupported dashboard pin action: ${body.action}`,
    }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("Dashboard pin id is required.");
    const result = await deleteDashboardPin(id);
    return NextResponse.json({
      ok: true,
      pins: result.pins,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Dashboard pin request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
