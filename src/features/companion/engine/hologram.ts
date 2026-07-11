// Hologram character style — ported from ami-ai-companion's
// src/lib/utils/character-styles.ts, WebGL/GLSL path only (the ami original
// also carried a WebGPU/TSL backend, dropped here).
//
// A Cortana-from-Halo look: cyan/blue luminance ramp, fresnel rim glow,
// drifting scanlines, rising bright band, subtle flicker. Implemented via
// onBeforeCompile GLSL injection on three material families:
//   • three-vrm MToonMaterial — anchored on the final
//     `gl_FragColor = vec4( col, diffuseColor.a );` assignment of the MToon
//     fragment shader (verified against @pixiv/three-vrm@3.5.2 as installed).
//   • Lit built-ins (MeshStandard/Physical/Lambert/Phong) — call injected
//     before `#include <tonemapping_fragment>` so the hologram runs in linear
//     space like the MToon path; fresnel uses the in-scope `normal` local and
//     the unconditional `vViewPosition` varying (verified against
//     three@0.184.0 ShaderLib sources as installed in this repo).
//   • MeshBasicMaterial — same tail injection, but basic has no normal/view
//     varyings, so it gets a fresnel-free variant (luma ramp + scanlines +
//     band + flicker only).
// Built-ins take world Y for scanlines/band from an injected
// `vHiveHoloWorldPos` varying (three's own worldpos_vertex is conditional),
// assigned after skinning/instancing so deformation is respected.
//
// All tunable parameters are LIVE UNIFORMS shared across every styled
// material — updateHologramConfig() changes them instantly with no shader
// recompile. Only blendMode/depthWrite are structural and trigger a full
// re-apply to the styled roots.
//
// Time: scanline/band scroll reads a shared time uniform. By default an
// internal rAF clock advances it while any patched material exists (ami's
// behavior). A host with its own frame loop can instead call
// updateHologramTime(elapsedSeconds) each frame — the first manual call
// permanently takes over from the internal clock.

import * as THREE from "three";
import { logger } from "./logger";

export type CharacterStyleId = "hologram" | "none";

export interface HologramStyleConfig {
  /** Deep shadow tint of the luminance ramp (linear RGB). */
  baseColor: [number, number, number];
  /** Bright tint of the luminance ramp (linear RGB). */
  highlightColor: [number, number, number];
  /** Fresnel rim glow colour. */
  rimColor: [number, number, number];
  /** Rising bright band colour. */
  bandColor: [number, number, number];
  /** Overall brightness multiplier. */
  intensity: number;
  /** Fresnel exponent — higher = tighter rim. */
  rimPower: number;
  rimIntensity: number;
  /** Pre-ramp exposure on the source colour. The ami reference (WebGPU TSL)
   *  reads softly-lit unlit materials; hivemind's PBR-lit + in-shader-OETF
   *  Sara arrives much hotter, saturating the luma ramp — this renormalises
   *  the input so the base→highlight gradient survives. */
  srcExposure: number;
  /** How much source-texture luminance survives into the ramp. */
  litBase: number;
  litScale: number;
  lumaGamma: number;
  /** Fine scanlines: spatial frequency (radians per world metre) + scroll. */
  scanlineDensity: number;
  scanlineSpeed: number;
  scanlineStrength: number;
  /** Slow rising bright band. */
  bandFrequency: number;
  bandSpeed: number;
  bandIntensity: number;
  bandEdge: number;
  /** 0..1 amplitude of the global brightness flicker. */
  flickerStrength: number;
  /**
   * Alpha = srcAlpha * (alphaBase + alphaFresnel * fresnel).
   * Only used in 'additive' (ghost) mode — 'normal' mode keeps source alpha.
   */
  alphaBase: number;
  alphaFresnel: number;
  /**
   * 'normal' (default) = SOLID hologram: only the colour is transformed;
   * each material keeps its original blend state, depth write, and alpha —
   * the character stays person-shaped and is NOT see-through (Cortana-like).
   * 'additive' = GHOST hologram: transparent, additive, self-glowing —
   * overlapping surfaces sum into an X-ray look.
   * STRUCTURAL — changing it re-applies the style (shader rebuild).
   */
  blendMode: "additive" | "normal";
  /** Only applied in 'additive' mode ('normal' keeps the material's own). */
  depthWrite: boolean;
}

