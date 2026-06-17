"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Clock3, Copy, Download, ExternalLink, LoaderCircle, Maximize2, Minimize2, Play, RefreshCcw, Route, Search, Sparkles, Square, Star, Trash2, XOctagon } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { AGENT_APP_CATALOG } from "@/features/dashboard/agent-capability-catalog";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { AgentReachSetupWizard } from "@/features/dashboard/views/AgentReachSetupWizard";
import { AppPreferencesCard, matchAppPreference, type AppPreferenceRecord } from "@/features/dashboard/views/AppPreferencesCard";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
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

type InstallableServiceStatus = {
  id: "n8n" | "browser-use" | "agentic-inbox" | "openhands" | "aider" | "agent-reach";
  name: string;
  installed: boolean;
  running: boolean;
  version?: string;
  openUrl?: string;
  detail: string;
  installMethod: "docker" | "uv" | "uv-tool" | "pipx" | "cloudflare-worker";
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
  preflight?: Array<{ key: string; ok: boolean; detail: string }>;
  preflightActions?: Array<{
    action: InstallableServiceAction;
    label: string;
    detail: string;
    disabled?: boolean;
  }>;
};

type InstallableServiceAction =
  | "status"
  | "install"
  | "start"
  | "stop"
  | "install-pipx"
  | "install-agent-reach-x"
  | "check-agent-reach-x-auth"
  | "agent-reach-doctor"
  | "test-agent-reach-x-profile"
  | "reset-agent-reach-x";

type InstallableServiceActionResponse = {
  ok?: boolean;
  error?: string;
  service?: InstallableServiceStatus;
  result?: unknown;
};

type MyAppsPanelProps = {
  activeView: DashboardView;
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
};

function isInstallOnlyCliService(service: InstallableServiceStatus | undefined) {
  return service?.installMethod === "uv-tool" || service?.installMethod === "pipx";
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
  return action === "install" ? "Install" : action === "start" ? "Start" : "Stop";
}

function installableServiceAction(serviceId: string, service: InstallableServiceStatus | undefined): InstallableServiceAction {
  if (serviceId === "agentic-inbox") return service?.installed ? "start" : "install";
  if (isInstallOnlyCliService(service)) return "install";
  return service?.running ? "stop" : service?.installed ? "start" : "install";
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
  if (action === "install" && /required before|is required before|is required to install/i.test(service.detail)) return true;
  if (service.id === "agentic-inbox" && action === "start") return Boolean(service.preflight?.some((item) => !item.ok));
  return false;
}

function InstallableServiceActionIcon({ action }: { action: InstallableServiceAction }) {
  if (action === "start") return <Play aria-hidden="true" />;
  if (action === "stop") return <Square aria-hidden="true" />;
  if (action === "check-agent-reach-x-auth") return <RefreshCcw aria-hidden="true" />;
  if (action === "agent-reach-doctor") return <RefreshCcw aria-hidden="true" />;
  if (action === "test-agent-reach-x-profile") return <Search aria-hidden="true" />;
  if (action === "reset-agent-reach-x") return <Trash2 aria-hidden="true" />;
  return <Download aria-hidden="true" />;
}

function confirmSensitiveInstallableServiceAction(action: InstallableServiceAction) {
  if (action === "check-agent-reach-x-auth") {
    return window.confirm([
      "Agent Reach will run twitter-cli's X auth check now.",
      "It first looks for TWITTER_AUTH_TOKEN and TWITTER_CT0. If those are absent, macOS may show a Keychain prompt saying security wants Chrome Safe Storage access so twitter-cli can decrypt local browser cookies for X/Twitter.",
      "Continue only if you want Agent Reach to use this authenticated X session.",
    ].join("\n\n"));
  }
  if (action === "reset-agent-reach-x") {
    return window.confirm([
      "Reset the optional Agent Reach X setup?",
      "This uninstalls the HivemindOS-managed twitter-cli backend. It does not delete Chrome cookies, revoke macOS Keychain decisions, or remove shared env keys.",
    ].join("\n\n"));
  }
  return true;
}

