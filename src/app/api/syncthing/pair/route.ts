import { localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type PairBody = {
  localCollectorUrl?: string;
  remoteCollectorUrl?: string;
  localPath?: string;
  remotePath?: string;
  folderId?: string;
  label?: string;
  remoteName?: string;
  localTailscaleIp?: string;
  remoteTailscaleIp?: string;
  remoteAddressHost?: string;
};

type SyncthingStatus = {
  deviceID?: string;
  host?: string;
  defaultSyncPath?: string;
};

type CollectorRequestInit = RequestInit & {
  timeoutMs?: number;
};

function collectorBase(value?: string | null) {
  return (value?.trim() || localTelemetryCollectorUrl()).replace(/\/+$/, "");
}

async function collectorJson(base: string, path: string, init?: CollectorRequestInit) {
  const { timeoutMs = 20_000, ...requestInit } = init ?? {};
  const response = await fetch(`${base}${path}`, {
    ...requestInit,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...(requestInit.body ? { "content-type": "application/json" } : {}),
      ...(requestInit.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `${base}${path} returned HTTP ${response.status}`);
  }
  return payload;
}

async function collectorRepair(base: string, body: Record<string, unknown>) {
  try {
    return await collectorJson(base, "/syncthing/repair", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 45_000,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Syncthing repair failed.",
    };
  }
}

function staticAddress(host?: string) {
  const value = host?.trim();
  return value ? [`tcp://${value}:22000`, "dynamic"] : ["dynamic"];
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as PairBody;
    const localBase = collectorBase(body.localCollectorUrl);
    const remoteBase = collectorBase(body.remoteCollectorUrl);
    if (!body.remoteCollectorUrl?.trim()) throw new Error("Remote agent bridge URL is required.");

    const [localStatus, remoteStatus] = await Promise.all([
      collectorJson(localBase, "/syncthing/status"),
      collectorJson(remoteBase, "/syncthing/status"),
    ]) as [SyncthingStatus, SyncthingStatus];
    if (!localStatus.deviceID || !remoteStatus.deviceID) {
      throw new Error("Both agent bridges must report Syncthing device IDs.");
    }
    const localPath = body.localPath?.trim() || localStatus.defaultSyncPath?.trim();
    const remotePath = body.remotePath?.trim() || remoteStatus.defaultSyncPath?.trim();
    if (!localPath) throw new Error("localPath is required because the local agent bridge did not report a default sync path.");
    if (!remotePath) throw new Error("remotePath is required because the remote agent bridge did not report a default sync path.");

    const folderId = body.folderId?.trim() || "hivemindos-vault";
    const label = body.label?.trim() || "hivemindos-vault";
    const remoteAddresses = staticAddress(body.remoteTailscaleIp || body.remoteAddressHost);
    const localAddresses = staticAddress(body.localTailscaleIp);
    const [localConfig, remoteConfig] = await Promise.all([
      collectorJson(localBase, "/syncthing/configure", {
        method: "POST",
        body: JSON.stringify({
          folderId,
          label,
          path: localPath,
          peerDeviceID: remoteStatus.deviceID,
          peerName: body.remoteName || remoteStatus.host,
          peerAddresses: remoteAddresses,
        }),
      }),
      collectorJson(remoteBase, "/syncthing/configure", {
        method: "POST",
        body: JSON.stringify({
          folderId,
          label,
          path: remotePath,
          peerDeviceID: localStatus.deviceID,
          peerName: localStatus.host,
          peerAddresses: localAddresses,
        }),
      }),
    ]);
    const [localRepair, remoteRepair] = await Promise.all([
      collectorRepair(localBase, {
        folderId,
        path: localPath,
        peerDeviceID: remoteStatus.deviceID,
        peerName: body.remoteName || remoteStatus.host,
        peerAddresses: remoteAddresses,
      }),
      collectorRepair(remoteBase, {
        folderId,
        path: remotePath,
        peerDeviceID: localStatus.deviceID,
        peerName: localStatus.host,
        peerAddresses: localAddresses,
      }),
    ]);
    const repairOk = localRepair?.ok !== false && remoteRepair?.ok !== false;

    return Response.json({
      ok: true,
      folderId,
      label,
      local: localConfig,
      remote: remoteConfig,
      repair: {
        ok: repairOk,
        local: localRepair,
        remote: remoteRepair,
      },
      ...(!repairOk ? { warning: "Syncthing was paired, but one side reported a repair warning. Refresh sync status and run Fix again if the warning remains." } : {}),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not pair Syncthing folders.",
    }, { status: 400 });
  }
}
