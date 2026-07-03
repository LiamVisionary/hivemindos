import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  addCompanyMembers,
  claimCompanyHomeMachine,
  companySpendRollup,
  deleteCompany,
  getCompany,
  markCompanyDispatched,
  readCompanies,
  setCompanyAgents,
  setCompanyAutonomy,
  setCompanyFrozen,
  updateCompanyMetric,
  upsertCompany,
} from "@/lib/services/companies-store";
import { dispatchCompanyGoal } from "@/lib/services/companies-orchestration";
import {
  ensureCompanyAutonomyDriver,
  getCompanyAutonomyDriverStatus,
  rememberCompanyDriverSelfBase,
} from "@/lib/services/company-autonomy-driver";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import type {
  CompanyApexGoal,
  CompanyMember,
  CompanyRevenue,
} from "@/lib/types/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Company control surface: list companies with their member count and budget
// rollup, create/update them, flip the kill switch, or delete.
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  // Every dashboard poll is a self-heal opportunity: record the loopback
  // address this request actually arrived on (PORT env is unset in some launch
  // paths, and the port alone can point at the wrong loopback family) and
  // revive the driver if its loop died — an autonomous company must never
  // depend on a one-shot boot autostart. ensure() is a cheap no-op while the
  // driver is running.
  rememberCompanyDriverSelfBase(request.headers.get("host"));
  const companies = await readCompanies();
  if (companies.some((company) => company.autonomy && !company.frozen)) ensureCompanyAutonomyDriver();
  const withRollups = await Promise.all(
    companies.map(async (company) => ({
      company,
      rollup: await companySpendRollup(company, company.agentIds?.length ?? 0),
    })),
  );
  // Driver health rides along so the UI can say "stalled" instead of showing a
  // company as running while nothing is actually dispatching.
  return NextResponse.json({ ok: true, companies: withRollups, driver: getCompanyAutonomyDriverStatus() });
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
  // Zero Human Companies metadata.
  ticker?: string;
  sector?: string;
  blurb?: string;
  status?: string;
  alignment?: number | string | null;
  apexGoal?: CompanyApexGoal;
  revenue?: CompanyRevenue;
  members?: CompanyMember[];
  homeMachineKey?: string;
  projectId?: string;
  // dispatch-goal
  fleetSnapshot?: QueenBeeFleetMachine[];
  maxTasks?: number;
  // update-metric (generic trackables rail for any business)
  current?: string | number;
  progress?: number;
  revenueValue?: string;
  revenueDelta?: string;
  source?: string;
  note?: string;
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
    if (action === "set-agents" || action === "set-members") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await setCompanyAgents(body.id.trim(), body.agentIds ?? [], body.members);
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "add-members") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await addCompanyMembers(body.id.trim(), body.members ?? []);
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "dispatch-goal") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await getCompany(body.id.trim());
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      if (!company.apexGoal?.title?.trim()) return NextResponse.json({ ok: false, error: "Set an apex goal before launching work." }, { status: 400 });
      if (!company.agentIds?.length) return NextResponse.json({ ok: false, error: "Staff the company with at least one agent first." }, { status: 400 });
      if (company.frozen) return NextResponse.json({ ok: false, error: "Company is frozen — unfreeze it before launching work." }, { status: 400 });
      // Enter perpetual autonomy BEFORE dispatching: if the dispatch fails midway,
      // the company stays autonomous and the driver re-dispatches on its next tick.
      await setCompanyAutonomy(company.id, true);
      // Claim-on-launch: an explicit Launch from this machine makes it the home
      // machine (only the home machine's driver auto-dispatches a replicated company).
      await claimCompanyHomeMachine(company.id);
      ensureCompanyAutonomyDriver();
      const dispatch = await dispatchCompanyGoal(company, Array.isArray(body.fleetSnapshot) ? body.fleetSnapshot : [], { maxTasks: body.maxTasks, origin: request.nextUrl.origin });
      await markCompanyDispatched(company.id, Date.now());
      return NextResponse.json({ ok: true, dispatch });
    }
    if (action === "update-metric") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await updateCompanyMetric(body.id.trim(), {
        current: body.current,
        progress: body.progress,
        revenueValue: body.revenueValue,
        revenueDelta: body.revenueDelta,
        source: body.source,
        note: body.note,
      });
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "stop-autonomy") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await setCompanyAutonomy(body.id.trim(), false);
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
      ticker: body.ticker,
      sector: body.sector,
      blurb: body.blurb,
      status: body.status,
      alignment: body.alignment,
      apexGoal: body.apexGoal,
      revenue: body.revenue,
      members: body.members,
      homeMachineKey: body.homeMachineKey,
      projectId: body.projectId,
    });
    return NextResponse.json({ ok: true, company });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to save company" }, { status: 400 });
  }
}
