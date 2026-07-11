"use client";

// Full-screen 3D neuron/synapse renderer for the Shared Brain hive-vault view.
// Self-contained imperative three.js engine (same pattern as the companion
// engine): notes are glowing soma junctions, every wiki-link renders as a
// multi-strand fiber bundle with GPU synaptic pulses, and a faint
// nearest-neighbor web fills the space between so the whole graph reads as
// connected neural tissue. Dark theme gets a bloom pass for the volumetric
// glow; hive-light stays a plain ink-on-parchment render. Colors ride the
// vault panel's --brain-* tokens, reduced motion is honored, and everything
// is disposed on unmount. Shaders/textures live in ./brain-synapse-gpu.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import {
  BACKDROP_FRAGMENT,
  BACKDROP_VERTEX,
  DUST_FRAGMENT,
  DUST_VERTEX,
  FIBER_FRAGMENT,
  FIBER_VERTEX,
  HALO_FRAGMENT,
  HALO_VERTEX,
  PULSE_FRAGMENT,
  PULSE_VERTEX,
  SOMA_FRAGMENT,
  SOMA_VERTEX,
  clamp,
  hashUnit,
  linearizeSRGB,
  makeDendriteAtlas,
  makeDotTexture,
  readPalette,
  srgbColor,
  toneColorInto,
  type Palette,
  type SynapseNodeTone,
} from "./brain-synapse-gpu";

export type { SynapseNodeTone };

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
const FIBER_SEGMENTS = 10;
const LINK_STRANDS = 3;
const WEB_NEIGHBORS = 2;
const MAX_PULSE_SLOTS = 9000;
const ZERO_VEC = new THREE.Vector3();
const MAX_LABELS = 28;
const DUST_COUNT = 900;
const PRE_TICKS = 110;
// Dark theme is a deep-space indigo field; honey stays the semantic accent.
const DARK_DUST_TINT = "#aab6ff";
// Lit/selection tint: electric blue-white so firing paths read as signal in
// the blue-violet field — never amber/orange, which breaks the palette.
const DARK_LIT_TINT = "#dff0ff";
const DARK_PULSE_TINT = "#9fc0ff";
const DARK_BEAD_TINT = "#8ea2ff";
const DARK_FOG_TINT = "#0a0e3c";
const DARK_CLEAR_TINT = "#05071f";

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

// One rendered curve. Real wiki-links become LINK_STRANDS fibers sharing a
// linkIndex; the ambient web uses linkIndex -1; procedural dendrites use -2
// (they ride one node via node-local start/end offsets and never light up).
type Fiber = {
  bowAmount: number;
  bowSeed: THREE.Vector3;
  endOffset: THREE.Vector3 | null;
  linkIndex: number;
  seed: number;
  sourceIndex: number;
  startOffset: THREE.Vector3 | null;
  strand: number;
  targetIndex: number;
};

type RealLink = { sourceIndex: number; targetIndex: number };

type EngineOptions = {
  labelClassName?: string;
  onNodeClick: (id: string) => void;
  onNodeHover: (id: string | null) => void;
};

function pairKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

