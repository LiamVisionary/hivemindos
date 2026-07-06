/* hive-geometry.ts — pure layout math for the hive.
   The stage is a fixed 1440×980 canvas that FleetHiveView scales to fit. The
   Queen sits at (QX, QY); machines ring around her; each machine's agents bud
   off as a contiguous arc of hex "petals" that tessellate with the machine and
   with each other.

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

// Machines and agents share ONE cell size so they tessellate seamlessly.
const CELL_SCALE = 1.3;
const BASE_CELL = 85;
const BASE_RING = 238;
const BASE_ADD_MACHINE_GAP = 122;
const BASE_CLEARANCE_PAD = 16;

export const CELL = BASE_CELL * CELL_SCALE;
export const RING = BASE_RING * CELL_SCALE; // machine ring radius
export const MACHINE_SIZE = CELL;
export const AGENT_SIZE = CELL;

const APO = 0.43;
const QUEEN_SIZE = 150;
const QUEEN_CLEARANCE = QUEEN_SIZE / 2 + CELL / 2 + BASE_CLEARANCE_PAD * CELL_SCALE;
const CELL_STEP = 2 * APO * CELL + 1;
const CELL_COLLISION_PAD = 10;
const MACHINE_COLLISION_PAD = 18;
const SLOT_SEARCH_EXTRA_CELLS = 96;

export interface Pt {
  x: number;
  y: number;
}

export interface MachineLayout {
  pos: Pt;
  ang: number;
  agents: { agent: HiveAgent; pos: Pt }[];
  addPos: Pt;
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
  return { x: mx + offset.x, y: my + offset.y };
}

function frSlotClears(pos: Pt, obstacles: HiveLayoutRect[]): boolean {
  if (!frClearsQueen(pos)) return false;
  const rect = frCellRect(pos);
  return obstacles.every((obstacle) => !frRectsOverlap(rect, obstacle, CELL_COLLISION_PAD));
}

function frCellRect(pos: Pt, pad = CELL_COLLISION_PAD): HiveLayoutRect {
  const half = CELL / 2 + pad;
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

/** Where the dashed "onboard a new machine" cell sits: just outside the ring,
 *  in an angular gap between machines. Without a layout it takes the widest gap
 *  (biased toward straight-down for the familiar feel). With the layout, every
 *  gap competes and the winner is the clear spot needing the LEAST outward
 *  escape from the ring — so a dense cluster crowding one gap sends the cell to
 *  a genuinely free gap instead of pushing it ever further off-canvas. */
