"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import "./apps.css";
import { InstallModal } from "./AppsInstall";
import { AppGlyph, Badge, BBtn, BIcon, Pill, Summary } from "./apps-ui";
import type {
  FoundryApiRoute,
  FoundryCatalogApp,
  FoundryHost,
  FoundryHostedApp,
  FoundryInstallJob,
  FoundryRunningTask,
  FoundryServiceActionResult,
  FoundrySummary,
  FoundryTheme,
  InstallableServiceAction,
} from "./apps-types";

const PANELS = [
  { id: "hosted", label: "Hosted Apps", title: "Hosted Apps", subtitle: "running across your fleet" },
  { id: "catalog", label: "Catalog", title: "App Catalog", subtitle: "install and manage provider apps" },
] as const;

const HOSTED_FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "tend", label: "Needs attention" },
  { id: "stopped", label: "Stopped" },
] as const;

const REACH_COPY = {
  operator: "Only you",
  agents: "You + agents",
  tailnet: "Anyone on the tailnet",
} satisfies Record<FoundryHostedApp["reach"], string>;

const STATE_COPY = {
  running: { label: "Running", tone: "live" as const, dot: "var(--live)" },
  stopped: { label: "Stopped", tone: undefined, dot: "var(--fg-4)" },
  error: { label: "Error", tone: "danger" as const, dot: "var(--danger)" },
  updating: { label: "Updating", tone: "honey" as const, dot: "var(--honey)" },
} satisfies Record<FoundryHostedApp["state"], { label: string; tone?: "live" | "honey" | "danger"; dot: string }>;

type AppsViewProps = {
  theme: FoundryTheme;
  hostedApps: FoundryHostedApp[];
  catalogApps: FoundryCatalogApp[];
  hosts: FoundryHost[];
  summary: FoundrySummary;
  loading?: boolean;
  status?: string;
  statusTone?: "info" | "error";
  checkedAtLabel?: string;
  busyAction?: string;
  onRefresh: () => void;
  onRunServiceAction: (app: FoundryCatalogApp, action: InstallableServiceAction) => Promise<FoundryServiceActionResult | null>;
  onRunTaskAction?: (app: FoundryHostedApp, task: FoundryRunningTask, action: "cancel-task" | "kill-task") => Promise<void>;
  onRequestBrowserPermissions?: (app: FoundryCatalogApp, fullAccess: boolean) => void;
  onOpenAgentReachSetup?: () => void;
  renderAppPreferences?: (app: FoundryHostedApp) => ReactNode;
};

function hostedMatch(app: FoundryHostedApp, filter: string) {
  if (filter === "running") return app.state === "running";
  if (filter === "stopped") return app.state === "stopped";
  if (filter === "tend") return app.state === "error" || Boolean(app.updateTo);
  return true;
}

function displayUrl(app: FoundryHostedApp) {
  try {
    const url = new URL(app.openUrl);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return `${app.machine}:${app.port}`;
  }
}

function canOpenRoute(route: FoundryApiRoute) {
  return route.method.toUpperCase() === "GET" && !/[{}]/.test(route.path);
}

function routeTone(method: string) {
  const normalized = method.toUpperCase();
  if (normalized === "GET") return "live";
  if (normalized === "POST") return "honey";
  return "plain";
}

function routeGroups(routes: FoundryApiRoute[]) {
  const groups = new Map<string, FoundryApiRoute[]>();
  for (const route of routes) {
    const category = route.category || "API";
    groups.set(category, [...(groups.get(category) ?? []), route]);
  }
  return [...groups.entries()];
}

function taskProgressLabel(task: FoundryRunningTask) {
  const progress = typeof task.progressPercent === "number" ? `${Math.round(task.progressPercent)}%` : "No progress reported";
  if (typeof task.currentRound === "number" && typeof task.totalRounds === "number" && task.totalRounds > 0) {
    return `${progress} - round ${task.currentRound}/${task.totalRounds}`;
  }
  if (typeof task.currentRound === "number") return `${progress} - round ${task.currentRound}`;
  return progress;
}

