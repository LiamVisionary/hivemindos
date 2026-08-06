"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppsView, type FoundryCatalogApp, type FoundryHost, type FoundryHostedApp, type FoundryRunningTask, type FoundryServiceActionResult, type FoundrySummary, type InstallableServiceAction } from "@/components/apps";
import { AGENT_APP_CATALOG } from "@/features/dashboard/agent-capability-catalog";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { AgentReachSetupWizard } from "@/features/dashboard/views/AgentReachSetupWizard";
import { AppPreferencesCard, matchAppPreference, type AppPreferenceRecord } from "@/features/dashboard/views/AppPreferencesCard";
import { useFrTheme } from "@/components/fleet-hive/use-fr-theme";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { getNativeFleetAppsCache } from "@/lib/native/fleet";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type ApiServiceRoute = {
  method: string;
  path: string;
  url: string;
  category: string;
  summary?: string;
  source?: "openapi" | "hivemind";
};

type RunningServiceTask = FoundryRunningTask;

type HostedApp = {
  id: string;
  name: string;
  description: string;
  kind: "ai" | "creative" | "code" | "dashboard" | "media" | "service" | "app";
  theme: string;
  initials: string;
  iconUrl?: string;
  sourceName?: string;
  machineName: string;
  machineHost: string;
  local: boolean;
  online: boolean;
  interactive: boolean;
  serviceKind?: string;
  scheme: string;
  port: number;
  openUrl: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  apiRoutes?: ApiServiceRoute[];
  apiRoutesSource?: "openapi" | "hivemind";
  runningTasks?: RunningServiceTask[];
};

type FleetAppsPayload = {
  ok?: boolean;
  checkedAt?: string;
  source?: string;
  apps?: HostedApp[];
  machines?: Array<{
    name: string;
    collector: string;
    appCount: number;
    error?: string;
  }>;
  error?: string;
};

type InstallableServiceStatus = {
  id: "n8n" | "listmonk" | "browser-use" | "agentic-inbox" | "mcp-email-server" | "openhands" | "aider" | "agent-reach" | "palmier-pro" | "hivemind-office" | "copy-trading-daemon";
  name: string;
  installed: boolean;
  running: boolean;
  version?: string;
  openUrl?: string;
  detail: string;
  installMethod: "docker" | "uv" | "uv-tool" | "pipx" | "cloudflare-worker" | "dmg" | "local-service";
  requirements: string[];
  sourceUrl: string;
  provenance?: {
    packageName: string;
    packageManager: string;
    installCommand: string;
    updatePolicy: string;
  };
  securityNotes?: string[];
  permissions?: {
    fullAccess: boolean;
    label: string;
    detail: string;
    approvedAt?: string;
  };
  projectDir?: string;
  preflight?: Array<{ key: string; ok: boolean; detail: string; blocking?: boolean }>;
  preflightActions?: Array<{
    action: InstallableServiceAction;
    label: string;
    detail: string;
    disabled?: boolean;
  }>;
};

type MyAppsPanelProps = {
  activeView: DashboardView;
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
};

type AgentReachActionInput = {
  profileUrl?: string;
  maxPosts?: number;
  maxReplies?: number;
};

const ACCENTS = ["#e7b45c", "#6fcdba", "#6f9bd6", "#e58e85", "#9b8cf0", "#7fb98f", "#d89f6b"];
const LOCAL_HIVEMIND_LINK_URL = "http://127.0.0.1:8788";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function monoFor(name: string) {
  const parts = name.trim().split(/[^a-z0-9]+/i).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return (parts[0] ?? name).slice(0, 2).toUpperCase() || "A";
}

function accentFor(id: string) {
  return ACCENTS[hashString(id) % ACCENTS.length];
}

function localHivemindLinkAppProxyUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const alreadyLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (alreadyLocal || !url.pathname.startsWith("/app-proxy/")) return rawUrl;
    return `${LOCAL_HIVEMIND_LINK_URL}/peer/${encodeURIComponent(url.host)}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

function appLaunchUrl(app: HostedApp) {
  const openUrl = isTauriDesktopRuntime() ? localHivemindLinkAppProxyUrl(app.openUrl) : app.openUrl;
  if (!/z-image/i.test(app.name)) return openUrl;
  try {
    const url = new URL(openUrl);
    if (!url.searchParams.get("api")) url.searchParams.set("api", url.toString().replace(/\/$/, ""));
    return url.toString();
  } catch {
    return openUrl;
  }
}

function isInstallOnlyCliService(service: InstallableServiceStatus | undefined) {
  return service?.installMethod === "uv-tool" || service?.installMethod === "pipx";
}

function installableServiceAction(serviceId: string, service: InstallableServiceStatus | undefined): InstallableServiceAction {
  if (serviceId === "agentic-inbox") return service?.installed ? "start" : "install";
  if (isInstallOnlyCliService(service)) return "install";
  return service?.running ? "stop" : service?.installed ? "start" : "install";
}

function installableServiceLabel(id: string, action: InstallableServiceAction, service?: InstallableServiceStatus) {
  const preflightAction = service?.preflightActions?.find((item) => item.action === action);
  if (preflightAction) return preflightAction.label;
  if (action === "status") return "Refresh";
  if (action === "install-pipx") return "Install pipx";
  if (action === "install-agent-reach-x") return "Enable X search";
  if (action === "check-agent-reach-x-auth") return "Check X auth";
  if (action === "agent-reach-doctor") return "Refresh channels";
  if (action === "test-agent-reach-x-profile") return "Test X profile";
  if (action === "reset-agent-reach-x") return "Reset X setup";
  if (isInstallOnlyCliService(service) && service?.installed) return "Installed";
  if (id === "agentic-inbox") return action === "install" ? "Setup" : action === "start" ? "Deploy" : "Disable";
  if (id === "browser-use") return action === "install" ? "Install" : action === "start" ? "Open" : "Close";
  if (id === "hivemind-office") return action === "install" ? "Install blocked" : action === "start" ? "Open" : "Quit";
  if (id === "palmier-pro") return action === "install" ? "Install" : action === "start" ? "Open" : "Quit";
  return action === "install" ? "Install" : action === "start" ? "Start" : "Stop";
}

function installableServiceBlocked(service: InstallableServiceStatus | undefined, action: InstallableServiceAction) {
  if (!service) return false;
  if (action === "install-pipx") return false;
  if (
    action === "install-agent-reach-x" ||
    action === "check-agent-reach-x-auth" ||
    action === "agent-reach-doctor" ||
    action === "test-agent-reach-x-profile" ||
    action === "reset-agent-reach-x"
  ) return false;
  if (isInstallOnlyCliService(service) && service.installed) return true;
  if (service.id === "hivemind-office" && action === "install") return true;
  if (action === "install" && /required before|is required before|is required to install/i.test(service.detail)) return true;
  // Only the core scaffold/wrangler/auth checks block Deploy; domain/routing/R2
  // are readiness hints (blocking: false) that are resolved during/after deploy.
  if (service.id === "agentic-inbox" && action === "start") return Boolean(service.preflight?.some((item) => item.blocking !== false && !item.ok));
  return false;
}

async function confirmSensitiveInstallableServiceAction(action: InstallableServiceAction) {
  if (action === "check-agent-reach-x-auth") {
    return confirmUserAction([
      "Agent Reach will run twitter-cli's X auth check now.",
      "It first looks for TWITTER_AUTH_TOKEN and TWITTER_CT0. If those are absent, macOS may show a Keychain prompt so twitter-cli can use local browser cookies for X/Twitter.",
      "Continue only if you want Agent Reach to use this authenticated X session.",
    ].join("\n\n"));
  }
  if (action === "reset-agent-reach-x") {
    return confirmUserAction([
      "Reset the optional Agent Reach X setup?",
      "This uninstalls the HivemindOS-managed twitter-cli backend. It does not delete Chrome cookies, revoke macOS Keychain decisions, or remove shared env keys.",
    ].join("\n\n"));
  }
  return true;
}

function friendlyAppsError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/expected pattern|failed to fetch|load failed|network|503|service unavailable|warming up/i.test(message)) {
    return "Could not reach app discovery. Any cached app list will stay on screen while the fleet catches up.";
  }
  return message || "Could not load hosted apps.";
}

function isSparseAppsPayload(payload: FleetAppsPayload | null) {
  const apps = payload?.apps ?? [];
  const readyMachines = payload?.machines?.filter((machine) => machine.collector === "ready").length ?? 0;
  return apps.length <= 1 && readyMachines > 1;
}

async function readFleetAppsResponse(response: Response): Promise<FleetAppsPayload> {
  const text = await response.text();
  let data: FleetAppsPayload;
  try {
    data = JSON.parse(text) as FleetAppsPayload;
  } catch {
    throw new Error(response.ok ? "App discovery returned an unreadable response." : `App discovery returned ${response.status} ${response.statusText}.`);
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function hostedAppScore(app: HostedApp) {
  return (app.iconUrl ? 10 : 0)
    + (isSpecificHostedApp(app) ? 40 : 0)
    + (app.serviceKind && app.serviceKind !== "api" ? 30 : 0)
    + (app.sourceName?.trim().toLowerCase() === app.name.trim().toLowerCase() ? 20 : 0)
    + ((app.apiRoutes?.length ?? 0) > 0 ? 8 : 0)
    + (app.interactive ? 4 : 0)
    + (app.online ? 2 : 0)
    + (app.local ? 1 : 0);
}

function normalizedHostedAppName(app: HostedApp) {
  return app.name.trim().toLowerCase();
}

function isGenericHostedApiApp(app: HostedApp) {
  const name = normalizedHostedAppName(app);
  return /^(?:node|python(?:3(?:\.\d+)?)?|docker-pr|container|cloudflar|cloudflare|ssh|tailscale|syncthing|nginx|megasync|discord|controlce)(?: api)?$/.test(name)
    || /^welcome to nginx!?$/.test(name);
}

function isInfrastructureHostedApp(app: HostedApp) {
  const name = normalizedHostedAppName(app);
  const text = `${name} ${app.sourceName ?? ""}`.toLowerCase();
  return name === "hivemind-linkd"
    || name === "tailscale api"
    || name === "syncthing api"
    || name === "ssh api"
    || /^welcome to nginx!?$/.test(name)
    || /\b(?:cloudflar|cloudflare|container)\b/.test(text);
}

function isSpecificHostedApp(app: HostedApp) {
  const serviceKind = app.serviceKind?.trim().toLowerCase();
  if (serviceKind && serviceKind !== "api") return true;
  return !isGenericHostedApiApp(app) && !isInfrastructureHostedApp(app);
}

function hostedDisplayAppKey(app: HostedApp) {
  const name = normalizedHostedAppName(app);
  if (name === "hivemindos") return name;
  if (isGenericHostedApiApp(app) || isInfrastructureHostedApp(app)) return "";
  return name;
}

function proxiedHostedAppKey(app: HostedApp) {
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

function sourceHostedAppKey(app: HostedApp) {
  const idMatch = app.id.match(/:(\d+):([^:]+)$/);
  return idMatch ? `${idMatch[1]}:${idMatch[2]}` : "";
}

function dedupeByHostedAppKey(apps: HostedApp[], keyForApp: (app: HostedApp) => string) {
  const byKey = new Map<string, HostedApp>();
  for (const app of apps) {
    const key = keyForApp(app) || app.id;
    const previous = byKey.get(key);
    if (
      !previous ||
      hostedAppScore(app) > hostedAppScore(previous) ||
      (hostedAppScore(app) === hostedAppScore(previous) && app.openUrl.length < previous.openUrl.length)
    ) {
      byKey.set(key, app);
    }
  }
  return [...byKey.values()];
}

function dedupeHostedApps(apps: HostedApp[]) {
  const launchableApps = dedupeByHostedAppKey(
    dedupeByHostedAppKey(
      dedupeByHostedAppKey(
        apps.filter((app) => !isInfrastructureHostedApp(app) && (!isGenericHostedApiApp(app) || normalizedHostedAppName(app) === "hivemindos")),
        proxiedHostedAppKey,
      ),
      sourceHostedAppKey,
    ),
    hostedDisplayAppKey,
  );
  return dedupeByHostedAppKey(launchableApps, (app) => app.id);
}

function appMachineKey(name: string) {
  return name.trim().toLowerCase().replace(/^hivemindos[-\s]*/i, "").replace(/[^a-z0-9]+/g, "");
}

function addMachineKey(keys: Set<string>, name: string) {
  const next = appMachineKey(name);
  if (!next) return;
  for (const existing of keys) {
    if (existing.startsWith(next) || next.startsWith(existing)) {
      if (next.length < existing.length) {
        keys.delete(existing);
        keys.add(next);
      }
      return;
    }
  }
  keys.add(next);
}

function serviceIdForAppName(name: string) {
  const normalized = normalizeName(name);
  return AGENT_APP_CATALOG.find((item) => item.installableServiceId && normalizeName(item.name) === normalized)?.installableServiceId;
}

function foundryStateFor(app: HostedApp): FoundryHostedApp["state"] {
  if (app.online) return "running";
  return "stopped";
}

function mapHostedApp(app: HostedApp, services: Record<string, InstallableServiceStatus>): FoundryHostedApp {
  const installableServiceId = serviceIdForAppName(app.name);
  const service = installableServiceId ? services[installableServiceId] : undefined;
  const serviceAction = installableServiceId ? installableServiceAction(installableServiceId, service) : undefined;
  const state = foundryStateFor(app);
  const routeCount = app.apiRoutes?.length ?? 0;
  const logs: Array<[string, string]> = [
    ["source", `${app.sourceName || app.serviceKind || "discovery"} on ${app.machineName}`],
    ["open", app.openUrl],
  ];
  if (routeCount > 0) logs.push(["routes", `${routeCount} API route${routeCount === 1 ? "" : "s"} discovered`]);
  if (service?.detail) logs.push(["service", service.detail]);
  return {
    id: app.id,
    name: app.name,
    mono: app.initials || monoFor(app.name),
    iconUrl: app.iconUrl,
    accent: accentFor(app.id || app.name),
    category: cleanText(app.serviceKind) || (app.interactive ? "App" : "API service"),
    machine: app.local ? "This Mac" : app.machineName,
    machineHost: app.machineHost,
    port: app.port,
    version: service?.version || app.serviceKind || "live",
    state,
    desc: app.description || (app.interactive ? "Connected Tailnet app." : "Connected API-first service."),
    reach: app.local ? "operator" : "tailnet",
    agents: routeCount > 0 ? 1 : 0,
    uptime: state === "running" ? "Live" : "-",
    source: app.sourceName || "discovered",
    logs,
    openUrl: appLaunchUrl(app),
    apiBaseUrl: app.apiBaseUrl,
    healthUrl: app.healthUrl,
    interactive: app.interactive,
    serviceKind: app.serviceKind,
    local: app.local,
    apiRoutes: app.apiRoutes,
    apiRoutesSource: app.apiRoutesSource,
    runningTasks: app.runningTasks,
    installableServiceId,
    serviceAction,
    serviceActionLabel: installableServiceId && serviceAction ? installableServiceLabel(installableServiceId, serviceAction, service) : undefined,
    serviceActionDisabled: installableServiceId && serviceAction ? installableServiceBlocked(service, serviceAction) : undefined,
  };
}

function serviceHostFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function mapCatalogApp(app: (typeof AGENT_APP_CATALOG)[number], service: InstallableServiceStatus | undefined, hostedApps: FoundryHostedApp[]): FoundryCatalogApp {
  const hostedMatch = hostedApps.find((hosted) => normalizeName(hosted.name) === normalizeName(app.name));
  const action = app.installableServiceId ? installableServiceAction(app.installableServiceId, service) : undefined;
  return {
    id: app.id,
    name: app.name,
    mono: monoFor(app.name),
    accent: accentFor(app.id),
    category: app.category,
    installed: service?.installed ? service.id : hostedMatch?.id,
    featured: Boolean(app.installableServiceId),
    desc: app.description,
    req: service?.requirements?.[0] || service?.installMethod || "Manual setup",
    source: serviceHostFromUrl(app.sourceUrl),
    sourceUrl: app.sourceUrl,
    badges: app.badges,
    handles: app.handles,
    installableServiceId: app.installableServiceId,
    serviceInstalled: service?.installed,
    serviceRunning: service?.running,
    serviceVersion: service?.version,
    serviceDetail: service?.detail,
    serviceOpenUrl: service?.openUrl || hostedMatch?.openUrl,
    provenance: service?.provenance,
    primaryAction: action,
    primaryActionLabel: app.installableServiceId && action ? installableServiceLabel(app.installableServiceId, action, service) : undefined,
    primaryActionDisabled: action ? installableServiceBlocked(service, action) : undefined,
    preflight: service?.preflight,
    preflightActions: service?.preflightActions?.filter((item) => item.action !== "test-agent-reach-x-profile"),
    securityNotes: service?.securityNotes,
    permissions: service?.permissions,
  };
}

function uniqueMachineNames(payload: FleetAppsPayload | null, apps: FoundryHostedApp[]) {
  const names = new Set<string>();
  for (const machine of payload?.machines ?? []) {
    if (machine.collector !== "error" && (machine.appCount > 0 || machine.collector === "ready" || machine.collector === "native-local")) addMachineKey(names, machine.name);
  }
  for (const app of apps) addMachineKey(names, app.machine);
  return names;
}

function buildHosts(payload: FleetAppsPayload | null): FoundryHost[] {
  const local: FoundryHost = {
    id: "local",
    label: "This Mac",
    kind: "Local",
    detail: "Managed install actions run on this dashboard machine through HivemindOS' reviewed service catalog.",
  };
  const remote = (payload?.machines ?? [])
    .filter((machine) => machine.collector !== "error")
    .map((machine) => machine.name)
    .filter((name) => normalizeName(name) && normalizeName(name) !== normalizeName(local.label))
    .filter((name, index, list) => list.findIndex((candidate) => normalizeName(candidate) === normalizeName(name)) === index)
    .slice(0, 8)
    .map((name): FoundryHost => ({
      id: `remote:${normalizeName(name)}`,
      label: name,
      kind: "Fleet host",
      disabled: true,
      detail: "Remote app mutation is intentionally read-only until a dedicated install safety review lands.",
    }));
  return [local, ...remote];
}

function summarizeFoundry(apps: FoundryHostedApp[], payload: FleetAppsPayload | null): FoundrySummary {
  const running = apps.filter((app) => app.state === "running").length;
  const updates = apps.filter((app) => app.updateTo).length;
  const attention = apps.filter((app) => app.state === "error").length + updates;
  return {
    total: apps.length,
    running,
    machines: uniqueMachineNames(payload, apps).size,
    updates,
    attention,
  };
}

function BrowserUseFullPermissionsModal({
  theme,
  busy,
  onClose,
  onUnlock,
}: {
  theme: "dark" | "light";
  busy: boolean;
  onClose: () => void;
  onUnlock: () => void;
}) {
  const target = typeof document === "undefined" ? null : document.body;
  if (!target) return null;
  return createPortal((
    <div className="fr-root" data-fr-theme={theme}>
      <div className="fa-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <div className="fa-modal" role="alertdialog" aria-modal="true" aria-label="Enable Browser Use full permissions">
          <div className="fa-modal-head">
            <div>
              <div className="fb-eyebrow" style={{ marginBottom: 7 }}>Browser Use</div>
              <h3>Enable full permissions?</h3>
              <p>Agents will be able to use higher-agency browser actions on this machine, including real-profile/CDP options where the bridge supports them.</p>
            </div>
            <button type="button" className="fa-x" onClick={onClose} disabled={busy} aria-label="Close" style={{ transform: "rotate(45deg)" }}>+</button>
          </div>
          <div className="fa-modal-body">
            <p className="fa-banner">Only enable this if you trust the agents and the sites they will operate on. You can return Browser Use to limited permissions later.</p>
          </div>
          <div className="fa-modal-foot">
            <button type="button" className="fb-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="fb-btn primary" onClick={onUnlock} disabled={busy}>{busy ? "Saving..." : "Enable full permissions"}</button>
          </div>
        </div>
      </div>
    </div>
  ), target);
}

export function MyAppsPanel({ activeView, formatRelativeTime }: MyAppsPanelProps) {
  const theme = useFrTheme();
  const [payload, setPayload] = useState<FleetAppsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [installableServices, setInstallableServices] = useState<Record<string, InstallableServiceStatus>>({});
  const [busyServiceAction, setBusyServiceAction] = useState("");
  const [appPreferences, setAppPreferences] = useState<AppPreferenceRecord[]>([]);
  const [browserUsePermissionPromptOpen, setBrowserUsePermissionPromptOpen] = useState(false);
  const [agentReachSetupOpen, setAgentReachSetupOpen] = useState(false);
  const previousActiveViewRef = useRef<DashboardView | null>(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setStatusTone("info");
    setStatus(force ? "Refreshing app discovery..." : "");
    let nativePayload: FleetAppsPayload | null = null;
    try {
      nativePayload = await getNativeFleetAppsCache(force ? {} : { maxAgeMs: 5 * 60 * 1000 }) as FleetAppsPayload | null;
      if (nativePayload?.apps) setPayload(nativePayload);
      if (nativePayload?.apps && !force) {
        setLoading(false);
        const query = isSparseAppsPayload(nativePayload) ? "?refresh=1&fast=1" : "?fast=1";
        void fetch(`/api/fleet/apps${query}`, { cache: "no-store" })
          .then((response) => readFleetAppsResponse(response).catch(() => null))
          .then((data) => {
            if (!data?.apps) return;
            setPayload(data);
            void fetch("/api/fleet/apps?refresh=1", { cache: "no-store" })
              .then((response) => readFleetAppsResponse(response).catch(() => null))
              .then((fullData) => { if (fullData?.apps) setPayload(fullData); })
              .catch(() => undefined);
          })
          .catch(() => undefined);
        return;
      }
      const response = await fetch(`/api/fleet/apps${force ? "?refresh=1&fast=1&wait=1" : "?fast=1"}`, { cache: "no-store" });
      const data = await readFleetAppsResponse(response);
      setPayload(data);
      setStatus("");
      void fetch("/api/fleet/apps?refresh=1", { cache: "no-store" })
        .then((fullResponse) => readFleetAppsResponse(fullResponse).catch(() => null))
        .then((fullData) => { if (fullData?.apps) setPayload(fullData); })
        .catch(() => undefined);
    } catch (error) {
      if (nativePayload?.apps) setPayload(nativePayload);
      setStatusTone("error");
      setStatus(friendlyAppsError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshInstallableServices = useCallback(async () => {
    const installableIds = AGENT_APP_CATALOG.flatMap((app) => app.installableServiceId ? [app.installableServiceId] : []);
    const bulkData = await fetch("/api/fleet/apps/installable-services", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .catch(() => null) as { ok?: boolean; services?: InstallableServiceStatus[] } | null;
    if (bulkData?.ok && Array.isArray(bulkData.services)) {
      const next: Record<string, InstallableServiceStatus> = {};
      for (const service of bulkData.services) next[service.id] = service;
      setInstallableServices(next);
      return;
    }

    const entries = await Promise.allSettled(installableIds.map(async (id) => {
      const serviceResponse = await fetch(`/api/fleet/apps/installable-services?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await serviceResponse.json().catch(() => null) as { ok?: boolean; service?: InstallableServiceStatus } | null;
      return data?.ok ? data.service : undefined;
    }));
    const next: Record<string, InstallableServiceStatus> = {};
    for (const entry of entries) {
      if (entry.status === "fulfilled" && entry.value) next[entry.value.id] = entry.value;
    }
    if (Object.keys(next).length) setInstallableServices(next);
  }, []);

  useEffect(() => {
    const previousActiveView = previousActiveViewRef.current;
    previousActiveViewRef.current = activeView;
    if (activeView !== "my-apps" || loading) return undefined;
    const enteredMyApps = previousActiveView !== "my-apps";
    if (!enteredMyApps && payload) return undefined;
    const timer = window.setTimeout(() => {
      void refresh(false);
      void refreshInstallableServices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loading, payload, refresh, refreshInstallableServices]);

  useEffect(() => {
    if (activeView !== "my-apps") return;
    let cancelled = false;
    fetch("/api/fleet/apps/preferences", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((data: { ok?: boolean; preferences?: AppPreferenceRecord[] } | null) => {
        if (!cancelled && data?.ok && Array.isArray(data.preferences)) setAppPreferences(data.preferences);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeView]);

  const runInstallableServiceAction = useCallback(async (
    app: FoundryCatalogApp,
    action: InstallableServiceAction,
    input?: AgentReachActionInput,
  ): Promise<FoundryServiceActionResult | null> => {
    const id = app.installableServiceId;
    if (!id) return { ok: false, error: "This catalog item does not have an automated installer yet." };
    if (!(await confirmSensitiveInstallableServiceAction(action))) return { ok: false, error: "Cancelled." };
    setBusyServiceAction(`${id}:${action}`);
    setStatusTone("info");
    setStatus(`${installableServiceLabel(id, action)} ${app.name}...`);
    try {
      const response = await fetch("/api/fleet/apps/installable-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, input }),
      });
      const data = await response.json().catch(() => null) as FoundryServiceActionResult | null;
      if (!response.ok || !data?.ok || !data.service) throw new Error(data?.error || "Service action failed.");
      setInstallableServices((current) => ({ ...current, [id]: data.service as InstallableServiceStatus }));
      setStatus(data.service.detail);
      if (!["status", "agent-reach-doctor", "check-agent-reach-x-auth", "test-agent-reach-x-profile"].includes(action)) await refresh(true);
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Service action failed.";
      setStatusTone("error");
      setStatus(message);
      return { ok: false, error: message };
    } finally {
      setBusyServiceAction("");
    }
  }, [refresh]);

  const setBrowserUseFullPermissions = useCallback(async (fullAccess: boolean) => {
    setBusyServiceAction("browser-use:permissions");
    setStatusTone("info");
    setStatus(fullAccess ? "Enabling Browser Use full permissions..." : "Returning Browser Use to limited permissions...");
    try {
      const response = await fetch("/api/browser-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-full-permissions", fullAccess }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; service?: InstallableServiceStatus } | null;
      if (!response.ok || !data?.ok || !data.service) throw new Error(data?.error || "Could not update Browser Use permissions.");
      setInstallableServices((current) => ({ ...current, "browser-use": data.service! }));
      setStatus(data.service.permissions?.detail || data.service.detail);
      if (fullAccess) setBrowserUsePermissionPromptOpen(false);
    } catch (error) {
      setStatusTone("error");
      setStatus(error instanceof Error ? error.message : "Could not update Browser Use permissions.");
    } finally {
      setBusyServiceAction("");
    }
  }, []);

  const refreshAllApps = useCallback(() => {
    void refresh(true);
    void refreshInstallableServices();
  }, [refresh, refreshInstallableServices]);

  const runTaskAction = useCallback(async (app: FoundryHostedApp, task: FoundryRunningTask, action: "cancel-task" | "kill-task") => {
    setStatusTone("info");
    setStatus(`${action === "cancel-task" ? "Cancelling" : "Killing"} ${task.title}...`);
    setBusyServiceAction(`${action}:${task.id}`);
    try {
      const response = await fetch("/api/fleet/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, appId: app.id, taskId: task.id }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not update the running task.");
      setStatus(data.message || "Task action sent.");
      await refresh(true);
    } catch (error) {
      setStatusTone("error");
      setStatus(error instanceof Error ? error.message : "Could not update the running task.");
    } finally {
      setBusyServiceAction("");
    }
  }, [refresh]);

  const rememberAppPreference = useCallback((preference: AppPreferenceRecord) => {
    setAppPreferences((current) => [...current.filter((entry) => entry.appId !== preference.appId), preference]);
  }, []);

  const visibleRawHostedApps = useMemo(() => dedupeHostedApps(payload?.apps ?? []), [payload?.apps]);
  const hostedApps = useMemo(() => visibleRawHostedApps.map((app) => ({
    ...mapHostedApp(app, installableServices),
    priority: Boolean(matchAppPreference(app, appPreferences)?.priority),
  })), [visibleRawHostedApps, installableServices, appPreferences]);
  const catalogApps = useMemo(
    () => AGENT_APP_CATALOG.map((app) => mapCatalogApp(app, app.installableServiceId ? installableServices[app.installableServiceId] : undefined, hostedApps)),
    [hostedApps, installableServices],
  );
  const rawHostedById = useMemo(() => new Map(visibleRawHostedApps.map((app) => [app.id, app])), [visibleRawHostedApps]);
  const hosts = useMemo(() => buildHosts(payload), [payload]);
  const summary = useMemo(() => summarizeFoundry(hostedApps, payload), [hostedApps, payload]);
  const checkedAt = payload?.checkedAt ? Date.parse(payload.checkedAt) : 0;
  const checkedAtLabel = checkedAt ? formatRelativeTime(checkedAt) : loading ? "Scanning..." : "Not yet";

  if (activeView !== "my-apps") return null;

  return (
    <>
      <AppsView
        theme={theme}
        hostedApps={hostedApps}
        catalogApps={catalogApps}
        hosts={hosts}
        summary={summary}
        loading={loading}
        status={status}
        statusTone={statusTone}
        checkedAtLabel={checkedAtLabel}
        busyAction={busyServiceAction}
        onRefresh={refreshAllApps}
        onRunServiceAction={runInstallableServiceAction}
        onRunTaskAction={runTaskAction}
        onRequestBrowserPermissions={(_app, fullAccess) => {
          if (fullAccess) {
            setBrowserUsePermissionPromptOpen(true);
            return;
          }
          void setBrowserUseFullPermissions(false);
        }}
        onOpenAgentReachSetup={() => {
          setAgentReachSetupOpen(true);
          const agentReach = catalogApps.find((app) => app.installableServiceId === "agent-reach");
          if (agentReach) void runInstallableServiceAction(agentReach, "status");
        }}
        renderAppPreferences={(app) => {
          const raw = rawHostedById.get(app.id);
          if (!raw) return null;
          return (
            <AppPreferencesCard
              key={raw.id}
              app={raw}
              preference={matchAppPreference(raw, appPreferences)}
              onSaved={rememberAppPreference}
            />
          );
        }}
      />
      {browserUsePermissionPromptOpen ? (
        <BrowserUseFullPermissionsModal
          theme={theme}
          busy={busyServiceAction === "browser-use:permissions"}
          onClose={() => {
            if (busyServiceAction !== "browser-use:permissions") setBrowserUsePermissionPromptOpen(false);
          }}
          onUnlock={() => void setBrowserUseFullPermissions(true)}
        />
      ) : null}
      {agentReachSetupOpen ? (
        <AgentReachSetupWizard
          service={installableServices["agent-reach"]}
          busyAction={busyServiceAction}
          onAction={async (action, input) => {
            const agentReach = catalogApps.find((app) => app.installableServiceId === "agent-reach");
            if (!agentReach) return { ok: false, error: "Agent Reach is not in the catalog." };
            const response = await runInstallableServiceAction(agentReach, action, input);
            if (!response) return null;
            return { ...response, service: response.service as InstallableServiceStatus | undefined };
          }}
          onClose={() => {
            if (!busyServiceAction.startsWith("agent-reach:")) setAgentReachSetupOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
