/* Pure geometry for the optional pre-redesign Fleet Hive presentation.
   It intentionally preserves the former same-size tessellated cells, complete
   clusters, and spatial add affordances without coupling those choices back
   into the focused layout. */

import { axialToPixelWithStep, hexSpiral } from "@/components/fleet/hex-math";
import type { HiveAgent, HiveMachine } from "./fleet-hive-types";
import { HIVE_H, HIVE_W, QX, QY, frPolar, type HiveLayoutRect, type Pt } from "./hive-geometry";

const LEGACY_CELL_SCALE = 1.3;
const LEGACY_BASE_CELL = 85;
const LEGACY_BASE_RING = 238;
const LEGACY_BASE_ADD_MACHINE_GAP = 122;
export const LEGACY_CELL_SIZE = LEGACY_BASE_CELL * LEGACY_CELL_SCALE;
export const LEGACY_RING = LEGACY_BASE_RING * LEGACY_CELL_SCALE;
const LEGACY_APOTHEM = 0.43;
const LEGACY_CELL_STEP = 2 * LEGACY_APOTHEM * LEGACY_CELL_SIZE + 1;
const LEGACY_CELL_COLLISION_PAD = 10;
const LEGACY_MACHINE_COLLISION_PAD = 18;
const LEGACY_SLOT_SEARCH_EXTRA_CELLS = 96;
const LEGACY_QUEEN_CLEARANCE = 75 + LEGACY_CELL_SIZE / 2 + 16 * LEGACY_CELL_SCALE;

export interface LegacyMachineLayout {
  pos: Pt;
  ang: number;
  agents: { agent: HiveAgent; pos: Pt }[];
  addPos: Pt;
}

function legacyMachineAngle(index: number, total: number) {
  if (total <= 0) return -90;
  return -90 + (360 / total) * index;
}

function legacyCellRect(pos: Pt, pad = LEGACY_CELL_COLLISION_PAD): HiveLayoutRect {
  const half = LEGACY_CELL_SIZE / 2 + pad;
  return {
    minX: pos.x - half,
    minY: pos.y - half,
    maxX: pos.x + half,
    maxY: pos.y + half,
  };
}

function legacyRectsOverlap(left: HiveLayoutRect, right: HiveLayoutRect, gap = 0) {
  return !(
    left.maxX + gap <= right.minX ||
    left.minX - gap >= right.maxX ||
    left.maxY + gap <= right.minY ||
    left.minY - gap >= right.maxY
  );
}

function legacySlotPoint(mx: number, my: number, [q, r]: [number, number]): Pt {
  const offset = axialToPixelWithStep(q, r, LEGACY_CELL_STEP);
  return { x: mx + offset.x, y: my + offset.y };
}

function legacySlotClears(pos: Pt, obstacles: HiveLayoutRect[]) {
  if (Math.hypot(pos.x - QX, pos.y - QY) < LEGACY_QUEEN_CLEARANCE) return false;
  const rect = legacyCellRect(pos);
  return obstacles.every((obstacle) => !legacyRectsOverlap(rect, obstacle, LEGACY_CELL_COLLISION_PAD));
}

function legacyAgentSlots(mx: number, my: number, count: number, obstacles: HiveLayoutRect[] = []) {
  if (count <= 0) return [];
  const slots: Pt[] = [];
  const candidates = hexSpiral(Math.max(count + LEGACY_SLOT_SEARCH_EXTRA_CELLS, 18)).slice(1);
  for (const candidate of candidates) {
    const point = legacySlotPoint(mx, my, candidate);
    if (legacySlotClears(point, obstacles)) slots.push(point);
    if (slots.length >= count) break;
  }
  if (slots.length >= count) return slots;

  for (const candidate of candidates) {
    const point = legacySlotPoint(mx, my, candidate);
    if (!slots.some((slot) => slot.x === point.x && slot.y === point.y)) slots.push(point);
    if (slots.length >= count) break;
  }
  return slots;
}

