import { type NextRequest } from "next/server";

import { latestManagedXDesktopReturn } from "@/lib/services/managed-x-desktop-return-store";
import { okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const since = Number(params.get("since") ?? 0);
  const returned = latestManagedXDesktopReturn({
    creditAccountId: params.get("creditAccountId")?.trim() || undefined,
    slug: params.get("slug")?.trim() || undefined,
    since: Number.isFinite(since) ? since : 0,
  });

  return okJson({ returned });
}
