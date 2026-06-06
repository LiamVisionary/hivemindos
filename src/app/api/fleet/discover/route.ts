import { execFile } from "child_process";
import { readFile, readlink } from "fs/promises";
import { promisify } from "util";
import { hivemindLinkControlUrl, localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

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
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
};

type HivemindLinkStatus = {
  ok?: boolean;
  backendState?: string;
  authUrl?: string;
  magicDnsSuffix?: string;
  self?: TailscalePeer;
  peer?: Record<string, TailscalePeer>;
};

type Device = {
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

type FleetDeviceStatus = {
  devices: Device[];
  source: string;
  link?: HivemindLinkStatus;
};

type CollectorVersion = {
  appDir?: string;
  commit?: string;
  shortCommit?: string;
  branch?: string;
  dirty?: boolean;
  latestCommit?: string;
  latestShortCommit?: string;
  updateCommand?: string;
};

type CollectorCapabilities = {
  chat?: boolean;
  envHttpSync?: boolean;
  hostedApps?: boolean;
  runtimeAgentCreation?: boolean;
  skillInventory?: boolean;
  skillAutoSync?: boolean;
  runtimes?: string[];
  syncthing?: boolean;
  defaultSyncPath?: string;
};

type CollectorEnvSync = {
  ready?: boolean;
  user?: string;
  command?: string;
  error?: string;
};

const QUEEN_RUNTIME_PRIORITY: AgentRuntime[] = ["hermes", "openclaw", "openai-compatible", "aeon"];
const FOREGROUND_COLLECTOR_FETCH_TIMEOUT_MS = 2_500;
const BACKGROUND_COLLECTOR_FETCH_TIMEOUT_MS = 8_000;
const SNAPSHOT_FETCH_TIMEOUT_MS = 4_000;
const DISCOVERY_CACHE_MS = 15_000;
const DISCOVERY_REQUEST_TIMEOUT_MS = 20_000;
const DISCOVERY_CACHE_VERSION = "v4";
const TAILSCALE_STATUS_TIMEOUT_MS = 6_000;
const TAILSCALE_LOCAL_API_TIMEOUT_MS = 2_000;
const TAILSCALE_CLI_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

type DiscoveredMachine = {
  device: Device;
  collector: string;
  collectorHost?: string;
  machineId?: string;
  version?: CollectorVersion;
  capabilities?: CollectorCapabilities;
  envSync?: CollectorEnvSync;
  agents: AgentProfile[];
  snapshots: unknown[];
};

type FleetDiscoverPayload = {
  ok: true;
  source: string;
  hivemindLink?: {
    ok: boolean;
    backendState?: string;
    authUrl?: string;
    magicDnsSuffix?: string;
  };
  machines: DiscoveredMachine[];
};

const discoveryCache = new Map<string, { checkedAt: number; payload: FleetDiscoverPayload }>();
const discoveryInFlight = new Map<string, Promise<FleetDiscoverPayload>>();
const discoveryBackgroundInFlight = new Map<string, Promise<FleetDiscoverPayload>>();

function localCollectorUrl() {
  return localTelemetryCollectorUrl();
}

function shouldUseTailscaleCliFallback() {
  return process.platform !== "darwin" || process.env.HIVEMIND_TAILSCALE_CLI_FALLBACK === "1";
}

function localDevice(): Device {
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

function deviceIdentityKey(device: Device) {
  const dnsName = normalizeName(dnsLabel(device.dnsName));
  const name = normalizeName(device.name) || dnsName;
  if (name.startsWith("hivemindos")) return hivemindMachineBase(device) || dnsName || name;
  if (device.self) return "self";
  const macBase = macNumberedHostnameBase(device);
  if (macBase) return macBase;
  return name || device.ip || device.collectorUrl;
}

function isHivemindLinkDevice(device: Device) {
  return normalizeName(device.name).startsWith("hivemindos")
    || normalizeName(dnsLabel(device.dnsName)).startsWith("hivemindos");
}

function isMobileDevice(device: Device) {
  return /^(ios|android)$/i.test(device.os);
}

function isMacDevice(device: Device) {
  return /^(macos|darwin)$/i.test(device.os);
}

function hivemindMachineBase(device: Device) {
  const rawName = device.name.toLowerCase();
  const rawDnsName = dnsLabel(device.dnsName).toLowerCase();
  const rawValue = normalizeName(rawName).startsWith("hivemindos") ? rawName : rawDnsName;
  const canonicalValue = isMacDevice(device) ? rawValue.replace(/-\d+$/, "") : rawValue;
  const value = normalizeName(canonicalValue);
  if (!value.startsWith("hivemindos")) return "";
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "");
}

function physicalMachineBase(device: Device) {
  const normalizedDnsName = normalizeName(dnsLabel(device.dnsName));
  const normalizedName = normalizeName(device.name);
  const value = normalizedDnsName || normalizedName;
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "").replace(/\d+$/, "");
}

