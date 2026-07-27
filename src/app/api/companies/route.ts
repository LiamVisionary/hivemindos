import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  addCompanyDirective,
  addCompanyMembers,
  claimCompanyHomeMachine,
  companySpendRollup,
  deleteCompany,
  getCompany,
  markCompanyDispatched,
  readCompanies,
  removeCompanyIntegrationLimit,
  removeCompanyDirective,
  resolveCompanyPricingProposal,
  setCompanyAgents,
  setCompanyAnalytics,
  setCompanyApprovalPolicy,
  setCompanyAutonomy,
  setCompanyFrozen,
  setCompanyIntegrationLimit,
  updateCompanyMetric,
  upsertCompany,
} from "@/lib/services/companies-store";
import { dispatchCompanyGoal } from "@/lib/services/companies-orchestration";
import { ensureAllCompanyQueens } from "@/lib/services/company-queen";
import { recordCompanyEngineBudgetSnapshot, validateEngineBudgetSnapshot } from "@/lib/services/company-engine-budget";
import { ensureCompanyProductsSeeded } from "@/lib/services/company-products";
import {
  ensureCompanyAutonomyDriver,
  getCompanyAutonomyDriverStatus,
  rememberCompanyDriverSelfBase,
} from "@/lib/services/company-autonomy-driver";
import {
  companyRevenueRailContext,
  companyRevenueRailStatusFromContext,
  opportunisticReceiptSweep,
} from "@/lib/services/company-revenue-bridge";
import { companyRevenueRollup, readCompanyRevenueLedger } from "@/lib/services/company-revenue-share";
import { appendSpend, appendSpendIdempotent, shortTarget } from "@/lib/services/wallet/spend-ledger";
import {
  consumeCompanyApiUsage,
  evaluateCompanyApiUsage,
  recordCompanyApiUsage,
  readCompanyApiUsage,
  type CompanyApiUsageInput,
} from "@/lib/services/company-api-usage";
import {
  companyExecutionCapability,
  parseCompanyExecutionConfig,
} from "@/lib/services/company-execution-capabilities";
import {
  CompanyAeonBindingError,
  resolveCompanyAeonBinding,
} from "@/lib/services/company-aeon-binding";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { connectorManifest } from "@/lib/services/integrations/connector-manifests";
import {
  CompanyMembershipConflictError,
  findDuplicateCompanyMemberships,
} from "@/lib/services/company-membership";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import type {
  Company,
  CompanyApexGoal,
  CompanyApprovalPolicy,
  CompanyAutonomyPause,
  CompanyIntegrationLimit,
  CompanyMember,
  CompanyRevenue,
} from "@/lib/types/company";
import type { CompanyImportedOperations } from "@/lib/types/company-import";
import type { KanbanTaskAttachment } from "@/lib/types/kanban";

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
  let companies = await readCompanies();
  if (companies.some((company) => company.autonomy && !company.frozen)) ensureCompanyAutonomyDriver();
  // First-read product seeding: a company that never had a catalog inherits
  // default pricing from its attached repo's conventional pricing file (a
  // write-once vault update), so its Products tab appears without a manual
  // setup step. No-op for every company that already has (or emptied) one.
  // Sequential on purpose: each seed is a read-modify-write of the shared
  // definitions file, so parallel seeds could drop each other's write.
  companies = await (async () => {
    const seeded: Company[] = [];
    for (const company of companies) seeded.push(await ensureCompanyProductsSeeded(company).catch(() => company));
    return seeded;
  })();
  // Company CEO seeding, same self-heal stance: every company carries its own
  // cloned queen agent + non-removable Queen member. Cheap once settled — the
  // profile check is memoized per process and the member check is pure, so a
  // steady-state poll does no writes.
  companies = await ensureAllCompanyQueens(companies).catch(() => companies);
  // Same self-heal stance as the driver revive above: any settled x402 seller
  // receipts sweep into the revenue ledger (throttled + idempotent) before the
  // rollups are computed, so revenue and apex progress never wait on a human.
  await opportunisticReceiptSweep();
  const revenueRecords = await readCompanyRevenueLedger().catch(() => []);
  const railContext = await companyRevenueRailContext().catch(() => null);
  const withRollups = await Promise.all(
    companies.map(async (company) => ({
      company,
      rollup: await companySpendRollup(company, company.agentIds?.length ?? 0),
      revenueShare: await companyRevenueRollup(company.id, revenueRecords),
      revenueRail: railContext ? companyRevenueRailStatusFromContext(railContext, company.id) : undefined,
    })),
  );
  // Driver health rides along so the UI can say "stalled" instead of showing a
  // company as running while nothing is actually dispatching.
  return NextResponse.json({
    ok: true,
    companies: withRollups,
    driver: getCompanyAutonomyDriverStatus(),
    membershipConflicts: findDuplicateCompanyMemberships(companies),
  });
}