// Retuned live against Sara in the hivemind render harness 2026-07-11 (the
// ami on-device values assumed the WebGPU path's softer unlit input and read
// milky-white here). Deep-navy shadows → cyan highlights, stronger rim and
// scanlines. Colour triples are the raw 0–1 values the shader consumes.
export const HOLOGRAM_DEFAULTS: HologramStyleConfig = {
  baseColor: [0.07, 0.18, 0.5],
  highlightColor: [0.42, 0.85, 0.98],
  rimColor: [0.1, 0.55, 0.65],
  bandColor: [0.1176, 0.3647, 0.4431],
  intensity: 0.95,
  rimPower: 1.65,
  rimIntensity: 1.05,
  srcExposure: 0.26,
  litBase: 0.2,
  litScale: 0.9,
  lumaGamma: 1.25,
  scanlineDensity: 64,
  scanlineSpeed: 4.05,
  scanlineStrength: 0.16,
  bandFrequency: 1.7,
  bandSpeed: 1.08,
  bandIntensity: 0.15,
  bandEdge: 0.919,
  flickerStrength: 0,
  alphaBase: 0.62,
  alphaFresnel: 0.35,
  blendMode: "normal",
  depthWrite: false,
};

/** Config keys that require a shader rebuild (everything else is a uniform). */
const STRUCTURAL_KEYS: ReadonlyArray<keyof HologramStyleConfig> = [
  "blendMode",
  "depthWrite",
];

const OUTLINE_MATERIAL_RE = /\(outline\)\s*$/i;

const STYLE_MARKER_KEY = "__hiveCharacterStyleActive";

interface SavedMaterialState {
  kind: "legacy" | "outline";
  transparent?: boolean;
  depthWrite?: boolean;
  blending?: THREE.Blending;
  visible?: boolean;
  onBeforeCompile?: THREE.Material["onBeforeCompile"];
  customProgramCacheKey?: THREE.Material["customProgramCacheKey"];
}

const savedMaterialState = new WeakMap<THREE.Material, SavedMaterialState>();
const savedMeshState = new WeakMap<THREE.Object3D, { castShadow: boolean }>();

// ---------------------------------------------------------------------------
// Live uniforms — one shared set for all styled materials.
// ---------------------------------------------------------------------------

const NUMERIC_UNIFORM_KEYS = [
  "intensity", "rimPower", "rimIntensity", "srcExposure", "litBase", "litScale", "lumaGamma",
  "scanlineDensity", "scanlineSpeed", "scanlineStrength",
  "bandFrequency", "bandSpeed", "bandIntensity", "bandEdge",
  "flickerStrength", "alphaBase", "alphaFresnel",
] as const;
type NumericUniformKey = (typeof NUMERIC_UNIFORM_KEYS)[number];
const COLOR_UNIFORM_KEYS = [
  "baseColor", "highlightColor", "rimColor", "bandColor",
] as const;
type ColorUniformKey = (typeof COLOR_UNIFORM_KEYS)[number];

