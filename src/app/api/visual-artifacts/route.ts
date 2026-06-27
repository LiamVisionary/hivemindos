import { NextRequest, NextResponse } from "next/server";

import {
  createVisualArtifact,
  getVisualArtifact,
  listVisualArtifacts,
  visualArtifactPublicView,
} from "@/lib/services/visual-artifacts";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = request.nextUrl.searchParams.get("id");
    const vaultPath = request.nextUrl.searchParams.get("vaultPath");
    const publicView = request.nextUrl.searchParams.get("public") === "1";
    if (id) {
      const record = await getVisualArtifact(id, { vaultPath });
      return NextResponse.json({
        ok: true,
        artifact: publicView ? visualArtifactPublicView(record.artifact) : record.artifact,
        storage: record.storage,
      });
    }
    const result = await listVisualArtifacts({
      kind: request.nextUrl.searchParams.get("kind"),
      workBoardTaskId: request.nextUrl.searchParams.get("workBoardTaskId"),
      queenBeeRunId: request.nextUrl.searchParams.get("queenBeeRunId"),
      limit: request.nextUrl.searchParams.get("limit"),
      vaultPath,
    });
    return NextResponse.json({
      ok: true,
      artifacts: publicView ? result.artifacts.map(visualArtifactPublicView) : result.artifacts,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "create") {
      const result = await createVisualArtifact(body);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "list") {
      const result = await listVisualArtifacts(body);
      return NextResponse.json({
        ok: true,
        artifacts: result.artifacts,
        updatedAt: result.updatedAt,
      });
    }
    if (action === "get") {
      const record = await getVisualArtifact(typeof body.id === "string" ? body.id : "", {
        vaultPath: body.vaultPath,
      });
      return NextResponse.json({ ok: true, artifact: record.artifact, storage: record.storage });
    }
    return NextResponse.json({
      ok: false,
      error: `Unsupported visual artifact action: ${action}`,
    }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Visual artifact request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
