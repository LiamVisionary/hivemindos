import { NextRequest, NextResponse } from "next/server";
import { collectSmokeChecklist } from "@/lib/services/system/smoke-checklist";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
  return NextResponse.json(await collectSmokeChecklist({ vaultPath }));
}
