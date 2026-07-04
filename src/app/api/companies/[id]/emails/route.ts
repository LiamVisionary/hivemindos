import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { getCompany } from "@/lib/services/companies-store";
import { readCompanyEmailThreads } from "@/lib/services/agent-mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: streams a company's crew outreach threads for the Zero Human
// Companies "Emails" tab. Maps the company's member agents to their AgentMail
// inboxes and merges each inbox's recent threads. No mutation (GET only), so it
// stays out of the Hive action route registry.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });

  const company = await getCompany(companyId);
  if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });

  try {
    const result = await readCompanyEmailThreads({ agentIds: company.agentIds ?? [] });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load email threads." },
      { status: 400 },
    );
  }
}
