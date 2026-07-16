/* hive-geometry.ts — pure layout math for the hive.
   The stage is a fixed 1012×980 canvas that FleetHiveView scales to fit. The
   Queen sits at (QX, QY); machines ring around her; each machine's agents bud
   off as a contiguous arc of compact hex nodes around a larger machine anchor.

   Ported from the nextjs-drop-in Fleet "Hive" redesign. The machine ring angle
   is computed deterministically from the machine index so the layout works for
   any real fleet payload (not just the original demo machines). */

import { axialToPixelWithStep, hexSpiral } from "@/components/fleet/hex-math";
import type { HiveAgent, HiveMachine } from "./fleet-hive-types";

// The hive canvas holds ONLY the queen + machine ring + agent petals; the detail
// panel is rendered separately (full height, unscaled). The queen sits at the
// canvas centre (QX = HIVE_W / 2) so the ring is symmetric.
export const HIVE_W = 1012;
export const HIVE_H = 980;
export const QX = 506;
export const QY = 474;

// A clear three-level hierarchy keeps the map readable at its default zoom,
// while the modest size delta lets expanded clusters read as one honeycomb:
// Queen (150) > machines (120) > agents (104).
export const AGENT_SIZE = 104;
export const MACHINE_SIZE = 120;
export const CELL = AGENT_SIZE;
export const RING = 290;

const APO = 0.43;
const QUEEN_SIZE = 150;
const QUEEN_CLEARANCE = QUEEN_SIZE / 2 + AGENT_SIZE / 2 + 20;
// Agent-to-agent cells keep a narrow two-pixel authored gutter, while every
// radial spoke starts farther away from the larger machine anchor. Applying
// the extra inset radially (rather than increasing CELL_STEP) preserves the
// compact rhythm between agents on later rings.
const AGENT_CELL_GUTTER = 2;
export const MACHINE_AGENT_GUTTER = 10;
const CELL_STEP = APO * (MACHINE_SIZE + AGENT_SIZE) + AGENT_CELL_GUTTER;
const MACHINE_AGENT_RADIAL_OFFSET = MACHINE_AGENT_GUTTER - AGENT_CELL_GUTTER;
const CELL_COLLISION_PAD = 7;
const MACHINE_COLLISION_PAD = 14;
const SLOT_SEARCH_EXTRA_CELLS = 96;

export interface Pt {
  x: number;
  y: number;
}

export interface MachineLayout {
  pos: Pt;
  ang: number;
  agents: { agent: HiveAgent; pos: Pt }[];
}

