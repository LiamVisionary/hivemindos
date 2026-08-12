import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { getCompany } from "@/lib/services/companies-store";
import { readCompanySetupBlockers } from "@/lib/services/company-setup-blockers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: the required shared-env keys a company's crew is still blocked on
// (e.g. a missing CAN-SPAM mailing address), for the Cockpit's high-priority
// setup band. Derived from live env presence, so it clears itself once the key is
// saved. GET only (no mutation), so it stays out of the Hive action route registry.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });

  const company = await getCompany(companyId);
  if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });

  try {
    const blockers = await readCompanySetupBlockers({
      id: companyId,
      projectId: company.projectId,
      setupEnvKeys: company.setupEnvKeys,
    });
    return NextResponse.json({ ok: true, blockers });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load setup blockers." },
      { status: 400 },
    );
  }
}
