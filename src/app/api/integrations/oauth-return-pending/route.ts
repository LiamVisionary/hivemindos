// guard:allow-hive-action-route - dashboard-only navigation plumbing: the
// desktop app takes the parked outcome of an external-browser OAuth return so
// it can route to the view the user started from. Not agent-invokable work.
import { NextRequest } from "next/server";

import { takeLatestOAuthReturn } from "@/lib/services/integrations/oauth-return-store";
import { okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exactly-once take of the most recent parked desktop OAuth return (see
 * oauth-return-store.ts). POST because the read consumes. Authenticated: the
 * park side is the proxy-allowlisted callback, but only the signed-in desktop
 * app may take. Returns { pending: null } when nothing is parked.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  return okJson({ pending: takeLatestOAuthReturn() });
}
