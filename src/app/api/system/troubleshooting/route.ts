import { NextRequest, NextResponse } from "next/server";
import { searchTroubleshootingCookbook } from "@/lib/services/system/troubleshooting-cookbook";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  return NextResponse.json({
    ok: true,
    entries: searchTroubleshootingCookbook(query, Number.isFinite(limit) ? limit : 20),
  });
}
