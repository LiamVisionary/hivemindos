import type { AnalyticsAdapter, AnalyticsSummary } from "../types";
import { parseMetricNumber } from "../types";

// Reads the company's OWN metric fields (revenue / apex goal), which an agent or
// the portfolio offer funnel keeps current via the `update-metric` rail. No
// external credential — the "batteries-included" provider every company can use.
export const hivemindFunnelAdapter: AnalyticsAdapter = {
  key: "hivemind-funnel",
  label: "HivemindOS funnel",
  detail:
    "Reads this company's own revenue and apex-goal numbers — populated by an agent or funnel via update-metric. No external account needed.",
  credentialEnvKey: "",
  credentialHint: "",
  credentialPlaceholder: "",
  configFieldLabel: "Funnel company id (optional)",
  configFieldHint: "Defaults to this company. A funnel POSTs paid/booking events here via update-metric.",
  configFieldPlaceholder: "",
  requiresCredential: false,
  async getSummary(ctx, { rangeDays }) {
    const snap = ctx.snapshot ?? {};
    const revenueUsd = parseMetricNumber(snap.revenueValue);
    const conversions = parseMetricNumber(snap.apexCurrent);
    const target = parseMetricNumber(snap.apexTarget);

    let conversionRatePct = typeof snap.apexProgress === "number" ? snap.apexProgress : undefined;
    if (conversionRatePct === undefined && conversions !== undefined && target && target > 0) {
      conversionRatePct = Math.round((conversions / target) * 100);
    }

    const summary: AnalyticsSummary = { rangeDays };
    if (revenueUsd !== undefined) summary.revenueUsd = revenueUsd;
    if (snap.revenueValue) summary.revenueDisplay = snap.revenueValue;
    if (conversions !== undefined) summary.conversions = conversions;
    if (conversionRatePct !== undefined) summary.conversionRatePct = conversionRatePct;
    return summary;
  },
};
