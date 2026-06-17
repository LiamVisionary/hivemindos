import { NextRequest, NextResponse } from "next/server";
import { collectSystemHealth } from "@/lib/services/system/system-health";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
  try {
    return NextResponse.json(await collectSystemHealth({ vaultPath }));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: "down",
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Could not collect system health.",
    }, { status: 500 });
  }
}
