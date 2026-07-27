// src/components/fleet/network-graph.tsx
"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddHexCell } from "./add-hex-cell";
import { BeeIcon } from "./bee-icon";
import { HexTile } from "./hex-tile";
import { MachineCluster, type GraphAgentCapabilityBadgeVariant } from "./machine-cluster";
import { LottieBee } from "./lottie-bee";
import { type FleetAgent, type FleetAgentChat, type FleetMachine } from "./fleet-data";
import { axialToPixel, FLEET_GRAPH_CELL_SCALE, HEX_H, HEX_W, hexSpiral } from "./hex-math";
import type { AeonDeleteDepth, AeonDeleteProgress, AeonDeleteResult, MachineUpdateButtonDetail, MachineUpdateButtonStatus } from "./roster";

interface NetworkGraphProps {
  width?: number;
  height?: number;
  machines: FleetMachine[];
  edges: Array<[string, string]>;
  selected: string;
  selectedAgentId: string | null;
  onSelectMachine: (id: string) => void;
  onSelectAgent: (m: FleetMachine, a: FleetAgent) => void;
  onAddAgent: (m: FleetMachine) => void;
  onAddMachine?: () => void;
  updateStatusByMachine?: Record<string, MachineUpdateButtonStatus>;
  updateDetailByMachine?: Record<string, MachineUpdateButtonDetail>;
  onUpdateMachine?: (m: FleetMachine) => void;
  onOpenCodeProof?: (m: FleetMachine) => void;
  onFixSyncIssue?: (m: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (m: FleetMachine) => void;
  onOpenShell?: (m: FleetMachine) => void;
  onOpenChat?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenTaskChat?: (m: FleetMachine, a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenWallet?: (m: FleetMachine, a: FleetAgent) => void;
  onEditSettings?: (m: FleetMachine, a: FleetAgent) => void;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (
    m: FleetMachine,
    a: FleetAgent,
    depth?: AeonDeleteDepth,
    onProgress?: (progress: AeonDeleteProgress) => void,
  ) => void | Promise<AeonDeleteResult | void>;
  selectionTooltipKey?: string | null;
  onOpenSelectionTooltip?: (key: string) => void;
  onDismissSelectionTooltip?: () => void;
  /** `machineId:agentId` of a just-added agent — its hex bounces and the view pans to it. */
  newAgentKey?: string | null;
  agentCapabilityBadgeVariant?: GraphAgentCapabilityBadgeVariant;
  /** When provided, the logical Queen Bee renders as her own central hive cell connected to every machine; clicking opens her settings. */
  onOpenQueenSettings?: () => void;
}

const CLUSTER_LAYOUT: Record<string, [number, number]> = {
  atlas:     [0.22, 0.38],
  nimbus:    [0.66, 0.34],
  lattice:   [0.16, 0.80],
  honeycomb: [0.52, 0.80],
  "drone-01":[0.88, 0.78],
};

const FALLBACK_LAYOUT_SLOTS: Array<[number, number]> = [
  [0.50, 0.70], // primary / This Mac
  [0.50, 0.38], // remote Mac / laptop
  [0.72, 0.54], // server / VPS
  [0.28, 0.54], // saved profiles / unassigned
  [0.22, 0.38],
  [0.66, 0.34],
  [0.16, 0.80],
  [0.88, 0.78],
];
const GRAPH_MIN_ZOOM = 0.55;
const GRAPH_MAX_ZOOM = 1.9;
const GRAPH_WHEEL_ZOOM_SENSITIVITY = 0.00065;
const graphScale = (value: number) => value * FLEET_GRAPH_CELL_SCALE;
const ADD_MACHINE_LABEL_HEIGHT = graphScale(26);
const ADD_MACHINE_CLEARANCE = graphScale(44);
const ADD_AGENT_CLEARANCE = graphScale(18);
// The queen sits as close to the colony's centre as the clusters allow.
const QUEEN_NODE_ID = "queen-bee";
const QUEEN_CLEARANCE = graphScale(14);
const GRAPH_CELL_MARGIN = graphScale(16);
const ADD_AGENT_SEARCH_EXTRA_CELLS = 60;
const FLEET_GRAPH_BASE_SIZE = 900;
const FLEET_GRAPH_SIZE = FLEET_GRAPH_BASE_SIZE * FLEET_GRAPH_CELL_SCALE;

type AxialCell = [number, number];

interface GraphCluster {
  m: FleetMachine;
  cx: number;
  cy: number;
  addCell?: AxialCell;
  selected: boolean;
  selectedAgentId: string | null;
}

interface GraphRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type GraphViewTransform = {
  x: number;
  y: number;
  zoom: number;
};

/**
 * Constellation view — every machine is a tessellated cluster of hex cells;
 * dashed Tailscale arcs connect clusters; 1–2 honey bees roam those arcs.
 */
export function NetworkGraph({
  width = FLEET_GRAPH_SIZE, height = FLEET_GRAPH_SIZE,
  machines, edges,
  selected, selectedAgentId,
  onSelectMachine, onSelectAgent, onAddAgent, onAddMachine,
  updateStatusByMachine,
  updateDetailByMachine,
  onUpdateMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
  onOpenShell,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
  selectionTooltipKey,
  onOpenSelectionTooltip,
  onDismissSelectionTooltip,
  newAgentKey,
  agentCapabilityBadgeVariant = "side-rails",
  onOpenQueenSettings,
}: NetworkGraphProps) {
  const w = width, h = height;
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const graphLayerRef = React.useRef<HTMLDivElement | null>(null);
  const graphViewRef = React.useRef<GraphViewTransform>({ x: 0, y: 0, zoom: 1 });
  const wheelDeltaRef = React.useRef(0);
  const wheelFrameRef = React.useRef(0);
  const wheelPointerRef = React.useRef({ x: 0, y: 0 });
  const boundsRef = React.useRef(contentBounds([], undefined));
  const centeredViewportRef = React.useRef({ width: 0, height: 0 });
  const dragRef = React.useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [graphView, setGraphView] = React.useState<GraphViewTransform>({ x: 0, y: 0, zoom: 1 });
  const [dragging, setDragging] = React.useState(false);
  const graphTransform = graphTransformValue(graphView);
  const [layoutState, setLayoutState] = React.useState(() => ({
    machines,
    layout: makeClusterLayout(machines, sessionClusterLayout),
  }));
  let layout = layoutState.layout;
  if (layoutState.machines !== machines) {
    // Seed each re-layout from the layout currently on screen so machines keep
    // their slots when a later data load (e.g. live discovery after the cached
    // index paint) changes the machines array.
    layout = makeClusterLayout(machines, layoutState.layout);
    setLayoutState({ machines, layout });
  }
  React.useEffect(() => {
    sessionClusterLayout = layout;
  }, [layout]);
  const baseClusters = React.useMemo(() => machines.map((m) => ({
    m,
    cx: layout[m.id][0] * w,
    cy: layout[m.id][1] * h,
    selected: selected === m.id,
    selectedAgentId: selected === m.id ? selectedAgentId : null,
  })), [machines, layout, w, h, selected, selectedAgentId]);
  const hasQueen = Boolean(onOpenQueenSettings);
  const queenPoint = React.useMemo(
    () => (hasQueen ? findQueenPoint(baseClusters, w, h) : null),
    [baseClusters, hasQueen, w, h],
  );
  const clusters = React.useMemo(() => {
    const spacedClusters = queenPoint ? pushClustersClearOfQueen(baseClusters, queenPoint) : baseClusters;
    return assignAddCells(spacedClusters, queenPoint ? [queenCellRect(queenPoint)] : []);
  }, [baseClusters, queenPoint]);
  const addMachinePoint = React.useMemo(() => findAddMachinePoint(clusters, w, h, queenPoint), [clusters, h, w, queenPoint]);
  const pos: Record<string, { x: number; y: number }> = Object.fromEntries(
    clusters.map((c) => [c.m.id, { x: c.cx, y: c.cy }]),
  );
  if (queenPoint) pos[QUEEN_NODE_ID] = queenPoint;
  const queenEdges: Array<[string, string]> = queenPoint
    ? clusters.map((c) => [QUEEN_NODE_ID, c.m.id])
    : [];
  const allEdges = [...edges, ...queenEdges];
  const latestBeeGraphRef = React.useRef({ edges: allEdges, pos });
  const latestClustersRef = React.useRef(clusters);
  const bounds = React.useMemo(() => contentBounds(clusters, addMachinePoint, queenPoint), [clusters, addMachinePoint, queenPoint]);

  const clampPan = React.useCallback((next: { x: number; y: number }, nextZoom: number) => {
    return {
      x: clampAxis(next.x, viewport.width, bounds.minX, bounds.maxX, nextZoom),
      y: clampAxis(next.y, viewport.height, bounds.minY, bounds.maxY, nextZoom),
    };
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, viewport.height, viewport.width]);

  const applyGraphView = React.useCallback((next: GraphViewTransform) => {
    graphViewRef.current = next;
    if (graphLayerRef.current) graphLayerRef.current.style.transform = graphTransformValue(next);
    setGraphView(next);
  }, []);

  React.useLayoutEffect(() => {
    latestBeeGraphRef.current = { edges: allEdges, pos };
  });

  React.useLayoutEffect(() => {
    latestClustersRef.current = clusters;
  });

  // Pan the graph so a just-added agent's hex lands in view while it bounces.
  React.useEffect(() => {
    if (!newAgentKey) return;
    const element = viewportRef.current;
    if (!element || !element.clientWidth || !element.clientHeight) return;
    const cluster = latestClustersRef.current.find((c) =>
      c.m.agents.some((a) => `${c.m.id}:${a.id}` === newAgentKey),
    );
    if (!cluster) return;
    const agentIndex = cluster.m.agents.findIndex((a) => `${cluster.m.id}:${a.id}` === newAgentKey);
    const cell = hexSpiral(cluster.m.agents.length + 1)[agentIndex + 1] ?? [0, 0];
    const offset = axialToPixel(cell[0], cell[1]);
    const target = { x: cluster.cx + offset.x, y: cluster.cy + offset.y };
    const current = graphViewRef.current;
    const nextBounds = boundsRef.current;
    applyGraphView({
      ...current,
      x: clampAxis(element.clientWidth / 2 - target.x * current.zoom, element.clientWidth, nextBounds.minX, nextBounds.maxX, current.zoom),
      y: clampAxis(element.clientHeight / 2 - target.y * current.zoom, element.clientHeight, nextBounds.minY, nextBounds.maxY, current.zoom),
    });
  }, [applyGraphView, newAgentKey]);

  React.useLayoutEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  React.useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    if (!viewport.width || !viewport.height) return;
    const centeredViewport = centeredViewportRef.current;
    if (centeredViewport.width === viewport.width && centeredViewport.height === viewport.height) return;
    centeredViewportRef.current = viewport;
    const nextBounds = boundsRef.current;
    const current = graphViewRef.current;
    const nextPan = {
      x: viewport.width / 2 - ((nextBounds.minX + nextBounds.maxX) / 2) * current.zoom,
      y: viewport.height / 2 - ((nextBounds.minY + nextBounds.maxY) / 2) * current.zoom,
    };
    applyGraphView({
      ...current,
      x: clampAxis(nextPan.x, viewport.width, nextBounds.minX, nextBounds.maxX, current.zoom),
      y: clampAxis(nextPan.y, viewport.height, nextBounds.minY, nextBounds.maxY, current.zoom),
    });
  }, [applyGraphView, viewport]);

