"use client";

// Full-screen 3D neuron/synapse renderer for the Shared Brain hive-vault view.
// Self-contained imperative three.js engine (same pattern as the companion
// engine): nodes render as glowing soma spheres with dendrite halos, links as
// curved axons with GPU-animated synaptic pulses. Colors come from the
// vault panel's --brain-* tokens so dark and hive-light both work, and the
// engine pauses/settles instead of burning frames (reduced motion honored,
// rAF stops with the tab, everything is disposed on unmount).

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type SynapseNodeTone = "plain" | "recent" | "touched" | "stale" | "unresolved";

export type SynapseNodeInput = {
  id: string;
  label: string;
  meta: string;
  weight: number; // 0..1 importance; drives radius + glow
  tone: SynapseNodeTone;
};

export type SynapseLinkInput = { source: string; target: string };

type SynapseCanvasProps = {
  className?: string;
  contextIds: string[];
  labelClassName?: string;
  links: SynapseLinkInput[];
  neighborIds: string[];
  nodes: SynapseNodeInput[];
  onNodeClick?: (id: string) => void;
  onNodeHover?: (id: string | null) => void;
  selectedId: string | null;
};

const WORLD_RADIUS = 150;
const EDGE_SEGMENTS = 10;
const MAX_PULSED_EDGES = 480;
const PULSES_PER_EDGE = 2;
const MAX_LABELS = 42;
const DUST_COUNT = 260;
const PRE_TICKS = 110;

