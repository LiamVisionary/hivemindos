import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { getCompany } from "@/lib/services/companies-store";
import { scanCompanyEmailQa } from "@/lib/services/company-email-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guard:allow-hive-action-route - read-only email quality scan of the emails a
// company's crew already sent. It live-probes the CTA/booking links and runs one
// tool-less LLM review per email; it never sends, mutates, or spends beyond LLM
// tokens. GET = fast deterministic pass; POST { deep: true } adds the AI layer.

async function contextFor(companyId: string) {
  const company = await getCompany(companyId).catch(() => null);
  const apex = company?.apexGoal as { title?: string } | undefined;
  return {
    companyId,
    agentIds: Array.isArray(company?.agentIds) ? company!.agentIds : [],
    projectId: typeof company?.projectId === "string" ? company.projectId : undefined,
    companyName: company?.name || "",
    charter: typeof company?.charter === "string" ? company.charter : "",
    apexGoal: apex?.title || "",
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });
  try {
    const report = await scanCompanyEmailQa({ ...(await contextFor(companyId)), deep: false });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Email QA scan failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Company id is required." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { deep?: unknown };
  const deep = body.deep !== false; // POST defaults to the deep AI scan
  try {
    const report = await scanCompanyEmailQa({ ...(await contextFor(companyId)), deep });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Email QA scan failed." }, { status: 400 });
  }
}
