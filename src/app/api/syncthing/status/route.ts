import { NextRequest } from "next/server";
import { localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNCTHING_STATUS_CACHE_MS = 30_000;

type SyncthingStatusPayload = Record<string, unknown> & {
  ok: boolean;
  error?: string;
};

const statusCache = new Map<string, { checkedAt: number; payload: SyncthingStatusPayload; status: number }>();
const statusInFlight = new Map<string, Promise<{ payload: SyncthingStatusPayload; status: number }>>();

function collectorBase(url?: string | null) {
  return (url?.trim() || localTelemetryCollectorUrl()).replace(/\/+$/, "");
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 502, body: null };
  }
}

async function readSyncthingStatus(base: string, vaultPath: string): Promise<{ payload: SyncthingStatusPayload; status: number }> {
  const [status, folderStatus] = await Promise.all([
    getJson(`${base}/syncthing/status`),
    vaultPath
      ? getJson(`${base}/syncthing/folder-status?path=${encodeURIComponent(vaultPath)}`)
      : Promise.resolve({ ok: false, status: 0, body: null }),
  ]);

  if (!status.ok && !folderStatus.ok) {
    return {
      payload: { ok: false, error: "Could not reach agent bridge Syncthing status." },
      status: 502,
    };
  }

  // Laggiest paired-peer completion for the vault folder = the out-of-sync
  // signal. Fall back to the folder's local aggregate when no peers report.
  const folder = Array.isArray(folderStatus.body?.folders) ? folderStatus.body.folders[0] : undefined;
  const peerCompletions: number[] = (Array.isArray(folder?.devices) ? folder.devices : [])
    .map((d: any) => d?.completion)
    .filter((n: any): n is number => typeof n === "number");
  const completion =
    peerCompletions.length > 0
      ? Math.min(...peerCompletions)
      : typeof folder?.completion === "number"
        ? folder.completion
        : undefined;

  const basePayload = status.body && typeof status.body === "object" ? status.body : {};
  return {
    payload: {
      ...basePayload,
      ok: true,
      ...(typeof completion === "number" ? { completion } : {}),
      ...(folder
        ? {
            vaultFolder: folder,
            folderState: folder.paused ? "paused" : completion === 100 ? "idle" : "syncing",
          }
        : {}),
    },
    status: 200,
  };
}

// Syncthing status for the vault, fronted for both the dashboard's Phone panel
// and the mobile app's "Sync with phone" section. Combines device-connection
// status with the vault FOLDER's sync completion so callers can tell not just
// "is a peer online" but "is the vault actually in sync with the phone". The
// reported `completion` is the laggiest paired peer (i.e. the phone if it's
// behind), so `completion < 100` means out of sync. Proxies the collector
// bridge (which holds the Syncthing API key); never throws.
export async function GET(request: NextRequest) {
  const base = collectorBase(request.nextUrl.searchParams.get("collectorUrl"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  let vaultPath = "";
  try {
    vaultPath = resolveObsidianVaultPath(request.nextUrl.searchParams.get("vaultPath") ?? undefined);
  } catch {
    vaultPath = "";
  }

  const cacheKey = `${base}|${vaultPath}`;
  const cached = statusCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.checkedAt < SYNCTHING_STATUS_CACHE_MS) {
    return Response.json(cached.payload, { status: cached.status });
  }

  let inFlight = statusInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = readSyncthingStatus(base, vaultPath)
      .then((result) => {
        if (result.payload.ok) {
          statusCache.set(cacheKey, { checkedAt: Date.now(), ...result });
        }
        return result;
      })
      .finally(() => {
        statusInFlight.delete(cacheKey);
      });
    statusInFlight.set(cacheKey, inFlight);
  }

  const result = await inFlight;
  return Response.json(result.payload, { status: result.status });
}
