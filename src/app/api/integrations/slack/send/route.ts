import { NextRequest } from "next/server";

import { SLACK_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";
import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Governed executor for the `slack_send_message` agent tool (modeled in the hive
 * action catalog as `integrations.slack-send`, so it is an agent-invocable action,
 * not a dashboard-only route). The hivemind-mcp `slack_send_message` tool wraps
 * this with the same confirmation gate. Posts as the connected Slack user via
 * chat:write. The token stays server-side (shared hive env, SLACK_BOT_TOKEN) and
 * is never returned to the caller.
 */
const CONFIRM_TOKEN = "CONFIRM_SLACK_SEND";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: { text?: unknown; channel?: unknown; confirmation?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const channelArg = typeof body.channel === "string" ? body.channel.trim() : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";

  if (!text) return errorJson("A non-empty `text` is required.", 400);
  if (confirmation !== CONFIRM_TOKEN) {
    return errorJson(`Sending a Slack message requires confirmation ${CONFIRM_TOKEN}.`, 400, {
      needsConfirmation: CONFIRM_TOKEN,
    });
  }

  const sharedEnv = await readSharedAgentEnv();
  const token = sharedEnvValue(SLACK_TOKEN_ENV, sharedEnv);
  if (!token) {
    return errorJson("Slack is not connected. Connect Slack in Integrations first.", 400, { connected: false });
  }

  // Resolve the target channel: an explicit id wins; otherwise default to the
  // connecting user's own DM (auth.test returns the user id — no read scope needed).
  let channel = channelArg;
  if (!channel) {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const authData = (await authRes.json().catch(() => null)) as
      | { ok?: boolean; user_id?: string; error?: string }
      | null;
    if (!authData?.ok || !authData.user_id) {
      return errorJson(
        `Could not resolve a default Slack channel (${authData?.error || "auth.test failed"}). Pass a channel id.`,
        502,
      );
    }
    channel = authData.user_id;
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, text }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; ts?: string; channel?: string; error?: string }
    | null;
  if (!res.ok || !data?.ok) {
    return errorJson(`Slack rejected the message (${data?.error || `HTTP ${res.status}`}).`, 502);
  }

  return okJson({ sent: true, channel: data.channel || channel, ts: data.ts });
}
