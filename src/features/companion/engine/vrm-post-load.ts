/**
 * Per-character VRM post-load hooks — trimmed port of ami-ai-companion's
 * `src/lib/utils/vrm-post-load.ts` + `src/lib/utils/vrm-clipping-fix.ts`,
 * with ONLY the data relevant to the Sara Lite base model inlined
 * (`Sara.base.v148.opt.vrm` — VRM 0.0, tomcat "female-body-a" rig).
 *
 * Hooks that run here (in order):
 *   1. Clipping fix — registers Sara's body-skin meshes with a per-vertex
 *      `hide` attribute + shader injection so hide boxes can tuck body skin
 *      under clothing. Sara Lite's static config ships ZERO hide boxes (in
 *      ami they are populated at runtime by the wardrobe layering system),
 *      so on a bare base load this is a visual no-op — but the machinery is
 *      live: call `getCompanionVRMClippingFixer(vrm)?.updateExtraHideBoxes()`
 *      to hide regions under clothing composed later.
 *   2. Mesh defaults — hides every `Sara-BodyCut-*` mesh. These are body-skin
 *      cutout variants meant to pair with a specific clothing piece. On the
 *      bare base the full `Sara-Body` skin covers everything, so ALL cutouts
 *      start hidden; `./outfit-composer` re-shows the two paired with the
 *      default outfit (Sara-BodyCut-BH-Vest / -BF-Jeans) when it dresses her,
 *      matching ami's default wardrobe state.
 *   3. Labeled-morph registration — machinery kept from ami, but Sara Lite
 *      has NO custom morph labels in ami's registry (her v148 blendshape
 *      groups are all standard VRM0 presets), so the table below is empty.
 *
 * DROPPED vs ami (no Sara data existed for them): spring-bone body colliders
 * (VRoid-hair-only fix; Sara has no registry entry), WebGPU CPU-hide path,
 * `?hidefix=1` index-removal path, Box3Helper debug wireframes, and the
 * world-space drag-tuner API.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import { logger } from './logger';

// ─── Sara-only inlined data ──────────────────────────────────────────────────

/** Clipping-fix config for the Sara Lite base (ami: character-clipping-fixes.ts,
 *  entry `default-sara` / "Sara Lite modular base"). */
const SARA_CLIPPING_FIX: VRMClippingFixConfig = {
  // Sara-Body has 5 primitives in three.js (skin + 4 face features hidden by
  // the loader by material match). The skin primitive's name depends on
  // three.js's GLTFLoader convention — could be 'Sara-Body' (no suffix) or
  // 'Sara-Body_0'. Excluding a 'Sara-Body_' substring would accidentally drop
  // the skin primitive in the _0 case, so the face-feature suffixes are
  // listed explicitly: _1 through _4 are the face mats.
  bodyMeshPatterns: ['Sara-Body', 'Sara-Feet'],
  bodyMeshExclude: [
    'Sara-Body_1',
    'Sara-Body_2',
    'Sara-Body_3',
    'Sara-Body_4',
    'Sara-BodyCut',
  ],
  extraHideBoxes: [],
};

/** Mesh-name prefixes hidden by default on the Sara Lite base (see header). */
const SARA_DEFAULT_HIDDEN_MESH_PREFIXES = ['Sara-BodyCut'];

/** Raw-morph → expression-label table. Empty: ami's character-morph-labels.ts
 *  has no Sara entry; v148's blendshape groups are all standard VRM0 presets
 *  (a/i/u/e/o, blink, joy, angry, sorrow, fun, blink_l, blink_r). Kept so a
 *  future authored morph can be exposed as a named VRM expression. */
const SARA_MORPH_LABELS: Record<string, string> = {};

/** Content-based Sara detection: any mesh named `Sara-Body*`. More robust
 *  than ami's URL-substring matching, since hivemind asset URLs won't share
 *  ami's `tomcat/female-body-a/sara-lite/` path structure. */
function isSaraVRM(vrm: VRM): boolean {
  let found = false;
  vrm.scene.traverse((obj) => {
    if (found) return;
    if ((obj as THREE.Mesh).isMesh && /^Sara-Body/.test(obj.name ?? '')) found = true;
  });
  return found;
}

// ─── Clipping fix (trimmed WebGL-shader-path port) ───────────────────────────

export type HideBoxSpec = {
  /** Model-local center at rest pose: [x, y, z] in meters. Transformed by the
   *  VRM root translation+scale at apply-time (rotation intentionally NOT
   *  undone — VRM0 already rotates 180° around Y at load, and box coords are
   *  authored post-rotation). */
  center: [number, number, number];
  /** Full dimensions: [width, height, depth] in meters. */
  size: [number, number, number];
  /** Optional: name (substring) of a mesh that must exist AND be visible for
   *  this box to apply. No guard = always apply. */
  requiresMeshVisible?: string;
  /** 'push' displaces hidden verts inward (soft, hole-free — for fabric that
   *  covers the region); 'discard' drops the fragments entirely (closed
   *  garments like boots). */
  mode?: 'push' | 'discard';
};

