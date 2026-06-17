// src/components/fleet/FleetView.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { BeeIcon } from "./bee-icon";
import { HexTile } from "./hex-tile";
import { ListView } from "./list-view";
import { MapView } from "./map-view";
import { NetworkGraph } from "./network-graph";
import { OrbitalGraph } from "./orbital-graph";
import { FleetConstellationLoading, FleetDispatchLoading, FleetRosterLoading, FleetScanOverlay } from "./fleet-loading";
import { Roster, type MachineUpdateButtonDetail, type MachineUpdateButtonStatus } from "./roster";
import { AeonDeleteModal, isAeonAgent, type AeonDeleteDepth, type AeonDeleteProgress, type AeonDeleteResult } from "./aeon-delete-modal";
import { EconomyStrip } from "./economy-strip";
import type { FleetHostedApp } from "./active-apps";
import { UsePodHostModal } from "./usepod-host-modal";
import { MachineTerminalModal } from "./machine-terminal-modal";
import { dashboardStateValue, loadDashboardStateSnapshot, removeDashboardStateValue, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
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

type ViewMode = "hive" | "graph" | "map" | "list";
const DISMISSED_ALERTS_STORAGE_KEY = "hivemindos.fleet.dismissedAlerts.v1";
// Matches the bounce/glow animation length in fleet-tokens.module.css (1 × 880ms).
const NEW_AGENT_HIGHLIGHT_MS = 900;
// An arrival older than this is stale (e.g. the user created an agent and only
// opened the fleet much later) — clear it instead of celebrating.
const NEW_AGENT_ARRIVAL_WINDOW_MS = 5 * 60_000;

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
  /** Hosted apps & services discovered across the fleet; shown per machine in the roster. */
  hostedApps?: FleetHostedApp[];
  loading?: boolean;
  checkedLabel?: string;
  tailnetLabel?: string;
  mastheadMode?: "all" | "mobile" | "none";
  /** A just-created agent to spotlight (bounce + auto-open tooltip) once it appears in the fleet data. */
  recentAgentArrival?: { agentId: string; at: number } | null;
  /** Called once the arrival has been spotlighted (or was stale) so the parent can clear it. */
  onRecentAgentArrivalSeen?: () => void;
  /** Optional override hooks so the parent app can wire actions to real APIs. */
  onAddAgent?: (m: FleetMachine) => void;
  onAddMachine?: () => void;
  /** Fleet auto-update pause control; the toggle renders only when the handler is provided. */
  autoUpdatePaused?: boolean;
  onToggleAutoUpdatePaused?: () => void;
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
  /** When provided, the hive view renders a central Queen Bee cell connected to every machine; clicking it opens her settings. */
  onOpenQueenSettings?: () => void;
  /** "Message the hive" composer (new Hive layout only; legacy FleetView ignores it). */
  onSendMessage?: (text: string) => void;
  /** Optional wallet configs used by the Fleet Hive selected-agent holdings panel. */
  walletsByAgent?: Record<string, AgentWalletConfig>;
  /** Optional host-provided Hive/Classic switcher, rendered in the classic stage toolbar. */
  layoutToggle?: React.ReactNode;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (m: FleetMachine, a: FleetAgent, depth?: AeonDeleteDepth, onProgress?: (progress: AeonDeleteProgress) => void) => void | Promise<AeonDeleteResult | void>;
  onDismissAlert?: (alert: FleetAlert) => void;
}

function preferredInitialMachineId(machines: FleetMachine[]) {
  return machines.find((machine) => machine.name === "This Mac" || machine.role === "Primary")?.id
    ?? machines[0]?.id
    ?? "";
}

