import "server-only";

import { mintGoogleCloudAccessToken } from "@/lib/services/integrations/google-cloud-oauth";
import type { CompanyApiBudget, GcpApiDailyCap } from "@/lib/types/company";

/**
 * Server-side "apply" backend for a per-company Google Cloud cost guardrail.
 *
 * Given a {@link CompanyApiBudget} (config authored in the UI), this mints the
 * user's OAuth access token and pushes the guardrail directly to Google Cloud
 * via two REST surfaces:
 *
 *  1. Service Usage consumer quota overrides (v1beta1) — one per-day quota
 *     override per {@link GcpApiDailyCap} on its metric's per-day limit, so a
 *     runaway loop is throttled by Google before it can bill.
 *  2. Cloud Billing Budgets (v1) — a monthly billing budget that emails/pubsubs
 *     at threshold, so the human sees the spend approaching the ceiling.
 *
 * Every step is best-effort: a failure on one cap or the budget is collected
 * into `errors[]` (sanitized — never the bearer token) rather than throwing, so
 * a partial apply still persists what did land. The budget resource name is
 * returned so re-applies PATCH the same budget instead of stacking duplicates.
 *
 * Verified REST shapes (Google docs, 2026-07-09):
 *  - Override create:
 *    POST https://serviceusage.googleapis.com/v1beta1/{parent}/consumerOverrides?force=true
 *    parent = projects/{project}/services/{service}/consumerQuotaMetrics/{metricId}/limits/{limitId}
 *    metricId and limitId are URL-encoded ("/" -> %2F). Body is a QuotaOverride:
 *    { overrideValue: "<int64>", dimensions: {} } (dimensions empty for a
 *    "1/d/{project}" unit — the project is implicit in the parent).
 *  - Budget create: POST https://billingbudgets.googleapis.com/v1/billingAccounts/{id}/budgets
 *  - Budget patch:  PATCH https://billingbudgets.googleapis.com/v1/{budgetResourceName}?updateMask=...
 *  - Projects list: GET https://cloudresourcemanager.googleapis.com/v1/projects
 *  - Billing accts: GET https://cloudbilling.googleapis.com/v1/billingAccounts
 *  - Metrics list:  GET https://serviceusage.googleapis.com/v1beta1/projects/{project}/services/{service}/consumerQuotaMetrics
 */

const SERVICE_USAGE_BASE = "https://serviceusage.googleapis.com/v1beta1";
const BILLING_BUDGETS_BASE = "https://billingbudgets.googleapis.com/v1";
const RESOURCE_MANAGER_BASE = "https://cloudresourcemanager.googleapis.com/v1";
const CLOUD_BILLING_BASE = "https://cloudbilling.googleapis.com/v1";

const REQUEST_TIMEOUT_MS = 20_000;

/** Injectable dependencies so hermetic tests can stub the token + fetch. */
export interface GcpBudgetDeps {
  mintToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface ApplyCompanyApiBudgetResult {
  appliedAt: string;
  budgetResourceName?: string;
  errors: string[];
}

export interface GcpProjectSummary {
  projectId: string;
  projectNumber: string;
  name: string;
  lifecycleState?: string;
}

export interface GcpBillingAccountSummary {
  name: string;
  displayName: string;
  open: boolean;
}

export interface GcpOverridableMetricSummary {
  /** Fully-qualified metric name, e.g. "places.googleapis.com/SearchTextRequest". */
  metric: string;
  displayName?: string;
  /** Per-day limit's quota unit, e.g. "1/d/{project}". */
  unit: string;
  /** The limit's short id ("/d/{project}"), needed to address the override. */
  limitName: string;
  /** Current effective per-day value, when Google reports one. */
  effectiveValue?: number | null;
}

/**
 * Strip any bearer token, Authorization header value, or access-token-looking
 * substring out of an error message before it is surfaced to the client or
 * persisted onto the company definition.
 */
function sanitizeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  // Never leak an OAuth access token (ya29.* / long bearer strings).
  message = message.replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]");
  message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]");
  return message.slice(0, 500);
}

/** URL-encode a path segment that may itself contain slashes (metric / limit ids). */
function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

async function gcpFetch(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { rawText: text };
    }
  }
  if (!response.ok) {
    const err = (payload as { error?: { message?: string; status?: string } } | null)?.error;
    const detail = err?.message || (payload as { rawText?: string } | null)?.rawText || `HTTP ${response.status}`;
    throw new Error(`Google API ${response.status}: ${detail}`);
  }
  return payload;
}

