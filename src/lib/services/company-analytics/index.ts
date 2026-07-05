import "server-only";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import type { Company } from "@/lib/types/company";

import { ANALYTICS_ADAPTERS, analyticsAdapter } from "./registry-meta";
import type {
  AnalyticsProviderStatus,
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

/** The service the route calls. Returns one of four honest states. */
export async function readCompanyAnalyticsSummary(
  company: Company,
  opts: { rangeDays: number },
): Promise<AnalyticsSummaryResult> {
  const provider = company.analyticsProvider;
  if (!provider) {
    return { ok: true, state: "unconfigured", providers: await readAnalyticsProviders() };
  }
  const adapter = analyticsAdapter(provider);
  if (!adapter) {
    return { ok: true, state: "unconfigured", providers: await readAnalyticsProviders() };
  }

  let credential = "";
  if (adapter.requiresCredential) {
    credential = await hiveEnvValue(adapter.credentialEnvKey);
    if (!credential) {
      return {
        ok: true,
        state: "credential-missing",
        provider: adapter.key,
        providerLabel: adapter.label,
        credentialEnvKey: adapter.credentialEnvKey,
        detail: adapter.detail,
      };
    }
  }

  try {
    const summary = await adapter.getSummary(
      {
        config: company.analyticsConfig ?? {},
        credential,
        companyId: company.id,
        snapshot: snapshotFromCompany(company),
      },
      opts,
    );
    return { ok: true, state: "live", provider: adapter.key, providerLabel: adapter.label, summary };
  } catch (err) {
    return {
      ok: false,
      state: "error",
      provider: adapter.key,
      providerLabel: adapter.label,
      error: err instanceof Error ? err.message : "Failed to load analytics.",
    };
  }
}
