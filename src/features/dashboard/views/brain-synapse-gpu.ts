// GPU layer for the Hive Vault synapse map: palette, procedural textures, and
// every shader. Kept apart from the engine so each file stays readable and
// under the repo size cap.

import * as THREE from "three";

export type SynapseNodeTone = "plain" | "recent" | "touched" | "stale" | "unresolved";

const LIGHT_PLAIN_TONES = ["#3f68b2", "#357f9a", "#6657aa", "#8e5799"] as const;

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

// The companion engine sets THREE.ColorManagement.enabled = false on the
// shared three singleton, which silently leaves string-parsed colors in raw
// sRGB. Every color this map feeds the GPU goes through here so the direct
// renderer's output conversion receives consistent linear-space inputs.
export function linearizeSRGB(color: THREE.Color) {
  if (!THREE.ColorManagement.enabled) color.convertSRGBToLinear();
  return color;
}

export function srgbColor(value: string) {
  return linearizeSRGB(new THREE.Color(value));
}

export function lightPulseColorInto(target: THREE.Color) {
  return linearizeSRGB(target.set("#2b92a7"));
}

export function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const light = document.documentElement.dataset.theme === "hive-light";
  const pick = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    light,
    bg: srgbColor(pick("--brain-bg", light ? "#f5efe6" : "#0c0d11")),
    fg: srgbColor(pick("--brain-fg", light ? "#4a3a2a" : "#f3f0e9")),
    fg2: srgbColor(pick("--brain-fg-2", light ? "#8a7a6a" : "#a7a39a")),
    honey: srgbColor(pick("--brain-honey", light ? "#8a5a2a" : "#e7b45c")),
    live: srgbColor(pick("--brain-live", light ? "#6b8f5e" : "#6fcdba")),
    danger: srgbColor(pick("--brain-danger", light ? "#b5483b" : "#e58e85")),
  };
}

// Node tone → color. Dark theme is a single blue→violet→magenta family, like
// fluorescence-stained neural tissue — tones stay distinguishable by hue
// WITHIN the family (touched = magenta, recent = cyan, unresolved = hot pink,
// stale = dim violet) instead of breaking the field with orange/red. Most
// vault notes carry a tone, so any out-of-family tone color takes over the
// whole map. Hive-light uses a darker, saturated version of the same neural
// spectrum so normal blending does not bleach the graph into the canvas.
export function toneColorInto(palette: Palette, tone: SynapseNodeTone, seed: number, target: THREE.Color) {
  if (palette.light) {
    if (tone === "touched") return linearizeSRGB(target.set("#aa523c"));
    if (tone === "recent") return linearizeSRGB(target.set("#2b8275"));
    if (tone === "unresolved") return linearizeSRGB(target.set("#b83c61"));
    if (tone === "stale") return linearizeSRGB(target.set("#7563a1"));
    const toneIndex = Math.min(LIGHT_PLAIN_TONES.length - 1, Math.floor(seed * LIGHT_PLAIN_TONES.length));
    return linearizeSRGB(target.set(LIGHT_PLAIN_TONES[toneIndex]));
  }
  if (tone === "touched") return linearizeSRGB(target.set("#dc83ff"));
  if (tone === "recent") return linearizeSRGB(target.set("#71e2ff"));
  if (tone === "unresolved") return linearizeSRGB(target.set("#ff67b2"));
  if (tone === "stale") return linearizeSRGB(target.set("#817dcc"));
  // Blue→violet field with a magenta minority, like real neuro-imagery.
  if ((seed * 13.7) % 1 > 0.7) {
    return linearizeSRGB(target.setHSL(0.83 + ((seed * 5.1) % 1) * 0.07, 0.8, 0.61));
  }
  return linearizeSRGB(target.setHSL(0.55 + ((seed * 7.31) % 1) * 0.2, 0.8, 0.55 + ((seed * 3.3) % 1) * 0.14));
}

