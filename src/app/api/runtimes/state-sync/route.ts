import { localCollectorPort, normalizeCollectorUrl } from "@/lib/services/local-collector-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StateSyncBody = {
  // Target collector. Omit to configure THIS machine's local collector.
  collectorUrl?: string;
  enabled?: boolean;
  runtimes?: string[];
};

// Enable/disable the runtime-state sync loop on a collector (local or a ready,
// same-owner peer). The collector gates this with requireLinkOwner: loopback for
// the local case, and the linkd-stamped owner identity for peers.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as StateSyncBody;
  const targetRaw = body.collectorUrl?.trim() || `http://127.0.0.1:${await localCollectorPort()}`;
  const base = normalizeCollectorUrl(targetRaw);
  try {
    const res = await fetch(`${base}/runtimes/state-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: body.enabled === true,
        runtimes: Array.isArray(body.runtimes) ? body.runtimes : [],
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || data?.ok === false) {
      return Response.json(
        { ok: false, error: typeof data?.error === "string" ? data.error : `Collector returned HTTP ${res.status}.`, target: base },
        { status: 502 },
      );
    }
    return Response.json(data ?? { ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not configure runtime sync.", target: base },
      { status: 502 },
    );
  }
}
