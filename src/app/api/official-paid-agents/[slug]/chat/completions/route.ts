import { NextRequest, NextResponse } from "next/server";

import {
  getOfficialPaidAgentStatus,
  proxyOfficialPaidAgentRequest,
} from "@/lib/services/paid-agent-cloud-client";

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
    ...(await getOfficialPaidAgentStatus(slug)),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  try {
    return await proxyOfficialPaidAgentRequest(request, slug);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Official paid-agent request failed.",
    }, { status: 500 });
  }
}
