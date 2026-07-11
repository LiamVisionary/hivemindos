// GPU layer for the Hive Vault synapse map: palette, procedural textures, and
// every shader. Kept apart from the engine so each file stays readable and
// under the repo size cap.

import * as THREE from "three";

export type SynapseNodeTone = "plain" | "recent" | "touched" | "stale" | "unresolved";

export function hashUnit(value: string, salt = 0) {
  let hash = 2166136261 + salt;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export type Palette = {
  bg: THREE.Color;
  danger: THREE.Color;
  fg: THREE.Color;
  fg2: THREE.Color;
  honey: THREE.Color;
  light: boolean;
  live: THREE.Color;
};

export function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const light = document.documentElement.dataset.theme === "hive-light";
  const pick = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    light,
    bg: new THREE.Color(pick("--brain-bg", light ? "#f1ede3" : "#0c0d11")),
    fg: new THREE.Color(pick("--brain-fg", light ? "#221d14" : "#f3f0e9")),
    fg2: new THREE.Color(pick("--brain-fg-2", light ? "#5e574b" : "#a7a39a")),
    honey: new THREE.Color(pick("--brain-honey", light ? "#936811" : "#e7b45c")),
    live: new THREE.Color(pick("--brain-live", light ? "#1d8e7c" : "#6fcdba")),
    danger: new THREE.Color(pick("--brain-danger", light ? "#c0524d" : "#e58e85")),
  };
}

// Node tone → color. Dark theme uses an electric palette (hue-varied cyan/blue
// tissue with hot orange for agent-touched notes) so the mesh reads like live
// neural fiber; hive-light keeps the token-driven ink-on-parchment look.
export function toneColorInto(palette: Palette, tone: SynapseNodeTone, seed: number, target: THREE.Color) {
  if (palette.light) {
    if (tone === "touched") return target.copy(palette.honey);
    if (tone === "recent") return target.copy(palette.live);
    if (tone === "unresolved") return target.copy(palette.danger);
    if (tone === "stale") return target.copy(palette.honey).lerp(palette.fg2, 0.55);
    return target.copy(palette.fg2).lerp(palette.fg, 0.55);
  }
  if (tone === "touched") return target.set("#ffb04d");
  if (tone === "recent") return target.set("#64f0d8");
  if (tone === "unresolved") return target.set("#ff6f61");
  if (tone === "stale") return target.set("#d19b52");
  return target.setHSL(0.5 + seed * 0.13, 0.62, 0.5 + ((seed * 7.31) % 1) * 0.14);
}

