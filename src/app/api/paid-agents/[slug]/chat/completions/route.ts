import { NextRequest, NextResponse } from "next/server";

import {
  getPaidAgentGatewayStatus,
  processPaidAgentGatewayRequest,
} from "@/lib/services/paid-agent-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type RouteContext = {
  params: Promise<{ slug: string }> | { slug: string };
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return NextResponse.json({
    ok: true,
    ...(await getPaidAgentGatewayStatus(slug)),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  try {
    return await processPaidAgentGatewayRequest(request, slug);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number(error.status) || 500
      : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Paid agent request failed.",
    }, { status });
  }
}
