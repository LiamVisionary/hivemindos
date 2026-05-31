import { execFile } from "child_process";
import { readFile, readlink } from "fs/promises";
import { promisify } from "util";
import { hivemindLinkControlUrl, localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const TAILSCALE_STATUS_TIMEOUT_MS = 6_000;
const TAILSCALE_LOCAL_API_TIMEOUT_MS = 2_000;
const TAILSCALE_CLI_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

type TailscalePeer = {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  TailscaleIPs?: string[];
  LastSeen?: string;
  LastHandshake?: string;
  CurAddr?: string;
  RxBytes?: number;
  TxBytes?: number;
  Active?: boolean;
  Relay?: string;
};

type TailscaleStatus = {
  BackendState?: string;
  MagicDNSSuffix?: string;
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
};

type HivemindLinkStatus = {
  ok?: boolean;
  backendState?: string;
  magicDnsSuffix?: string;
  self?: TailscalePeer;
  peer?: Record<string, TailscalePeer>;
  authUrl?: string;
  error?: string;
};

type TailnetHealth = {
  state: "ok" | "peer-traffic-stalled" | "status-unavailable" | "not-running";
  detail?: string;
};

function localCollectorUrl() {
  return localTelemetryCollectorUrl();
}

function shouldUseTailscaleCliFallback() {
  return process.platform !== "darwin" || process.env.HIVEMIND_TAILSCALE_CLI_FALLBACK === "1";
}

function localDevice() {
  return {
    self: true,
    name: "This machine",
    dnsName: "",
    os: process.platform,
    online: true,
    ip: "127.0.0.1",
    collectorUrl: localCollectorUrl(),
    relay: "",
  };
}

function dnsLabel(dnsName: string) {
  return dnsName.replace(/\.$/, "").split(".")[0] ?? "";
}

function isGenericHostname(name?: string) {
  const normalized = name?.trim().toLowerCase();
  return !normalized || normalized === "localhost" || normalized === "localhost.localdomain";
}

function displayNameForPeer(peer: TailscalePeer, dnsName: string, ip: string) {
  const magicDnsName = dnsLabel(dnsName);
  if (normalizeName(peer.HostName).startsWith("hivemindos") && magicDnsName) return magicDnsName;
  return isGenericHostname(peer.HostName)
    ? magicDnsName || ip || "Unknown device"
    : peer.HostName || magicDnsName || ip || "Unknown device";
}

function normalizeName(value?: string) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function normalizeDnsName(value?: string) {
  return value?.replace(/\.$/, "").toLowerCase() ?? "";
}

function isSameTailscalePeer(left?: TailscalePeer, right?: TailscalePeer) {
  if (!left || !right) return false;
  const leftIps = new Set(left.TailscaleIPs ?? []);
  if ((right.TailscaleIPs ?? []).some((ip) => leftIps.has(ip))) return true;
  const leftDns = normalizeDnsName(left.DNSName);
  const rightDns = normalizeDnsName(right.DNSName);
  return Boolean(leftDns && rightDns && leftDns === rightDns);
}

function deviceIdentityKey(device: ReturnType<typeof simplifyDevice>) {
  const dnsName = normalizeName(dnsLabel(device.dnsName));
  const name = normalizeName(device.name) || dnsName;
  if (name.startsWith("hivemindos")) return hivemindMachineBase(device) || dnsName || name;
  if (device.self) return "self";
  return name || device.ip || device.collectorUrl;
}

function isHivemindLinkDevice(device: ReturnType<typeof simplifyDevice>) {
  return normalizeName(device.name).startsWith("hivemindos")
    || normalizeName(dnsLabel(device.dnsName)).startsWith("hivemindos");
}

function isMobileDevice(device: ReturnType<typeof simplifyDevice>) {
  return /^(ios|android)$/i.test(device.os);
}

function isMacDevice(device: ReturnType<typeof simplifyDevice>) {
  return /^(macos|darwin)$/i.test(device.os);
}

function hasNeverHandshake(value?: string) {
  return !value || value.startsWith("0001-01-01");
}

function peerLooksTrafficStalled(peer: TailscalePeer) {
  return peer.Online === true
    && hasNeverHandshake(peer.LastHandshake)
    && (peer.RxBytes ?? 0) === 0
    && (!peer.CurAddr || peer.CurAddr.trim() === "");
}

function tailnetHealthFromStatus(status?: TailscaleStatus | HivemindLinkStatus | null): TailnetHealth | undefined {
  if (!status) return { state: "status-unavailable", detail: "Tailscale status was not available." };
  const isCliStatus = Object.prototype.hasOwnProperty.call(status, "Self") || Object.prototype.hasOwnProperty.call(status, "Peer");
  const backendState = isCliStatus ? (status as TailscaleStatus).BackendState : (status as HivemindLinkStatus).backendState;
  if (backendState && backendState !== "Running") {
    return { state: "not-running", detail: `Tailscale backend is ${backendState}.` };
  }
  const peerMap = isCliStatus ? (status as TailscaleStatus).Peer : (status as HivemindLinkStatus).peer;
  const onlinePeers = Object.values(peerMap ?? {}).filter((peer) => peer.Online === true);
  const stalledPeers = onlinePeers.filter(peerLooksTrafficStalled);
  if (onlinePeers.length > 0 && stalledPeers.length === onlinePeers.length) {
    return {
      state: "peer-traffic-stalled",
      detail: `Tailscale lists ${onlinePeers.length} online peer${onlinePeers.length === 1 ? "" : "s"}, but this Mac has no current peer receive traffic or handshake.`,
    };
  }
  return { state: "ok" };
}

function hivemindMachineBase(device: ReturnType<typeof simplifyDevice>) {
  const rawName = device.name.toLowerCase();
  const rawDnsName = dnsLabel(device.dnsName).toLowerCase();
  const rawValue = normalizeName(rawName).startsWith("hivemindos") ? rawName : rawDnsName;
  const canonicalValue = isMacDevice(device) ? rawValue.replace(/-\d+$/, "") : rawValue;
  const value = normalizeName(canonicalValue);
  if (!value.startsWith("hivemindos")) return "";
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "");
}

