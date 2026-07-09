// guard:allow-hive-action-route - dashboard-only Slack OAuth connect flow;
// launches the user's interactive browser sign-in and is intentionally NOT an
// agent-invokable Hive action (agents must never initiate credential grants).
import { NextRequest } from "next/server";

import { startSlackConnect } from "@/lib/services/integrations/slack-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Slack OAuth sign-in starter (confidential-client broker model). Pre-registers a
 * rendezvous at the hosted exchange Worker (which holds the client secret) and
 * returns the Slack authorize URL plus a `flowId`. The browser redirect lands on
 * the WORKER's HTTPS callback (a single stable URL registered in the Slack app,
 * not a per-user localhost port); the UI then polls /poll with the flowId until
 * the Worker hands back the token. Yields a Slack user token (xoxp-).
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let result: Awaited<ReturnType<typeof startSlackConnect>>;
  try {
    result = await startSlackConnect();
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start the Slack sign-in.", 502);
  }
  if (result.missing.length) {
    return errorJson(
      "Slack sign-in isn't configured in this build yet. Set SLACK_OAUTH_CLIENT_ID (the Slack app client id) or bake one into HivemindOS.",
      503,
      { clientReady: false },
    );
  }

  return okJson({ authorizationUrl: result.authorizeUrl, flowId: result.flowId });
}
