import { NextRequest, NextResponse } from "next/server";

import { readSpendLedger } from "@/lib/services/wallet/spend-ledger";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const limit = Math.max(1, Math.min(200, Number(request.nextUrl.searchParams.get("limit") ?? 100) || 100));
    const records = (await readSpendLedger())
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
      .slice(0, limit);
    return NextResponse.json({ ok: true, records });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read wallet activity.",
    }, { status: 502 });
  }
}
