import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";

/**
 * Best-effort fleet discovery for Queen Bee delegation. Returns an empty
 * snapshot instead of throwing so message submission can always proceed.
 */
export async function discoverQueenBeeFleetSnapshot(
  origin: string,
  deviceToken?: string | null,
): Promise<QueenBeeFleetMachine[]> {
  try {
    const url = new URL("/api/fleet/discover", origin);
    url.searchParams.set("includeSnapshots", "0");
    url.searchParams.set("fresh", "1");
    const response = await fetch(url, {
      cache: "no-store",
      headers: deviceToken ? { "x-hivemindos-device-token": deviceToken } : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null) as { machines?: QueenBeeFleetMachine[] } | null;
    return response.ok && Array.isArray(data?.machines) ? data.machines : [];
  } catch {
    return [];
  }
}
