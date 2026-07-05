import type { AnalyticsAdapter, AnalyticsResource, AnalyticsSummary } from "../types";
import { fetchJsonWithTimeout } from "../types";

const POSTHOG_HOSTS = ["https://us.posthog.com", "https://eu.posthog.com"];

function posthogHeaders(credential: string) {
  return {
    Authorization: `Bearer ${credential}`,
    "Content-Type": "application/json",
    "User-Agent": "hivemindos-analytics",
  };
}

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
  connectVia: "key",
  // Discover the key's projects so the setup UI shows a picker instead of asking for
  // a numeric id. PostHog cloud is region-split (US vs EU) and the private endpoints
  // are region-specific, so we try US then EU and report back the host that answered
  // (persisted into the company's analyticsConfig.host so getSummary hits the right
  // region). /api/users/@me/ is the fully-confirmed id-free identity call; the current
  // org's numeric id from it drives the documented projects list.
  async listResources(credential) {
    let lastError = "PostHog rejected the key. Check the key and whether it's a US or EU cloud key.";
    for (const host of POSTHOG_HOSTS) {
      let me: { organization?: { id?: string }; team?: { id?: number; project_id?: number; name?: string } } | null;
      try {
        me = (await fetchJsonWithTimeout(`${host}/api/users/@me/`, {
          method: "GET",
          headers: posthogHeaders(credential),
        })) as typeof me;
      } catch (error) {
        // 401 here means wrong region or bad key — try the other cloud before giving up.
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      const orgId = me?.organization?.id;
      if (orgId) {
        try {
          const json = await fetchJsonWithTimeout(
            `${host}/api/organizations/${encodeURIComponent(orgId)}/projects/?limit=200`,
            { method: "GET", headers: posthogHeaders(credential) },
          );
          const results = ((json as { results?: { id: number; name?: string }[] }).results ?? []).filter(
            (p) => p && p.id !== undefined,
          );
          if (results.length) {
            const resources: AnalyticsResource[] = results.map((p) => ({
              id: String(p.id),
              name: p.name || `Project ${p.id}`,
            }));
            return { resources, host };
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      // Right region, but couldn't list the org's projects — fall back to the key's
      // current project so the user still gets a one-click pick.
      const team = me?.team;
      if (team && (team.project_id || team.id)) {
        return {
          resources: [{ id: String(team.project_id ?? team.id), name: team.name || "Current project" }],
          host,
        };
      }
      throw new Error(
        "Connected, but this key can't list projects. Give it the `project:read` scope in PostHog, or enter the project id manually.",
      );
    }
    throw new Error(lastError);
  },
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
