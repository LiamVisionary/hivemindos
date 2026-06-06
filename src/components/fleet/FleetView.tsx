// src/components/fleet/FleetView.tsx
"use client";

import * as React from "react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BeeIcon } from "./bee-icon";
import { HexTile } from "./hex-tile";
import { ListView } from "./list-view";
import { MapView } from "./map-view";
import { NetworkGraph } from "./network-graph";
import { FleetConstellationLoading, FleetDispatchLoading, FleetRosterLoading, FleetScanOverlay } from "./fleet-loading";
import { Roster, type AeonDeleteDepth, type AeonDeleteProgress, type AeonDeleteResult, type MachineUpdateButtonDetail, type MachineUpdateButtonStatus } from "./roster";
import {
  ALERTS,
  MACHINES,
  TASKS,
  TICKER,
  FLEET_EDGES,
  type FleetAlert,
  type FleetAgent,
  type FleetAgentChat,
  type FleetMachine,
  type FleetTask,
} from "./fleet-data";
import styles from "./fleet-tokens.module.css";

type ViewMode = "graph" | "map" | "list";
const DISMISSED_ALERTS_STORAGE_KEY = "hivemindos.fleet.dismissedAlerts.v1";

type SettledFleetViewData = {
  machines: FleetMachine[];
  tasks: FleetTask[];
  alerts: FleetAlert[];
  ticker: string[];
  edges: Array<[string, string]>;
  hasValue: boolean;
};

export interface FleetViewProps {
  machines?: FleetMachine[];
  tasks?: FleetTask[];
  alerts?: FleetAlert[];
  ticker?: string[];
  edges?: Array<[string, string]>;
  loading?: boolean;
  checkedLabel?: string;
  tailnetLabel?: string;
  mastheadMode?: "all" | "mobile" | "none";
  /** Optional override hooks so the parent app can wire actions to real APIs. */
  onAddAgent?: (m: FleetMachine) => void;
  onAddMachine?: () => void;
  updateStatusByMachine?: Record<string, MachineUpdateButtonStatus>;
  updateDetailByMachine?: Record<string, MachineUpdateButtonDetail>;
  onUpdateMachine?: (m: FleetMachine) => void;
  onRenameMachine?: (machineId: string, name: string) => void;
  onOpenCodeProof?: (m: FleetMachine) => void;
  onFixSyncIssue?: (m: FleetMachine) => void | Promise<void>;
  onOpenChat?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenTaskChat?: (m: FleetMachine, a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (m: FleetMachine, a: FleetAgent) => Promise<void> | void;
  onOpenWallet?: (m: FleetMachine, a: FleetAgent) => void;
  onEditSettings?: (m: FleetMachine, a: FleetAgent) => void;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (m: FleetMachine, a: FleetAgent, depth?: AeonDeleteDepth, onProgress?: (progress: AeonDeleteProgress) => void) => void | Promise<AeonDeleteResult | void>;
  onDismissAlert?: (alert: FleetAlert) => void;
}

function preferredInitialMachineId(machines: FleetMachine[]) {
  return machines.find((machine) => machine.name === "This Mac" || machine.role === "Primary")?.id
    ?? machines[0]?.id
    ?? "";
}

function readDismissedAlertIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_ALERTS_STORAGE_KEY) || "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeDismissedAlertIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  const values = [...ids].slice(-200);
  if (values.length) window.localStorage.setItem(DISMISSED_ALERTS_STORAGE_KEY, JSON.stringify(values));
  else window.localStorage.removeItem(DISMISSED_ALERTS_STORAGE_KEY);
}

