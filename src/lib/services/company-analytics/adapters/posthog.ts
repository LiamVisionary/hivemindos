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
// Verified against current PostHog docs + a live probe (2026-07-05, project 342777):
//   POST {host}/api/projects/{id}/query/ — Bearer personal API key, scope `query:read`.
//   Body { query: { kind: "HogQLQuery", query } } runs synchronously ("blocking" is
//   the default; no async polling). Response is { results: any[][], columns, types }
//   where `results` is an array of row-arrays. `person_id` is the standard HogQL
//   unique-users column; `properties.$session_id` / `$pathname` / `$referring_domain`
//   are the standard autocapture props. (Both /api/projects/{id}/ and
//   /api/environments/{id}/ work; we use projects for older self-hosted instances.)
async function runHogQL(
  host: string,
  projectId: string,
  credential: string,
  query: string,
): Promise<unknown[][]> {
  const json = await fetchJsonWithTimeout(
    `${host}/api/projects/${encodeURIComponent(projectId)}/query/`,
    {
      method: "POST",
      headers: posthogHeaders(credential),
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    },
    9000,
  );
  return (json as { results?: unknown[][] }).results ?? [];
}

/** $pathname can be null on non-navigation pageviews; keep the row but label it. */
function pageLabel(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s === "" ? "(no path)" : s;
}

// Collapse a provider's link-shortener / alias domains to the brand everyone knows
// (t.co is X's wrapper; no one recognizes it). Keyed lowercase.
const SOURCE_ALIASES: Record<string, string> = {
  "t.co": "x.com",
  "twitter.com": "x.com",
  "www.twitter.com": "x.com",
  "lnkd.in": "linkedin.com",
  "com.reddit.frontpage": "reddit.com",
  "l.instagram.com": "instagram.com",
  "l.facebook.com": "facebook.com",
  "www.facebook.com": "facebook.com",
  "lm.facebook.com": "facebook.com",
};

/** $referring_domain is "$direct" for direct traffic, null when unknown. */
function sourceLabel(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s === "$direct") return "direct";
  if (s === "") return "(unknown)";
  return SOURCE_ALIASES[s.toLowerCase()] ?? s;
}

function rankList(rows: unknown[][], label: (v: unknown) => string) {
  return rows
    .map((r) => ({ name: label(r[0]), count: Number(r[1]) || 0 }))
    .filter((e) => e.count > 0);
}
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
    const days = Math.max(1, Math.min(365, Math.round(rangeDays)));
    const since = `now() - INTERVAL ${days} DAY`;
    const run = (q: string) => runHogQL(host, projectId, ctx.credential, q);

    // Unique visitors is the required signal — if this throws (bad key / project /
    // region) the whole summary fails and the panel shows the error state. Everything
    // else is a best-effort enrichment: a sub-query that fails degrades to empty so
    // one missing property never blanks the panel.
    const totals = await run(`SELECT count(DISTINCT person_id) AS visitors FROM events WHERE timestamp > ${since}`);
    const visitors = Number((totals[0] ?? [])[0]) || 0;

    const [pv, topEv, series, pages, sources] = await Promise.all([
      run(`SELECT count() AS pv, count(DISTINCT properties.$session_id) AS sessions FROM events WHERE event = '$pageview' AND timestamp > ${since}`).catch(() => [] as unknown[][]),
      run(`SELECT event, count() AS c FROM events WHERE timestamp > ${since} GROUP BY event ORDER BY c DESC LIMIT 8`).catch(() => [] as unknown[][]),
      run(`SELECT toDate(timestamp) AS d, count(DISTINCT person_id) AS v FROM events WHERE timestamp > ${since} GROUP BY d ORDER BY d`).catch(() => [] as unknown[][]),
      run(`SELECT properties.$pathname AS path, count() AS c FROM events WHERE event = '$pageview' AND timestamp > ${since} GROUP BY path ORDER BY c DESC LIMIT 6`).catch(() => [] as unknown[][]),
      run(`SELECT properties.$referring_domain AS ref, count() AS c FROM events WHERE event = '$pageview' AND timestamp > ${since} GROUP BY ref ORDER BY c DESC LIMIT 6`).catch(() => [] as unknown[][]),
    ]);

    const summary: AnalyticsSummary = { rangeDays: days, visitors };

    const pvRow = pv[0] ?? [];
    const pageviews = Number(pvRow[0]) || 0;
    const sessions = Number(pvRow[1]) || 0;
    if (pageviews) summary.pageviews = pageviews;
    if (sessions) summary.sessions = sessions;

    const topEvents = rankList(topEv, (v) => String(v ?? "—"));
    if (topEvents.length) summary.topEvents = topEvents;

    const timeseries = series
      .map((r) => ({ date: String(r[0] ?? ""), visitors: Number(r[1]) || 0 }))
      .filter((p) => p.date);
    if (timeseries.length > 1) summary.timeseries = timeseries;

    const topPages = rankList(pages, pageLabel);
    if (topPages.length) summary.topPages = topPages;

    const topSources = rankList(sources, sourceLabel);
    if (topSources.length) summary.topSources = topSources;

    return summary;
  },
};
