import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { getCompany, setCompanyProducts } from "@/lib/services/companies-store";
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
  return okJson({ products: seeded.products ?? null });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return errorJson("Company id is required.");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.items)) return errorJson("A JSON body with an items array is required.");

  const company = await setCompanyProducts(companyId, { items: body.items });
  if (!company) return errorJson("Company not found.", 404);
  return okJson({ products: company.products ?? null });
}
