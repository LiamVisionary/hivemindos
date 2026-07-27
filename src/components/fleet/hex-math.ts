// src/components/fleet/hex-math.ts
// Axial-coord helpers for pointy-top hexagons. Used by MachineCluster to
// tessellate cells (machine center + agent ring) and by HexTile sizing.

export const FLEET_GRAPH_CELL_SCALE = 1.17;
export const HEX_W = 62 * FLEET_GRAPH_CELL_SCALE;
export const HEX_H = (HEX_W * 2) / Math.sqrt(3);   // pointy-top bbox height
export const Y_STEP = (HEX_W * Math.sqrt(3)) / 2;  // diagonal neighbor y offset

export function axialToPixelWithStep(q: number, r: number, step = HEX_W) {
  return { x: step * (q + r / 2), y: (step * Math.sqrt(3) / 2) * r };
}

export function axialToPixel(q: number, r: number) {
  return axialToPixelWithStep(q, r);
}

// Pointy-top neighbor offsets in axial coords, clockwise starting from E.
const HEX_DIRS_CW: ReadonlyArray<readonly [number, number]> = [
  [+1, 0],   // E
  [0, +1],   // SE
  [-1, +1],  // SW
  [-1, 0],   // W
  [0, -1],   // NW
  [+1, -1],  // NE
];

// Spiral of axial coords starting at origin; ring k starts at NW*k, walks CW.
export function hexSpiral(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [[0, 0]];
  if (n <= 1) return out.slice(0, n);
  let k = 1;
  while (out.length < n) {
    let [q, r] = [HEX_DIRS_CW[4][0] * k, HEX_DIRS_CW[4][1] * k];
    for (let side = 0; side < 6 && out.length < n; side++) {
      for (let step = 0; step < k && out.length < n; step++) {
        out.push([q, r]);
        q += HEX_DIRS_CW[side][0];
        r += HEX_DIRS_CW[side][1];
      }
    }
    k++;
  }
  return out;
}

// Atlantic-centered equirectangular projection for MapView.
export const MAP_LON_W = -90, MAP_LON_E = 35;
export const MAP_LAT_N = 60,  MAP_LAT_S = 25;
export function projectLatLon(lon: number, lat: number, w: number, h: number) {
  const x = ((lon - MAP_LON_W) / (MAP_LON_E - MAP_LON_W)) * w;
  const y = ((MAP_LAT_N - lat) / (MAP_LAT_N - MAP_LAT_S)) * h;
  return { x, y };
}
