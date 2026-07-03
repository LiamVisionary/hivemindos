import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

export type ConnectedHostedApp = {
  id?: string;
  name?: string;
  description?: string;
  machineName?: string;
  port?: number;
  apiBaseUrl?: string;
  serviceKind?: string;
  apiRoutes?: Array<{ method?: string; path?: string; summary?: string; category?: string }>;
};

type FleetMachine = {
  collector?: string;
  collectorHost?: string;
  device?: {
    self?: boolean;
    name?: string;
    dnsName?: string;
    ip?: string;
    collectorUrl?: string;
  };
};

type CollectorApp = {
  id?: string;
  name?: string;
  description?: string;
  scheme?: string;
  port?: number;
  path?: string;
  proxyUrl?: string;
  apiProxyUrl?: string;
  apiBaseUrl?: string;
  serviceKind?: string;
  healthPath?: string;
  apiRoutes?: Array<{ method?: string; path?: string; summary?: string; category?: string }>;
};

const RAW_DISCOVERY_TIMEOUT_MS = 12_000;
const LINK_PEER_DISCOVERY_TIMEOUT_MS = 2_000;
const LINK_PEER_COLLECTOR_PORTS = [8789, 8787, 8792];

type LinkPeer = {
  HostName?: string;
  DNSName?: string;
  Online?: boolean;
  TailscaleIPs?: string[];
};