function BrowserUseFullPermissionsModal({
  busy,
  onClose,
  onUnlock,
}: {
  busy: boolean;
  onClose: () => void;
  onUnlock: () => void;
}) {
  const [unlockValue, setUnlockValue] = useState(0);
  const unlockTrackRef = useRef<HTMLDivElement | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;

  const unlockValueFromClientX = useCallback((clientX: number) => {
    const rect = unlockTrackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const thumbSize = 52;
    const travel = Math.max(1, rect.width - thumbSize - 8);
    const next = ((clientX - rect.left - thumbSize / 2) / travel) * 100;
    return Math.max(0, Math.min(100, next));
  }, []);

  const finishUnlockDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const next = unlockValueFromClientX(event.clientX);
    if (next >= 96) {
      setUnlockValue(100);
      onUnlock();
      return;
    }
    setUnlockValue(0);
  }, [onUnlock, unlockValueFromClientX]);

  if (!portalTarget) return null;

  return createPortal((
    <div
      role="presentation"
      onClick={() => { if (!busy) onClose(); }}
      className="fixed inset-0 z-[90] grid place-items-center bg-[rgba(34,29,20,0.34)] p-4 backdrop-blur-md"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="browser-use-full-permissions-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[520px] rounded-md border border-[rgba(185,139,47,0.34)] bg-[var(--surface)] p-5 text-[var(--foreground)] shadow-[0_28px_70px_rgba(82,61,22,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-[var(--warning)]">Browser Use permissions</p>
            <h3 id="browser-use-full-permissions-title" className="m-0 text-xl font-black leading-tight">
              Enable full browser permissions?
            </h3>
          </div>
          <Button type="button" size="icon-sm" variant="secondary" aria-label="Cancel full permissions" onClick={onClose} disabled={busy}>
            <XOctagon aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-4 grid gap-2 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.07)] p-3 text-sm leading-6 text-[var(--muted)]">
          <span>Agents will be able to run high-agency Browser Use actions from this machine.</span>
          <span>This includes Browser Use Cloud task creation, uploads, JavaScript eval, and real Chrome profile or CDP launch options where the bridge supports them.</span>
          <span>Only enable this if you trust the agents and the sites they will operate on.</span>
        </div>

        <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] p-3">
          <div className="mb-2 font-mono text-[11px] font-black uppercase text-[var(--warning)]">Slide to unlock full permissions</div>
          <div
            ref={unlockTrackRef}
            role="slider"
            aria-label="Slide to unlock Browser Use full permissions"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(unlockValue)}
            tabIndex={0}
            onPointerDown={(event) => {
              if (busy) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setUnlockValue(unlockValueFromClientX(event.clientX));
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || busy) return;
              setUnlockValue(unlockValueFromClientX(event.clientX));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              if (!busy) finishUnlockDrag(event);
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              setUnlockValue(0);
            }}
            className="relative grid h-[58px] touch-none select-none items-center overflow-hidden rounded-full border border-[rgba(251,191,36,0.34)] bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] shadow-[inset_0_2px_12px_rgba(0,0,0,0.48)]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-1 max-w-[calc(100%-8px)] rounded-full bg-[linear-gradient(90deg,rgba(251,191,36,0.30),rgba(251,191,36,0.08))]"
              style={{
                width: `calc(${unlockValue}% + 52px)`,
                transition: unlockValue === 0 ? "width 180ms ease" : "none",
              }}
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-xs font-black text-[#fde68a]"
              style={{
                opacity: Math.max(0.22, 1 - unlockValue / 82),
                transition: unlockValue === 0 ? "opacity 180ms ease" : "none",
              }}
            >
              slide to enable
            </div>
            <div
              aria-hidden="true"
              className="absolute top-1 grid h-[50px] w-[50px] place-items-center rounded-full border border-white/30 bg-[linear-gradient(180deg,#fff8e1,#fde68a)] text-[#713f12] shadow-[0_10px_24px_rgba(0,0,0,0.34)]"
              style={{
                left: `calc(4px + ${unlockValue}% - ${unlockValue * 0.58}px)`,
                transition: unlockValue === 0 ? "left 180ms ease" : "none",
              }}
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  ), portalTarget);
}

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
      className="mt-6 grid min-h-[58vh] place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-10"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="grid w-full max-w-4xl justify-items-center gap-8">
        <div className="relative grid h-36 w-36 place-items-center">
          <span className="absolute h-28 w-28 animate-ping rounded-full border border-[var(--accent-strong)] opacity-25" />
          <span className="absolute h-20 w-20 animate-pulse rounded-full border border-[rgba(185,139,47,0.28)]" />
          <span className="absolute h-px w-32 origin-center rotate-45 bg-gradient-to-r from-transparent via-[var(--accent-strong)] to-transparent opacity-45" />
          <span className="grid h-16 w-16 place-items-center rounded-[22px] border border-[var(--line)] bg-[var(--surface-soft)] shadow-[0_20px_50px_rgba(82,61,22,0.14)]">
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

