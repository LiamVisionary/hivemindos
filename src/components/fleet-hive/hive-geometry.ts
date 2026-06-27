/* hive-geometry.ts — pure layout math for the hive.
   The stage is a fixed 1440×980 canvas that FleetHiveView scales to fit. The
   Queen sits at (QX, QY); machines ring around her; each machine's agents bud
   off as a contiguous arc of hex "petals" that tessellate with the machine and
   with each other.

   Ported from the nextjs-drop-in Fleet "Hive" redesign. The machine ring angle
   is computed deterministically from the machine index so the layout works for
   any real fleet payload (not just the original demo machines). */

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

// Agents tessellate around their machine as a true honeycomb: the first six
// share the machine's six hex edges, and any beyond fill outward rings that
// share edges with the inner ring. Slots that would intrude into the Queen's
// cell are skipped so dense machine clusters leave a clean centre.
export function frAgentSlots(mx: number, my: number, ang: number, n: number): Pt[] {
  if (n <= 0) return [];
  const dist = 2 * APO * CELL + 1; // edge-to-edge neighbour distance
  // Six neighbour step vectors at 0,60,…,300° — the directions our hex shares edges.
  const step = (i: number): Pt => {
    const a = ((((i % 6) + 6) % 6) * 60 * Math.PI) / 180;
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist };
  };
  // Begin each ring on the side facing the machine's outward direction.
  const norm = ((ang % 360) + 360) % 360;
  const startDir = ((Math.round(norm / 60) % 6) + 6) % 6;
  const out: Pt[] = [];
  const isConnectedSlot = (pos: Pt) =>
    Math.hypot(pos.x - mx, pos.y - my) <= dist * 1.08
    || out.some((slot) => Math.hypot(pos.x - slot.x, pos.y - slot.y) <= dist * 1.08);
  const maxRing = Math.max(8, n + 6);
  for (let ring = 1; out.length < n && ring <= maxRing; ring++) {
    const s = step(startDir);
    let px = mx + s.x * ring;
    let py = my + s.y * ring;
    for (let side = 0; side < 6 && out.length < n; side++) {
      const walk = step(startDir + 2 + side);
      for (let i = 0; i < ring && out.length < n; i++) {
        const pos = { x: px, y: py };
        if (frClearsQueen(pos) && isConnectedSlot(pos)) out.push(pos);
        px += walk.x;
        py += walk.y;
      }
    }
  }
  return out;
}

export function frClearsQueen(pos: Pt): boolean {
  return Math.hypot(pos.x - QX, pos.y - QY) >= QUEEN_CLEARANCE;
}

/** Where the dashed "onboard a new machine" cell sits: in the widest angular
 *  gap between machines (biased toward straight-down for the familiar feel),
 *  just outside the ring — so it never stacks on top of a machine that happens
 *  to land directly below the Queen. */
export function frAddMachinePos(machines: HiveMachine[]): Pt {
  const total = machines.length;
  const radius = RING + BASE_ADD_MACHINE_GAP * CELL_SCALE; // just beyond the agent petals
  if (total === 0) return frPolar(QX, QY, radius, 90); // straight down when empty
  const angs = machines
    .map((_, i) => ((frMachineAngle(i, total) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let best = { mid: 90, size: -1, downness: Infinity };
  for (let i = 0; i < angs.length; i++) {
    const a = angs[i];
    const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + 360;
    const size = b - a;
    const mid = ((a + b) / 2) % 360;
    const diff = Math.abs(mid - 90) % 360;
    const downness = Math.min(diff, 360 - diff); // angular distance to straight-down
    // Prefer the widest gap; break ties toward the bottom of the ring.
    if (size > best.size + 0.5 || (Math.abs(size - best.size) <= 0.5 && downness < best.downness)) {
      best = { mid, size, downness };
    }
  }
  return frPolar(QX, QY, radius, best.mid);
}

/** Build a layout map: machine id -> { pos, ang, agents, addPos }. */
export function frBuildLayout(machines: HiveMachine[]): Record<string, MachineLayout> {
  const map: Record<string, MachineLayout> = {};
  const total = machines.length;
  machines.forEach((m, index) => {
    const ang = frMachineAngle(index, total);
    const pos = frPolar(QX, QY, RING, ang);
    // Compute one extra petal slot for the dashed "add agent" cell.
    const slots = frAgentSlots(pos.x, pos.y, ang, m.agents.length + 1);
    map[m.id] = {
      pos,
      ang,
      agents: m.agents.map((a, i) => ({ agent: a, pos: slots[i] })),
      addPos: slots[m.agents.length] || slots[slots.length - 1] || pos,
    };
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
  const addMachine = frAddMachinePos(machines); // the "onboard a machine" cell
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
