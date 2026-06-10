import { NextRequest, NextResponse } from "next/server";
import { readGenerationMetrics, recordGenerationMetric } from "@/lib/services/generation-metrics";
import type { GenerationMetricRecordInput } from "@/lib/types/generation-metrics";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await readGenerationMetrics(request.nextUrl.searchParams.get("kind") ?? undefined));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read generation metrics.",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as GenerationMetricRecordInput;
    return NextResponse.json(await recordGenerationMetric(body));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not record generation metric.",
    }, { status: 400 });
  }
}