type CompanyBody = {
  action?: string;
  id?: string;
  /** record-engine-api-budget: the engine bridge's spend-meter snapshot. */
  snapshot?: unknown;
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
  execution?: Company["execution"];
  analyticsProvider?: Company["analyticsProvider"];
  analyticsConfig?: Company["analyticsConfig"];
  importedOperations?: CompanyImportedOperations;
  autonomyPause?: CompanyAutonomyPause | null;
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
  // add-directive / remove-directive
  directive?: { text?: string; skill?: string; skills?: string[]; attachments?: KanbanTaskAttachment[]; source?: "inject" | "reject"; deliverableRef?: string };
  directiveId?: string;
  // set-approval-policy
  approvalPolicy?: CompanyApprovalPolicy;
  // resolve-pricing (human decision on a crew-raised price-change request)
  proposalId?: string;
  decision?: string;
  // record-api-cost (paid cloud-API spend reported by a company's meter)
  amountUsd?: number;
  target?: string;
  agentId?: string;
  // set/remove/check/consume integration limits and usage
  integrationLimit?: unknown;
  limitId?: string;
  providerKey?: string;
  operationId?: string;
  requestCount?: number;
  idempotencyKey?: string;
};

type IntegrationLimitInput = Omit<CompanyIntegrationLimit, "id" | "createdAt" | "updatedAt"> & { id?: string };