function physicalMachineBase(device: ReturnType<typeof simplifyDevice>) {
  const normalizedDnsName = normalizeName(dnsLabel(device.dnsName));
  const normalizedName = normalizeName(device.name);
  const value = normalizedDnsName || normalizedName;
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "").replace(/\d+$/, "");
}

function isStaleSelfDuplicate(
  self: ReturnType<typeof simplifyDevice> | undefined,
  device: ReturnType<typeof simplifyDevice>,
) {
  if (!self || device.self) return false;
  const deviceIsHivemindLink = isHivemindLinkDevice(device);
  const selfBase = hivemindMachineBase(self);
  const deviceBase = hivemindMachineBase(device);
  if (deviceIsHivemindLink) {
    return Boolean(!device.online && selfBase && deviceBase && selfBase === deviceBase);
  }
  if (selfBase && deviceBase && selfBase === deviceBase) return true;
  const physicalSelfBase = physicalMachineBase(self);
  const physicalDeviceBase = physicalMachineBase(device);
  if (physicalSelfBase && physicalDeviceBase && physicalSelfBase === physicalDeviceBase) return true;
  if (physicalSelfBase && deviceBase && physicalSelfBase === deviceBase) return true;
  if (selfBase && physicalDeviceBase && selfBase === physicalDeviceBase) return true;
  if (device.online) return false;
  return normalizeName(self.name) !== "" && normalizeName(self.name) === normalizeName(device.name);
}

function deviceFreshnessScore(device: ReturnType<typeof simplifyDevice>) {
  return (device.self ? 10_000 : 0)
    + (isHivemindLinkDevice(device) ? 500 : 0)
    + (device.online ? 1_000 : 0)
    + (device.active ? 100 : 0)
    + (device.lastHandshake && !device.lastHandshake.startsWith("0001-01-01") ? 10 : 0)
    + ((device.rxBytes ?? 0) > 0 || (device.txBytes ?? 0) > 0 ? 1 : 0);
}

function dedupeDevices(devices: ReturnType<typeof simplifyDevice>[]) {
  const byIdentity = new Map<string, ReturnType<typeof simplifyDevice>>();
  for (const device of devices) {
    const key = deviceIdentityKey(device);
    const previous = byIdentity.get(key);
    if (!previous || deviceFreshnessScore(device) > deviceFreshnessScore(previous)) {
      byIdentity.set(key, device);
    }
  }
  return [...byIdentity.values()].filter((device) => isHivemindLinkDevice(device) || isMacDevice(device));
}

function linkCollectorUrl(ip: string) {
  return `${hivemindLinkControlUrl()}/peer/${encodeURIComponent(`${ip}:8787`)}`;
}

