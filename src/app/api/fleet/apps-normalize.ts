// Cross-machine app URLs must ride the peer's linkd tailnet door, pinned
// :8787 fleet-wide (2026-07-03 linkd audit). Collectors bind localhost and
// are only reachable through linkd, so a URL carrying a peer's local
// collector port (e.g. :8792) is dead from every other machine.
export const HIVEMIND_LINK_TAILNET_PORT = 8787;

const APP_PROXY_PATH_PATTERN = /\/app-proxy\/\d+(?:\/|$)/;
const PEER_PORTAL_PATH_PATTERN = /^\/peer\/([^/]+)(\/.*)?$/;
const HOST_PORT_PATTERN = /^([^\s:/]+):(\d+)$/;

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

// `http://127.0.0.1:8788/peer/<host%3Aport>/…` portal URLs resolve only
// through the linkd control port of the machine that composed them. API
// consumers fleet-wide (health watchdogs, phone TTS, other dashboards) need
// the peer's own tailnet door instead: `http://<host>:<port>/…`.
export function peerPortalToTailnetUrl(rawUrl: string | undefined) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    const portalMatch = url.pathname.match(PEER_PORTAL_PATH_PATTERN);
    if (!portalMatch) return rawUrl;
    const hostPort = decodeURIComponent(portalMatch[1] ?? "");
    if (!HOST_PORT_PATTERN.test(hostPort)) return rawUrl;
    return `http://${hostPort}${portalMatch[2] ?? ""}${url.search}`;
  } catch {
    return rawUrl;
  }
}

// Heal a cached cross-machine app-proxy URL minted before the tailnet door
// was pinned: rewrite the port (or the /peer/<host:port> identity) to :8787.
// Loopback hosts are the composing machine's own collector — its local port
// is correct and stays untouched.
export function pinPeerAppProxyUrl(rawUrl: string | undefined) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    const portalMatch = url.pathname.match(PEER_PORTAL_PATH_PATTERN);
    if (portalMatch) {
      const hostMatch = decodeURIComponent(portalMatch[1] ?? "").match(HOST_PORT_PATTERN);
      if (!hostMatch || Number(hostMatch[2]) === HIVEMIND_LINK_TAILNET_PORT) return rawUrl;
      if (!APP_PROXY_PATH_PATTERN.test(portalMatch[2] ?? "")) return rawUrl;
      url.pathname = `/peer/${encodeURIComponent(`${hostMatch[1]}:${HIVEMIND_LINK_TAILNET_PORT}`)}${portalMatch[2] ?? ""}`;
      return url.toString();
    }
    if (isLoopbackHost(url.hostname) || !APP_PROXY_PATH_PATTERN.test(url.pathname)) return rawUrl;
    if (!url.port || url.port === String(HIVEMIND_LINK_TAILNET_PORT)) return rawUrl;
    url.port = String(HIVEMIND_LINK_TAILNET_PORT);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export type NormalizedHostedApp = {
  id: string;
  name: string;
  sourceName?: string;
  iconUrl?: string;
  machineName: string;
  machineHost: string;
  local: boolean;
  interactive?: boolean;
  serviceKind?: string;
  port: number;
  openUrl: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  apiRoutes?: unknown[];
};

export type NormalizedAppsPayload<TApp extends NormalizedHostedApp> = {
  apps: TApp[];
  machines: Array<{
    name: string;
    collector: string;
    appCount: number;
    error?: string;
  }>;
};

function sortHostedApps<TApp extends NormalizedHostedApp>(apps: TApp[]) {
  return apps.sort((left, right) => Number(right.local) - Number(left.local) || left.machineName.localeCompare(right.machineName) || left.port - right.port);
}

function proxiedServiceKey(app: NormalizedHostedApp) {
  for (const rawUrl of [app.healthUrl, app.apiBaseUrl, app.openUrl]) {
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl);
      const peerMatch = url.pathname.match(/\/peer\/([^/]+)\/app-proxy\/(\d+)(?:\/|$)/);
      if (peerMatch) {
        const peer = decodeURIComponent(peerMatch[1] ?? "").split(":")[0];
        if (peer) return `${peer}:${peerMatch[2]}`;
      }
      const match = url.pathname.match(/\/app-proxy\/(\d+)(?:\/|$)/);
      if (match) return `${app.machineHost.toLowerCase() || url.hostname}:${match[1]}`;
    } catch {
      continue;
    }
  }
  return "";
}

