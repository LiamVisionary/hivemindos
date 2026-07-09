// guard:allow-hive-action-route - dashboard-only Slack OAuth poll; the UI calls
// this after opening the browser sign-in to learn when the hosted exchange Worker
// has the token. NOT an agent-invokable Hive action.
import { NextRequest } from "next/server";

import { pollSlackConnect } from "@/lib/services/integrations/slack-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poll a Slack connect flow started by /start. On `connected`, the xoxp- user
 * token has already been persisted to the shared hive env server-side; the token
 * itself is never returned to the client.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let flowId = "";
  try {
    const body = (await request.json()) as { flowId?: unknown };
    flowId = typeof body?.flowId === "string" ? body.flowId.trim() : "";
  } catch {
    return errorJson("A flowId is required.", 400);
  }
  if (!flowId) return errorJson("A flowId is required.", 400);

  try {
    const { status, error } = await pollSlackConnect(flowId);
    return okJson({ status, error });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not check the Slack sign-in.", 502);
  }
}
