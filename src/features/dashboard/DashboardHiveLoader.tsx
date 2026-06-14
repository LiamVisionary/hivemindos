"use client";

import { createStyleClass } from "@/features/dashboard/style-classes";
import loaderStyles from "./DashboardHiveLoader.module.css";

const loaderClass = createStyleClass(loaderStyles);
const BRAIN_LOADER_RADIUS = 20;
const BRAIN_LOADER_CENTER = { x: 64, y: 64 };
const BRAIN_LOADER_COORDS = [
  { q: 0, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
];

type BrainPoint = { x: number; y: number };

function formatBrainSvgNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function brainNodePoints(cx: number, cy: number, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index + Math.PI / 6;
    return `${formatBrainSvgNumber(cx + Math.cos(angle) * radius)},${formatBrainSvgNumber(cy + Math.sin(angle) * radius)}`;
  }).join(" ");
}

function brainHexVertex(center: BrainPoint, radius: number, index: number): BrainPoint {
  const angle = (Math.PI / 3) * index + Math.PI / 6;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function brainPointKey(point: BrainPoint) {
  return `${Math.round(point.x * 1000) / 1000},${Math.round(point.y * 1000) / 1000}`;
}

function brainLoaderCenter(coord: { q: number; r: number }): BrainPoint {
  return {
    x: BRAIN_LOADER_CENTER.x + Math.sqrt(3) * BRAIN_LOADER_RADIUS * (coord.q + coord.r / 2),
    y: BRAIN_LOADER_CENTER.y + 1.5 * BRAIN_LOADER_RADIUS * coord.r,
  };
}

function brainLoaderEdgeLines() {
  const points = new Map<string, BrainPoint>();
  const edgeKeys = new Set<string>();

  for (const coord of BRAIN_LOADER_COORDS) {
    const center = brainLoaderCenter(coord);
    const vertices = Array.from({ length: 6 }, (_, index) => brainHexVertex(center, BRAIN_LOADER_RADIUS, index));
    vertices.forEach((vertex, index) => {
      const next = vertices[(index + 1) % vertices.length];
      const aKey = brainPointKey(vertex);
      const bKey = brainPointKey(next);
      points.set(aKey, vertex);
      points.set(bKey, next);
      edgeKeys.add([aKey, bKey].sort().join("|"));
    });
  }

  return Array.from(edgeKeys).map((key) => {
    const [aKey, bKey] = key.split("|");
    return { key, a: points.get(aKey)!, b: points.get(bKey)! };
  });
}

const BRAIN_LOADER_EDGES = brainLoaderEdgeLines();

export function DashboardHiveLoader({
  compact = false,
  detail = "Reading vault notes and link edges",
  inline = false,
  title = "Mapping shared brain",
}: {
  compact?: boolean;
  detail?: string;
  inline?: boolean;
  title?: string;
}) {
  return (
    <div className={loaderClass("brainLoader", compact && "compact", inline && "inline")} role="status" aria-live="polite">
      <svg className={loaderClass("brainLoaderComb")} viewBox="8 10 112 108" aria-hidden="true">
        <g className={loaderClass("brainLoaderCells")}>
          {BRAIN_LOADER_COORDS.map((coord, index) => {
            const center = brainLoaderCenter(coord);
            return (
              <polygon
                key={`${coord.q},${coord.r}`}
                points={brainNodePoints(center.x, center.y, BRAIN_LOADER_RADIUS)}
                style={{ animationDelay: `${index * 90}ms` }}
              />
            );
          })}
        </g>
        <g className={loaderClass("brainLoaderEdges")}>
          {BRAIN_LOADER_EDGES.map((edge) => (
            <line
              key={edge.key}
              x1={formatBrainSvgNumber(edge.a.x)}
              y1={formatBrainSvgNumber(edge.a.y)}
              x2={formatBrainSvgNumber(edge.b.x)}
              y2={formatBrainSvgNumber(edge.b.y)}
            />
          ))}
        </g>
      </svg>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <div className={loaderClass("brainLoadingRail")} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
