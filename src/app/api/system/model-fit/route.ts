import { NextRequest, NextResponse } from "next/server";
import { recommendModelFit, type ModelFitMachine } from "@/lib/services/system/model-fit";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { machines?: ModelFitMachine[] };
  return NextResponse.json({
    ok: true,
    recommendations: recommendModelFit(Array.isArray(body.machines) ? body.machines : []),
  });
}
