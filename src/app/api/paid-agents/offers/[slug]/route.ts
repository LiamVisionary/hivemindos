import { NextRequest, NextResponse } from "next/server";

import {
  getCompanyOfferBySlug,
  processCompanyOfferPurchase,
  publicCompanyOfferInfo,
} from "@/lib/services/company-offer-gateway";
import { sellerPaymentConfigFromEnv } from "@/lib/services/paid-agent-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

// One published company product offer. GET = public offer info (price comes
// from the company catalog server-side); POST = the x402 purchase, where
// payment is the auth — see processCompanyOfferPurchase for the gate chain.
export async function GET(_request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const offer = await getCompanyOfferBySlug(slug);
  if (!offer) {
    return NextResponse.json({ ok: false, error: "Offer is not published." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, offer: publicCompanyOfferInfo(offer, sellerPaymentConfigFromEnv()) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  try {
    return await processCompanyOfferPurchase(request, slug);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Offer purchase failed.",
    }, { status: 500 });
  }
}