function cloneHideBox(b: HideBoxSpec): HideBoxSpec {
  return {
    center: [b.center[0], b.center[1], b.center[2]],
    size: [b.size[0], b.size[1], b.size[2]],
    requiresMeshVisible: b.requiresMeshVisible,
    mode: b.mode,
  };
}

export interface VRMClippingFixConfig {
  /** Substring patterns matching the body skin mesh name(s). */
  bodyMeshPatterns: string[];
  /** Substring patterns to EXCLUDE from body matches. */
  bodyMeshExclude?: string[];
  /** Explicit hide boxes (rest-pose, model-local). */
  extraHideBoxes?: HideBoxSpec[];
}

export interface VRMClippingFixResult {
  bodyMeshes: string[];
  hiddenVertexCount: number;
  totalVertexCount: number;
}

export interface VRMClippingFixer {
  /** Replace the hide boxes and re-run the per-vertex hide computation.
   *  Cheap — reuses cached body meshes & shader injection. */
  updateExtraHideBoxes(next: HideBoxSpec[]): void;
  /** Current hide boxes (config coords — model-at-origin space). */
  getExtraHideBoxes(): HideBoxSpec[];
  /** Re-evaluate the hide attribute without changing config. Call after mesh
   *  visibility changes so `requiresMeshVisible` gates get re-checked. */
  refresh(): void;
  /** No-op cleanup hook (kept for lifecycle symmetry with ami). */
  dispose(): void;
}

class ClippingFixerImpl implements VRMClippingFixer {
  private readonly vrm: VRM;
  private readonly config: VRMClippingFixConfig;
  private readonly bodyMeshes: THREE.Mesh[] = [];
  private readonly hideArrays: Float32Array[] = [];
  private readonly hideAttrs: THREE.BufferAttribute[] = [];
  private extraBoxConfigs: HideBoxSpec[] = [];
  private extraBoxes: THREE.Box3[] = [];

  constructor(vrm: VRM, config: VRMClippingFixConfig) {
    this.vrm = vrm;
    this.config = config;
    this.extraBoxConfigs = (config.extraHideBoxes ?? []).map(cloneHideBox);
  }

