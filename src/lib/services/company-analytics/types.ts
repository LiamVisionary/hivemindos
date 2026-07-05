// Generic per-company analytics abstraction. Self-contained (no import from
// company.ts) so `Company` can import AnalyticsProviderKey/CompanyAnalyticsConfig
// from here without a type cycle. The registry passes the company's funnel
// snapshot in via `AnalyticsAdapterContext.snapshot` rather than the full record.

export type AnalyticsProviderKey = "posthog" | "plausible" | "ga4" | "hivemind-funnel";

/** Per-company link, persisted on the Company record. Credentials are NOT here. */
export type CompanyAnalyticsConfig = {
  /**
   * PostHog: project id. Plausible: site domain (host). GA4: property id.
   * hivemind-funnel: unused (reads this company's own metric fields).
   */
  projectId?: string;
  /** Optional self-hosted base URL (Plausible/PostHog self-host). Empty = provider default. */
  host?: string;
};

export type AnalyticsFunnelStep = { name: string; count: number; conversionPct?: number };
export type AnalyticsPoint = { date: string; visitors: number; conversions?: number };
export type AnalyticsEvent = { name: string; count: number };

/** Normalized at-a-glance summary. All fields optional so a provider that only
 *  knows some of them still renders honestly. */
export type AnalyticsSummary = {
  rangeDays: number;
  visitors?: number;
  conversions?: number;
  conversionRatePct?: number;
  revenueUsd?: number;
  revenueDisplay?: string;
  topEvents?: AnalyticsEvent[];
  funnel?: AnalyticsFunnelStep[];
  timeseries?: AnalyticsPoint[];
};

/** The subset of a Company's own metric fields the hivemind-funnel adapter reads. */
export type CompanyAnalyticsSnapshot = {
  revenueValue?: string;
  revenueDelta?: string;
  apexCurrent?: string;
  apexTarget?: string;
  apexProgress?: number;
};

export type AnalyticsAdapterContext = {
  config: CompanyAnalyticsConfig;
  /** Resolved from shared hive env by the registry ("" when missing). */
  credential: string;
  companyId: string;
  /** Populated by the registry from the Company record (hivemind-funnel uses it). */
  snapshot?: CompanyAnalyticsSnapshot;
};

export type AnalyticsAdapter = {
  key: AnalyticsProviderKey;
  label: string;
  /** one-line "what this connects" copy for the picker */
  detail: string;
  /** shared-env var name holding this provider's credential ("" for hivemind-funnel) */
  credentialEnvKey: string;
  credentialHint: string;
  credentialPlaceholder: string;
  /** per-company config field the setup flow asks for */
  configFieldLabel: string;
  configFieldHint: string;
  configFieldPlaceholder: string;
  requiresCredential: boolean;
  /** Read-only summary fetch. MUST throw a human-readable Error on failure. */
  getSummary(ctx: AnalyticsAdapterContext, opts: { rangeDays: number }): Promise<AnalyticsSummary>;
};

/** Reported to the guided-setup picker: credential present-by-name (not live-verified). */
export type AnalyticsProviderStatus = {
  key: AnalyticsProviderKey;
  label: string;
  detail: string;
  requiresCredential: boolean;
  credentialPresent: boolean;
  credentialHint: string;
  credentialPlaceholder: string;
  configFieldLabel: string;
  configFieldHint: string;
  configFieldPlaceholder: string;
};

/** Four honest states, parallel to the Emails tab. */
export type AnalyticsSummaryResult =
  | { ok: true; state: "live"; provider: AnalyticsProviderKey; providerLabel: string; summary: AnalyticsSummary }
  | { ok: true; state: "unconfigured"; providers: AnalyticsProviderStatus[] }
  | {
      ok: true;
      state: "credential-missing";
      provider: AnalyticsProviderKey;
      providerLabel: string;
      credentialEnvKey: string;
      detail: string;
    }
  | { ok: false; state: "error"; provider?: AnalyticsProviderKey; providerLabel?: string; error: string };

/** Parse a display metric like "$1,240" or "3,410" into a number, or undefined. */
export function parseMetricNumber(value?: string | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Bounded JSON fetch used by the network adapters. Throws a human-readable Error. */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 6000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const providerMsg =
        (json as { detail?: string; error?: string; message?: string })?.detail ||
        (json as { error?: string })?.error ||
        (json as { message?: string })?.message ||
        text.slice(0, 200);
      throw new Error(`HTTP ${res.status}${providerMsg ? ` — ${providerMsg}` : ""}`);
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
