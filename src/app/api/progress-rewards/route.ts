import { NextRequest, NextResponse } from "next/server";

import { readProgressRewardsSnapshot } from "@/lib/services/progress-rewards";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const offset = Number(request.nextUrl.searchParams.get("timezoneOffsetMinutes") ?? 0);
    const snapshot = await readProgressRewardsSnapshot({
      timezoneOffsetMinutes: Number.isFinite(offset) ? offset : 0,
    });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not build progress rewards.",
    }, { status: 500 });
  }
}
