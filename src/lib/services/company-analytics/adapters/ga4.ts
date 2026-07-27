import type { AnalyticsAdapter, AnalyticsResource, AnalyticsSummary } from "../types";
import { fetchJsonWithTimeout } from "../types";

// Google Analytics 4 via the shared Google OAuth account (not a pasted key — GA4
// accounts/properties are per-user resources that only OAuth can enumerate).
//   listResources -> Admin API accountSummaries.list (every account + its properties)
//   getSummary    -> Data API properties/{id}:runReport (totalUsers + eventCount)
// The `credential` handed in is a fresh Google access token minted server-side from
// the shared refresh token (see company-analytics/index.ts). `credentialEnvKey`
// points at the refresh-token env var so the card's "connected" dot reflects whether
// a Google account is linked. Requires the analytics.readonly scope — connections
// made before that scope was added must reconnect Google once.
function ga4Headers(accessToken: string, json = false) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "hivemindos-analytics",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export const ga4Adapter: AnalyticsAdapter = {
  key: "ga4",
  label: "Google Analytics 4",
  detail: "Web + app analytics via the GA4 Data API. Connects with your Google account (OAuth) — no key to paste.",
  credentialEnvKey: "GOOGLE_OAUTH_REFRESH_TOKEN",
  credentialHint: "Connect your Google account (with Analytics access) from this card or Settings → Connections.",
  credentialPlaceholder: "",
  configFieldLabel: "GA4 property",
  configFieldHint: "Pick a property, or paste a numeric property id (GA4 → Admin → Property → Property ID).",
  configFieldPlaceholder: "123456789",
  requiresCredential: true,
  connectVia: "google-oauth",
  async listResources(accessToken) {
    const json = await fetchJsonWithTimeout(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
      { method: "GET", headers: ga4Headers(accessToken) },
    );
    const accounts = ((json as {
      accountSummaries?: {
        displayName?: string;
        propertySummaries?: { property?: string; displayName?: string }[];
      }[];
    }).accountSummaries) ?? [];

    const resources: AnalyticsResource[] = [];
    for (const account of accounts) {
      for (const property of account.propertySummaries ?? []) {
        const id = (property.property ?? "").replace(/^properties\//, "").trim();
        if (!id) continue;
        const label = property.displayName || id;
        resources.push({
          id,
          name: account.displayName ? `${account.displayName} › ${label}` : label,
          hint: `properties/${id}`,
        });
      }
    }
    if (!resources.length) {
      throw new Error(
        "No GA4 properties found. Make sure this Google account can see a GA4 property, or reconnect Google to grant Analytics access.",
      );
    }
    return { resources };
  },
  async getSummary(ctx, { rangeDays }) {
    const propertyId = (ctx.config.projectId || "").replace(/^properties\//, "").trim();
    if (!propertyId) throw new Error("GA4 property is not set for this company.");
    const days = Math.max(1, Math.round(rangeDays));

    const json = await fetchJsonWithTimeout(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: ga4Headers(ctx.credential, true),
        body: JSON.stringify({
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
          metrics: [{ name: "totalUsers" }, { name: "eventCount" }],
        }),
      },
    );

    const row = ((json as { rows?: { metricValues?: { value?: string }[] }[] }).rows ?? [])[0];
    const values = row?.metricValues ?? [];
    const visitors = Number(values[0]?.value) || 0;
    const events = Number(values[1]?.value) || 0;

    const summary: AnalyticsSummary = { rangeDays: days, visitors };
    if (events) summary.topEvents = [{ name: "events", count: events }];
    return summary;
  },
};