class SynapseEngine {
  private alpha = 0;
  private animationFrame = 0;
  private backdrop: THREE.Mesh | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private camera: THREE.PerspectiveCamera;
  private cameraRadius = WORLD_RADIUS * 3.2;
  private cameraRadiusTarget = WORLD_RADIUS * 2.3;
  private composer: EffectComposer | null = null;
  private container: HTMLElement;
  private contextIds = new Set<string>();
  private dataSignature = "";
  private destroyed = false;
  private drag: { id: number; lastX: number; lastY: number; moved: number; startX: number; startY: number } | null = null;
  private dust: THREE.Points | null = null;
  private fiberLines: THREE.LineSegments | null = null;
  private fiberPulse: Array<{ count: number; slot: number } | null> = [];
  private fibers: Fiber[] = [];
  private fitRadius = WORLD_RADIUS;
  private haloMesh: THREE.Mesh | null = null;
  private hoveredId: string | null = null;
  private idleSeconds = 0;
  private labelLayer: HTMLDivElement;
  private labelPool: Array<{ meta: HTMLElement; root: HTMLDivElement; title: HTMLElement }> = [];
  private labeledIndices: number[] = [];
  private lastFrameAt = 0;
  private materials: THREE.ShaderMaterial[] = [];
  private neighborIds = new Set<string>();
  private nodeIndexById = new Map<string, number>();
  private nodeTints = new Float32Array(0);
  private nodes: SimNode[] = [];
  private options: EngineOptions;
  private palette: Palette;
  private phi = 1.18;
  private phiTarget = 1.18;
  private pointer = { down: false, inside: false, x: 0, y: 0 };
  private pulsePoints: THREE.Points | null = null;
  private realLinks: RealLink[] = [];
  private reducedMotion = false;
  private reducedMotionQuery: MediaQueryList | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
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
  private tmpColorB = new THREE.Color();
  private tmpMatrix = new THREE.Matrix4();
  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();
  private tmpVecC = new THREE.Vector3();
  private tmpVecD = new THREE.Vector3();
  private webDirty = false;
  private fadeIn = 0;
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
      // 1.75 keeps the bloom blur chain cheap on retina without visible loss.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setClearColor(this.clearTint(), 1);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      // Fade-in is driven from the frame loop: a CSS transition would freeze
      // at 0 in hidden-reporting surfaces (preview pane, occluded WKWebView).
      renderer.domElement.style.opacity = "0";
      container.appendChild(renderer.domElement);
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Measured on three 0.184: the scene renders into the composer's buffer
      // ALREADY sRGB-encoded (readPixels: direct render #0c0d11, buffer 0.047),
      // so the chain must end in a raw copy — an OutputPass would encode a
      // second time and wash the whole frame gray. Bloom therefore operates in
      // encoded space, which these strength/radius/threshold values assume.
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.45, 0.3, 0.68);
      this.bloomPass.enabled = !this.palette.light;
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new ShaderPass(CopyShader));
    }

    this.labelLayer = document.createElement("div");
    this.labelLayer.style.position = "absolute";
    this.labelLayer.style.inset = "0";
    this.labelLayer.style.overflow = "hidden";
    this.labelLayer.style.pointerEvents = "none";
    container.appendChild(this.labelLayer);

    this.buildBackdrop();
    this.buildDust();

    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener("change", this.onReducedMotion);
    // Push the initial reduced-motion state into materials built above.
    this.onReducedMotion();

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
    if (this.backdrop) {
      this.scene.remove(this.backdrop);
      this.backdrop.geometry.dispose();
      this.backdrop = null;
    }
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.texAtlas.dispose();
    this.texDot.dispose();
    this.labelLayer.remove();
    this.bloomPass?.dispose();
    this.composer?.dispose();
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
      const key = link.source < link.target ? `${link.source} ${link.target}` : `${link.target} ${link.source}`;
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
      // Smaller nuclei — the dendrites and web carry the visual now.
      const radius = 1.9 + clamp(input.weight, 0, 1) * 5.4;
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
    this.nodeTints = new Float32Array(this.nodes.length * 3);

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

    this.realLinks = links.map((link) => ({
      sourceIndex: this.nodeIndexById.get(link.source) ?? 0,
      targetIndex: this.nodeIndexById.get(link.target) ?? 0,
    }));

    if (!topologyChanged) {
      this.applyNodeVisuals();
      this.applyFiberVisuals();
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

    this.fibers = [...this.buildLinkFibers(), ...this.buildDendriteFibers()];
    if (firstBuild) {
      this.fibers.push(...this.computeWebFibers());
      this.webDirty = false;
    } else {
      // The web re-grows once the reflowed layout settles (see frame()).
      this.webDirty = true;
    }

    this.rebuildNodeObjects();
    this.rebuildFiberObjects();
    this.applyNodeVisuals();
    this.applyFiberVisuals();
    this.refreshLabelSet();
  }

  setSelection(selectedId: string | null, neighborIds: string[], contextIds: string[]) {
    this.selectedId = selectedId;
    this.neighborIds = new Set(neighborIds);
    this.contextIds = new Set(contextIds);
    this.applyNodeVisuals();
    this.applyFiberVisuals();
    this.refreshLabelSet();
  }

  private onReducedMotion = () => {
    this.reducedMotion = Boolean(this.reducedMotionQuery?.matches);
    for (const material of this.materials) {
      if (material.uniforms.uMotion) material.uniforms.uMotion.value = this.reducedMotion ? 0 : 1;
    }
  };

  // Dark theme draws on a deep-space indigo field (nebula backdrop + indigo
  // fog); hive-light stays on the parchment tokens.
  private clearTint() {
    return this.palette.light ? this.palette.bg : srgbColor(DARK_CLEAR_TINT);
  }

  private fogTint() {
    return this.palette.light ? this.palette.bg : srgbColor(DARK_FOG_TINT);
  }

  private applyPalette() {
    if (this.destroyed) return;
    this.palette = readPalette(this.container);
    this.renderer?.setClearColor(this.clearTint(), 1);
    if (this.bloomPass) this.bloomPass.enabled = !this.palette.light;
    if (this.backdrop) this.backdrop.visible = !this.palette.light;
    const additive = this.palette.light ? 0 : 1;
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      if (uniforms.uBg) (uniforms.uBg.value as THREE.Color).copy(this.fogTint());
      if (uniforms.uAdditive) uniforms.uAdditive.value = additive;
      if (uniforms.uLit) (uniforms.uLit.value as THREE.Color).copy(this.palette.light ? this.palette.honey : srgbColor(DARK_LIT_TINT));
      if (uniforms.uTint) (uniforms.uTint.value as THREE.Color).copy(this.palette.light ? this.palette.live : srgbColor(DARK_DUST_TINT));
      if (material.blending !== THREE.NoBlending) {
        material.blending = this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending;
        material.needsUpdate = true;
      }
    }
    this.applyNodeVisuals();
    this.applyFiberVisuals();
  }

  private toneGlow(tone: SynapseNodeTone) {
    if (tone === "touched") return 0.55;
    if (tone === "recent") return 0.44;
    if (tone === "unresolved") return 0.42;
    if (tone === "stale") return 0.32;
    return 0.3;
  }

  private applyNodeVisuals() {
    if (!this.soma) return;
    const tintAttr = this.soma.geometry.getAttribute("iTint") as THREE.InstancedBufferAttribute;
    const glowAttr = this.soma.geometry.getAttribute("iGlow") as THREE.InstancedBufferAttribute;
    const dimAttr = this.soma.geometry.getAttribute("iDim") as THREE.InstancedBufferAttribute;
    const haloGeo = this.haloMesh?.geometry as THREE.InstancedBufferGeometry | undefined;
    const haloTint = haloGeo?.getAttribute("iTint") as THREE.InstancedBufferAttribute | undefined;
    const haloAlpha = haloGeo?.getAttribute("iAlpha") as THREE.InstancedBufferAttribute | undefined;
    // ANY selection engages the spotlight — even a 0-link orphan dims the rest
    // of the tissue, otherwise picking such a note shows no focus change at all.
    // Dim is a 0.5 mix toward the background, so nothing blacks out.
    const hasSelection = Boolean(this.selectedId);
    this.nodes.forEach((node, index) => {
      const selected = node.id === this.selectedId;
      const neighbor = this.neighborIds.has(node.id);
      const inContext = this.contextIds.has(node.id);
      toneColorInto(this.palette, node.tone, node.drift, this.tmpColor);
      if (inContext) this.tmpColor.lerp(this.palette.live, 0.5);
      if (selected) this.tmpColor.lerp(this.palette.light ? this.palette.honey : linearizeSRGB(this.tmpColorB.set(DARK_LIT_TINT)), 0.5);
      let glow = this.toneGlow(node.tone) + node.weight * 0.16;
      if (inContext) glow = Math.max(glow, 0.55);
      if (neighbor) glow += 0.08;
      if (selected) glow = 0.72;
      if (node.id === this.hoveredId) glow = Math.min(0.85, glow + 0.15);
      const dim = hasSelection && !selected && !neighbor && !inContext ? 1 : 0;
      tintAttr.setXYZ(index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      glowAttr.setX(index, clamp(glow, 0, 1));
      dimAttr.setX(index, dim);
      this.nodeTints[index * 3] = this.tmpColor.r;
      this.nodeTints[index * 3 + 1] = this.tmpColor.g;
      this.nodeTints[index * 3 + 2] = this.tmpColor.b;
      if (haloTint && haloAlpha) {
        haloTint.setXYZ(index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
        const base = this.palette.light ? 0.34 : 0.18;
        // Capped so a selected hub reads as a bright junction, not a blob.
        haloAlpha.setX(index, Math.min(0.5, base + glow * 0.22) * (dim ? 0.3 : 1));
      }
    });
    tintAttr.needsUpdate = true;
    glowAttr.needsUpdate = true;
    dimAttr.needsUpdate = true;
    if (haloTint) haloTint.needsUpdate = true;
    if (haloAlpha) haloAlpha.needsUpdate = true;
  }

  private fiberAlpha(fiber: Fiber) {
    if (fiber.linkIndex === -2) return this.palette.light ? 0.15 : 0.26;
    if (fiber.linkIndex < 0) return this.palette.light ? 0.18 : 0.34;
    const strands = this.palette.light ? [0.5, 0.3, 0.22] : [0.7, 0.42, 0.3];
    return strands[fiber.strand] ?? strands[0];
  }

  private applyFiberVisuals() {
    if (!this.fiberLines) return;
    const geo = this.fiberLines.geometry;
    const litAttr = geo.getAttribute("aLit") as THREE.BufferAttribute;
    const alphaAttr = geo.getAttribute("aAlpha") as THREE.BufferAttribute;
    const colorA = geo.getAttribute("aColorA") as THREE.BufferAttribute;
    const colorB = geo.getAttribute("aColorB") as THREE.BufferAttribute;
    const pulseGeo = this.pulsePoints?.geometry;
    const pulseLit = pulseGeo?.getAttribute("aLit") as THREE.BufferAttribute | undefined;
    const pulseTint = pulseGeo?.getAttribute("aTint") as THREE.BufferAttribute | undefined;
    const pulseSize = pulseGeo?.getAttribute("aSize") as THREE.BufferAttribute | undefined;
    const vertsPerFiber = FIBER_SEGMENTS * 2;
    this.fibers.forEach((fiber, fiberIndex) => {
      const source = this.nodes[fiber.sourceIndex];
      const target = this.nodes[fiber.targetIndex];
      const dendrite = fiber.linkIndex === -2;
      const lit = fiber.linkIndex >= 0 && this.selectedId !== null
        && (source.id === this.selectedId || target.id === this.selectedId) ? 1 : 0;
      // Short fibers between packed nodes concentrate additive energy into a
      // few pixels — scale their alpha by run length so clusters don't white
      // out. Dendrites are single thin strands, so they skip the scaling.
      const run = dendrite ? 0 : Math.hypot(target.x - source.x, target.y - source.y, target.z - source.z);
      const alpha = this.fiberAlpha(fiber) * (dendrite ? 1 : clamp(run / 55, 0.25, 1));
      const tipFade = dendrite ? 0.6 : 1;
      for (let v = 0; v < vertsPerFiber; v += 1) {
        const at = fiberIndex * vertsPerFiber + v;
        litAttr.setX(at, lit);
        alphaAttr.setX(at, alpha);
        colorA.setXYZ(at, this.nodeTints[fiber.sourceIndex * 3], this.nodeTints[fiber.sourceIndex * 3 + 1], this.nodeTints[fiber.sourceIndex * 3 + 2]);
        colorB.setXYZ(at, this.nodeTints[fiber.targetIndex * 3] * tipFade, this.nodeTints[fiber.targetIndex * 3 + 1] * tipFade, this.nodeTints[fiber.targetIndex * 3 + 2] * tipFade);
      }
    });
    litAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    colorA.needsUpdate = true;
    colorB.needsUpdate = true;
    if (pulseLit && pulseTint && pulseSize) {
      this.fibers.forEach((fiber, fiberIndex) => {
        const assignment = this.fiberPulse[fiberIndex];
        if (!assignment) return;
        const source = this.nodes[fiber.sourceIndex];
        const target = this.nodes[fiber.targetIndex];
        const isLink = fiber.linkIndex >= 0;
        const lit = isLink && this.selectedId !== null
          && (source.id === this.selectedId || target.id === this.selectedId) ? 1 : 0;
        if (isLink) {
          this.tmpColor.copy(lit
            ? (this.palette.light ? this.palette.honey : linearizeSRGB(this.tmpColorB.set(DARK_LIT_TINT)))
            : (this.palette.light ? this.palette.live : linearizeSRGB(this.tmpColorB.set(DARK_PULSE_TINT))));
        } else if (fiber.linkIndex === -2) {
          // Dendrite vesicles glow in their own neuron's hue, lifted to white.
          this.tmpColor.setRGB(this.nodeTints[fiber.sourceIndex * 3], this.nodeTints[fiber.sourceIndex * 3 + 1], this.nodeTints[fiber.sourceIndex * 3 + 2]);
          this.tmpColor.lerp(this.tmpColorB.setRGB(1, 1, 1), 0.25);
        } else if (this.palette.light) {
          this.tmpColor.copy(this.palette.fg2);
        } else {
          linearizeSRGB(this.tmpColor.set(DARK_BEAD_TINT));
        }
        for (let p = 0; p < assignment.count; p += 1) {
          const slot = assignment.slot + p;
          pulseLit.setX(slot, lit);
          pulseTint.setXYZ(slot, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
          // The second travelling pulse per axon only fires while lit.
          if (isLink && p === 1) pulseSize.setX(slot, lit ? 16 + hashUnit(`pulse-${fiberIndex}-${p}`, 13) * 10 : 0);
        }
      });
      pulseLit.needsUpdate = true;
      pulseTint.needsUpdate = true;
      pulseSize.needsUpdate = true;
    }
    const dimUnlit = Boolean(this.selectedId);
    (this.fiberLines.material as THREE.ShaderMaterial).uniforms.uSelDim.value = dimUnlit ? 0.35 : 1;
    if (this.pulsePoints) {
      (this.pulsePoints.material as THREE.ShaderMaterial).uniforms.uSelDim.value = dimUnlit ? 0.35 : 1;
    }
  }

  private buildLinkFibers(): Fiber[] {
    const fibers: Fiber[] = [];
    this.realLinks.forEach((link, linkIndex) => {
      for (let strand = 0; strand < LINK_STRANDS; strand += 1) {
        const seed = hashUnit(`${link.sourceIndex}>${link.targetIndex}`, 5 + strand * 17);
        fibers.push({
          linkIndex,
          strand,
          seed,
          sourceIndex: link.sourceIndex,
          targetIndex: link.targetIndex,
          startOffset: null,
          endOffset: null,
          bowAmount: 5 + seed * 15 + strand * 4,
          bowSeed: new THREE.Vector3(
            hashUnit(`${link.sourceIndex}-${link.targetIndex}`, 41 + strand * 7) - 0.5,
            hashUnit(`${link.sourceIndex}-${link.targetIndex}`, 43 + strand * 7) - 0.5,
            hashUnit(`${link.sourceIndex}-${link.targetIndex}`, 47 + strand * 7) - 0.5,
          ).normalize(),
        });
      }
    });
    return fibers;
  }

  // Faint filaments joining every node to its nearest neighbors, so sparse
  // link data still reads as one connected mesh (the "fascia" of the tissue).
  private computeWebFibers(): Fiber[] {
    const count = this.nodes.length;
    if (count < 3) return [];
    const linked = new Set(this.realLinks.map((link) => pairKey(link.sourceIndex, link.targetIndex)));
    const webPairs = new Set<string>();
    const fibers: Fiber[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = this.nodes[i];
      const nearest: Array<{ dist: number; index: number }> = [];
      for (let j = 0; j < count; j += 1) {
        if (i === j) continue;
        const b = this.nodes[j];
        const dist = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        if (nearest.length < WEB_NEIGHBORS) {
          nearest.push({ dist, index: j });
          nearest.sort((p, q) => p.dist - q.dist);
        } else if (dist < nearest[nearest.length - 1].dist) {
          nearest[nearest.length - 1] = { dist, index: j };
          nearest.sort((p, q) => p.dist - q.dist);
        }
      }
      for (const { index } of nearest) {
        const key = pairKey(i, index);
        if (linked.has(key) || webPairs.has(key)) continue;
        webPairs.add(key);
        const seed = hashUnit(String(key), 59);
        fibers.push({
          linkIndex: -1,
          strand: 0,
          seed,
          sourceIndex: i,
          targetIndex: index,
          startOffset: null,
          endOffset: null,
          bowAmount: 4 + seed * 9,
          bowSeed: new THREE.Vector3(hashUnit(key, 61) - 0.5, hashUnit(key, 67) - 0.5, hashUnit(key, 71) - 0.5).normalize(),
        });
      }
    }
    return fibers;
  }

  // Procedural dendrites: every soma sprouts a handful of short, sometimes
  // forked tendrils so nodes read as neurons instead of plain circles. The
  // offsets are node-local, so a whole dendrite tree rides its node rigidly.
  private buildDendriteFibers(): Fiber[] {
    const fibers: Fiber[] = [];
    this.nodes.forEach((node, index) => {
      const count = 4 + Math.floor(hashUnit(node.id, 91) * 4);
      for (let d = 0; d < count; d += 1) {
        const key = `${node.id}~den${d}`;
        const seed = hashUnit(key, 97);
        const u = hashUnit(key, 101) * 2 - 1;
        const angle = hashUnit(key, 103) * Math.PI * 2;
        const ring = Math.sqrt(Math.max(0.0001, 1 - u * u));
        const length = node.radius * 2.8 + seed * 24;
        const end = new THREE.Vector3(Math.cos(angle) * ring, u * 0.9, Math.sin(angle) * ring).multiplyScalar(length);
        const bowSeed = new THREE.Vector3(hashUnit(key, 109) - 0.5, hashUnit(key, 113) - 0.5, hashUnit(key, 127) - 0.5).normalize();
        fibers.push({ linkIndex: -2, strand: 0, seed, sourceIndex: index, targetIndex: index, bowAmount: 2 + seed * 6, bowSeed, startOffset: null, endOffset: end });
        if (seed > 0.34) {
          const forkKey = `${key}f`;
          const forkSeed = hashUnit(forkKey, 131);
          const forkDir = new THREE.Vector3(hashUnit(forkKey, 137) - 0.5, hashUnit(forkKey, 139) - 0.5, hashUnit(forkKey, 149) - 0.5).normalize();
          const forkEnd = end.clone().addScaledVector(forkDir, length * 0.65);
          fibers.push({ linkIndex: -2, strand: 1, seed: forkSeed, sourceIndex: index, targetIndex: index, bowAmount: 1.5 + forkSeed * 4, bowSeed: bowSeed.clone().negate(), startOffset: end.clone(), endOffset: forkEnd });
        }
      }
    });
    return fibers;
  }

  private disposeGraphObjects() {
    for (const object of [this.soma, this.haloMesh] as Array<THREE.Object3D | null>) {
      if (!object) continue;
      this.scene.remove(object);
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this.soma = null;
    this.haloMesh = null;
    this.disposeFiberObjects();
  }

  private disposeFiberObjects() {
    for (const object of [this.fiberLines, this.pulsePoints] as Array<THREE.Object3D | null>) {
      if (!object) continue;
      this.scene.remove(object);
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this.fiberLines = null;
    this.pulsePoints = null;
  }

  private sharedUniforms() {
    return {
      uTime: { value: 0 },
      uMotion: { value: this.reducedMotion ? 0 : 1 },
      uBg: { value: this.fogTint().clone() },
      uFogNear: { value: this.cameraRadiusTarget * 0.88 },
      uFogFar: { value: this.cameraRadiusTarget * 3.1 },
      uScale: { value: 600 },
      uAdditive: { value: this.palette.light ? 0 : 1 },
      uSelDim: { value: 1 },
    };
  }

  private registerMaterial(material: THREE.ShaderMaterial) {
    this.materials.push(material);
    return material;
  }

  private buildBackdrop() {
    const geometry = new THREE.BufferGeometry();
    // Single fullscreen triangle in NDC; the vertex shader passes it through.
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const material = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMotion: { value: this.reducedMotion ? 0 : 1 } },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      depthTest: false,
    }));
    this.backdrop = new THREE.Mesh(geometry, material);
    this.backdrop.renderOrder = -10;
    this.backdrop.frustumCulled = false;
    this.backdrop.visible = !this.palette.light;
    this.scene.add(this.backdrop);
  }

  private buildDust() {
    const positions = new Float32Array(DUST_COUNT * 3);
    const sizes = new Float32Array(DUST_COUNT);
    const seeds = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const u = hashUnit(`dust-${i}`, 3) * 2 - 1;
      const angle = hashUnit(`dust-${i}`, 5) * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0.0001, 1 - u * u));
      // Sparkle field threads through the tissue and out past it.
      const spread = WORLD_RADIUS * (0.25 + hashUnit(`dust-${i}`, 9) * 1.9);
      positions[i * 3] = Math.cos(angle) * ring * spread;
      positions[i * 3 + 1] = u * spread * 0.8;
      positions[i * 3 + 2] = Math.sin(angle) * ring * spread;
      sizes[i] = 0.9 + hashUnit(`dust-${i}`, 13) * 2.6;
      seeds[i] = hashUnit(`dust-${i}`, 17);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const material = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: {
        ...this.sharedUniforms(),
        uMap: { value: this.texDot },
        uTint: { value: this.palette.light ? this.palette.live.clone() : srgbColor(DARK_DUST_TINT) },
      },
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

  private rebuildNodeObjects() {
    for (const object of [this.soma, this.haloMesh] as Array<THREE.Object3D | null>) {
      if (!object) continue;
      this.scene.remove(object);
      (object as THREE.Mesh).geometry?.dispose();
    }
    this.soma = null;
    this.haloMesh = null;
    const count = this.nodes.length;
    if (!count) return;

    // Soma spheres (instanced, opaque, fresnel-lit junction cores).
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

    // Dendrite halos (instanced billboards over the soma), kept subtle — the
    // bloom pass supplies the volumetric glow now.
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
      // Modest: real dendrites carry the branching now; the atlas just glows.
      haloScales[index] = node.radius * 4.2;
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
  }

  private rebuildFiberObjects() {
    this.disposeFiberObjects();
    const fiberCount = this.fibers.length;
    if (fiberCount) {
      const vertsPerFiber = FIBER_SEGMENTS * 2;
      const positions = new Float32Array(fiberCount * vertsPerFiber * 3);
      const ts = new Float32Array(fiberCount * vertsPerFiber);
      const seeds = new Float32Array(fiberCount * vertsPerFiber);
      this.fibers.forEach((fiber, fiberIndex) => {
        for (let s = 0; s < FIBER_SEGMENTS; s += 1) {
          const base = fiberIndex * vertsPerFiber + s * 2;
          ts[base] = s / FIBER_SEGMENTS;
          ts[base + 1] = (s + 1) / FIBER_SEGMENTS;
          seeds[base] = fiber.seed;
          seeds[base + 1] = fiber.seed;
        }
      });
      const geometry = new THREE.BufferGeometry();
      const positionAttr = new THREE.BufferAttribute(positions, 3);
      positionAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", positionAttr);
      geometry.setAttribute("aT", new THREE.BufferAttribute(ts, 1));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      geometry.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(fiberCount * vertsPerFiber), 1));
      geometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(fiberCount * vertsPerFiber), 1));
      geometry.setAttribute("aColorA", new THREE.BufferAttribute(new Float32Array(fiberCount * vertsPerFiber * 3), 3));
      geometry.setAttribute("aColorB", new THREE.BufferAttribute(new Float32Array(fiberCount * vertsPerFiber * 3), 3));
      const material = this.registerMaterial(new THREE.ShaderMaterial({
        uniforms: {
          ...this.sharedUniforms(),
          uLit: { value: this.palette.light ? this.palette.honey.clone() : srgbColor(DARK_LIT_TINT) },
        },
        vertexShader: FIBER_VERTEX,
        fragmentShader: FIBER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: this.palette.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      }));
      this.fiberLines = new THREE.LineSegments(geometry, material);
      this.fiberLines.frustumCulled = false;
      this.scene.add(this.fiberLines);
    }

    // Particles: fast synaptic pulses on real links (two per link, riding the
    // strand-0 curve), slow beads on the ambient web, and static "vesicle"
    // chain dots studding every drawn fiber — the dotted-filament look.
    const fiberRun = (fiber: Fiber) => {
      if (fiber.endOffset) return fiber.endOffset.distanceTo(fiber.startOffset ?? ZERO_VEC);
      const a = this.nodes[fiber.sourceIndex];
      const b = this.nodes[fiber.targetIndex];
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    let slotCursor = 0;
    this.fiberPulse = this.fibers.map((fiber) => {
      if (slotCursor >= MAX_PULSE_SLOTS) return null;
      if (fiber.linkIndex >= 0 && fiber.strand !== 0) return null;
      const travel = fiber.linkIndex >= 0 ? 2 : fiber.linkIndex === -1 ? 1 : 0;
      const chain = clamp(Math.floor(fiberRun(fiber) / 9), 1, 6);
      const count = Math.min(travel + chain, MAX_PULSE_SLOTS - slotCursor);
      if (count <= 0) return null;
      const slot = slotCursor;
      slotCursor += count;
      return { slot, count };
    });
    const pulseCount = slotCursor;
    if (!pulseCount) return;
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
    this.fibers.forEach((fiber, fiberIndex) => {
      const assignment = this.fiberPulse[fiberIndex];
      if (!assignment) return;
      const travel = fiber.linkIndex >= 0 ? 2 : fiber.linkIndex === -1 ? 1 : 0;
      for (let p = 0; p < assignment.count; p += 1) {
        const slot = assignment.slot + p;
        const seed = hashUnit(`pulse-${fiberIndex}-${p}`, 7);
        if (p < travel && fiber.linkIndex >= 0) {
          phases[slot] = seed + p * 0.5;
          speeds[slot] = 0.08 + hashUnit(`pulse-${fiberIndex}-${p}`, 11) * 0.12;
          sizes[slot] = p === 0 ? 16 + hashUnit(`pulse-${fiberIndex}-${p}`, 13) * 10 : 0;
        } else if (p < travel) {
          phases[slot] = seed;
          speeds[slot] = 0.014 + hashUnit(`pulse-${fiberIndex}-${p}`, 11) * 0.028;
          sizes[slot] = 9 + hashUnit(`pulse-${fiberIndex}-${p}`, 13) * 6;
        } else {
          // Static vesicle dot pinned along the curve.
          const chainIndex = p - travel;
          const chainTotal = assignment.count - travel;
          phases[slot] = clamp((chainIndex + 0.5) / Math.max(1, chainTotal) + (seed - 0.5) * 0.12, 0.06, 0.94);
          speeds[slot] = 0;
          sizes[slot] = 6 + hashUnit(`pulse-${fiberIndex}-${p}`, 13) * 5;
        }
      }
    });
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
    for (const link of this.realLinks) {
      const a = nodes[link.sourceIndex];
      const b = nodes[link.targetIndex];
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
        if (node.id === this.hoveredId) score += 12;
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
      const state = node.id === this.hoveredId
        ? "hovered"
        : node.id === this.selectedId
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
    const hasSelection = Boolean(this.selectedId);
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
      const prominent = node.id === this.hoveredId || node.id === this.selectedId;
      const focus = prominent || this.neighborIds.has(node.id) || this.contextIds.has(node.id);
      let opacity = clamp(1.25 - depth * 1.1, 0.2, 1);
      if (prominent) opacity = 1;
      else if (hasSelection && !focus) opacity *= 0.4;
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
    this.composer?.setSize(width, height);
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
    if (this.fadeIn < 1) {
      this.fadeIn = Math.min(1, this.fadeIn + Math.max(delta, 0.016) * 1.8);
      this.renderer.domElement.style.opacity = this.fadeIn.toFixed(3);
    }

    if (this.alpha > 0.02) {
      this.simTick();
      this.simTick();
      this.alpha *= 0.986;
    } else if (this.webDirty) {
      // Layout has settled after a filter/search reflow — regrow the web.
      this.webDirty = false;
      this.fibers = [...this.buildLinkFibers(), ...this.buildDendriteFibers(), ...this.computeWebFibers()];
      this.rebuildFiberObjects();
      this.applyFiberVisuals();
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

    if (this.fiberLines) {
      const positionAttr = this.fiberLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      const pulseGeo = this.pulsePoints?.geometry;
      const pulseStart = pulseGeo?.getAttribute("aStart") as THREE.BufferAttribute | undefined;
      const pulseCtrl = pulseGeo?.getAttribute("aCtrl") as THREE.BufferAttribute | undefined;
      const pulseEnd = pulseGeo?.getAttribute("aEnd") as THREE.BufferAttribute | undefined;
      const vertsPerFiber = FIBER_SEGMENTS * 2;
      this.fibers.forEach((fiber, fiberIndex) => {
        const source = this.nodes[fiber.sourceIndex];
        this.displayPosition(source, this.tmpVecA);
        if (fiber.endOffset) {
          // Dendrite: both ends ride the source node rigidly.
          this.tmpVecB.copy(this.tmpVecA).add(fiber.endOffset);
          if (fiber.startOffset) this.tmpVecA.add(fiber.startOffset);
        } else {
          this.displayPosition(this.nodes[fiber.targetIndex], this.tmpVecB);
        }
        // Control point bows the axon perpendicular to the run for an organic arc.
        this.tmpVecC.copy(this.tmpVecB).sub(this.tmpVecA);
        this.tmpVecD.copy(fiber.bowSeed).cross(this.tmpVecC);
        const bowLength = this.tmpVecD.length();
        if (bowLength > 0.001) this.tmpVecD.multiplyScalar(1 / bowLength);
        const bow = fiber.bowAmount + this.tmpVecC.length() * 0.12;
        this.tmpVecC.multiplyScalar(0.5).add(this.tmpVecA).addScaledVector(this.tmpVecD, bow);
        const pulseAssignment = this.fiberPulse[fiberIndex];
        if (pulseStart && pulseCtrl && pulseEnd && pulseAssignment) {
          for (let p = 0; p < pulseAssignment.count; p += 1) {
            const slot = pulseAssignment.slot + p;
            pulseStart.setXYZ(slot, this.tmpVecA.x, this.tmpVecA.y, this.tmpVecA.z);
            pulseCtrl.setXYZ(slot, this.tmpVecC.x, this.tmpVecC.y, this.tmpVecC.z);
            pulseEnd.setXYZ(slot, this.tmpVecB.x, this.tmpVecB.y, this.tmpVecB.z);
          }
        }
        for (let s = 0; s < FIBER_SEGMENTS; s += 1) {
          for (let sub = 0; sub < 2; sub += 1) {
            const t = (s + sub) / FIBER_SEGMENTS;
            const inv = 1 - t;
            const x = inv * inv * this.tmpVecA.x + 2 * inv * t * this.tmpVecC.x + t * t * this.tmpVecB.x;
            const y = inv * inv * this.tmpVecA.y + 2 * inv * t * this.tmpVecC.y + t * t * this.tmpVecB.y;
            const z = inv * inv * this.tmpVecA.z + 2 * inv * t * this.tmpVecC.z + t * t * this.tmpVecB.z;
            positionAttr.setXYZ(fiberIndex * vertsPerFiber + s * 2 + sub, x, y, z);
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
    // Always render through the composer: the OutputPass owns the linear→sRGB
    // conversion for scene AND clear color in both themes (bloom toggles off
    // in hive-light but the color pipeline stays identical).
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
