import "server-only";

import { mintGoogleCloudAccessToken } from "@/lib/services/integrations/google-cloud-oauth";
import type { CompanyApiBudget } from "@/lib/types/company";

/**
 * Server-side "apply" backend for a per-company Google Cloud cost guardrail.
 *
 * Given a {@link CompanyApiBudget} (config authored in the UI), this mints the
 * user's OAuth access token and pushes the guardrail directly to Google Cloud
 * via two REST surfaces:
 *
 *  1. Service Usage consumer quota import (v1beta1) — atomically creates or
 *     updates every selected per-day override, so re-applying a saved limit
 *     cannot collide with the existing provider resource.
 *  2. Cloud Billing Budgets (v1) — a monthly billing budget that emails/pubsubs
 *     at threshold, so the human sees the spend approaching the ceiling.
 *
 * Every step is best-effort: a failure on one cap or the budget is collected
 * into `errors[]` (sanitized — never the bearer token) rather than throwing, so
 * a partial apply still persists what did land. The budget resource name is
 * returned so re-applies PATCH the same budget instead of stacking duplicates.
 *
 * Verified REST shapes (Google docs, 2026-07-09):
 *  - Override import:
 *    POST https://serviceusage.googleapis.com/v1beta1/projects/{project}/services/{service}/consumerQuotaMetrics:importConsumerOverrides
 *    with { force, inlineSource: { overrides[] } }. Google documents this
 *    method as an atomic create-or-update rail; override names stay server-owned.
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
const OPERATION_TIMEOUT_MS = 30_000;
const OPERATION_POLL_MS = 500;

/** Injectable dependencies so hermetic tests can stub the token + fetch. */
export interface GcpBudgetDeps {
  mintToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
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

export interface GcpEnabledServiceSummary {
  name: string;
  title: string;
}

export interface GcpProjectBillingInfo {
  projectId: string;
  billingAccountName: string;
  billingEnabled: boolean;
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

type GcpOperation = {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
};

async function awaitGcpOperation(
  initial: GcpOperation,
  token: string,
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  let operation = initial;
  const name = operation.name?.trim();
  if (!name || !/^operations\/[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error("Google did not return a valid quota operation name.");
  }
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (!operation.done) {
    if (Date.now() >= deadline) throw new Error(`Google quota operation ${name} did not finish within 30 seconds.`);
    await sleep(OPERATION_POLL_MS);
    operation = (await gcpFetch(fetchImpl, token, `${SERVICE_USAGE_BASE}/${name}`)) as GcpOperation;
  }
  if (operation.error) {
    throw new Error(
      `Google quota operation failed${operation.error.code ? ` (${operation.error.code})` : ""}: ` +
        (operation.error.message || "unknown provider error"),
    );
  }
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
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
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

  // 1) Per-day quota overrides — the import endpoint is the provider's atomic
  // create-or-update path, so both first apply and later edits are idempotent.
  if (projectRef && budget.dailyCaps.length > 0) {
    try {
      const parent =
        `projects/${encodeURIComponent(projectRef)}/services/${encodeURIComponent(budget.service)}`;
      const operation = (await gcpFetch(
        fetchImpl,
        token,
        `${SERVICE_USAGE_BASE}/${parent}/consumerQuotaMetrics:importConsumerOverrides`,
        {
          method: "POST",
          body: JSON.stringify({
            force: true,
            inlineSource: {
              overrides: budget.dailyCaps.map((cap) => ({
                metric: cap.metric,
                unit: cap.unit,
                overrideValue: String(Math.trunc(cap.value)),
                dimensions: {},
              })),
            },
          }),
        },
      )) as GcpOperation;
      await awaitGcpOperation(operation, token, fetchImpl, sleep);
    } catch (error) {
      errors.push(`Daily quota overrides: ${sanitizeError(error)}`);
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
        const accountId = billingAccount.replace(/^billingAccounts\//, "");
        const url = `${BILLING_BUDGETS_BASE}/billingAccounts/${encodeURIComponent(accountId)}/budgets`;
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
  const projectFilter = budget.projectNumber?.trim()
    ? { projects: [`projects/${budget.projectNumber.trim()}`] }
    : budget.projectId?.trim()
      ? { projects: [`projects/${budget.projectId.trim()}`] }
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

/** List APIs currently enabled on a project for the service picker. */
export async function listGcpEnabledServices(
  projectRef: string,
  deps: GcpBudgetDeps = {},
): Promise<GcpEnabledServiceSummary[]> {
  const trimmedRef = projectRef.trim();
  if (!trimmedRef) return [];
  const token = await (deps.mintToken ?? mintGoogleCloudAccessToken)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const out: GcpEnabledServiceSummary[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `${SERVICE_USAGE_BASE}/projects/${encodeURIComponent(trimmedRef)}/services`,
    );
    url.searchParams.set("filter", "state:ENABLED");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = (await gcpFetch(fetchImpl, token, url.toString())) as {
      services?: Array<{ config?: { name?: string; title?: string }; state?: string }>;
      nextPageToken?: string;
    } | null;
    for (const service of payload?.services ?? []) {
      const name = service.config?.name?.trim();
      if (!name || (service.state && service.state !== "ENABLED")) continue;
      out.push({ name, title: service.config?.title?.trim() || name });
    }
    pageToken = payload?.nextPageToken || undefined;
  } while (pageToken);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Read the billing account linked to one project so the UI can auto-select it. */
export async function getGcpProjectBillingInfo(
  projectRef: string,
  deps: GcpBudgetDeps = {},
): Promise<GcpProjectBillingInfo> {
  const trimmedRef = projectRef.trim();
  if (!trimmedRef) throw new Error("A Google Cloud project is required.");
  const token = await (deps.mintToken ?? mintGoogleCloudAccessToken)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const payload = (await gcpFetch(
    fetchImpl,
    token,
    `${CLOUD_BILLING_BASE}/projects/${encodeURIComponent(trimmedRef)}/billingInfo`,
  )) as Partial<GcpProjectBillingInfo> | null;
  return {
    projectId: typeof payload?.projectId === "string" ? payload.projectId : trimmedRef,
    billingAccountName:
      typeof payload?.billingAccountName === "string" ? payload.billingAccountName : "",
    billingEnabled: payload?.billingEnabled === true,
  };
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