const LOCAL_HIVEMIND_LINK_URL = "http://127.0.0.1:8788";

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
    if (!url.searchParams.get("api")) {
      url.searchParams.set("api", url.toString().replace(/\/$/, ""));
    }
    return url.toString();
  } catch {
    return openUrl;
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
  const [appPreferences, setAppPreferences] = useState<AppPreferenceRecord[]>([]);
  const [liveAppExpanded, setLiveAppExpanded] = useState(false);
  const [copiedRouteKey, setCopiedRouteKey] = useState("");
  const [taskActionStatus, setTaskActionStatus] = useState("");
  const [busyTaskAction, setBusyTaskAction] = useState("");
  const [installableServices, setInstallableServices] = useState<Record<string, InstallableServiceStatus>>({});
  const [busyServiceAction, setBusyServiceAction] = useState("");
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
    if (activeView !== "my-apps") return;
    let cancelled = false;
    fetch("/api/fleet/apps/preferences", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; preferences?: AppPreferenceRecord[] } | null) => {
        if (!cancelled && payload?.ok && Array.isArray(payload.preferences)) setAppPreferences(payload.preferences);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  const refreshInstallableServices = useCallback(async () => {
    const installable = AGENT_APP_CATALOG.filter((app) => app.installableServiceId);
    const bulkData = await fetch("/api/fleet/apps/installable-services", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .catch(() => null) as { ok?: boolean; services?: InstallableServiceStatus[] } | null;
    if (bulkData?.ok && Array.isArray(bulkData.services)) {
      const next: Record<string, InstallableServiceStatus> = {};
      for (const service of bulkData.services) next[service.id] = service;
      setInstallableServices(next);
      return;
    }
    const entries = await Promise.allSettled(installable.map(async (app) => {
      const id = app.installableServiceId!;
      const serviceResponse = await fetch(`/api/fleet/apps/installable-services?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await serviceResponse.json().catch(() => null) as { ok?: boolean; service?: InstallableServiceStatus } | null;
      return data?.ok && data.service ? [id, data.service] as const : null;
    }));
    const next: Record<string, InstallableServiceStatus> = {};
    for (const entry of entries) {
      if (entry.status === "fulfilled" && entry.value) next[entry.value[0]] = entry.value[1];
    }
    setInstallableServices(next);
  }, []);

  useEffect(() => {
    if (activeView !== "my-apps") return;
    const timer = window.setTimeout(() => {
      void refreshInstallableServices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, refreshInstallableServices]);

  const runInstallableServiceAction = useCallback(async (
    id: string,
    action: InstallableServiceAction,
    input?: { profileUrl?: string; maxPosts?: number; maxReplies?: number },
  ): Promise<InstallableServiceActionResponse | null> => {
    if (!confirmSensitiveInstallableServiceAction(action)) return null;
    setBusyServiceAction(`${id}:${action}`);
    setStatusTone("info");
    const label = installableServiceLabel(id, action);
    setStatus(`${label} ${id}...`);
    try {
      const response = await fetch("/api/fleet/apps/installable-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, input }),
      });
      const data = await response.json().catch(() => null) as InstallableServiceActionResponse | null;
      if (!response.ok || !data?.ok || !data.service) throw new Error(data?.error || "Service action failed.");
      setInstallableServices((current) => ({ ...current, [id]: data.service! }));
      setStatus(data.service.detail);
      if (!["status", "agent-reach-doctor", "check-agent-reach-x-auth", "test-agent-reach-x-profile"].includes(action)) await refresh(true);
      return data;
    } catch (error) {
      setStatusTone("error");
      setStatus(error instanceof Error ? error.message : "Service action failed.");
      return { ok: false, error: error instanceof Error ? error.message : "Service action failed." };
    } finally {
      setBusyServiceAction("");
    }
  }, [refresh]);

  const setBrowserUseFullPermissions = useCallback(async (fullAccess: boolean) => {
    setBusyServiceAction(`browser-use:permissions`);
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

  const refreshAllApps = useCallback(async () => {
    await Promise.all([
      refresh(true),
      refreshInstallableServices(),
    ]);
  }, [refresh, refreshInstallableServices]);

  const rememberAppPreference = useCallback((preference: AppPreferenceRecord) => {
    setAppPreferences((current) => [...current.filter((entry) => entry.appId !== preference.appId), preference]);
  }, []);

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
  const browserUsePermissionsBusy = busyServiceAction === "browser-use:permissions";

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
            <Button type="button" size="sm" variant="secondary" onClick={() => void refreshAllApps()} disabled={loading}>
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

            <AppPreferencesCard
              key={selectedApp.id}
              app={selectedApp}
              preference={matchAppPreference(selectedApp, appPreferences)}
              onSaved={rememberAppPreference}
            />
          </div>

          {selectedApp.interactive ? (
            <div
              className={
                liveAppExpanded
                  ? "fixed inset-0 z-[80] overflow-hidden border border-[var(--line)] bg-[var(--surface)]"
                  : "min-h-[520px] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]"
              }
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2">
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
          <Button type="button" size="sm" variant="secondary" onClick={() => void refreshAllApps()} disabled={loading}>
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
              {matchAppPreference(app, appPreferences)?.priority ? (
                <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border border-[rgba(251,191,36,0.4)] bg-[rgba(10,14,21,0.92)]">
                  <Star aria-hidden="true" className="h-3 w-3 fill-[#fbbf24] text-[#fbbf24]" />
                </span>
              ) : null}
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
          {AGENT_APP_CATALOG.map((app) => {
            const service = app.installableServiceId ? installableServices[app.installableServiceId] : undefined;
            const serviceAction = app.installableServiceId ? installableServiceAction(app.installableServiceId, service) : "install";
            const serviceBusy = app.installableServiceId ? busyServiceAction.startsWith(`${app.installableServiceId}:`) : false;
            const serviceBlocked = installableServiceBlocked(service, serviceAction);
            const servicePreflightActions = (service?.preflightActions ?? []).filter((preflightAction) => preflightAction.action !== "test-agent-reach-x-profile");
            return (
              <article key={app.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{app.category}</span>
                  <strong className="mt-1 block text-sm text-[var(--foreground)]">{app.name}</strong>
                </div>
                <p className="m-0 text-xs leading-5 text-[var(--muted)]">{app.description}</p>
                {service ? (
                  <p className="m-0 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] px-2 py-1.5 text-[11px] leading-4 text-[var(--muted)]">
                    {service.detail}
                  </p>
                ) : null}
                {service?.provenance ? (
                  <div className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.24)] px-2 py-1.5 text-[11px] leading-4 text-[var(--muted)]">
                    <span>
                      {service.provenance.packageManager}: {service.provenance.packageName}{service.version ? ` v${service.version}` : ""}
                    </span>
                    <span>{service.provenance.updatePolicy}</span>
                  </div>
                ) : null}
                {service?.securityNotes?.length ? (
                  <div className="grid gap-1 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.07)] px-2 py-1.5 text-[11px] leading-4 text-[var(--muted)]">
                    {service.securityNotes.slice(0, 3).map((note) => <span key={note}>{note}</span>)}
                  </div>
                ) : null}
                {service?.preflight?.length ? (
                  <div className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.20)] px-2 py-1.5 text-[11px] leading-4 text-[var(--muted)]">
                    {service.preflight.map((item) => (
                      <div key={item.key} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={[
                            "mt-[5px] block h-2 w-2 shrink-0 rounded-full",
                            item.ok ? "bg-[var(--accent-strong)]" : "bg-[#fbbf24]",
                          ].join(" ")}
                        />
                        <span>{item.detail}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {[...app.badges, ...app.handles.slice(0, 2)].map((label) => (
                    <span key={label} className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.58)] px-2 py-1 text-[11px] font-bold text-[var(--muted)]">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {app.installableServiceId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={serviceAction === "stop" ? "secondary" : "default"}
                      className="w-fit"
                      isLoading={serviceBusy}
                      disabled={serviceBusy || serviceBlocked}
                      onClick={() => void runInstallableServiceAction(app.installableServiceId!, serviceAction)}
                    >
                      <InstallableServiceActionIcon action={serviceAction} />
                      {installableServiceLabel(app.installableServiceId!, serviceAction, service)}
                    </Button>
                  ) : null}
                  {app.installableServiceId ? servicePreflightActions.map((preflightAction) => (
                    <Button
                      key={preflightAction.action}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="w-fit"
                      title={preflightAction.detail}
                      isLoading={busyServiceAction === `${app.installableServiceId}:${preflightAction.action}`}
                      disabled={serviceBusy || preflightAction.disabled}
                      onClick={() => void runInstallableServiceAction(app.installableServiceId!, preflightAction.action)}
                    >
                      <InstallableServiceActionIcon action={preflightAction.action} />
                      {installableServiceLabel(app.installableServiceId!, preflightAction.action, service)}
                    </Button>
                  )) : null}
                  {app.installableServiceId === "browser-use" && service?.permissions ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={service.permissions.fullAccess ? "secondary" : "default"}
                      className="w-fit"
                      isLoading={serviceBusy && busyServiceAction === "browser-use:permissions"}
                      disabled={serviceBusy}
                      onClick={() => {
                        if (service.permissions?.fullAccess) {
                          void setBrowserUseFullPermissions(false);
                          return;
                        }
                        setBrowserUsePermissionPromptOpen(true);
                      }}
                    >
                      <AlertTriangle aria-hidden="true" />
                      {service.permissions.fullAccess ? "Full permissions on" : "Full permissions"}
                    </Button>
                  ) : null}
                  {app.installableServiceId === "agent-reach" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="w-fit"
                      disabled={serviceBusy}
                      onClick={() => {
                        setAgentReachSetupOpen(true);
                        void runInstallableServiceAction("agent-reach", "status");
                      }}
                    >
                      <Sparkles aria-hidden="true" />
                      Setup
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="secondary" className="w-fit" asChild>
                    <a href={app.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" />
                      Source
                    </a>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {browserUsePermissionPromptOpen ? (
        <BrowserUseFullPermissionsModal
          busy={browserUsePermissionsBusy}
          onClose={() => {
            if (!browserUsePermissionsBusy) setBrowserUsePermissionPromptOpen(false);
          }}
          onUnlock={() => void setBrowserUseFullPermissions(true)}
        />
      ) : null}
      {agentReachSetupOpen ? (
        <AgentReachSetupWizard
          service={installableServices["agent-reach"]}
          busyAction={busyServiceAction}
          onAction={(action, input) => runInstallableServiceAction("agent-reach", action, input)}
          onClose={() => {
            if (!busyServiceAction.startsWith("agent-reach:")) setAgentReachSetupOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
