import type { AnalyticsAdapter, AnalyticsSummary } from "../types";
import { fetchJsonWithTimeout } from "../types";

// PostHog read adapter via HogQL.
// Verified against current PostHog docs + a live probe (2026-07-04):
//   POST {host}/api/projects/{id}/query/ — Bearer personal API key, scope `query:read`.
//   Body { query: { kind: "HogQLQuery", query } } runs synchronously ("blocking" is
//   the default; no async polling). Response is { results: any[][], columns, types }
//   where `results` is an array of row-arrays, so results[0] = [events, visitors] for
//   the SELECT below. `person_id` is the standard HogQL unique-users column on the
//   events table. (Both /api/projects/{id}/ and /api/environments/{id}/ work; we use
//   projects for compatibility with older self-hosted instances.)
export const posthogAdapter: AnalyticsAdapter = {
  key: "posthog",
  label: "PostHog",
  detail: "Product analytics via HogQL query. Needs a personal API key with query scope.",
  credentialEnvKey: "POSTHOG_PERSONAL_API_KEY",
  credentialHint: "PostHog → Settings → Personal API keys (scopes: query:read, plus user:read to verify).",
  credentialPlaceholder: "phx_...",
  configFieldLabel: "PostHog project ID",
  configFieldHint: "PostHog → Project settings → Project ID (a number).",
  configFieldPlaceholder: "12345",
  requiresCredential: true,
  async getSummary(ctx, { rangeDays }) {
    const projectId = (ctx.config.projectId || "").trim();
    if (!projectId) throw new Error("PostHog project ID is not set for this company.");
    const host = (ctx.config.host || "https://us.posthog.com").replace(/\/+$/, "");
    const days = Math.max(1, Math.round(rangeDays));
    const query = `SELECT count() AS events, count(DISTINCT person_id) AS visitors FROM events WHERE timestamp > now() - INTERVAL ${days} DAY`;

    const json = await fetchJsonWithTimeout(
      `${host}/api/projects/${encodeURIComponent(projectId)}/query/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.credential}`,
          "Content-Type": "application/json",
          "User-Agent": "hivemindos-analytics",
        },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      },
    );

    const results = (json as { results?: unknown[][] }).results ?? [];
    const row = results[0] ?? [];
    const events = Number(row[0]) || 0;
    const visitors = Number(row[1]) || 0;

    const summary: AnalyticsSummary = { rangeDays, visitors };
    if (events) summary.topEvents = [{ name: "events", count: events }];
    return summary;
  },
};
