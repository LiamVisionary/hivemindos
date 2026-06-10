import { NextRequest } from "next/server";
import { localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function collectorBase(url?: string | null) {
  return (url?.trim() || localTelemetryCollectorUrl()).replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const base = collectorBase(
    typeof body.collectorUrl === "string"
      ? body.collectorUrl
      : request.nextUrl.searchParams.get("collectorUrl")
  );
  let vaultPath = "";
  try {
    const rawVaultPath = typeof body.vaultPath === "string"
      ? body.vaultPath
      : request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    vaultPath = resolveObsidianVaultPath(rawVaultPath);
  } catch {
    vaultPath = "";
  }

  try {
    const response = await fetch(`${base}/syncthing/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        folderId: typeof body.folderId === "string" ? body.folderId : "hivemindos-vault",
        path: typeof body.path === "string" ? body.path : vaultPath || undefined,
        peerDeviceID: typeof body.peerDeviceID === "string" ? body.peerDeviceID : undefined,
        peerName: typeof body.peerName === "string" ? body.peerName : undefined,
        peerAddresses: Array.isArray(body.peerAddresses) ? body.peerAddresses : undefined,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null);
    return Response.json(payload ?? { ok: response.ok }, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not reach agent bridge for Syncthing repair.",
      },
      { status: 502 }
    );
  }
}
