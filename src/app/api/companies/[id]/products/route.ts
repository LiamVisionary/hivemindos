// guard:allow-hive-action-route - dashboard-only catalog editing + offer publish/unpublish toggles; pricing stays in the replicated catalog and purchases settle on the separate payment-authenticated seller route.
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { getCompany, setCompanyProducts } from "@/lib/services/companies-store";
import {
  companyOfferGatewayStatus,
  publishCompanyProductOffer,
  unpublishCompanyProductOffer,
} from "@/lib/services/company-offer-gateway";
import { ensureCompanyProductsSeeded } from "@/lib/services/company-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Zero Human Companies "Products" tab: the company's official catalog of
// sellable packages + prices. The catalog lives in the replicated definitions
// file (Operations/Companies/companies.json in the shared vault), so a save
// here propagates to every fleet machine and into every dispatched agent's
// standing context. GET opportunistically seeds a never-configured catalog
// from the attached repo's conventional pricing file (config/pricing.json et
// al.); after that first seed the vault value is the single source of truth.

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return errorJson("Company id is required.");

  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);

  const seeded = await ensureCompanyProductsSeeded(company).catch(() => company);
  return okJson({
    products: seeded.products ?? null,
    // Seller readiness for the Products tab's publish controls: enabled state,
    // missing env NAMES, and this company's live offers.
    offerGateway: await companyOfferGatewayStatus(companyId).catch(() => null),
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return errorJson("Company id is required.");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  // Seller publication: flip one catalog product's x402 offer on/off. The
  // catalog price stays the only pricing authority; publish assigns the
  // public slug server-side.
  const action = typeof body?.action === "string" ? body.action : "";
  if (action === "publish-x402-offer" || action === "unpublish-x402-offer") {
    const productKey = typeof body?.productKey === "string" ? body.productKey.trim() : "";
    if (!productKey) return errorJson("productKey is required.");
    try {
      if (action === "publish-x402-offer") {
        const { company, offer } = await publishCompanyProductOffer(companyId, productKey);
        return okJson({ products: company.products ?? null, offer });
      }
      const company = await unpublishCompanyProductOffer(companyId, productKey);
      return okJson({ products: company.products ?? null });
    } catch (error) {
      return errorJson(error instanceof Error ? error.message : "Offer update failed.", 400);
    }
  }

  if (!body || !Array.isArray(body.items)) return errorJson("A JSON body with an items array is required.");

  const company = await setCompanyProducts(companyId, { items: body.items });
  if (!company) return errorJson("Company not found.", 404);
  return okJson({ products: company.products ?? null });
}