export function frAddMachinePos(machines: HiveMachine[], layout?: Record<string, MachineLayout>): Pt {
  const total = machines.length;
  const radius = RING + BASE_ADD_MACHINE_GAP * CELL_SCALE; // just beyond the agent petals
  if (total === 0) return frPolar(QX, QY, radius, 90); // straight down when empty
  const angs = machines
    .map((_, i) => ((frMachineAngle(i, total) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  const gaps: { mid: number; size: number; downness: number }[] = [];
  for (let i = 0; i < angs.length; i++) {
    const a = angs[i];
    const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + 360;
    const size = b - a;
    const mid = ((a + b) / 2) % 360;
    const diff = Math.abs(mid - 90) % 360;
    const downness = Math.min(diff, 360 - diff); // angular distance to straight-down
    gaps.push({ mid, size, downness });
  }
  // Prefer the widest gap; break ties toward the bottom of the ring.
  const widerOrLower = (gap: { size: number; downness: number }, than: { size: number; downness: number }) =>
    gap.size > than.size + 0.5 || (Math.abs(gap.size - than.size) <= 0.5 && gap.downness < than.downness);
  const widest = gaps.reduce((best, gap) => (widerOrLower(gap, best) ? gap : best));
  if (!layout) return frPolar(QX, QY, radius, widest.mid);

  const obstacles: HiveLayoutRect[] = [];
  for (const m of machines) {
    const L = layout[m.id];
    if (!L) continue;
    obstacles.push(frCellRect(L.pos, MACHINE_COLLISION_PAD), frCellRect(L.addPos));
    for (const a of L.agents) obstacles.push(frCellRect(a.pos));
  }
  let best: { pt: Pt; extra: number; size: number; downness: number } | null = null;
  for (const gap of gaps) {
    for (let extra = 0; extra <= CELL_STEP * 8; extra += CELL_STEP / 4) {
      const pt = frPolar(QX, QY, radius + extra, gap.mid);
      if (!frSlotClears(pt, obstacles)) continue;
      if (!best || extra < best.extra - 0.5 || (Math.abs(extra - best.extra) <= 0.5 && widerOrLower(gap, best))) {
        best = { pt, extra, size: gap.size, downness: gap.downness };
      }
      break; // this gap's nearest clear spot found; try the next gap
    }
  }
  return best ? best.pt : frPolar(QX, QY, radius, widest.mid);
}

/** Build a layout map: machine id -> { pos, ang, agents, addPos }. */
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
      .map((placement) => frCellRect(placement.pos, MACHINE_COLLISION_PAD));
    // Compute one extra classic honeycomb slot for the dashed "add agent" cell.
    const slots = frAgentSlots(pos.x, pos.y, m.agents.length + 1, [...otherMachineRects, ...placedRects]);
    map[m.id] = {
      pos,
      ang,
      agents: m.agents.map((a, i) => ({ agent: a, pos: slots[i] })),
      addPos: slots[m.agents.length] || slots[slots.length - 1] || pos,
    };
    placedRects.push(
      frCellRect(pos, MACHINE_COLLISION_PAD),
      ...slots.map((slot) => frCellRect(slot)),
    );
  });
  return map;
}

/** Tight bounding box of everything actually drawn (queen, machines, agents,
 *  add-cells) with a little padding. Scaling THIS box — rather than the fixed
 *  canvas — makes the hive fill its area with no empty bands above/below. */
export function frContentBounds(
  machines: HiveMachine[],
  layout: Record<string, MachineLayout>,
): { cx: number; cy: number; w: number; h: number } {
  let minX = QX, maxX = QX, minY = QY, maxY = QY;
  const acc = (x: number, y: number, half: number) => {
    minX = Math.min(minX, x - half); maxX = Math.max(maxX, x + half);
    minY = Math.min(minY, y - half); maxY = Math.max(maxY, y + half);
  };
  acc(QX, QY, 84); // queen cell (150) + label below
  for (const m of machines) {
    const L = layout[m.id];
    if (!L) continue;
    acc(L.pos.x, L.pos.y, CELL / 2 + 18); // machine cell + name
    if (L.addPos) acc(L.addPos.x, L.addPos.y, CELL / 2);
    for (const a of L.agents) acc(a.pos.x, a.pos.y, CELL / 2 + 14); // agent cell + edge name
  }
  const addMachine = frAddMachinePos(machines, layout); // the "onboard a machine" cell
  acc(addMachine.x, addMachine.y, CELL / 2);
  const pad = 16;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX) + pad * 2,
    h: Math.max(1, maxY - minY) + pad * 2,
  };
}

// ---- agent name, split into balanced halves for the lower hex edges --------
export function frAgentNameSegments(name: string): string[] {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9α-ωΑ-Ω]+/)
    .filter(Boolean);
  if (words.length <= 2) return words;
  // 3+ words → two balanced lines
  const a = [words.slice(0, 1).join(" "), words.slice(1).join(" ")];
  const b = [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
  const score = (p: string[]) => Math.abs(p[0].length - p[1].length);
  return score(b) < score(a) ? b : a;
}

/** Hex clip-path shared by every cell. */
export const FR_HEX_CLIP = "polygon(50% 1%, 93% 25%, 93% 75%, 50% 99%, 7% 75%, 7% 25%)";