// White-on-transparent 2x2 atlas of dendritic soma halos; tinted per node in
// the halo shader so one texture serves every tone and theme.
export function makeDendriteAtlas(): THREE.CanvasTexture {
  const size = 512;
  const cell = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    for (let variant = 0; variant < 4; variant += 1) {
      const cx = (variant % 2) * cell + cell / 2;
      const cy = Math.floor(variant / 2) * cell + cell / 2;
      const tendrils = 9 + ((variant * 3) % 5);
      for (let i = 0; i < tendrils; i += 1) {
        const angle = (i / tendrils) * Math.PI * 2 + hashUnit(`t${variant}-${i}`) * 0.9;
        const reach = cell * (0.26 + hashUnit(`r${variant}-${i}`) * 0.19);
        const bend = (hashUnit(`b${variant}-${i}`) - 0.5) * 1.7;
        const midX = cx + Math.cos(angle + bend * 0.35) * reach * 0.55;
        const midY = cy + Math.sin(angle + bend * 0.35) * reach * 0.55;
        const endX = cx + Math.cos(angle + bend) * reach;
        const endY = cy + Math.sin(angle + bend) * reach;
        const grad = ctx.createLinearGradient(cx, cy, endX, endY);
        grad.addColorStop(0, "rgba(255,255,255,0.34)");
        grad.addColorStop(0.65, "rgba(255,255,255,0.1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.6 + hashUnit(`w${variant}-${i}`) * 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(midX, midY, endX, endY);
        ctx.stroke();
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.24);
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.4, "rgba(255,255,255,0.42)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const SOMA_VERTEX = /* glsl */ `
  attribute vec3 iTint;
  attribute float iGlow;
  attribute float iDim;
  attribute float iSeed;
  varying vec3 vTint;
  varying float vGlow;
  varying float vDim;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDist;
  void main() {
    vTint = iTint;
    vGlow = iGlow;
    vDim = iDim;
    vSeed = iSeed;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vec4 mv = viewMatrix * world;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SOMA_FRAGMENT = /* glsl */ `
  uniform vec3 uBg;
  uniform float uTime;
  uniform float uMotion;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vTint;
  varying float vGlow;
  varying float vDim;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDist;
  void main() {
    float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.3);
    float breathe = 0.5 + 0.5 * sin(uTime * 1.35 + vSeed * 6.2831);
    vec3 body = vTint * (0.5 + 0.75 * vGlow + 0.12 * breathe * uMotion * vGlow);
    vec3 col = body + vTint * fres * (0.45 + 0.6 * vGlow);
    col = mix(col, uBg, vDim * 0.62);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const HALO_VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute float iScale;
  attribute vec3 iTint;
  attribute float iSeed;
  attribute float iAlpha;
  uniform float uTime;
  uniform float uMotion;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vTint = iTint;
    vSeed = iSeed;
    vec4 mv = viewMatrix * modelMatrix * vec4(iPos, 1.0);
    float breathe = 1.0 + 0.09 * uMotion * sin(uTime * 1.05 + iSeed * 6.2831);
    mv.xy += position.xy * iScale * breathe;
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vAlpha = iAlpha * (1.0 - fog * 0.9);
    gl_Position = projectionMatrix * mv;
  }
`;

export const HALO_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uMotion;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    float angle = vSeed * 6.2831 + uTime * uMotion * (0.04 + 0.09 * fract(vSeed * 7.31)) * (step(0.5, vSeed) * 2.0 - 1.0);
    vec2 centered = vUv - 0.5;
    vec2 rotated = vec2(
      centered.x * cos(angle) - centered.y * sin(angle),
      centered.x * sin(angle) + centered.y * cos(angle)
    ) + 0.5;
    vec2 quadrant = vec2(step(0.5, fract(vSeed * 3.17)), step(0.5, fract(vSeed * 5.53)));
    vec2 atlasUv = clamp(rotated, 0.02, 0.98) * 0.5 + quadrant * 0.5;
    float mask = texture2D(uMap, atlasUv).a;
    float a = mask * vAlpha;
    vec3 additive = vTint * a;
    vec3 normal = vTint;
    gl_FragColor = vec4(mix(normal, additive, uAdditive), mix(a, 1.0, uAdditive) * mix(1.0, a, uAdditive));
  }
`;

export const FIBER_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aLit;
  attribute float aSeed;
  attribute float aAlpha;
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vAlpha;
  varying float vDist;
  varying vec3 vColA;
  varying vec3 vColB;
  void main() {
    vT = aT;
    vLit = aLit;
    vSeed = aSeed;
    vAlpha = aAlpha;
    vColA = aColorA;
    vColB = aColorB;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const FIBER_FRAGMENT = /* glsl */ `
  uniform vec3 uLit;
  uniform vec3 uBg;
  uniform float uTime;
  uniform float uMotion;
  uniform float uSelDim;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vAlpha;
  varying float vDist;
  varying vec3 vColA;
  varying vec3 vColB;
  void main() {
    vec3 col = mix(vColA, vColB, vT);
    col = mix(col, uLit, vLit * 0.7);
    float shimmer = 0.72 + 0.28 * sin(vT * 16.0 - uTime * uMotion * (1.0 + vSeed * 1.8) + vSeed * 6.2831);
    float a = vAlpha * (0.7 + 0.8 * vLit) * shimmer;
    a *= mix(uSelDim, 1.0, vLit);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uBg, fog * 0.55);
    a *= 1.0 - fog * 0.85;
    gl_FragColor = vec4(col * (0.85 + 0.75 * vLit), a);
  }
`;

export const PULSE_VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aCtrl;
  attribute vec3 aEnd;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec3 aTint;
  attribute float aLit;
  uniform float uTime;
  uniform float uMotion;
  uniform float uScale;
  uniform float uSelDim;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float t = fract(aPhase + uTime * aSpeed * max(uMotion, 0.0));
    vec3 p = mix(mix(aStart, aCtrl, t), mix(aCtrl, aEnd, t), t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float ends = smoothstep(0.02, 0.16, t) * (1.0 - smoothstep(0.84, 0.98, t));
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vTint = aTint;
    vAlpha = ends * mix(uSelDim, 1.0, aLit) * (1.0 - fog * 0.9);
    gl_PointSize = aSize * (1.0 + aLit * 0.9) * uScale / max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const PULSE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAdditive;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float mask = texture2D(uMap, gl_PointCoord).a;
    float a = mask * vAlpha;
    gl_FragColor = vec4(mix(vTint, vTint * a, uAdditive), mix(a, 1.0, uAdditive) * mix(1.0, a, uAdditive));
  }
`;

export const DUST_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uMotion;
  uniform float uScale;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.11 * uMotion + aSeed * 6.2831) * 7.0;
    p.y += cos(uTime * 0.09 * uMotion + aSeed * 12.4) * 7.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vAlpha = (0.14 + 0.1 * sin(uTime * 0.5 * uMotion + aSeed * 20.0)) * (1.0 - fog);
    gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DUST_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform float uAdditive;
  varying float vAlpha;
  void main() {
    float mask = texture2D(uMap, gl_PointCoord).a;
    float a = mask * vAlpha;
    gl_FragColor = vec4(mix(uTint, uTint * a, uAdditive), mix(a, 1.0, uAdditive) * mix(1.0, a, uAdditive));
  }
`;
