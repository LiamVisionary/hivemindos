const MIN_RADIUS_PX = 110;
const MAX_RADIUS_PX = 210;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function pointerProximityRadius(width: number, height: number) {
  return clamp(Math.min(width, height) * 0.2, MIN_RADIUS_PX, MAX_RADIUS_PX);
}

export function pointerProximityStrength(distancePx: number, radiusPx: number) {
  if (!Number.isFinite(distancePx) || !Number.isFinite(radiusPx) || radiusPx <= 0) return 0;
  const inward = clamp(1 - distancePx / radiusPx, 0, 1);
  return inward * inward * (3 - 2 * inward);
}

export function approachPointerProximity(current: number, target: number, deltaSeconds: number) {
  const rate = target > current ? 18 : 7;
  const blend = 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
  return current + (target - current) * blend;
}