export interface HiveLayoutRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function frPolar(cx: number, cy: number, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

// Spread machines evenly around the ring, starting at the top (-90°). The first
// machine (typically "This Mac"/Primary) sits at the top; the rest fan out
// clockwise. Works for any count.
export function frMachineAngle(index: number, total: number): number {
  if (total <= 0) return -90;
  return -90 + (360 / total) * index;
}

// Agents use the same axial spiral as the classic Fleet hive. The redesigned
// view only filters that shared candidate sequence so cells avoid the Queen and
// already-placed neighbouring machine clusters.
export function frAgentSlots(mx: number, my: number, n: number, obstacles: HiveLayoutRect[] = []): Pt[] {
  if (n <= 0) return [];
  const out: Pt[] = [];
  const candidates = frSpiralCandidates(n);
  for (const pos of candidates) {
    const point = frSlotPoint(mx, my, pos);
    if (frSlotClears(point, obstacles)) out.push(point);
    if (out.length >= n) break;
  }
  if (out.length >= n) return out;

  // If a very dense live fleet exhausts the search area, keep the hive usable by
  // falling back to the classic spiral order. The normal path above should cover
  // realistic dashboard payloads.
  for (const pos of candidates) {
    const point = frSlotPoint(mx, my, pos);
    if (!out.some((slot) => slot.x === point.x && slot.y === point.y)) out.push(point);
    if (out.length >= n) break;
  }
  return out;
}

export function frClearsQueen(pos: Pt): boolean {
  return Math.hypot(pos.x - QX, pos.y - QY) >= QUEEN_CLEARANCE;
}

function frSpiralCandidates(count: number): Array<[number, number]> {
  return hexSpiral(Math.max(count + SLOT_SEARCH_EXTRA_CELLS, 18)).slice(1);
}

function frSlotPoint(mx: number, my: number, [q, r]: [number, number]): Pt {
  const offset = axialToPixelWithStep(q, r, CELL_STEP);
  const distance = Math.hypot(offset.x, offset.y);
  if (distance === 0) return { x: mx, y: my };
  const radialScale = (distance + MACHINE_AGENT_RADIAL_OFFSET) / distance;
  return { x: mx + offset.x * radialScale, y: my + offset.y * radialScale };
}

function frSlotClears(pos: Pt, obstacles: HiveLayoutRect[]): boolean {
  if (!frClearsQueen(pos)) return false;
  const rect = frCellRect(pos, AGENT_SIZE);
  return obstacles.every((obstacle) => !frRectsOverlap(rect, obstacle, CELL_COLLISION_PAD));
}

function frCellRect(pos: Pt, size: number, pad = CELL_COLLISION_PAD): HiveLayoutRect {
  const half = size / 2 + pad;
  return {
    minX: pos.x - half,
    minY: pos.y - half,
    maxX: pos.x + half,
    maxY: pos.y + half,
  };
}

function frRectsOverlap(left: HiveLayoutRect, right: HiveLayoutRect, gap = 0) {
  return !(
    left.maxX + gap <= right.minX ||
    left.minX - gap >= right.maxX ||
    left.maxY + gap <= right.minY ||
    left.minY - gap >= right.maxY
  );
}

/** Where the phone placeholder sits before any real mobile Tailnet peer exists.
 *  It searches the machine gaps and clears every possible expanded cluster. */
export function frPhonePlaceholderPos(machines: HiveMachine[], layout?: Record<string, MachineLayout>): Pt {
  const radius = RING + 146;
  const preferredAngle = 150;
  const obstacles: HiveLayoutRect[] = [];
  if (layout) {
    for (const m of machines) {
      const L = layout[m.id];
      if (!L) continue;
      obstacles.push(frCellRect(L.pos, MACHINE_SIZE, MACHINE_COLLISION_PAD));
      for (const a of L.agents) obstacles.push(frCellRect(a.pos, AGENT_SIZE));
    }
  }

  const gaps = frMachineGaps(machines.length, preferredAngle);
  let best: { pt: Pt; extra: number; targetness: number; size: number } | null = null;
  for (const gap of gaps) {
    for (let extra = 0; extra <= CELL_STEP * 8; extra += CELL_STEP / 4) {
      const pt = frPolar(QX, QY, radius + extra, gap.mid);
      if (!frSlotClears(pt, obstacles)) continue;
      if (
        !best ||
        extra < best.extra - 0.5 ||
        (Math.abs(extra - best.extra) <= 0.5 && gap.targetness < best.targetness - 0.5) ||
        (Math.abs(extra - best.extra) <= 0.5 && Math.abs(gap.targetness - best.targetness) <= 0.5 && gap.size > best.size)
      ) {
        best = { pt, extra, targetness: gap.targetness, size: gap.size };
      }
      break;
    }
  }
  return best ? best.pt : frPolar(QX, QY, radius, preferredAngle);
}

function frMachineGaps(total: number, preferredAngle: number) {
  if (total <= 0) return [{ mid: preferredAngle, size: 360, targetness: 0 }];
  const angs = Array.from({ length: total }, (_, i) => ((frMachineAngle(i, total) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  const gaps: { mid: number; size: number; targetness: number }[] = [];
  for (let i = 0; i < angs.length; i++) {
    const a = angs[i];
    const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + 360;
    const size = b - a;
    const mid = ((a + b) / 2) % 360;
    const diff = Math.abs(mid - preferredAngle) % 360;
    gaps.push({ mid, size, targetness: Math.min(diff, 360 - diff) });
  }
  return gaps;
}

/** Build a layout map: machine id -> { pos, ang, agents }. */
export function frBuildLayout(machines: HiveMachine[]): Record<string, MachineLayout> {
  const map: Record<string, MachineLayout> = {};
  const total = machines.length;
  const machinePlacements = machines.map((m, index) => {
    const ang = frMachineAngle(index, total);
    const pos = frPolar(QX, QY, RING, ang);
    return { machine: m, pos, ang };
  });
  const placedRects: HiveLayoutRect[] = [];
  machinePlacements.forEach(({ machine: m, pos, ang }) => {
    const otherMachineRects = machinePlacements
      .filter((placement) => placement.machine.id !== m.id)
      .map((placement) => frCellRect(placement.pos, MACHINE_SIZE, MACHINE_COLLISION_PAD));
    const slots = frAgentSlots(pos.x, pos.y, m.agents.length, [...otherMachineRects, ...placedRects]);
    map[m.id] = {
      pos,
      ang,
      agents: m.agents.map((a, i) => ({ agent: a, pos: slots[i] })),
    };
    placedRects.push(
      frCellRect(pos, MACHINE_SIZE, MACHINE_COLLISION_PAD),
      ...slots.map((slot) => frCellRect(slot, AGENT_SIZE)),
    );
  });
  return map;
}

/** Hex clip-path shared by every cell. */
export const FR_HEX_CLIP = "polygon(50% 1%, 93% 25%, 93% 75%, 50% 99%, 7% 75%, 7% 25%)";