// Shared uniform objects, injected into every patched shader.
const holoTime = { value: 0 };
const holoUniforms: Record<string, { value: number | THREE.Color }> = {
  uHiveHoloTime: holoTime,
  uHiveHoloBaseColor: { value: new THREE.Color(...HOLOGRAM_DEFAULTS.baseColor) },
  uHiveHoloHighlightColor: { value: new THREE.Color(...HOLOGRAM_DEFAULTS.highlightColor) },
  uHiveHoloRimColor: { value: new THREE.Color(...HOLOGRAM_DEFAULTS.rimColor) },
  uHiveHoloBandColor: { value: new THREE.Color(...HOLOGRAM_DEFAULTS.bandColor) },
  uHiveHoloIntensity: { value: HOLOGRAM_DEFAULTS.intensity },
  uHiveHoloRimPower: { value: HOLOGRAM_DEFAULTS.rimPower },
  uHiveHoloRimIntensity: { value: HOLOGRAM_DEFAULTS.rimIntensity },
  uHiveHoloSrcExposure: { value: HOLOGRAM_DEFAULTS.srcExposure },
  uHiveHoloLitBase: { value: HOLOGRAM_DEFAULTS.litBase },
  uHiveHoloLitScale: { value: HOLOGRAM_DEFAULTS.litScale },
  uHiveHoloLumaGamma: { value: HOLOGRAM_DEFAULTS.lumaGamma },
  uHiveHoloScanDensity: { value: HOLOGRAM_DEFAULTS.scanlineDensity },
  uHiveHoloScanSpeed: { value: HOLOGRAM_DEFAULTS.scanlineSpeed },
  uHiveHoloScanStrength: { value: HOLOGRAM_DEFAULTS.scanlineStrength },
  uHiveHoloBandFreq: { value: HOLOGRAM_DEFAULTS.bandFrequency },
  uHiveHoloBandSpeed: { value: HOLOGRAM_DEFAULTS.bandSpeed },
  uHiveHoloBandIntensity: { value: HOLOGRAM_DEFAULTS.bandIntensity },
  uHiveHoloBandEdge: { value: HOLOGRAM_DEFAULTS.bandEdge },
  uHiveHoloFlicker: { value: HOLOGRAM_DEFAULTS.flickerStrength },
  uHiveHoloAlphaBase: { value: HOLOGRAM_DEFAULTS.alphaBase },
  uHiveHoloAlphaFresnel: { value: HOLOGRAM_DEFAULTS.alphaFresnel },
};
const NUMERIC_TO_UNIFORM: Record<NumericUniformKey, string> = {
  intensity: "uHiveHoloIntensity",
  rimPower: "uHiveHoloRimPower",
  rimIntensity: "uHiveHoloRimIntensity",
  srcExposure: "uHiveHoloSrcExposure",
  litBase: "uHiveHoloLitBase",
  litScale: "uHiveHoloLitScale",
  lumaGamma: "uHiveHoloLumaGamma",
  scanlineDensity: "uHiveHoloScanDensity",
  scanlineSpeed: "uHiveHoloScanSpeed",
  scanlineStrength: "uHiveHoloScanStrength",
  bandFrequency: "uHiveHoloBandFreq",
  bandSpeed: "uHiveHoloBandSpeed",
  bandIntensity: "uHiveHoloBandIntensity",
  bandEdge: "uHiveHoloBandEdge",
  flickerStrength: "uHiveHoloFlicker",
  alphaBase: "uHiveHoloAlphaBase",
  alphaFresnel: "uHiveHoloAlphaFresnel",
};
const COLOR_TO_UNIFORM: Record<ColorUniformKey, string> = {
  baseColor: "uHiveHoloBaseColor",
  highlightColor: "uHiveHoloHighlightColor",
  rimColor: "uHiveHoloRimColor",
  bandColor: "uHiveHoloBandColor",
};

function syncHologramUniformValues(cfg: HologramStyleConfig): void {
  for (const key of NUMERIC_UNIFORM_KEYS) {
    holoUniforms[NUMERIC_TO_UNIFORM[key]].value = cfg[key];
  }
  for (const key of COLOR_UNIFORM_KEYS) {
    (holoUniforms[COLOR_TO_UNIFORM[key]].value as THREE.Color).setRGB(...cfg[key]);
  }
}

