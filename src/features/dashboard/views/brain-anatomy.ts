// Brain-shaped anatomy model for the Shared Brain synapse renderer. Pure
// direction→distance math shared by the layout sim (cortical shell force,
// hemisphere anchors), the dendrite field (surface-tangent arbors), and the
// fiber pass (gyri-style arcs). Axes: x = lateral (left/right hemispheres),
// y = vertical, z = anterior–posterior.

import { clamp, hashUnit } from "./brain-synapse-gpu";

// Overall cortical radius in world units (the canvas WORLD_RADIUS is 150).
export const BRAIN_SCALE = 104;
const LATERAL = 0.94;
const HEIGHT = 0.72;
const LENGTH = 1.3;
// Longitudinal fissure: angular half-width on the unit direction, and the
// world-space half-width the sim keeps clear of tissue.
const FISSURE_DIR_WIDTH = 0.36;
const FISSURE_WORLD_WIDTH = BRAIN_SCALE * 0.22;
// Cerebellum bulge direction (down-back), unit length.
const CEREBELLUM_Y = -0.5;
const CEREBELLUM_Z = -0.866;

// Surface distance from the origin along a unit direction: a brain-shaped
// ellipsoid with a flattened underside, a cerebellum bulge, the longitudinal
// fissure notch (deepest on top), and a low-amplitude gyral ripple. Integer
// azimuth frequencies keep the ripple seamless across the atan2 wrap.
export function brainSurfaceDistance(dx: number, dy: number, dz: number) {
  const ex = dx / LATERAL;
  const ey = dy / HEIGHT;
  const ez = dz / LENGTH;
  let r = 1 / Math.max(Math.sqrt(ex * ex + ey * ey + ez * ez), 0.0001);
  if (dy < 0) r *= 1 - 0.2 * Math.min(1, -dy * 1.5);
  const toward = dy * CEREBELLUM_Y + dz * CEREBELLUM_Z;
  if (toward > 0) {
    const t2 = toward * toward;
    r *= 1 + 0.14 * t2 * t2 * t2;
  }
  const sag = 1 - Math.min(1, Math.abs(dx) / FISSURE_DIR_WIDTH);
  if (sag > 0) r *= 1 - 0.2 * sag * sag * (0.22 + 0.78 * Math.max(dy, 0));
  const azimuth = Math.atan2(dz, dx);
  const elevation = Math.asin(clamp(dy, -1, 1));
  r *= 1
    + 0.045 * Math.sin(azimuth * 5 + elevation * 2)
    + 0.03 * Math.sin(azimuth * 9 - elevation * 4 + 1.7)
    + 0.022 * Math.sin(elevation * 7 + azimuth * 3 + 4.2);
  return r * BRAIN_SCALE;
}

// Cluster anchors sit on the cortical shell of a deterministic hemisphere,
// biased upward toward the cortex and held off the fissure so the
// two-hemisphere silhouette stays legible.
export function brainClusterAnchor(cluster: string) {
  const side = hashUnit(cluster, 97) < 0.5 ? -1 : 1;
  const upward = clamp((hashUnit(cluster, 101) * 2 - 1) * 0.84 + 0.12, -1, 1);
  const angle = hashUnit(cluster, 103) * Math.PI * 2;
  const ring = Math.sqrt(Math.max(0.0001, 1 - upward * upward));
  const lateral = side * Math.max(Math.abs(Math.cos(angle) * ring), 0.24);
  const depth = Math.sin(angle) * ring;
  const length = Math.max(Math.hypot(lateral, upward, depth), 0.0001);
  const dx = lateral / length;
  const dy = upward / length;
  const dz = depth / length;
  const shell = 0.78 + hashUnit(cluster, 107) * 0.16;
  const radius = brainSurfaceDistance(dx, dy, dz) * shell;
  return { x: dx * radius, y: dy * radius, z: dz * radius };
}

export type BrainShellBody = {
  id: string;
  vx: number;
  vy: number;
  vz: number;
  weight: number;
  x: number;
  y: number;
  z: number;
};

// Steers a sim node into the cortical shell band (heavier hubs ride slightly
// deeper, like nuclei under cortex) and keeps the longitudinal fissure clear
// so the tissue reads as two hemispheres. Replaces generic pull-to-origin
// containment. The band pull alone cannot beat pairwise repulsion, so the
// per-node cap is also enforced as a hard position clamp: repulsion then
// spreads nodes ALONG the shell instead of inflating the cloud past it.
export function applyBrainShellForce(node: BrainShellBody, alpha: number) {
  const len = Math.hypot(node.x, node.y, node.z);
  if (len < 1) return;
  const dx = node.x / len;
  const dy = node.y / len;
  const dz = node.z / len;
  const surface = brainSurfaceDistance(dx, dy, dz);
  const shell = 0.7 + hashUnit(node.id, 173) * 0.26 - clamp(node.weight, 0, 1) * 0.12;
  const pull = (surface * shell - len) * 0.05 * alpha;
  node.vx += dx * pull;
  node.vy += dy * pull;
  node.vz += dz * pull;
  const cap = surface * (0.9 + hashUnit(node.id, 181) * 0.1);
  if (len > cap) {
    const scale = cap / len;
    node.x *= scale;
    node.y *= scale;
    node.z *= scale;
  }
  const gap = 1 - Math.abs(node.x) / FISSURE_WORLD_WIDTH;
  if (gap <= 0) return;
  const side = node.x === 0 ? (hashUnit(node.id, 179) < 0.5 ? -1 : 1) : Math.sign(node.x);
  node.vx += side * gap * (node.y > 0 ? 1 : 0.4) * 1.15 * alpha;
}
