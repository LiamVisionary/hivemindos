import { NextRequest } from "next/server";
import { localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function collectorBase(url?: string | null) {
  return (url?.trim() || localTelemetryCollectorUrl()).replace(/\/+$/, "");
}

// Trigger a Syncthing rescan of the vault folder so a just-edited call prompt
// propagates to paired devices (the phone) immediately, instead of waiting for
// Syncthing's filesystem watcher. Proxies the agent-telemetry collector bridge,
// which already holds the Syncthing API key (same pattern as the status route).
export async function POST(request: NextRequest) {
  const base = collectorBase(request.nextUrl.searchParams.get("collectorUrl"));
  let vaultPath = "";
  try {
    vaultPath = resolveObsidianVaultPath(request.nextUrl.searchParams.get("vaultPath") ?? undefined);
  } catch {
    vaultPath = "";
  }
  try {
    const response = await fetch(`${base}/syncthing/rescan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(vaultPath ? { path: vaultPath } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null);
    return Response.json(payload ?? { ok: response.ok }, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not reach agent bridge for rescan.",
      },
      { status: 502 }
    );
  }
}
