// guard:allow-hive-action-route - dashboard-only Meta Messaging OAuth connect;
// agents cannot initiate credential grants.
import { NextRequest } from "next/server";

import { startMetaMessagingConnect } from "@/lib/services/integrations/meta-messaging-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await startMetaMessagingConnect();
    if (result.missing.length) {
      return errorJson("Meta Messaging sign-in is not configured in this build yet. Set the public Meta app client id and deploy its hosted OAuth secret before connecting accounts.", 503, { clientReady: false });
    }
    return okJson({ authorizationUrl: result.authorizeUrl, flowId: result.flowId });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start Meta sign-in.", 502);
  }
}
