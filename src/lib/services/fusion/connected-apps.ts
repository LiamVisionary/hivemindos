import "server-only";

import type { ContextConnectedApp } from "@/lib/services/context-index";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

export async function connectedAppsForFusion(requestUrl: string) {
  const url = new URL("/api/fleet/apps", requestUrl);
  const response = await fetch(url, {
    cache: "no-store",
    headers: internalApiAuthHeaders(),
    signal: AbortSignal.timeout(7_000),
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => null) as { apps?: ContextConnectedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : undefined;
}