// ---------------------------------------------------------------------------
// Shared time clock. The internal rAF clock only runs while patched materials
// are active, so the default path pays nothing. A host driving time itself
// (updateHologramTime) permanently takes over from the internal clock.
// ---------------------------------------------------------------------------

let patchCount = 0;
let clockRunning = false;
let manualTimeDriven = false;

/**
 * Advance the hologram's shared time uniform (seconds; drives scanline scroll,
 * band rise, and flicker). Call once per frame from the host render loop.
 * The first call stops the internal rAF clock and takes over for good.
 */
export function updateHologramTime(elapsedSeconds: number): void {
  manualTimeDriven = true;
  holoTime.value = elapsedSeconds;
}

function ensureClock(): void {
  if (clockRunning || manualTimeDriven || typeof requestAnimationFrame === "undefined") {
    return;
  }
  clockRunning = true;
  const startedAt = performance.now();
  const tick = (): void => {
    if (patchCount <= 0 || manualTimeDriven) {
      clockRunning = false;
      return;
    }
    holoTime.value = (performance.now() - startedAt) / 1000;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// GLSL builders — one shared hologram function body, three injection variants
// ---------------------------------------------------------------------------

// Which injection recipe a material gets:
//   'mtoon' — three-vrm MToonMaterial (replace the final gl_FragColor line).
//   'lit'   — MeshStandard/Physical/Lambert/Phong (fresnel via normal +
//             vViewPosition, world Y via injected varying).
//   'unlit' — MeshBasicMaterial (no normal/view varyings → no fresnel).
type HologramVariant = "mtoon" | "lit" | "unlit";

// Final colour assignment in three-vrm's MToon fragment shader (also appears
// inside the never-defined DEBUG_LITSHADERATE block — patching that copy is
// inert because the preprocessor strips it).
const MTOON_FRAG_ANCHOR = "gl_FragColor = vec4( col, diffuseColor.a );";
const MAIN_ANCHOR = "void main() {";
// Built-in material fragment tails (three r184 meshphysical/meshbasic/
// meshlambert/meshphong.glsl.js). We inject before tonemapping so the
// hologram computes in linear space, matching the MToon path; dithering is
// the verified fallback anchor.
const BUILTIN_FRAG_ANCHORS = [
  "#include <tonemapping_fragment>",
  "#include <dithering_fragment>",
] as const;
// Vertex-side anchor for the injected world-position varying — present in all
// four built-in vertex shaders, after begin_vertex/skinning_vertex so
// `transformed` carries skinned deformation.
const BUILTIN_VERT_ANCHOR = "#include <fog_vertex>";

const HOLO_UNIFORM_DECLS = `
uniform float uHiveHoloTime;
uniform vec3 uHiveHoloBaseColor;
uniform vec3 uHiveHoloHighlightColor;
uniform vec3 uHiveHoloRimColor;
uniform vec3 uHiveHoloBandColor;
uniform float uHiveHoloIntensity;
uniform float uHiveHoloRimPower;
uniform float uHiveHoloRimIntensity;
uniform float uHiveHoloSrcExposure;
uniform float uHiveHoloLitBase;
uniform float uHiveHoloLitScale;
uniform float uHiveHoloLumaGamma;
uniform float uHiveHoloScanDensity;
uniform float uHiveHoloScanSpeed;
uniform float uHiveHoloScanStrength;
uniform float uHiveHoloBandFreq;
uniform float uHiveHoloBandSpeed;
uniform float uHiveHoloBandIntensity;
uniform float uHiveHoloBandEdge;
uniform float uHiveHoloFlicker;
uniform float uHiveHoloAlphaBase;
uniform float uHiveHoloAlphaFresnel;
`;

/**
 * The hologram function body shared by every variant. `fresnelDecl` must
 * define `float hiveFresnel`; `worldPosExpr` must be a vec3 world position.
 */
function buildHologramBodyGLSL(
  blendMode: HologramStyleConfig["blendMode"],
  fresnelDecl: string,
  worldPosExpr: string,
): string {
  const alphaExpr = blendMode === "additive"
    ? "clamp( srcAlpha * ( uHiveHoloAlphaBase + uHiveHoloAlphaFresnel * hiveFresnel ) * hiveLines * hiveFlicker, 0.0, 1.0 )"
    : "srcAlpha";
  return `
  ${fresnelDecl}
  float hiveLuma = clamp( dot( srcColor * uHiveHoloSrcExposure, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 );
  vec3 hiveRamp = mix( uHiveHoloBaseColor, uHiveHoloHighlightColor, pow( hiveLuma, uHiveHoloLumaGamma ) );
  vec3 hiveWorldPos = ${worldPosExpr};
  float hiveFine = 0.5 + 0.5 * sin( hiveWorldPos.y * uHiveHoloScanDensity - uHiveHoloTime * uHiveHoloScanSpeed );
  float hiveLines = mix( 1.0 - uHiveHoloScanStrength, 1.0, smoothstep( 0.25, 0.75, hiveFine ) );
  float hiveBand = smoothstep( uHiveHoloBandEdge, 1.0, sin( hiveWorldPos.y * uHiveHoloBandFreq - uHiveHoloTime * uHiveHoloBandSpeed ) ) * uHiveHoloBandIntensity;
  float hiveFlicker = 1.0 - uHiveHoloFlicker * ( 0.5 + 0.5 * sin( uHiveHoloTime * 29.0 ) ) * ( 0.5 + 0.5 * sin( uHiveHoloTime * 11.3 ) );
  vec3 hiveRgb = ( hiveRamp * ( uHiveHoloLitBase + uHiveHoloLitScale * hiveLuma )
    + hiveFresnel * uHiveHoloRimColor * uHiveHoloRimIntensity
    + hiveBand * uHiveHoloBandColor ) * hiveLines * hiveFlicker * uHiveHoloIntensity;
  float hiveAlpha = ${alphaExpr};
  return vec4( hiveRgb, hiveAlpha );`;
}

const FRESNEL_DECL = `vec3 hiveViewDir = normalize( viewPositionNeg );
  float hiveNdv = clamp( dot( normalize( fragNormal ), hiveViewDir ), 0.0, 1.0 );
  float hiveFresnel = pow( 1.0 - hiveNdv, uHiveHoloRimPower );`;

function buildMToonHologramGLSL(
  blendMode: HologramStyleConfig["blendMode"],
): { header: string; call: string } {
  const header = `${HOLO_UNIFORM_DECLS}
vec4 hiveHologram( const in vec3 srcColor, const in float srcAlpha, const in vec3 fragNormal, const in vec3 viewPositionNeg ) {
${buildHologramBodyGLSL(
    blendMode,
    FRESNEL_DECL,
    // vViewPosition = -viewSpacePos, so world = inverse(view) * vec4(-vViewPosition, 1)
    "( inverse( viewMatrix ) * vec4( -viewPositionNeg, 1.0 ) ).xyz",
  )}
}

${MAIN_ANCHOR}`;
  const call =
    "gl_FragColor = hiveHologram( col, diffuseColor.a, normal, vViewPosition );";
  return { header, call };
}

function buildBuiltinHologramGLSL(
  blendMode: HologramStyleConfig["blendMode"],
  withFresnel: boolean,
): { fragHeader: string; fragCall: string; vertHeader: string; vertAssign: string } {
  const signature = withFresnel
    ? "vec4 hiveHologram( const in vec3 srcColor, const in float srcAlpha, const in vec3 fragNormal, const in vec3 viewPositionNeg )"
    : "vec4 hiveHologram( const in vec3 srcColor, const in float srcAlpha )";
  const fresnelDecl = withFresnel ? FRESNEL_DECL : "float hiveFresnel = 0.0;";
  const fragHeader = `${HOLO_UNIFORM_DECLS}
varying vec3 vHiveHoloWorldPos;

${signature} {
${buildHologramBodyGLSL(blendMode, fresnelDecl, "vHiveHoloWorldPos")}
}

${MAIN_ANCHOR}`;
  const fragCall = withFresnel
    ? "gl_FragColor = hiveHologram( gl_FragColor.rgb, gl_FragColor.a, normal, vViewPosition );"
    : "gl_FragColor = hiveHologram( gl_FragColor.rgb, gl_FragColor.a );";
  const vertHeader = `varying vec3 vHiveHoloWorldPos;

${MAIN_ANCHOR}`;
  // Mirrors three's own worldpos_vertex chunk (which is compiled out unless
  // envmap/shadowmap/etc. defines are set, so we can't rely on it).
  const vertAssign = `{
  vec4 hiveHoloWorldPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    hiveHoloWorldPosition = batchingMatrix * hiveHoloWorldPosition;
  #endif
  #ifdef USE_INSTANCING
    hiveHoloWorldPosition = instanceMatrix * hiveHoloWorldPosition;
  #endif
  vHiveHoloWorldPos = ( modelMatrix * hiveHoloWorldPosition ).xyz;
}
${BUILTIN_VERT_ANCHOR}`;
  return { fragHeader, fragCall, vertHeader, vertAssign };
}

// Loose view of the material flags we dispatch on — three-vrm's MToonMaterial
// exposes isMToonMaterial; the built-in flags come from three (Physical also
// sets isMeshStandardMaterial, so it rides the same branch).
interface PatchableMaterial extends THREE.Material {
  isMToonMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  isMeshLambertMaterial?: boolean;
  isMeshPhongMaterial?: boolean;
  isMeshBasicMaterial?: boolean;
}

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function hologramVariantFor(mat: PatchableMaterial): HologramVariant | null {
  if (mat.isMToonMaterial === true) return "mtoon";
  if (
    mat.isMeshStandardMaterial === true ||
    mat.isMeshLambertMaterial === true ||
    mat.isMeshPhongMaterial === true
  ) {
    return "lit";
  }
  if (mat.isMeshBasicMaterial === true) return "unlit";
  return null;
}

/** Rewrite an MToon shader in place. Returns false if the anchor is absent. */
function patchMToonShader(s: ShaderLike, blendMode: HologramStyleConfig["blendMode"]): boolean {
  if (!s.fragmentShader.includes(MTOON_FRAG_ANCHOR)) return false;
  const { header, call } = buildMToonHologramGLSL(blendMode);
  s.fragmentShader = s.fragmentShader
    .replace(MAIN_ANCHOR, header)
    .replaceAll(MTOON_FRAG_ANCHOR, call);
  return true;
}

/** Rewrite a built-in material shader in place. Returns false when anchors are absent. */
function patchBuiltinShader(
  s: ShaderLike,
  blendMode: HologramStyleConfig["blendMode"],
  withFresnel: boolean,
): boolean {
  const fragAnchor = BUILTIN_FRAG_ANCHORS.find((a) => s.fragmentShader.includes(a));
  if (!fragAnchor || !s.vertexShader.includes(BUILTIN_VERT_ANCHOR)) return false;
  const { fragHeader, fragCall, vertHeader, vertAssign } =
    buildBuiltinHologramGLSL(blendMode, withFresnel);
  s.vertexShader = s.vertexShader
    .replace(MAIN_ANCHOR, vertHeader)
    .replace(BUILTIN_VERT_ANCHOR, vertAssign);
  s.fragmentShader = s.fragmentShader
    .replace(MAIN_ANCHOR, fragHeader)
    .replace(fragAnchor, `${fragCall}\n\t${fragAnchor}`);
  return true;
}

function applyHologramPatch(
  mat: PatchableMaterial,
  cfg: HologramStyleConfig,
  variant: HologramVariant,
): boolean {
  savedMaterialState.set(mat, {
    kind: "legacy",
    transparent: mat.transparent,
    depthWrite: mat.depthWrite,
    blending: mat.blending,
    onBeforeCompile: mat.onBeforeCompile,
    customProgramCacheKey: mat.customProgramCacheKey,
  });

  const previousOnBeforeCompile = mat.onBeforeCompile?.bind(mat);
  const previousCacheKey = mat.customProgramCacheKey?.bind(mat);

  mat.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    const s = shader as unknown as ShaderLike;
    if (typeof s.fragmentShader !== "string" || typeof s.vertexShader !== "string") return;
    const patched = variant === "mtoon"
      ? patchMToonShader(s, cfg.blendMode)
      : patchBuiltinShader(s, cfg.blendMode, variant === "lit");
    if (!patched) {
      logger.warn(
        `[Hologram] ${variant} shader anchor missing — hologram skipped for`,
        mat.name,
      );
      return;
    }
    for (const [name, uniformValue] of Object.entries(holoUniforms)) {
      s.uniforms[name] = uniformValue;
    }
  };
  mat.customProgramCacheKey = () => {
    const previous = previousCacheKey ? previousCacheKey() : "";
    return `${previous}|hive-character-style-hologram-v2-${variant}-${cfg.blendMode}`;
  };

  if (cfg.blendMode === "additive") {
    mat.transparent = true;
    mat.depthWrite = cfg.depthWrite;
    mat.blending = THREE.AdditiveBlending;
  }
  mat.needsUpdate = true;
  patchCount++;
  ensureClock();
  return true;
}

// ---------------------------------------------------------------------------
// Per-material apply / restore
// ---------------------------------------------------------------------------

function applyHologramToMaterial(
  mat: PatchableMaterial,
  cfg: HologramStyleConfig,
): boolean {
  if (savedMaterialState.has(mat)) return false;

  // MToon outline shells read as dark edges through the glow — hide them
  // while the style is active.
  if (OUTLINE_MATERIAL_RE.test(mat.name ?? "")) {
    savedMaterialState.set(mat, { kind: "outline", visible: mat.visible });
    mat.visible = false;
    markStyled(mat);
    return true;
  }

  const variant = hologramVariantFor(mat);
  if (!variant) return false;

  const applied = applyHologramPatch(mat, cfg, variant);
  if (applied) markStyled(mat);
  return applied;
}

function markStyled(mat: THREE.Material): void {
  mat.userData = { ...(mat.userData ?? {}), [STYLE_MARKER_KEY]: "hologram" };
}

function restoreMaterial(mat: PatchableMaterial): boolean {
  const saved = savedMaterialState.get(mat);
  if (!saved) return false;
  savedMaterialState.delete(mat);
  if (mat.userData) delete mat.userData[STYLE_MARKER_KEY];

  if (saved.kind === "outline") {
    mat.visible = saved.visible ?? true;
    return true;
  }
  mat.onBeforeCompile = saved.onBeforeCompile as THREE.Material["onBeforeCompile"];
  mat.customProgramCacheKey = saved.customProgramCacheKey as THREE.Material["customProgramCacheKey"];
  mat.transparent = saved.transparent ?? false;
  mat.depthWrite = saved.depthWrite ?? true;
  mat.blending = saved.blending ?? THREE.NormalBlending;
  mat.needsUpdate = true;
  patchCount = Math.max(0, patchCount - 1);
  return true;
}

// ---------------------------------------------------------------------------
// Object-level apply / clear
// ---------------------------------------------------------------------------

function forEachStyleMaterial(
  root: THREE.Object3D,
  fn: (mat: PatchableMaterial, obj: THREE.Object3D) => void,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) fn(mat as PatchableMaterial, obj);
  });
}

