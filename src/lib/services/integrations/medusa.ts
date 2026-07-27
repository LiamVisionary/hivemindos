import "server-only";

import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

export type MedusaReadAction = "products" | "regions";

export async function readMedusa(action: MedusaReadAction, limit = 25) {
  const sharedEnv = await readSharedAgentEnv();
  const token = sharedEnvValue("MEDUSA_PUBLISHABLE_API_KEY", sharedEnv);
  const baseUrl = (sharedEnvValue("MEDUSA_API_BASE_URL", sharedEnv) || "http://127.0.0.1:9000").replace(/\/+$/, "");
  if (!token) throw new Error("Connect Medusa in HivemindOS before reading store data.");
  const url = new URL(`${baseUrl}/store/${action}`);
  url.searchParams.set("limit", String(Math.max(1, Math.min(100, Math.floor(limit)))));
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "x-publishable-api-key": token,
      "User-Agent": "hivemindos-medusa",
    },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || `Medusa Store API request failed (HTTP ${response.status}).`);
  return payload;
}
