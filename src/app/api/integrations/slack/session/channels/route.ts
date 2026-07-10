// guard:allow-hive-action-route - dashboard-only channel discovery for the
// user's consented Slack session; not an agent-invocable Hive action.
import { NextRequest } from "next/server";

import { listSlackChannels } from "@/lib/services/integrations/slack-session";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const channels = await listSlackChannels();
    return okJson({ channels });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not list Slack channels.", 502);
  }
}
