import {
  hivemindLinkControlUrl,
  localTelemetryCollectorUrl,
} from "@/lib/services/hivemind-link-control";
import {
  isHivemindMachineName,
  isMacMachineOs,
  isMobileMachineOs,
  isVisibleFleetMachine,
} from "@/features/fleet/fleet-identity";

// Tailnet device identity, dedupe, and collector-URL resolution for
// /api/fleet/discover. Extracted from that route verbatim to keep it under the
// file-size ratchet; the route owns discovery orchestration, this owns the
// per-device shape.

export type TailscalePeer = {
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

export type Device = {
  self: boolean;
  name: string;
  dnsName: string;
  os: string;
  online: boolean;
  ip: string;
  collectorUrl: string;
  collectorUrlCandidates?: string[];
  lastSeen?: string;
  lastHandshake?: string;
  curAddr?: string;
  rxBytes?: number;
  txBytes?: number;
  active?: boolean;
  relay?: string;
};

function localCollectorUrl() {
  return localTelemetryCollectorUrl();
}

export function shouldUseTailscaleCliFallback() {
  return (
    process.platform !== "darwin" ||
    process.env.HIVEMIND_TAILSCALE_CLI_FALLBACK === "1"
  );
}

export function localDevice(): Device {
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

export function dnsLabel(dnsName: string) {
  return dnsName.replace(/\.$/, "").split(".")[0] ?? "";
}

function isGenericHostname(name?: string) {
  const normalized = name?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "localhost" ||
    normalized === "localhost.localdomain"
  );
}

function displayNameForPeer(peer: TailscalePeer, dnsName: string, ip: string) {
  const magicDnsName = dnsLabel(dnsName);
  if (normalizeName(peer.HostName).startsWith("hivemindos") && magicDnsName)
    return magicDnsName;
  return isGenericHostname(peer.HostName)
    ? magicDnsName || ip || "Unknown device"
    : peer.HostName || magicDnsName || ip || "Unknown device";
}

export function normalizeName(value?: string) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

export function normalizeDnsName(value?: string) {
  return value?.replace(/\.$/, "").toLowerCase() ?? "";
}

export function isSameTailscalePeer(left?: TailscalePeer, right?: TailscalePeer) {
  if (!left || !right) return false;
  const leftIps = new Set(left.TailscaleIPs ?? []);
  if ((right.TailscaleIPs ?? []).some((ip) => leftIps.has(ip))) return true;
  const leftDns = normalizeDnsName(left.DNSName);
  const rightDns = normalizeDnsName(right.DNSName);
  return Boolean(leftDns && rightDns && leftDns === rightDns);
}

// Exact identity: the normalized dns label (or name) with only the
// `hivemindos` prefix and `.local` suffix stripped. The same physical
// machine's system node and link node map to the same identity, while
// tailscale's `-N` suffix is KEPT — a `-1` node is a different physical
// machine that shares the hostname (two MacBooks named "Liams-MacBook-Pro"),
// and stripping it merged them into one machine.
export function exactMachineIdentity(device: Device) {
  const value =
    normalizeName(dnsLabel(device.dnsName)) || normalizeName(device.name);
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "");
}

export function deviceIdentityKey(device: Device) {
  const identity = exactMachineIdentity(device);
  if (identity) return identity;
  if (device.self) return "self";
  return device.ip || device.collectorUrl;
}

// Machine visibility/OS predicates are single-sourced in fleet-identity.ts
// (they encode the v0.2.13-15 lessons: never drop self, keep Windows/Linux).
function isHivemindLinkDevice(device: Device) {
  return isHivemindMachineName(device.name, device.dnsName);
}

export function isMobileDevice(device: Device) {
  return isMobileMachineOs(device.os);
}

export function isMacDevice(device: Device) {
  return isMacMachineOs(device.os);
}

const STALE_OFFLINE_NODE_MS = 7 * 24 * 60 * 60 * 1000;

function machineFamilyBase(device: Device) {
  return exactMachineIdentity(device).replace(/\d+$/, "");
}

function isLongOffline(device: Device) {
  if (device.online) return false;
  const lastSeen = device.lastSeen ?? "";
  if (!lastSeen || lastSeen.startsWith("0001-01-01")) return false;
  const seenAt = Date.parse(lastSeen);
  return Number.isFinite(seenAt) && Date.now() - seenAt > STALE_OFFLINE_NODE_MS;
}

