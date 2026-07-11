import { NextRequest } from "next/server";

import { createHiveComputeJobDraft } from "@/lib/services/hive-compute-marketplace/gateway-client";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  try {
    const result = await createHiveComputeJobDraft(body);
    const error = typeof result.payload.error === "string" ? result.payload.error : "Hive Compute job draft failed.";
    const data = { ...result.payload };
    delete data.ok;
    delete data.error;
    return result.status >= 200 && result.status < 300
      ? okJson(data, { status: result.status })
      : errorJson(error, result.status, data);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute job is invalid.", 400);
  }
}