function positiveOptionalNumber(value: unknown, label: string, integer = false): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a positive${integer ? " whole" : ""} number.`);
  }
  return value;
}

function validateIntegrationLimit(value: unknown): IntegrationLimitInput {
  if (!value || typeof value !== "object") throw new Error("integrationLimit is required.");
  const raw = value as Record<string, unknown>;
  const providerKey = typeof raw.providerKey === "string" ? raw.providerKey.trim() : "";
  const manifest = connectorManifest(providerKey);
  if (!manifest) throw new Error("Choose a supported integration provider.");
  const operationId = typeof raw.operationId === "string" ? raw.operationId.trim() : "";
  if (operationId && !manifest.operations.some((operation) => operation.id === operationId)) {
    throw new Error(`Choose an operation supported by ${manifest.label}.`);
  }
  const limit: IntegrationLimitInput = {
    id: typeof raw.id === "string" ? raw.id.trim() || undefined : undefined,
    providerKey: manifest.key,
    operationId: operationId || undefined,
    dailyRequestLimit: positiveOptionalNumber(raw.dailyRequestLimit, "dailyRequestLimit", true),
    monthlyRequestLimit: positiveOptionalNumber(raw.monthlyRequestLimit, "monthlyRequestLimit", true),
    dailySpendLimitUsd: positiveOptionalNumber(raw.dailySpendLimitUsd, "dailySpendLimitUsd"),
    monthlySpendLimitUsd: positiveOptionalNumber(raw.monthlySpendLimitUsd, "monthlySpendLimitUsd"),
  };
  if (!limit.dailyRequestLimit && !limit.monthlyRequestLimit && !limit.dailySpendLimitUsd && !limit.monthlySpendLimitUsd) {
    throw new Error("Set at least one positive request or spend limit.");
  }
  return limit;
}

function validateUsageInput(body: CompanyBody): CompanyApiUsageInput {
  const providerKey = body.providerKey?.trim() ?? "";
  const manifest = connectorManifest(providerKey);
  if (!manifest) throw new Error("Choose a supported integration provider.");
  const operationId = body.operationId?.trim();
  if (operationId && !manifest.operations.some((operation) => operation.id === operationId)) {
    throw new Error(`Choose an operation supported by ${manifest.label}.`);
  }
  const requestCount = body.requestCount === undefined ? 1 : body.requestCount;
  if (!Number.isInteger(requestCount) || requestCount < 0) throw new Error("requestCount must be a non-negative integer.");
  const amountUsd = body.amountUsd === undefined ? 0 : body.amountUsd;
  if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error("amountUsd must be a finite non-negative number.");
  return {
    providerKey: manifest.key,
    operationId: operationId || undefined,
    requestCount,
    amountUsd,
    source: body.source?.trim() || "companies-api",
    idempotencyKey: body.idempotencyKey?.trim() || undefined,
  };
}

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
    if (action === "set-integration-limit") {
      if (!body.id?.trim()) return errorJson("id is required", 400);
      const company = await setCompanyIntegrationLimit(body.id.trim(), validateIntegrationLimit(body.integrationLimit));
      if (!company) return errorJson("Company not found.", 404);
      return okJson({ company, integrationLimits: company.integrationLimits ?? [] });
    }
    if (action === "remove-integration-limit") {
      if (!body.id?.trim() || !body.limitId?.trim()) return errorJson("id and limitId are required", 400);
      const company = await removeCompanyIntegrationLimit(body.id.trim(), body.limitId.trim());
      if (!company) return errorJson("Company not found.", 404);
      return okJson({ company, integrationLimits: company.integrationLimits ?? [] });
    }
    if (action === "record-engine-api-budget") {
      // A company's own deterministic engine (e.g. maps-agency's bridge)
      // reporting its in-process spend meter + cap state for the Limits tab.
      if (!body.id?.trim()) return errorJson("id is required", 400);
      const company = await getCompany(body.id.trim());
      if (!company) return errorJson("Company not found.", 404);
      const snapshot = validateEngineBudgetSnapshot(body.snapshot);
      if (!snapshot) return errorJson("A valid engine budget snapshot is required.", 400);
      await recordCompanyEngineBudgetSnapshot(company.id, snapshot);
      return okJson({ recorded: true });
    }
    if (action === "check-api-usage" || action === "consume-api-usage" || action === "record-api-usage") {
      if (!body.id?.trim()) return errorJson("id is required", 400);
      const company = await getCompany(body.id.trim());
      if (!company) return errorJson("Company not found.", 404);
      const usageInput = validateUsageInput(body);
      if (action === "record-api-usage") {
        const observation = await recordCompanyApiUsage(company.id, usageInput);
        if (observation.record.amountUsd > 0) {
          await appendSpendIdempotent({
            agentId: body.agentId?.trim() || "system:api-meter",
            companyId: company.id,
            kind: "api",
            asset: "USD",
            amountUsd: observation.record.amountUsd,
            target: shortTarget(body.target || `${observation.record.providerKey}:${observation.record.operationId || "all"}`),
            status: "executed",
            createdAtMs: observation.record.createdAtMs,
          }, `company-api-usage:${observation.record.id}`);
        }
        return okJson({ ...observation, treasuryRecorded: observation.record.amountUsd > 0 });
      }
      const decision = action === "consume-api-usage"
        ? await consumeCompanyApiUsage(company, usageInput)
        : evaluateCompanyApiUsage(company, usageInput, await readCompanyApiUsage());
      if (decision.decision === "block") {
        return errorJson(decision.reason ?? "This integration call is blocked by a company limit.", 429, { decision });
      }
      return okJson({ decision });
    }
    if (action === "record-api-cost") {
      // A company's paid-API meter reports its incremental cloud spend so it lands
      // in the unified spend ledger and surfaces in the Treasury. Server records
      // the amount as reported (spend up); it never grants entitlement.
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const amountUsd = Math.max(0, Number(body.amountUsd) || 0);
      await appendSpend({
        agentId: (body.agentId || "system:api-meter").trim(),
        companyId: body.id.trim(),
        kind: "api",
        asset: "USDC",
        amountUsd,
        target: shortTarget(body.target),
        status: "executed",
      });
      return NextResponse.json({ ok: true });
    }
    if (action === "dispatch-goal") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await getCompany(body.id.trim());
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      if (!company.apexGoal?.title?.trim()) return NextResponse.json({ ok: false, error: "Set an apex goal before launching work." }, { status: 400 });
      if (companyExecutionCapability(company.execution).autonomy.requiresCompanyCrew && !company.agentIds?.length) {
        return NextResponse.json({ ok: false, error: "Staff the company with at least one agent first." }, { status: 400 });
      }
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
    if (action === "add-directive") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      if (!body.directive?.text?.trim()) return NextResponse.json({ ok: false, error: "Directive text is required." }, { status: 400 });
      const company = await addCompanyDirective(body.id.trim(), {
        text: body.directive.text,
        skill: body.directive.skill,
        skills: body.directive.skills,
        attachments: body.directive.attachments,
        source: body.directive.source,
        deliverableRef: body.directive.deliverableRef,
      });
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "remove-directive") {
      if (!body.id?.trim() || !body.directiveId?.trim()) return NextResponse.json({ ok: false, error: "id and directiveId are required" }, { status: 400 });
      const company = await removeCompanyDirective(body.id.trim(), body.directiveId.trim());
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "set-approval-policy") {
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      if (!body.approvalPolicy) return NextResponse.json({ ok: false, error: "approvalPolicy is required" }, { status: 400 });
      const company = await setCompanyApprovalPolicy(body.id.trim(), body.approvalPolicy);
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    if (action === "resolve-pricing") {
      if (!body.id?.trim() || !body.proposalId?.trim()) return NextResponse.json({ ok: false, error: "id and proposalId are required" }, { status: 400 });
      const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
      if (!decision) return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
      const company = await resolveCompanyPricingProposal(body.id.trim(), body.proposalId.trim(), decision, body.note);
      if (!company) return NextResponse.json({ ok: false, error: "Company or proposal not found." }, { status: 404 });
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
    if (action === "set-analytics") {
      // Merge-safe: sets ONLY the analytics link so the Analytics tab's provider
      // cards can (re)point a company without a full upsert blanking other fields.
      if (!body.id?.trim()) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      const company = await setCompanyAnalytics(body.id.trim(), body.analyticsProvider, body.analyticsConfig);
      if (!company) return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });
      return NextResponse.json({ ok: true, company });
    }
    const execution = body.execution === undefined ? undefined : parseCompanyExecutionConfig(body.execution);
    if (execution && !execution.ok) {
      return errorJson(execution.error, 400);
    }
    if (execution?.value.engine === "aeon") {
      try {
        await resolveCompanyAeonBinding(execution.value.profileId, execution.value.skill);
      } catch (error) {
        if (error instanceof CompanyAeonBindingError) return errorJson(error.message, error.status);
        throw error;
      }
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
      execution: execution?.value,
      analyticsProvider: body.analyticsProvider,
      analyticsConfig: body.analyticsConfig,
      importedOperations: body.importedOperations,
      autonomyPause: body.autonomyPause,
    });
    return NextResponse.json({ ok: true, company });
  } catch (error) {
    if (error instanceof CompanyMembershipConflictError) return errorJson(error.message, error.status);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to save company" }, { status: 400 });
  }
}