export function frBuildLegacyLayout(machines: HiveMachine[]): Record<string, LegacyMachineLayout> {
  const layout: Record<string, LegacyMachineLayout> = {};
  const placements = machines.map((machine, index) => {
    const ang = legacyMachineAngle(index, machines.length);
    return { machine, ang, pos: frPolar(QX, QY, LEGACY_RING, ang) };
  });
  const placedRects: HiveLayoutRect[] = [];

  placements.forEach(({ machine, ang, pos }) => {
    const otherMachineRects = placements
      .filter((placement) => placement.machine.id !== machine.id)
      .map((placement) => legacyCellRect(placement.pos, LEGACY_MACHINE_COLLISION_PAD));
    const slots = legacyAgentSlots(
      pos.x,
      pos.y,
      machine.agents.length + 1,
      [...otherMachineRects, ...placedRects],
    );
    layout[machine.id] = {
      pos,
      ang,
      agents: machine.agents.map((agent, index) => ({ agent, pos: slots[index] })),
      addPos: slots[machine.agents.length] ?? slots[slots.length - 1] ?? pos,
    };
    placedRects.push(
      legacyCellRect(pos, LEGACY_MACHINE_COLLISION_PAD),
      ...slots.map((slot) => legacyCellRect(slot)),
    );
  });

  return layout;
}

function legacyMachineGaps(total: number, preferredAngle: number) {
  if (total <= 0) return [{ mid: preferredAngle, size: 360, targetness: 0 }];
  const angles = Array.from({ length: total }, (_, index) => ((legacyMachineAngle(index, total) % 360) + 360) % 360)
    .sort((left, right) => left - right);
  return angles.map((angle, index) => {
    const next = index + 1 < angles.length ? angles[index + 1] : angles[0] + 360;
    const size = next - angle;
    const mid = ((angle + next) / 2) % 360;
    const difference = Math.abs(mid - preferredAngle) % 360;
    return { mid, size, targetness: Math.min(difference, 360 - difference) };
  });
}

export function frLegacyAddMachinePos(
  machines: HiveMachine[],
  layout?: Record<string, LegacyMachineLayout>,
): Pt {
  const radius = LEGACY_RING + LEGACY_BASE_ADD_MACHINE_GAP * LEGACY_CELL_SCALE;
  if (machines.length === 0) return frPolar(QX, QY, radius, 90);

  const gaps = legacyMachineGaps(machines.length, 90)
    .map((gap) => ({ ...gap, downness: gap.targetness }));
  const preferred = gaps.reduce((best, gap) => (
    gap.size > best.size + 0.5 ||
    (Math.abs(gap.size - best.size) <= 0.5 && gap.downness < best.downness)
      ? gap
      : best
  ));
  if (!layout) return frPolar(QX, QY, radius, preferred.mid);

  const obstacles: HiveLayoutRect[] = [];
  for (const machine of machines) {
    const machineLayout = layout[machine.id];
    if (!machineLayout) continue;
    obstacles.push(
      legacyCellRect(machineLayout.pos, LEGACY_MACHINE_COLLISION_PAD),
      legacyCellRect(machineLayout.addPos),
      ...machineLayout.agents.map(({ pos }) => legacyCellRect(pos)),
    );
  }

  let best: { point: Pt; extra: number; size: number; downness: number } | null = null;
  for (const gap of gaps) {
    for (let extra = 0; extra <= LEGACY_CELL_STEP * 8; extra += LEGACY_CELL_STEP / 4) {
      const point = frPolar(QX, QY, radius + extra, gap.mid);
      if (!legacySlotClears(point, obstacles)) continue;
      if (
        !best ||
        extra < best.extra - 0.5 ||
        (Math.abs(extra - best.extra) <= 0.5 && (
          gap.size > best.size + 0.5 ||
          (Math.abs(gap.size - best.size) <= 0.5 && gap.downness < best.downness)
        ))
      ) {
        best = { point, extra, size: gap.size, downness: gap.downness };
      }
      break;
    }
  }
  return best?.point ?? frPolar(QX, QY, radius, preferred.mid);
}