function macNumberedHostnameBase(device: Device) {
  if (!isMacDevice(device)) return "";
  const rawValue = dnsLabel(device.dnsName) || device.name || "";
  const withoutTailnetSuffix = rawValue.toLowerCase().replace(/-\d+$/, "");
  const normalizedValue = normalizeName(rawValue);
  const normalizedBase = normalizeName(withoutTailnetSuffix);
  return normalizedBase && normalizedBase !== normalizedValue ? normalizedBase : "";
}

function isStaleSelfDuplicate(self: Device | undefined, device: Device) {
  if (!self || device.self) return false;
  const deviceIsHivemindLink = isHivemindLinkDevice(device);
  const selfBase = hivemindMachineBase(self);
  const deviceBase = hivemindMachineBase(device);
  if (deviceIsHivemindLink) {
    return Boolean(!device.online && selfBase && deviceBase && selfBase === deviceBase);
  }
  const physicalSelfBase = physicalMachineBase(self);
  const physicalDeviceBase = physicalMachineBase(device);
  if (physicalSelfBase && physicalDeviceBase && physicalSelfBase === physicalDeviceBase) return true;
  if (physicalSelfBase && deviceBase && physicalSelfBase === deviceBase) return true;
  if (selfBase && physicalDeviceBase && selfBase === physicalDeviceBase) return true;
  if (device.online) return false;
  return normalizeName(self.name) !== "" && normalizeName(self.name) === normalizeName(device.name);
}

function deviceFreshnessScore(device: Device) {
  return (device.self ? 10_000 : 0)
    + (isHivemindLinkDevice(device) ? 500 : 0)
    + (device.online ? 1_000 : 0)
    + (device.active ? 100 : 0)
    + (device.lastHandshake && !device.lastHandshake.startsWith("0001-01-01") ? 10 : 0)
    + ((device.rxBytes ?? 0) > 0 || (device.txBytes ?? 0) > 0 ? 1 : 0);
}

function dedupeDevices(devices: Device[]) {
  const byIdentity = new Map<string, Device>();
  for (const device of devices) {
    const key = deviceIdentityKey(device);
    const previous = byIdentity.get(key);
    if (!previous || deviceFreshnessScore(device) > deviceFreshnessScore(previous)) {
      byIdentity.set(key, device);
    }
  }
  return [...byIdentity.values()].filter((device) => isHivemindLinkDevice(device) || isMacDevice(device));
}

function normalizedMachineId(value?: string) {
  const trimmed = value?.trim() ?? "";
  return /^hivemind-machine-[a-f0-9]{32}$/i.test(trimmed) ? trimmed.toLowerCase() : "";
}

function machineIdentityKey(machine: { device: Device; collector: string; machineId?: string }) {
  const machineId = machine.collector === "ready" ? normalizedMachineId(machine.machineId) : "";
  return machineId || deviceIdentityKey(machine.device);
}

const REMOTE_COLLECTOR_PORT_CANDIDATES = Array.from({ length: 24 }, (_, index) => 8787 + index);

function linkCollectorUrlForPort(ip: string, port: number) {
  return `${hivemindLinkControlUrl()}/peer/${encodeURIComponent(`${ip}:${port}`)}`;
}

function directCollectorUrlForPort(ip: string, port: number) {
  return `http://${ip}:${port}`;
}

