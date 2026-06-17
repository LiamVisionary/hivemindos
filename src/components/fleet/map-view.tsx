// src/components/fleet/map-view.tsx
"use client";

import * as React from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HexTile } from "./hex-tile";
import { LottieBee } from "./lottie-bee";
import { isFleetMachineMobile, type FleetAgent, type FleetMachine } from "./fleet-data";
import { FleetSelectionTooltipContent } from "./selection-tooltip";
import type { MachineUpdateButtonDetail, MachineUpdateButtonStatus } from "./roster";
import coastlineData from "./data/ne_110m_coastline";

interface MapViewProps {
  width?: number;
  height?: number;
  machines: FleetMachine[];
  edges: Array<[string, string]>;
  selected: string;
  selectedAgentId: string | null;
  onSelectMachine: (id: string) => void;
  onSelectAgent: (m: FleetMachine, a: FleetAgent) => void;
  onAddAgent: (m: FleetMachine) => void;
  updateStatusByMachine?: Record<string, MachineUpdateButtonStatus>;
  updateDetailByMachine?: Record<string, MachineUpdateButtonDetail>;
  onUpdateMachine?: (m: FleetMachine) => void;
  onOpenCodeProof?: (m: FleetMachine) => void;
  onFixSyncIssue?: (m: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (m: FleetMachine) => void;
  onOpenShell?: (m: FleetMachine) => void;
  selectionTooltipKey?: string | null;
  onOpenSelectionTooltip?: (key: string) => void;
  onDismissSelectionTooltip?: () => void;
}

type CoastlineFeatureCollection = {
  features?: ReadonlyArray<{
    geometry?: {
      type?: string;
      coordinates?: unknown;
    };
  }>;
};

const COASTLINE_LINES = extractCoastlineLines(coastlineData);

// Coincident machines (atlas + honeycomb in Brooklyn) get a small offset so
// pins don't fully overlap.
const PIN_OFFSET: Record<string, [number, number]> = {
  atlas:     [-22, -10],
  honeycomb: [22,  14],
};
const PIN_COLLISION_DISTANCE = 66;
const PIN_COLLISION_SPREAD = 52;

export function MapView({
  width, height,
  machines, edges,
  selected, selectedAgentId,
  onSelectMachine, onAddAgent,
  updateStatusByMachine,
  updateDetailByMachine,
  onUpdateMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
  onOpenShell,
  selectionTooltipKey,
  onOpenSelectionTooltip,
  onDismissSelectionTooltip,
}: MapViewProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const w = width ?? Math.max(720, viewport.width || 720);
  const h = height ?? Math.max(540, viewport.height || 540);

  const projection = React.useMemo(() => createFleetProjection(machines, w, h), [h, machines, w]);
  const pos = React.useMemo(() => {
    return projectMachinePositions(machines, projection.project);
  }, [machines, projection]);
  const regionPaths = React.useMemo(() => {
    return COASTLINE_LINES
      .map((line) => coastlinePath(line, projection.project, w, h))
      .filter(Boolean);
  }, [h, projection, w]);
  const bounds = React.useMemo(() => mapContentBounds(machines, edges, pos), [edges, machines, pos]);
  const latestBeeMapRef = React.useRef({ edges, pos });

  const clampPan = React.useCallback((next: { x: number; y: number }) => {
    return {
      x: clampAxis(next.x, viewport.width, bounds.minX, bounds.maxX),
      y: clampAxis(next.y, viewport.height, bounds.minY, bounds.maxY),
    };
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, viewport.height, viewport.width]);

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
    latestBeeMapRef.current = { edges, pos };
  }, [edges, pos]);

  React.useLayoutEffect(() => {
    if (!viewport.width || !viewport.height) return;
    // Recenter on the fleet objects, not the whole atlas rectangle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPan(clampPan({
      x: viewport.width / 2 - (bounds.minX + bounds.maxX) / 2,
      y: viewport.height / 2 - (bounds.minY + bounds.maxY) / 2,
    }));
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, clampPan, machines.length, viewport.height, viewport.width]);

  // Bee animation across great-circle (quadratic-bezier) arcs.
  const BEE_COUNT = 2;
  const beeRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const beeStateRef = React.useRef(
    Array.from({ length: BEE_COUNT }, (_, i) => ({
      edgeIdx: i,
      t0: i * 900,
      dur: 3800 + i * 600,
      dir: i % 2 === 0 ? 1 : -1,
    })),
  );

  React.useEffect(() => {
    let raf = 0;
    const SZ = 38;
    const tick = (now: number) => {
      const { edges: currentEdges, pos: currentPos } = latestBeeMapRef.current;
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
        const dist = Math.hypot(B.x - A.x, B.y - A.y);
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2 - Math.min(60, dist * 0.18);
        const x = (1 - p) * (1 - p) * A.x + 2 * (1 - p) * p * mx + p * p * B.x;
        const y = (1 - p) * (1 - p) * A.y + 2 * (1 - p) * p * my + p * p * B.y;
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
      aria-label="Fleet map canvas. Drag to pan across machines."
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
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w} height={h}
        className="absolute inset-0 pointer-events-none"
        aria-hidden
      >
        <defs>
          <linearGradient id="fleetMapArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="var(--edge-stroke-start)" />
            <stop offset="100%" stopColor="var(--edge-stroke-end)" />
          </linearGradient>
        </defs>
        {/* Graticule */}
        <g stroke="rgba(148,163,184,0.18)" strokeWidth={0.5}>
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={"h" + i} x1={0} x2={w} y1={((i + 1) * h) / 6} y2={((i + 1) * h) / 6} strokeDasharray="2 4" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={"v" + i} y1={0} y2={h} x1={((i + 1) * w) / 8} x2={((i + 1) * w) / 8} strokeDasharray="2 4" />
          ))}
        </g>
        {/* Natural Earth coastline silhouettes */}
        <g
          fill="none"
          stroke="var(--edge-stroke-start)"
          strokeWidth={0.7}
          strokeDasharray="0.8 3"
          opacity={0.55}
        >
          {regionPaths.map((d, i) => <path key={i} d={d} />)}
        </g>
        {/* Tailscale arcs */}
        {edges.map(([a, b], i) => {
          const A = pos[a], B = pos[b];
          if (!A || !B) return null;
          const dist = Math.hypot(B.x - A.x, B.y - A.y);
          const mx = (A.x + B.x) / 2;
          const my = (A.y + B.y) / 2 - Math.min(60, dist * 0.18);
          return (
            <path
              key={i}
              d={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`}
              stroke="url(#fleetMapArc)"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              fill="none"
              opacity={0.85}
            />
          );
        })}
        {/* City labels */}
        {machines.map((m) => (
          <text
            key={m.id}
            x={pos[m.id].x} y={pos[m.id].y + 60}
            textAnchor="middle"
            style={{
              font: "600 9px var(--f-mono)",
              fill: "var(--muted)",
              letterSpacing: 0.08,
              textTransform: "uppercase",
            }}
          >
            {m.city}
          </text>
        ))}
      </svg>

      {/* Hex pins */}
        {machines.map((m) => {
        const tone = m.versionState === "needs-setup"
          ? "ghost"
          : selected === m.id ? "honey" : "default";
        const SZ = 56;
        const tooltipKey = `${m.id}:machine`;
        const tooltipOpen = Boolean(selectionTooltipKey === tooltipKey && selected === m.id && !selectedAgentId);
        return (
          <div
            key={m.id}
            className="absolute"
            style={{
              left: pos[m.id].x - SZ / 2,
              top:  pos[m.id].y - (SZ * 1.1547) / 2,
            }}
          >
            <Tooltip open={tooltipOpen} disableHoverableContent={false}>
              <TooltipTrigger asChild>
                <HexTile
                  size={SZ}
                  tone={tone}
                  onClick={() => {
                    onSelectMachine(m.id);
                    onOpenSelectionTooltip?.(tooltipKey);
                  }}
                >
                  <div className="grid place-items-center gap-px">
                    {(() => {
                      const MachineIcon = isFleetMachineMobile(m) ? Smartphone : Monitor;
                      return <MachineIcon
                      aria-hidden="true"
                      size={20}
                      style={{
                        color: m.versionState === "needs-setup" && selected !== m.id
                          ? "var(--muted)"
                          : "var(--accent-strong)",
                      }}
                      />;
                    })()}
                    <span
                      className="font-semibold leading-none"
                      style={{
                        fontFamily: "var(--f-display)",
                        fontSize: 10,
                        letterSpacing: 0,
                        marginTop: 2,
                        color: selected === m.id ? "var(--hex-honey-border)" : "var(--foreground)",
                      }}
                    >
                      {m.name}
                    </span>
                  </div>
                </HexTile>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={4}
                className="pointer-events-auto max-w-none p-3"
                arrowClassName="h-2.5 w-5"
                onPointerDownOutside={onDismissSelectionTooltip}
              >
                <FleetSelectionTooltipContent
                  machine={m}
                  updateStatus={updateStatusByMachine?.[m.id]}
                  updateDetail={updateDetailByMachine?.[m.id]}
                  onClose={onDismissSelectionTooltip}
                  onAddAgent={onAddAgent}
                  onUpdateMachine={onUpdateMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={onOpenUsePodHost}
                  onOpenShell={onOpenShell}
                />
              </TooltipContent>
            </Tooltip>
            {/* Agent count badge */}
            <div
              className="absolute grid place-items-center"
              style={{
                top: -4, right: -6,
                minWidth: 16, height: 16, padding: "0 5px", borderRadius: 9999,
                background: "rgba(15,23,42,0.85)",
                border: "1px solid rgba(148,163,184,0.32)",
                color: "var(--accent-strong)",
                fontFamily: "var(--f-mono)",
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              {m.agents.length}
            </div>
          </div>
        );
      })}

      {/* Bees on arcs */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: BEE_COUNT }).map((_, i) => (
          <div
            key={i}
            ref={(el) => { beeRefs.current[i] = el; }}
            className="absolute pointer-events-none"
            style={{
              top: 0, left: 0,
              width: 38, height: 38,
              opacity: 0,
              willChange: "transform, opacity",
              filter: "drop-shadow(0 2px 5px rgba(255, 200, 60, 0.4))",
            }}
          >
            <LottieBee size={38} />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function createFleetProjection(machines: FleetMachine[], width: number, height: number) {
  const compression = 0.58;
  const points = machines
    .filter((machine) => Number.isFinite(machine.lon) && Number.isFinite(machine.lat))
    .map((machine) => ({ lon: machine.lon, lat: machine.lat }));

  if (!points.length) {
    return {
      project: (lon: number, lat: number) => ({ x: width / 2 + lon, y: height / 2 - lat }),
    };
  }

  let minLon = Math.min(...points.map((point) => point.lon));
  let maxLon = Math.max(...points.map((point) => point.lon));
  let minLat = Math.min(...points.map((point) => point.lat));
  let maxLat = Math.max(...points.map((point) => point.lat));

  const minLonSpan = 56;
  const minLatSpan = 36;
  const lonSpan = Math.max(maxLon - minLon, minLonSpan);
  const latSpan = Math.max(maxLat - minLat, minLatSpan);
  const lonCenter = (minLon + maxLon) / 2;
  const latCenter = (minLat + maxLat) / 2;
  const lonPad = Math.max(12, lonSpan * 0.18);
  const latPad = Math.max(8, latSpan * 0.18);

  minLon = lonCenter - lonSpan / 2 - lonPad;
  maxLon = lonCenter + lonSpan / 2 + lonPad;
  minLat = latCenter - latSpan / 2 - latPad;
  maxLat = latCenter + latSpan / 2 + latPad;

  return {
    project: (lon: number, lat: number) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * width;
      const y = ((maxLat - lat) / (maxLat - minLat)) * height;
      return {
        x: width / 2 + (x - width / 2) * compression,
        y: height / 2 + (y - height / 2) * compression,
      };
    },
  };
}

function projectMachinePositions(
  machines: FleetMachine[],
  project: (lon: number, lat: number) => { x: number; y: number },
) {
  const base = machines.map((machine) => {
    const point = project(machine.lon, machine.lat);
    const [dx, dy] = PIN_OFFSET[machine.id] ?? [0, 0];
    return {
      machine,
      x: point.x + dx,
      y: point.y + dy,
    };
  });
  const groups: Array<typeof base> = [];

  for (const item of base) {
    const group = groups.find((candidate) => (
      candidate.some((other) => Math.hypot(other.x - item.x, other.y - item.y) < PIN_COLLISION_DISTANCE)
    ));
    if (group) group.push(item);
    else groups.push([item]);
  }

  const output: Record<string, { x: number; y: number }> = {};
  for (const group of groups) {
    if (group.length === 1) {
      const [item] = group;
      output[item.machine.id] = { x: item.x, y: item.y };
      continue;
    }
    const centerX = group.reduce((total, item) => total + item.x, 0) / group.length;
    const centerY = group.reduce((total, item) => total + item.y, 0) / group.length;
    group.forEach((item, index) => {
      const angle = -Math.PI / 2 + (index / group.length) * Math.PI * 2;
      output[item.machine.id] = {
        x: centerX + Math.cos(angle) * PIN_COLLISION_SPREAD,
        y: centerY + Math.sin(angle) * PIN_COLLISION_SPREAD,
      };
    });
  }

  return output;
}

function extractCoastlineLines(data: CoastlineFeatureCollection) {
  const lines: Array<Array<[number, number]>> = [];
  for (const feature of data.features ?? []) {
    const geometry = feature.geometry;
    if (geometry?.type === "LineString" && Array.isArray(geometry.coordinates)) {
      const line = parseCoordinateLine(geometry.coordinates);
      if (line.length > 1) lines.push(line);
    }
    if (geometry?.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      for (const coordinates of geometry.coordinates) {
        if (!Array.isArray(coordinates)) continue;
        const line = parseCoordinateLine(coordinates);
        if (line.length > 1) lines.push(line);
      }
    }
  }
  return lines;
}

function parseCoordinateLine(coordinates: readonly unknown[]) {
  const line: Array<[number, number]> = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const lon = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) line.push([lon, lat]);
  }
  return line;
}

function coastlinePath(
  points: Array<[number, number]>,
  project: (lon: number, lat: number) => { x: number; y: number },
  width: number,
  height: number,
) {
  if (points.length < 2) return "";
  const projected = points.map(([lon, lat]) => project(lon, lat));
  const visible = projected.some((point) => point.x >= -80 && point.x <= width + 80 && point.y >= -80 && point.y <= height + 80);
  if (!visible) return "";
  return projected
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function mapContentBounds(
  machines: FleetMachine[],
  edges: Array<[string, string]>,
  pos: Record<string, { x: number; y: number }>,
) {
  const padding = 90;
  const pinWidth = 56;
  const pinHeight = (pinWidth * 2) / Math.sqrt(3);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const machine of machines) {
    const point = pos[machine.id];
    if (!point) continue;
    includePoint(point.x - pinWidth / 2, point.y - pinHeight / 2);
    includePoint(point.x + pinWidth / 2, point.y + 72);
  }

  for (const [a, b] of edges) {
    const A = pos[a], B = pos[b];
    if (!A || !B) continue;
    const dist = Math.hypot(B.x - A.x, B.y - A.y);
    includePoint((A.x + B.x) / 2, (A.y + B.y) / 2 - Math.min(60, dist * 0.18));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: -padding, minY: -padding, maxX: padding, maxY: padding };
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
