import "server-only";

import { mintGoogleAccessToken } from "@/lib/services/integrations/google-oauth";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import type { Company } from "@/lib/types/company";

import { ANALYTICS_ADAPTERS, analyticsAdapter } from "./registry-meta";
import type {
  AnalyticsAdapter,
  AnalyticsProviderStatus,
  AnalyticsResource,
  AnalyticsSummaryResult,
  CompanyAnalyticsSnapshot,
} from "./types";

// Re-export the client-safe list so server callers have one import site.
export { ANALYTICS_ADAPTERS, analyticsAdapter };

/** For the guided-setup picker: each provider + whether its shared-env credential
 *  exists by name (NOT live-verified). */
export async function readAnalyticsProviders(): Promise<AnalyticsProviderStatus[]> {
  return Promise.all(
    ANALYTICS_ADAPTERS.map(async (a) => ({
      key: a.key,
      label: a.label,
      detail: a.detail,
      requiresCredential: a.requiresCredential,
      credentialPresent: a.requiresCredential ? Boolean(await hiveEnvValue(a.credentialEnvKey)) : true,
      credentialHint: a.credentialHint,
      credentialPlaceholder: a.credentialPlaceholder,
      configFieldLabel: a.configFieldLabel,
      configFieldHint: a.configFieldHint,
      configFieldPlaceholder: a.configFieldPlaceholder,
      connectVia: a.connectVia ?? "key",
      canEnumerate: typeof a.listResources === "function",
    })),
  );
}

function snapshotFromCompany(company: Company): CompanyAnalyticsSnapshot {
  return {
    revenueValue: company.revenue?.value,
    revenueDelta: company.revenue?.delta ?? undefined,
    apexCurrent: company.apexGoal?.current,
    apexTarget: company.apexGoal?.target,
    apexProgress: company.apexGoal?.progress,
  };
}

/**
 * Resolve the credential the adapter's network calls need. Key providers read the
 * shared-env value by name; the google-oauth provider (GA4) mints a fresh access
 * token from the shared Google refresh token. Distinguishes "not connected"
 * (`missing` — show a connect affordance) from "connected but the mint failed"
 * (`error` — show the failure).
 */
async function resolveAdapterCredential(
  adapter: AnalyticsAdapter,
): Promise<{ credential: string } | { missing: true } | { error: string }> {
  if (!adapter.requiresCredential) return { credential: "" };
  if (adapter.connectVia === "google-oauth") {
    const refresh = await hiveEnvValue(adapter.credentialEnvKey);
    if (!refresh) return { missing: true };
    try {
      const token = await mintGoogleAccessToken();
      return token ? { credential: token } : { missing: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not refresh the connected Google account." };
    }
  }
  const credential = await hiveEnvValue(adapter.credentialEnvKey);
  return credential ? { credential } : { missing: true };
}

/** The service the route calls. Returns one of four honest states; every state also
 *  carries the provider roster so the tab's cards render in any state. */
export async function readCompanyAnalyticsSummary(
  company: Company,
  opts: { rangeDays: number },
): Promise<AnalyticsSummaryResult> {
  const providers = await readAnalyticsProviders();
  const provider = company.analyticsProvider;
  if (!provider) return { ok: true, state: "unconfigured", providers };
  const adapter = analyticsAdapter(provider);
  if (!adapter) return { ok: true, state: "unconfigured", providers };

  const config = company.analyticsConfig ?? {};
  const resolved = await resolveAdapterCredential(adapter);
  if ("missing" in resolved) {
    return {
      ok: true,
      state: "credential-missing",
      provider: adapter.key,
      providerLabel: adapter.label,
      credentialEnvKey: adapter.credentialEnvKey,
      detail: adapter.detail,
      providers,
      config,
    };
  }
  if ("error" in resolved) {
    return { ok: false, state: "error", provider: adapter.key, providerLabel: adapter.label, error: resolved.error, providers, config };
  }

  try {
    const summary = await adapter.getSummary(
      { config, credential: resolved.credential, companyId: company.id, snapshot: snapshotFromCompany(company) },
      opts,
    );
    return { ok: true, state: "live", provider: adapter.key, providerLabel: adapter.label, summary, providers, config };
  } catch (err) {
    return {
      ok: false,
      state: "error",
      provider: adapter.key,
      providerLabel: adapter.label,
      error: err instanceof Error ? err.message : "Failed to load analytics.",
      providers,
      config,
    };
  }
}

/**
 * Discover the projects/sites/properties a connected provider can see, so the setup
 * card offers a picker instead of a free-text id. The credential never leaves the
 * server. Throws a human-readable Error (unknown provider / not connected / can't
 * enumerate) so the UI can fall back to manual entry.
 */
export async function listCompanyAnalyticsResources(
  providerKey: string,
): Promise<{ resources: AnalyticsResource[]; host?: string }> {
  const adapter = analyticsAdapter(providerKey);
  if (!adapter) throw new Error("Unknown analytics provider.");
  if (!adapter.listResources) {
    throw new Error(`${adapter.label} can't list projects automatically — enter the id manually.`);
  }
  const resolved = await resolveAdapterCredential(adapter);
  if ("missing" in resolved) throw new Error(`Connect ${adapter.label} first, then pick a project.`);
  if ("error" in resolved) throw new Error(resolved.error);
  return adapter.listResources(resolved.credential);
}
