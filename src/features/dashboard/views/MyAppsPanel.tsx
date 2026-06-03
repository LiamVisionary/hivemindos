"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Clock3, Copy, ExternalLink, LoaderCircle, Maximize2, Minimize2, RefreshCcw, Route, Sparkles, XOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AGENT_APP_CATALOG } from "@/features/dashboard/agent-capability-catalog";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { getNativeFleetAppsCache } from "@/lib/native/fleet";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

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

type RunningServiceTask = {
  id: string;
  title: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  progressPercent?: number;
  currentRound?: number;
  totalRounds?: number;
  detail?: string;
  potentiallyStuck?: boolean;
  stuckReason?: string;
  canCancel?: boolean;
  canKill?: boolean;
  source?: string;
};

type ApiServiceRoute = {
  method: string;
  path: string;
  url: string;
  category: string;
  summary?: string;
  source?: "openapi" | "hivemind";
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

type MyAppsPanelProps = {
  activeView: DashboardView;
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
};

const loadingIconThemes = [
  "from-teal-300/25 to-emerald-500/10",
  "from-sky-300/25 to-cyan-500/10",
  "from-amber-200/25 to-yellow-500/10",
  "from-rose-300/25 to-orange-500/10",
  "from-lime-200/25 to-teal-500/10",
  "from-fuchsia-300/20 to-sky-500/10",
  "from-white/20 to-slate-500/10",
  "from-cyan-200/25 to-emerald-500/10",
];

function AppIcon({ app, large = false }: { app: HostedApp; large?: boolean }) {
  const sizeClass = large ? "h-24 w-24 rounded-[24px] text-3xl" : "h-20 w-20 rounded-[22px] text-2xl";
  const [broken, setBroken] = useState(false);
  return (
    <span className={`flex ${sizeClass} items-center justify-center overflow-hidden bg-gradient-to-br ${app.theme} font-black text-white shadow-[0_18px_38px_rgba(15,23,42,0.30)] ring-1 ring-white/20 transition group-hover:-translate-y-1 group-hover:shadow-[0_24px_54px_rgba(15,23,42,0.42)]`}>
      {app.iconUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={app.iconUrl}
          alt=""
          className="h-full w-full object-contain p-2"
          onError={() => setBroken(true)}
        />
      ) : (
        app.initials
      )}
    </span>
  );
}