export function isStaleSelfDuplicate(self: Device | undefined, device: Device) {
  if (!self || device.self) return false;
  // Exact identity: this machine's own link node (or another tailnet view of
  // the same node) seen as a peer.
  const selfIdentity = exactMachineIdentity(self);
  const deviceIdentity = exactMachineIdentity(device);
  if (selfIdentity && deviceIdentity && selfIdentity === deviceIdentity)
    return true;
  if (self.ip && device.ip && self.ip === device.ip) return true;
  // A name-base match with the `-N` suffix stripped is AMBIGUOUS: it is
  // either an old registration of this machine (macOS renames itself, link
  // nodes re-register) or a DIFFERENT physical machine that shares the
  // hostname. An online node is alive somewhere we are not — never hide it.
  // Only hide entries that have been offline long enough to be dead.
  const selfFamily = machineFamilyBase(self);
  if (!selfFamily || selfFamily !== machineFamilyBase(device)) return false;
  return isLongOffline(device);
}

export function deviceFreshnessScore(device: Device) {
  return (
    (device.self ? 10_000 : 0) +
    (isHivemindLinkDevice(device) ? 500 : 0) +
    (device.online ? 1_000 : 0) +
    (device.active ? 100 : 0) +
    (device.lastHandshake && !device.lastHandshake.startsWith("0001-01-01")
      ? 10
      : 0) +
    ((device.rxBytes ?? 0) > 0 || (device.txBytes ?? 0) > 0 ? 1 : 0)
  );
}

export function dedupeDevices(devices: Device[]) {
  const byIdentity = new Map<string, Device>();
  for (const device of devices) {
    const key = deviceIdentityKey(device);
    const previous = byIdentity.get(key);
    if (
      !previous ||
      deviceFreshnessScore(device) > deviceFreshnessScore(previous)
    ) {
      byIdentity.set(key, device);
    }
  }
  return [...byIdentity.values()].filter(isVisibleFleetMachine);
}

function normalizedMachineId(value?: string) {
  const trimmed = value?.trim() ?? "";
  return /^hivemind-machine-[a-f0-9]{32}$/i.test(trimmed)
    ? trimmed.toLowerCase()
    : "";
}

export function machineIdentityKey(machine: {
  device: Device;
  collector: string;
  machineId?: string;
}) {
  const machineId =
    machine.collector === "ready" ? normalizedMachineId(machine.machineId) : "";
  return machineId || deviceIdentityKey(machine.device);
}

export const REMOTE_COLLECTOR_PORT_CANDIDATES = Array.from(
  { length: 24 },
  (_, index) => 8787 + index,
);

function linkCollectorUrlForPort(ip: string, port: number) {
  return `${hivemindLinkControlUrl()}/peer/${encodeURIComponent(`${ip}:${port}`)}`;
}

function directCollectorUrlForPort(ip: string, port: number) {
  return `http://${ip}:${port}`;
}

function remoteCollectorUrlCandidates(ip: string, viaLink: boolean) {
  if (!ip) return [];
  const direct = REMOTE_COLLECTOR_PORT_CANDIDATES.map((port) =>
    directCollectorUrlForPort(ip, port),
  );
  if (!viaLink) return direct;
  const link = REMOTE_COLLECTOR_PORT_CANDIDATES.map((port) =>
    linkCollectorUrlForPort(ip, port),
  );
  return [...link, ...direct];
}

export function simplifyDevice(
  peer: TailscalePeer,
  self = false,
  viaLink = false,
): Device {
  const ip =
    peer.TailscaleIPs?.find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value)) ??
    peer.TailscaleIPs?.[0] ??
    "";
  const dnsName = peer.DNSName?.replace(/\.$/, "") ?? "";
  const collectorUrlCandidates = self
    ? [localCollectorUrl()]
    : remoteCollectorUrlCandidates(ip, viaLink);
  return {
    self,
    name: self ? "This Mac" : displayNameForPeer(peer, dnsName, ip),
    dnsName,
    os: peer.OS ?? "unknown",
    online: self ? true : Boolean(peer.Online),
    ip,
    collectorUrl: self ? localCollectorUrl() : "",
    collectorUrlCandidates,
    lastSeen: peer.LastSeen,
    lastHandshake: peer.LastHandshake,
    curAddr: peer.CurAddr ?? "",
    rxBytes: peer.RxBytes ?? 0,
    txBytes: peer.TxBytes ?? 0,
    active: Boolean(peer.Active),
    relay: peer.Relay ?? "",
  };
}
