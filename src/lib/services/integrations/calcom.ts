import "server-only";

import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

export type CalcomReadAction = "me" | "event-types" | "bookings";

export async function readCalcom(action: CalcomReadAction, limit = 25) {
  const sharedEnv = await readSharedAgentEnv();
  const token = sharedEnvValue("CALCOM_API_KEY", sharedEnv);
  const baseUrl = (sharedEnvValue("CALCOM_API_BASE_URL", sharedEnv) || "https://api.cal.com/v2").replace(/\/+$/, "");
  if (!token) throw new Error("Connect Cal.com in HivemindOS before reading scheduling data.");
  const endpoint = action === "me" ? "/me" : action === "event-types" ? "/event-types" : "/bookings";
  const url = new URL(`${baseUrl}${endpoint}`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "hivemindos-calcom",
  };
  if (action === "event-types") headers["cal-api-version"] = "2024-06-14";
  if (action === "bookings") headers["cal-api-version"] = "2026-05-01";
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string; data?: unknown } | null;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Cal.com API request failed (HTTP ${response.status}).`);
  if (payload && action !== "me" && "data" in payload && Array.isArray(payload.data)) {
    return { ...payload, data: payload.data.slice(0, Math.max(1, Math.min(100, Math.floor(limit)))) };
  }
  return payload;
}