  const zoomGraphWithWheel = React.useCallback((event: WheelEvent) => {
    event.preventDefault();
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    wheelDeltaRef.current += event.deltaY;
    wheelPointerRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    if (wheelFrameRef.current) return;
    wheelFrameRef.current = requestAnimationFrame(() => {
      wheelFrameRef.current = 0;
      const deltaY = wheelDeltaRef.current;
      wheelDeltaRef.current = 0;
      const viewportElement = viewportRef.current;
      if (!viewportElement || !deltaY) return;
      const pointer = wheelPointerRef.current;
      const current = graphViewRef.current;
      const nextZoom = clampNumber(
        current.zoom * Math.exp(-deltaY * GRAPH_WHEEL_ZOOM_SENSITIVITY),
        GRAPH_MIN_ZOOM,
        GRAPH_MAX_ZOOM,
      );
      if (nextZoom === current.zoom) return;
      const contentPoint = {
        x: (pointer.x - current.x) / current.zoom,
        y: (pointer.y - current.y) / current.zoom,
      };
      const nextPan = {
        x: pointer.x - contentPoint.x * nextZoom,
        y: pointer.y - contentPoint.y * nextZoom,
      };
      applyGraphView({
        ...nextPan,
        zoom: nextZoom,
      });
    });
  }, [applyGraphView]);