export function frLegacyPhonePlaceholderPos(
  machines: HiveMachine[],
  layout: Record<string, LegacyMachineLayout>,
): Pt {
  const radius = LEGACY_RING + LEGACY_BASE_ADD_MACHINE_GAP * LEGACY_CELL_SCALE;
  const obstacles: HiveLayoutRect[] = [];
  for (const machine of machines) {
    const machineLayout = layout[machine.id];
    if (!machineLayout) continue;
    obstacles.push(
      legacyCellRect(machineLayout.pos, LEGACY_MACHINE_COLLISION_PAD),
      legacyCellRect(machineLayout.addPos),
      ...machineLayout.agents.map(({ pos }) => legacyCellRect(pos)),
    );
  }
  obstacles.push(legacyCellRect(frLegacyAddMachinePos(machines, layout), LEGACY_MACHINE_COLLISION_PAD));

  let best: { point: Pt; extra: number; targetness: number; size: number } | null = null;
  for (const gap of legacyMachineGaps(machines.length, 150)) {
    for (let extra = 0; extra <= LEGACY_CELL_STEP * 8; extra += LEGACY_CELL_STEP / 4) {
      const point = frPolar(QX, QY, radius + extra, gap.mid);
      if (!legacySlotClears(point, obstacles)) continue;
      if (
        !best ||
        extra < best.extra - 0.5 ||
        (Math.abs(extra - best.extra) <= 0.5 && gap.targetness < best.targetness - 0.5) ||
        (Math.abs(extra - best.extra) <= 0.5 && Math.abs(gap.targetness - best.targetness) <= 0.5 && gap.size > best.size)
      ) {
        best = { point, extra, targetness: gap.targetness, size: gap.size };
      }
      break;
    }
  }
  return best?.point ?? frPolar(QX, QY, radius, 150);
}

export function frLegacyContentBounds(
  machines: HiveMachine[],
  layout: Record<string, LegacyMachineLayout>,
  options: { includePhonePlaceholder?: boolean; includeAddMachine?: boolean } = {},
) {
  let minX = QX;
  let maxX = QX;
  let minY = QY;
  let maxY = QY;
  const include = (x: number, y: number, half: number) => {
    minX = Math.min(minX, x - half);
    maxX = Math.max(maxX, x + half);
    minY = Math.min(minY, y - half);
    maxY = Math.max(maxY, y + half);
  };

  include(QX, QY, 84);
  for (const machine of machines) {
    const machineLayout = layout[machine.id];
    if (!machineLayout) continue;
    include(machineLayout.pos.x, machineLayout.pos.y, LEGACY_CELL_SIZE / 2 + 18);
    include(machineLayout.addPos.x, machineLayout.addPos.y, LEGACY_CELL_SIZE / 2);
    machineLayout.agents.forEach(({ pos }) => include(pos.x, pos.y, LEGACY_CELL_SIZE / 2 + 14));
  }
  if (options.includePhonePlaceholder) {
    const phone = frLegacyPhonePlaceholderPos(machines, layout);
    include(phone.x, phone.y, LEGACY_CELL_SIZE / 2 + 16);
  }
  if (options.includeAddMachine) {
    const addMachine = frLegacyAddMachinePos(machines, layout);
    include(addMachine.x, addMachine.y, LEGACY_CELL_SIZE / 2 + 22);
  }

  const padding = 18;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.min(HIVE_W * 1.6, Math.max(1, maxX - minX) + padding * 2),
    h: Math.min(HIVE_H * 1.6, Math.max(1, maxY - minY) + padding * 2),
  };
}

export function frLegacyNameSegments(name: string): string[] {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9α-ωΑ-Ω]+/)
    .filter(Boolean);
  if (words.length <= 2) return words;
  const oneThenRest = [words.slice(0, 1).join(" "), words.slice(1).join(" ")];
  const twoThenRest = [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
  const imbalance = (segments: string[]) => Math.abs(segments[0].length - segments[1].length);
  return imbalance(twoThenRest) < imbalance(oneThenRest) ? twoThenRest : oneThenRest;
}
