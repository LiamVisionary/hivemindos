import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { getCompany } from "@/lib/services/companies-store";
import { readCompanyAnalyticsSummary } from "@/lib/services/company-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: at-a-glance analytics for a company's linked provider (PostHog /
// Plausible / GA4 / HivemindOS funnel), or a guided-setup payload when none is
// linked. Mirrors the Emails tab route; returns the service's four-state result
// as-is (ok + state) so the panel can render honestly. GET only, so it stays out
// of the Hive action route registry.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });

  const company = await getCompany(companyId);
  if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });

  const rangeDays = Number(new URL(request.url).searchParams.get("days")) || 7;
  try {
    const result = await readCompanyAnalyticsSummary(company, { rangeDays });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, state: "error", error: error instanceof Error ? error.message : "Failed to load analytics." },
      { status: 400 },
    );
  }
}