/**
 * Build the consumerOverrides parent path for a per-day cap. The metric and the
 * limit id are URL-encoded because they contain slashes ("/") that would
 * otherwise be read as extra path segments.
 *
 * A ConsumerQuotaLimit's short name is the trailing segment after `.../limits/`;
 * for a per-day, per-project limit it looks like "/d/{project}" — which is
 * exactly what {@link GcpApiDailyCap.unit} carries minus the leading "1". We
 * derive the limit id from the unit so the caller only has to supply the unit.
 */
export function overrideParentPath(cap: GcpApiDailyCap, projectRef: string, service: string): string {
  // unit "1/d/{project}" -> limit id "/d/{project}".
  const limitId = cap.unit.replace(/^1/, "");
  return (
    `projects/${encodeURIComponent(projectRef)}` +
    `/services/${encodeURIComponent(service)}` +
    `/consumerQuotaMetrics/${encodeSegment(cap.metric)}` +
    `/limits/${encodeSegment(limitId)}`
  );
}

/**
 * Apply a company's Google Cloud cost guardrail: per-day quota overrides for
 * each daily cap, plus a monthly billing budget. Collects per-step failures
 * into `errors[]` instead of throwing, and returns the budget resource name so
 * a re-apply updates it in place.
 */
export async function applyCompanyApiBudget(
  budget: CompanyApiBudget,
  deps: GcpBudgetDeps = {},
): Promise<ApplyCompanyApiBudgetResult> {
  const mintToken = deps.mintToken ?? mintGoogleCloudAccessToken;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];

  let token: string;
  try {
    token = await mintToken();
  } catch (error) {
    return { appliedAt: now().toISOString(), errors: [sanitizeError(error)] };
  }

  // Address quota limits by projectId when present, else projectNumber. Service
  // Usage accepts either in the parent path.
  const projectRef = budget.projectId?.trim() || budget.projectNumber?.trim() || "";
  if (!projectRef) {
    errors.push("No projectId or projectNumber set; cannot address quota overrides.");
  }

  // 1) Per-day quota overrides — one per cap.
  if (projectRef) {
    for (const cap of budget.dailyCaps) {
      try {
        const parent = overrideParentPath(cap, projectRef, budget.service);
        const url = `${SERVICE_USAGE_BASE}/${parent}/consumerOverrides?force=true`;
        await gcpFetch(fetchImpl, token, url, {
          method: "POST",
          body: JSON.stringify({
            overrideValue: String(Math.trunc(cap.value)),
            // Empty for a per-day/per-project unit; the project is implicit in
            // the parent, so no dimension keys are required.
            dimensions: {},
          }),
        });
      } catch (error) {
        errors.push(`Quota override for ${cap.metric} (${cap.unit}): ${sanitizeError(error)}`);
      }
    }
  }

  // 2) Monthly billing budget — PATCH in place if we already have one, else create.
  let budgetResourceName = budget.budgetResourceName;
  const billingAccount = budget.billingAccount?.trim();
  if (!billingAccount) {
    errors.push("No billing account set; cannot create a monthly budget.");
  } else {
    const budgetBody = buildBudgetBody(budget);
    try {
      if (budgetResourceName) {
        const url =
          `${BILLING_BUDGETS_BASE}/${budgetResourceName}` +
          `?updateMask=${encodeURIComponent("displayName,budgetFilter,amount,thresholdRules")}`;
        const updated = (await gcpFetch(fetchImpl, token, url, {
          method: "PATCH",
          body: JSON.stringify(budgetBody),
        })) as { name?: string } | null;
        budgetResourceName = updated?.name || budgetResourceName;
      } else {
        const url = `${BILLING_BUDGETS_BASE}/billingAccounts/${encodeURIComponent(billingAccount)}/budgets`;
        const created = (await gcpFetch(fetchImpl, token, url, {
          method: "POST",
          body: JSON.stringify(budgetBody),
        })) as { name?: string } | null;
        budgetResourceName = created?.name || undefined;
      }
    } catch (error) {
      errors.push(`Monthly budget: ${sanitizeError(error)}`);
    }
  }

  return { appliedAt: now().toISOString(), budgetResourceName, errors };
}

