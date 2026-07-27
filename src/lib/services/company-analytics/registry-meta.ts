// Client-safe adapter list (no server-only imports), so both the server registry
// (index.ts) and the client edit-modal picker can share one source of truth for
// provider keys, labels, and config-field metadata.

import { ga4Adapter } from "./adapters/ga4";
import { hivemindFunnelAdapter } from "./adapters/hivemind-funnel";
import { plausibleAdapter } from "./adapters/plausible";
import { posthogAdapter } from "./adapters/posthog";
import type { AnalyticsAdapter } from "./types";

export const ANALYTICS_ADAPTERS: AnalyticsAdapter[] = [
  hivemindFunnelAdapter,
  posthogAdapter,
  plausibleAdapter,
  ga4Adapter,
];

export function analyticsAdapter(key?: string): AnalyticsAdapter | undefined {
  return ANALYTICS_ADAPTERS.find((a) => a.key === key);
}
