// guard:allow-hive-action-route - dashboard-only Slack session retrieval; reads
// the user's own connected Slack session server-side. Not an agent-invocable Hive
// action for now (session capture + retrieval is a consented user flow).
import { NextRequest } from "next/server";

import { retrieveSlackChannel, slackSessionAuthTest } from "@/lib/services/integrations/slack-session";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report which workspace the stored Slack session belongs to (or not connected). */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const result = await slackSessionAuthTest();
  return okJson(result);
}

/** Pull a channel's history + download its files using the stored Slack session. */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: { channel?: unknown; saveDir?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }
  const channel = typeof body.channel === "string" ? body.channel.trim() : "";
  const saveDir = typeof body.saveDir === "string" ? body.saveDir.trim() : "";
  if (!channel) return errorJson("A Slack `channel` id is required (e.g. C0A3N6ABD34).", 400);

  try {
    const summary = await retrieveSlackChannel(channel, saveDir || undefined);
    return okJson(summary);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Slack retrieval failed.", 502);
  }
}
