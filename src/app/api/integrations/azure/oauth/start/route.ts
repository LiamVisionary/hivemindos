// guard:allow-hive-action-route - dashboard-only credential grant flow.
import { NextRequest } from "next/server";

import { startAzureConnect } from "@/lib/services/integrations/azure-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { tenantId?: unknown } | null;
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : undefined;
  try {
    const result = await startAzureConnect(tenantId);
    if (result.missing.length) {
      return errorJson("Microsoft Azure sign-in is not configured in this build.", 503, { clientReady: false });
    }
    return okJson({ authorizationUrl: result.authorizeUrl, flowId: result.flowId });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start Microsoft sign-in.", 502);
  }
}
