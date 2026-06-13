import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  companySpendRollup,
  deleteCompany,
  readCompanies,
  setCompanyAgents,
  setCompanyFrozen,
  upsertCompany,
} from "@/lib/services/companies-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Company control surface: list companies with their member count and budget
// rollup, create/update them, flip the kill switch, or delete.
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companies = await readCompanies();
  const withRollups = await Promise.all(
    companies.map(async (company) => ({
      company,
      rollup: await companySpendRollup(company, company.agentIds?.length ?? 0),
    })),
  );
  return NextResponse.json({ ok: true, companies: withRollups });
}

type CompanyBody = {
  action?: string;
  id?: string;
  name?: string;
  agentIds?: string[];
  charter?: string;
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  totalBudgetUsd?: number;
  frozen?: boolean;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => ({}))) as CompanyBody;
  const action = body.action ?? "upsert";

  try {
    if (action === "freeze" || action === "unfreeze") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await setCompanyFrozen(body.id.trim(), action === "freeze");
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "set-agents") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await setCompanyAgents(body.id.trim(), body.agentIds ?? []);
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "delete") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const removed = await deleteCompany(body.id.trim());
      return NextResponse.json({ ok: removed, error: removed ? undefined : "Company not found." }, { status: removed ? 200 : 404 });
    }
    const company = await upsertCompany({
      id: body.id,
      name: body.name ?? "",
      agentIds: body.agentIds,
      charter: body.charter,
      dailyBudgetUsd: body.dailyBudgetUsd,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      totalBudgetUsd: body.totalBudgetUsd,
      frozen: body.frozen,
    });
    return NextResponse.json({ ok: true, company });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to save company" }, { status: 400 });
  }
}
