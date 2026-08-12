// guard:allow-hive-action-route - dashboard-only Meta Messaging OAuth poll;
// it persists provider tokens server-side and never returns them to the client.
import { NextRequest } from "next/server";

import { pollMetaMessagingConnect } from "@/lib/services/integrations/meta-messaging-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { flowId?: unknown } | null;
  const flowId = typeof body?.flowId === "string" ? body.flowId.trim() : "";
  if (!flowId) return errorJson("A flowId is required.", 400);
  try {
    const { status, error } = await pollMetaMessagingConnect(flowId);
    return okJson({ status, error });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not check Meta sign-in.", 502);
  }
}
