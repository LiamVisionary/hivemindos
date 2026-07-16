import { NextRequest } from "next/server";

import { listDashboardPasskeys, removeDashboardPasskey } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ passkeys: await listDashboardPasskeys() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read dashboard passkeys.", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { id?: unknown };
  if (typeof body.id !== "string") return errorJson("A device passkey id is required.", 400);
  try {
    const removed = await removeDashboardPasskey(body.id);
    return removed ? okJson({ removed: true }) : errorJson("Device passkey not found.", 404);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not remove the device passkey.", 400);
  }
}

