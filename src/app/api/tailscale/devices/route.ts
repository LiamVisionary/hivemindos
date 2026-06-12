import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { mkdir, readFile, readlink, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import { promisify } from "util";
import {
  hivemindLinkControlUrl,
  localTelemetryCollectorUrl,
} from "@/lib/services/hivemind-link-control";

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

const machineIdPath = join(homedir(), ".hivemindos", "machine-id");
let machineIdPromise: Promise<string> | null = null;

async function stableMachineId() {
  if (machineIdPromise) return machineIdPromise;
  machineIdPromise = (async () => {
    const existing = (
      await readFile(machineIdPath, "utf8").catch(() => "")
    ).trim();
    if (/^hivemind-machine-[a-f0-9]{32}$/.test(existing)) return existing;
    const generated = `hivemind-machine-${randomBytes(16).toString("hex")}`;
    await mkdir(dirname(machineIdPath), { recursive: true, mode: 0o700 });
    await writeFile(machineIdPath, `${generated}\n`, { mode: 0o600 });
    return generated;
  })();
  return machineIdPromise;
}

function localCollectorUrl() {
  return localTelemetryCollectorUrl();
}

function shouldUseTailscaleCliFallback() {
  return (
    process.platform !== "darwin" ||
    process.env.HIVEMIND_TAILSCALE_CLI_FALLBACK === "1"
  );
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
    collectorUrlCandidates: [localCollectorUrl()],
    lastSeen: undefined,
    lastHandshake: undefined,
    curAddr: "",
    rxBytes: 0,
    txBytes: 0,
    active: false,
    relay: "",
  };
}

function dnsLabel(dnsName: string) {
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

// Exact identity: the normalized dns label (or name) with only the
// `hivemindos` prefix and `.local` suffix stripped. The same physical
// machine's system node and link node map to the same identity, while
// tailscale's `-N` suffix is KEPT — a `-1` node is a different physical
// machine that shares the hostname (two MacBooks named "Liams-MacBook-Pro"),
// and stripping it merged them into one machine.
function exactMachineIdentity(device: ReturnType<typeof simplifyDevice>) {
  const value =
    normalizeName(dnsLabel(device.dnsName)) || normalizeName(device.name);
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "");
}

function deviceIdentityKey(device: ReturnType<typeof simplifyDevice>) {
  const identity = exactMachineIdentity(device);
  if (identity) return identity;
  if (device.self) return "self";
  return device.ip || device.collectorUrl;
}

function isHivemindLinkDevice(device: ReturnType<typeof simplifyDevice>) {
  return (
    normalizeName(device.name).startsWith("hivemindos") ||
    normalizeName(dnsLabel(device.dnsName)).startsWith("hivemindos")
  );
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
  return (
    peer.Online === true &&
    hasNeverHandshake(peer.LastHandshake) &&
    (peer.RxBytes ?? 0) === 0 &&
    (!peer.CurAddr || peer.CurAddr.trim() === "")
  );
}

function tailnetHealthFromStatus(
  status?: TailscaleStatus | HivemindLinkStatus | null,
): TailnetHealth | undefined {
  if (!status)
    return {
      state: "status-unavailable",
      detail: "Tailscale status was not available.",
    };
  const isCliStatus =
    Object.prototype.hasOwnProperty.call(status, "Self") ||
    Object.prototype.hasOwnProperty.call(status, "Peer");
  const backendState = isCliStatus
    ? (status as TailscaleStatus).BackendState
    : (status as HivemindLinkStatus).backendState;
  if (backendState && backendState !== "Running") {
    return {
      state: "not-running",
      detail: `Tailscale backend is ${backendState}.`,
    };
  }
  const peerMap = isCliStatus
    ? (status as TailscaleStatus).Peer
    : (status as HivemindLinkStatus).peer;
  const onlinePeers = Object.values(peerMap ?? {}).filter(
    (peer) => peer.Online === true,
  );
  const stalledPeers = onlinePeers.filter(peerLooksTrafficStalled);
  if (onlinePeers.length > 0 && stalledPeers.length === onlinePeers.length) {
    return {
      state: "peer-traffic-stalled",
      detail: `Tailscale lists ${onlinePeers.length} online peer${onlinePeers.length === 1 ? "" : "s"}, but this Mac has no current peer receive traffic or handshake.`,
    };
  }
  return { state: "ok" };
}

const STALE_OFFLINE_NODE_MS = 7 * 24 * 60 * 60 * 1000;

function machineFamilyBase(device: ReturnType<typeof simplifyDevice>) {
  return exactMachineIdentity(device).replace(/\d+$/, "");
}

function isLongOffline(device: ReturnType<typeof simplifyDevice>) {
  if (device.online) return false;
  const lastSeen = device.lastSeen ?? "";
  if (!lastSeen || lastSeen.startsWith("0001-01-01")) return false;
  const seenAt = Date.parse(lastSeen);
  return Number.isFinite(seenAt) && Date.now() - seenAt > STALE_OFFLINE_NODE_MS;
}