  private findMeshes(): string[] {
    const allMeshNames: string[] = [];
    const bodyExclude = this.config.bodyMeshExclude ?? [];
    this.vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const name = mesh.name ?? '';
      allMeshNames.push(name);
      if (
        this.config.bodyMeshPatterns.some((p) => name.includes(p)) &&
        !bodyExclude.some((p) => name.includes(p))
      ) {
        this.bodyMeshes.push(mesh);
      }
    });
    return allMeshNames;
  }

  /** Rebuild world-space boxes from config coords. Uses the VRM root's
   *  current translation+scale so later transform changes are picked up on
   *  the next recompute without notification from every mutation site. */
  private rebuildExtraBoxes(): void {
    this.extraBoxes = [];
    this.vrm.scene.updateMatrixWorld(true);
    const translation = new THREE.Vector3().setFromMatrixPosition(this.vrm.scene.matrixWorld);
    const scale = new THREE.Vector3().setFromMatrixScale(this.vrm.scene.matrixWorld);
    for (const cfg of this.extraBoxConfigs) {
      if (cfg.requiresMeshVisible && !this.isMeshPresentAndVisible(cfg.requiresMeshVisible)) {
        // Empty box keeps index alignment; containsPoint() === false always.
        this.extraBoxes.push(new THREE.Box3());
        continue;
      }
      const center = new THREE.Vector3(
        cfg.center[0] * scale.x + translation.x,
        cfg.center[1] * scale.y + translation.y,
        cfg.center[2] * scale.z + translation.z,
      );
      const half = new THREE.Vector3(
        (cfg.size[0] * scale.x) / 2,
        (cfg.size[1] * scale.y) / 2,
        (cfg.size[2] * scale.z) / 2,
      );
      this.extraBoxes.push(new THREE.Box3(center.clone().sub(half), center.clone().add(half)));
    }
  }

  private isMeshPresentAndVisible(pattern: string): boolean {
    let found = false;
    this.vrm.scene.traverse((obj) => {
      if (found) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!(mesh.name ?? '').includes(pattern)) return;
      let cur: THREE.Object3D | null = mesh;
      while (cur) {
        if (!cur.visible) return;
        cur = cur.parent;
      }
      found = true;
    });
    return found;
  }

  /** Add the per-vertex `hide` BufferAttribute + shader injection to every
   *  body mesh. Always runs even with zero initial boxes — runtime
   *  updateExtraHideBoxes() calls need the plumbing in place. */
  private prepareBodyAttrs(): void {
    for (const body of this.bodyMeshes) {
      const geo = body.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      const arr = new Float32Array(pos.count);
      const attr = new THREE.BufferAttribute(arr, 1);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('hide', attr);
      this.hideArrays.push(arr);
      this.hideAttrs.push(attr);

      const mat = body.material;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) injectHideShader(m);
    }
  }

  private recompute(): { hidden: number; total: number } {
    this.vrm.scene.updateMatrixWorld(true);
    this.rebuildExtraBoxes();

    const allVolumes = this.extraBoxes.map((box, index) => ({
      box,
      mode: this.extraBoxConfigs[index]?.mode ?? ('push' as const),
    }));

    const vertex = new THREE.Vector3();
    let hiddenCount = 0;
    let totalCount = 0;

    for (let m = 0; m < this.bodyMeshes.length; m++) {
      const body = this.bodyMeshes[m];
      const pos = body.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      const arr = this.hideArrays[m];
      totalCount += pos.count;

      for (let i = 0; i < pos.count; i++) {
        vertex.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        body.localToWorld(vertex);

        let inside = 0;
        for (const volume of allVolumes) {
          if (!volume.box.containsPoint(vertex)) continue;
          inside = volume.mode === 'discard' ? 2 : 1;
          if (inside === 2) break;
        }
        arr[i] = inside;
        if (inside) hiddenCount++;
      }
      this.hideAttrs[m].needsUpdate = true;
    }
    return { hidden: hiddenCount, total: totalCount };
  }

  apply(): VRMClippingFixResult {
    const allMeshNames = this.findMeshes();

    if (this.bodyMeshes.length === 0) {
      logger.warn('[vrm-clipping-fix] No body meshes matched — clipping fixer disabled', {
        bodyPatterns: this.config.bodyMeshPatterns,
        meshes: allMeshNames,
      });
      return { bodyMeshes: [], hiddenVertexCount: 0, totalVertexCount: 0 };
    }

    this.prepareBodyAttrs();
    const { hidden, total } = this.recompute();

    logger.debug(`[vrm-clipping-fix] Hidden ${hidden}/${total} body vertices`, {
      bodyMeshes: this.bodyMeshes.map((m) => m.name),
    });

    return {
      bodyMeshes: this.bodyMeshes.map((m) => m.name),
      hiddenVertexCount: hidden,
      totalVertexCount: total,
    };
  }

  updateExtraHideBoxes(next: HideBoxSpec[]): void {
    this.extraBoxConfigs = next.map(cloneHideBox);
    const { hidden, total } = this.recompute();
    logger.debug(
      `[vrm-clipping-fix] updateExtraHideBoxes ${next.length} boxes — hidden ${hidden}/${total}`,
    );
  }

  getExtraHideBoxes(): HideBoxSpec[] {
    return this.extraBoxConfigs.map(cloneHideBox);
  }

  refresh(): void {
    this.recompute();
  }

  dispose(): void {
    // No debug helpers in the trimmed port; nothing to remove.
  }
}

/**
 * Shader injection: PUSH-INWARD strategy. Displaces each "hidden" vertex
 * along its NEGATIVE normal by ~1.2 cm so it sinks below the body surface —
 * clothing fabric sits on the original surface, so the displaced vert ends
 * up tucked behind the fabric (invisible without leaving a hole). Boxes with
 * mode 'discard' set hide=2 and are fully discarded in the fragment shader
 * (the only reliable way to remove foot geometry under closed boots).
 */
function injectHideShader(mat: THREE.Material): void {
  const marker = '__vrmClippingFixInjected';
  const record = mat as unknown as Record<string, unknown>;
  if (record[marker]) return;
  record[marker] = true;

  const vertexInject =
    '\nattribute float hide;\nvarying float vHide;\nvoid main() {\nvHide = hide;';
  // Displace AFTER skinning has set `transformed` — pushing along the post-
  // skinning normal follows the body's actual surface direction.
  const projectInject = `
    transformed -= objectNormal * 0.012 * step(0.5, hide);
    #include <project_vertex>`;
  const fragmentInject =
    '\nvarying float vHide;\nvoid main() {\nif (vHide > 1.5) discard;';
  const mainRe = /void\s+main\s*\(\s*\)\s*\{/;

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    if (!mainRe.test(shader.vertexShader) || !mainRe.test(shader.fragmentShader)) {
      logger.warn('[vrm-clipping-fix] Could not find main() in shader — injection skipped');
      return;
    }
    shader.vertexShader = shader.vertexShader
      .replace(mainRe, vertexInject)
      .replace('#include <project_vertex>', projectInject);
    shader.fragmentShader = shader.fragmentShader.replace(mainRe, fragmentInject);
  };
  mat.needsUpdate = true;
}

