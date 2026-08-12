import { NextRequest, NextResponse } from "next/server";

import { proxyOfficialPaidAgentCreditSubscriptionPlansRequest } from "@/lib/services/paid-agent-cloud-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "OPTIONS, GET" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return proxyOfficialPaidAgentCreditSubscriptionPlansRequest(request, slug);
}