function hashUnit(value: string, salt = 0) {
  let hash = 2166136261 + salt;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type SimNode = {
  drift: number;
  id: string;
  label: string;
  meta: string;
  radius: number;
  tone: SynapseNodeTone;
  vx: number;
  vy: number;
  vz: number;
  weight: number;
  x: number;
  y: number;
  z: number;
};

type SimEdge = {
  bowAmount: number;
  bowSeed: THREE.Vector3;
  seed: number;
  sourceIndex: number;
  targetIndex: number;
};

type Palette = {
  bg: THREE.Color;
  danger: THREE.Color;
  fg: THREE.Color;
  fg2: THREE.Color;
  honey: THREE.Color;
  light: boolean;
  live: THREE.Color;
};

function readPalette(element: HTMLElement): Palette {
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

// White-on-transparent 2x2 atlas of dendritic soma halos; tinted per node in
// the halo shader so one texture serves every tone and theme.
function makeDendriteAtlas(): THREE.CanvasTexture {
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

function makeDotTexture(): THREE.CanvasTexture {
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

const SOMA_VERTEX = /* glsl */ `
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

const SOMA_FRAGMENT = /* glsl */ `
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
    vec3 body = vTint * (0.46 + 0.55 * vGlow + 0.14 * breathe * uMotion * vGlow);
    vec3 col = body + vTint * fres * (0.6 + 0.7 * vGlow);
    col = mix(col, uBg, vDim * 0.62);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const HALO_VERTEX = /* glsl */ `
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

const HALO_FRAGMENT = /* glsl */ `
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

const EDGE_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aLit;
  attribute float aSeed;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vDist;
  void main() {
    vT = aT;
    vLit = aLit;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const EDGE_FRAGMENT = /* glsl */ `
  uniform vec3 uEdge;
  uniform vec3 uLit;
  uniform vec3 uBg;
  uniform float uTime;
  uniform float uMotion;
  uniform float uEdgeAlpha;
  uniform float uSelDim;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vT;
  varying float vLit;
  varying float vSeed;
  varying float vDist;
  void main() {
    vec3 col = mix(uEdge, uLit, vLit);
    float shimmer = 0.78 + 0.22 * sin(vT * 17.0 - uTime * uMotion * (1.1 + vSeed * 1.6) + vSeed * 6.2831);
    float a = uEdgeAlpha * (0.55 + 0.85 * vLit) * shimmer;
    a *= mix(uSelDim, 1.0, vLit);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uBg, fog * 0.6);
    a *= 1.0 - fog * 0.85;
    gl_FragColor = vec4(col, a);
  }
`;

const PULSE_VERTEX = /* glsl */ `
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

const PULSE_FRAGMENT = /* glsl */ `
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

const DUST_VERTEX = /* glsl */ `
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

const DUST_FRAGMENT = /* glsl */ `
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

type EngineOptions = {
  labelClassName?: string;
  onNodeClick: (id: string) => void;
  onNodeHover: (id: string | null) => void;
};

class SynapseEngine {
  private alpha = 0;
  private animationFrame = 0;
  private camera: THREE.PerspectiveCamera;
  private cameraRadius = WORLD_RADIUS * 3.2;
  private cameraRadiusTarget = WORLD_RADIUS * 2.3;
  private lastFrameAt = 0;
  private container: HTMLElement;
  private contextIds = new Set<string>();
  private dataSignature = "";
  private destroyed = false;
  private drag: { id: number; lastX: number; lastY: number; moved: number; startX: number; startY: number } | null = null;
  private dust: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private edges: SimEdge[] = [];
  private fitRadius = WORLD_RADIUS;
  private hoveredId: string | null = null;
  private idleSeconds = 0;
  private labelLayer: HTMLDivElement;
  private labelPool: Array<{ meta: HTMLElement; root: HTMLDivElement; title: HTMLElement }> = [];
  private labeledIndices: number[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private neighborIds = new Set<string>();
  private nodeIndexById = new Map<string, number>();
  private nodes: SimNode[] = [];
  private options: EngineOptions;
  private palette: Palette;
  private phi = 1.18;
  private phiTarget = 1.18;
  private pointer = { down: false, inside: false, x: 0, y: 0 };
  private pulsePoints: THREE.Points | null = null;
  private reducedMotion = false;
  private reducedMotionQuery: MediaQueryList | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private selectedId: string | null = null;
  private soma: THREE.InstancedMesh | null = null;
  private texAtlas: THREE.CanvasTexture;
  private texDot: THREE.CanvasTexture;
  private theta = 0.55;
  private themeObserver: MutationObserver | null = null;
  private thetaTarget = 0.55;
  private time = 0;
  private tmpColor = new THREE.Color();
  private tmpMatrix = new THREE.Matrix4();
  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();
  private tmpVecC = new THREE.Vector3();
  private tmpVecD = new THREE.Vector3();
  private resizeObserver: ResizeObserver | null = null;
  private onVisibility = () => {
    // Drop the accumulated hidden-time so the first visible frame doesn't jump.
    if (!document.hidden) this.lastFrameAt = performance.now();
  };

  constructor(container: HTMLElement, options: EngineOptions) {
    this.container = container;
    this.options = options;
    this.palette = readPalette(container);
    this.texAtlas = makeDendriteAtlas();
    this.texDot = makeDotTexture();

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(this.palette.bg, 1);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.opacity = "0";
      renderer.domElement.style.transition = "opacity 480ms ease";
      container.appendChild(renderer.domElement);
      requestAnimationFrame(() => {
        renderer.domElement.style.opacity = "1";
      });
    }

    this.labelLayer = document.createElement("div");
    this.labelLayer.style.position = "absolute";
    this.labelLayer.style.inset = "0";
    this.labelLayer.style.overflow = "hidden";
    this.labelLayer.style.pointerEvents = "none";
    container.appendChild(this.labelLayer);

    this.buildDust();

    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener("change", this.onReducedMotion);

    this.themeObserver = new MutationObserver(() => this.applyPalette());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    if (process.env.NODE_ENV !== "production") {
      (globalThis as { __brainSynapseEngine?: unknown }).__brainSynapseEngine = this;
    }

    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerup", this.onPointerUp);
    container.addEventListener("pointercancel", this.onPointerUp);
    container.addEventListener("pointerleave", this.onPointerLeave);
    container.addEventListener("dblclick", this.onDoubleClick);
    container.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("visibilitychange", this.onVisibility);

    this.animationFrame = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerup", this.onPointerUp);
    this.container.removeEventListener("pointercancel", this.onPointerUp);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    this.container.removeEventListener("dblclick", this.onDoubleClick);
    this.container.removeEventListener("wheel", this.onWheel);
    this.reducedMotionQuery?.removeEventListener("change", this.onReducedMotion);
    this.themeObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.disposeGraphObjects();
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
      this.dust = null;
    }
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.texAtlas.dispose();
    this.texDot.dispose();
    this.labelLayer.remove();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }

  setData(inputNodes: SynapseNodeInput[], inputLinks: SynapseLinkInput[]) {
    const seenLinks = new Set<string>();
    const nodeIds = new Set(inputNodes.map((node) => node.id));
    const links = inputLinks.filter((link) => {
      if (!nodeIds.has(link.source) || !nodeIds.has(link.target) || link.source === link.target) return false;
      const key = link.source < link.target ? `${link.source} ${link.target}` : `${link.target} ${link.source}`;
      if (seenLinks.has(key)) return false;
      seenLinks.add(key);
      return true;
    });
    const signature = `${inputNodes.map((node) => node.id).join("|")}#${links.map((link) => `${link.source}>${link.target}`).join("|")}`;
    const topologyChanged = signature !== this.dataSignature;
    this.dataSignature = signature;

    const previousById = new Map(this.nodes.map((node) => [node.id, node]));
    const firstBuild = this.nodes.length === 0;
    let added = 0;
    this.nodes = inputNodes.map((input) => {
      const existing = previousById.get(input.id);
      const radius = 3.7 + clamp(input.weight, 0, 1) * 7.2;
      if (existing) {
        existing.label = input.label;
        existing.meta = input.meta;
        existing.tone = input.tone;
        existing.weight = input.weight;
        existing.radius = radius;
        return existing;
      }
      added += 1;
      const u = hashUnit(input.id, 3) * 2 - 1;
      const angle = hashUnit(input.id, 7) * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0.0001, 1 - u * u));
      const spread = WORLD_RADIUS * (0.55 + hashUnit(input.id, 11) * 0.45) * (1 - 0.35 * clamp(input.weight, 0, 1));
      return {
        id: input.id,
        label: input.label,
        meta: input.meta,
        tone: input.tone,
        weight: input.weight,
        radius,
        drift: hashUnit(input.id, 19),
        x: Math.cos(angle) * ring * spread,
        y: u * spread * 0.72,
        z: Math.sin(angle) * ring * spread * 0.8,
        vx: 0,
        vy: 0,
        vz: 0,
      };
    });
    this.nodeIndexById = new Map(this.nodes.map((node, index) => [node.id, index]));

    // Spawn brand-new nodes next to a linked survivor so they grow out of the
    // existing tissue instead of teleporting in from the seed sphere.
    if (!firstBuild && added) {
      for (const link of links) {
        const source = this.nodes[this.nodeIndexById.get(link.source) ?? -1];
        const target = this.nodes[this.nodeIndexById.get(link.target) ?? -1];
        if (!source || !target) continue;
        const sourceNew = !previousById.has(source.id);
        const targetNew = !previousById.has(target.id);
        if (sourceNew === targetNew) continue;
        const anchor = sourceNew ? target : source;
        const fresh = sourceNew ? source : target;
        fresh.x = anchor.x + (hashUnit(fresh.id, 23) - 0.5) * 34;
        fresh.y = anchor.y + (hashUnit(fresh.id, 29) - 0.5) * 34;
        fresh.z = anchor.z + (hashUnit(fresh.id, 31) - 0.5) * 34;
      }
    }

    this.edges = links.map((link) => {
      const seed = hashUnit(`${link.source}->${link.target}`, 5);
      const bowSeed = new THREE.Vector3(
        hashUnit(link.source + link.target, 41) - 0.5,
        hashUnit(link.source + link.target, 43) - 0.5,
        hashUnit(link.source + link.target, 47) - 0.5,
      ).normalize();
      return {
        seed,
        bowSeed,
        bowAmount: 6 + seed * 16,
        sourceIndex: this.nodeIndexById.get(link.source) ?? 0,
        targetIndex: this.nodeIndexById.get(link.target) ?? 0,
      };
    });

    if (!topologyChanged) {
      this.applyNodeVisuals();
      this.refreshLabelSet();
      return;
    }

    if (firstBuild) {
      this.alpha = 1;
      for (let i = 0; i < PRE_TICKS; i += 1) this.simTick();
      this.fitRadius = this.computeCloudRadius();
      this.cameraRadiusTarget = clamp(this.fitRadius * 2.05, 150, 560);
      this.cameraRadius = this.cameraRadiusTarget * 1.35;
      this.alpha = 0.28;
    } else {
      this.alpha = clamp(0.3 + added * 0.04, 0.3, 0.85);
    }

    this.rebuildGraphObjects();
    this.applyNodeVisuals();
    this.applyEdgeVisuals();
    this.refreshLabelSet();
  }

  setSelection(selectedId: string | null, neighborIds: string[], contextIds: string[]) {
    this.selectedId = selectedId;
    this.neighborIds = new Set(neighborIds);
    this.contextIds = new Set(contextIds);
    this.applyNodeVisuals();
    this.applyEdgeVisuals();
    this.refreshLabelSet();
  }

  private onReducedMotion = () => {
    this.reducedMotion = Boolean(this.reducedMotionQuery?.matches);
    for (const material of this.materials) {
      if (material.uniforms.uMotion) material.uniforms.uMotion.value = this.reducedMotion ? 0 : 1;
    }
  };

  private applyPalette() {
    if (this.destroyed) return;
    this.palette = readPalette(this.container);
    this.renderer?.setClearColor(this.palette.bg, 1);
    const additive = this.palette.light ? 0 : 1;
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      if (uniforms.uBg) (uniforms.uBg.value as THREE.Color).copy(this.palette.bg);
      if (uniforms.uAdditive) uniforms.uAdditive.value = additive;
      if (uniforms.uEdge) (uniforms.uEdge.value as THREE.Color).copy(this.palette.fg2).lerp(this.palette.bg, this.palette.light ? 0.15 : 0.35);
      if (uniforms.uLit) (uniforms.uLit.value as THREE.Color).copy(this.palette.honey);
      if (uniforms.uEdgeAlpha) uniforms.uEdgeAlpha.value = this.palette.light ? 0.36 : 0.3;
      if (uniforms.uTint) (uniforms.uTint.value as THREE.Color).copy(this.palette.live);
      if (material.blending !== THREE.NoBlending) {
        material.blending = this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending;
        material.needsUpdate = true;
      }
    }
    if (this.soma) {
      const somaMaterial = this.soma.material as THREE.ShaderMaterial;
      somaMaterial.blending = THREE.NoBlending;
      somaMaterial.needsUpdate = true;
    }
    this.applyNodeVisuals();
  }

  private toneColor(tone: SynapseNodeTone, target: THREE.Color) {
    const palette = this.palette;
    if (tone === "touched") return target.copy(palette.honey);
    if (tone === "recent") return target.copy(palette.live);
    if (tone === "unresolved") return target.copy(palette.danger);
    if (tone === "stale") return target.copy(palette.honey).lerp(palette.fg2, 0.55);
    return target.copy(palette.fg2).lerp(palette.fg, 0.55);
  }

  private toneGlow(tone: SynapseNodeTone) {
    if (tone === "touched") return 0.58;
    if (tone === "recent") return 0.48;
    if (tone === "unresolved") return 0.44;
    if (tone === "stale") return 0.34;
    return 0.32;
  }

  private applyNodeVisuals() {
    if (!this.soma) return;
    const tintAttr = this.soma.geometry.getAttribute("iTint") as THREE.InstancedBufferAttribute;
    const glowAttr = this.soma.geometry.getAttribute("iGlow") as THREE.InstancedBufferAttribute;
    const dimAttr = this.soma.geometry.getAttribute("iDim") as THREE.InstancedBufferAttribute;
    const haloGeo = this.haloMesh?.geometry as THREE.InstancedBufferGeometry | undefined;
    const haloTint = haloGeo?.getAttribute("iTint") as THREE.InstancedBufferAttribute | undefined;
    const haloAlpha = haloGeo?.getAttribute("iAlpha") as THREE.InstancedBufferAttribute | undefined;
    // Only dim the rest of the tissue when the selection actually has a
    // neighborhood to spotlight; an orphan selection would just black out the map.
    const hasSelection = Boolean(this.selectedId) && this.neighborIds.size > 0;
    this.nodes.forEach((node, index) => {
      const selected = node.id === this.selectedId;
      const neighbor = this.neighborIds.has(node.id);
      const inContext = this.contextIds.has(node.id);
      this.toneColor(node.tone, this.tmpColor);
      if (inContext) this.tmpColor.lerp(this.palette.live, 0.5);
      if (selected) this.tmpColor.lerp(this.palette.honey, 0.65);
      let glow = this.toneGlow(node.tone) + node.weight * 0.2;
      if (inContext) glow = Math.max(glow, 0.55);
      if (neighbor) glow += 0.14;
      if (selected) glow = 1;
      if (node.id === this.hoveredId) glow = Math.min(1, glow + 0.22);
      const dim = hasSelection && !selected && !neighbor && !inContext ? 1 : 0;
      tintAttr.setXYZ(index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      glowAttr.setX(index, clamp(glow, 0, 1));
      dimAttr.setX(index, dim);
      if (haloTint && haloAlpha) {
        haloTint.setXYZ(index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
        const baseAlpha = this.palette.light ? 0.42 : 0.62;
        haloAlpha.setX(index, (baseAlpha + glow * 0.5) * (dim ? 0.2 : 1));
      }
    });
    tintAttr.needsUpdate = true;
    glowAttr.needsUpdate = true;
    dimAttr.needsUpdate = true;
    if (haloTint) haloTint.needsUpdate = true;
    if (haloAlpha) haloAlpha.needsUpdate = true;
  }

  private applyEdgeVisuals() {
    if (!this.edgeLines) return;
    const litAttr = this.edgeLines.geometry.getAttribute("aLit") as THREE.BufferAttribute;
    const pulseGeo = this.pulsePoints?.geometry;
    const pulseLit = pulseGeo?.getAttribute("aLit") as THREE.BufferAttribute | undefined;
    const pulseTint = pulseGeo?.getAttribute("aTint") as THREE.BufferAttribute | undefined;
    const pulseSize = pulseGeo?.getAttribute("aSize") as THREE.BufferAttribute | undefined;
    const vertsPerEdge = EDGE_SEGMENTS * 2;
    this.edges.forEach((edge, edgeIndex) => {
      const source = this.nodes[edge.sourceIndex];
      const target = this.nodes[edge.targetIndex];
      const lit = this.selectedId !== null && (source.id === this.selectedId || target.id === this.selectedId) ? 1 : 0;
      for (let v = 0; v < vertsPerEdge; v += 1) litAttr.setX(edgeIndex * vertsPerEdge + v, lit);
      if (pulseLit && pulseTint && pulseSize && edgeIndex < MAX_PULSED_EDGES) {
        this.tmpColor.copy(lit ? this.palette.honey : this.palette.live);
        for (let p = 0; p < PULSES_PER_EDGE; p += 1) {
          const slot = edgeIndex * PULSES_PER_EDGE + p;
          pulseLit.setX(slot, lit);
          pulseTint.setXYZ(slot, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
          // Extra pulses per axon only fire while the synapse is lit.
          pulseSize.setX(slot, p === 0 || lit ? 30 + hashUnit(`pulse-${edgeIndex}-${p}`, 13) * 26 : 0);
        }
      }
    });
    litAttr.needsUpdate = true;
    if (pulseLit) pulseLit.needsUpdate = true;
    if (pulseTint) pulseTint.needsUpdate = true;
    if (pulseSize) pulseSize.needsUpdate = true;
    const uniforms = (this.edgeLines.material as THREE.ShaderMaterial).uniforms;
    const dimUnlit = this.selectedId && this.neighborIds.size > 0;
    uniforms.uSelDim.value = dimUnlit ? 0.32 : 1;
    if (this.pulsePoints) {
      (this.pulsePoints.material as THREE.ShaderMaterial).uniforms.uSelDim.value = dimUnlit ? 0.35 : 1;
    }
  }

  private haloMesh: THREE.Mesh | null = null;

  private disposeGraphObjects() {
    for (const object of [this.soma, this.haloMesh, this.edgeLines, this.pulsePoints] as Array<THREE.Object3D | null>) {
      if (!object) continue;
      this.scene.remove(object);
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this.soma = null;
    this.haloMesh = null;
    this.edgeLines = null;
    this.pulsePoints = null;
  }

  private sharedUniforms() {
    return {
      uTime: { value: 0 },
      uMotion: { value: this.reducedMotion ? 0 : 1 },
      uBg: { value: this.palette.bg.clone() },
      uFogNear: { value: this.cameraRadiusTarget * 0.7 },
      uFogFar: { value: this.cameraRadiusTarget * 2.4 },
      uScale: { value: 600 },
      uAdditive: { value: this.palette.light ? 0 : 1 },
      uSelDim: { value: 1 },
    };
  }

  private registerMaterial(material: THREE.ShaderMaterial) {
    this.materials.push(material);
    return material;
  }

  private buildDust() {
    const positions = new Float32Array(DUST_COUNT * 3);
    const sizes = new Float32Array(DUST_COUNT);
    const seeds = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const u = hashUnit(`dust-${i}`, 3) * 2 - 1;
      const angle = hashUnit(`dust-${i}`, 5) * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0.0001, 1 - u * u));
      const spread = WORLD_RADIUS * (0.7 + hashUnit(`dust-${i}`, 9) * 1.5);
      positions[i * 3] = Math.cos(angle) * ring * spread;
      positions[i * 3 + 1] = u * spread * 0.8;
      positions[i * 3 + 2] = Math.sin(angle) * ring * spread;
      sizes[i] = 1.4 + hashUnit(`dust-${i}`, 13) * 3.2;
      seeds[i] = hashUnit(`dust-${i}`, 17);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const material = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: { ...this.sharedUniforms(), uMap: { value: this.texDot }, uTint: { value: this.palette.live.clone() } },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending,
    }));
    this.dust = new THREE.Points(geometry, material);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  private rebuildGraphObjects() {
    this.disposeGraphObjects();
    const count = this.nodes.length;
    if (!count) return;

    // Soma spheres (instanced, opaque, fresnel-lit).
    const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
    sphereGeometry.setAttribute("iTint", new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
    sphereGeometry.setAttribute("iGlow", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    sphereGeometry.setAttribute("iDim", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    const somaSeeds = new Float32Array(count);
    this.nodes.forEach((node, index) => {
      somaSeeds[index] = node.drift;
    });
    sphereGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(somaSeeds, 1));
    const somaMaterial = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: this.sharedUniforms(),
      vertexShader: SOMA_VERTEX,
      fragmentShader: SOMA_FRAGMENT,
      blending: THREE.NoBlending,
    }));
    this.soma = new THREE.InstancedMesh(sphereGeometry, somaMaterial, count);
    this.soma.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.soma.frustumCulled = false;
    this.scene.add(this.soma);

    // Dendrite halos (instanced billboards over the soma).
    const plane = new THREE.PlaneGeometry(2, 2);
    const haloGeometry = new THREE.InstancedBufferGeometry();
    haloGeometry.index = plane.index;
    haloGeometry.setAttribute("position", plane.getAttribute("position"));
    haloGeometry.setAttribute("uv", plane.getAttribute("uv"));
    haloGeometry.instanceCount = count;
    const haloPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    haloPos.setUsage(THREE.DynamicDrawUsage);
    haloGeometry.setAttribute("iPos", haloPos);
    const haloScales = new Float32Array(count);
    const haloSeeds = new Float32Array(count);
    this.nodes.forEach((node, index) => {
      haloScales[index] = node.radius * 5.4;
      haloSeeds[index] = hashUnit(node.id, 53);
    });
    haloGeometry.setAttribute("iScale", new THREE.InstancedBufferAttribute(haloScales, 1));
    haloGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(haloSeeds, 1));
    haloGeometry.setAttribute("iTint", new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
    haloGeometry.setAttribute("iAlpha", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    const haloMaterial = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: { ...this.sharedUniforms(), uMap: { value: this.texAtlas } },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending,
    }));
    this.haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
    this.haloMesh.frustumCulled = false;
    this.scene.add(this.haloMesh);

    // Axon curves.
    const edgeCount = this.edges.length;
    if (edgeCount) {
      const vertsPerEdge = EDGE_SEGMENTS * 2;
      const positions = new Float32Array(edgeCount * vertsPerEdge * 3);
      const ts = new Float32Array(edgeCount * vertsPerEdge);
      const lit = new Float32Array(edgeCount * vertsPerEdge);
      const seeds = new Float32Array(edgeCount * vertsPerEdge);
      this.edges.forEach((edge, edgeIndex) => {
        for (let s = 0; s < EDGE_SEGMENTS; s += 1) {
          const base = edgeIndex * vertsPerEdge + s * 2;
          ts[base] = s / EDGE_SEGMENTS;
          ts[base + 1] = (s + 1) / EDGE_SEGMENTS;
          seeds[base] = edge.seed;
          seeds[base + 1] = edge.seed;
        }
      });
      const edgeGeometry = new THREE.BufferGeometry();
      const positionAttr = new THREE.BufferAttribute(positions, 3);
      positionAttr.setUsage(THREE.DynamicDrawUsage);
      edgeGeometry.setAttribute("position", positionAttr);
      edgeGeometry.setAttribute("aT", new THREE.BufferAttribute(ts, 1));
      edgeGeometry.setAttribute("aLit", new THREE.BufferAttribute(lit, 1));
      edgeGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      const edgeMaterial = this.registerMaterial(new THREE.ShaderMaterial({
        uniforms: {
          ...this.sharedUniforms(),
          uEdge: { value: this.palette.fg2.clone().lerp(this.palette.bg, this.palette.light ? 0.15 : 0.35) },
          uLit: { value: this.palette.honey.clone() },
          uEdgeAlpha: { value: this.palette.light ? 0.36 : 0.3 },
        },
        vertexShader: EDGE_VERTEX,
        fragmentShader: EDGE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      }));
      this.edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      this.edgeLines.frustumCulled = false;
      this.scene.add(this.edgeLines);

      // Synaptic pulses travelling the axons.
      const pulsedEdges = Math.min(edgeCount, MAX_PULSED_EDGES);
      const pulseCount = pulsedEdges * PULSES_PER_EDGE;
      const pulseGeometry = new THREE.BufferGeometry();
      const mk = (itemSize: number) => {
        const attribute = new THREE.BufferAttribute(new Float32Array(pulseCount * itemSize), itemSize);
        attribute.setUsage(THREE.DynamicDrawUsage);
        return attribute;
      };
      pulseGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pulseCount * 3), 3));
      pulseGeometry.setAttribute("aStart", mk(3));
      pulseGeometry.setAttribute("aCtrl", mk(3));
      pulseGeometry.setAttribute("aEnd", mk(3));
      const phases = new Float32Array(pulseCount);
      const speeds = new Float32Array(pulseCount);
      const sizes = new Float32Array(pulseCount);
      for (let e = 0; e < pulsedEdges; e += 1) {
        for (let p = 0; p < PULSES_PER_EDGE; p += 1) {
          const slot = e * PULSES_PER_EDGE + p;
          phases[slot] = hashUnit(`pulse-${e}-${p}`, 7) + p * 0.5;
          speeds[slot] = 0.06 + hashUnit(`pulse-${e}-${p}`, 11) * 0.12;
          sizes[slot] = p === 0 ? 30 + hashUnit(`pulse-${e}-${p}`, 13) * 26 : 0;
        }
      }
      pulseGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
      pulseGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
      const sizeAttr = new THREE.BufferAttribute(sizes, 1);
      sizeAttr.setUsage(THREE.DynamicDrawUsage);
      pulseGeometry.setAttribute("aSize", sizeAttr);
      pulseGeometry.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(pulseCount * 3), 3));
      pulseGeometry.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(pulseCount), 1));
      const pulseMaterial = this.registerMaterial(new THREE.ShaderMaterial({
        uniforms: { ...this.sharedUniforms(), uMap: { value: this.texDot } },
        vertexShader: PULSE_VERTEX,
        fragmentShader: PULSE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      }));
      this.pulsePoints = new THREE.Points(pulseGeometry, pulseMaterial);
      this.pulsePoints.frustumCulled = false;
      this.scene.add(this.pulsePoints);
    }
  }

  private computeCloudRadius() {
    let max = 40;
    for (const node of this.nodes) {
      const distance = Math.sqrt(node.x * node.x + node.y * node.y + node.z * node.z);
      if (distance > max) max = distance;
    }
    return max;
  }

  private simTick() {
    const nodes = this.nodes;
    const alpha = this.alpha;
    const count = nodes.length;
    for (let i = 0; i < count; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < count; j += 1) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 1) {
          dx = (hashUnit(a.id + b.id, 3) - 0.5) * 2;
          dy = (hashUnit(a.id + b.id, 5) - 0.5) * 2;
          dz = (hashUnit(a.id + b.id, 7) - 0.5) * 2;
          distSq = dx * dx + dy * dy + dz * dz;
        }
        const dist = Math.sqrt(distSq);
        const force = Math.min(2.6, (1900 * alpha) / distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        a.vx += fx; a.vy += fy; a.vz += fz;
        b.vx -= fx; b.vy -= fy; b.vz -= fz;
      }
    }
    for (const edge of this.edges) {
      const a = nodes[edge.sourceIndex];
      const b = nodes[edge.targetIndex];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const rest = 42 + (a.radius + b.radius) * 1.7;
      const force = ((dist - rest) / dist) * 0.055 * alpha;
      const fx = dx * force;
      const fy = dy * force;
      const fz = dz * force;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    }
    for (const node of nodes) {
      node.vx -= node.x * 0.012 * alpha;
      node.vy -= node.y * 0.016 * alpha;
      node.vz -= node.z * 0.014 * alpha;
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.vz *= 0.86;
      node.x += clamp(node.vx, -14, 14);
      node.y += clamp(node.vy, -14, 14);
      node.z += clamp(node.vz, -14, 14);
    }
  }

  private displayPosition(node: SimNode, target: THREE.Vector3) {
    if (this.reducedMotion) return target.set(node.x, node.y, node.z);
    const t = this.time;
    const seed = node.drift * 6.2831;
    return target.set(
      node.x + Math.sin(t * 0.5 + seed) * 1.7,
      node.y + Math.sin(t * 0.42 + seed * 2.1) * 1.7,
      node.z + Math.cos(t * 0.36 + seed * 1.3) * 1.7,
    );
  }

  private refreshLabelSet() {
    const scored = this.nodes
      .map((node, index) => {
        let score = node.weight;
        if (node.id === this.selectedId) score += 10;
        else if (this.neighborIds.has(node.id)) score += 4;
        if (this.contextIds.has(node.id)) score += 3;
        if (node.id === this.hoveredId) score += 8;
        return { index, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_LABELS);
    this.labeledIndices = scored.map((item) => item.index);
    while (this.labelPool.length < Math.min(MAX_LABELS, this.nodes.length)) {
      const root = document.createElement("div");
      if (this.options.labelClassName) root.className = this.options.labelClassName;
      root.style.position = "absolute";
      root.style.left = "0";
      root.style.top = "0";
      root.style.display = "none";
      const title = document.createElement("strong");
      const meta = document.createElement("small");
      root.appendChild(title);
      root.appendChild(meta);
      this.labelLayer.appendChild(root);
      this.labelPool.push({ root, title, meta });
    }
    this.labelPool.forEach((label, poolIndex) => {
      const nodeIndex = this.labeledIndices[poolIndex];
      if (nodeIndex === undefined) {
        label.root.style.display = "none";
        return;
      }
      const node = this.nodes[nodeIndex];
      label.title.textContent = node.label;
      label.meta.textContent = node.meta;
      const state = node.id === this.selectedId
        ? "selected"
        : this.neighborIds.has(node.id)
          ? "neighbor"
          : this.contextIds.has(node.id) ? "context" : "plain";
      label.root.dataset.state = state;
    });
  }

  private updateLabels() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    const hasSelection = Boolean(this.selectedId) && this.neighborIds.size > 0;
    this.labelPool.forEach((label, poolIndex) => {
      const nodeIndex = this.labeledIndices[poolIndex];
      if (nodeIndex === undefined) return;
      const node = this.nodes[nodeIndex];
      this.displayPosition(node, this.tmpVecA);
      this.tmpVecA.project(this.camera);
      if (this.tmpVecA.z > 1 || this.tmpVecA.z < -1) {
        label.root.style.display = "none";
        return;
      }
      const x = (this.tmpVecA.x * 0.5 + 0.5) * width;
      const y = (-this.tmpVecA.y * 0.5 + 0.5) * height;
      if (x < -80 || x > width + 80 || y < -60 || y > height + 60) {
        label.root.style.display = "none";
        return;
      }
      const depth = clamp((this.tmpVecA.z + 1) / 2, 0, 1);
      const focus = node.id === this.selectedId || this.neighborIds.has(node.id) || this.contextIds.has(node.id) || node.id === this.hoveredId;
      let opacity = clamp(1.25 - depth * 1.1, 0.2, 1);
      if (hasSelection && !focus) opacity *= 0.3;
      const offset = node.radius * (this.container.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360)))
        / Math.max(this.tmpVecB.copy(this.camera.position).distanceTo(this.tmpVecA.set(node.x, node.y, node.z)), 1);
      label.root.style.display = "block";
      label.root.style.opacity = opacity.toFixed(3);
      label.root.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + offset + 6).toFixed(1)}px, 0) translateX(-50%)`;
    });
  }

  private pickNode(clientX: number, clientY: number): string | null {
    const rect = this.container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return null;
    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    const focalPx = height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const node of this.nodes) {
      this.displayPosition(node, this.tmpVecA);
      const worldDist = this.tmpVecB.copy(this.camera.position).distanceTo(this.tmpVecA);
      this.tmpVecA.project(this.camera);
      if (this.tmpVecA.z > 1 || this.tmpVecA.z < -1) continue;
      const x = (this.tmpVecA.x * 0.5 + 0.5) * width;
      const y = (-this.tmpVecA.y * 0.5 + 0.5) * height;
      const radiusPx = Math.max(9, (node.radius * focalPx) / Math.max(worldDist, 1));
      const dist = Math.hypot(x - px, y - py);
      if (dist <= radiusPx * 1.35 + 6 && dist < bestDist) {
        bestDist = dist;
        bestId = node.id;
      }
    }
    return bestId;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.idleSeconds = 0;
    this.drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: 0 };
    this.pointer.down = true;
    this.container.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    this.pointer.inside = true;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    if (!this.drag || this.drag.id !== event.pointerId) return;
    this.idleSeconds = 0;
    const dx = event.clientX - this.drag.lastX;
    const dy = event.clientY - this.drag.lastY;
    this.drag.lastX = event.clientX;
    this.drag.lastY = event.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    this.thetaTarget -= dx * 0.0052;
    this.phiTarget = clamp(this.phiTarget - dy * 0.0042, 0.24, Math.PI - 0.24);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.pointer.down = false;
    this.container.releasePointerCapture?.(event.pointerId);
    if (moved < 5) {
      const id = this.pickNode(event.clientX, event.clientY);
      if (id) this.options.onNodeClick(id);
    }
  };

  private onPointerLeave = () => {
    this.pointer.inside = false;
    if (this.hoveredId) {
      this.hoveredId = null;
      this.container.style.cursor = "";
      this.options.onNodeHover(null);
      this.applyNodeVisuals();
      this.refreshLabelSet();
    }
  };

  private onDoubleClick = () => {
    this.cameraRadiusTarget = clamp(this.fitRadius * 2.05, 150, 560);
    this.thetaTarget = 0.55;
    this.phiTarget = 1.18;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.idleSeconds = 0;
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    this.cameraRadiusTarget = clamp(this.cameraRadiusTarget * Math.exp(event.deltaY * multiplier * 0.0011), 70, 900);
  };

  private resize() {
    if (!this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const drawHeight = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const scale = drawHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const material of this.materials) {
      if (material.uniforms.uScale) material.uniforms.uScale.value = scale;
    }
  }

  private updateHover() {
    if (this.pointer.down || !this.pointer.inside) return;
    const id = this.pickNode(this.pointer.x, this.pointer.y);
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.container.style.cursor = id ? "pointer" : "";
    this.options.onNodeHover(id);
    this.applyNodeVisuals();
    this.refreshLabelSet();
  }

  private frame = () => {
    if (this.destroyed) return;
    // Genuinely hidden tabs stop getting rAF callbacks from the browser, so no
    // explicit document.hidden guard: surfaces like the Tauri WKWebView and the
    // in-app preview pane report hidden while still being displayed.
    this.animationFrame = requestAnimationFrame(this.frame);
    if (!this.renderer) return;
    const now = performance.now();
    const delta = Math.min(Math.max((now - (this.lastFrameAt || now)) / 1000, 0), 0.05);
    this.lastFrameAt = now;
    this.time += delta;
    this.idleSeconds += delta;

    if (this.alpha > 0.02) {
      this.simTick();
      this.simTick();
      this.alpha *= 0.986;
    }

    // Slow idle orbit keeps the tissue alive once the user stops interacting.
    if (!this.reducedMotion && this.idleSeconds > 5) {
      this.thetaTarget += delta * 0.032;
    }
    this.theta += (this.thetaTarget - this.theta) * Math.min(1, delta * 7);
    this.phi += (this.phiTarget - this.phi) * Math.min(1, delta * 7);
    this.cameraRadius += (this.cameraRadiusTarget - this.cameraRadius) * Math.min(1, delta * 4);
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      Math.sin(this.theta) * sinPhi * this.cameraRadius,
      Math.cos(this.phi) * this.cameraRadius,
      Math.cos(this.theta) * sinPhi * this.cameraRadius,
    );
    this.camera.lookAt(0, 0, 0);

    const fogNear = this.cameraRadius * 0.88;
    const fogFar = this.cameraRadius * 3.1;
    for (const material of this.materials) {
      material.uniforms.uTime.value = this.time;
      if (material.uniforms.uFogNear) material.uniforms.uFogNear.value = fogNear;
      if (material.uniforms.uFogFar) material.uniforms.uFogFar.value = fogFar;
    }

    if (this.soma && this.haloMesh) {
      const haloPos = (this.haloMesh.geometry as THREE.InstancedBufferGeometry).getAttribute("iPos") as THREE.InstancedBufferAttribute;
      this.nodes.forEach((node, index) => {
        this.displayPosition(node, this.tmpVecA);
        this.tmpMatrix.makeScale(node.radius, node.radius, node.radius);
        this.tmpMatrix.setPosition(this.tmpVecA);
        this.soma!.setMatrixAt(index, this.tmpMatrix);
        haloPos.setXYZ(index, this.tmpVecA.x, this.tmpVecA.y, this.tmpVecA.z);
      });
      this.soma.instanceMatrix.needsUpdate = true;
      haloPos.needsUpdate = true;
    }

    if (this.edgeLines) {
      const positionAttr = this.edgeLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      const pulseGeo = this.pulsePoints?.geometry;
      const pulseStart = pulseGeo?.getAttribute("aStart") as THREE.BufferAttribute | undefined;
      const pulseCtrl = pulseGeo?.getAttribute("aCtrl") as THREE.BufferAttribute | undefined;
      const pulseEnd = pulseGeo?.getAttribute("aEnd") as THREE.BufferAttribute | undefined;
      const vertsPerEdge = EDGE_SEGMENTS * 2;
      this.edges.forEach((edge, edgeIndex) => {
        const source = this.nodes[edge.sourceIndex];
        const target = this.nodes[edge.targetIndex];
        this.displayPosition(source, this.tmpVecA);
        this.displayPosition(target, this.tmpVecB);
        // Control point bows the axon perpendicular to the run for an organic arc.
        this.tmpVecC.copy(this.tmpVecB).sub(this.tmpVecA);
        this.tmpVecD.copy(edge.bowSeed).cross(this.tmpVecC);
        const bowLength = this.tmpVecD.length();
        if (bowLength > 0.001) this.tmpVecD.multiplyScalar(1 / bowLength);
        const bow = edge.bowAmount + this.tmpVecC.length() * 0.12;
        this.tmpVecC.multiplyScalar(0.5).add(this.tmpVecA).addScaledVector(this.tmpVecD, bow);
        if (pulseStart && pulseCtrl && pulseEnd && edgeIndex < MAX_PULSED_EDGES) {
          for (let p = 0; p < PULSES_PER_EDGE; p += 1) {
            const slot = edgeIndex * PULSES_PER_EDGE + p;
            pulseStart.setXYZ(slot, this.tmpVecA.x, this.tmpVecA.y, this.tmpVecA.z);
            pulseCtrl.setXYZ(slot, this.tmpVecC.x, this.tmpVecC.y, this.tmpVecC.z);
            pulseEnd.setXYZ(slot, this.tmpVecB.x, this.tmpVecB.y, this.tmpVecB.z);
          }
        }
        for (let s = 0; s < EDGE_SEGMENTS; s += 1) {
          for (let sub = 0; sub < 2; sub += 1) {
            const t = (s + sub) / EDGE_SEGMENTS;
            const inv = 1 - t;
            const x = inv * inv * this.tmpVecA.x + 2 * inv * t * this.tmpVecC.x + t * t * this.tmpVecB.x;
            const y = inv * inv * this.tmpVecA.y + 2 * inv * t * this.tmpVecC.y + t * t * this.tmpVecB.y;
            const z = inv * inv * this.tmpVecA.z + 2 * inv * t * this.tmpVecC.z + t * t * this.tmpVecB.z;
            positionAttr.setXYZ(edgeIndex * vertsPerEdge + s * 2 + sub, x, y, z);
          }
        }
      });
      positionAttr.needsUpdate = true;
      if (pulseStart) pulseStart.needsUpdate = true;
      if (pulseCtrl) pulseCtrl.needsUpdate = true;
      if (pulseEnd) pulseEnd.needsUpdate = true;
    }

    this.updateHover();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };
}

export default function BrainSynapseCanvas({
  className,
  contextIds,
  labelClassName,
  links,
  neighborIds,
  nodes,
  onNodeClick,
  onNodeHover,
  selectedId,
}: SynapseCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SynapseEngine | null>(null);
  const clickRef = useRef(onNodeClick);
  const hoverRef = useRef(onNodeHover);

  useEffect(() => {
    clickRef.current = onNodeClick;
    hoverRef.current = onNodeHover;
  }, [onNodeClick, onNodeHover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const engine = new SynapseEngine(container, {
      labelClassName,
      onNodeClick: (id) => clickRef.current?.(id),
      onNodeHover: (id) => hoverRef.current?.(id),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // The engine handles data/selection through the effects below; label class is mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setData(nodes, links);
  }, [links, nodes]);

  useEffect(() => {
    engineRef.current?.setSelection(selectedId, neighborIds, contextIds);
  }, [contextIds, neighborIds, selectedId]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label="Shared brain synapse graph. Drag to orbit, scroll to zoom, click a neuron to inspect it."
    />
  );
}
