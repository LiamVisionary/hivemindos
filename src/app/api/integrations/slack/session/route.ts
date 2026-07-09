// guard:allow-hive-action-route - dashboard-only: persists the Slack session
// credentials captured by the native `slack_session_capture` flow. NOT an
// agent-invocable action (agents never initiate a credential capture).
import { NextRequest } from "next/server";

import { saveSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store the Slack SESSION credentials (the `xoxc-` web token + the `d` cookie)
 * captured by the native embedded-login flow into the shared hive env, so agents
 * and any fleet machine can read from workspaces where our OAuth app can't be
 * installed. Values are written via the sanctioned `hive-env-add` writer (stdin,
 * never argv/logs). This is unofficial session access — the UI gates it behind
 * explicit consent before the capture runs.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: { xoxc?: unknown; d?: unknown; team_id?: unknown; team_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  const xoxc = typeof body.xoxc === "string" ? body.xoxc.trim() : "";
  const cookie = typeof body.d === "string" ? body.d.trim() : "";
  const teamId = typeof body.team_id === "string" ? body.team_id.trim() : "";
  const teamName = typeof body.team_name === "string" ? body.team_name.trim() : "";

  if (!xoxc.startsWith("xoxc-")) return errorJson("Missing or malformed Slack session token.", 400);
  if (!cookie) return errorJson("Missing Slack `d` session cookie.", 400);

  // Values travel to hive-env-add over stdin (never logged / never in argv).
  await saveSharedAgentEnv("SLACK_SESSION_TOKEN", xoxc);
  await saveSharedAgentEnv("SLACK_SESSION_COOKIE_D", cookie);
  if (teamId) await saveSharedAgentEnv("SLACK_SESSION_TEAM_ID", teamId);
  if (teamName) await saveSharedAgentEnv("SLACK_SESSION_TEAM_NAME", teamName);

  return okJson({ saved: true, team_id: teamId, team_name: teamName });
}