// Styled roots — kept so structural config changes (blendMode/depthWrite) can
// re-apply the style without the host having to re-call apply itself.
const styledRoots: WeakRef<THREE.Object3D>[] = [];
let currentOverrides: Partial<HologramStyleConfig> | undefined;

function liveStyledRoots(): THREE.Object3D[] {
  const live: THREE.Object3D[] = [];
  for (let i = styledRoots.length - 1; i >= 0; i--) {
    const target = styledRoots[i].deref();
    if (target) live.push(target);
    else styledRoots.splice(i, 1);
  }
  return live;
}

function forgetStyledRoot(root: THREE.Object3D): void {
  for (let i = styledRoots.length - 1; i >= 0; i--) {
    const target = styledRoots[i].deref();
    if (!target || target === root) styledRoots.splice(i, 1);
  }
}

/** The config the hologram is currently running with (defaults + overrides). */
export function getEffectiveHologramConfig(): HologramStyleConfig {
  return { ...HOLOGRAM_DEFAULTS, ...currentOverrides };
}

/**
 * Apply (or clear, with style 'none') the hologram character style to every
 * supported material under `root` (MToon, MeshStandard/Physical/Lambert/
 * Phong, MeshBasic). Returns how many materials were styled and how many were
 * skipped (unsupported material classes, e.g. ShaderMaterial).
 */