export function applyVRMClippingFix(vrm: VRM, config: VRMClippingFixConfig): VRMClippingFixResult {
  const fixer = new ClippingFixerImpl(vrm, config);
  const result = fixer.apply();
  // Expose on the VRM so callers can drive runtime hide boxes without
  // threading handles through every layer.
  (vrm as unknown as Record<string, unknown>).__clippingFixer = fixer;
  return result;
}

export function getCompanionVRMClippingFixer(vrm: VRM): VRMClippingFixer | null {
  return ((vrm as unknown as Record<string, unknown>).__clippingFixer as VRMClippingFixer) ?? null;
}

// ─── Labeled-morph registration ──────────────────────────────────────────────

/**
 * For each labeled morph target (`morphName → label`), register a new VRM
 * expression with name `label` that binds to morph `morphName` on every mesh
 * that has it. Skips labels whose name is already registered (avoids
 * double-registration on hot reload / re-entry).
 */
function registerLabeledMorphs(vrm: VRM, labels: Record<string, string>): number {
  const em = vrm.expressionManager;
  if (!em) return 0;

  const allMeshes: THREE.Mesh[] = [];
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary) allMeshes.push(mesh);
  });

  let registered = 0;
  for (const [morphName, label] of Object.entries(labels)) {
    if (em.getExpression(label)) continue; // already registered (hot reload)

    const binds: VRMExpressionMorphTargetBind[] = [];
    for (const mesh of allMeshes) {
      const idx = mesh.morphTargetDictionary?.[morphName];
      if (idx === undefined) continue;
      binds.push(new VRMExpressionMorphTargetBind({ primitives: [mesh], index: idx, weight: 1.0 }));
    }
    if (binds.length === 0) continue;

    const expr = new VRMExpression(label);
    for (const bind of binds) expr.addBind(bind);
    em.registerExpression(expr);
    registered++;
  }

  if (registered > 0) {
    logger.debug(`[postLoadVRM] Registered ${registered} labeled morphs`);
  }
  return registered;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export interface VRMPostLoadResult {
  clippingFixApplied: boolean;
  labeledMorphCount: number;
  meshDefaultsApplied: number;
}

/**
 * Run all per-character post-load hooks on a freshly loaded VRM. Non-throwing —
 * if any single hook fails we log and continue, because dropping the whole
 * character load over one failed cosmetic fix would be the wrong trade-off.
 *
 * `modelUrl` is informational (logging); character detection is content-based
 * (see `isSaraVRM`).
 */
export function postLoadVRM(vrm: VRM, modelUrl: string): VRMPostLoadResult {
  const result: VRMPostLoadResult = {
    clippingFixApplied: false,
    labeledMorphCount: 0,
    meshDefaultsApplied: 0,
  };

  if (!isSaraVRM(vrm)) {
    logger.debug(`[postLoadVRM] No per-character hooks for model: ${modelUrl}`);
    return result;
  }

  // Hook 1: clipping fix (register body meshes + shader plumbing; zero static
  // boxes on the bare Sara Lite base — see file header).
  try {
    applyVRMClippingFix(vrm, SARA_CLIPPING_FIX);
    result.clippingFixApplied = true;
  } catch (e) {
    logger.warn('[postLoadVRM] Clipping fix failed (non-fatal):', e);
  }

  // Hook 2: mesh defaults — hide the clothing-paired BodyCut skin variants.
  try {
    let hidden = 0;
    vrm.scene.traverse((obj) => {
      const name = obj.name ?? '';
      if (SARA_DEFAULT_HIDDEN_MESH_PREFIXES.some((p) => name.startsWith(p))) {
        obj.visible = false;
        hidden++;
      }
    });
    result.meshDefaultsApplied = hidden;
    if (hidden > 0) logger.debug(`[postLoadVRM] Hid ${hidden} Sara-BodyCut meshes`);
  } catch (e) {
    logger.warn('[postLoadVRM] Mesh defaults failed (non-fatal):', e);
  }

  // Hook 3: labeled raw morph targets → named VRM expressions (currently no
  // Sara entries; machinery kept for future authored morphs).
  if (Object.keys(SARA_MORPH_LABELS).length > 0 && vrm.expressionManager) {
    try {
      result.labeledMorphCount = registerLabeledMorphs(vrm, SARA_MORPH_LABELS);
    } catch (e) {
      logger.warn('[postLoadVRM] Morph label registration failed (non-fatal):', e);
    }
  }

  return result;
}
