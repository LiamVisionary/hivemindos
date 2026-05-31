// src/components/fleet/network-graph.tsx
"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddHexCell } from "./add-hex-cell";
import { MachineCluster } from "./machine-cluster";
import { LottieBee } from "./lottie-bee";
import { type FleetAgent, type FleetMachine } from "./fleet-data";
import { axialToPixel, HEX_H, HEX_W, hexSpiral } from "./hex-math";

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
const ADD_MACHINE_LABEL_HEIGHT = 26;
const ADD_MACHINE_CLEARANCE = 44;
const ADD_AGENT_CLEARANCE = 18;

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

/**
 * Constellation view — every machine is a tessellated cluster of hex cells;
 * dashed Tailscale arcs connect clusters; 1–2 honey bees roam those arcs.
 */
export function NetworkGraph({
  width = 900, height = 900,
  machines, edges,
  selected, selectedAgentId,
  onSelectMachine, onSelectAgent, onAddAgent, onAddMachine,
}: NetworkGraphProps) {
  const w = width, h = height;
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const boundsRef = React.useRef(contentBounds([], undefined));
  const centeredViewportRef = React.useRef({ width: 0, height: 0 });
  const dragRef = React.useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const layout = makeClusterLayout(machines);
  const clusters = assignAddCells(machines.map((m) => ({
    m,
    cx: layout[m.id][0] * w,
    cy: layout[m.id][1] * h,
    selected: selected === m.id,
    selectedAgentId: selected === m.id ? selectedAgentId : null,
  })));
  const addMachinePoint = React.useMemo(() => findAddMachinePoint(clusters, w, h), [clusters, h, w]);
  const pos: Record<string, { x: number; y: number }> = Object.fromEntries(
    clusters.map((c) => [c.m.id, { x: c.cx, y: c.cy }]),
  );
  const latestBeeGraphRef = React.useRef({ edges, pos });
  const bounds = React.useMemo(() => contentBounds(clusters, addMachinePoint), [clusters, addMachinePoint]);

  const clampPan = React.useCallback((next: { x: number; y: number }) => {
    return {
      x: clampAxis(next.x, viewport.width, bounds.minX, bounds.maxX),
      y: clampAxis(next.y, viewport.height, bounds.minY, bounds.maxY),
    };
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, viewport.height, viewport.width]);

  React.useLayoutEffect(() => {
    latestBeeGraphRef.current = { edges, pos };
  }, [edges, pos]);

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
    const nextPan = {
      x: viewport.width / 2 - (nextBounds.minX + nextBounds.maxX) / 2,
      y: viewport.height / 2 - (nextBounds.minY + nextBounds.maxY) / 2,
    };
    setPan({
      x: clampAxis(nextPan.x, viewport.width, nextBounds.minX, nextBounds.maxX),
      y: clampAxis(nextPan.y, viewport.height, nextBounds.minY, nextBounds.maxY),
    });
  }, [viewport]);

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
    const SZ = 44;
    const tick = (now: number) => {
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
      style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button, [data-fleet-cell-control]")) return;
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setPan(clampPan({
          x: drag.panX + event.clientX - drag.x,
          y: drag.panY + event.clientY - drag.y,
        }));
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      aria-label="Fleet graph canvas. Drag to pan across machines."
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: w,
          height: h,
          transform: `translate(${pan.x}px, ${pan.y}px)`,
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
      </svg>

      {/* Clusters (frosted glass over the lines) */}
      {clusters.map((c) => (
        <MachineCluster
          key={c.m.id}
          machine={c.m}
          cx={c.cx}
          cy={c.cy}
          addCell={c.addCell}
          selected={c.selected}
          selectedAgentId={c.selectedAgentId}
          onSelectMachine={() => onSelectMachine(c.m.id)}
          onSelectAgent={onSelectAgent}
          onAddAgent={onAddAgent}
        />
      ))}

      {onAddMachine ? (
        <div
          className="absolute grid justify-items-center"
          style={{
            left: addMachinePoint.x - HEX_W / 2,
            top: addMachinePoint.y - HEX_H / 2,
            width: HEX_W,
            gap: 6,
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
              fontSize: 10,
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
              width: 44, height: 44,
              opacity: 0,
              willChange: "transform, opacity",
              filter: "drop-shadow(0 2px 6px rgba(255, 200, 60, 0.45))",
            }}
          >
            <LottieBee size={44} />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function makeClusterLayout(machines: FleetMachine[]) {
  const fallback: Record<string, [number, number]> = {};
  const usedSlots = new Set<number>();
  [...machines].sort((left, right) => (
    layoutSortKey(left).localeCompare(layoutSortKey(right))
  )).forEach((machine) => {
    const slotIndex = nextAvailableLayoutSlot(preferredLayoutSlot(machine), usedSlots);
    usedSlots.add(slotIndex);
    fallback[machine.id] = FALLBACK_LAYOUT_SLOTS[slotIndex];
  });
  return { ...fallback, ...CLUSTER_LAYOUT };
}

function layoutSortKey(machine: FleetMachine) {
  return machine.id;
}

function preferredLayoutSlot(machine: FleetMachine) {
  const fingerprint = [
    machine.id,
    machine.name,
    machine.kind,
    machine.role,
    machine.os,
  ].join(" ").toLowerCase();

  if (machine.id === "unassigned" || fingerprint.includes("saved profiles")) return 3;
  if (
    machine.role === "Primary" ||
    fingerprint.includes("this mac")
  ) {
    return 0;
  }
  if (
    fingerprint.includes("ubuntu") ||
    fingerprint.includes("linux") ||
    fingerprint.includes("server") ||
    fingerprint.includes("vps")
  ) {
    return 2;
  }
  if (
    fingerprint.includes("mbp") ||
    fingerprint.includes("macbook") ||
    fingerprint.includes("mac") ||
    fingerprint.includes("laptop")
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

function assignAddCells(clusters: GraphCluster[]) {
  const existingRects = clusters.map((cluster) => cellsRect(cluster.cx, cluster.cy, cluster.m.agents.length + 1));
  const assignedAddRects: GraphRect[] = [];

  return clusters.map((cluster, index) => {
    const existingCount = cluster.m.agents.length + 1;
    const fallback = hexSpiral(existingCount + 1)[existingCount] ?? [0, 0];
    const otherRects = [
      ...existingRects.filter((_, rectIndex) => rectIndex !== index),
      ...assignedAddRects,
    ];
    const candidates = hexSpiral(existingCount + 24).slice(existingCount);
    const addCell = candidates.find(([q, r]) => {
      const rect = cellRect(cluster.cx, cluster.cy, q, r);
      return otherRects.every((otherRect) => !rectsOverlap(rect, otherRect, ADD_AGENT_CLEARANCE));
    }) ?? fallback;
    assignedAddRects.push(cellRect(cluster.cx, cluster.cy, addCell[0], addCell[1]));
    return { ...cluster, addCell };
  });
}

function findAddMachinePoint(clusters: GraphCluster[], width: number, height: number) {
  const preferred = { x: width * 0.72, y: height * 0.28 };
  const clusterRects = clusters.map(clusterRect);
  const candidates = addMachineCandidates(preferred, width, height);
  return candidates.find((point) => (
    clusterRects.every((rect) => !rectsOverlap(addMachineRect(point), rect, ADD_MACHINE_CLEARANCE))
  )) ?? preferred;
}

function addMachineCandidates(preferred: { x: number; y: number }, width: number, height: number) {
  const minX = HEX_W / 2 + 16;
  const maxX = width - HEX_W / 2 - 16;
  const minY = HEX_H / 2 + 16;
  const maxY = height - HEX_H / 2 - ADD_MACHINE_LABEL_HEIGHT - 16;
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

function contentBounds(clusters: GraphCluster[], addMachinePoint?: { x: number; y: number }) {
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

  if (addMachinePoint) {
    minX = Math.min(minX, addMachinePoint.x - HEX_W / 2);
    maxX = Math.max(maxX, addMachinePoint.x + HEX_W / 2);
    minY = Math.min(minY, addMachinePoint.y - HEX_H / 2);
    maxY = Math.max(maxY, addMachinePoint.y + HEX_H / 2 + 26);
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function clampAxis(value: number, viewportSize: number, minContent: number, maxContent: number) {
  if (!viewportSize) return value;
  const contentSize = maxContent - minContent;
  if (contentSize <= viewportSize) return viewportSize / 2 - (minContent + maxContent) / 2;
  const min = viewportSize - maxContent;
  const max = -minContent;
  return Math.min(max, Math.max(min, value));
}
