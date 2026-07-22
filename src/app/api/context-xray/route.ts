import { NextRequest } from "next/server";

import {
  createContextXrayManifest,
  getContextXrayManifest,
  listContextXrayManifests,
  recordContextXrayEvidence,
} from "@/lib/services/context-xray";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const manifest = await getContextXrayManifest(id);
      return okJson({ manifest });
    }
    const result = await listContextXrayManifests({
      limit: request.nextUrl.searchParams.get("limit"),
      runId: request.nextUrl.searchParams.get("runId"),
      threadId: request.nextUrl.searchParams.get("threadId"),
    });
    return okJson(result);
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
      const manifest = await createContextXrayManifest(body);
      return okJson({ manifest });
    }
    if (action === "list") {
      const result = await listContextXrayManifests(body);
      return okJson(result);
    }
    if (action === "get") {
      const manifest = await getContextXrayManifest(typeof body.id === "string" ? body.id : "");
      return okJson({ manifest });
    }
    if (action === "record-evidence") {
      const evidence = await recordContextXrayEvidence(body);
      return okJson({ evidence });
    }
    return errorJson(`Unsupported Context X-Ray action: ${action}`, 400);
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Context X-Ray request failed.";
  return errorJson(message, 400);
}