// White-on-transparent 2x2 atlas of clean radial node glows. No procedural
// membrane lobes or process roots: the graph contains only real note nodes.
export function makeNodeGlowAtlas(): THREE.CanvasTexture {
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
      // A compact core plus broad glow bed keeps the node crisp at any zoom.
      const bed = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.46);
      bed.addColorStop(0, "rgba(255,255,255,0.24)");
      bed.addColorStop(0.16, "rgba(255,255,255,0.08)");
      bed.addColorStop(0.5, "rgba(255,255,255,0.015)");
      bed.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = bed;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
      ctx.fill();
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.13);
      core.addColorStop(0, "rgba(255,255,255,0.45)");
      core.addColorStop(0.42, "rgba(255,255,255,0.25)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.13, 0, Math.PI * 2);
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
  attribute float iHover;
  attribute float iProximity;
  attribute float iSeed;
  varying vec3 vTint;
  varying float vGlow;
  varying float vDim;
  varying float vHover;
  varying float vProximity;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDist;
  void main() {
    vTint = iTint;
    vGlow = iGlow;
    vDim = iDim;
    vHover = iHover;
    vProximity = iProximity;
    vSeed = iSeed;
    vec4 world = modelMatrix * instanceMatrix * vec4(position * (1.0 + iHover * 0.45), 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vec4 mv = viewMatrix * world;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SOMA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uAdditive;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vTint;
  varying float vGlow;
  varying float vDim;
  varying float vHover;
  varying float vProximity;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDist;
  void main() {
    float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
    // An emissive, feathered soma rather than an opaque shaded ball. The
    // nucleus carries the white-hot energy while the translucent membrane
    // merges into the flared fiber terminals around it.
    float membrane = pow(facing, 0.48);
    float nucleus = pow(facing, 6.0);
    float proximity = vProximity * mix(1.0, 0.86 + 0.14 * sin(uTime * 4.6 + vSeed * 18.0), uMotion);
    vec3 col = mix(vTint * (0.82 + vGlow * 0.12), vec3(0.9, 0.97, 1.0), nucleus * uAdditive * 0.18);
    col *= mix(1.28, 1.0, uAdditive);
    col += vTint * nucleus * vGlow * 0.18;
    col += mix(vTint, vec3(0.88, 0.96, 1.0), 0.2) * proximity * (0.06 + membrane * 0.08);
    vec3 hoverTint = mix(vTint, vec3(0.2, 0.9, 1.35), 0.78);
    col = mix(col, hoverTint * (0.85 + membrane * 0.55 + nucleus * 0.3), vHover);
    float darkAlpha = (0.06 + membrane * 0.16 + nucleus * 0.1) * (0.75 + vGlow * 0.12);
    float lightAlpha = 1.0;
    float alpha = mix(lightAlpha, darkAlpha, uAdditive);
    alpha *= 1.0 + proximity * 0.08;
    alpha = max(alpha, (0.13 + membrane * 0.4 + nucleus * 0.2) * vHover);
    alpha *= 1.0 - vDim * 0.68;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    alpha *= 1.0 - fog * 0.82;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export const HALO_VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute float iScale;
  attribute vec3 iTint;
  attribute float iSeed;
  attribute float iAlpha;
  attribute float iProximity;
  uniform float uTime;
  uniform float uMotion;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAlpha;
  varying float vProximity;
  void main() {
    vUv = uv;
    vTint = iTint;
    vSeed = iSeed;
    float sizeBias = clamp(28.0 / max(iScale, 1.0), 0.5, 1.45);
    float proximityPulse = mix(1.0, 0.9 + 0.1 * sin(uTime * 4.6 + iSeed * 18.0), uMotion);
    float energized = iProximity * proximityPulse;
    vProximity = energized * sizeBias;
    vec4 mv = viewMatrix * modelMatrix * vec4(iPos, 1.0);
    float proximityGrowth = energized * (0.5 + sizeBias * 1.2);
    mv.xy += position.xy * (iScale + proximityGrowth);
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vAlpha = iAlpha * (1.0 + vProximity * 0.1) * (1.0 - fog * 0.9);
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
  varying float vProximity;
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
    if (a < 0.003) discard;
    // Materials already select NormalBlending or AdditiveBlending. Supplying
    // unpremultiplied color avoids multiplying by alpha twice in dark mode.
    gl_FragColor = vec4(vTint, a);
  }
`;

// Pulsating spherical energy core at the organ's center: a fake-lit orb (no
// angular rays — nothing star-like) with a defined limb, churning plasma
// interior, hot nucleus, and a soft aura just outside the sphere. The
// billboard scale and fragment brightness share vPulse so the orb visibly
// enlarges/shrinks and brightens as one breath. uMotion freezes the pulse
// mid-breath for reduced motion.
export const CORE_GLOW_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uTime;
  uniform float uMotion;
  varying vec2 vUv;
  varying float vPulse;
  void main() {
    vUv = uv;
    float slow = 0.5 + 0.5 * sin(uTime * 1.35);
    float fast = 0.5 + 0.5 * sin(uTime * 2.3 + 1.7);
    vPulse = mix(0.5, slow * 0.7 + fast * 0.3, uMotion);
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize * (0.9 + 0.12 * vPulse);
    gl_Position = projectionMatrix * mv;
  }
`;

export const CORE_GLOW_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec2 vUv;
  varying float vPulse;
  float coreHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float coreNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(coreHash(i), coreHash(i + vec2(1.0, 0.0)), u.x),
      mix(coreHash(i + vec2(0.0, 1.0)), coreHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float radius = length(p);
    if (radius > 1.0) discard;
    float t = uTime * uMotion;
    // Slow rotation churns the plasma; turbulence samples cartesian space so
    // there is no seam at the atan wrap (no angular terms at all).
    float spin = t * 0.1;
    vec2 q = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * p;
    float turb = coreNoise(q * 3.4 + vec2(t * 0.36, -t * 0.28)) * 0.6
      + coreNoise(q * 7.2 - vec2(t * 0.22, t * 0.34)) * 0.4;
    const float orb = 0.62;
    float rr = radius / orb;
    vec3 color = vec3(0.16, 0.28, 0.9);
    float alpha = 0.0;
    if (rr < 1.0) {
      // Fake sphere depth: h is 1 at the center, 0 at the limb. Rim glow plus
      // a limb-accelerated interior swirl make the disk read as a volume.
      float h = sqrt(1.0 - rr * rr);
      float depthTurb = coreNoise(q * (3.0 + 2.6 * (1.0 - h)) + vec2(t * 0.45, -t * 0.3));
      float rim = pow(1.0 - h, 2.4);
      float nucleus = pow(h, 3.0);
      color = mix(color, vec3(0.5, 0.24, 1.0), clamp(turb, 0.0, 1.0));
      color = mix(color, vec3(0.55, 0.75, 1.0), depthTurb * 0.45);
      color = mix(color, vec3(0.72, 0.78, 1.0), rim * 0.55);
      color = mix(color, vec3(0.98, 0.99, 1.0), nucleus * 0.58);
      alpha = (0.18 + 0.2 * depthTurb) * (1.0 - rim) + rim * 0.32 + nucleus * 0.36;
    }
    float aura = step(orb, radius) * (1.0 - smoothstep(orb, 1.0, radius));
    color = mix(color, vec3(0.4, 0.45, 1.0), aura * 0.8);
    alpha += aura * (0.055 + 0.04 * turb);
    float breath = 0.84 + 0.16 * vPulse;
    gl_FragColor = vec4(color, alpha * breath);
  }
`;

export const FIBER_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aLit;
  attribute float aSeed;
  attribute float aAlpha;
  attribute float aSignal;
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vAlpha;
  varying float vSignal;
  varying float vDist;
  varying vec3 vColA;
  varying vec3 vColB;
  void main() {
    vT = aT;
    vLit = aLit;
    vSeed = aSeed;
    vAlpha = aAlpha;
    vSignal = aSignal;
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
  uniform float uAdditive;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vAlpha;
  varying float vSignal;
  varying float vDist;
  varying vec3 vColA;
  varying vec3 vColB;
  void main() {
    vec3 col = mix(vColA, vColB, vT);
    // Dark theme: pull fibers toward pale blue-white — blue-on-blue has no
    // contrast no matter the alpha. (uAdditive doubles as the theme flag;
    // hive-light keeps the ink tint.)
    col = mix(col, vec3(0.84, 0.95, 1.0), 0.74 * uAdditive);
    col = mix(col, uLit, vLit * 0.7);
    float shimmer = 1.0;
    // Lit synapses stand out via the honey hue and everything ELSE dimming
    // (uSelDim) — no alpha boost, or bundles converging on a hub white out.
    float a = vAlpha * 1.16 * shimmer;
    a *= mix(uSelDim, 1.0, vLit);
    // A narrow, crackling current runs along the fiber independently of the
    // particle packet. Real links carry a full signal; ambient paths flicker.
    float signalHead = fract(vSeed + uTime * uMotion * (0.1 + vSeed * 0.06));
    float signalDistance = abs(vT - signalHead);
    float crackle = 1.0;
    float signal = (1.0 - smoothstep(0.0, 0.13, signalDistance)) * vSignal * crackle * uAdditive;
    col = mix(col, uLit, clamp(signal * 1.15, 0.0, 1.0));
    a += signal * 1.15;
    // Taper near the endpoints: many fibers share the same few pixels where
    // they meet a node, so full-strength ends stack into a blown highlight.
    float axonTaper = 0.52 + 0.48 * smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.88, 1.0, vT));
    a *= axonTaper;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uBg, fog * 0.18);
    a *= 1.0 - fog * 0.34;
    gl_FragColor = vec4(col * (1.0 + 0.3 * vLit), a);
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
  uniform float uAdditive;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float t = fract(aPhase + uTime * aSpeed * max(uMotion, 0.0));
    vec3 p = mix(mix(aStart, aCtrl, t), mix(aCtrl, aEnd, t), t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float ends = smoothstep(0.08, 0.2, t) * (1.0 - smoothstep(0.8, 0.92, t));
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vTint = aTint;
    vAlpha = ends * mix(uSelDim, 1.0, aLit) * (1.0 - fog * 0.9) * mix(0.72, 0.48, uAdditive);
    gl_PointSize = aSize * (1.0 + aLit * 0.06) * uScale / max(-mv.z, 1.0);
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
    if (mask < 0.003) discard;
    float a = mask * vAlpha;
    float lightCore = smoothstep(0.55, 0.96, mask) * (1.0 - uAdditive);
    vec3 color = mix(vTint, vec3(0.9, 0.98, 1.0), lightCore * 0.82);
    gl_FragColor = vec4(color, a);
  }
`;

// Fullscreen deep-space backdrop: radial indigo gradient with a few slowly
// drifting nebula blobs. Camera-independent (positions are already NDC),
// drawn behind everything, dark theme only.
export const BACKDROP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

export const BACKDROP_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec2 vUv;
  float blob(vec2 uv, vec2 center, float radius) {
    return 1.0 - smoothstep(0.0, radius, distance(uv, center));
  }
  void main() {
    vec2 uv = vUv;
    float t = uTime * uMotion;
    // The reference is an energized cobalt field rather than empty black
    // space. Keep enough dark floor for contrast, then let the center and
    // nebula pockets carry visible blue/violet energy behind the tissue.
    float radial = 1.0 - smoothstep(0.0, 0.82, distance(uv, vec2(0.5, 0.54)));
    vec3 col = mix(vec3(0.002, 0.004, 0.025), vec3(0.015, 0.035, 0.16), radial);
    // Slow luminous pockets add depth without flattening the graph.
    col += vec3(0.015, 0.055, 0.24) * blob(uv, vec2(0.28 + 0.04 * sin(t * 0.021), 0.7 + 0.03 * cos(t * 0.017)), 0.44) * 0.5;
    col += vec3(0.10, 0.018, 0.20) * blob(uv, vec2(0.76 + 0.05 * cos(t * 0.013), 0.34 + 0.04 * sin(t * 0.019)), 0.38) * 0.42;
    col += vec3(0.008, 0.09, 0.25) * blob(uv, vec2(0.54 + 0.03 * sin(t * 0.011), 0.12 + 0.03 * cos(t * 0.023)), 0.34) * 0.4;
    float vignette = smoothstep(0.36, 0.92, distance(uv, vec2(0.5)));
    col *= 1.0 - vignette * 0.42;
    gl_FragColor = vec4(col, 1.0);
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
  uniform float uAdditive;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    float core = 1.0 - smoothstep(70.0, 230.0, length(position));
    // Sparse, faint motes add depth without competing with real graph nodes.
    vAlpha = mix(0.03, 0.1, core) * (1.0 - fog) * mix(0.04, 1.0, uAdditive);
    float pointSize = aSize * (1.0 + core * 0.32) * uScale / max(-mv.z, 1.0);
    // WebGL point size is perspective-scaled in framebuffer pixels. Clamp it
    // to the orbital graph's tiny 1–3 CSS-pixel character at retina scale so
    // close particles never become giant square blocks.
    gl_PointSize = clamp(pointSize, 0.8, 2.2);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uAdditive;
  varying float vAlpha;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float mask = 1.0 - smoothstep(0.3, 0.5, radius);
    if (mask < 0.01) discard;
    float a = mask * vAlpha;
    gl_FragColor = vec4(uTint, a);
  }
`;