function visibleAppKey(app: NormalizedHostedApp) {
  return proxiedServiceKey(app) || `${app.machineHost.toLowerCase() || app.machineName.toLowerCase()}:${app.port}`;
}

function sourceInstanceKey(app: NormalizedHostedApp) {
  const idMatch = app.id.match(/:(\d+):([^:]+)$/);
  return idMatch ? `${idMatch[1]}:${idMatch[2]}` : "";
}

function normalizedAppName(app: NormalizedHostedApp) {
  return app.name.trim().toLowerCase();
}

function isGenericApiApp(app: NormalizedHostedApp) {
  const name = normalizedAppName(app);
  return /^(?:node|python(?:3(?:\.\d+)?)?|docker-pr|container|cloudflar|cloudflare|ssh|tailscale|syncthing|nginx|megasync|discord|controlce)(?: api)?$/.test(name)
    || /^welcome to nginx!?$/.test(name);
}

function isInfrastructureApp(app: NormalizedHostedApp) {
  const name = normalizedAppName(app);
  const text = `${name} ${app.sourceName ?? ""}`.toLowerCase();
  return name === "hivemind-linkd"
    || name === "tailscale api"
    || name === "syncthing api"
    || name === "ssh api"
    || /^welcome to nginx!?$/.test(name)
    || /\b(?:cloudflar|cloudflare|container)\b/.test(text);
}

function isSpecificServiceApp(app: NormalizedHostedApp) {
  const serviceKind = app.serviceKind?.trim().toLowerCase();
  if (serviceKind && serviceKind !== "api") return true;
  return !isGenericApiApp(app) && !isInfrastructureApp(app);
}

function displayAppKey(app: NormalizedHostedApp) {
  const name = normalizedAppName(app);
  if (name === "hivemindos") return name;
  if (isGenericApiApp(app) || isInfrastructureApp(app)) return "";
  return name;
}

function isGenericFallbackMachineName(name: string) {
  return /^hivenet app host\b/i.test(name.trim());
}

function machineAliasKey(name: string) {
  return name.trim().toLowerCase().replace(/^hivemindos[-\s]*/i, "").replace(/[^a-z0-9]+/g, "");
}

function machineAliasesMatch(left: string, right: string) {
  const leftAlias = machineAliasKey(left);
  const rightAlias = machineAliasKey(right);
  return Boolean(leftAlias && rightAlias && (leftAlias.startsWith(rightAlias) || rightAlias.startsWith(leftAlias)));
}

function appCountForMachineName(name: string, appCounts: Map<string, number>) {
  const exact = appCounts.get(name);
  if (typeof exact === "number") return exact;
  const alias = machineAliasKey(name);
  if (!alias) return undefined;
  let count = 0;
  for (const [appMachineName, appCount] of appCounts) {
    const appAlias = machineAliasKey(appMachineName);
    if (appAlias && (alias.startsWith(appAlias) || appAlias.startsWith(alias))) count += appCount;
  }
  return count > 0 ? count : undefined;
}

function nicerMachineName(left: string, right: string) {
  if (isGenericFallbackMachineName(left)) return right;
  if (isGenericFallbackMachineName(right)) return left;
  if (/^hivemindos[-\s]/i.test(left) && !/^hivemindos[-\s]/i.test(right)) return right;
  if (/^hivemindos[-\s]/i.test(right) && !/^hivemindos[-\s]/i.test(left)) return left;
  return left.length <= right.length ? left : right;
}

function collapseMachineRows<TPayload extends NormalizedAppsPayload<NormalizedHostedApp>>(machines: TPayload["machines"]) {
  const collapsed: TPayload["machines"] = [];
  for (const machine of machines) {
    const existingIndex = collapsed.findIndex((item) => machineAliasesMatch(item.name, machine.name));
    if (existingIndex < 0) {
      collapsed.push(machine);
      continue;
    }
    const existing = collapsed[existingIndex];
    const appCount = Math.max(existing.appCount, machine.appCount);
    collapsed[existingIndex] = {
      name: nicerMachineName(existing.name, machine.name),
      collector: existing.collector === "ready" || machine.collector === "ready" ? "ready" : existing.collector === "app-cache" ? machine.collector : existing.collector,
      appCount,
      error: appCount > 0 ? undefined : existing.error || machine.error,
    };
  }
  return collapsed;
}