  React.useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.addEventListener("wheel", zoomGraphWithWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", zoomGraphWithWheel);
      if (wheelFrameRef.current) cancelAnimationFrame(wheelFrameRef.current);
    };
  }, [zoomGraphWithWheel]);

  // 2 bees roam the network — each picks an edge at random, traverses it,
  // then picks another. Position is mutated via refs (no React re-renders).
  const BEE_COUNT = 2;
  const beeRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const beeStateRef = React.useRef(
    Array.from({ length: BEE_COUNT }, (_, i) => ({
      edgeIdx: i,
      t0: i * 900,
      dur: 3200 + i * 600,
      dir: i % 2 === 0 ? 1 : -1,
    })),
  );

  React.useEffect(() => {
    let raf = 0;
    let lastFrame = 0;
    const SZ = graphScale(44);
    const tick = (now: number) => {
      // Skip the bee animation while the tab/window is hidden; keep the loop
      // scheduled so it resumes instantly when the page becomes visible again.
      if (document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // Decorative roaming bees — ~30fps is plenty and halves the style-write
      // and compositor churn (quarters it on 120Hz displays). Bee phase is
      // derived from absolute time, so motion speed is unchanged.
      if (now - lastFrame < 33) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      const { edges: currentEdges, pos: currentPos } = latestBeeGraphRef.current;
      for (let i = 0; i < BEE_COUNT; i++) {
        const el = beeRefs.current[i];
        if (!currentEdges.length) {
          if (el) el.style.opacity = "0";
          beeStateRef.current[i].t0 = now;
          continue;
        }
        const s = beeStateRef.current[i];
        if ((now - s.t0) / s.dur >= 1) {
          s.edgeIdx = (s.edgeIdx + i + 1) % currentEdges.length;
          s.dir = s.dir === 1 ? -1 : 1;
          s.t0 = now;
        }
        if (s.edgeIdx >= currentEdges.length) s.edgeIdx = i % currentEdges.length;
        const phase = Math.min(Math.max((now - s.t0) / s.dur, 0), 1);
        const p = s.dir === 1 ? phase : 1 - phase;
        const [a, b] = currentEdges[s.edgeIdx] ?? [];
        const A = currentPos[a], B = currentPos[b];
        if (!A || !B) {
          if (el) el.style.opacity = "0";
          continue;
        }
        const x = A.x + (B.x - A.x) * p;
        const y = A.y + (B.y - A.y) * p;
        const o = Math.sin(phase * Math.PI);
        const flip = (s.dir === 1 ? B.x - A.x : A.x - B.x) < 0 ? -1 : 1;
        if (el) {
          el.style.transform = `translate(${x - SZ / 2}px, ${y - SZ / 2}px) scaleX(${flip})`;
          el.style.opacity = String(o);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden"
      data-fleet-graph-viewport="true"
      style={{ cursor: dragging ? "grabbing" : "grab", overscrollBehavior: "contain", touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button, [data-fleet-cell-control]")) return;
        const current = graphViewRef.current;
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: current.x, panY: current.y };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const current = graphViewRef.current;
        applyGraphView({
          ...current,
          ...clampPan({
            x: drag.panX + event.clientX - drag.x,
            y: drag.panY + event.clientY - drag.y,
          }, current.zoom),
        });
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      aria-label="Fleet graph canvas. Drag to pan across machines. Scroll to zoom in and out."
    >
      <div
        ref={graphLayerRef}
        className="absolute left-0 top-0"
        data-fleet-graph-layer="true"
        style={{
          width: w,
          height: h,
          transform: graphTransform,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
      {/* Dashed Tailscale edges */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        aria-hidden
        className="absolute inset-0 pointer-events-none"
      >
        <defs>
          <linearGradient id="fleetEdge" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={w} y2={h}>
            <stop offset="0%"   stopColor="var(--edge-stroke-start)" />
            <stop offset="100%" stopColor="var(--edge-stroke-end)" />
          </linearGradient>
        </defs>
        {edges.map(([a, b], i) => {
          const A = pos[a], B = pos[b];
          if (!A || !B) return null;
          return (
            <line
              key={i}
              x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke="url(#fleetEdge)"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              opacity={0.85}
            />
          );
        })}
        {/* Honey arcs from the queen to every hive */}
        {queenEdges.map(([a, b], i) => {
          const A = pos[a], B = pos[b];
          if (!A || !B) return null;
          return (
            <line
              key={`queen-${i}`}
              x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke="var(--hex-honey-border)"
              strokeWidth={1.2}
              strokeDasharray="2 6"
              opacity={0.55}
            />
          );
        })}
      </svg>

      {/* Clusters (frosted glass over the lines) */}
      {clusters.map((c) => (
        <MachineCluster
          key={c.m.id}
          machine={c.m}
          cx={c.cx}
          cy={c.cy}
          addCell={c.addCell}
          capabilityBadgeVariant={agentCapabilityBadgeVariant}
          selected={c.selected}
          selectedAgentId={c.selectedAgentId}
          onSelectMachine={() => onSelectMachine(c.m.id)}
          onSelectAgent={onSelectAgent}
          onAddAgent={onAddAgent}
          updateStatus={updateStatusByMachine?.[c.m.id]}
          updateDetail={updateDetailByMachine?.[c.m.id]}
          onUpdateMachine={onUpdateMachine}
          onOpenCodeProof={onOpenCodeProof}
          onFixSyncIssue={onFixSyncIssue}
          onOpenUsePodHost={onOpenUsePodHost}
          onOpenShell={onOpenShell}
          onOpenChat={onOpenChat}
          onOpenTaskChat={onOpenTaskChat}
          onCallAgent={onCallAgent}
          onOpenWallet={onOpenWallet}
          onEditSettings={onEditSettings}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          selectionTooltipKey={selectionTooltipKey}
          onOpenSelectionTooltip={onOpenSelectionTooltip}
          onDismissSelectionTooltip={onDismissSelectionTooltip}
          newAgentKey={newAgentKey}
        />
      ))}

      {/* Queen Bee — the colony's central hive cell */}
      {queenPoint && onOpenQueenSettings ? (
        <div
          className="absolute grid justify-items-center"
          style={{
            left: queenPoint.x - HEX_W / 2,
            top: queenPoint.y - HEX_H / 2,
            width: HEX_W,
            gap: graphScale(6),
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <HexTile
                size={HEX_W}
                tone="honey"
                role="button"
                tabIndex={0}
                aria-label="Queen Bee settings"
                data-fleet-cell-control="true"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenQueenSettings();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenQueenSettings();
                }}
              >
                <BeeIcon role="queen" size={graphScale(40)} />
              </HexTile>
            </TooltipTrigger>
            <TooltipContent>Queen Bee settings</TooltipContent>
          </Tooltip>
          <span
            className="pointer-events-none text-center"
            style={{
              color: "var(--hex-honey-border)",
              fontFamily: "var(--f-mono)",
              fontSize: graphScale(10),
              lineHeight: 1.2,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            queen bee
          </span>
        </div>
      ) : null}

      {onAddMachine ? (
        <div
          className="absolute grid justify-items-center"
          style={{
            left: addMachinePoint.x - HEX_W / 2,
            top: addMachinePoint.y - HEX_H / 2,
            width: HEX_W,
            gap: graphScale(6),
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <AddHexCell
                size={HEX_W}
                onClick={(event) => {
                  event.stopPropagation();
                  onAddMachine();
                }}
                label="Initialize new machine"
              />
            </TooltipTrigger>
            <TooltipContent>Initialize new machine</TooltipContent>
          </Tooltip>
          <span
            className="pointer-events-none text-center"
            style={{
              color: "var(--muted)",
              fontFamily: "var(--f-mono)",
              fontSize: graphScale(10),
              lineHeight: 1.2,
            }}
          >
            new machine
          </span>
        </div>
      ) : null}

      {/* Roaming bees (above clusters so they're always visible) */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: BEE_COUNT }).map((_, i) => (
          <div
            key={i}
            ref={(el) => { beeRefs.current[i] = el; }}
            className="absolute pointer-events-none"
            style={{
              top: 0, left: 0,
              width: graphScale(44), height: graphScale(44),
              opacity: 0,
              willChange: "transform, opacity",
              filter: "drop-shadow(0 2px 6px rgba(255, 200, 60, 0.45))",
            }}
          >
            <LottieBee size={graphScale(44)} />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

// Latest committed layout for this session, so a remount (view switch, loading
// skeleton swap) restores the same arrangement instead of re-seeding from scratch.
let sessionClusterLayout: Record<string, [number, number]> = {};

function makeClusterLayout(machines: FleetMachine[], previousLayout: Record<string, [number, number]> = {}) {
  const fallback: Record<string, [number, number]> = {};
  const usedSlots = new Set<number>();
  const sorted = [...machines].sort((left, right) => (
    layoutSortKey(left).localeCompare(layoutSortKey(right))
  ));
  // Two passes: machines keep their previous slot before any newcomer is placed,
  // so a machine arriving in a later data load cannot displace one already on screen.
  const unplaced: FleetMachine[] = [];
  sorted.forEach((machine) => {
    const previousSlot = previousLayoutSlot(machine, previousLayout);
    if (previousSlot !== null && !usedSlots.has(previousSlot)) {
      usedSlots.add(previousSlot);
      fallback[machine.id] = FALLBACK_LAYOUT_SLOTS[previousSlot];
      fallback[machineLayoutIdentity(machine)] = FALLBACK_LAYOUT_SLOTS[previousSlot];
      return;
    }
    unplaced.push(machine);
  });
  unplaced.forEach((machine) => {
    const slotIndex = nextAvailableLayoutSlot(preferredLayoutSlot(machine), usedSlots);
    usedSlots.add(slotIndex);
    fallback[machine.id] = FALLBACK_LAYOUT_SLOTS[slotIndex];
    fallback[machineLayoutIdentity(machine)] = FALLBACK_LAYOUT_SLOTS[slotIndex];
  });
  return { ...fallback, ...CLUSTER_LAYOUT };
}

function previousLayoutSlot(machine: FleetMachine, previousLayout: Record<string, [number, number]>) {
  const candidates = [machine.id, machineLayoutIdentity(machine)];
  for (const key of candidates) {
    const slot = fallbackLayoutSlotIndex(previousLayout[key]);
    if (slot !== null) return slot;
  }
  return null;
}

function fallbackLayoutSlotIndex(slot?: [number, number]) {
  if (!slot) return null;
  const index = FALLBACK_LAYOUT_SLOTS.findIndex(([x, y]) => x === slot[0] && y === slot[1]);
  return index >= 0 ? index : null;
}

function layoutSortKey(machine: FleetMachine) {
  return machine.id;
}

function machineLayoutIdentity(machine: FleetMachine) {
  return [
    machine.name,
    machine.tailnet,
    machine.ip,
  ].join("|").toLowerCase();
}

function preferredLayoutSlot(machine: FleetMachine) {
  const identity = [
    machine.id,
    machine.name,
    machine.tailnet,
    machine.ip,
  ].join(" ").toLowerCase();

  if (machine.id === "unassigned" || identity.includes("saved profiles")) return 3;
  if (
    machine.role === "Primary" ||
    identity.includes("this mac")
  ) {
    return 0;
  }
  if (
    identity.includes("ubuntu") ||
    identity.includes("linux") ||
    identity.includes("server") ||
    identity.includes("vps")
  ) {
    return 2;
  }
  if (
    identity.includes("mbp") ||
    identity.includes("macbook") ||
    identity.includes("mac") ||
    identity.includes("laptop")
  ) {
    return 1;
  }

  return 4 + (stableHash(machine.id) % (FALLBACK_LAYOUT_SLOTS.length - 4));
}

function nextAvailableLayoutSlot(preferredSlot: number, usedSlots: Set<number>) {
  for (let offset = 0; offset < FALLBACK_LAYOUT_SLOTS.length; offset += 1) {
    const slot = (preferredSlot + offset) % FALLBACK_LAYOUT_SLOTS.length;
    if (!usedSlots.has(slot)) return slot;
  }
  return preferredSlot;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function assignAddCells(clusters: GraphCluster[], reservedRects: GraphRect[] = []) {
  const existingRects = clusters.map((cluster) => cellsRect(cluster.cx, cluster.cy, cluster.m.agents.length + 1));
  const assignedAddRects: GraphRect[] = [];

  return clusters.map((cluster, index) => {
    const existingCount = cluster.m.agents.length + 1;
    const fallback = hexSpiral(existingCount + 1)[existingCount] ?? [0, 0];
    const otherRects = [
      ...existingRects.filter((_, rectIndex) => rectIndex !== index),
      ...assignedAddRects,
      ...reservedRects,
    ];
    const candidates = hexSpiral(existingCount + ADD_AGENT_SEARCH_EXTRA_CELLS).slice(existingCount);
    const addCell = candidates.find(([q, r]) => {
      const rect = cellRect(cluster.cx, cluster.cy, q, r);
      return otherRects.every((otherRect) => !rectsOverlap(rect, otherRect, ADD_AGENT_CLEARANCE));
    }) ?? fallback;
    assignedAddRects.push(cellRect(cluster.cx, cluster.cy, addCell[0], addCell[1]));
    return { ...cluster, addCell };
  });
}

function findAddMachinePoint(clusters: GraphCluster[], width: number, height: number, queenPoint?: { x: number; y: number } | null) {
  const preferred = { x: width * 0.72, y: height * 0.28 };
  const obstacleRects = [
    ...clusters.map(clusterRect),
    ...(queenPoint ? [queenCellRect(queenPoint)] : []),
  ];
  const candidates = addMachineCandidates(preferred, width, height);
  return candidates.find((point) => (
    obstacleRects.every((rect) => !rectsOverlap(addMachineRect(point), rect, ADD_MACHINE_CLEARANCE))
  )) ?? preferred;
}

// The queen claims the visual middle of the colony — the centre of the
// clusters' combined bounding box. She never moves for the machines; any
// cluster sitting on the centre is pushed outward instead (see
// pushClustersClearOfQueen), so the hives arrange themselves around her.
function findQueenPoint(clusters: GraphCluster[], width: number, height: number) {
  if (!clusters.length) return { x: width * 0.5, y: height * 0.55 };
  const merged = clusters.map(clusterRect).reduce(mergeRects);
  return {
    x: (merged.minX + merged.maxX) / 2,
    y: (merged.minY + merged.maxY) / 2,
  };
}

// Slide any cluster that overlaps the queen's cell directly away from her,
// just far enough that one axis clears. The default slot grid stacks machines
// through the centre, so without this there is often no queen-sized gap and
// she would be exiled to the edge of the constellation.
function pushClustersClearOfQueen(clusters: GraphCluster[], queenPoint: { x: number; y: number }) {
  const queenRect = queenCellRect(queenPoint);
  return clusters.map((cluster) => {
    const rect = clusterRect(cluster);
    if (!rectsOverlap(rect, queenRect, QUEEN_CLEARANCE)) return cluster;
    let dx = cluster.cx - queenPoint.x;
    let dy = cluster.cy - queenPoint.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      dx = 0;
      dy = 1;
    } else {
      dx /= length;
      dy /= length;
    }
    // Travel needed along the push direction to separate on each axis; the
    // cheaper axis wins. Both are positive because the rects overlap.
    const neededX = dx >= 0
      ? queenRect.maxX + QUEEN_CLEARANCE - rect.minX
      : rect.maxX - (queenRect.minX - QUEEN_CLEARANCE);
    const neededY = dy >= 0
      ? queenRect.maxY + QUEEN_CLEARANCE - rect.minY
      : rect.maxY - (queenRect.minY - QUEEN_CLEARANCE);
    const travelX = dx ? neededX / Math.abs(dx) : Infinity;
    const travelY = dy ? neededY / Math.abs(dy) : Infinity;
    const travel = Math.max(0, Math.min(travelX, travelY));
    return { ...cluster, cx: cluster.cx + dx * travel, cy: cluster.cy + dy * travel };
  });
}

function queenCellRect(point: { x: number; y: number }): GraphRect {
  return {
    minX: point.x - HEX_W / 2,
    maxX: point.x + HEX_W / 2,
    minY: point.y - HEX_H / 2,
    maxY: point.y + HEX_H / 2 + ADD_MACHINE_LABEL_HEIGHT,
  };
}

function addMachineCandidates(preferred: { x: number; y: number }, width: number, height: number) {
  const minX = HEX_W / 2 + GRAPH_CELL_MARGIN;
  const maxX = width - HEX_W / 2 - GRAPH_CELL_MARGIN;
  const minY = HEX_H / 2 + GRAPH_CELL_MARGIN;
  const maxY = height - HEX_H / 2 - ADD_MACHINE_LABEL_HEIGHT - GRAPH_CELL_MARGIN;
  const stepX = HEX_W * 0.82;
  const stepY = HEX_H * 0.72;
  const points: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();

  for (let radius = 0; radius <= 8; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const point = {
          x: clampNumber(preferred.x + dx * stepX, minX, maxX),
          y: clampNumber(preferred.y + dy * stepY, minY, maxY),
        };
        const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(point);
      }
    }
  }

  return points.sort((left, right) => {
    const leftDistance = squaredDistance(left, preferred);
    const rightDistance = squaredDistance(right, preferred);
    return leftDistance - rightDistance || left.y - right.y || right.x - left.x;
  });
}

function clusterRect(cluster: GraphCluster): GraphRect {
  const rect = cellsRect(
    cluster.cx,
    cluster.cy,
    cluster.m.agents.length + 1,
  );
  if (cluster.selected && !cluster.selectedAgentId && cluster.addCell) {
    return mergeRects(rect, cellRect(cluster.cx, cluster.cy, cluster.addCell[0], cluster.addCell[1]));
  }
  return rect;
}

function cellsRect(cx: number, cy: number, cellCount: number): GraphRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [q, r] of hexSpiral(Math.max(cellCount, 1))) {
    const point = axialToPixel(q, r);
    minX = Math.min(minX, cx + point.x - HEX_W / 2);
    maxX = Math.max(maxX, cx + point.x + HEX_W / 2);
    minY = Math.min(minY, cy + point.y - HEX_H / 2);
    maxY = Math.max(maxY, cy + point.y + HEX_H / 2);
  }

  return { minX, minY, maxX, maxY };
}

function cellRect(cx: number, cy: number, q: number, r: number): GraphRect {
  const point = axialToPixel(q, r);
  return {
    minX: cx + point.x - HEX_W / 2,
    maxX: cx + point.x + HEX_W / 2,
    minY: cy + point.y - HEX_H / 2,
    maxY: cy + point.y + HEX_H / 2,
  };
}

function mergeRects(left: GraphRect, right: GraphRect): GraphRect {
  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minY: Math.min(left.minY, right.minY),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function addMachineRect(point: { x: number; y: number }): GraphRect {
  return {
    minX: point.x - HEX_W / 2,
    maxX: point.x + HEX_W / 2,
    minY: point.y - HEX_H / 2,
    maxY: point.y + HEX_H / 2 + ADD_MACHINE_LABEL_HEIGHT,
  };
}

function rectsOverlap(left: GraphRect, right: GraphRect, gap: number) {
  return !(
    left.maxX + gap <= right.minX ||
    left.minX - gap >= right.maxX ||
    left.maxY + gap <= right.minY ||
    left.minY - gap >= right.maxY
  );
}

function squaredDistance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function graphTransformValue(transform: GraphViewTransform) {
  return `matrix(${transform.zoom}, 0, 0, ${transform.zoom}, ${transform.x}, ${transform.y})`;
}

function contentBounds(clusters: GraphCluster[], addMachinePoint?: { x: number; y: number }, queenPoint?: { x: number; y: number } | null) {
  const padding = 140;
  if (!clusters.length) return { minX: -padding, minY: -padding, maxX: padding, maxY: padding };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cluster of clusters) {
    const rect = clusterRect(cluster);
    minX = Math.min(minX, rect.minX);
    maxX = Math.max(maxX, rect.maxX);
    minY = Math.min(minY, rect.minY);
    maxY = Math.max(maxY, rect.maxY);
  }

  if (queenPoint) {
    const rect = queenCellRect(queenPoint);
    minX = Math.min(minX, rect.minX);
    maxX = Math.max(maxX, rect.maxX);
    minY = Math.min(minY, rect.minY);
    maxY = Math.max(maxY, rect.maxY);
  }

  if (addMachinePoint) {
    minX = Math.min(minX, addMachinePoint.x - HEX_W / 2);
    maxX = Math.max(maxX, addMachinePoint.x + HEX_W / 2);
    minY = Math.min(minY, addMachinePoint.y - HEX_H / 2);
    maxY = Math.max(maxY, addMachinePoint.y + HEX_H / 2 + ADD_MACHINE_LABEL_HEIGHT);
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function clampAxis(value: number, viewportSize: number, minContent: number, maxContent: number, zoom = 1) {
  if (!viewportSize) return value;
  const contentSize = (maxContent - minContent) * zoom;
  if (contentSize <= viewportSize) return viewportSize / 2 - ((minContent + maxContent) / 2) * zoom;
  const min = viewportSize - maxContent * zoom;
  const max = -minContent * zoom;
  return Math.min(max, Math.max(min, value));
}
