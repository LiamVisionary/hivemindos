import type { AnalyticsAdapter } from "../types";

// GA4 is registered so the picker is complete, but it ships as an explicit
// not-wired stub rather than a silent partial — connecting the GA4 Data API +
// OAuth is a follow-up. getSummary throws an honest message.
export const ga4Adapter: AnalyticsAdapter = {
  key: "ga4",
  label: "Google Analytics 4",
  detail: "Not wired yet — needs the GA4 Data API + OAuth. Use PostHog, Plausible, or the HivemindOS funnel for now.",
  credentialEnvKey: "GA4_SERVICE_ACCOUNT_JSON",
  credentialHint: "GA4 Data API service-account JSON (not yet wired).",
  credentialPlaceholder: "",
  configFieldLabel: "GA4 property ID",
  configFieldHint: "GA4 → Admin → Property → Property ID.",
  configFieldPlaceholder: "properties/123456789",
  requiresCredential: true,
  async getSummary() {
    throw new Error("GA4 analytics isn't wired yet — connect PostHog, Plausible, or the HivemindOS funnel.");
  },
};