export function FleetView({
  machines = MACHINES,
  tasks = TASKS,
  alerts = ALERTS,
  ticker = TICKER,
  edges = FLEET_EDGES,
  loading = false,
  mastheadMode = "all",
  onAddAgent,
  onAddMachine,
  updateStatusByMachine,
  updateDetailByMachine,
  onUpdateMachine,
  onRenameMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
  onDismissAlert,
}: FleetViewProps = {}) {
  const [selected, setSelected] = React.useState<string>(() => preferredInitialMachineId(machines));
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewMode>("graph");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["nimbus"]));
  const [dispatchIdx, setDispatchIdx] = React.useState(0);
  const [dismissedAlertIds, setDismissedAlertIds] = React.useState<Set<string>>(readDismissedAlertIds);
  const [selectedAlert, setSelectedAlert] = React.useState<FleetAlert | null>(null);
  const [gitlawbNode, setGitlawbNode] = React.useState<FleetMachine["gitlawb"] | null>(null);
  const [settledFleet, setSettledFleet] = React.useState<SettledFleetViewData>({
    machines: [],
    tasks: [],
    alerts: [],
    ticker: [],
    edges: [],
    hasValue: false,
  });

  React.useEffect(() => {
    if (loading) return;
    if (machines.length === 0) return;
    const timer = window.setTimeout(() => {
      setSettledFleet({ machines, tasks, alerts, ticker, edges, hasValue: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [alerts, edges, loading, machines, tasks, ticker]);

  const baseDisplayMachines = React.useMemo(
    () => loading && !settledFleet.hasValue ? [] : loading ? settledFleet.machines : machines,
    [loading, machines, settledFleet.hasValue, settledFleet.machines],
  );
  const displayMachines = React.useMemo(() => {
    if (!gitlawbNode) return baseDisplayMachines;
    const preferredId = preferredInitialMachineId(baseDisplayMachines);
    return baseDisplayMachines.map((machine) => (
      machine.id === preferredId ? { ...machine, gitlawb: gitlawbNode } : machine
    ));
  }, [baseDisplayMachines, gitlawbNode]);
  const displayTasks = loading && !settledFleet.hasValue ? [] : loading ? settledFleet.tasks : tasks;
  const displayAlerts = loading && !settledFleet.hasValue ? [] : loading ? settledFleet.alerts : alerts;
  const displayTicker = loading && !settledFleet.hasValue ? [] : loading ? settledFleet.ticker : ticker;
  const displayEdges = loading && !settledFleet.hasValue ? [] : loading ? settledFleet.edges : edges;
  const initialLoading = loading && displayMachines.length === 0;
  const refreshing = loading && !initialLoading;
  const showMasthead = mastheadMode !== "none";

  React.useEffect(() => {
    const t = setInterval(() => setDispatchIdx((i) => displayTicker.length ? (i + 1) % displayTicker.length : 0), 2200);
    return () => clearInterval(t);
  }, [displayTicker.length]);

  React.useEffect(() => {
    writeDismissedAlertIds(dismissedAlertIds);
  }, [dismissedAlertIds]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/gitlawb/status", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (data?.ok) setGitlawbNode(data.status?.node ?? null);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setGitlawbNode(null);
      });
    return () => controller.abort();
  }, []);

  const selectedMachineId = selected && displayMachines.some((machine) => machine.id === selected)
    ? selected
    : preferredInitialMachineId(displayMachines);

  const handleSelectMachine = React.useCallback((id: string) => {
    setSelected(id);
    setSelectedAgentId(null);
    setExpanded((current) => current.has(id) ? new Set() : new Set([id]));
  }, []);
  const handleSelectAgent = React.useCallback((m: FleetMachine, a: FleetAgent) => {
    setSelected(m.id);
    setSelectedAgentId(a.id);
    setExpanded(new Set([m.id]));
  }, []);
  const handleAddAgent = React.useCallback((m: FleetMachine) => {
    onAddAgent?.(m);
  }, [onAddAgent]);
  const toggleExpand = React.useCallback((id: string) => {
    setExpanded((prev) => {
      if (prev.has(id)) return new Set();
      return new Set([id]);
    });
  }, []);
  const handleCallAgent = React.useCallback((machine: FleetMachine, agent: FleetAgent) => {
    setSelected(machine.id);
    setSelectedAgentId(agent.id);
    setExpanded(new Set([machine.id]));
    void onCallAgent?.(machine, agent);
  }, [onCallAgent]);

  const totalAgents = displayMachines.reduce((n, m) => n + m.agents.length, 0);
  const working = displayMachines.reduce(
    (n, m) => n + m.agents.filter((a) => a.state === "working").length,
    0,
  );
  const highPriorityAlerts = displayAlerts
    .filter((alert) => (
      !dismissedAlertIds.has(alert.id)
      && (alert.priority === "urgent" || alert.priority === "high" || alert.tone === "danger")
    ))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const headlineAlert = highPriorityAlerts[0] ?? null;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
  const dismissHeadlineAlert = React.useCallback(() => {
    if (!headlineAlert) return;
    setDismissedAlertIds((current) => new Set(current).add(headlineAlert.id));
    onDismissAlert?.(headlineAlert);
  }, [headlineAlert, onDismissAlert]);
  const openHeadlineAlert = React.useCallback(() => {
    if (headlineAlert) setSelectedAlert(headlineAlert);
  }, [headlineAlert]);
  const handleHeadlineKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!headlineAlert) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedAlert(headlineAlert);
    }
  }, [headlineAlert]);

  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={`${styles.root} relative overflow-hidden`}
        style={{
          width: "100%", height: "100%",
          background: "var(--background)", color: "var(--foreground)",
          fontFamily: "var(--f-display), var(--font-sans, system-ui)",
          display: "grid", gridTemplateRows: showMasthead ? "auto 1fr" : "1fr",
        }}
      >
        {/* Decorative backdrop — radial honey/cyan glow + hex texture */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 38%, rgba(255,212,90,0.10), transparent 50%)," +
              "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.08), transparent 50%)",
          }}
        />
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: 0.1 }}
        >
          <defs>
            <pattern id="fleetGrid" width={48} height={55} patternUnits="userSpaceOnUse">
              <polygon
                points="24,1 47,14 47,40 24,53 1,40 1,14"
                fill="none"
                stroke="rgba(255,212,90,0.4)"
                strokeWidth={0.5}
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#fleetGrid)" />
        </svg>

        {/* ===== MASTHEAD ===== */}
        {showMasthead ? (
          <header
            className={`${styles.masthead} ${mastheadMode === "mobile" ? styles.mobileOnlyMasthead : ""} relative z-10`}
            style={{ padding: "22px 36px 16px", borderBottom: "1px solid rgba(148,163,184,0.16)" }}
          >
            <div className={`${styles.topbar} grid items-center`}>
              <div className="flex items-center" style={{ gap: 14 }}>
                <HexTile size={42} tone="honey"><BeeIcon role="queen" size={32} /></HexTile>
                <div>
                  <div className={styles.monoCap} style={{ color: "var(--hex-honey-border)" }}>
                    Hivemind Dispatch · Fleet
                  </div>
                  <div className="font-bold" style={{ fontFamily: "var(--f-display)", fontSize: 18, letterSpacing: 0 }}>
                    The Swarm
                  </div>
                </div>
              </div>
              <div
                className="text-center uppercase"
                style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", letterSpacing: 0.1 }}
              >
                {today}
              </div>
              <div /> {/* reserved for the host app's user menu */}
            </div>

            <div className={`${styles.heroRow} mt-4 grid items-end`}>
              <h1
                className="m-0 font-bold"
                style={{
                  fontFamily: "var(--f-display)",
                  fontSize: "clamp(40px, 5.5vw, 80px)",
                  lineHeight: 0.9,
                  letterSpacing: 0,
                }}
              >
                The hive is{" "}
                <span style={{ fontStyle: "italic", color: "var(--hex-honey-border)", fontWeight: 500 }}>
                  humming.
                </span>
              </h1>
              <div className="flex" style={{ gap: 18, paddingBottom: 6 }}>
                <BigStat n={displayMachines.length} label="machines" />
                <BigStat n={totalAgents} label="agents" />
                <BigStat n={working} label="working" tone="cyan" />
                <BigStat
                  n={highPriorityAlerts.length}
                  label="urgent"
                  tone="danger"
                />
              </div>
            </div>
          </header>
        ) : null}

        {/* ===== BODY ===== */}
        <div
          className={`${styles.layout} relative z-10 grid`}
          style={{ minHeight: 0 }}
        >
          {/* LEFT — roster */}
          <aside
            className={`${styles.sideRail} flex flex-col overflow-auto`}
            style={{
              borderRight: "1px solid rgba(148,163,184,0.16)",
              gap: 16,
            }}
          >
            <section>
              <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 10 }}>
                The roster
              </div>
              {initialLoading ? (
                <FleetRosterLoading />
              ) : (
                <Roster
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  expanded={expanded}
                  machines={displayMachines}
                  onSelectMachine={handleSelectMachine}
                  onSelectAgent={handleSelectAgent}
                  onToggleExpand={toggleExpand}
                  onAddAgent={handleAddAgent}
                  updateStatusByMachine={updateStatusByMachine}
                  updateDetailByMachine={updateDetailByMachine}
                  onUpdateMachine={onUpdateMachine}
                  onRenameMachine={onRenameMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenChat={onOpenChat}
                  onOpenTaskChat={onOpenTaskChat}
                  onCallAgent={handleCallAgent}
                  onOpenWallet={onOpenWallet}
                  onEditSettings={onEditSettings}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                />
              )}
            </section>

            <section>
              <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 10 }}>
                Priority headline
              </div>
              <div
                className="relative rounded-xl"
                role={headlineAlert ? "button" : undefined}
                tabIndex={headlineAlert ? 0 : undefined}
                aria-label={headlineAlert ? `Open priority alert: ${headlineAlert.title ?? headlineAlert.text}` : undefined}
                onClick={openHeadlineAlert}
                onKeyDown={handleHeadlineKeyDown}
                style={{
                  border: `1px solid ${headlineAlert ? "rgba(251,113,133,0.34)" : "rgba(148,163,184,0.16)"}`,
                  padding: headlineAlert ? "14px 42px 14px 14px" : 14,
                  background: headlineAlert
                    ? "linear-gradient(180deg, rgba(251,113,133,0.10), transparent)"
                    : "rgba(16,20,29,0.48)",
                  cursor: headlineAlert ? "pointer" : "default",
                }}
              >
                {headlineAlert ? (
                  <CloseIconButton
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      dismissHeadlineAlert();
                    }}
                    aria-label="Dismiss priority headline"
                    title="Dismiss"
                    className="absolute cursor-pointer"
                    style={{
                      top: 10,
                      right: 10,
                      border: "1px solid rgba(251,113,133,0.32)",
                      background: "rgba(16,20,29,0.72)",
                      color: "var(--muted)",
                    }}
                  />
                ) : null}
                <div className={styles.monoCap} style={{ color: headlineAlert ? "var(--danger)" : "var(--muted)", marginBottom: 6 }}>
                  {headlineAlert
                    ? `${headlineAlert.priority === "urgent" ? "URGENT" : "HIGH"} · ${headlineAlert.since}${highPriorityAlerts.length > 1 ? ` · 1/${highPriorityAlerts.length}` : ""}`
                    : "CLEAR · NOW"}
                </div>
                <div className="font-bold mb-1.5" style={{ fontFamily: "var(--f-display)", fontSize: 17, lineHeight: 1.2 }}>
                  {headlineAlert?.title ?? "No high-priority alerts."}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {headlineAlert
                    ? headlineAlert.text
                    : "The alerts feed is quiet. New urgent or high-priority agent notifications will appear here."}
                </div>
              </div>
            </section>
          </aside>

          {/* CENTER — view */}
          <section
            className={`${styles.stageColumn} flex flex-col overflow-hidden`}
            style={{ minHeight: 0 }}
          >
            <div className={styles.stageToolbar}>
              <div className={styles.monoCap} style={{ color: "var(--accent-strong)" }}>
                <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--accent)" }} />
                &nbsp; {refreshing ? "scanning swarm" : "live swarm"}
              </div>
              <div className="flex" style={{ gap: 6 }}>
                {(["graph", "map", "list"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className="uppercase cursor-pointer"
                    style={{
                      fontFamily: "var(--f-mono)", fontSize: 10,
                      padding: "5px 10px", borderRadius: 9999,
                      background: view === v ? "rgba(45,212,191,0.12)" : "transparent",
                      color: view === v ? "var(--foreground)" : "var(--muted)",
                      border: `1px solid ${view === v ? "rgba(94,234,212,0.42)" : "rgba(148,163,184,0.18)"}`,
                      letterSpacing: 0.1,
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`${styles.stageFrame} relative grid overflow-hidden rounded-2xl`}
              style={{
                border: "1px solid rgba(148,163,184,0.16)",
                background:
                  "radial-gradient(ellipse at center, rgba(255,212,90,0.06), transparent 60%), rgba(16,20,29,0.78)",
                placeItems: view === "list" ? "stretch" : "center",
              }}
            >
              {initialLoading ? (
                <FleetConstellationLoading />
              ) : view === "graph" && (
                <NetworkGraph
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  machines={displayMachines}
                  edges={displayEdges}
                  onSelectMachine={handleSelectMachine}
                  onSelectAgent={handleSelectAgent}
                  onAddAgent={handleAddAgent}
                  onAddMachine={onAddMachine}
                />
              )}
              {!initialLoading && view === "map" && (
                <MapView
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  machines={displayMachines}
                  edges={displayEdges}
                  onSelectMachine={handleSelectMachine}
                  onSelectAgent={handleSelectAgent}
                  onAddAgent={handleAddAgent}
                  width={840} height={840}
                />
              )}
              {!initialLoading && view === "list" && (
                <ListView
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  machines={displayMachines}
                  onSelectMachine={handleSelectMachine}
                  onSelectAgent={handleSelectAgent}
                  onAddAgent={handleAddAgent}
                  onOpenChat={onOpenChat}
                  onOpenTaskChat={onOpenTaskChat}
                  onCallAgent={handleCallAgent}
                  onOpenWallet={onOpenWallet}
                  onEditSettings={onEditSettings}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                />
              )}
              {refreshing ? <FleetScanOverlay /> : null}
            </div>
          </section>

          {/* RIGHT — dispatch */}
          <aside
            className={`${styles.dispatchRail} flex flex-col overflow-y-auto overflow-x-hidden`}
            style={{
              borderLeft: "1px solid rgba(148,163,184,0.16)",
              gap: 14,
            }}
          >
            <section>
              <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 10 }}>
                The dispatch · live
              </div>
              <div
                className={`${styles.dispatchCard} rounded-xl`}
                style={{
                  padding: 14,
                  border: "1px solid rgba(148,163,184,0.16)",
                  background: "rgba(16,20,29,0.78)",
                }}
              >
                <div
                  key={dispatchIdx}
                  className={styles.dispatchText}
                  style={{
                    fontFamily: "var(--f-mono)", fontSize: 11.5,
                    color: "var(--foreground)", lineHeight: 1.55,
                    animation: "fleet-fade-up 360ms ease",
                  }}
                >
                  {initialLoading ? "Discovery is scanning ready machines and agent bridges." : displayTicker[dispatchIdx] ?? "Fleet telemetry is quiet right now."}
                </div>
                <div className={styles.dispatchMeta} style={{
                  marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)",
                }}>
                  <span>{String(Math.min(dispatchIdx + 1, displayTicker.length || 1)).padStart(2, "0")} / {displayTicker.length || 1}</span>
                  <span>
                    <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--accent)" }} />
                    &nbsp; {initialLoading ? "scanning" : "streaming"}
                  </span>
                </div>
              </div>
            </section>

            <section className={`${styles.dispatchStoryList} grid`} style={{ gap: 10 }}>
              <div className={styles.monoCap} style={{ color: "var(--muted)" }}>
                Stories from the field
              </div>
              {initialLoading ? (
                <FleetDispatchLoading />
              ) : displayMachines.flatMap((m) =>
                m.agents
                  .filter((a) => a.state === "working" || a.state === "failed")
                  .map((a) => ({ ...a, host: m.name, _m: m })),
              )
                .slice(0, 4)
                .map((a) => {
                  const storyFailed = a.activityStatus === "failed"
                    && /\b(error|failed|failure|blocked|unavailable|unauthorized|forbidden|timeout|missing|not found|needs|invalid|rejected|login|auth)\b/i.test(a.task);
                  return (
                    <article
                      key={`${a._m.id}:${a.id}`}
                      onClick={() => handleSelectAgent(a._m, a)}
                      className={`${styles.dispatchStoryCard} rounded-xl cursor-pointer`}
                      style={{
                        padding: 12,
                        border: `1px solid ${storyFailed ? "rgba(251,113,133,0.34)" : "rgba(148,163,184,0.16)"}`,
                        background: "rgba(16,20,29,0.78)",
                      }}
                    >
                      <div className={styles.dispatchStoryHeader} style={{ marginBottom: 6 }}>
                        <div
                          className={`${styles.monoCap} ${styles.dispatchStorySource}`}
                          style={{ color: storyFailed ? "var(--danger)" : "var(--accent-strong)" }}
                        >
                          {a.host} · {a.runtime}
                        </div>
                        <span className={styles.dispatchStoryTime} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{a.since}</span>
                      </div>
                      <div className={`${styles.dispatchStoryName} font-semibold`} style={{ fontFamily: "var(--f-display)", fontSize: 14, lineHeight: 1.3, marginBottom: 4 }}>
                        {a.name}
                      </div>
                      <div className={styles.dispatchStoryTask} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{a.task}</div>
                    </article>
                  );
                })}
            </section>

            <section className="mt-auto">
              <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 8 }}>
                Tomorrow&apos;s brief
              </div>
              <div className={styles.dispatchBrief} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                {initialLoading
                  ? "Queued work and agent status will appear once discovery finishes."
                  : `${displayTasks.filter((t) => t.lane === "queue").length} tasks queued · ${displayTasks.filter((t) => t.state === "scheduled").length} scheduled overnight · brain sync resumes on lattice when wifi stabilizes.`}
              </div>
            </section>
          </aside>
        </div>

        {selectedAlert ? (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-[rgba(2,6,12,0.74)] p-5"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedAlert(null);
            }}
          >
            <section
              className="max-h-[min(760px,calc(100vh-40px))] w-[min(560px,100%)] overflow-auto rounded-lg border border-[rgba(251,113,133,0.34)] bg-[#0d121b] p-[18px] shadow-[0_30px_100px_rgba(0,0,0,0.55)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fleet-alert-title"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow m-0">
                    {(selectedAlert.priority === "urgent" ? "Urgent" : selectedAlert.priority === "high" ? "High priority" : "Fleet alert")} · {selectedAlert.since}
                  </p>
                  <h2 id="fleet-alert-title" className="m-0 mt-2 text-[22px] leading-[1.18]">
                    {selectedAlert.title ?? `${selectedAlert.agent} alert`}
                  </h2>
                  <p className="m-0 mt-2 text-[var(--muted)]">{selectedAlert.agent} on {selectedAlert.machine}</p>
                </div>
                <CloseIconButton aria-label="Close alert details" onClick={() => setSelectedAlert(null)} />
              </div>
              <pre
                style={{
                  margin: "16px 0 0",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  border: "1px solid rgba(251,113,133,0.28)",
                  borderRadius: 8,
                  background: "rgba(8,13,22,0.72)",
                  color: "var(--foreground)",
                  padding: 14,
                  font: "13px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                }}
              >
                {selectedAlert.text}
              </pre>
            </section>
          </div>
        ) : null}

      </div>
    </TooltipProvider>
  );
}

function BigStat({ n, label, tone }: { n: number; label: string; tone?: "cyan" | "danger" }) {
  const color =
    tone === "cyan" ? "var(--accent-strong)" :
    tone === "danger" ? "var(--danger)" :
    "var(--foreground)";
  return (
    <div className="text-right">
      <div className="font-bold" style={{ fontFamily: "var(--f-display)", fontSize: 44, color, lineHeight: 1, letterSpacing: 0 }}>
        {n}
      </div>
      <div className={styles.monoCap} style={{ color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