/** Build the Cloud Billing Budget resource body from the company config. */
function buildBudgetBody(budget: CompanyApiBudget): Record<string, unknown> {
  const projectFilter = budget.projectId?.trim()
    ? { projects: [`projects/${budget.projectId.trim()}`] }
    : budget.projectNumber?.trim()
      ? { projects: [`projects/${budget.projectNumber.trim()}`] }
      : {};
  // Cloud Billing budget "units" is an int64 string of whole currency units.
  const wholeUsd = Math.max(0, Math.trunc(budget.monthlyCeilingUsd));
  return {
    displayName: `HivemindOS · ${budget.service}`,
    budgetFilter: projectFilter,
    amount: {
      specifiedAmount: {
        currencyCode: "USD",
        units: String(wholeUsd),
      },
    },
    thresholdRules: [
      { thresholdPercent: 0.5 },
      { thresholdPercent: 0.9 },
      { thresholdPercent: 1.0 },
    ],
  };
}

/** List the caller's accessible Google Cloud projects (for the UI project picker). */
export async function listGcpProjects(deps: GcpBudgetDeps = {}): Promise<GcpProjectSummary[]> {
  const token = await (deps.mintToken ?? mintGoogleCloudAccessToken)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const out: GcpProjectSummary[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${RESOURCE_MANAGER_BASE}/projects`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = (await gcpFetch(fetchImpl, token, url.toString())) as {
      projects?: Array<{ projectId?: string; projectNumber?: string; name?: string; lifecycleState?: string }>;
      nextPageToken?: string;
    } | null;
    for (const project of payload?.projects ?? []) {
      if (!project.projectId) continue;
      out.push({
        projectId: project.projectId,
        projectNumber: project.projectNumber ?? "",
        name: project.name ?? project.projectId,
        lifecycleState: project.lifecycleState,
      });
    }
    pageToken = payload?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/** List the caller's accessible billing accounts (for the UI billing picker). */
export async function listBillingAccounts(deps: GcpBudgetDeps = {}): Promise<GcpBillingAccountSummary[]> {
  const token = await (deps.mintToken ?? mintGoogleCloudAccessToken)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const out: GcpBillingAccountSummary[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CLOUD_BILLING_BASE}/billingAccounts`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = (await gcpFetch(fetchImpl, token, url.toString())) as {
      billingAccounts?: Array<{ name?: string; displayName?: string; open?: boolean }>;
      nextPageToken?: string;
    } | null;
    for (const account of payload?.billingAccounts ?? []) {
      if (!account.name) continue;
      out.push({
        name: account.name,
        displayName: account.displayName ?? account.name,
        open: account.open ?? false,
      });
    }
    pageToken = payload?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/**
 * List a service's consumer quota metrics and surface only those with a per-day
 * ("/d/") limit, so the UI can offer the metrics whose per-day cap is
 * overridable. `projectRef` may be a project id or number.
 */
export async function listOverridableDailyMetrics(
  service: string,
  projectRef: string,
  deps: GcpBudgetDeps = {},
): Promise<GcpOverridableMetricSummary[]> {
  const token = await (deps.mintToken ?? mintGoogleCloudAccessToken)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const trimmedService = service.trim();
  const trimmedRef = projectRef.trim();
  if (!trimmedService || !trimmedRef) return [];

  const out: GcpOverridableMetricSummary[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `${SERVICE_USAGE_BASE}/projects/${encodeURIComponent(trimmedRef)}` +
        `/services/${encodeURIComponent(trimmedService)}/consumerQuotaMetrics`,
    );
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = (await gcpFetch(fetchImpl, token, url.toString())) as {
      metrics?: Array<{
        metric?: string;
        displayName?: string;
        consumerQuotaLimits?: Array<{
          unit?: string;
          name?: string;
          metric?: string;
          quotaBuckets?: Array<{ effectiveLimit?: string }>;
        }>;
      }>;
      nextPageToken?: string;
    } | null;
    for (const metric of payload?.metrics ?? []) {
      const metricName = metric.metric;
      if (!metricName) continue;
      for (const limit of metric.consumerQuotaLimits ?? []) {
        const unit = limit.unit ?? "";
        if (!unit.includes("/d/")) continue; // per-day limits only
        const effectiveRaw = limit.quotaBuckets?.[0]?.effectiveLimit;
        const effective = effectiveRaw != null ? Number(effectiveRaw) : null;
        out.push({
          metric: metricName,
          displayName: metric.displayName,
          unit,
          limitName: limit.name ?? unit.replace(/^1/, ""),
          effectiveValue: Number.isFinite(effective as number) ? effective : null,
        });
      }
    }
    pageToken = payload?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}
