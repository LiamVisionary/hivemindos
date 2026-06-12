import { readFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2";
const API_KEY_ENV_CANDIDATES = ["TAILSCALE_API_KEY", "TS_API_KEY"];

export const DEFAULT_STALE_DEVICE_AGE_DAYS = 7;

export type TailnetApiDevice = {
  id: string;
  nodeId?: string;
  name?: string;
  hostname?: string;
  os?: string;
  lastSeen?: string;
  created?: string;
  addresses?: string[];
  tags?: string[];
};

export type TailnetCleanupCandidate = {
  id: string;
  name: string;
  hostname: string;
  os?: string;
  lastSeen?: string;
  offlineForDays: number;
  reason: "hivemind-link-node" | "duplicate-hostname";
  scope: "hivemindos" | "duplicate";
};

export type TailnetCleanupPlan = {
  configured: boolean;
  staleAgeDays: number;
  totalDevices: number;
  candidates: TailnetCleanupCandidate[];
  error?: string;
};

function parseEnvFileValue(raw: string, key: string) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`, "m");
  const match = raw.match(pattern);
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export async function tailscaleApiKey() {
  for (const key of API_KEY_ENV_CANDIDATES) {
    const fromProcess = process.env[key]?.trim();
    if (fromProcess) return fromProcess;
  }
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  for (const key of API_KEY_ENV_CANDIDATES) {
    const fromFile = parseEnvFileValue(raw, key);
    if (fromFile) return fromFile;
  }
  return "";
}

const AUTO_CLEANUP_ENV = "HIVE_TAILNET_AUTO_CLEANUP";

/**
 * Unattended deletion (the dashboard's daily sweep) is opt-in: the user must
 * set HIVE_TAILNET_AUTO_CLEANUP=1 in ~/.hivemindos/.env. Without it the sweep
 * only reports candidates; deletions then require an explicit manual request.
 */
export async function tailnetAutoCleanupEnabled() {
  const fromProcess = process.env[AUTO_CLEANUP_ENV]?.trim().toLowerCase();
  const raw = fromProcess || parseEnvFileValue(await readFile(HIVE_ENV_FILE, "utf8").catch(() => ""), AUTO_CLEANUP_ENV).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function deviceHostLabel(device: TailnetApiDevice) {
  const name = device.name?.replace(/\.$/, "").split(".")[0] ?? "";
  return (device.hostname?.trim() || name).toLowerCase();
}

function normalizedHostBase(label: string) {
  return label
    .toLowerCase()
    .replace(/-\d+$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function lastSeenAt(device: TailnetApiDevice) {
  const parsed = device.lastSeen ? Date.parse(device.lastSeen) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pick tailnet devices that are safe to delete:
 * - offline for longer than the stale window, AND
 * - either a hivemindos-* link node (created by HivemindOS itself), or a
 *   stale duplicate of a hostname base that has a fresher sibling device
 *   (the `-1`/`-2` corpses Tailscale leaves behind on re-registration).
 * Devices seen within the stale window are never selected.
 */
export function selectStaleTailnetDevices(
  devices: TailnetApiDevice[],
  options: { staleAgeDays?: number; now?: number } = {},
): TailnetCleanupCandidate[] {
  const staleAgeDays = options.staleAgeDays && options.staleAgeDays > 0
    ? options.staleAgeDays
    : DEFAULT_STALE_DEVICE_AGE_DAYS;
  const now = options.now ?? Date.now();
  const staleBefore = now - staleAgeDays * 24 * 60 * 60 * 1000;

  const freshestByBase = new Map<string, number>();
  for (const device of devices) {
    const base = normalizedHostBase(deviceHostLabel(device));
    if (!base) continue;
    freshestByBase.set(base, Math.max(freshestByBase.get(base) ?? 0, lastSeenAt(device)));
  }

  return devices.flatMap((device) => {
    const label = deviceHostLabel(device);
    const seenAt = lastSeenAt(device);
    if (!device.id || !label) return [];
    if (seenAt >= staleBefore) return [];
    const base = normalizedHostBase(label);
    const isHivemindNode = label.startsWith("hivemindos-");
    const hasFresherSibling = Boolean(base) && (freshestByBase.get(base) ?? 0) > Math.max(seenAt, staleBefore);
    if (!isHivemindNode && !hasFresherSibling) return [];
    return [{
      id: device.id,
      name: device.name ?? label,
      hostname: label,
      os: device.os,
      lastSeen: device.lastSeen,
      offlineForDays: seenAt > 0 ? Math.floor((now - seenAt) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY,
      reason: isHivemindNode ? "hivemind-link-node" : "duplicate-hostname",
      scope: isHivemindNode ? "hivemindos" : "duplicate",
    }];
  });
}

async function tailscaleApi(apiKey: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${TAILSCALE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  return response;
}

export async function listTailnetDevices(apiKey: string): Promise<TailnetApiDevice[]> {
  const response = await tailscaleApi(apiKey, "/tailnet/-/devices?fields=default");
  if (!response.ok) {
    throw new Error(`Tailscale API listed devices with status ${response.status}.`);
  }
  const payload = await response.json() as { devices?: TailnetApiDevice[] };
  return payload.devices ?? [];
}

export async function planTailnetCleanup(staleAgeDays?: number): Promise<TailnetCleanupPlan> {
  const resolvedAge = staleAgeDays && staleAgeDays > 0 ? staleAgeDays : DEFAULT_STALE_DEVICE_AGE_DAYS;
  const apiKey = await tailscaleApiKey();
  if (!apiKey) {
    return {
      configured: false,
      staleAgeDays: resolvedAge,
      totalDevices: 0,
      candidates: [],
      error: "No Tailscale API key found. Add TAILSCALE_API_KEY to ~/.hivemindos/.env to enable stale node cleanup.",
    };
  }
  try {
    const devices = await listTailnetDevices(apiKey);
    return {
      configured: true,
      staleAgeDays: resolvedAge,
      totalDevices: devices.length,
      candidates: selectStaleTailnetDevices(devices, { staleAgeDays: resolvedAge }),
    };
  } catch (error) {
    return {
      configured: true,
      staleAgeDays: resolvedAge,
      totalDevices: 0,
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type TailnetCleanupResult = {
  id: string;
  hostname: string;
  ok: boolean;
  detail?: string;
};

export async function deleteTailnetDevices(candidates: TailnetCleanupCandidate[]): Promise<TailnetCleanupResult[]> {
  const apiKey = await tailscaleApiKey();
  if (!apiKey) {
    return candidates.map((candidate) => ({
      id: candidate.id,
      hostname: candidate.hostname,
      ok: false,
      detail: "No Tailscale API key configured.",
    }));
  }
  const results: TailnetCleanupResult[] = [];
  for (const candidate of candidates) {
    try {
      const response = await tailscaleApi(apiKey, `/device/${encodeURIComponent(candidate.id)}`, { method: "DELETE" });
      results.push({
        id: candidate.id,
        hostname: candidate.hostname,
        ok: response.ok,
        detail: response.ok ? undefined : `Tailscale API returned status ${response.status}.`,
      });
    } catch (error) {
      results.push({
        id: candidate.id,
        hostname: candidate.hostname,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