function simplifyDevice(peer: TailscalePeer, self = false, viaLink = false) {
  const ip = peer.TailscaleIPs?.find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value)) ?? peer.TailscaleIPs?.[0] ?? "";
  const dnsName = peer.DNSName?.replace(/\.$/, "") ?? "";
  return {
    self,
    name: self ? "This Mac" : displayNameForPeer(peer, dnsName, ip),
    dnsName,
    os: peer.OS ?? "unknown",
    online: self ? true : Boolean(peer.Online),
    ip,
    collectorUrl: self ? localCollectorUrl() : ip ? (viaLink ? linkCollectorUrl(ip) : `http://${ip}:8787`) : "",
    lastSeen: peer.LastSeen,
    lastHandshake: peer.LastHandshake,
    curAddr: peer.CurAddr ?? "",
    rxBytes: peer.RxBytes ?? 0,
    txBytes: peer.TxBytes ?? 0,
    active: Boolean(peer.Active),
    relay: peer.Relay ?? "",
  };
}

async function hivemindLinkStatus(): Promise<HivemindLinkStatus | null> {
  try {
    const response = await fetch(`${hivemindLinkControlUrl()}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    return await response.json() as HivemindLinkStatus;
  } catch {
    return null;
  }
}

async function systemTailscaleStatus(options: { allowCliFallback?: boolean } = {}) {
  const localApiStatus = await tailscaleLocalApiStatus();
  if (localApiStatus) return localApiStatus;
  if (options.allowCliFallback === false || !shouldUseTailscaleCliFallback()) {
    return { error: "Tailscale LocalAPI unavailable" };
  }

  let lastError = "tailscale unavailable";
  for (const command of TAILSCALE_CLI_CANDIDATES) {
    const { stdout, error } = await execFileAsync(command, ["status", "--json"], {
      timeout: TAILSCALE_STATUS_TIMEOUT_MS,
      maxBuffer: 1_500_000,
    }).then(({ stdout }) => ({ stdout, error: "" })).catch((err) => ({ stdout: "", error: err instanceof Error ? err.message : "tailscale unavailable" }));
    if (error) lastError = error;
    if (!stdout) continue;
    try {
      return JSON.parse(stdout) as TailscaleStatus & { error?: string };
    } catch {
      lastError = "Could not parse tailscale status";
      continue;
    }
  }
  return { error: lastError };
}

async function tailscaleLocalApiStatus(): Promise<(TailscaleStatus & { error?: string }) | undefined> {
  try {
    const port = (await readlink("/Library/Tailscale/ipnport")).trim();
    const proof = (await readFile(`/Library/Tailscale/sameuserproof-${port}`, "utf8")).trim();
    if (!port || !proof) return undefined;
    const response = await fetch(`http://127.0.0.1:${port}/localapi/v0/status`, {
      cache: "no-store",
      headers: {
        Authorization: `Basic ${Buffer.from(`x:${proof}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(TAILSCALE_LOCAL_API_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return await response.json() as TailscaleStatus & { error?: string };
  } catch {
    return undefined;
  }
}

function devicesFromStatus(status: TailscaleStatus | HivemindLinkStatus, viaLink = false, ignoredPeer?: TailscalePeer) {
  const isCliStatus = Object.prototype.hasOwnProperty.call(status, "Self") || Object.prototype.hasOwnProperty.call(status, "Peer");
  const selfPeer = isCliStatus ? (status as TailscaleStatus).Self : (status as HivemindLinkStatus).self;
  const peerMap = isCliStatus ? (status as TailscaleStatus).Peer : (status as HivemindLinkStatus).peer;
  const self = selfPeer ? simplifyDevice(selfPeer, true, viaLink) : undefined;
  const peers = Object.values(peerMap ?? {})
    .filter((peer) => !isSameTailscalePeer(peer, ignoredPeer))
    .map((peer) => simplifyDevice(peer, false, viaLink))
    .filter((device) => !isStaleSelfDuplicate(self, device));
  return dedupeDevices([...(self ? [self] : []), ...peers]);
}

export async function GET() {
  const link = await hivemindLinkStatus();
  if (link) {
    const status = await systemTailscaleStatus({ allowCliFallback: false });
    const health = tailnetHealthFromStatus(status.error ? link : status);
    return Response.json({
      ok: link.ok === true,
      backendState: link.backendState,
      authUrl: link.authUrl,
      magicDnsSuffix: link.magicDnsSuffix,
      source: "hivemind-link",
      tailnetHealth: health,
      devices: devicesFromStatus(link, true, status.error ? undefined : status.Self),
    });
  }

  const status = await systemTailscaleStatus({ allowCliFallback: true });
  if (status.error) {
    return Response.json({
      ok: false,
      error: status.error,
      tailnetHealth: tailnetHealthFromStatus(null),
      devices: [localDevice()],
    });
  }
  const health = tailnetHealthFromStatus(status);
  return Response.json({
    ok: status.BackendState === "Running",
    backendState: status.BackendState,
    magicDnsSuffix: status.MagicDNSSuffix,
    source: "tailscale-cli",
    tailnetHealth: health,
    devices: devicesFromStatus(status),
  });
}
