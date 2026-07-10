import { NextRequest } from "next/server";

import { listLongRunningProcesses } from "@/lib/services/long-running-processes";
import { okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const rawRevision = new URL(request.url).searchParams.get("afterRevision");
  const parsedRevision = rawRevision === null ? 0 : Number(rawRevision);
  const afterRevision = Number.isSafeInteger(parsedRevision) && parsedRevision >= 0
    ? parsedRevision
    : 0;
  return okJson(listLongRunningProcesses(afterRevision));
}
