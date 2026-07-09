import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { getCompany, setCompanyApiBudget } from "@/lib/services/companies-store";
import {
  applyCompanyApiBudget,
  listBillingAccounts,
  listGcpProjects,
} from "@/lib/services/gcp-budget-admin";
import type { CompanyApiBudget, GcpApiDailyCap } from "@/lib/types/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-company Google Cloud cost-guardrail apply route. POST validates a
// client-authored budget config, enforces the raise-gate (a HIGHER ceiling or
// per-day cap needs an explicit confirmRaise), then applies it to Google Cloud
// (per-day quota overrides + a monthly billing budget) using the user's stored
// OAuth token and persists the provider-side apply status. GET returns the
// company's budgets plus the project/billing pickers, degrading gracefully to
// { connected: false } when no Google Cloud account is connected.

/** A finite, non-negative number (rejects NaN/Infinity/negatives). */
function isFiniteNonNeg(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

interface ValidatedBudget {
  budget: CompanyApiBudget;
}

/**
 * Coerce an untrusted body into a CompanyApiBudget. The server is authoritative
 * for provider-side state, so `appliedAt` / `appliedError` / `budgetResourceName`
 * are NEVER read from the client here — they are set from the apply result.
 */
function validateBudgetBody(body: Record<string, unknown> | null): ValidatedBudget | { error: string } {
  if (!body || typeof body !== "object") return { error: "A JSON budget body is required." };
  if (body.provider !== "gcp") return { error: 'Only the "gcp" provider is supported.' };

  const service = typeof body.service === "string" ? body.service.trim() : "";
  if (!service) return { error: "A service is required (e.g. places.googleapis.com)." };

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const projectNumber = typeof body.projectNumber === "string" ? body.projectNumber.trim() : "";
  if (!projectId && !projectNumber) return { error: "A projectId or projectNumber is required." };

  const billingAccount = typeof body.billingAccount === "string" ? body.billingAccount.trim() : "";
  if (!billingAccount) return { error: "A billingAccount is required." };

  if (!isFiniteNonNeg(body.monthlyCeilingUsd)) {
    return { error: "monthlyCeilingUsd must be a finite non-negative number." };
  }

  if (!Array.isArray(body.dailyCaps)) return { error: "dailyCaps must be an array." };
  const dailyCaps: GcpApiDailyCap[] = [];
  for (const raw of body.dailyCaps as unknown[]) {
    if (!raw || typeof raw !== "object") return { error: "Each dailyCap must be an object." };
    const cap = raw as Record<string, unknown>;
    const metric = typeof cap.metric === "string" ? cap.metric.trim() : "";
    if (!metric) return { error: "Each dailyCap needs a non-empty metric." };
    const unit = typeof cap.unit === "string" ? cap.unit.trim() : "";
    if (!unit) return { error: `dailyCap for ${metric} needs a unit (e.g. 1/d/{project}).` };
    if (!isFiniteNonNeg(cap.value)) {
      return { error: `dailyCap for ${metric} needs a finite non-negative value.` };
    }
    const entry: GcpApiDailyCap = { metric, value: cap.value, unit };
    if (isFiniteNonNeg(cap.skuUnitCostUsd)) entry.skuUnitCostUsd = cap.skuUnitCostUsd;
    if (isFiniteNonNeg(cap.freeMonthlyCalls)) entry.freeMonthlyCalls = cap.freeMonthlyCalls;
    dailyCaps.push(entry);
  }

  const budget: CompanyApiBudget = {
    provider: "gcp",
    service,
    projectId,
    projectNumber,
    billingAccount,
    monthlyCeilingUsd: body.monthlyCeilingUsd,
    dailyCaps,
  };
  return { budget };
}

/**
 * Compare the incoming budget against the currently-saved one for the same
 * service and list every field that is being RAISED (looser). Raising a
 * guardrail spends more money, so it needs an explicit confirmation; lowering
 * (tightening) always applies immediately.
 */
function raisedFields(next: CompanyApiBudget, current: CompanyApiBudget | undefined): string[] {
  if (!current) return []; // First-time set is not a "raise" of an existing cap.
  const raised: string[] = [];
  if (next.monthlyCeilingUsd > current.monthlyCeilingUsd) {
    raised.push(
      `monthlyCeilingUsd (${current.monthlyCeilingUsd} → ${next.monthlyCeilingUsd})`,
    );
  }
  const currentByMetric = new Map(current.dailyCaps.map((cap) => [cap.metric, cap.value]));
  for (const cap of next.dailyCaps) {
    const prior = currentByMetric.get(cap.metric);
    // Only an increase over a KNOWN prior value is a raise; a brand-new metric
    // cap is not (there was no lower cap to loosen).
    if (prior !== undefined && cap.value > prior) {
      raised.push(`dailyCap[${cap.metric}] (${prior} → ${cap.value})`);
    }
  }
  return raised;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return errorJson("Company id is required.");

  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);

  const apiBudgets = company.apiBudgets ?? [];
  // The list helpers mint the OAuth token; if Google Cloud isn't connected they
  // throw a human-readable error. Degrade to { connected: false } rather than a
  // 500 so the editor can render its "connect Google Cloud" state.
  try {
    const [projects, billingAccounts] = await Promise.all([listGcpProjects(), listBillingAccounts()]);
    return okJson({ connected: true, apiBudgets, projects, billingAccounts });
  } catch {
    return okJson({ connected: false, apiBudgets, projects: [], billingAccounts: [] });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return errorJson("Company id is required.");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const validated = validateBudgetBody(body);
  if ("error" in validated) return errorJson(validated.error);
  const { budget } = validated;

  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);

  // Raise-gate (interim safety floor). TODO: fold this into the full
  // CompanyApprovalPolicy stack so raising a cloud budget can be routed through
  // the same human-approval queue as other governed company actions; for now
  // the explicit confirmRaise flag is the guard.
  const current = (company.apiBudgets ?? []).find(
    (entry) => entry.provider === "gcp" && entry.service === budget.service,
  );
  const raised = raisedFields(budget, current);
  if (raised.length > 0 && body?.confirmRaise !== true) {
    return errorJson(
      "This change raises the cost guardrail; confirm the raise to apply it.",
      409,
      { raisedFields: raised, requiresConfirmRaise: true },
    );
  }

  // Persist the requested config first (server owns provider-side status), then
  // apply to Google Cloud, then persist the apply result back onto the entry.
  const saved = await setCompanyApiBudget(companyId, budget);
  if (!saved) return errorJson("Company not found.", 404);

  const result = await applyCompanyApiBudget(budget);
  const applied: CompanyApiBudget = {
    ...budget,
    appliedAt: result.appliedAt,
    budgetResourceName: result.budgetResourceName,
    appliedError: result.errors.length > 0 ? result.errors.join("; ") : undefined,
  };
  const persisted = await setCompanyApiBudget(companyId, applied);

  return okJson({
    company: persisted ?? saved,
    apiBudget: applied,
    apply: { appliedAt: result.appliedAt, budgetResourceName: result.budgetResourceName, errors: result.errors },
  });
}