async function readDismissedAlertIds() {
  try {
    const snapshot = await loadDashboardStateSnapshot();
    const parsed = JSON.parse(dashboardStateValue(snapshot, DISMISSED_ALERTS_STORAGE_KEY) || "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeDismissedAlertIds(ids: Set<string>) {
  const values = [...ids].slice(-200);
  if (values.length) void saveDashboardStateValue(DISMISSED_ALERTS_STORAGE_KEY, JSON.stringify(values));
  else void removeDashboardStateValue(DISMISSED_ALERTS_STORAGE_KEY);
}

export function FleetView({
  machines = MACHINES,
  tasks = TASKS,
  alerts = ALERTS,
  ticker = TICKER,
  edges = FLEET_EDGES,
  hostedApps,
  loading = false,
  mastheadMode = "all",
  recentAgentArrival,
  onRecentAgentArrivalSeen,
  onAddAgent,
  onAddMachine,
  autoUpdatePaused,
  onToggleAutoUpdatePaused,
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
  onOpenQueenSettings,
  layoutToggle,
  onDuplicate,
  onRemove,
  onDismissAlert,
}: FleetViewProps = {}) {
  const [selected, setSelected] = React.useState<string>(() => preferredInitialMachineId(machines));
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewMode>("hive");
  const [dispatchIdx, setDispatchIdx] = React.useState(0);
  const [aeonDeleteTarget, setAeonDeleteTarget] = React.useState<{ machine: FleetMachine; agent: FleetAgent } | null>(null);
  const [dismissedAlertIds, setDismissedAlertIds] = React.useState<Set<string>>(() => new Set());
  const [dismissedAlertsHydrated, setDismissedAlertsHydrated] = React.useState(false);
  const [selectedAlert, setSelectedAlert] = React.useState<FleetAlert | null>(null);
  const [gitlawbNode, setGitlawbNode] = React.useState<FleetMachine["gitlawb"] | null>(null);
  const [selectionTooltipKey, setSelectionTooltipKey] = React.useState<string | null>(null);
  const [newAgentKey, setNewAgentKey] = React.useState<string | null>(null);
  const [usePodHostMachine, setUsePodHostMachine] = React.useState<FleetMachine | null>(null);
  const [terminalMachine, setTerminalMachine] = React.useState<FleetMachine | null>(null);
  const newAgentTimerRef = React.useRef<number>(0);
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

  // When the app reports a just-created agent, wait for it to show up in the
  // fleet data, then select it, auto-open its tooltip, and bounce its hex so
  // it's easy to spot in the hive. Driven by an explicit signal from the
  // create/duplicate flows — never inferred from data refreshes — so startup
  // loads and background discovery can't trigger it.
  React.useEffect(() => {
    if (!recentAgentArrival) return;
    if (Date.now() - recentAgentArrival.at > NEW_AGENT_ARRIVAL_WINDOW_MS) {
      const timer = window.setTimeout(() => onRecentAgentArrivalSeen?.(), 0);
      return () => window.clearTimeout(timer);
    }
    const machine = displayMachines.find((m) => m.agents.some((a) => a.id === recentAgentArrival.agentId));
    if (!machine) return; // not in the fleet data yet — try again on the next refresh
    const key = `${machine.id}:${recentAgentArrival.agentId}`;
    const timer = window.setTimeout(() => {
      setSelected(machine.id);
      setSelectedAgentId(recentAgentArrival.agentId);
      setSelectionTooltipKey(key);
      setNewAgentKey(key);
      window.clearTimeout(newAgentTimerRef.current);
      newAgentTimerRef.current = window.setTimeout(() => setNewAgentKey(null), NEW_AGENT_HIGHLIGHT_MS);
      onRecentAgentArrivalSeen?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [displayMachines, onRecentAgentArrivalSeen, recentAgentArrival]);

  React.useEffect(() => () => window.clearTimeout(newAgentTimerRef.current), []);

  React.useEffect(() => {
    const t = setInterval(() => setDispatchIdx((i) => displayTicker.length ? (i + 1) % displayTicker.length : 0), 2200);
    return () => clearInterval(t);
  }, [displayTicker.length]);

  React.useEffect(() => {
    if (!dismissedAlertsHydrated) return;
    writeDismissedAlertIds(dismissedAlertIds);
  }, [dismissedAlertIds, dismissedAlertsHydrated]);

  React.useEffect(() => {
    let cancelled = false;
    void readDismissedAlertIds().then((ids) => {
      if (cancelled) return;
      setDismissedAlertIds(ids);
      setDismissedAlertsHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    setSelectionTooltipKey(null);
  }, []);
  const handleSelectAgent = React.useCallback((m: FleetMachine, a: FleetAgent) => {
    setSelected(m.id);
    setSelectedAgentId(a.id);
    setSelectionTooltipKey(null);
  }, []);
  const handleAddAgent = React.useCallback((m: FleetMachine) => {
    onAddAgent?.(m);
  }, [onAddAgent]);
  const handleCallAgent = React.useCallback((machine: FleetMachine, agent: FleetAgent) => {
    setSelected(machine.id);
    setSelectedAgentId(agent.id);
    void onCallAgent?.(machine, agent);
  }, [onCallAgent]);
  // Route AEON removals through the slide-to-unlock dialog; everything else
  // deletes directly, matching the old roster behavior on every surface.
  const handleRemove = React.useCallback((
    machine: FleetMachine,
    agent: FleetAgent,
    depth?: AeonDeleteDepth,
    onProgress?: (progress: AeonDeleteProgress) => void,
  ): void | Promise<AeonDeleteResult | void> => {
    if (depth === undefined && isAeonAgent(agent)) {
      setAeonDeleteTarget({ machine, agent });
      return;
    }
    return onRemove?.(machine, agent, depth, onProgress);
  }, [onRemove]);

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
        {/* Decorative backdrop — low-contrast hex texture without a center bloom */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "transparent",
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
                The economy
              </div>
              <EconomyStrip machines={displayMachines} />
            </section>

            <section>
              <div
                className={`${styles.monoCap} flex items-center justify-between`}
                style={{ color: "var(--muted)", marginBottom: 10, gap: 8 }}
              >
                <span>The roster</span>
                {onToggleAutoUpdatePaused ? (
                  <button
                    type="button"
                    onClick={onToggleAutoUpdatePaused}
                    aria-pressed={autoUpdatePaused}
                    title={autoUpdatePaused
                      ? "Fleet auto-updates are paused. Machines will not pull new dashboard commits until resumed."
                      : "Pause fleet auto-updates. Machines stop pulling new dashboard commits until resumed."}
                    className="uppercase cursor-pointer"
                    style={{
                      fontFamily: "var(--f-mono)",
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.04,
                      padding: "3px 8px",
                      borderRadius: 9999,
                      border: `1px solid ${autoUpdatePaused ? "rgba(251,191,36,0.42)" : "rgba(148,163,184,0.22)"}`,
                      background: autoUpdatePaused ? "rgba(251,191,36,0.12)" : "transparent",
                      color: autoUpdatePaused ? "#fde68a" : "var(--muted)",
                    }}
                  >
                    {autoUpdatePaused ? "Auto-update paused" : "Pause auto-update"}
                  </button>
                ) : null}
              </div>
              {initialLoading ? (
                <FleetRosterLoading />
              ) : (
                <Roster
                  selected={selectedMachineId}
                  machines={displayMachines}
                  hostedApps={hostedApps}
                  onSelectMachine={handleSelectMachine}
                  onAddAgent={handleAddAgent}
                  updateStatusByMachine={updateStatusByMachine}
                  updateDetailByMachine={updateDetailByMachine}
                  onUpdateMachine={onUpdateMachine}
                  onRenameMachine={onRenameMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={setUsePodHostMachine}
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
              {layoutToggle ? (
                <div>{layoutToggle}</div>
              ) : (
                <div aria-hidden="true" />
              )}
              <div className="flex" style={{ gap: 6 }}>
                {(["hive", "graph", "map", "list"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    data-bee={`fleet-view-${v}`}
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
                background: "rgba(16,20,29,0.78)",
                placeItems: view === "list" ? "stretch" : "center",
              }}
            >
              {initialLoading ? (
                <FleetConstellationLoading />
              ) : view === "hive" && (
                <NetworkGraph
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  machines={displayMachines}
                  edges={displayEdges}
                  onSelectMachine={handleSelectMachine}
                  onSelectAgent={handleSelectAgent}
                  onAddAgent={handleAddAgent}
                  onAddMachine={onAddMachine}
                  updateStatusByMachine={updateStatusByMachine}
                  updateDetailByMachine={updateDetailByMachine}
                  onUpdateMachine={onUpdateMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={setUsePodHostMachine}
                  onOpenShell={setTerminalMachine}
                  onOpenChat={onOpenChat}
                  onOpenTaskChat={onOpenTaskChat}
                  onCallAgent={handleCallAgent}
                  onOpenWallet={onOpenWallet}
                  onEditSettings={onEditSettings}
                  onOpenQueenSettings={onOpenQueenSettings}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove ? handleRemove : undefined}
                  selectionTooltipKey={selectionTooltipKey}
                  onOpenSelectionTooltip={setSelectionTooltipKey}
                  onDismissSelectionTooltip={() => setSelectionTooltipKey(null)}
                  newAgentKey={newAgentKey}
                />
              )}
              {!initialLoading && view === "graph" && (
                <OrbitalGraph
                  machines={displayMachines}
                  selected={selectedMachineId}
                  onSelectMachine={handleSelectMachine}
                  alerts={displayAlerts}
                  tasks={displayTasks}
                  ticker={displayTicker}
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
                  updateStatusByMachine={updateStatusByMachine}
                  updateDetailByMachine={updateDetailByMachine}
                  onUpdateMachine={onUpdateMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={setUsePodHostMachine}
                  onOpenShell={setTerminalMachine}
                  selectionTooltipKey={selectionTooltipKey}
                  onOpenSelectionTooltip={setSelectionTooltipKey}
                  onDismissSelectionTooltip={() => setSelectionTooltipKey(null)}
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
                  onRemove={onRemove ? handleRemove : undefined}
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

        {usePodHostMachine && typeof document !== "undefined" ? createPortal((
          <UsePodHostModal machine={usePodHostMachine} onClose={() => setUsePodHostMachine(null)} />
        ), document.body) : null}

        {terminalMachine && typeof document !== "undefined" ? (
          <MachineTerminalModal machine={terminalMachine} onClose={() => setTerminalMachine(null)} />
        ) : null}

        {aeonDeleteTarget && onRemove ? (
          <AeonDeleteModal
            machine={aeonDeleteTarget.machine}
            agent={aeonDeleteTarget.agent}
            onClose={() => setAeonDeleteTarget(null)}
            onRemove={onRemove}
          />
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
