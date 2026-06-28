"use client";

/* FleetHiveView.tsx — the redesigned default Fleet view: the Queen orchestrator
   at the heart, machines ringed around her, every agent a tessellating hex
   petal, honey-light pheromone trails flowing along the threads.

   It consumes the SAME FleetViewProps as the legacy FleetView (AgentsPanel can
   render either one), maps the fleet payload into the lean hive shapes, and
   wires every action chip through to the real handlers — reaching parity with
   the legacy view (call / chat / wallet / settings / duplicate / remove,
   add agent / machine, update / rename / shell / host / code-proof / fix-sync).

   The hive is authored on a fixed 1440×980 stage and scaled to fit; the detail
   panel and chat pill live outside the scaled layer so they stay crisp. */

import * as React from "react";
import { createPortal } from "react-dom";
import { AeonDeleteModal, isAeonAgent } from "@/components/fleet/aeon-delete-modal";
import { MachineTerminalModal } from "@/components/fleet/machine-terminal-modal";
import { MachineSendFileModal } from "@/components/fleet/machine-send-file-modal";
import { UsePodHostModal } from "@/components/fleet/usepod-host-modal";
import { FleetConstellationLoading, FleetScanOverlay } from "@/components/fleet/fleet-loading";
import {
  ALERTS, MACHINES, TASKS, TICKER, FLEET_EDGES,
  type FleetAgent, type FleetMachine,
} from "@/components/fleet/fleet-data";
import type { FleetViewProps } from "@/components/fleet/FleetView";
import { HudClock, OrbitalGraph } from "@/components/fleet/orbital-graph";
import { MapView } from "@/components/fleet/map-view";
import { ListView } from "@/components/fleet/list-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emitQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { HIVE_H, HIVE_W, frBuildLayout, frContentBounds } from "./hive-geometry";
import { mapFleetMachines } from "./fleet-hive-mappers";
import type { HiveAgent, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { HiveStage } from "./HiveStage";
import { HivePanel, type HivePanelHandlers } from "./HivePanel";
import { TopBar } from "./TopBar";
import { useFrTheme } from "./use-fr-theme";
import "./fleet-hive.css";

// A just-created agent stays spotlighted for one bounce/glow cycle.
const NEW_AGENT_HIGHLIGHT_MS = 900;
const NEW_AGENT_ARRIVAL_WINDOW_MS = 5 * 60_000;
// The detail panel renders full-height and unscaled on the right; the hive
// canvas fills the space to its left (the full-height app rail sits outside
// this view, so commandMain is already inset clear of it). Must match
// HivePanel's width.
const PANEL_W = 340;
// The hive cells are authored against a 1440×980 stage (same as the drop-in).
// Fitting that whole canvas to the area reproduces the drop-in's cell size as
// the default ("100%"); the user zooms/pans out from there.
const BASELINE_CANVAS_W = 1440;
const GRAPH_LAYOUT_TOGGLE_HUD_TOP = 86;
const GRAPH_LAYOUT_TOGGLE_SELECTED_HUD_TOP = 158;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25; // ± button multiplier
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const ZOOM_BTN_STYLE: React.CSSProperties = {
  width: 28, height: 28, display: "grid", placeItems: "center",
  borderRadius: 9, border: "none", background: "transparent",
  color: "var(--fg-1)", fontSize: 17, lineHeight: 1, cursor: "pointer",
  fontFamily: "var(--f-display)",
};

type FleetViewMode = "hive" | "graph" | "map" | "list";
const FLEET_VIEW_MODES: FleetViewMode[] = ["hive", "graph", "map", "list"];

// The hive / graph / map / list switcher — same set as the legacy FleetView.
function ViewModeToggle({ mode, onChoose }: { mode: FleetViewMode; onChoose: (m: FleetViewMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Fleet view mode"
      style={{
        display: "inline-flex", gap: 2, padding: 3, borderRadius: 9999,
        border: "1px solid var(--line)", background: "var(--bg-2)",
        boxShadow: "0 6px 20px rgba(0,0,0,.25)",
      }}
    >
      {FLEET_VIEW_MODES.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            data-bee={`fleet-view-${m}`}
            onClick={() => onChoose(m)}
            style={{
              cursor: "pointer", border: 0, borderRadius: 9999, padding: "4px 12px",
              fontFamily: "var(--f-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              background: active ? "var(--honey-soft)" : "transparent",
              color: active ? "var(--honey)" : "var(--fg-3)",
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

export function FleetHiveView({
  machines = MACHINES,
  tasks = TASKS,
  alerts = ALERTS,
  ticker = TICKER,
  edges = FLEET_EDGES,
  loading = false,
  recentAgentArrival,
  onRecentAgentArrivalSeen,
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
  onOpenQueenSettings,
  onDuplicate,
  onRemove,
  walletsByAgent,
  layoutToggle,
  onViewModeChange,
}: FleetViewProps & {
  layoutToggle?: React.ReactNode;
  onViewModeChange?: (mode: FleetViewMode) => void;
} = {}) {
  const frTheme = useFrTheme();
  // tasks/alerts/ticker/edges drive the graph/map view modes (the hive mode
  // itself surfaces live agent state directly rather than the dispatch rails).

  const hiveMachines = React.useMemo(() => mapFleetMachines(machines), [machines]);

  const [settled, setSettled] = React.useState<HiveMachine[]>([]);
  const [settledHasValue, setSettledHasValue] = React.useState(false);
  React.useEffect(() => {
    if (loading) return;
    if (hiveMachines.length === 0) return;
    const t = window.setTimeout(() => {
      setSettled(hiveMachines);
      setSettledHasValue(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [hiveMachines, loading]);

  const displayMachines = React.useMemo(
    () => (loading && !settledHasValue ? [] : loading ? settled : hiveMachines),
    [hiveMachines, loading, settled, settledHasValue],
  );
  const initialLoading = loading && displayMachines.length === 0;
  const refreshing = loading && !initialLoading;

  const [sel, setSel] = React.useState<HiveSelection>({ type: "queen" });
  // View mode (parity with the legacy FleetView toolbar). "hive" is the new hex
  // layout; graph/map/list reuse the existing visualisations inside this chrome.
  const [viewMode, setViewMode] = React.useState<FleetViewMode>("hive");
  const chooseViewMode = React.useCallback((mode: FleetViewMode) => {
    setViewMode(mode);
    onViewModeChange?.(mode);
  }, [onViewModeChange]);
  const [selectionTooltipKey, setSelectionTooltipKey] = React.useState<string | null>(null);
  const [area, setArea] = React.useState<{ w: number; h: number; full: number }>({ w: 0, h: 0, full: 0 });
  // User-controlled zoom (1 = drop-in baseline size) + pan offset, in screen px.
  const [view, setView] = React.useState<{ zoom: number; x: number; y: number }>({ zoom: 1, x: 0, y: 0 });
  const [newAgentId, setNewAgentId] = React.useState<string | null>(null);

  // The hive layout + the tight bounding box of what's actually drawn (used to
  // keep the content centred). The baseline scale fits the whole authored
  // canvas — matching the drop-in's cell size — and the user zooms from there.
  const layout = React.useMemo(() => frBuildLayout(displayMachines), [displayMachines]);
  const bounds = React.useMemo(() => frContentBounds(displayMachines, layout), [displayMachines, layout]);
  const baseScale = (area.full > 0 && area.h > 0)
    ? Math.min(area.full / BASELINE_CANVAS_W, area.h / HIVE_H)
    : 1;
  const scale = baseScale * view.zoom;
  const [aeonDeleteTarget, setAeonDeleteTarget] = React.useState<{ machine: FleetMachine; agent: FleetAgent } | null>(null);
  const [terminalMachine, setTerminalMachine] = React.useState<FleetMachine | null>(null);
  const [sendFileMachine, setSendFileMachine] = React.useState<FleetMachine | null>(null);
  const [usePodHostMachine, setUsePodHostMachine] = React.useState<FleetMachine | null>(null);
  const newAgentTimerRef = React.useRef<number>(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const hiveAreaRef = React.useRef<HTMLDivElement>(null);

  // Derive a selection that always points at something that still exists, so a
  // removed/renamed machine or agent falls back to the Queen overview without a
  // setState-in-effect cascade.
  const effectiveSel = React.useMemo<HiveSelection>(() => {
    if (sel.type === "machine" && !displayMachines.some((m) => m.id === sel.id)) return { type: "queen" };
    if (sel.type === "agent") {
      const m = displayMachines.find((x) => x.id === sel.machineId);
      if (!m || !m.agents.some((a) => a.id === sel.id)) return { type: "queen" };
    }
    return sel;
  }, [displayMachines, sel]);

  // Bridge the hive selection to the id-based selection the legacy graph/map/
  // list visualisations use, plus fleet-typed handlers for those modes.
  const selectedMachineId = effectiveSel.type === "machine" ? effectiveSel.id : effectiveSel.type === "agent" ? effectiveSel.machineId : "";
  const selectedAgentId = effectiveSel.type === "agent" ? effectiveSel.id : null;
  const selectMachineById = React.useCallback((id: string) => setSel({ type: "machine", id }), []);
  const selectAgentFleet = React.useCallback((m: FleetMachine, a: FleetAgent) => setSel({ type: "agent", id: a.id, machineId: m.id }), []);
  const removeAgentFleet = React.useCallback((m: FleetMachine, a: FleetAgent) => {
    if (isAeonAgent(a)) { setAeonDeleteTarget({ machine: m, agent: a }); return; }
    onRemove?.(m, a);
  }, [onRemove]);
  const callAgentFleet = React.useCallback((m: FleetMachine, a: FleetAgent) => { void onCallAgent?.(m, a); }, [onCallAgent]);

  // Spotlight a freshly created agent once it shows up in the fleet data.
  React.useEffect(() => {
    if (!recentAgentArrival) return;
    if (Date.now() - recentAgentArrival.at > NEW_AGENT_ARRIVAL_WINDOW_MS) {
      const t = window.setTimeout(() => onRecentAgentArrivalSeen?.(), 0);
      return () => window.clearTimeout(t);
    }
    const machine = displayMachines.find((m) => m.agents.some((a) => a.id === recentAgentArrival.agentId));
    if (!machine) return;
    const t = window.setTimeout(() => {
      setSel({ type: "agent", id: recentAgentArrival.agentId, machineId: machine.id });
      setNewAgentId(recentAgentArrival.agentId);
      window.clearTimeout(newAgentTimerRef.current);
      newAgentTimerRef.current = window.setTimeout(() => setNewAgentId(null), NEW_AGENT_HIGHLIGHT_MS);
      onRecentAgentArrivalSeen?.();
    }, 0);
    return () => window.clearTimeout(t);
  }, [displayMachines, onRecentAgentArrivalSeen, recentAgentArrival]);

  React.useEffect(() => () => window.clearTimeout(newAgentTimerRef.current), []);

  // Track the size of the area LEFT of the (unscaled) detail panel.
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setArea({ w: Math.max(0, r.width - PANEL_W), h: r.height, full: r.width });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Zoom & pan (parity with the legacy graph: wheel to zoom, drag to pan) ──
  const applyZoom = React.useCallback((nextZoomRaw: number, pivot?: { x: number; y: number }) => {
    setView((v) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));
      if (nextZoom === v.zoom) return v;
      const r = nextZoom / v.zoom;
      // Keep the pivot (default: the area centre) stationary while zooming.
      const dx = (pivot?.x ?? area.w / 2) - area.w / 2;
      const dy = (pivot?.y ?? area.h / 2) - area.h / 2;
      return { zoom: nextZoom, x: dx * (1 - r) + v.x * r, y: dy * (1 - r) + v.y * r };
    });
  }, [area.w, area.h]);

  const resetView = React.useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), []);

  // Wheel-to-zoom, pivoting on the cursor (matches the legacy fleet graph).
  React.useEffect(() => {
    const el = hiveAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
        if (nextZoom === v.zoom) return v;
        const r = nextZoom / v.zoom;
        const dx = px - rect.width / 2;
        const dy = py - rect.height / 2;
        return { zoom: nextZoom, x: dx * (1 - r) + v.x * r, y: dy * (1 - r) + v.y * r };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [initialLoading]);

  // Drag-to-pan from the empty canvas. A real drag swallows the trailing click
  // so it doesn't also (de)select a cell; a tap with no movement clicks through.
  const onPanPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const start = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      ev.preventDefault();
      start.moved = true;
      setView((v) => ({ ...v, x: start.ox + dx, y: start.oy + dy }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (start.moved) {
        const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [view.x, view.y]);

  const getMachineUpdate = React.useCallback((m: HiveMachine) => {
    const status = updateStatusByMachine?.[m.id];
    const detail = updateDetailByMachine?.[m.id];
    const canUpdate = Boolean(m.source.canUpdate) || m.versionState === "stale";
    const busy = status === "updating";
    const failed = status === "failed";
    const updated = status === "updated";
    // Mirror the legacy roster: surface the chip while updatable, in-flight,
    // just-failed (so retry is reachable), or just-succeeded (confirmation).
    if (!canUpdate && !busy && !failed && !updated) return null;
    const label = busy
      ? (detail?.label ?? "Updating…")
      : failed
        ? "Update · retry"
        : updated
          ? (detail?.label ?? "Updated")
          : (detail?.label ?? "Update");
    // Disable while updating or after success (no redundant re-trigger).
    return { label, busy: busy || updated, canUpdate: canUpdate || busy || failed || updated };
  }, [updateDetailByMachine, updateStatusByMachine]);

  // Tailscale / network-issue repair — POSTs to the same endpoint the legacy
  // roster uses, with a transient per-machine status shown in the panel.
  const [networkFix, setNetworkFix] = React.useState<Record<string, string>>({});
  const fixNetworkIssue = React.useCallback(async (m: HiveMachine) => {
    const action = m.source.networkIssue?.fixAction;
    if (!action) return;
    setNetworkFix((current) => ({ ...current, [m.id]: "Repairing…" }));
    try {
      const response = await fetch("/api/tailscale/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      const message = !response.ok || data?.ok === false
        ? (data?.error || "The automatic repair did not finish.")
        : (data?.message || "Repair started — refresh Fleet in a few seconds.");
      setNetworkFix((current) => ({ ...current, [m.id]: message }));
    } catch {
      setNetworkFix((current) => ({ ...current, [m.id]: "The automatic repair did not finish." }));
    }
  }, []);

  // Route AEON removals through the slide-to-unlock dialog; everything else
  // deletes directly — matching the legacy FleetView behaviour exactly.
  const handleRemove = React.useCallback((m: HiveMachine, a: HiveAgent) => {
    if (isAeonAgent(a.source)) {
      setAeonDeleteTarget({ machine: m.source, agent: a.source });
      return;
    }
    onRemove?.(m.source, a.source);
  }, [onRemove]);

  // Clicking an already-selected hive petal opens that agent's settings — the
  // same handler the panel's Settings chip uses, resolved back to fleet types.
  const openAgentSettings = React.useCallback((machineId: string, agentId: string) => {
    const m = displayMachines.find((x) => x.id === machineId);
    const a = m?.agents.find((x) => x.id === agentId);
    if (m && a) onEditSettings?.(m.source, a.source);
  }, [displayMachines, onEditSettings]);

  const handlers: HivePanelHandlers = {
    onAddAgent: onAddAgent ? (m) => onAddAgent(m.source) : undefined,
    onAddMachine,
    onOpenQueenSettings,
    onCallQueen: () => emitQueenVoiceToggle(),
    onUpdateMachine: onUpdateMachine ? (m) => onUpdateMachine(m.source) : undefined,
    onRenameMachine: onRenameMachine ? (m) => {
      const next = window.prompt("Rename machine", m.name);
      if (next && next.trim() && next.trim() !== m.name) onRenameMachine(m.id, next.trim());
    } : undefined,
    onOpenCodeProof: onOpenCodeProof ? (m) => onOpenCodeProof(m.source) : undefined,
    onFixSyncIssue: onFixSyncIssue ? (m) => { void onFixSyncIssue(m.source); } : undefined,
    onFixNetworkIssue: fixNetworkIssue,
    getNetworkFixStatus: (m) => networkFix[m.id] ?? null,
    onOpenShell: (m) => setTerminalMachine(m.source),
    onSendFile: (m) => setSendFileMachine(m.source),
    onOpenUsePodHost: (m) => setUsePodHostMachine(m.source),
    onCallAgent: onCallAgent ? (m, a) => { void onCallAgent(m.source, a.source); } : undefined,
    onOpenChat: onOpenChat ? (m, a) => onOpenChat(m.source, a.source) : undefined,
    onOpenTaskChat: onOpenTaskChat ? (m, a, chat) => onOpenTaskChat(m.source, a.source, chat) : undefined,
    onOpenWallet: onOpenWallet ? (m, a) => onOpenWallet(m.source, a.source) : undefined,
    onEditSettings: onEditSettings ? (m, a) => onEditSettings(m.source, a.source) : undefined,
    onDuplicate: onDuplicate ? (m, a) => onDuplicate(m.source, a.source) : undefined,
    onRemove: onRemove ? handleRemove : undefined,
    getMachineUpdate,
  };

  return (
    <TooltipProvider delayDuration={120}>
    <div
      className="fr-root"
      data-fr-theme={frTheme}
      style={{
        height: "100%", width: "100%", display: "flex", flexDirection: "column",
        background: "var(--bg)", position: "relative", overflow: "hidden",
        borderRadius: "inherit",
      }}
    >
      <TopBar machines={displayMachines} eyebrow="one swarm, humming" />
      <div ref={wrapRef} style={{ flex: "1 1 auto", position: "relative", minHeight: 0, overflow: "hidden" }}>
        {/* layout (Hive/Classic) toggle floats over the hive canvas, top-left */}
        {layoutToggle ? (
          <div style={{ position: "absolute", top: 14, left: 14, zIndex: 30 }}>{layoutToggle}</div>
        ) : null}
        {/* view-mode (hive/graph/map/list) switcher — right-aligned with the hive canvas */}
        {!initialLoading ? (
          <div style={{ position: "absolute", top: 14, right: viewMode === "hive" ? PANEL_W + 16 : 18, zIndex: 30 }}>
            <ViewModeToggle mode={viewMode} onChoose={chooseViewMode} />
          </div>
        ) : null}
        {viewMode === "graph" && !initialLoading ? (
          <div className="fr-graph-clock" aria-label="Current time">
            <HudClock />
          </div>
        ) : null}
        {initialLoading ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
            {/* Cap the skeleton so it doesn't scale up to fill the full-bleed
                hive area (the loader is h-full/w-full + scale-to-fit). */}
            <div style={{ width: "min(720px, 100%)", height: "min(460px, 100%)" }}>
              <FleetConstellationLoading />
            </div>
          </div>
        ) : (
          <>
            {viewMode === "hive" ? (
              <>
                {/* hive canvas — fills the space left of the panel. It renders at
                    the drop-in baseline size by default; wheel-zoom and drag-to-pan
                    let the user scale up/down and roam, just like the legacy graph. */}
                <div
                  ref={hiveAreaRef}
                  onPointerDown={onPanPointerDown}
                  style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, right: PANEL_W,
                    overflow: "hidden", cursor: "grab", touchAction: "none", userSelect: "none",
                  }}
                >
                  {/* full-bleed atmosphere — fills the whole area; the hive content
                      (which can be zoomed/panned to any size) floats over it */}
                  <div className="fr-hive-backdrop" aria-hidden />
                  <div
                    style={{
                      position: "absolute", left: "50%", top: "50%", width: HIVE_W, height: HIVE_H,
                      transform: `translate(${-bounds.cx * scale + view.x}px, ${-bounds.cy * scale + view.y}px) scale(${scale})`,
                      transformOrigin: "0 0",
                    }}
                  >
                    <HiveStage
                      machines={displayMachines}
                      sel={effectiveSel}
                      onSelect={setSel}
                      onOpenAgentSettings={onEditSettings ? openAgentSettings : undefined}
                      onAddAgent={handlers.onAddAgent}
                      onAddMachine={onAddMachine}
                      onOpenQueenSettings={onOpenQueenSettings}
                      newAgentId={newAgentId}
                    />
                  </div>
                </div>
                {/* detail panel — full height, unscaled, crisp on the right */}
                <HivePanel
                  machines={displayMachines}
                  sel={effectiveSel}
                  onSelect={setSel}
                  handlers={handlers}
                  walletsByAgent={walletsByAgent}
                />
                {/* zoom controls — sit over the hive, clear of the panel */}
                <div
                  style={{
                    position: "absolute", bottom: 16, right: PANEL_W + 16, zIndex: 30,
                    display: "flex", alignItems: "center", gap: 2, padding: 3,
                    borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--line)",
                    boxShadow: "0 6px 20px rgba(0,0,0,.25)",
                  }}
                >
                  <button
                    type="button" title="Zoom out" aria-label="Zoom out"
                    onClick={() => applyZoom(view.zoom / ZOOM_STEP)}
                    disabled={view.zoom <= MIN_ZOOM + 1e-3}
                    style={ZOOM_BTN_STYLE}
                  >−</button>
                  <button
                    type="button" title="Reset zoom" aria-label="Reset zoom"
                    onClick={resetView}
                    style={{ ...ZOOM_BTN_STYLE, width: "auto", padding: "0 8px", fontSize: 12, color: "var(--fg-3)" }}
                  >{Math.round(view.zoom * 100)}%</button>
                  <button
                    type="button" title="Zoom in" aria-label="Zoom in"
                    onClick={() => applyZoom(view.zoom * ZOOM_STEP)}
                    disabled={view.zoom >= MAX_ZOOM - 1e-3}
                    style={ZOOM_BTN_STYLE}
                  >+</button>
                </div>
              </>
            ) : viewMode === "graph" ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
                <OrbitalGraph
                  machines={machines}
                  selected={selectedMachineId}
                  onSelectMachine={selectMachineById}
                  alerts={alerts}
                  tasks={tasks}
                  ticker={ticker}
                  showClock={false}
                  leftHudInset={16}
                  topLeftHudTop={layoutToggle ? GRAPH_LAYOUT_TOGGLE_HUD_TOP : 14}
                  selectedHudTop={layoutToggle ? GRAPH_LAYOUT_TOGGLE_SELECTED_HUD_TOP : 84}
                  topRightHudTop={58}
                />
              </div>
            ) : viewMode === "map" ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
                <MapView
                  machines={machines}
                  edges={edges}
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  onSelectMachine={selectMachineById}
                  onSelectAgent={selectAgentFleet}
                  onAddAgent={(m) => onAddAgent?.(m)}
                  updateStatusByMachine={updateStatusByMachine}
                  updateDetailByMachine={updateDetailByMachine}
                  onUpdateMachine={onUpdateMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={(m) => setUsePodHostMachine(m)}
                  onOpenShell={(m) => setTerminalMachine(m)}
                  selectionTooltipKey={selectionTooltipKey}
                  onOpenSelectionTooltip={setSelectionTooltipKey}
                  onDismissSelectionTooltip={() => setSelectionTooltipKey(null)}
                />
              </div>
            ) : (
              <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>
                <ListView
                  machines={machines}
                  selected={selectedMachineId}
                  selectedAgentId={selectedAgentId}
                  onSelectMachine={selectMachineById}
                  onSelectAgent={selectAgentFleet}
                  onAddAgent={(m) => onAddAgent?.(m)}
                  onOpenChat={onOpenChat}
                  onOpenTaskChat={onOpenTaskChat}
                  onCallAgent={callAgentFleet}
                  onOpenWallet={onOpenWallet}
                  onEditSettings={onEditSettings}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove ? removeAgentFleet : undefined}
                />
              </div>
            )}
            {refreshing ? <FleetScanOverlay /> : null}
          </>
        )}
      </div>
      {/* The "Message the hive" pill now lives app-wide (PersistentHiveChat at
          the dashboard root) so it persists across every view, not just here. */}

      {aeonDeleteTarget && onRemove ? (
        <AeonDeleteModal
          machine={aeonDeleteTarget.machine}
          agent={aeonDeleteTarget.agent}
          onClose={() => setAeonDeleteTarget(null)}
          onRemove={onRemove}
        />
      ) : null}

      {terminalMachine && typeof document !== "undefined"
        ? createPortal(<MachineTerminalModal machine={terminalMachine} onClose={() => setTerminalMachine(null)} />, document.body)
        : null}

      {sendFileMachine && typeof document !== "undefined"
        ? createPortal(<MachineSendFileModal machine={sendFileMachine} onClose={() => setSendFileMachine(null)} />, document.body)
        : null}

      {usePodHostMachine && typeof document !== "undefined"
        ? createPortal(<UsePodHostModal machine={usePodHostMachine} onClose={() => setUsePodHostMachine(null)} />, document.body)
        : null}
    </div>
    </TooltipProvider>
  );
}

export default FleetHiveView;