function isStaleSelfDuplicate(
  self: ReturnType<typeof simplifyDevice> | undefined,
  device: ReturnType<typeof simplifyDevice>,
) {
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

function deviceFreshnessScore(device: ReturnType<typeof simplifyDevice>) {
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

function dedupeDevices(devices: ReturnType<typeof simplifyDevice>[]) {
  const byIdentity = new Map<string, ReturnType<typeof simplifyDevice>>();
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
  return [...byIdentity.values()].filter(
    (device) =>
      isHivemindLinkDevice(device) ||
      isMacDevice(device) ||
      isMobileDevice(device),
  );
}

const REMOTE_COLLECTOR_PORT_CANDIDATES = Array.from(
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

function simplifyDevice(peer: TailscalePeer, self = false, viaLink = false) {
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

async function hivemindLinkStatus(): Promise<HivemindLinkStatus | null> {
  try {
    const response = await fetch(`${hivemindLinkControlUrl()}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as HivemindLinkStatus;
  } catch {
    return null;
  }
}

async function systemTailscaleStatus(
  options: { allowCliFallback?: boolean } = {},
) {
  const localApiStatus = await tailscaleLocalApiStatus();
  if (localApiStatus) return localApiStatus;
  if (options.allowCliFallback === false || !shouldUseTailscaleCliFallback()) {
    return { error: "Tailscale LocalAPI unavailable" };
  }

  let lastError = "tailscale unavailable";
  for (const command of TAILSCALE_CLI_CANDIDATES) {
    const { stdout, error } = await execFileAsync(
      command,
      ["status", "--json"],
      {
        timeout: TAILSCALE_STATUS_TIMEOUT_MS,
        maxBuffer: 1_500_000,
      },
    )
      .then(({ stdout }) => ({ stdout, error: "" }))
      .catch((err) => ({
        stdout: "",
        error: err instanceof Error ? err.message : "tailscale unavailable",
      }));
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

async function tailscaleLocalApiStatus(): Promise<
  (TailscaleStatus & { error?: string }) | undefined
> {
  try {
    const port = (await readlink("/Library/Tailscale/ipnport")).trim();
    const proof = (
      await readFile(`/Library/Tailscale/sameuserproof-${port}`, "utf8")
    ).trim();
    if (!port || !proof) return undefined;
    const response = await fetch(
      `http://127.0.0.1:${port}/localapi/v0/status`,
      {
        cache: "no-store",
        headers: {
          Authorization: `Basic ${Buffer.from(`x:${proof}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(TAILSCALE_LOCAL_API_TIMEOUT_MS),
      },
    );
    if (!response.ok) return undefined;
    return (await response.json()) as TailscaleStatus & { error?: string };
  } catch {
    return undefined;
  }
}

function devicesFromStatus(
  status: TailscaleStatus | HivemindLinkStatus,
  viaLink = false,
  ignoredPeer?: TailscalePeer,
) {
  const isCliStatus =
    Object.prototype.hasOwnProperty.call(status, "Self") ||
    Object.prototype.hasOwnProperty.call(status, "Peer");
  const selfPeer = isCliStatus
    ? (status as TailscaleStatus).Self
    : (status as HivemindLinkStatus).self;
  const peerMap = isCliStatus
    ? (status as TailscaleStatus).Peer
    : (status as HivemindLinkStatus).peer;
  const self = selfPeer ? simplifyDevice(selfPeer, true, viaLink) : undefined;
  const peers = Object.values(peerMap ?? {})
    .filter((peer) => !isSameTailscalePeer(peer, ignoredPeer))
    .map((peer) => simplifyDevice(peer, false, viaLink))
    .filter((device) => !isStaleSelfDuplicate(self, device));
  return dedupeDevices([...(self ? [self] : []), ...peers]);
}

async function withLocalMachineId(
  devices: ReturnType<typeof devicesFromStatus>,
) {
  const machineId = await stableMachineId().catch(() => "");
  if (!machineId) return devices;
  return devices.map((device) =>
    device.self ? { ...device, machineId } : device,
  );
}

export async function GET() {
  const link = await hivemindLinkStatus();
  if (link) {
    const status = await systemTailscaleStatus({ allowCliFallback: true });
    const health = tailnetHealthFromStatus(status.error ? link : status);
    // A paired phone reaches THIS Mac via the SYSTEM Tailscale node — that's
    // where the desktop app's tailnet forwarder binds (lib.rs
    // spawn_tailnet_forwarder), and the pairing QR is built from the self
    // device's ip. hivemind-linkd runs a SEPARATE embedded tsnet node, so
    // link.self's ip is a different address with no forwarder on it (the QR
    // pointed there and the phone timed out). Advertise the system tailnet
    // IPv4 for the self device instead; fall back to link.self's ip only if the
    // system status is unavailable.
    const systemSelfIp = status.error
      ? ""
      : (status.Self?.TailscaleIPs?.find((value) =>
          /^\d+\.\d+\.\d+\.\d+$/.test(value),
        ) ?? "");
    const devices = await withLocalMachineId(
      devicesFromStatus(link, true, status.error ? undefined : status.Self),
    );
    return Response.json({
      ok: link.ok === true,
      backendState: link.backendState,
      authUrl: link.authUrl,
      magicDnsSuffix: link.magicDnsSuffix,
      source: "hivemind-link",
      tailnetHealth: health,
      devices: systemSelfIp
        ? devices.map((device) =>
            device.self ? { ...device, ip: systemSelfIp } : device,
          )
        : devices,
    });
  }

  const status = await systemTailscaleStatus({ allowCliFallback: true });
  if (status.error) {
    return Response.json({
      ok: false,
      error: status.error,
      tailnetHealth: tailnetHealthFromStatus(null),
      devices: await withLocalMachineId([localDevice()]),
    });
  }
  const health = tailnetHealthFromStatus(status);
  return Response.json({
    ok: status.BackendState === "Running",
    backendState: status.BackendState,
    magicDnsSuffix: status.MagicDNSSuffix,
    source: "tailscale-cli",
    tailnetHealth: health,
    devices: await withLocalMachineId(devicesFromStatus(status)),
  });
}