export function dedupeVisibleApps<TApp extends NormalizedHostedApp>(apps: TApp[]) {
  const byEndpoint = new Map<string, TApp>();
  const score = (app: TApp) => (
    (/gateway/i.test(app.sourceName || "") ? -100 : 0)
    + (isSpecificServiceApp(app) ? 40 : 0)
    + (app.serviceKind && app.serviceKind !== "api" ? 30 : 0)
    + (app.sourceName?.trim().toLowerCase() === app.name.trim().toLowerCase() ? 20 : 0)
    + (app.iconUrl ? 10 : 0)
    + ((app.apiRoutes?.length ?? 0) > 0 ? 8 : 0)
    + (app.interactive ? 4 : 0)
    + (isGenericFallbackMachineName(app.machineName) ? -6 : 0)
    + (app.local ? 2 : 0)
  );
  const iconScore = (app: TApp) => (app.iconUrl ? 10 : 0) + (/gateway/i.test(app.sourceName || "") ? 30 : 0);
  for (const app of apps) {
    const key = visibleAppKey(app);
    const previous = byEndpoint.get(key);
    if (!previous || score(app) > score(previous) || (score(app) === score(previous) && app.openUrl.length < previous.openUrl.length)) {
      const iconSource = previous && iconScore(previous) > iconScore(app) ? previous : app;
      byEndpoint.set(key, { ...app, iconUrl: iconSource.iconUrl || app.iconUrl });
      continue;
    }
    if (iconScore(app) > iconScore(previous)) byEndpoint.set(key, { ...previous, iconUrl: app.iconUrl || previous.iconUrl });
  }
  const bySourceInstance = new Map<string, TApp>();
  for (const app of byEndpoint.values()) {
    const key = sourceInstanceKey(app) || app.id;
    const previous = bySourceInstance.get(key);
    if (!previous || score(app) > score(previous) || (score(app) === score(previous) && app.openUrl.length < previous.openUrl.length)) {
      bySourceInstance.set(key, app);
    }
  }
  const launchableApps = [...bySourceInstance.values()].filter((app) => !isInfrastructureApp(app) && (!isGenericApiApp(app) || app.name.toLowerCase() === "hivemindos"));
  const byDisplayApp = new Map<string, TApp>();
  for (const app of launchableApps) {
    const key = displayAppKey(app);
    if (!key) continue;
    const previous = byDisplayApp.get(key);
    if (!previous || score(app) > score(previous) || (score(app) === score(previous) && app.openUrl.length < previous.openUrl.length)) {
      byDisplayApp.set(key, app);
    }
  }
  const byId = new Map<string, TApp>();
  for (const app of byDisplayApp.values()) {
    const previous = byId.get(app.id);
    if (!previous || score(app) > score(previous) || (score(app) === score(previous) && app.openUrl.length < previous.openUrl.length)) {
      byId.set(app.id, app);
    }
  }
  return [...byId.values()];
}

export function normalizeAppsPayload<TPayload extends NormalizedAppsPayload<NormalizedHostedApp>>(payload: TPayload): TPayload {
  const apps = sortHostedApps(dedupeVisibleApps(payload.apps));
  const appCounts = new Map<string, number>();
  for (const app of apps) appCounts.set(app.machineName, (appCounts.get(app.machineName) ?? 0) + 1);
  const machines = payload.machines
    .map((machine) => ({
      ...machine,
      appCount: appCountForMachineName(machine.name, appCounts) ?? (isGenericFallbackMachineName(machine.name) ? 0 : machine.appCount),
    }))
    .filter((machine) => machine.appCount > 0 || machine.collector === "ready" || machine.collector === "native-local" || Boolean(machine.error));
  for (const [machineName, appCount] of appCounts) {
    if (!machines.some((machine) => machineAliasesMatch(machine.name, machineName))) machines.push({ name: machineName, collector: "app-cache", appCount });
  }
  return { ...payload, apps, machines: collapseMachineRows(machines) } as TPayload;
}