function taskTimeLabel(value: string | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadge(state: FoundryHostedApp["state"]) {
  const st = STATE_COPY[state] ?? STATE_COPY.stopped;
  return (
    <Badge tone={st.tone}>
      {state === "running" ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--live)" }} /> : null}
      {st.label}
    </Badge>
  );
}

function CompactAppCard({ app, onOpen }: { app: FoundryHostedApp; onOpen: () => void }) {
  const st = STATE_COPY[app.state] ?? STATE_COPY.stopped;
  const live = app.state === "running";
  const tone = app.state === "error" ? "danger" : app.state === "stopped" ? "muted" : undefined;
  const action = app.state === "stopped" ? "Start" : app.state === "error" ? "Inspect" : "Open";

  return (
    <button type="button" className="fa-cc" data-tone={tone} onClick={onOpen}>
      <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        <AppGlyph app={app} />
        <span style={{ minWidth: 0, flex: "1 1 auto", textAlign: "left" }}>
          <span className="fa-name">{app.name}</span>
          <span className="fa-sub">{displayUrl(app)}</span>
        </span>
        {app.priority ? <Badge tone="honey">Priority</Badge> : null}
        <span className={`fa-pdot${live ? " fr-dot live" : ""}`} style={{ color: st.dot, background: st.dot }} title={st.label} />
      </span>

      <span className="fa-desc">{app.desc}</span>

      <span className="fa-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="fa-meta-chip">{app.category} - v{app.version}{app.updateTo ? " - update" : ""}</span>
        <span className="fa-open" style={{ flex: "0 0 auto" }}>
          {action} <BIcon name="external" size={12} />
        </span>
      </span>
    </button>
  );
}

function RunningTasks({
  app,
  busy,
  onRunTaskAction,
}: {
  app: FoundryHostedApp;
  busy: boolean;
  onRunTaskAction?: AppsViewProps["onRunTaskAction"];
}) {
  const tasks = app.runningTasks ?? [];
  if (!tasks.length) return null;
  return (
    <div className="fa-logs" style={{ gap: 10 }}>
      <div className="fa-logline">
        <span className="t">Tasks</span>
        <span className="m">{tasks.length} active service task{tasks.length === 1 ? "" : "s"}</span>
      </div>
      {tasks.map((task) => (
        <div key={task.id} className="fa-task-row">
          <div style={{ minWidth: 0 }}>
            <strong>{task.title}</strong>
            <span>{task.status} - {taskProgressLabel(task)}</span>
            {task.startedAt ? <span>Started {taskTimeLabel(task.startedAt)}</span> : null}
            {task.updatedAt ? <span>Last update {taskTimeLabel(task.updatedAt)}</span> : null}
            {task.detail ? <span>{task.detail}</span> : null}
            {task.stuckReason ? <span style={{ color: "var(--honey)" }}>{task.stuckReason}</span> : null}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {task.canCancel ? (
              <button type="button" className="fa-act" disabled={busy} onClick={() => void onRunTaskAction?.(app, task, "cancel-task")}>
                Cancel
              </button>
            ) : null}
            {task.canKill ? (
              <button type="button" className="fa-act" data-danger="" disabled={busy} onClick={() => void onRunTaskAction?.(app, task, "kill-task")}>
                Kill
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailedAppCard({
  app,
  busy,
  onCollapse,
  onServiceAction,
  onRunTaskAction,
  renderAppPreferences,
}: {
  app: FoundryHostedApp;
  busy: boolean;
  onCollapse: () => void;
  onServiceAction: (app: FoundryHostedApp) => void;
  onRunTaskAction?: AppsViewProps["onRunTaskAction"];
  renderAppPreferences?: AppsViewProps["renderAppPreferences"];
}) {
  const [logsOpen, setLogsOpen] = useState(app.state === "error");
  const [routesOpen, setRoutesOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveExpanded, setLiveExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRouteKey, setCopiedRouteKey] = useState("");
  const shared = app.reach === "tailnet";
  const st = STATE_COPY[app.state] ?? STATE_COPY.stopped;
  const canManage = Boolean(app.serviceAction && !app.serviceActionDisabled);
  const routes = app.apiRoutes ?? [];
  const routeSections = routeGroups(routes);
  const serviceUrl = app.healthUrl || app.apiBaseUrl || app.openUrl;
  const launchUrl = app.interactive ? app.openUrl : serviceUrl;

  useEffect(() => {
    if (!liveExpanded) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLiveExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [liveExpanded]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(launchUrl).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const copyRoute = async (route: FoundryApiRoute) => {
    const key = `${route.method}:${route.path}`;
    await navigator.clipboard.writeText(route.url || route.path).catch(() => undefined);
    setCopiedRouteKey(key);
    window.setTimeout(() => setCopiedRouteKey(""), 1400);
  };

  const metas = [
    ["Host", app.machine],
    ["Port", String(app.port)],
    ["Version", app.version],
    ["Uptime", app.state === "running" ? app.uptime || "Live" : "-"],
    ["CPU", typeof app.cpu === "number" ? `${app.cpu}%` : "-"],
    ["Memory", typeof app.ram === "number" ? `${app.ram}%` : "-"],
  ];

  return (
    <div className="fa-card" data-tone={app.state === "error" ? "danger" : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <button type="button" className="fa-x" onClick={onCollapse} aria-label="Collapse" style={{ transform: "rotate(45deg)" }}>
          <BIcon name="plus" size={15} sw={2} />
        </button>
        <AppGlyph app={app} size={40} />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "0" }}>{app.name}</div>
          <div className="fa-sub" style={{ fontSize: 11 }}>{app.category} - {app.source}</div>
        </div>
        {app.priority ? <Badge tone="honey">Priority</Badge> : null}
        {statusBadge(app.state)}
      </div>

      {app.alert ? (
        <div className="fa-banner"><BIcon name="alert" size={15} /><span>{app.alert}</span></div>
      ) : null}

      <div className="fa-url">
        <span className="u">{launchUrl}</span>
        <button type="button" className="fa-x" style={{ width: 34, height: 34 }} onClick={copyUrl} title="Copy URL">
          <BIcon name={copied ? "check" : "copy"} size={15} />
        </button>
        <button type="button" className="fa-x" style={{ width: 34, height: 34 }} title="Open" disabled={app.state !== "running"} onClick={() => window.open(launchUrl, "_blank", "noopener,noreferrer")}>
          <BIcon name="external" size={15} />
        </button>
      </div>

      <div className="fa-metas">
        {metas.map(([key, value]) => (
          <div key={key}>
            <div className="k">{key}</div>
            <div className="v">
              {value}
              {key === "Version" && app.updateTo ? <Badge tone="honey">update {app.updateTo}</Badge> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="fa-share">
        <div>
          <strong>Reachable by</strong>
          <small>{shared ? REACH_COPY.tailnet : REACH_COPY[app.reach]}{app.agents ? ` - ${app.agents} agent${app.agents > 1 ? "s" : ""} connected` : ""}</small>
        </div>
        <span className="fa-meta-chip">{shared ? "Tailnet" : "Local only"}</span>
      </div>

      <div className="fa-actions">
        <button type="button" className="fa-act" data-primary={app.state === "running" ? "" : undefined} disabled={app.state !== "running"} onClick={() => window.open(launchUrl, "_blank", "noopener,noreferrer")}>
          <BIcon name="external" size={14} /> Open
        </button>
        {canManage ? (
          <button type="button" className="fa-act" disabled={busy} onClick={() => onServiceAction(app)}>
            <BIcon name={app.serviceAction === "stop" ? "plug" : "download"} size={14} /> {app.serviceActionLabel}
          </button>
        ) : (
          <button type="button" className="fa-act" disabled title="Start/stop is only wired for installable local services.">
            <BIcon name="plug" size={14} /> Read-only
          </button>
        )}
        {routes.length ? (
          <button type="button" className="fa-act" data-active={routesOpen ? "" : undefined} onClick={() => setRoutesOpen((value) => !value)}>
            <BIcon name="doc" size={14} /> Routes
          </button>
        ) : null}
        {app.interactive ? (
          <button type="button" className="fa-act" data-active={liveOpen ? "" : undefined} disabled={app.state !== "running"} onClick={() => setLiveOpen((value) => !value)}>
            <BIcon name="doc" size={14} /> Live app
          </button>
        ) : null}
        <button type="button" className="fa-act" data-active={logsOpen ? "" : undefined} onClick={() => setLogsOpen((value) => !value)}>
          <BIcon name="doc" size={14} /> Logs
        </button>
      </div>

      {!app.interactive ? (
        <div className="fa-endpoints">
          <strong>Service endpoint</strong>
          <code>{app.apiBaseUrl || app.openUrl}</code>
          {app.healthUrl ? <code>{app.healthUrl}</code> : null}
          {app.apiRoutesSource ? <span>{app.apiRoutesSource === "openapi" ? "OpenAPI" : "Hivemind catalog"}</span> : null}
        </div>
      ) : null}

      {app.interactive && liveOpen ? (
        <div className="fa-live-frame" data-expanded={liveExpanded ? "" : undefined}>
          <div className="fa-live-head">
            <span>Live app</span>
            <div>
              <button type="button" className="fa-act" onClick={() => setLiveExpanded((value) => !value)}>
                <BIcon name="external" size={13} /> {liveExpanded ? "Exit full screen" : "Full screen"}
              </button>
              <button type="button" className="fa-act" onClick={() => setLiveOpen(false)}>
                <BIcon name="plus" size={13} /> Close
              </button>
            </div>
          </div>
          <iframe
            title={app.name}
            src={app.openUrl}
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
          />
        </div>
      ) : null}

      {logsOpen ? (
        <div className="fa-logs">
          {(app.logs.length ? app.logs : [["now", `${st.label} - no service log lines published yet.`]]).map(([time, message], index) => (
            <div key={`${time}-${index}`} className="fa-logline"><span className="t">{time}</span><span className="m">{message}</span></div>
          ))}
        </div>
      ) : null}

      <RunningTasks app={app} busy={busy} onRunTaskAction={onRunTaskAction} />

      {routesOpen ? (
        <div className="fa-routes">
          {app.apiRoutesSource ? (
            <div className="fa-route-source">{app.apiRoutesSource === "openapi" ? "OpenAPI" : "Hivemind catalog"}</div>
          ) : null}
          {routeSections.map(([category, categoryRoutes]) => (
            <section key={category}>
              <div className="fa-route-head"><strong>{category}</strong><span>{categoryRoutes.length}</span></div>
              {categoryRoutes.map((route) => (
                <article key={`${route.method}:${route.path}`} className="fa-route-row">
                  <div>
                    <Badge tone={routeTone(route.method)}>{route.method.toUpperCase()}</Badge>
                    <code>{route.path}</code>
                    {route.summary ? <p>{route.summary}</p> : null}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="fa-act" onClick={() => void copyRoute(route)}>
                      <BIcon name={copiedRouteKey === `${route.method}:${route.path}` ? "check" : "copy"} size={13} /> {copiedRouteKey === `${route.method}:${route.path}` ? "Copied" : "Copy"}
                    </button>
                    {canOpenRoute(route) ? (
                      <button type="button" className="fa-act" onClick={() => window.open(route.url, "_blank", "noopener,noreferrer")}>
                        <BIcon name="external" size={13} /> Open
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {renderAppPreferences ? <div className="fa-pref-wrap">{renderAppPreferences(app)}</div> : null}
    </div>
  );
}

function IconCell({ app, active, onOpen }: { app: FoundryHostedApp; active: boolean; onOpen: () => void }) {
  const st = STATE_COPY[app.state] ?? STATE_COPY.stopped;
  const live = app.state === "running";
  const tone = app.state === "error" ? "danger" : undefined;
  return (
    <button type="button" className="fa-iconcell" data-active={active ? "" : undefined} data-tone={tone} onClick={onOpen} title={`${app.name} - ${displayUrl(app)}`}>
      <span className="fa-iconwrap">
        <AppGlyph app={app} size={58} radius={14} />
        <span className={`sd${live ? " fr-dot live" : ""}`} style={{ color: st.dot, background: st.dot }} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: "100%" }}>
        <span className="fa-iconname">{app.name}</span>
        <span className="fa-iconsub">{app.machine}:{app.port}</span>
        {app.priority ? <span className="fa-iconsub" style={{ color: "var(--honey)" }}>Priority</span> : null}
      </span>
    </button>
  );
}

function HostedPanel({
  apps,
  busy,
  loading,
  onDeploy,
  onServiceAction,
  onRunTaskAction,
  renderAppPreferences,
}: {
  apps: FoundryHostedApp[];
  busy: boolean;
  loading?: boolean;
  onDeploy: () => void;
  onServiceAction: (app: FoundryHostedApp) => void;
  onRunTaskAction?: AppsViewProps["onRunTaskAction"];
  renderAppPreferences?: AppsViewProps["renderAppPreferences"];
}) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [density, setDensity] = useState<"cards" | "icons">("cards");
  const list = apps.filter((app) => hostedMatch(app, filter));
  const openApp = apps.find((app) => app.id === open);

  return (
    <div className="fb-fade">
      <div className="fa-toolbar">
        <div className="fb-pills">
          {HOSTED_FILTERS.map((entry) => (
            <Pill key={entry.id} active={filter === entry.id} onClick={() => setFilter(entry.id)}>{entry.label}</Pill>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="fa-density" role="tablist" aria-label="View density">
            <button type="button" data-active={density === "cards" ? "" : undefined} onClick={() => setDensity("cards")} title="Card view">
              <BIcon name="doc" /> Cards
            </button>
            <button type="button" data-active={density === "icons" ? "" : undefined} onClick={() => setDensity("icons")} title="Icon view">
              <BIcon name="plus" /> Icons
            </button>
          </div>
          <BBtn variant="primary" sm onClick={onDeploy}><BIcon name="plus" size={14} /> Deploy app</BBtn>
        </div>
      </div>

      {list.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--fg-3)", padding: "30px 0", textAlign: "center" }}>
          {filter === "all"
            ? loading
              ? "Scanning Tailnet for apps and services..."
              : "No apps or services found yet. Start something on a ready hivenet machine, then refresh."
            : "No apps match this filter."}
        </p>
      ) : density === "icons" ? (
        <>
          <div className="fa-icongrid">
            {list.map((app) => (
              <IconCell key={app.id} app={app} active={open === app.id} onOpen={() => setOpen(open === app.id ? null : app.id)} />
            ))}
          </div>
          {openApp ? (
            <div style={{ marginTop: 16 }}>
              <DetailedAppCard app={openApp} busy={busy} onCollapse={() => setOpen(null)} onServiceAction={onServiceAction} onRunTaskAction={onRunTaskAction} renderAppPreferences={renderAppPreferences} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="fa-grid">
          {list.map((app) => (
            open === app.id
              ? <DetailedAppCard key={app.id} app={app} busy={busy} onCollapse={() => setOpen(null)} onServiceAction={onServiceAction} onRunTaskAction={onRunTaskAction} renderAppPreferences={renderAppPreferences} />
              : <CompactAppCard key={app.id} app={app} onOpen={() => setOpen(app.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function enabledHosts(hosts: FoundryHost[]) {
  return hosts.filter((host) => !host.disabled);
}

function CatalogCard({
  app,
  hosts,
  busy,
  onStartJob,
  onRequestBrowserPermissions,
  onOpenAgentReachSetup,
}: {
  app: FoundryCatalogApp;
  hosts: FoundryHost[];
  busy: boolean;
  onStartJob: (app: FoundryCatalogApp, host: FoundryHost, action: InstallableServiceAction, label: string) => void;
  onRequestBrowserPermissions?: AppsViewProps["onRequestBrowserPermissions"];
  onOpenAgentReachSetup?: AppsViewProps["onOpenAgentReachSetup"];
}) {
  const firstHost = enabledHosts(hosts)[0] ?? hosts[0];
  const [installing, setInstalling] = useState(false);
  const [hostId, setHostId] = useState(firstHost?.id ?? "");
  const host = hosts.find((item) => item.id === hostId && !item.disabled) ?? firstHost;
  const installed = Boolean(app.serviceInstalled || app.installed);
  const primaryAction = app.primaryAction;
  const primaryLabel = app.primaryActionLabel || "Install";

  return (
    <div className="fa-catcard">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <AppGlyph app={app} size={40} />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0", fontFamily: "var(--f-display)" }}>{app.name}</span>
            {app.featured && !installed ? <Badge tone="honey">Featured</Badge> : null}
            {installed ? <Badge tone="live">Installed</Badge> : null}
            {app.serviceRunning ? <Badge tone="live">Running</Badge> : null}
          </div>
          <div className="fa-sub" style={{ fontSize: 10.5 }}>{app.source} - {app.req}</div>
        </div>
      </div>

      <p className="fa-desc body">{app.desc}</p>

      {app.serviceDetail ? (
        <div className="fa-service-detail">{app.serviceDetail}</div>
      ) : null}

      {app.provenance ? (
        <div className="fa-provenance">
          <span>{app.provenance.packageManager}: {app.provenance.packageName}{app.serviceVersion ? ` v${app.serviceVersion}` : ""}</span>
          <span>{app.provenance.updatePolicy}</span>
        </div>
      ) : null}

      {app.preflight?.length ? (
        <div className="fa-preflight">
          {app.preflight.map((item) => (
            <div key={item.key}>
              <span aria-hidden style={{ background: item.ok ? "var(--live)" : "var(--honey)" }} />
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      ) : null}

      {app.securityNotes?.length ? (
        <div className="fa-security">
          {app.securityNotes.slice(0, 3).map((note) => <small key={note}>{note}</small>)}
        </div>
      ) : null}

      <div className="fa-chiprow">
        {[...app.badges, ...app.handles.slice(0, 2)].map((label) => <span key={label}>{label}</span>)}
      </div>

      {!installing ? (
        <div className="fa-catfoot">
          <span className="fa-tag">{app.category}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "flex-end" }}>
            {app.serviceOpenUrl && installed ? (
              <BBtn sm onClick={() => window.open(app.serviceOpenUrl, "_blank", "noopener,noreferrer")}><BIcon name="external" size={13} /> Open</BBtn>
            ) : null}
            {primaryAction ? (
              <BBtn variant={primaryAction === "stop" ? "ghost" : "primary"} sm disabled={busy || app.primaryActionDisabled} onClick={() => setInstalling(true)}>
                <BIcon name={primaryAction === "stop" ? "plug" : "download"} size={13} /> {primaryLabel}
              </BBtn>
            ) : null}
            <BBtn sm onClick={() => window.open(app.sourceUrl, "_blank", "noopener,noreferrer")}><BIcon name="external" size={13} /> Source</BBtn>
          </div>
        </div>
      ) : (
        <div className="fa-install">
          <select className="fb-select" value={hostId} onChange={(event) => setHostId(event.target.value)}>
            {hosts.map((target) => (
              <option key={target.id} value={target.id} disabled={target.disabled}>
                {target.label} - {target.kind}{target.disabled ? " (read-only)" : ""}
              </option>
            ))}
          </select>
          <BBtn
            variant="primary"
            sm
            disabled={!host || !primaryAction}
            onClick={() => {
              if (!host || !primaryAction) return;
              onStartJob(app, host, primaryAction, primaryLabel);
              setInstalling(false);
            }}
          >
            <BIcon name="check" size={13} /> Continue
          </BBtn>
        </div>
      )}

      {app.preflightActions?.length || app.permissions || app.installableServiceId === "agent-reach" ? (
        <div className="fa-card-actions">
          {app.preflightActions?.map((action) => (
            <button
              key={action.action}
              type="button"
              className="fa-act"
              disabled={busy || action.disabled || !host}
              title={action.detail}
              onClick={() => { if (host) onStartJob(app, host, action.action, action.label); }}
            >
              <BIcon name="refresh" size={13} /> {action.label}
            </button>
          ))}
          {app.permissions ? (
            <button type="button" className="fa-act" disabled={busy} onClick={() => onRequestBrowserPermissions?.(app, !app.permissions?.fullAccess)}>
              <BIcon name="alert" size={13} /> {app.permissions.fullAccess ? "Full permissions on" : "Full permissions"}
            </button>
          ) : null}
          {app.installableServiceId === "agent-reach" ? (
            <button type="button" className="fa-act" disabled={busy} onClick={onOpenAgentReachSetup}>
              <BIcon name="plus" size={13} /> Setup
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CatalogPanel({
  apps,
  hosts,
  busy,
  onStartJob,
  onRequestBrowserPermissions,
  onOpenAgentReachSetup,
}: {
  apps: FoundryCatalogApp[];
  hosts: FoundryHost[];
  busy: boolean;
  onStartJob: (app: FoundryCatalogApp, host: FoundryHost, action: InstallableServiceAction, label: string) => void;
  onRequestBrowserPermissions?: AppsViewProps["onRequestBrowserPermissions"];
  onOpenAgentReachSetup?: AppsViewProps["onOpenAgentReachSetup"];
}) {
  const categories = useMemo(() => ["all", ...Array.from(new Set(apps.map((app) => app.category)))], [apps]);
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = apps.filter((app) =>
    (category === "all" || app.category === category) &&
    (!query || `${app.name} ${app.desc} ${app.badges.join(" ")} ${app.handles.join(" ")}`.toLowerCase().includes(query))
  );
  const sections = category === "all"
    ? categories.filter((item) => item !== "all").map((item) => ({ label: item, items: matches.filter((app) => app.category === item) })).filter((section) => section.items.length)
    : [{ label: null, items: matches }];

  return (
    <div className="fb-fade">
      <div className="fa-toolbar">
        <div className="fb-pills">
          {categories.map((item) => (
            <Pill key={item} active={category === item} onClick={() => setCategory(item)}>{item === "all" ? "All" : item}</Pill>
          ))}
        </div>
        <label className="fa-search">
          <BIcon name="search" size={15} />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search the catalog..." aria-label="Search the catalog" />
        </label>
      </div>

      {sections.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--fg-3)", padding: "30px 0", textAlign: "center" }}>No apps match "{q}".</p>
      ) : sections.map((section, index) => (
        <Fragment key={section.label || index}>
          {section.label ? <div className="fa-cat-section">{section.label}</div> : null}
          <div className="fa-catgrid">
            {section.items.map((app) => (
              <CatalogCard
                key={app.id}
                app={app}
                hosts={hosts}
                busy={busy}
                onStartJob={onStartJob}
                onRequestBrowserPermissions={onRequestBrowserPermissions}
                onOpenAgentReachSetup={onOpenAgentReachSetup}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function DeployModal({
  apps,
  hosts,
  onClose,
  onStartJob,
}: {
  apps: FoundryCatalogApp[];
  hosts: FoundryHost[];
  onClose: () => void;
  onStartJob: (app: FoundryCatalogApp, host: FoundryHost, action: InstallableServiceAction, label: string) => void;
}) {
  const installable = apps.filter((app) => app.primaryAction && !app.primaryActionDisabled);
  const activeHosts = enabledHosts(hosts);
  const [appId, setAppId] = useState(installable[0]?.id ?? "");
  const [hostId, setHostId] = useState(activeHosts[0]?.id ?? hosts[0]?.id ?? "");
  const app = installable.find((item) => item.id === appId) ?? installable[0];
  const host = hosts.find((item) => item.id === hostId && !item.disabled) ?? activeHosts[0] ?? hosts[0];

  return (
    <div className="fa-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="fa-modal" role="dialog" aria-modal="true" aria-label="Deploy an app">
        <div className="fa-modal-head">
          <div>
            <div className="fb-eyebrow" style={{ marginBottom: 7 }}>Deploy</div>
            <h3>Deploy an app</h3>
            <p>Choose an installable provider and target. Today, managed installs run through the reviewed local HivemindOS service catalog.</p>
          </div>
          <button type="button" className="fa-x" onClick={onClose} aria-label="Close" style={{ transform: "rotate(45deg)" }}>
            <BIcon name="plus" size={15} sw={2} />
          </button>
        </div>
        <div className="fa-modal-body">
          {installable.length ? (
            <>
              <label className="fb-label">App
                <select className="fb-select" value={appId} onChange={(event) => setAppId(event.target.value)}>
                  {installable.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.category}</option>)}
                </select>
              </label>
              <label className="fb-label">Machine
                <select className="fb-select" value={hostId} onChange={(event) => setHostId(event.target.value)}>
                  {hosts.map((item) => (
                    <option key={item.id} value={item.id} disabled={item.disabled}>
                      {item.label} - {item.kind}{item.disabled ? " (read-only)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {host?.detail ? <p className="fa-help">{host.detail}</p> : null}
            </>
          ) : (
            <p className="fa-help">No automated catalog actions are available right now.</p>
          )}
        </div>
        <div className="fa-modal-foot">
          <BBtn onClick={onClose}>Cancel</BBtn>
          <BBtn
            variant="primary"
            disabled={!app || !host || !app.primaryAction}
            onClick={() => {
              if (!app || !host || !app.primaryAction) return;
              onStartJob(app, host, app.primaryAction, app.primaryActionLabel || "Install");
              onClose();
            }}
          >
            <BIcon name="plus" size={14} /> Deploy
          </BBtn>
        </div>
      </div>
    </div>
  );
}

function AppsModeHeader({
  panel,
  summary,
  checkedAtLabel,
  loading,
  onPanel,
  onRefresh,
}: {
  panel: string;
  summary: FoundrySummary;
  checkedAtLabel?: string;
  loading?: boolean;
  onPanel: (panel: "hosted" | "catalog") => void;
  onRefresh: () => void;
}) {
  const copy = PANELS.find((item) => item.id === panel) ?? PANELS[0];
  return (
    <header style={{ padding: "20px 30px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 11, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, letterSpacing: "0" }}>{copy.title}</span>
          <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{copy.subtitle}</span>
          {checkedAtLabel ? <span className="fa-refresh-stamp">{checkedAtLabel}</span> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <Summary n={summary.total} label="apps" />
          <Summary n={summary.running} label="running" live tone="var(--live)" />
          <Summary n={summary.machines} label="machines" />
          <Summary n={summary.updates} label="updates" tone={summary.updates ? "var(--honey)" : undefined} />
          <BBtn sm onClick={onRefresh} disabled={loading}><BIcon name="refresh" size={13} /> {loading ? "Refreshing" : "Refresh"}</BBtn>
        </div>
      </div>
      <div className="fb-seg" style={{ marginTop: 16 }}>
        {PANELS.map((item) => (
          <button key={item.id} type="button" data-active={panel === item.id ? "" : undefined} onClick={() => onPanel(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}

export function AppsView({
  theme,
  hostedApps,
  catalogApps,
  hosts,
  summary,
  loading,
  status,
  statusTone = "info",
  checkedAtLabel,
  busyAction,
  onRefresh,
  onRunServiceAction,
  onRunTaskAction,
  onRequestBrowserPermissions,
  onOpenAgentReachSetup,
  renderAppPreferences,
}: AppsViewProps) {
  const [panel, setPanel] = useState<"hosted" | "catalog">("hosted");
  const [deployOpen, setDeployOpen] = useState(false);
  const [installJob, setInstallJob] = useState<FoundryInstallJob | null>(null);
  const busy = Boolean(busyAction);
  const usableHosts = hosts.length ? hosts : [{ id: "local", label: "This Mac", kind: "Local" }];

  const startJob = (app: FoundryCatalogApp, host: FoundryHost, action: InstallableServiceAction, label: string) => {
    setInstallJob({
      id: `${app.id}:${action}:${Date.now()}`,
      app,
      host,
      action,
      actionLabel: label,
    });
  };

  const startHostedServiceAction = (app: FoundryHostedApp) => {
    if (!app.installableServiceId || !app.serviceAction) return;
    const catalog = catalogApps.find((item) => item.installableServiceId === app.installableServiceId);
    const host = usableHosts.find((item) => !item.disabled) ?? usableHosts[0];
    if (!catalog || !host) return;
    startJob(catalog, host, app.serviceAction, app.serviceActionLabel || "Manage");
  };

  const runJob = async (job: FoundryInstallJob) => onRunServiceAction(job.app, job.action);

  return (
    <section className="fr-app fa-foundry-root" style={{ height: "calc(100vh - 24px)" }}>
      <div className="fr-root" data-fr-theme={theme} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", position: "relative", overflow: "hidden" }}>
        <AppsModeHeader
          panel={panel}
          summary={summary}
          checkedAtLabel={checkedAtLabel}
          loading={loading}
          onPanel={setPanel}
          onRefresh={onRefresh}
        />
        {status ? (
          <div className={`fa-status ${statusTone}`}>
            <BIcon name={statusTone === "error" ? "alert" : "check"} size={14} />
            <span>{status}</span>
          </div>
        ) : null}
        <div className="fr-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          <div className="fb-wrap">
            {panel === "catalog" ? (
              <CatalogPanel
                apps={catalogApps}
                hosts={usableHosts}
                busy={busy}
                onStartJob={startJob}
                onRequestBrowserPermissions={onRequestBrowserPermissions}
                onOpenAgentReachSetup={onOpenAgentReachSetup}
              />
            ) : (
              <HostedPanel
                apps={hostedApps}
                busy={busy}
                loading={loading}
                onDeploy={() => setDeployOpen(true)}
                onServiceAction={startHostedServiceAction}
                onRunTaskAction={onRunTaskAction}
                renderAppPreferences={renderAppPreferences}
              />
            )}
          </div>
        </div>
        {deployOpen ? (
          <DeployModal
            apps={catalogApps}
            hosts={usableHosts}
            onClose={() => setDeployOpen(false)}
            onStartJob={startJob}
          />
        ) : null}
        {installJob ? (
          <InstallModal
            key={installJob.id}
            job={installJob}
            busy={busy}
            onRun={runJob}
            onClose={() => setInstallJob(null)}
          />
        ) : null}
      </div>
    </section>
  );
}

export default AppsView;
