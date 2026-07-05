import type { AnalyticsAdapter, AnalyticsSummary } from "../types";
import { fetchJsonWithTimeout } from "../types";

// Plausible read adapter via the Stats API v1 aggregate endpoint.
// Verified against the Plausible Stats API v1 docs + a live probe (2026-07-04):
//   GET {host}/api/v1/stats/aggregate?site_id=&period=&metrics=visitors,events
//   Bearer API key. `visitors` and `events` are both valid metrics. Response is
//   { results: { visitors: { value }, events: { value } } }. `date` defaults to
//   today when omitted. (v1 is legacy — Plausible now points new work at v2
//   POST /api/v2/query — but v1 aggregate remains supported and is the lighter call.)
// CONSTRAINT: `period` accepts only fixed presets (12mo|6mo|month|30d|7d|day|custom),
//   NOT an arbitrary `${n}d`, so the requested window is snapped to the nearest preset.
const PLAUSIBLE_PERIODS: { period: string; days: number }[] = [
  { period: "day", days: 1 },
  { period: "7d", days: 7 },
  { period: "30d", days: 30 },
  { period: "6mo", days: 183 },
  { period: "12mo", days: 365 },
];

/** Snap an arbitrary day-count to Plausible's nearest supported preset, and report
 *  back that preset's real span so the summary's rangeDays stays truthful. */
function plausiblePeriod(rangeDays: number): { period: string; days: number } {
  const want = Math.max(1, Math.round(rangeDays));
  return PLAUSIBLE_PERIODS.reduce((best, cur) =>
    Math.abs(cur.days - want) < Math.abs(best.days - want) ? cur : best,
  );
}

export const plausibleAdapter: AnalyticsAdapter = {
  key: "plausible",
  label: "Plausible",
  detail: "Privacy-friendly web analytics via the Plausible Stats API.",
  credentialEnvKey: "PLAUSIBLE_API_KEY",
  credentialHint: "Plausible → Settings → API keys.",
  credentialPlaceholder: "xxxxxxxx",
  configFieldLabel: "Plausible site domain",
  configFieldHint: "The site as registered in Plausible, e.g. example.com.",
  configFieldPlaceholder: "example.com",
  requiresCredential: true,
  connectVia: "key",
  // List the sites this key can see so setup offers a picker. NOTE: Plausible's Sites
  // API is an Enterprise-plan feature and a site object carries only `domain` (no
  // display name), so the domain is both the id and the label. On a non-Enterprise key
  // this throws (plan-gated) and the UI falls back to manual domain entry.
  async listResources(credential) {
    try {
      const json = await fetchJsonWithTimeout("https://plausible.io/api/v1/sites?limit=100", {
        method: "GET",
        headers: { Authorization: `Bearer ${credential}`, "User-Agent": "hivemindos-analytics" },
      });
      const sites = ((json as { sites?: { domain?: string }[] }).sites ?? []).filter((s) => s && s.domain);
      if (!sites.length) {
        throw new Error("No sites returned. The Sites API needs an Enterprise plan — enter the site domain manually.");
      }
      return { resources: sites.map((s) => ({ id: s.domain as string, name: s.domain as string })) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Couldn't list Plausible sites (${message}). The Sites API is Enterprise-only — enter the site domain manually instead.`,
      );
    }
  },
  async getSummary(ctx, { rangeDays }) {
    const siteId = (ctx.config.projectId || "").trim();
    if (!siteId) throw new Error("Plausible site domain is not set for this company.");
    const host = (ctx.config.host || "https://plausible.io").replace(/\/+$/, "");
    const { period, days } = plausiblePeriod(rangeDays);
    const url = `${host}/api/v1/stats/aggregate?site_id=${encodeURIComponent(siteId)}&period=${period}&metrics=visitors,events`;

    const json = await fetchJsonWithTimeout(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${ctx.credential}`, "User-Agent": "hivemindos-analytics" },
    });

    const results =
      (json as { results?: { visitors?: { value?: number }; events?: { value?: number } } }).results ?? {};
    const visitors = Number(results.visitors?.value) || 0;
    const events = Number(results.events?.value) || 0;

    const summary: AnalyticsSummary = { rangeDays: days, visitors };
    if (events) summary.topEvents = [{ name: "events", count: events }];
    return summary;
  },
};