function remoteCollectorUrlCandidates(ip: string, viaLink: boolean) {
  if (!ip) return [];
  const direct = REMOTE_COLLECTOR_PORT_CANDIDATES.map((port) => directCollectorUrlForPort(ip, port));
  if (!viaLink) return direct;
  const link = REMOTE_COLLECTOR_PORT_CANDIDATES.map((port) => linkCollectorUrlForPort(ip, port));
  return [...link, ...direct];
}

function simplifyDevice(peer: TailscalePeer, self = false, viaLink = false): Device {
  const ip = peer.TailscaleIPs?.find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value)) ?? peer.TailscaleIPs?.[0] ?? "";
  const dnsName = peer.DNSName?.replace(/\.$/, "") ?? "";
  const collectorUrlCandidates = self ? [localCollectorUrl()] : remoteCollectorUrlCandidates(ip, viaLink);
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
    return await response.json() as HivemindLinkStatus;
  } catch {
    return null;
  }
}

async function systemTailscaleStatus(options: { allowCliFallback?: boolean } = {}): Promise<TailscaleStatus | undefined> {
  const localApiStatus = await tailscaleLocalApiStatus();
  if (localApiStatus) return localApiStatus;
  if (options.allowCliFallback === false || !shouldUseTailscaleCliFallback()) return undefined;

  for (const command of TAILSCALE_CLI_CANDIDATES) {
    const { stdout } = await execFileAsync(command, ["status", "--json"], {
      timeout: TAILSCALE_STATUS_TIMEOUT_MS,
      maxBuffer: 1_500_000,
    }).catch(() => ({ stdout: "" }));
    if (!stdout) continue;
    try {
      return JSON.parse(stdout) as TailscaleStatus;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function tailscaleLocalApiStatus(): Promise<TailscaleStatus | undefined> {
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
    return await response.json() as TailscaleStatus;
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
  const devices = dedupeDevices([...(self ? [self] : []), ...peers]);
  return devices.length ? devices : [localDevice()];
}

async function tailscaleDevices(): Promise<FleetDeviceStatus> {
  const link = await hivemindLinkStatus();
  if (link) {
    const systemStatus = await systemTailscaleStatus({ allowCliFallback: false });
    const linkDevices = devicesFromStatus(link, true, systemStatus?.Self);
    const systemDevices = systemStatus ? devicesFromStatus(systemStatus) : [];
    return {
      devices: dedupeDevices([...linkDevices, ...systemDevices]),
      link,
      source: systemDevices.length > linkDevices.length ? "hivemind-link+tailscale-cli" : "hivemind-link",
    };
  }

  const systemStatus = await systemTailscaleStatus({ allowCliFallback: true });
  if (!systemStatus) return { devices: [localDevice()], source: "local" };
  return {
    devices: devicesFromStatus(systemStatus),
    source: "tailscale-cli",
  };
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function fetchAgents(url: string, device: Device, timeoutMs: number) {
  try {
    const agentData = await fetchJson(url, timeoutMs) as { agents?: AgentProfile[] };
    return (agentData.agents ?? []).map((agent) => ({
      ...agent,
      telemetryUrl: device.collectorUrl,
      machineName: device.name,
    }));
  } catch {
    return [];
  }
}

function hasQueenAgent(agents: AgentProfile[]) {
  return agents.some((agent) => (
    agent.beeRole === "queen"
    || /queen|orchestrat|lead/i.test(agent.name)
  ));
}

function queenRuntimeRank(runtime: AgentRuntime) {
  const index = QUEEN_RUNTIME_PRIORITY.indexOf(runtime);
  return index === -1 ? QUEEN_RUNTIME_PRIORITY.length : index;
}

function defaultQueenAgent(device: Device, agents: AgentProfile[], capabilities?: CollectorCapabilities): AgentProfile | null {
  if (hasQueenAgent(agents)) return null;
  const configuredRuntimes = new Set((capabilities?.runtimes ?? [])
    .filter((runtime): runtime is AgentRuntime => typeof runtime === "string" && runtime.trim().length > 0));
  const candidates = agents
    .filter((agent) => configuredRuntimes.size === 0 || configuredRuntimes.has(agent.runtime))
    .sort((left, right) => queenRuntimeRank(left.runtime) - queenRuntimeRank(right.runtime));
  const base = candidates[0];
  if (!base) return null;
  const machineSlug = (device.name || device.ip || "machine").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "machine";
  return {
    ...base,
    id: `queen-bee-${machineSlug}-${base.runtime}`,
    name: "Queen Bee",
    agentId: base.agentId || base.id,
    beeRole: "queen",
    workerClass: "planner",
    runtimeKind: base.runtimeKind,
    runtimeCapabilities: base.runtimeCapabilities,
    telemetryUrl: device.collectorUrl,
    machineName: device.name,
    collectorCapabilities: capabilities,
  };
}

function shouldIncludeSnapshots(request: Request) {
  const value = new URL(request.url).searchParams.get("includeSnapshots")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function shouldForceFresh(request: Request) {
  const params = new URL(request.url).searchParams;
  const value = (params.get("fresh") ?? params.get("force"))?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

type DiscoveryProbeOptions = {
  collectorTimeoutMs: number;
  snapshotTimeoutMs: number;
  allowSshFallback?: boolean;
};

type CollectorProbeResult = {
  device: Device;
  agents: AgentProfile[];
  version?: CollectorVersion;
  capabilities?: CollectorCapabilities;
  envSync?: CollectorEnvSync;
  collectorHost?: string;
  machineId?: string;
};

function collectorUrlWithPort(rawUrl: string, port: number) {
  try {
    const url = new URL(rawUrl);
    const peerMatch = url.pathname.match(/^\/peer\/(.+)$/);
    if (peerMatch) {
      const target = decodeURIComponent(peerMatch[1] ?? "");
      const host = target.replace(/:\d+$/, "");
      url.pathname = `/peer/${encodeURIComponent(`${host}:${port}`)}`;
      return url.toString().replace(/\/+$/, "");
    }
    url.port = String(port);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function collectorUrlForHost(host: string, port: number) {
  const trimmed = host.replace(/\.$/, "").trim();
  return trimmed ? `http://${trimmed}:${port}` : "";
}

function collectorUrlCandidates(device: Device) {
  const configuredCandidates = [
    device.collectorUrl,
    ...(device.collectorUrlCandidates ?? []),
  ].map((value) => value?.replace(/\/+$/, "") ?? "").filter(Boolean);
  const primary = configuredCandidates[0] ?? "";
  if (device.self) return configuredCandidates;
  const dnsName = device.dnsName?.replace(/\.$/, "");
  const dnsShortName = dnsName ? dnsLabel(dnsName) : "";
  const dnsCandidates = dnsName
    ? REMOTE_COLLECTOR_PORT_CANDIDATES.flatMap((port) => [
      collectorUrlForHost(dnsShortName, port),
      collectorUrlForHost(dnsName, port),
    ])
    : [];
  return [
    ...configuredCandidates,
    ...(primary ? REMOTE_COLLECTOR_PORT_CANDIDATES.map((port) => collectorUrlWithPort(primary, port)) : []),
    ...dnsCandidates,
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function remoteHostCandidates(device: Device) {
  return [
    dnsLabel(device.dnsName),
    device.dnsName?.replace(/\.$/, ""),
    device.ip,
  ].filter((value, index, values): value is string => Boolean(value?.trim()) && values.indexOf(value) === index);
}

async function fetchRemoteCollectorJsonViaTailscale(device: Device, path: string, timeoutMs: number) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const script = [
    "set -eu",
    "[ -f \"$HOME/.hivemindos/collector.env\" ] && . \"$HOME/.hivemindos/collector.env\" || true",
    "port=\"${AGENT_TELEMETRY_PORT:-8787}\"",
    `curl -fsS --max-time 5 "http://127.0.0.1:$port${shellQuote(safePath).slice(1, -1)}"`,
  ].join("\n");
  const errors: string[] = [];
  for (const host of remoteHostCandidates(device)) {
    for (const target of [`root@${host}`, `ubuntu@${host}`, host]) {
      try {
        const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
          timeout: Math.max(timeoutMs, 4_000),
          maxBuffer: 1_500_000,
        });
        return JSON.parse(stdout) as Record<string, unknown>;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Tailscale SSH collector fallback failed.");
      }
    }
  }
  throw new Error(errors.at(-1) ?? "Tailscale SSH collector fallback failed.");
}

async function probeCollector(device: Device, collectorUrl: string, options: DiscoveryProbeOptions): Promise<CollectorProbeResult> {
  const activeDevice = { ...device, collectorUrl };
  const agentsPromise = fetchAgents(`${collectorUrl}/agents`, activeDevice, options.collectorTimeoutMs);
  const healthData = await fetchJson(`${collectorUrl}/health`, options.collectorTimeoutMs) as {
    host?: string;
    machineId?: string;
    version?: CollectorVersion;
    capabilities?: CollectorCapabilities;
    envSync?: CollectorEnvSync;
  };
  if (!isHivemindCollectorHealth(healthData)) {
    throw new Error("Health endpoint is not a HivemindOS collector.");
  }
  const capabilities = healthData.capabilities ?? { chat: false, runtimes: [] };
  const agents = (await agentsPromise).map((agent) => ({
    ...agent,
    collectorCapabilities: capabilities,
  }));
  return {
    device: activeDevice,
    agents,
    version: healthData.version,
    capabilities,
    envSync: healthData.envSync,
    collectorHost: healthData.host,
    machineId: healthData.machineId,
  };
}

function isHivemindCollectorHealth(payload: {
  version?: CollectorVersion;
  capabilities?: CollectorCapabilities;
  machineId?: string;
}) {
  return Boolean(
    payload.version?.appDir
    || payload.machineId?.startsWith("hivemind-machine-")
    || Array.isArray(payload.capabilities?.runtimes)
    || payload.capabilities?.hostedApps === true
    || payload.capabilities?.runtimeAgentCreation === true
  );
}

async function probeCollectorViaTailscale(device: Device, options: DiscoveryProbeOptions): Promise<CollectorProbeResult> {
  const healthData = await fetchRemoteCollectorJsonViaTailscale(device, "/health", options.collectorTimeoutMs) as {
    host?: string;
    machineId?: string;
    version?: CollectorVersion;
    capabilities?: CollectorCapabilities;
    envSync?: CollectorEnvSync;
  };
  const agentsData = await fetchRemoteCollectorJsonViaTailscale(device, "/agents", options.collectorTimeoutMs)
    .catch(() => ({ agents: [] })) as { agents?: AgentProfile[] };
  const capabilities = healthData.capabilities ?? { chat: false, runtimes: [] };
  const agents = (agentsData.agents ?? []).map((agent) => ({
    ...agent,
    telemetryUrl: device.collectorUrl,
    machineName: device.name,
    collectorCapabilities: capabilities,
  }));
  return {
    device,
    agents,
    version: healthData.version,
    capabilities,
    envSync: healthData.envSync,
    collectorHost: healthData.host,
    machineId: healthData.machineId,
  };
}

async function readDiscovery(includeSnapshots: boolean, options: DiscoveryProbeOptions): Promise<FleetDiscoverPayload> {
  const fleetStatus = await tailscaleDevices().catch((): FleetDeviceStatus => ({ devices: [localDevice()], source: "local" }));
  const devices = fleetStatus.devices;
  const discovered = await Promise.all(devices.map(async (device): Promise<DiscoveredMachine> => {
    if (collectorUrlCandidates(device).length === 0) {
      return { device, collector: "missing", agents: [], snapshots: [] };
    }

    let probe: CollectorProbeResult | null = null;
    try {
      const probeOptions = device.self
        ? { ...options, collectorTimeoutMs: Math.max(options.collectorTimeoutMs, 4_000) }
        : options;
      const probeResults = await Promise.all(
        collectorUrlCandidates(device).map((collectorUrl) => probeCollector(device, collectorUrl, probeOptions).catch(() => null)),
      );
      probe = probeResults.find((result): result is CollectorProbeResult => Boolean(result)) ?? null;
      if (!probe && options.allowSshFallback && !device.self && device.online) {
        probe = await probeCollectorViaTailscale(device, probeOptions).catch(() => null);
      }
    } catch {
      probe = null;
    }
    if (!probe) {
      return { device, collector: device.online ? "not-installed" : "offline", agents: [], snapshots: [] };
    }

    const visibleAgents = [
      ...probe.agents,
      ...[defaultQueenAgent(probe.device, probe.agents, probe.capabilities)].filter((agent): agent is AgentProfile => Boolean(agent)),
    ];
    if (!includeSnapshots) {
      return {
        device: probe.device,
        collector: "ready",
        collectorHost: probe.collectorHost,
        machineId: probe.machineId,
        version: probe.version,
        capabilities: probe.capabilities,
        envSync: probe.envSync,
        agents: visibleAgents,
        snapshots: [],
      };
    }

    try {
      const snapshotData = await fetchJson(`${probe.device.collectorUrl}/snapshot`, options.snapshotTimeoutMs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: probe.agents }),
      }) as { snapshots?: unknown[] };
      return {
        device: probe.device,
        collector: "ready",
        collectorHost: probe.collectorHost,
        machineId: probe.machineId,
        version: probe.version,
        capabilities: probe.capabilities,
        envSync: probe.envSync,
        agents: visibleAgents,
        snapshots: snapshotData.snapshots ?? [],
      };
    } catch {
      return {
        device: probe.device,
        collector: "ready",
        collectorHost: probe.collectorHost,
        machineId: probe.machineId,
        version: probe.version,
        capabilities: probe.capabilities,
        envSync: probe.envSync,
        agents: visibleAgents,
        snapshots: [],
      };
    }
  }));
  const machines = dedupeMachines(discovered);

  return {
    ok: true,
    source: fleetStatus.source,
    hivemindLink: fleetStatus.link ? {
      ok: fleetStatus.link.ok === true,
      backendState: fleetStatus.link.backendState,
      authUrl: fleetStatus.link.authUrl,
      magicDnsSuffix: fleetStatus.link.magicDnsSuffix,
    } : undefined,
    machines,
  };
}

function shouldAllowSshFallback(request: Request) {
  const value = new URL(request.url).searchParams.get("sshFallback")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || process.env.HIVEMIND_FLEET_SSH_FALLBACK === "1";
}

function foregroundProbeOptions(includeSnapshots: boolean, allowSshFallback = false): DiscoveryProbeOptions {
  return {
    collectorTimeoutMs: FOREGROUND_COLLECTOR_FETCH_TIMEOUT_MS,
    snapshotTimeoutMs: includeSnapshots ? SNAPSHOT_FETCH_TIMEOUT_MS : FOREGROUND_COLLECTOR_FETCH_TIMEOUT_MS,
    allowSshFallback,
  };
}

function backgroundProbeOptions(allowSshFallback = false): DiscoveryProbeOptions {
  return {
    collectorTimeoutMs: BACKGROUND_COLLECTOR_FETCH_TIMEOUT_MS,
    snapshotTimeoutMs: BACKGROUND_COLLECTOR_FETCH_TIMEOUT_MS,
    allowSshFallback,
  };
}

function refreshDiscovery(
  cacheKey: string,
  includeSnapshots: boolean,
  options: DiscoveryProbeOptions,
  inFlightMap: Map<string, Promise<FleetDiscoverPayload>>,
) {
  let inFlight = inFlightMap.get(cacheKey);
  if (!inFlight) {
    const previousPayload = discoveryCache.get(cacheKey)?.payload;
    inFlight = withTimeout(readDiscovery(includeSnapshots, options), DISCOVERY_REQUEST_TIMEOUT_MS)
      .then((payload) => {
        const stablePayload = stabilizeDiscoveryPayload(payload, previousPayload);
        discoveryCache.set(cacheKey, { checkedAt: Date.now(), payload: stablePayload });
        return stablePayload;
      })
      .finally(() => {
        inFlightMap.delete(cacheKey);
      });
    inFlightMap.set(cacheKey, inFlight);
  }
  return inFlight;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Fleet discovery timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function refreshDiscoveryInBackground(cacheKey: string, includeSnapshots: boolean, allowSshFallback: boolean) {
  void refreshDiscovery(cacheKey, includeSnapshots, backgroundProbeOptions(allowSshFallback), discoveryBackgroundInFlight)
    .catch(() => undefined);
}

export async function GET(request: Request) {
  const includeSnapshots = shouldIncludeSnapshots(request);
  const forceFresh = shouldForceFresh(request);
  const allowSshFallback = shouldAllowSshFallback(request);
  const cacheKey = `${DISCOVERY_CACHE_VERSION}:${includeSnapshots ? "with-snapshots" : "light"}`;
  const cached = discoveryCache.get(cacheKey);
  const now = Date.now();
  if (!forceFresh && cached && now - cached.checkedAt < DISCOVERY_CACHE_MS) {
    return Response.json(cached.payload);
  }

  if (cached) {
    try {
      const payload = await refreshDiscovery(cacheKey, includeSnapshots, foregroundProbeOptions(includeSnapshots, allowSshFallback), discoveryInFlight);
      refreshDiscoveryInBackground(cacheKey, includeSnapshots, allowSshFallback);
      return Response.json(payload);
    } catch {
      refreshDiscoveryInBackground(cacheKey, includeSnapshots, allowSshFallback);
      return Response.json(cached.payload);
    }
  }

  const payload = await refreshDiscovery(cacheKey, includeSnapshots, foregroundProbeOptions(includeSnapshots, allowSshFallback), discoveryInFlight);
  refreshDiscoveryInBackground(cacheKey, includeSnapshots, allowSshFallback);
  return Response.json(payload);
}

function machineScore(machine: {
  device: Device;
  collector: string;
  machineId?: string;
  agents: AgentProfile[];
  version?: CollectorVersion;
  capabilities?: CollectorCapabilities;
}) {
  return (machine.device.self ? 10_000 : 0)
    + (machine.capabilities?.hostedApps ? 20_000 : 0)
    + (machine.collector === "ready" ? 1_000 : 0)
    + (machine.version?.appDir?.replace(/\/+$/, "").endsWith("/hivemindos") ? 100 : 0)
    + (machine.agents.length * 10)
    + deviceFreshnessScore(machine.device);
}

function dedupeMachines<T extends { device: Device; collector: string; machineId?: string; agents: AgentProfile[]; version?: CollectorVersion; capabilities?: CollectorCapabilities }>(machines: T[]) {
  const readyMachineBases = new Set(machines
    .filter((machine) => machine.collector === "ready")
    .flatMap(machineBaseCandidates));
  const byIdentity = new Map<string, T>();
  for (const machine of machines) {
    if (hasFreshReadyDuplicate(machine, readyMachineBases)) continue;
    const key = machineIdentityKey(machine);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, machine);
      continue;
    }
    const preferred = machineScore(machine) > machineScore(previous) ? machine : previous;
    const agents = [...previous.agents, ...machine.agents]
      .filter((agent, index, all) => all.findIndex((item) => item.id === agent.id) === index);
    byIdentity.set(key, { ...preferred, agents });
  }
  return [...byIdentity.values()];
}

function machineBaseCandidates(machine: { device: Device }) {
  return [
    deviceIdentityKey(machine.device),
    hivemindMachineBase(machine.device),
    physicalMachineBase(machine.device),
  ].filter((value, index, all) => value && all.indexOf(value) === index);
}

function hasFreshReadyDuplicate(machine: { device: Device; collector: string }, readyMachineBases: Set<string>) {
  if (machine.collector === "ready") return false;
  return machineBaseCandidates(machine).some((base) => readyMachineBases.has(base));
}

function shouldKeepPreviousReadyMachine(current: DiscoveredMachine, previous: DiscoveredMachine) {
  return current.collector !== "ready"
    && current.agents.length === 0
    && previous.collector === "ready"
    && previous.agents.length > 0;
}

function stabilizeDiscoveryPayload(payload: FleetDiscoverPayload, previous?: FleetDiscoverPayload) {
  if (!previous) return payload;

  const previousReadyByKey = new Map<string, DiscoveredMachine>();
  for (const machine of previous.machines) {
    if (machine.collector !== "ready" || machine.agents.length === 0) continue;
    for (const key of machineBaseCandidates(machine)) previousReadyByKey.set(key, machine);
  }

  if (previousReadyByKey.size === 0) return payload;

  const machines = payload.machines.map((machine) => {
    const previousReady = machineBaseCandidates(machine)
      .map((key) => previousReadyByKey.get(key))
      .find((candidate): candidate is DiscoveredMachine => Boolean(candidate));
    return previousReady && shouldKeepPreviousReadyMachine(machine, previousReady) ? previousReady : machine;
  });

  return { ...payload, machines: dedupeMachines(machines) };
}