type LinkStatus = {
  ok?: boolean;
  peer?: Record<string, LinkPeer>;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function normalizePath(value?: string) {
  const path = value?.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function collectorAppsUrl(collectorUrl: string, refresh: boolean) {
  return `${collectorUrl.replace(/\/+$/, "")}/apps${refresh ? "?refresh=1" : ""}`;
}

function dnsHost(value?: string) {
  return value?.trim().replace(/\.$/, "") || "";
}

function machineOpenHost(machine: FleetMachine) {
  if (machine.device?.self) return "localhost";
  return dnsHost(machine.device?.dnsName) || machine.collectorHost || machine.device?.ip || "";
}

function normalizeMachineName(value: string) {
  return value
    .replace(/^hivemindos-/i, "")
    .replace(/-local-\d+$/i, "")
    .replace(/-local$/i, "")
    .replace(/-\d+$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || value;
}

function rewriteCollectorUrl(rawUrl: string | undefined, collectorUrl: string) {
  if (!rawUrl || !collectorUrl) return "";
  try {
    const raw = new URL(rawUrl);
    const collector = new URL(collectorUrl);
    raw.protocol = collector.protocol;
    raw.host = collector.host;
    const collectorPrefix = collector.pathname.replace(/\/+$/, "");
    if (collectorPrefix && collectorPrefix !== "/" && raw.pathname.startsWith("/")) {
      raw.pathname = `${collectorPrefix}${raw.pathname}`;
    }
    return raw.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function directServiceBase(app: CollectorApp, machine: FleetMachine) {
  const scheme = app.scheme === "https" ? "https" : "http";
  const port = Number(app.port);
  const host = machineOpenHost(machine);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return "";
  return `${scheme}://${host}:${port}`;
}

function appName(app: CollectorApp, port: number) {
  return clean(app.name) || `App ${port}`;
}

async function fetchJson<T>(url: string, timeoutMs = RAW_DISCOVERY_TIMEOUT_MS, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function ipv4(value?: string) {
  const text = value?.trim() || "";
  return /^\d+\.\d+\.\d+\.\d+$/.test(text) ? text : "";
}

function linkPeerIps(status: LinkStatus | null) {
  return [...new Set(Object.values(status?.peer ?? {})
    .filter((peer) => peer?.Online)
    .flatMap((peer) => peer.TailscaleIPs ?? [])
    .map(ipv4)
    .filter(Boolean))];
}

function linkPeerName(status: LinkStatus | null, ip: string) {
  const peer = Object.values(status?.peer ?? {}).find((item) => (item.TailscaleIPs ?? []).includes(ip));
  return dnsHost(peer?.DNSName).split(".")[0] || peer?.HostName || `Hivenet app host ${ip}`;
}

async function discoverLinkPeerApps(): Promise<ConnectedHostedApp[]> {
  const linkBase = hivemindLinkControlUrl();
  const status = await fetchJson<LinkStatus>(`${linkBase}/status`, LINK_PEER_DISCOVERY_TIMEOUT_MS).catch(() => null);
  const probes = linkPeerIps(status).flatMap((ip) => LINK_PEER_COLLECTOR_PORTS.map(async (port) => {
    const collectorUrl = `${linkBase}/peer/${encodeURIComponent(`${ip}:${port}`)}`;
    const payload = await fetchJson<{ apps?: CollectorApp[] }>(collectorAppsUrl(collectorUrl, true), LINK_PEER_DISCOVERY_TIMEOUT_MS).catch(() => null);
    const apps = payload?.apps ?? [];
    if (!apps.length) return [];
    const machine: FleetMachine = {
      collector: "ready",
      collectorHost: ip,
      device: {
        self: false,
        name: linkPeerName(status, ip),
        ip,
        collectorUrl,
      },
    };
    return apps.flatMap((app) => {
      const hosted = rawHostedApp(app, machine, collectorUrl);
      return hosted ? [hosted] : [];
    });
  }));
  return (await Promise.all(probes)).flat();
}

function rawHostedApp(app: CollectorApp, machine: FleetMachine, collectorUrl: string): ConnectedHostedApp | null {
  const port = Number(app.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const machineName = normalizeMachineName(machine.device?.name || machine.collectorHost || machine.device?.ip || "Unknown machine");
  const host = machineOpenHost(machine);
  const name = appName(app, port);
  const apiBaseUrl = rewriteCollectorUrl(app.apiProxyUrl, collectorUrl)
    || rewriteCollectorUrl(app.proxyUrl, collectorUrl)
    || normalizeBaseUrl(app.apiBaseUrl)
    || directServiceBase(app, machine);
  if (!apiBaseUrl) return null;
  return {
    id: `${machine.device?.self ? "local" : host}:${port}:${app.id || name}`,
    name,
    description: clean(app.description) || "Connected app service",
    machineName,
    port,
    apiBaseUrl: `${apiBaseUrl}${app.apiProxyUrl || app.proxyUrl || app.apiBaseUrl ? "" : normalizePath(app.path)}`.replace(/\/+$/, ""),
    serviceKind: clean(app.serviceKind) || undefined,
    apiRoutes: Array.isArray(app.apiRoutes) ? app.apiRoutes : undefined,
  };
}

export async function discoverRawConnectedApps(origin: string, options?: {
  selfOnly?: boolean;
  timeoutMs?: number;
  /**
   * Known machine host (dns name) to query DIRECTLY instead of running the
   * fleet-wide discovery sweep. A full `fresh=1` fleet discovery measured
   * ~10s; when the caller already knows which machine hosts the app (encoded
   * in the connected-app id), probing that machine's collector ports costs
   * ~0.5-1.5s. Falls out naturally when the host is stale: no apps come back
   * and the caller retries without the hint.
   */
  directHost?: string;
  /**
   * Ask collectors for their cached app list instead of a refresh rescan.
   * Resolving a KNOWN app id doesn't need a rescan, and the rescan is the
   * slow part of a collector /apps call (measured ~3.7s vs sub-second).
   */
  cachedAppsOnly?: boolean;
}): Promise<ConnectedHostedApp[]> {
  const fleetUrl = new URL("/api/fleet/discover?includeSnapshots=0&fresh=1", origin);
  const directHost = options?.directHost?.trim().replace(/\.$/, "") || "";
  const fleet = options?.selfOnly || directHost
    ? { machines: [] }
    // Self-fetch of our own /api/fleet/discover: needs the server's device
    // token since the API auth gate moved to src/proxy.ts. Collector fetches
    // stay tokenless — the device token must not leak to non-dashboard hosts.
    : await fetchJson<{ machines?: FleetMachine[] }>(fleetUrl.toString(), options?.timeoutMs ?? RAW_DISCOVERY_TIMEOUT_MS, internalApiAuthHeaders()).catch(() => ({ machines: [] }));
  const selfCollector: FleetMachine = {
    collector: "ready",
    collectorHost: "localhost",
    device: {
      self: true,
      name: "This Mac",
      collectorUrl: "http://127.0.0.1:8787",
    },
  };
  const fetchMachineApps = async (machine: FleetMachine): Promise<ConnectedHostedApp[]> => {
    const collectorUrl = normalizeBaseUrl(machine.device?.collectorUrl);
    if (machine.collector !== "ready" || !collectorUrl) return [];
    try {
      const payload = await fetchJson<{ apps?: CollectorApp[] }>(
        collectorAppsUrl(collectorUrl, !options?.cachedAppsOnly),
        options?.timeoutMs ?? RAW_DISCOVERY_TIMEOUT_MS,
      );
      return (payload.apps ?? []).flatMap((app) => {
        const hosted = rawHostedApp(app, machine, collectorUrl);
        return hosted ? [hosted] : [];
      });
    } catch {
      return [];
    }
  };
  if (directHost && !options?.selfOnly) {
    // Race the port variants of the one known machine: the first collector
    // that answers with apps wins; dead ports must not gate the result on
    // their timeouts.
    const directMachines: FleetMachine[] = LINK_PEER_COLLECTOR_PORTS.map((port) => ({
      collector: "ready",
      collectorHost: directHost,
      device: {
        name: directHost.split(".")[0] || directHost,
        dnsName: directHost,
        collectorUrl: `http://${directHost}:${port}`,
      },
    }));
    return await Promise.any(directMachines.map(async (machine) => {
      const apps = await fetchMachineApps(machine);
      if (!apps.length) throw new Error(`No apps from ${machine.device?.collectorUrl}.`);
      return apps;
    })).catch(() => []);
  }
  const machines = [
    selfCollector,
    ...(options?.selfOnly ? [] : (fleet.machines ?? []).filter((machine) => normalizeBaseUrl(machine.device?.collectorUrl) !== selfCollector.device?.collectorUrl)),
  ];
  const appGroups = await Promise.all(machines.map(fetchMachineApps));
  const linkPeerApps = options?.selfOnly ? [] : await discoverLinkPeerApps().catch(() => []);
  const byId = new Map<string, ConnectedHostedApp>();
  for (const app of [...appGroups.flat(), ...linkPeerApps]) {
    if (app.id && !byId.has(app.id)) byId.set(app.id, app);
  }
  return [...byId.values()];
}