function MyAppsLoadingState() {
  return (
    <div
      className="mt-6 grid min-h-[58vh] place-items-center overflow-hidden rounded-md border border-[rgba(94,234,212,0.14)] bg-[radial-gradient(circle_at_50%_30%,rgba(20,184,166,0.10),transparent_34%),rgba(8,12,19,0.42)] px-4 py-10"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="grid w-full max-w-4xl justify-items-center gap-8">
        <div className="relative grid h-36 w-36 place-items-center">
          <span className="absolute h-28 w-28 rounded-full border border-[rgba(94,234,212,0.24)] animate-ping" />
          <span className="absolute h-20 w-20 rounded-full border border-[rgba(251,191,36,0.22)] animate-pulse" />
          <span className="absolute h-px w-32 origin-center rotate-45 bg-gradient-to-r from-transparent via-[rgba(94,234,212,0.55)] to-transparent" />
          <span className="grid h-16 w-16 place-items-center rounded-[22px] border border-[rgba(94,234,212,0.28)] bg-[rgba(10,14,21,0.82)] shadow-[0_20px_70px_rgba(20,184,166,0.18)]">
            <LoaderCircle aria-hidden="true" className="h-7 w-7 animate-spin text-[var(--accent-strong)]" />
          </span>
        </div>

        <div className="text-center">
          <p className="eyebrow">Scanning Tailnet</p>
          <h3 className="m-0 text-xl font-black text-[var(--foreground)]">Finding apps and services</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
            Checking ready machines and sorting the hivenet launcher.
          </p>
        </div>

        <div className="grid w-full grid-cols-4 gap-x-5 gap-y-7 sm:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 16 }, (_, index) => (
            <div
              key={index}
              className="grid justify-items-center gap-3"
            >
              <span
                className={`h-16 w-16 animate-pulse rounded-[18px] bg-gradient-to-br ${loadingIconThemes[index % loadingIconThemes.length]} ring-1 ring-white/10 shadow-[0_16px_38px_rgba(0,0,0,0.22)]`}
                style={{ animationDelay: `${index * 70}ms` }}
              />
              <span
                className="h-2 w-14 animate-pulse rounded-full bg-[rgba(148,163,184,0.16)]"
                style={{ animationDelay: `${index * 70 + 90}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function appLaunchUrl(app: HostedApp) {
  if (!/z-image/i.test(app.name)) return app.openUrl;
  try {
    const url = new URL(app.openUrl);
    if (!url.searchParams.get("api")) {
      url.searchParams.set("api", url.toString().replace(/\/$/, ""));
    }
    return url.toString();
  } catch {
    return app.openUrl;
  }
}

function routeGroups(routes: ApiServiceRoute[]) {
  const groups = new Map<string, ApiServiceRoute[]>();
  for (const route of routes) {
    const category = route.category || "API";
    groups.set(category, [...(groups.get(category) ?? []), route]);
  }
  return [...groups.entries()];
}

function canOpenRoute(route: ApiServiceRoute) {
  return route.method.toUpperCase() === "GET" && !/[{}]/.test(route.path);
}

function routeTone(method: string) {
  const normalized = method.toUpperCase();
  if (normalized === "GET") return "border-[rgba(94,234,212,0.32)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]";
  if (normalized === "POST") return "border-[rgba(250,204,21,0.28)] bg-[rgba(250,204,21,0.10)] text-[#fde68a]";
  return "border-[rgba(148,163,184,0.24)] bg-[rgba(148,163,184,0.10)] text-[var(--muted)]";
}

function taskTimeLabel(value: string | undefined, formatRelativeTime: (timestamp: number) => string) {
  if (!value) return "Unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return `${formatRelativeTime(timestamp)} · ${new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function taskProgressLabel(task: RunningServiceTask) {
  const progress = typeof task.progressPercent === "number" ? `${Math.round(task.progressPercent)}%` : "No progress reported";
  if (typeof task.currentRound === "number" && typeof task.totalRounds === "number" && task.totalRounds > 0) {
    return `${progress} · round ${task.currentRound}/${task.totalRounds}`;
  }
  if (typeof task.currentRound === "number") return `${progress} · round ${task.currentRound}`;
  return progress;
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
    if (!previous || hostedAppScore(app) > hostedAppScore(previous) || (hostedAppScore(app) === hostedAppScore(previous) && app.openUrl.length < previous.openUrl.length)) {
      byKey.set(key, app);
    }
  }
  return [...byKey.values()];
}

function dedupeHostedApps(apps: HostedApp[]) {
  const launchableApps = dedupeByHostedAppKey(
    dedupeByHostedAppKey(
      dedupeByHostedAppKey(
        apps.filter((app) => !isInfrastructureHostedApp(app) && (!isGenericHostedApiApp(app) || app.name.toLowerCase() === "hivemindos")),
        proxiedHostedAppKey,
      ),
      sourceHostedAppKey,
    ),
    hostedDisplayAppKey,
  );
  return dedupeByHostedAppKey(
    launchableApps,
    (app) => app.id,
  );
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

export function MyAppsPanel({ activeView, fleetClass, formatRelativeTime }: MyAppsPanelProps) {
  const [payload, setPayload] = useState<FleetAppsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [liveAppExpanded, setLiveAppExpanded] = useState(false);
  const [copiedRouteKey, setCopiedRouteKey] = useState("");
  const [taskActionStatus, setTaskActionStatus] = useState("");
  const [busyTaskAction, setBusyTaskAction] = useState("");
  const previousActiveViewRef = useRef<DashboardView | null>(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setStatusTone("info");
    setStatus(force ? "Refreshing app discovery..." : "");
    let nativePayload: FleetAppsPayload | null = null;
    try {
      nativePayload = await getNativeFleetAppsCache(force ? {} : { maxAgeMs: 5 * 60 * 1000 }) as FleetAppsPayload | null;
      if (nativePayload?.apps) {
        setPayload(nativePayload);
      }
      if (nativePayload?.apps && !force) {
        setLoading(false);
        const query = force || isSparseAppsPayload(nativePayload) ? "?refresh=1&fast=1" : "?fast=1";
        void fetch(`/api/fleet/apps${query}`, { cache: "no-store" })
          .then((response) => readFleetAppsResponse(response).catch(() => null))
          .then((data: FleetAppsPayload | null) => {
            if (!data?.apps) return;
            setPayload(data);
            void fetch("/api/fleet/apps?refresh=1", { cache: "no-store" })
              .then((response) => readFleetAppsResponse(response).catch(() => null))
              .then((fullData: FleetAppsPayload | null) => { if (fullData?.apps) setPayload(fullData); })
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
        .then((fullData: FleetAppsPayload | null) => { if (fullData?.apps) setPayload(fullData); })
        .catch(() => undefined);
    } catch (error) {
      if (nativePayload?.apps) {
        setPayload(nativePayload);
      }
      setStatusTone("error");
      setStatus(friendlyAppsError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const previousActiveView = previousActiveViewRef.current;
    previousActiveViewRef.current = activeView;
    if (activeView !== "my-apps" || loading) return undefined;
    const enteredMyApps = previousActiveView !== "my-apps";
    if (!enteredMyApps && payload) return undefined;
    const timer = window.setTimeout(() => {
      void refresh(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loading, payload, refresh]);

  useEffect(() => {
    if (!liveAppExpanded) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLiveAppExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [liveAppExpanded]);

  if (activeView !== "my-apps") return null;

  const apps = dedupeHostedApps(payload?.apps ?? []);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const checkedAt = payload?.checkedAt ? Date.parse(payload.checkedAt) : 0;
  const appNameCounts = new Map<string, number>();
  for (const app of apps) appNameCounts.set(app.name.toLowerCase(), (appNameCounts.get(app.name.toLowerCase()) ?? 0) + 1);
  const visibleMachineKeys = new Set<string>();
  const reportingMachineKeys = new Set<string>();
  for (const machine of payload?.machines ?? []) {
    if (machine.collector === "error") continue;
    if (machine.appCount > 0) addMachineKey(reportingMachineKeys, machine.name);
    if (machine.appCount > 0 || machine.collector === "ready" || machine.collector === "native-local") addMachineKey(visibleMachineKeys, machine.name);
  }
  for (const app of apps) {
    addMachineKey(reportingMachineKeys, app.machineName);
    addMachineKey(visibleMachineKeys, app.machineName);
  }
  const readyMachines = visibleMachineKeys.size;
  const reportingMachines = reportingMachineKeys.size;

  const copyRoute = async (route: ApiServiceRoute) => {
    await navigator.clipboard.writeText(route.url || route.path).catch(() => undefined);
    setCopiedRouteKey(`${route.method}:${route.path}`);
    window.setTimeout(() => setCopiedRouteKey(""), 1400);
  };

  const runTaskAction = async (app: HostedApp, task: RunningServiceTask, action: "cancel-task" | "kill-task") => {
    const actionKey = `${action}:${task.id}`;
    setBusyTaskAction(actionKey);
    setTaskActionStatus("");
    try {
      const response = await fetch("/api/fleet/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, appId: app.id, taskId: task.id }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not update the running task.");
      setTaskActionStatus(data.message || "Task action sent.");
      await refresh(true);
    } catch (error) {
      setTaskActionStatus(error instanceof Error ? error.message : "Could not update the running task.");
    } finally {
      setBusyTaskAction("");
    }
  };

  if (selectedApp) {
    const launchUrl = appLaunchUrl(selectedApp);
    const serviceUrl = selectedApp.healthUrl || selectedApp.apiBaseUrl || launchUrl;
    const apiRoutes = selectedApp.apiRoutes ?? [];
    const apiRouteGroups = routeGroups(apiRoutes);
    const runningTasks = selectedApp.runningTasks ?? [];
    return (
      <section className={fleetClass("taskPanel", "tabPanel")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setLiveAppExpanded(false);
              setSelectedAppId(null);
            }}
          >
            <ArrowLeft aria-hidden="true" />
            Apps & Services
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void refresh(true)} disabled={loading}>
              {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCcw aria-hidden="true" />}
              Refresh
            </Button>
            <Button type="button" size="sm" asChild>
              <a href={selectedApp.interactive ? launchUrl : serviceUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                {selectedApp.interactive ? "Open" : "Open service"}
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
          <div className="grid content-start gap-4">
            <div className="flex items-center gap-4">
              <AppIcon app={selectedApp} large />
              <div>
                <p className="eyebrow">{selectedApp.local ? "This Mac" : selectedApp.machineName}</p>
                <h2 className="m-0 text-2xl font-black">{selectedApp.name}</h2>
                <p className="m-0 mt-2 text-sm leading-6 text-[var(--muted)]">{selectedApp.description}</p>
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />
                Ready on your Tailnet
              </div>
              <p className="m-0 text-sm leading-6 text-[var(--muted)]">
                {selectedApp.interactive
                  ? "This app is reachable from the private network. Use the embedded workspace here, or open it in a full browser tab when you need more room."
                  : "This service is reachable from the private network and can be used by HivemindOS without needing an HTML app shell."}
              </p>
              {!selectedApp.interactive ? (
                <div className="grid gap-2 rounded-md border border-[rgba(94,234,212,0.20)] bg-[rgba(20,184,166,0.08)] p-3 text-sm leading-6 text-[var(--foreground)]">
                  <span className="font-bold">Service endpoint</span>
                  <code className="break-all rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.44)] px-2 py-1 text-xs text-[var(--muted)]">{selectedApp.apiBaseUrl || selectedApp.openUrl}</code>
                  {selectedApp.healthUrl ? <code className="break-all rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.44)] px-2 py-1 text-xs text-[var(--muted)]">{selectedApp.healthUrl}</code> : null}
                  {apiRoutes.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-[rgba(94,234,212,0.24)] px-2 py-0.5 font-bold text-[var(--accent-strong)]">
                        {apiRoutes.length} routes
                      </span>
                      <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-0.5 text-[var(--muted)]">
                        {selectedApp.apiRoutesSource === "openapi" ? "OpenAPI" : "Hivemind catalog"}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {selectedApp.interactive ? (
            <div
              className={
                liveAppExpanded
                  ? "fixed inset-0 z-[80] overflow-hidden border border-[rgba(148,163,184,0.18)] bg-black"
                  : "min-h-[520px] overflow-hidden rounded-md border border-[rgba(148,163,184,0.18)] bg-black/40"
              }
            >
              <div className="flex items-center justify-between gap-3 border-b border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.86)] px-3 py-2">
                <span className="text-xs font-bold text-[var(--muted)]">Live app</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs font-bold text-[var(--accent-strong)] hover:bg-[rgba(20,184,166,0.10)]"
                  onClick={() => setLiveAppExpanded((expanded) => !expanded)}
                >
                  {liveAppExpanded ? <Minimize2 aria-hidden="true" className="h-3 w-3" /> : <Maximize2 aria-hidden="true" className="h-3 w-3" />}
                  {liveAppExpanded ? "Exit full screen" : "Full screen"}
                </Button>
              </div>
              <iframe
                title={selectedApp.name}
                src={launchUrl}
                className={liveAppExpanded ? "h-[calc(100dvh-41px)] w-full border-0 bg-white" : "h-[520px] w-full border-0 bg-white"}
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
              />
            </div>
          ) : (
            <div className="min-h-[360px] rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.48)] p-5">
              <section className="mb-6 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 place-items-center rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]">
                        <Clock3 aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="m-0 text-lg font-black text-[var(--foreground)]">Running tasks</h3>
                        <p className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                          {runningTasks.length ? `${runningTasks.length} active` : "None reported"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                      Live service work reported by the app itself. Cancel asks the service to stop cleanly; Kill sends the stronger stop request.
                    </p>
                  </div>
                  {runningTasks.some((task) => task.potentiallyStuck) ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(251,191,36,0.34)] bg-[rgba(251,191,36,0.10)] px-3 py-1 text-xs font-black uppercase text-[#fde68a]">
                      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                      Needs attention
                    </span>
                  ) : null}
                </div>

                {taskActionStatus ? (
                  <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.34)] px-3 py-2 text-xs leading-5 text-[var(--foreground)]">
                    {taskActionStatus}
                  </p>
                ) : null}

                {runningTasks.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {runningTasks.map((task) => {
                      const cancelKey = `cancel-task:${task.id}`;
                      const killKey = `kill-task:${task.id}`;
                      return (
                        <article key={task.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.30)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded border border-[rgba(94,234,212,0.30)] bg-[rgba(20,184,166,0.10)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--accent-strong)]">
                                  {task.status || "running"}
                                </span>
                                {task.potentiallyStuck ? (
                                  <span className="inline-flex items-center gap-1 rounded border border-[rgba(251,191,36,0.34)] bg-[rgba(251,191,36,0.10)] px-2 py-0.5 text-[10px] font-black uppercase text-[#fde68a]">
                                    <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                                    Potentially stuck
                                  </span>
                                ) : null}
                              </div>
                              <h4 className="m-0 mt-2 break-all text-sm font-black text-[var(--foreground)]">{task.title}</h4>
                              <div className="mt-2 grid gap-1 text-xs leading-5 text-[var(--muted)]">
                                <span>Started {taskTimeLabel(task.startedAt, formatRelativeTime)}</span>
                                {task.updatedAt ? <span>Last update {taskTimeLabel(task.updatedAt, formatRelativeTime)}</span> : null}
                                <span>{taskProgressLabel(task)}</span>
                                {task.detail ? <span>{task.detail}</span> : null}
                                {task.stuckReason ? <span className="text-[#fde68a]">{task.stuckReason}</span> : null}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {task.canCancel ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => void runTaskAction(selectedApp, task, "cancel-task")}
                                  isLoading={busyTaskAction === cancelKey}
                                  disabled={Boolean(busyTaskAction)}
                                >
                                  <Ban aria-hidden="true" className="h-3.5 w-3.5" />
                                  Cancel
                                </Button>
                              ) : null}
                              {task.canKill ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="danger"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => void runTaskAction(selectedApp, task, "kill-task")}
                                  isLoading={busyTaskAction === killKey}
                                  disabled={Boolean(busyTaskAction)}
                                >
                                  <XOctagon aria-hidden="true" className="h-3.5 w-3.5" />
                                  Kill
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.24)] p-3 text-sm leading-6 text-[var(--muted)]">
                    This service is not reporting any running tasks right now.
                  </div>
                )}
              </section>

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="grid h-10 w-10 place-items-center rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]">
                      <Route aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="m-0 text-lg font-black text-[var(--foreground)]">API routes</h3>
                      <p className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                        {apiRoutes.length > 0 ? `${apiRoutes.length} discovered endpoints` : "No catalog published"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    {apiRoutes.length > 0
                      ? "Routes are discovered from the service API catalog when available."
                      : "This API is reachable, but HivemindOS has not found a route catalog for it yet."}
                  </p>
                </div>
                {selectedApp.apiRoutesSource ? (
                  <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-3 py-1 text-xs font-black uppercase text-[var(--muted)]">
                    {selectedApp.apiRoutesSource === "openapi" ? "OpenAPI" : "Hivemind catalog"}
                  </span>
                ) : null}
              </div>

              {apiRouteGroups.length > 0 ? (
                <div className="mt-5 grid gap-4">
                  {apiRouteGroups.map(([category, routes]) => (
                    <section key={category} className="grid gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="m-0 text-sm font-black text-[var(--foreground)]">{category}</h4>
                        <span className="text-xs font-bold text-[var(--muted)]">{routes.length}</span>
                      </div>
                      <div className="grid gap-2">
                        {routes.map((route) => {
                          const key = `${route.method}:${route.path}`;
                          const openable = canOpenRoute(route);
                          return (
                            <article key={key} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.28)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${routeTone(route.method)}`}>{route.method.toUpperCase()}</span>
                                  <code className="break-all text-xs font-bold text-[var(--foreground)]">{route.path}</code>
                                </div>
                                {route.summary ? <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">{route.summary}</p> : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => void copyRoute(route)}
                                >
                                  <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                                  {copiedRouteKey === key ? "Copied" : "Copy"}
                                </Button>
                                {openable ? (
                                  <Button type="button" size="sm" variant="secondary" className="h-8 px-2 text-xs" asChild>
                                    <a href={route.url} target="_blank" rel="noreferrer">
                                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                                      Open
                                    </a>
                                  </Button>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Apps</p>
          <h2>Apps & Services</h2>
          <p>Running Tailnet services plus installable providers that humans can open and agents can call.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh(true)} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCcw aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </div>

      {status ? (
        <p
          className={`mt-3 rounded-md border px-3 py-2 text-xs text-[var(--foreground)] ${
            statusTone === "error"
              ? "border-[rgba(248,113,113,0.24)] bg-[rgba(127,29,29,0.20)]"
              : "border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.10)]"
          }`}
        >
          {status}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <span>{apps.length} apps/services</span>
        <span>·</span>
        <span>{reportingMachines}/{readyMachines} machines</span>
        <span>·</span>
        <span>{checkedAt ? formatRelativeTime(checkedAt) : loading ? "Scanning..." : "Not yet"}</span>
      </div>

      {loading && apps.length === 0 ? <MyAppsLoadingState /> : null}

      <div className="mt-6 grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7">
        {apps.map((app) => (
          <button
            type="button"
            key={app.id}
            onClick={() => {
              setLiveAppExpanded(false);
              setSelectedAppId(app.id);
            }}
            className="group grid justify-items-center gap-3 text-center text-[var(--foreground)] outline-none"
          >
            <span className="relative">
              <AppIcon app={app} />
              <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[rgb(10,14,21)] ${app.online ? "bg-emerald-400" : "bg-slate-400"}`} />
              {!app.interactive ? <span className="absolute -left-2 -top-2 rounded-full border border-[rgba(94,234,212,0.32)] bg-[rgba(10,14,21,0.92)] px-1.5 py-0.5 text-[9px] font-black uppercase text-[var(--accent-strong)]">API</span> : null}
            </span>
            <span className="max-w-[7rem] text-sm font-bold leading-5">{app.name}</span>
            {(appNameCounts.get(app.name.toLowerCase()) ?? 0) > 1 ? (
              <span className="max-w-[8rem] text-[11px] font-bold leading-4 text-[var(--muted)]">
                {app.local ? "This Mac" : app.machineName} · {app.port}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {!loading && apps.length === 0 ? (
        <div className="mt-4 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4 text-sm text-[var(--muted)]">
          No apps or services found yet. Start something on a ready hivenet machine, then refresh.
        </div>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Agent app catalog</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">Installable providers</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">Install one of these as a local, Tailnet, or cloud service; once it exposes an API, agents can receive its handles through Tools.</p>
          </div>
          <span className="rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] px-2.5 py-1 text-xs font-bold text-[var(--accent-strong)]">
            {AGENT_APP_CATALOG.length} providers
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {AGENT_APP_CATALOG.map((app) => (
            <article key={app.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{app.category}</span>
                <strong className="mt-1 block text-sm text-[var(--foreground)]">{app.name}</strong>
              </div>
              <p className="m-0 text-xs leading-5 text-[var(--muted)]">{app.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {[...app.badges, ...app.handles.slice(0, 2)].map((label) => (
                  <span key={label} className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.58)] px-2 py-1 text-[11px] font-bold text-[var(--muted)]">
                    {label}
                  </span>
                ))}
              </div>
              <Button type="button" size="sm" variant="secondary" className="w-fit" asChild>
                <a href={app.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  Source
                </a>
              </Button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
