import { NextRequest, NextResponse } from "next/server";

import { proxyOfficialPaidAgentCreditTopUpRequest } from "@/lib/services/paid-agent-cloud-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "OPTIONS, POST",
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return proxyOfficialPaidAgentCreditTopUpRequest(request, slug);
}
