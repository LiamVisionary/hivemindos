import { NextRequest } from "next/server";

import { submitHiveComputeJob } from "@/lib/services/hive-compute-marketplace/gateway-client";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  try {
    const result = await submitHiveComputeJob({
      ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
      jobId: (await context.params).jobId,
    });
    const error = typeof result.payload.error === "string" ? result.payload.error : "Hive Compute job submission failed.";
    const data = { ...result.payload };
    delete data.ok;
    delete data.error;
    return result.status >= 200 && result.status < 300
      ? okJson(data, { status: result.status })
      : errorJson(error, result.status, data);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute encrypted job submission is invalid.", 400);
  }
}