export function applyCharacterStyleToObject(
  root: THREE.Object3D,
  style: CharacterStyleId,
  overrides?: Partial<HologramStyleConfig>,
): { applied: number; skipped: number } {
  clearCharacterStyleFromObject(root);
  if (style === "none") return { applied: 0, skipped: 0 };

  currentOverrides = overrides ?? currentOverrides;
  const cfg: HologramStyleConfig = { ...HOLOGRAM_DEFAULTS, ...currentOverrides };
  syncHologramUniformValues(cfg);
  let applied = 0;
  let skipped = 0;
  forEachStyleMaterial(root, (mat, obj) => {
    if (!mat) return;
    if (applyHologramToMaterial(mat, cfg)) {
      applied++;
    } else {
      skipped++;
    }
    // Holograms don't cast shadows.
    if (!savedMeshState.has(obj)) {
      savedMeshState.set(obj, { castShadow: obj.castShadow });
      obj.castShadow = false;
    }
  });
  root.userData.__hiveCharacterStyle = style;
  if (!liveStyledRoots().includes(root)) styledRoots.push(new WeakRef(root));
  if (skipped > 0) {
    logger.warn(
      `[Hologram] styled ${applied} materials, ${skipped} unsupported (not MToon/Standard/Physical/Lambert/Phong/Basic)`,
    );
  }
  return { applied, skipped };
}

/** Restore every material and mesh under `root` to its pre-style state. */
export function clearCharacterStyleFromObject(root: THREE.Object3D): void {
  forEachStyleMaterial(root, (mat, obj) => {
    if (mat) restoreMaterial(mat);
    const meshSaved = savedMeshState.get(obj);
    if (meshSaved) {
      obj.castShadow = meshSaved.castShadow;
      savedMeshState.delete(obj);
    }
  });
  delete root.userData.__hiveCharacterStyle;
  forgetStyledRoot(root);
}

/**
 * Live-tune the active hologram. Numeric/colour keys update shared uniforms
 * instantly (no shader rebuild); structural keys (blendMode, depthWrite)
 * trigger a full re-apply on every styled root.
 */
export function updateHologramConfig(
  partial: Partial<HologramStyleConfig>,
): HologramStyleConfig {
  currentOverrides = { ...currentOverrides, ...partial };
  const cfg = getEffectiveHologramConfig();
  const structural = STRUCTURAL_KEYS.some((key) => key in partial);
  if (structural) {
    for (const root of liveStyledRoots()) {
      applyCharacterStyleToObject(root, "hologram", currentOverrides);
    }
  } else {
    syncHologramUniformValues(cfg);
  }
  return cfg;
}
