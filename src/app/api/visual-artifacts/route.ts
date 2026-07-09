import { NextRequest } from "next/server";

import {
  createVisualArtifact,
  getVisualArtifact,
  listVisualArtifacts,
  visualArtifactPublicView,
} from "@/lib/services/visual-artifacts";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";
import { workspaceScope } from "@/lib/types/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;

  try {
    const id = request.nextUrl.searchParams.get("id");
    const vaultPath = request.nextUrl.searchParams.get("vaultPath");
    const publicView = request.nextUrl.searchParams.get("public") === "1";
    if (id) {
      const record = await getVisualArtifact(id, { vaultPath });
      return okJson({
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
    return okJson({
      artifacts: publicView ? result.artifacts.map(visualArtifactPublicView) : result.artifacts,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;

  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "create") {
      const result = await createVisualArtifact({
        ...body,
        createdByPrincipalId: body.createdByPrincipalId ?? auth.principal.principalId,
        scope: body.scope ?? workspaceScope(["artifacts:read"], ["artifact"]),
      });
      return okJson(result);
    }
    if (action === "list") {
      const result = await listVisualArtifacts(body);
      return okJson({
        artifacts: result.artifacts,
        updatedAt: result.updatedAt,
      });
    }
    if (action === "get") {
      const record = await getVisualArtifact(typeof body.id === "string" ? body.id : "", {
        vaultPath: body.vaultPath,
      });
      return okJson({ artifact: record.artifact, storage: record.storage });
    }
    return errorJson(`Unsupported visual artifact action: ${action}`, 400);
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Visual artifact request failed.";
  return errorJson(message, 400);
}
