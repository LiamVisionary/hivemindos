import { NextResponse } from "next/server";

import { companyOfferGatewayStatus } from "@/lib/services/company-offer-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public storefront listing for company product offers sold over x402.
// Reachable without dashboard credentials (the /api/paid-agents prefix is
// payment-authenticated by design); exposes only catalog identity, prices,
// and readiness env NAMES — the same surface the paid-agent status GET
// already serves publicly. The static "offers" segment wins over the sibling
// [slug] agent route, so an agent slug named "offers" would be shadowed here.
export async function GET() {
  return NextResponse.json({ ok: true, ...(await companyOfferGatewayStatus()) });
}
