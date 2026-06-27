import { NextRequest, NextResponse } from "next/server";
import { evaluateCryptoRisk, type CryptoRiskSubject } from "@/lib/services/crypto/risk-monitor";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const report = await evaluateCryptoRisk({
    agentId: request.nextUrl.searchParams.get("agentId")?.trim() || undefined,
  });
  return NextResponse.json({ ok: true, report });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as CryptoRiskSubject;
    const report = await evaluateCryptoRisk(body);
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not evaluate crypto risk.",
    }, { status: 400 });
  }
}
