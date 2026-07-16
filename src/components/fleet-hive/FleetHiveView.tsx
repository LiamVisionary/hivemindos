"use client";

/* FleetHiveView.tsx — the redesigned default Fleet view: the Queen orchestrator
   at the heart, machine summaries ringed around her, and the selected cluster's
   agents revealed on demand.

   It consumes the SAME FleetViewProps as the legacy FleetView (AgentsPanel can
   render either one), maps the fleet payload into the lean hive shapes, and
   wires every action chip through to the real handlers — reaching parity with
   the legacy view (call / chat / wallet / settings / duplicate / remove,
   add agent / machine, update / rename / shell / host / code-proof / fix-sync).

   The hive is authored on a fixed 1012×980 stage and scaled to fit; the detail
   panel and chat pill live outside the scaled layer so they stay crisp. */

import * as React from "react";
import { createPortal } from "react-dom";
import { Eye, Focus, Plus } from "lucide-react";
import { AeonDeleteModal, isAeonAgent } from "@/components/fleet/aeon-delete-modal";
import { MachineTerminalModal } from "@/components/fleet/machine-terminal-modal";
import { MachineSendFileModal } from "@/components/fleet/machine-send-file-modal";
import { HiveComputeHostModal } from "@/components/fleet/hive-compute-host-modal";
import { UsePodHostModal } from "@/components/fleet/usepod-host-modal";
import { FleetConstellationLoading, FleetScanOverlay } from "@/components/fleet/fleet-loading";
import { ConnectPhoneModal } from "@/components/phone/ConnectPhoneModal";
import {
  ALERTS, MACHINES, TASKS, TICKER, FLEET_EDGES,
  type FleetAgent, type FleetMachine,
} from "@/components/fleet/fleet-data";
import type { FleetViewProps } from "@/components/fleet/FleetView";
import { HudClock, OrbitalGraph, type OrbitalGraphPalette } from "@/components/fleet/orbital-graph";
import { GraphPaletteToggle } from "@/components/fleet/graph-palette-toggle";
import { MapView } from "@/components/fleet/map-view";
import { ListView } from "@/components/fleet/list-view";
import {
  buildFleetFocus,
  buildFleetSearchIndex,
  searchFleetIndex,
  type FleetSearchFilter,
  type FleetSearchItem,
} from "@/components/fleet/fleet-search";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/design-system/ui/button";
import { emitQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { CompanionView } from "@/features/companion/CompanionView";
import { consumePendingCompanionViewRequest, subscribeCompanionViewRequest } from "@/features/companion/companion-events";
import { useCompanionSettings } from "@/features/companion/use-companion-settings";
import {
  DASHBOARD_TARGET_APPLIED_EVENT,
  dashboardTargetFromSearch,
  type DashboardRouteTarget,
} from "@/features/dashboard/dashboard-navigation";
import { USEPOD_COMPUTE_RENTALS_ENABLED } from "@/lib/config/compute-rentals";
import { DEFAULT_QUEEN_BEE_NAME } from "@/lib/config/queen-bee-personality";
import { HIVE_H, HIVE_W, QX, QY, frBuildLayout } from "./hive-geometry";
import { frBuildLegacyLayout, frLegacyContentBounds } from "./hive-legacy-geometry";
import { mapFleetMachines } from "./fleet-hive-mappers";
import type { HiveAgent, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { isHiveMobileMachine } from "./fleet-hive-types";
import { HiveStage } from "./HiveStage";
import { LegacyHiveStage } from "./LegacyHiveStage";
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
// Keep the default view slightly wider than the authored stage so the Queen and
// machine ring have breathing room without shrinking the hierarchy into icons.
const BASELINE_CANVAS_W = 1280;
const REVEAL_ALL_VERTICAL_CHROME_SPACE = 220;
const HIVE_CENTER = { cx: QX, cy: QY } as const;
const GRAPH_LAYOUT_TOGGLE_HUD_TOP = 86;
const GRAPH_LAYOUT_TOGGLE_SELECTED_HUD_TOP = 158;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25; // ± button multiplier
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const LOCATE_ZOOM = 1.35;
const LOCATE_VIEWPORT_ANIMATION_MS = 460;
const LOCATE_SPOTLIGHT_MS = 1_600;
const ZOOM_BTN_STYLE: React.CSSProperties = {
  width: 28, height: 28, display: "grid", placeItems: "center",
  borderRadius: 9, border: "none", background: "transparent",
  color: "var(--fg-1)", fontSize: 17, lineHeight: 1, cursor: "pointer",
  fontFamily: "var(--f-display)",
};

type FleetViewMode = "hive" | "graph" | "map" | "list" | "companion";
const FLEET_VIEW_MODES: FleetViewMode[] = ["hive", "graph", "map", "list"];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

// The hive / graph / map / list switcher — same set as the legacy FleetView,
// plus "companion" once the hologram-companion module is installed.
function ViewModeToggle({ mode, modes = FLEET_VIEW_MODES, onChoose }: { mode: FleetViewMode; modes?: FleetViewMode[]; onChoose: (m: FleetViewMode) => void }) {
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
      {modes.map((m) => {
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
  tailnetLabel,
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
  queenName = DEFAULT_QUEEN_BEE_NAME,
  onOpenQueenSettings,
  onDuplicate,
  onRemove,
  walletsByAgent,
  layoutToggle,
  onViewModeChange,
  onGraphPaletteChange,
}: FleetViewProps & {
  layoutToggle?: React.ReactNode;
  onViewModeChange?: (mode: FleetViewMode) => void;
  onGraphPaletteChange?: (palette: OrbitalGraphPalette) => void;
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
  const updatingMachineIds = React.useMemo(
    () => new Set(
      Object.entries(updateStatusByMachine ?? {})
        .filter(([, status]) => status === "updating")
        .map(([machineId]) => machineId),
    ),
    [updateStatusByMachine],
  );
  const initialLoading = loading && displayMachines.length === 0;
  const refreshing = loading && !initialLoading;

  const [sel, setSel] = React.useState<HiveSelection>({ type: "queen" });
  const [revealAll, setRevealAll] = React.useState(false);
  // View mode (parity with the legacy FleetView toolbar). "hive" is the new hex
  // layout; graph/map/list reuse the existing visualisations inside this chrome.
  const [viewMode, setViewMode] = React.useState<FleetViewMode>("hive");
  const [graphPalette, setGraphPalette] = React.useState<OrbitalGraphPalette>("classic");
  const chooseViewMode = React.useCallback((mode: FleetViewMode) => {
    setViewMode(mode);
    onViewModeChange?.(mode);
  }, [onViewModeChange]);
  // The hologram companion adds a fifth view mode once its module is
  // installed. Setup-modal "open companion" requests land here (queued if the
  // fleet view wasn't mounted yet — see companion-events.ts).
  const { settings: companionSettings } = useCompanionSettings();
  const availableViewModes = React.useMemo<FleetViewMode[]>(
    () => (companionSettings.installed || viewMode === "companion"
      ? [...FLEET_VIEW_MODES, "companion"]
      : FLEET_VIEW_MODES),
    [companionSettings.installed, viewMode],
  );
  React.useEffect(() => {
    // Deferred so consuming a queued request never sets state synchronously
    // inside the effect (repo hook rules; matches the settle pattern above).
    const t = window.setTimeout(() => {
      if (consumePendingCompanionViewRequest()) chooseViewMode("companion");
    }, 0);
    const unsubscribe = subscribeCompanionViewRequest(() => chooseViewMode("companion"));
    return () => {
      window.clearTimeout(t);
      unsubscribe();
    };
  }, [chooseViewMode]);
  // Companion "hide UI": drops this view's own chrome (TopBar, layout + mode
  // toggles) along with the companion HUDs — just Sara and a ghost restore.
  const [companionImmersive, setCompanionImmersive] = React.useState(false);
  const chromeHidden = viewMode === "companion" && companionImmersive;
  const chooseGraphPalette = React.useCallback((palette: OrbitalGraphPalette) => {
    setGraphPalette(palette);
    onGraphPaletteChange?.(palette);
  }, [onGraphPaletteChange]);
  const [selectionTooltipKey, setSelectionTooltipKey] = React.useState<string | null>(null);
  const [area, setArea] = React.useState<{ w: number; h: number; full: number }>({ w: 0, h: 0, full: 0 });
  // User-controlled zoom (1 = drop-in baseline size) + pan offset, in screen px.
  const [view, setView] = React.useState<{ zoom: number; x: number; y: number }>({ zoom: 1, x: 0, y: 0 });
  const [newAgentId, setNewAgentId] = React.useState<string | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<FleetSearchFilter>("all");
  const [recentSearchKeys, setRecentSearchKeys] = React.useState<string[]>([]);
  const [spotlightKey, setSpotlightKey] = React.useState<string | null>(null);
  const [viewportAnimating, setViewportAnimating] = React.useState(false);

  // Keep the viewport anchored on Queen while cluster contents expand and
  // collapse. This avoids the map drifting when the selection changes.
  const focusedLayout = React.useMemo(() => frBuildLayout(displayMachines), [displayMachines]);
  const legacyLayout = React.useMemo(() => frBuildLegacyLayout(displayMachines), [displayMachines]);
  const layout = revealAll ? legacyLayout : focusedLayout;
  const primaryMobileMachine = React.useMemo(
    () => displayMachines.find(isHiveMobileMachine) ?? null,
    [displayMachines],
  );
  const legacyBounds = React.useMemo(
    () => frLegacyContentBounds(displayMachines, legacyLayout, {
      includePhonePlaceholder: !primaryMobileMachine,
      includeAddMachine: Boolean(onAddMachine),
    }),
    [displayMachines, legacyLayout, onAddMachine, primaryMobileMachine],
  );
  const bounds = revealAll ? { cx: legacyBounds.cx, cy: legacyBounds.cy } : HIVE_CENTER;
  const baseScale = (area.full > 0 && area.h > 0)
    ? revealAll
      ? Math.min(1, area.full / (legacyBounds.w + 48), area.h / (legacyBounds.h + REVEAL_ALL_VERTICAL_CHROME_SPACE))
      : Math.min(area.full / BASELINE_CANVAS_W, area.h / HIVE_H)
    : 1;
  const scale = baseScale * view.zoom;
  const searchIndex = React.useMemo(
    () => buildFleetSearchIndex(displayMachines.map((machine) => machine.source)),
    [displayMachines],
  );
  const searchResults = React.useMemo(
    () => searchFleetIndex(searchIndex, searchQuery, 30),
    [searchIndex, searchQuery],
  );
  const searchRecents = React.useMemo(
    () => recentSearchKeys
      .map((key) => searchIndex.find((item) => item.key === key))
      .filter((item): item is FleetSearchItem => Boolean(item)),
    [recentSearchKeys, searchIndex],
  );
  const fleetFocus = React.useMemo(() => {
    const focus = buildFleetFocus(
      displayMachines.map((machine) => machine.source),
      searchIndex,
      searchQuery,
      statusFilter,
    );
    return {
      active: focus.active,
      machineIds: new Set(focus.machineIds),
      agentIds: new Set(focus.agentIds),
    };
  }, [displayMachines, searchIndex, searchQuery, statusFilter]);
  const [aeonDeleteTarget, setAeonDeleteTarget] = React.useState<{ machine: FleetMachine; agent: FleetAgent } | null>(null);
  const [terminalMachine, setTerminalMachine] = React.useState<FleetMachine | null>(null);
  const [sendFileMachine, setSendFileMachine] = React.useState<FleetMachine | null>(null);
  const [usePodHostMachine, setUsePodHostMachine] = React.useState<FleetMachine | null>(null);
  const [phonePairingOpen, setPhonePairingOpen] = React.useState(false);
  const newAgentTimerRef = React.useRef<number>(0);
  const locateAnimationTimerRef = React.useRef<number>(0);
  const locateSpotlightTimerRef = React.useRef<number>(0);
  const initialRouteLocateHandledRef = React.useRef(false);
  const locateOriginRef = React.useRef<{
    view: { zoom: number; x: number; y: number };
    selection: HiveSelection;
    filter: FleetSearchFilter;
    mode: FleetViewMode;
    revealAll: boolean;
  } | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const hiveAreaRef = React.useRef<HTMLDivElement>(null);

  // Derive a selection that always points at something that still exists, so a
  // removed/renamed machine or agent falls back to the Queen overview without a
  // setState-in-effect cascade.
  const effectiveSel = React.useMemo<HiveSelection>(() => {
    if (sel.type === "phone" && primaryMobileMachine) return { type: "machine", id: primaryMobileMachine.id };
    if (sel.type === "machine" && !displayMachines.some((m) => m.id === sel.id)) return { type: "queen" };
    if (sel.type === "agent") {
      const m = displayMachines.find((x) => x.id === sel.machineId);
      if (!m || !m.agents.some((a) => a.id === sel.id)) return { type: "queen" };
    }
    return sel;
  }, [displayMachines, primaryMobileMachine, sel]);

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

  const captureLocateOrigin = React.useCallback(() => {
    if (locateOriginRef.current) return;
    locateOriginRef.current = { view, selection: effectiveSel, filter: statusFilter, mode: viewMode, revealAll };
  }, [effectiveSel, revealAll, statusFilter, view, viewMode]);

  const changeSearchOpen = React.useCallback((open: boolean) => {
    if (open) captureLocateOrigin();
    setSearchOpen(open);
  }, [captureLocateOrigin]);

  const animateViewport = React.useCallback(() => {
    setViewportAnimating(true);
    window.clearTimeout(locateAnimationTimerRef.current);
    locateAnimationTimerRef.current = window.setTimeout(
      () => setViewportAnimating(false),
      LOCATE_VIEWPORT_ANIMATION_MS,
    );
  }, []);

  const toggleRevealAll = React.useCallback(() => {
    setRevealAll((current) => !current);
    setSel({ type: "queen" });
    setSpotlightKey(null);
    animateViewport();
    setView({ zoom: 1, x: 0, y: 0 });
  }, [animateViewport]);

  const selectHiveNode = React.useCallback((nextSelection: HiveSelection) => {
    setSel(nextSelection);
    if (nextSelection.type === "phone") return;

    if (nextSelection.type === "queen") {
      animateViewport();
      setView({ zoom: 1, x: 0, y: 0 });
      return;
    }

    const machineId = nextSelection.type === "machine" ? nextSelection.id : nextSelection.machineId;
    const target = layout[machineId]?.pos;
    if (!target) return;
    animateViewport();
    setView((current) => {
      const currentScale = baseScale * current.zoom;
      return {
        ...current,
        x: (bounds.cx - target.x) * currentScale,
        y: (bounds.cy - target.y) * currentScale,
      };
    });
  }, [animateViewport, baseScale, bounds.cx, bounds.cy, layout]);

  const locateSearchItem = React.useCallback((item: FleetSearchItem) => {
    const machine = displayMachines.find((candidate) => candidate.id === item.machineId);
    if (!machine) return;
    const target = item.kind === "machine"
      ? layout[machine.id]?.pos
      : layout[machine.id]?.agents.find(({ agent }) => agent.id === item.agentId)?.pos;
    if (!target) return;

    captureLocateOrigin();
    chooseViewMode("hive");
    setStatusFilter("all");
    setSearchQuery(item.label);
    setSearchOpen(false);
    setSel(item.kind === "machine"
      ? { type: "machine", id: machine.id }
      : { type: "agent", id: item.agentId!, machineId: machine.id });

    const nextScale = baseScale * LOCATE_ZOOM;
    animateViewport();
    setView({
      zoom: LOCATE_ZOOM,
      x: (bounds.cx - target.x) * nextScale,
      y: (bounds.cy - target.y) * nextScale,
    });

    setSpotlightKey(item.key);
    window.clearTimeout(locateSpotlightTimerRef.current);
    locateSpotlightTimerRef.current = window.setTimeout(() => setSpotlightKey(null), LOCATE_SPOTLIGHT_MS);
    setRecentSearchKeys((current) => [item.key, ...current.filter((key) => key !== item.key)].slice(0, 6));
  }, [animateViewport, baseScale, bounds.cx, bounds.cy, captureLocateOrigin, chooseViewMode, displayMachines, layout]);

  const restoreLocateOrigin = React.useCallback(() => {
    const origin = locateOriginRef.current;
    if (!origin) return;
    animateViewport();
    setView(origin.view);
    setSel(origin.selection);
    setStatusFilter(origin.filter);
    chooseViewMode(origin.mode);
    setRevealAll(origin.revealAll);
    setSearchQuery("");
    setSearchOpen(false);
    setSpotlightKey(null);
    locateOriginRef.current = null;
  }, [animateViewport, chooseViewMode]);

  const changeStatusFilter = React.useCallback((filter: FleetSearchFilter) => {
    if (filter !== "all") {
      captureLocateOrigin();
      chooseViewMode("hive");
    }
    setStatusFilter(filter);
  }, [captureLocateOrigin, chooseViewMode]);

  const finderAgentTarget = React.useCallback((item: FleetSearchItem) => {
    if (item.kind !== "agent") return null;
    const machine = displayMachines.find((candidate) => candidate.id === item.machineId);
    const agent = machine?.agents.find((candidate) => candidate.id === item.agentId);
    return machine && agent ? { machine, agent } : null;
  }, [displayMachines]);

  const chatFromFinder = React.useCallback((item: FleetSearchItem) => {
    const target = finderAgentTarget(item);
    if (target) onOpenChat?.(target.machine.source, target.agent.source);
  }, [finderAgentTarget, onOpenChat]);

  const settingsFromFinder = React.useCallback((item: FleetSearchItem) => {
    const target = finderAgentTarget(item);
    if (target) onEditSettings?.(target.machine.source, target.agent.source);
  }, [finderAgentTarget, onEditSettings]);

  React.useEffect(() => {
    const locateDashboardTarget = (target: DashboardRouteTarget | null) => {
      if (target?.view !== "agents" || !target.agentId) return;
      const item = searchIndex.find((candidate) => candidate.kind === "agent" && candidate.agentId === target.agentId);
      if (item) locateSearchItem(item);
    };
    const handleAppliedTarget = (event: Event) => {
      locateDashboardTarget((event as CustomEvent<DashboardRouteTarget>).detail ?? null);
    };

    window.addEventListener(DASHBOARD_TARGET_APPLIED_EVENT, handleAppliedTarget);
    if (!initialRouteLocateHandledRef.current && searchIndex.length > 0) {
      initialRouteLocateHandledRef.current = true;
      locateDashboardTarget(dashboardTargetFromSearch(window.location.search));
    }
    return () => window.removeEventListener(DASHBOARD_TARGET_APPLIED_EVENT, handleAppliedTarget);
  }, [locateSearchItem, searchIndex]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "/" && viewMode !== "list" && !chromeHidden && !isEditableTarget(event.target)) {
        event.preventDefault();
        changeSearchOpen(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        searchInputRef.current?.blur();
        return;
      }
      if (locateOriginRef.current && !isEditableTarget(event.target)) {
        event.preventDefault();
        restoreLocateOrigin();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeSearchOpen, chromeHidden, restoreLocateOrigin, searchOpen, viewMode]);

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

  React.useEffect(() => () => {
    window.clearTimeout(newAgentTimerRef.current);
    window.clearTimeout(locateAnimationTimerRef.current);
    window.clearTimeout(locateSpotlightTimerRef.current);
  }, []);

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
    setViewportAnimating(false);
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

  const resetView = React.useCallback(() => {
    setViewportAnimating(false);
    setView({ zoom: 1, x: 0, y: 0 });
  }, []);

  // Wheel-to-zoom, pivoting on the cursor (matches the legacy fleet graph).
  React.useEffect(() => {
    const el = hiveAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setViewportAnimating(false);
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
    setViewportAnimating(false);
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
    const tone: "idle" | "working" | "failed" | "updated" = busy
      ? "working"
      : failed
        ? "failed"
        : updated
          ? "updated"
          : "idle";
    // Disable while updating or after success (no redundant re-trigger).
    return {
      label,
      busy: busy || updated,
      canUpdate: canUpdate || busy || failed || updated,
      detail: detail?.detail,
      tone,
    };
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
    onOpenPhonePairing: () => setPhonePairingOpen(true),
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
      {/* The list view renders its own full-width header + view-mode switcher, so
          the thin TopBar and the floating toggles step aside in that mode. */}
      {viewMode !== "list" && !chromeHidden ? (
        <TopBar
          machines={displayMachines}
          eyebrow="one swarm, humming"
          searchIndex={searchIndex}
          searchInputRef={searchInputRef}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchRecents={searchRecents}
          searchResults={searchResults}
          statusFilter={statusFilter}
          onLocate={locateSearchItem}
          onSearchOpenChange={changeSearchOpen}
          onSearchQueryChange={setSearchQuery}
          onStatusFilterChange={changeStatusFilter}
          onChat={onOpenChat ? chatFromFinder : undefined}
          onSettings={onEditSettings ? settingsFromFinder : undefined}
        />
      ) : null}
      <div ref={wrapRef} style={{ flex: "1 1 auto", position: "relative", minHeight: 0, overflow: "hidden" }}>
        {/* layout (Hive/Classic) toggle floats over the hive canvas, top-left */}
        {layoutToggle && viewMode !== "list" && !chromeHidden ? (
          <div style={{ position: "absolute", top: 14, left: 14, zIndex: 30 }}>{layoutToggle}</div>
        ) : null}
        {/* view-mode (hive/graph/map/list) switcher — right-aligned with the hive canvas */}
        {!initialLoading && viewMode !== "list" && !chromeHidden ? (
          <div
            style={{
              position: "absolute", top: 14, right: viewMode === "hive" ? PANEL_W + 16 : 18, zIndex: 30,
              display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
              flexWrap: "wrap", maxWidth: "calc(100% - 32px)",
            }}
          >
            {viewMode === "graph" ? <GraphPaletteToggle palette={graphPalette} onChoose={chooseGraphPalette} /> : null}
            {viewMode === "hive" ? (
              <div className="fr-hive-toolbar-actions" role="group" aria-label="Hive actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="fr-hive-toolbar-action"
                  data-active={revealAll ? "true" : undefined}
                  aria-pressed={revealAll}
                  onClick={toggleRevealAll}
                  title={revealAll ? "Return to the focused Fleet Hive" : "Reveal the full pre-redesign Fleet Hive"}
                >
                  {revealAll ? <Focus aria-hidden /> : <Eye aria-hidden />}
                  {revealAll ? "Focused view" : "Reveal all"}
                </Button>
                {onAddMachine && !revealAll ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="fr-hive-toolbar-action"
                    data-tone="primary"
                    onClick={onAddMachine}
                  >
                    <Plus aria-hidden />
                    New machine
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ViewModeToggle mode={viewMode} modes={availableViewModes} onChoose={chooseViewMode} />
          </div>
        ) : null}
        {viewMode === "graph" && !initialLoading ? (
          <div className="fr-graph-clock" aria-label="Current time">
            <HudClock palette={graphPalette} />
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
                {/* hive canvas — fills the space left of the panel. Wheel-zoom and
                    drag-to-pan let the user scale up/down and roam. */}
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
                    className="fr-hive-transform"
                    data-locate-animating={viewportAnimating ? "true" : undefined}
                    style={{
                      position: "absolute", left: "50%", top: "50%", width: HIVE_W, height: HIVE_H,
                      transform: `translate(${-bounds.cx * scale + view.x}px, ${-bounds.cy * scale + view.y}px) scale(${scale})`,
                      transformOrigin: "0 0",
                      transition: viewportAnimating
                        ? `transform ${LOCATE_VIEWPORT_ANIMATION_MS}ms cubic-bezier(0.2, 0.82, 0.2, 1)`
                        : "none",
                    }}
                  >
                    {revealAll ? (
                      <LegacyHiveStage
                        machines={displayMachines}
                        sel={effectiveSel}
                        onSelect={setSel}
                        onOpenAgentSettings={onEditSettings ? openAgentSettings : undefined}
                        onAddAgent={handlers.onAddAgent}
                        onAddMachine={onAddMachine}
                        onOpenQueenSettings={onOpenQueenSettings}
                        queenName={queenName}
                        newAgentId={newAgentId}
                        focus={fleetFocus}
                        spotlightKey={spotlightKey}
                        tailnetLabel={tailnetLabel}
                      />
                    ) : (
                      <HiveStage
                        machines={displayMachines}
                        sel={effectiveSel}
                        onSelect={selectHiveNode}
                        onOpenAgentSettings={onEditSettings ? openAgentSettings : undefined}
                        onOpenQueenSettings={onOpenQueenSettings}
                        queenName={queenName}
                        updatingMachineIds={updatingMachineIds}
                        newAgentId={newAgentId}
                        focus={fleetFocus}
                        spotlightKey={spotlightKey}
                        tailnetLabel={tailnetLabel}
                      />
                    )}
                  </div>
                </div>
                {/* detail panel — full height, unscaled, crisp on the right */}
                <HivePanel
                  machines={displayMachines}
                  sel={effectiveSel}
                  onSelect={setSel}
                  handlers={handlers}
                  queenName={queenName}
                  walletsByAgent={walletsByAgent}
                  tailnetLabel={tailnetLabel}
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
                  palette={graphPalette}
                  leftHudInset={16}
                  topLeftHudTop={layoutToggle ? GRAPH_LAYOUT_TOGGLE_HUD_TOP : 14}
                  selectedHudTop={layoutToggle ? GRAPH_LAYOUT_TOGGLE_SELECTED_HUD_TOP : 84}
                  topRightHudTop={58}
                />
              </div>
            ) : viewMode === "companion" ? (
              <CompanionView
                onOpenQueenSettings={onOpenQueenSettings}
                immersive={companionImmersive}
                onImmersiveChange={setCompanionImmersive}
              />
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
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
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
                  viewMode={viewMode}
                  onSelectViewMode={chooseViewMode}
                  headerAux={layoutToggle}
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
        ? createPortal(
          USEPOD_COMPUTE_RENTALS_ENABLED
            ? <UsePodHostModal machine={usePodHostMachine} onClose={() => setUsePodHostMachine(null)} />
            : <HiveComputeHostModal machine={usePodHostMachine} machines={machines} onClose={() => setUsePodHostMachine(null)} />,
          document.body,
        )
        : null}

      <ConnectPhoneModal open={phonePairingOpen} onClose={() => setPhonePairingOpen(false)} />
    </div>
    </TooltipProvider>
  );
}

export default FleetHiveView;
