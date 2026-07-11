import { NextRequest } from "next/server";

import {
  acknowledgeHiveComputeArtifacts,
  cancelHiveComputeJob,
  getHiveComputeJob,
  type HiveComputeGatewayJsonResult,
} from "@/lib/services/hive-compute-marketplace/gateway-client";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return routeResult(await getHiveComputeJob((await context.params).jobId));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute job id is invalid.", 400);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { action?: unknown; publicKeySha256?: unknown; artifactIds?: unknown } | null;
  if (body?.action !== "ack-artifacts") return errorJson("Unsupported Hive Compute job update.", 400);
  try {
    const deleted = await acknowledgeHiveComputeArtifacts({
      jobId: (await context.params).jobId,
      publicKeySha256: body.publicKeySha256,
      artifactIds: body.artifactIds,
    });
    return okJson({ acknowledged: true, keyDeleted: deleted });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute artifact acknowledgement failed.", 400);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return routeResult(await cancelHiveComputeJob((await context.params).jobId));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute job id is invalid.", 400);
  }
}

function routeResult(result: HiveComputeGatewayJsonResult) {
  const error = typeof result.payload.error === "string" ? result.payload.error : "Hive Compute job request failed.";
  const data = { ...result.payload };
  delete data.ok;
  delete data.error;
  return result.status >= 200 && result.status < 300
    ? okJson(data, { status: result.status })
    : errorJson(error, result.status, data);
}
