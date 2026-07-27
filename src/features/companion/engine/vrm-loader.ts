/**
 * Companion VRM loader — WebGL-only port of ami-ai-companion's
 * `src/components/3d/VRMLoader.ts` `loadVRMModel()`, trimmed to the pieces
 * that matter for the Sara Lite base model (`Sara.base.v148.opt.vrm` —
 * VRM 0.0, meshopt-compressed, tomcat "female-body-a" rig, WebP textures).
 *
 * What this keeps from ami (all confirmed load-bearing for Sara):
 *   - meshopt decoding (the VRM uses EXT_meshopt_compression)
 *   - VRM0 materialProperties sanitization before parse (v148 ships 47
 *     materialProperties entries for 24 materials; three-vrm's VRM0 material
 *     converter mis-associates the stale tail entries without this)
 *   - VRMUtils.rotateVRM0 / removeUnnecessaryVertices / combineSkeletons
 *   - texture quality (anisotropy 16 + trilinear mipmaps), frustumCulled=false,
 *     shadow flags on non-alpha meshes
 *   - the full Sara WebGL material-fix pipeline: duplicate face-primitive
 *     hides, duplicate-head-triangle removal, authored brow/lash tuning,
 *     body-skin polygon offset, textureless-brow unlit conversion,
 *     envMapIntensity 0.6, ponytail strand alpha boost, hair → MeshBasic
 *     (true unlit) + sRGB OETF, face contour wrap shading, and the inline
 *     ACES+sRGB output injection on lit materials
 *   - per-character post-load hooks (see ./vrm-post-load)
 *
 * What this deliberately does NOT do (unlike ami):
 *   - No WebGPU anywhere. Never imports three/webgpu, three/tsl, or
 *     MToonNodeMaterial; every `_isWebGPUVRMLoadRequested` branch is gone.
 *   - No controllers. The ami loader constructed LipSync/Blink/Expression/
 *     ProceduralAnimation/AnimationLoader inline; here a separate engine
 *     class composes them from the returned { vrm, mixer }.
 *   - No wardrobe/outfit system: orphan-mesh expansion, outfit default
 *     visibility, Briefs hiding, body-skin stocking variants are gone
 *     (v148 has no orphan meshes and none of those materials).
 *   - No cinematic-rendering renderer-state hooks, perf diagnostics,
 *     warm-prefetch cache, or window.__ami* handles.
 *
 * Renderer expectations: materials that get the inline ACES+sRGB injection
 * are flagged `toneMapped = false`, so the pipeline is correct regardless of
 * the renderer's toneMapping setting (ami ran NoToneMapping + LinearSRGB
 * through a composer; the injection reproduces the authored ACES look
 * in-shader either way).
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { logger } from './logger';
import { postLoadVRM } from './vrm-post-load';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompanionVRMLoadOptions {
  /** Y offset applied to vrm.scene.position (default 0). */
  characterPositionY?: number;
  /** Uniform scale applied to vrm.scene (default 1). */
  characterScale?: number;
}

export interface CompanionVRMLoadResult {
  vrm: VRM;
  gltf: GLTF;
  mixer: THREE.AnimationMixer;
  /** vrm.scene.rotation.y after VRM0/VRM1 facing correction. */
  baseRotationY: number;
  /** Rest-pose normalized hips position (animation retargeting anchor). */
  initialHipsPosition: THREE.Vector3 | null;
}

/** Loose material view — VRM materials mix MToon/Standard/Basic properties. */
type AnyMaterial = THREE.Material & { [key: string]: any };

function materialsOf(obj: THREE.Object3D): AnyMaterial[] {
  const mesh = obj as THREE.Mesh;
  if (!mesh.material) return [];
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as AnyMaterial[];
}

function isMeshLike(obj: THREE.Object3D): obj is THREE.Mesh {
  const m = obj as THREE.Mesh & { isSkinnedMesh?: boolean };
  return m.isMesh === true || m.isSkinnedMesh === true;
}

// ─── GLB JSON patch: VRM0 materialProperties sanitization ────────────────────
// Inlined from ami's `glbExpandOrphanMeshes.ts`. The Sara Lite optimizer
// pipeline leaves stale `extensions.VRM.materialProperties` entries behind
// (v148: 47 entries vs 24 materials); three-vrm indexes materialProperties
// by material index, so the mismatched tail corrupts material conversion.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'

function writePatchedGlbJson(
  glbBuffer: ArrayBuffer,
  json: unknown,
  originalJsonLen: number,
  version: number,
): ArrayBuffer {
  const newJsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const padding = (4 - (newJsonBytes.length % 4)) % 4;
  const paddedJsonLen = newJsonBytes.length + padding;
  const paddedJson = new Uint8Array(paddedJsonLen);
  paddedJson.set(newJsonBytes);
  for (let i = newJsonBytes.length; i < paddedJsonLen; i++) paddedJson[i] = 0x20;

  const binChunkOffset = 20 + originalJsonLen;
  const remaining = new Uint8Array(glbBuffer, binChunkOffset);

  const newTotalLen = 12 + 8 + paddedJsonLen + remaining.length;
  const out = new ArrayBuffer(newTotalLen);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, version, true);
  outView.setUint32(8, newTotalLen, true);
  outView.setUint32(12, paddedJsonLen, true);
  outView.setUint32(16, JSON_CHUNK_TYPE, true);
  outBytes.set(paddedJson, 20);
  outBytes.set(remaining, 20 + paddedJsonLen);

  return out;
}

export function sanitizeVRMMaterialProperties(glbBuffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(glbBuffer);

  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('sanitizeVRMMaterialProperties: not a GLB file');
  }
  const version = view.getUint32(4, true);
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK_TYPE) {
    throw new Error('sanitizeVRMMaterialProperties: first chunk is not JSON');
  }

  const jsonBytes = new Uint8Array(glbBuffer, 20, jsonLen);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes));
  const materialsLen = Array.isArray(json.materials) ? json.materials.length : 0;
  const materialProperties = json.extensions?.VRM?.materialProperties;

  if (!Array.isArray(materialProperties) || materialsLen === 0) {
    return glbBuffer;
  }

  const filtered = materialProperties.filter((_: unknown, index: number) => index < materialsLen);
  if (filtered.length === materialProperties.length) {
    return glbBuffer;
  }

  json.extensions.VRM.materialProperties = filtered;
  logger.debug(
    `[vrm-loader] Removed ${materialProperties.length - filtered.length} stale VRM materialProperties entries`,
  );
  return writePatchedGlbJson(glbBuffer, json, jsonLen, version);
}

// ─── Texture quality + base mesh render settings ─────────────────────────────

const VRM_TEXTURE_MAP_KEYS = [
  'map',
  'normalMap',
  'shadeMultiplyTexture',
  'rimMultiplyTexture',
  'emissiveMap',
];

/**
 * Anisotropy 16 + trilinear mipmaps on a texture, so hair-strand textures
 * stop aliasing at grazing angles / small on-screen size. NOTE: deliberately
 * does NOT enable alphaToCoverage — on toon hair it discards low-alpha outer
 * strands aggressively, making the outer hair layer read as see-through.
 */
function applyTextureQualityToTexture(tex: THREE.Texture | null | undefined): void {
  if (!tex || typeof tex !== 'object' || !(tex as THREE.Texture).isTexture) return;
  let changed = false;
  if (tex.anisotropy < 16) {
    tex.anisotropy = 16;
    changed = true;
  }
  if (tex.minFilter !== THREE.LinearMipmapLinearFilter) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    changed = true;
  }
  if (tex.magFilter !== THREE.LinearFilter) {
    tex.magFilter = THREE.LinearFilter;
    changed = true;
  }
  if (changed) tex.needsUpdate = true;
}

export function applyVRMTextureQuality(vrm: VRM): void {
  const seen = new WeakSet<object>();
  vrm.scene.traverse((obj) => {
    for (const m of materialsOf(obj)) {
      for (const key of VRM_TEXTURE_MAP_KEYS) {
        const tex = m[key] as THREE.Texture | undefined;
        if (!tex || typeof tex !== 'object') continue;
        if (seen.has(tex)) continue;
        seen.add(tex);
        applyTextureQualityToTexture(tex);
      }
    }
  });
}

/**
 * Base per-mesh render settings (the Sara path of ami's `applyMToonSettings`
 * with `skipGhibliTweaks: true` — Sara is non-VRoid, so ami skips the warm
 * Ghibli MToon tint for her; that tweak set is dropped here entirely):
 *   - frustumCulled = false on every mesh with a material (skinned meshes
 *     animate outside their rest-pose bounds)
 *   - castShadow/receiveShadow on meshes with NO alpha-blend/alpha-test
 *     materials (alpha hair cards render as hard silhouettes in the shadow
 *     pass and self-shadow into streaks — skip them)
 */
function applyCompanionMeshSettings(vrm: VRM): void {
  vrm.scene.traverse((obj) => {
    const mats = materialsOf(obj);
    if (mats.length === 0) return;

    obj.frustumCulled = false;

    if ((obj as THREE.Mesh).isMesh) {
      const hasAlphaCutoutOrBlend = mats.some(
        (m) => m.transparent === true || (typeof m.alphaTest === 'number' && m.alphaTest > 0),
      );
      if (!hasAlphaCutoutOrBlend) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    }
  });
}

// ─── Rotation detection ──────────────────────────────────────────────────────

function detectAndApplyRotation(vrm: VRM): number {
  const metaVersion = vrm.meta?.metaVersion;

  const rotationBefore = vrm.scene.rotation.y;
  VRMUtils.rotateVRM0(vrm);
  const rotationAfter = vrm.scene.rotation.y;
  const wasRotated = Math.abs(rotationAfter - rotationBefore) > 0.01;

  logger.debug(
    `[vrm-loader] metaVersion=${metaVersion ?? 'undefined'} rotation before=${rotationBefore.toFixed(4)} after=${rotationAfter.toFixed(4)} rotatedByVRMUtils=${wasRotated}`,
  );

  if (!wasRotated) {
    // VRM 1.0 or unrecognized — use head bone direction as fallback.
    // NOTE: Only check when rotateVRM0 did NOT fire. Normalized bone world
    // quaternions don't include the scene root rotation, so checking after
    // rotateVRM0 would give a false "facing away" and double-rotate.
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
    if (headNode) {
      const worldDir = new THREE.Vector3(0, 0, -1);
      headNode.updateWorldMatrix(true, false);
      worldDir.applyQuaternion(headNode.getWorldQuaternion(new THREE.Quaternion()));

      // VRM 1.0 models face +Z at rest (toward camera) — only apply π if the
      // mesh genuinely faces away.
      const facingAway = worldDir.z > 0.5;
      if (facingAway) {
        vrm.scene.rotation.y = Math.PI;
        logger.debug('[vrm-loader] Applied π rotation — model was facing away from camera');
      }
    } else {
      logger.warn('[vrm-loader] No head bone found — cannot detect facing direction');
    }
  }

  return vrm.scene.rotation.y;
}

// ─── Sara-specific WebGL material fixes ──────────────────────────────────────
// Ported from ami's isSaraTomcatAsset / isTomcatChar blocks, WebGL branches
// only. Detection is content-based (mesh/material names) instead of ami's
// URL-substring matching, since hivemind asset URLs won't share ami's
// `tomcat/female-body-a/sara-lite/` path structure.

const SARA_SKIN_NAME_RE = /^Skin\.Sarah\.\d+(?:$|\s|\(|\.)|^Skin\.001(?:$|\s|\(|\.)/;
const SARA_BODY_FACE_MAT = /^(Brow_lash|eye-color|eye clear|Teeth_Tongue)/i;
const SARA_AUTHORED_BROW_LASH_MAT =
  /Sara_Authored_.*(?:Brow|Las|Lash)|Authored.*(?:Brow|Las|Lash)/i;
const SARA_TEXTURELESS_BROW_MAT = /^(Brow_lash_Sarah|Brows-01)/i;
const isSaraHeadObjectName = (name?: string): boolean => /^Sara-Head(?:$|_)/.test(name || '');

function isSaraModel(vrm: VRM): boolean {
  let found = false;
  vrm.scene.traverse((obj) => {
    if (found) return;
    if (isMeshLike(obj) && /^Sara-Body/.test(obj.name ?? '')) found = true;
  });
  return found;
}

/**
 * Remove ONLY the Sara-Body_1 triangles that are true duplicates of
 * Sara-Head's skin — all three vertices positionally identical (0.05mm
 * quantized) to a Sara-Head skin vertex. A flat "y > 1.45" cut would also
 * amputate 598 UNIQUE neck/throat triangles (y 1.44–1.58) that nothing else
 * re-covers (Sara-Head's front skin stops at the jaw, y≈1.577), leaving a
 * jagged see-through throat hole on open-neckline outfits.
 */
function removeSaraBodyDuplicateHeadTriangles(vrm: VRM, obj: THREE.Mesh): boolean {
  if (obj.name !== 'Sara-Body_1') return false;
  const geometry = obj.geometry;
  const position = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
  if (!geometry || !position) return false;

  const headPosition = (() => {
    let head: THREE.BufferAttribute | undefined;
    vrm.scene.traverse((node) => {
      if (head || !isMeshLike(node)) return;
      if (!isSaraHeadObjectName(node.name)) return;
      const mats = materialsOf(node);
      if (!mats.some((m) => SARA_SKIN_NAME_RE.test(m?.name || ''))) return;
      head = node.geometry?.attributes?.position as THREE.BufferAttribute | undefined;
    });
    return head;
  })();
  // No head skin found → nothing can be duplicated; cutting would only
  // amputate unique body geometry.
  if (!headPosition) return false;

  const quantize = (n: number) => Math.round(n * 20000);
  const headVertexKeys = new Set<string>();
  for (let i = 0; i < headPosition.count; i++) {
    headVertexKeys.add(
      `${quantize(headPosition.getX(i))},${quantize(headPosition.getY(i))},${quantize(headPosition.getZ(i))}`,
    );
  }
  const matchesHead = (v: number) =>
    headVertexKeys.has(
      `${quantize(position.getX(v))},${quantize(position.getY(v))},${quantize(position.getZ(v))}`,
    );

  const sourceIndex = geometry.index?.array;
  const indexCount = geometry.index?.count ?? position.count;
  const nextIndices: number[] = [];
  let removedTriangles = 0;
  const readIndex = (offset: number) => sourceIndex?.[offset] ?? offset;

  for (let offset = 0; offset + 2 < indexCount; offset += 3) {
    const a = readIndex(offset);
    const b = readIndex(offset + 1);
    const c = readIndex(offset + 2);
    // Cheap pre-filter: duplicated head geometry all sits above y 1.45.
    const centerY = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    if (centerY > 1.45 && matchesHead(a) && matchesHead(b) && matchesHead(c)) {
      removedTriangles++;
      continue;
    }
    nextIndices.push(a, b, c);
  }

  if (removedTriangles === 0) return false;
  const nextGeometry = geometry.clone();
  const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
  nextGeometry.setIndex(new THREE.BufferAttribute(new IndexArray(nextIndices), 1));
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  obj.geometry = nextGeometry;
  return true;
}

/**
 * Core Sara mesh/material pass:
 *   - hide Sara-Body face-feature primitives (they duplicate Sara-Head's and
 *     z-fight with it), both whole-primitive and per-material-slot
 *   - tune authored brow/lash alpha cards (alpha floors, no shadows,
 *     renderOrder, texture sampling)
 *   - remove Sara-Body triangles duplicated by Sara-Head skin
 *   - polygon-offset the body skin so co-planar clothing wins the depth test,
 *     plus max anisotropy on skin maps (UV-seam streak mitigation)
 */
function applySaraBodyAndFaceFixes(vrm: VRM): void {
  let hidPrims = 0;
  let hidFaceMaterialSlots = 0;
  let tunedAuthoredBrowLashSlots = 0;
  let clippedSaraBodyHeadPrims = 0;
  let offsetMats = 0;

  const hiddenSaraBodyFaceMaterial = new THREE.MeshBasicMaterial({
    name: 'Sara-Body duplicate face hidden',
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  hiddenSaraBodyFaceMaterial.visible = false;

  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    const allMats = materialsOf(obj);
    let hasAuthoredBrowLash = false;

    for (const m of allMats) {
      if (!m || !SARA_AUTHORED_BROW_LASH_MAT.test(m.name || '')) continue;
      hasAuthoredBrowLash = true;
      m.side = THREE.DoubleSide;
      const authoredCardAlphaFloor = /Las|Lash/i.test(m.name || '') ? 0.34 : 0.22;
      m.alphaTest = Math.max(typeof m.alphaTest === 'number' ? m.alphaTest : 0, authoredCardAlphaFloor);
      m.transparent = false;
      m.depthWrite = false;
      m.depthTest = true;
      m.toneMapped = false;
      m.dithering = false;
      m.alphaToCoverage = false;
      m.alphaHash = false;
      for (const key of ['map', 'alphaMap']) {
        const tex = m[key] as THREE.Texture | undefined;
        if (!tex?.isTexture) continue;
        tex.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        const isAuthoredBrow = /Brow/i.test(m.name || '');
        tex.generateMipmaps = isAuthoredBrow;
        tex.minFilter = isAuthoredBrow ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = isAuthoredBrow ? Math.max(tex.anisotropy ?? 1, 4) : 1;
        tex.needsUpdate = true;
      }
      m.needsUpdate = true;
      tunedAuthoredBrowLashSlots++;
    }
    if (hasAuthoredBrowLash) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.renderOrder = Math.max(obj.renderOrder ?? 0, 4);
    }

    // Match Sara-Body (any primitive index) but never Sara-BodyCut-*.
    if (!obj.name?.startsWith('Sara-Body') || obj.name.startsWith('Sara-BodyCut')) return;
    if (removeSaraBodyDuplicateHeadTriangles(vrm, obj as THREE.Mesh)) {
      clippedSaraBodyHeadPrims++;
    }
    const mats = allMats;
    const firstName = mats[0]?.name;
    if (!firstName) return;
    if (Array.isArray((obj as THREE.Mesh).material)) {
      let replacedSlot = false;
      (obj as THREE.Mesh).material = ((obj as THREE.Mesh).material as THREE.Material[]).map((m) => {
        if (!m || !SARA_BODY_FACE_MAT.test(m.name || '')) return m;
        hidFaceMaterialSlots++;
        replacedSlot = true;
        return hiddenSaraBodyFaceMaterial;
      });
      if (replacedSlot) {
        (obj as unknown as { needsUpdate?: boolean }).needsUpdate = true;
      }
    }
    if (SARA_BODY_FACE_MAT.test(firstName)) {
      obj.visible = false;
      hidPrims++;
      return;
    }
    // Body-skin primitive — modest polygon offset so co-planar clothing wins
    // the depth test (factor=2 fixes the under-sleeve z-fight without other
    // artifacts). Anisotropy on map/normalMap mitigates UV-seam mip bleed on
    // bare arms/legs (real fix would be re-baking with UV padding).
    for (const m of mats) {
      if (!m) continue;
      if (SARA_BODY_FACE_MAT.test(m.name || '')) continue;
      m.polygonOffset = true;
      m.polygonOffsetFactor = 2;
      m.polygonOffsetUnits = 2;
      const maxAniso = m.map?.image ? 16 : 0;
      const tex = m.map as THREE.Texture | undefined;
      if (tex) {
        tex.anisotropy = Math.max(tex.anisotropy ?? 1, maxAniso);
        tex.needsUpdate = true;
      }
      const normalTex = m.normalMap as THREE.Texture | undefined;
      if (normalTex) {
        normalTex.anisotropy = Math.max(normalTex.anisotropy ?? 1, maxAniso);
        normalTex.needsUpdate = true;
      }
      m.needsUpdate = true;
      offsetMats++;
    }
  });

  logger.debug(
    `[Sara] hid ${hidPrims} Sara-Body face primitives, ${hidFaceMaterialSlots} face material slots, ` +
      `tuned ${tunedAuthoredBrowLashSlots} authored brow/lash slots, ` +
      `clipped duplicate head triangles on ${clippedSaraBodyHeadPrims} body skin primitives, ` +
      `polygonOffset on ${offsetMats} body-skin material slots`,
  );
}

/**
 * Sara's brows include textureless PBR materials. When those stay lit, tint
 * colors render much lighter/different than authored. Convert only the
 * textureless brow materials to unlit MeshBasicMaterial; textured lashes
 * keep their authored alpha.
 */
function convertSaraTexturelessBrows(vrm: VRM): void {
  let browConverted = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    const mats = materialsOf(obj);
    const nextMats = mats.map((m) => {
      if (!m || !SARA_TEXTURELESS_BROW_MAT.test(m.name || '') || m.map) return m;
      const basic: AnyMaterial = new THREE.MeshBasicMaterial({
        name: m.name,
        color: m.color ? (m.color as THREE.Color).clone() : new THREE.Color(0xffffff),
        transparent: !!m.transparent,
        alphaTest: typeof m.alphaTest === 'number' ? m.alphaTest : 0,
        side: m.side,
        depthWrite: m.depthWrite,
        opacity: typeof m.opacity === 'number' ? m.opacity : 1,
      });
      basic.userData = { ...m.userData };
      basic.toneMapped = false;
      basic.needsUpdate = true;
      browConverted++;
      return basic;
    });
    const mesh = obj as THREE.Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? (nextMats as THREE.Material[])
      : (nextMats[0] as THREE.Material);
  });
  logger.debug(`[Sara brows] converted ${browConverted} textureless brow mats to unlit`);
}

/**
 * IBL brightness lever for Sara's PBR materials: envMapIntensity 0.6 (ami
 * v39 value for the legacy WebGL shader pipeline — the inline ACES+sRGB
 * injection below already compensates for the linear-output pipeline, so a
 * higher env intensity would double-dip).
 */
function applySaraEnvIntensity(vrm: VRM): void {
  const SARA_ENV_INTENSITY = 0.6;
  let pbrHits = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    for (const m of materialsOf(obj)) {
      if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) {
        m.envMapIntensity = SARA_ENV_INTENSITY;
        m.needsUpdate = true;
        pbrHits++;
      }
    }
  });
  logger.debug(`[Sara] envMapIntensity=${SARA_ENV_INTENSITY} on ${pbrHits} PBR materials`);
}

/**
 * Sara ponytail strand alpha boost. The hair cards have a soft alpha
 * gradient along each strand; with MASK at cutoff 0.05 only ~30% of pixels
 * render — the inside of the ponytail looks hollow. Apply pow(alpha, 0.2)
 * BEFORE the alphaTest comparison so soft strand fades pass the cutoff and
 * the ponytail volume fills in. Targets only the strand mesh (Cylinder.009 /
 * Fem-A_Hair-20A_Ponytail node); the scalp cap is opaque and needs no boost.
 * NOTE: runs BEFORE the hair → MeshBasic conversion; the flag set here makes
 * the conversion re-attach the boost to the new MeshBasicMaterial.
 */
function applySaraPonytailAlphaBoost(vrm: VRM): void {
  const STRAND_NODE_NAMES = new Set(['Fem-A_Hair-20A_Ponytail', 'Cylinder009', 'Cylinder.009']);
  const ancestorMatch = (obj: THREE.Object3D, names: Set<string>): boolean => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (names.has(cur.name)) return true;
      cur = cur.parent;
    }
    return false;
  };
  let hits = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    if (!ancestorMatch(obj, STRAND_NODE_NAMES)) return;
    const mats = materialsOf(obj);
    const newMats = mats.map((m) => {
      if (!m) return m;
      const cloned = m.clone() as AnyMaterial;
      cloned.userData.__strandAlphaBoost = true;
      cloned.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphatest_fragment>',
          `
            diffuseColor.a = pow(diffuseColor.a, 0.2);
            #include <alphatest_fragment>
          `,
        );
      };
      cloned.needsUpdate = true;
      hits++;
      return cloned;
    });
    const mesh = obj as THREE.Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? (newMats as THREE.Material[])
      : (newMats[0] as THREE.Material);
  });
  logger.debug(`[Sara ponytail] alpha boost on ${hits} strand mats`);
}

/**
 * Sara hair → MeshBasicMaterial (true unlit). The hair was authored with
 * KHR_materials_unlit + baked Pixar-look textures — painted highlights and
 * shading live in the albedo. three-vrm auto-promotes unlit→MToon at load,
 * and MToon layers its own shading on top; combined with tone mapping the
 * result reads as a uniform plastic blob. MeshBasic bypasses both: the
 * texture passes through exactly as authored.
 *
 * Two shader patches on the replacement material:
 *   1. (strand mats flagged above) pow(alpha, 0.2) before alphatest.
 *   2. (all hair) sRGB OETF on output — replaces <colorspace_fragment> so
 *      linear texture values reach the framebuffer gamma-encoded regardless
 *      of the renderer's output-encoding path, matching the ACES injection
 *      applied to the rest of the character.
 */
function convertSaraHairToUnlit(vrm: VRM): void {
  let hairConverted = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    let isHair = false;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (typeof cur.name === 'string' && /hair/i.test(cur.name)) {
        isHair = true;
        break;
      }
      cur = cur.parent;
    }
    if (!isHair) return;
    const mats = materialsOf(obj);
    const newMats = mats.map((m) => {
      if (!m || !(m.isMToonMaterial || m.isMeshStandardMaterial)) return m;
      const basic: AnyMaterial = new THREE.MeshBasicMaterial({
        name: m.name,
        map: m.map ?? null,
        color: m.color ? (m.color as THREE.Color).clone() : new THREE.Color(0xffffff),
        transparent: !!m.transparent,
        alphaTest: typeof m.alphaTest === 'number' ? m.alphaTest : 0,
        side: m.side,
        depthWrite: m.depthWrite,
        opacity: typeof m.opacity === 'number' ? m.opacity : 1,
      });
      basic.userData = { ...m.userData };
      basic.toneMapped = false;
      basic.onBeforeCompile = (shader) => {
        if (m.userData?.__strandAlphaBoost) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <alphatest_fragment>',
            `
              diffuseColor.a = pow(diffuseColor.a, 0.2);
              #include <alphatest_fragment>
            `,
          );
        }
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <colorspace_fragment>',
          `
            gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
          `,
        );
      };
      basic.needsUpdate = true;
      hairConverted++;
      return basic;
    });
    const mesh = obj as THREE.Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? (newMats as THREE.Material[])
      : (newMats[0] as THREE.Material);
  });
  logger.debug(`[Sara hair] converted ${hairConverted} mats to MeshBasic (true unlit)`);
}

/**
 * Sara face contour shading — fixes "flat face under fill light". Her normal
 * map is uniformly flat (contours were painted into albedo), so under PBR a
 * dim or back-lit scene makes the face read featureless. Injects a fake
 * view-aligned wrap key into the skin fragment shader: top-down shading from
 * the geometric face curvature against a light slightly above the camera,
 * plus view-grazing rim darkening for silhouette definition. Multiplied into
 * diffuseColor before the lighting model so it composes with any pipeline.
 */
function applySaraFaceContour(vrm: VRM): void {
  let skinHits = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    const mats = materialsOf(obj);
    const newMats = mats.map((m) => {
      if (!m || !m.isMeshStandardMaterial) return m;
      if (!SARA_SKIN_NAME_RE.test(m.name || '')) return m;
      const cloned = m.clone() as AnyMaterial;
      cloned.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
            #include <map_fragment>
            {
              vec3 nrm = normalize(vNormal);
              vec3 viewDir = normalize(vViewPosition);
              // Fake key light slightly above the camera ray. y-bias gives
              // top-down face shading regardless of scene lights.
              vec3 fakeKey = normalize(viewDir + vec3(0.0, 0.6, 0.0));
              float ndotl = dot(nrm, fakeKey);
              // Wrap-shaded: remap [-1,1] → [0.74, 1.0]. Tuned against the
              // ACES output injection (which brightens midtones) so ±13%
              // wrap darkening defines contours without dimming skin.
              float wrapped = ndotl * 0.13 + 0.87;
              // View-grazing rim darkening — silhouette definition at the
              // face/neck transition.
              float ndotv = max(0.0, dot(nrm, viewDir));
              float rim = 1.0 - ndotv;
              float rimDarken = 1.0 - pow(rim, 1.5) * 0.15;
              diffuseColor.rgb *= wrapped * rimDarken;
            }
          `,
        );
      };
      cloned.needsUpdate = true;
      skinHits++;
      return cloned;
    });
    const mesh = obj as THREE.Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? (newMats as THREE.Material[])
      : (newMats[0] as THREE.Material);
  });
  logger.debug(`[Sara skin contour] view-aligned wrap shading on ${skinHits} skin mats`);
}

/**
 * Force-ACES+sRGB output on every lit Sara material. Sara was authored
 * against an ACES filmic + sRGB pipeline; without it her midtones crush and
 * colors desaturate ("uniform" skin, blush blends into surrounding tone).
 * Replaces `<colorspace_fragment>` with an inline ACES filmic approximation
 * (Stephen Hill matrices, 0.85/0.6 scene-linear exposure — ami v39 values)
 * followed by gamma-2.2 encoding. Hair is already MeshBasic (converted
 * above) and drops out automatically — ACES applies to lit materials only.
 * Materials touched here get `toneMapped = false` so a renderer-level tone
 * mapper can never double-apply on top (deviation from ami, which relied on
 * its renderer running NoToneMapping).
 */
function applySaraAcesOutput(vrm: VRM): void {
  let srgbHits = 0;
  vrm.scene.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    for (const m of materialsOf(obj)) {
      if (!m) continue;
      if (!m.isMeshStandardMaterial && !m.isMToonMaterial) continue;
      // Extend onBeforeCompile, not replace — the skin contour hook above may
      // have installed one on her skin mats. Chain them.
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        if (prev) prev.call(m, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <colorspace_fragment>',
          `
            {
              // Inline ACES filmic tone mapping (0.85 / 0.6 scene-linear
              // denominator for the Stephen Hill matrices three.js uses).
              vec3 _c = gl_FragColor.rgb * (0.85 / 0.6);
              mat3 _ACES_IN = mat3(
                vec3(0.59719, 0.07600, 0.02840),
                vec3(0.35458, 0.90834, 0.13383),
                vec3(0.04823, 0.01566, 0.83777)
              );
              mat3 _ACES_OUT = mat3(
                vec3( 1.60475, -0.10208, -0.00327),
                vec3(-0.53108,  1.10813, -0.07276),
                vec3(-0.07367, -0.00605,  1.07602)
              );
              vec3 _aces = _ACES_IN * _c;
              vec3 _a = _aces * (_aces + 0.0245786) - 0.000090537;
              vec3 _b = _aces * (0.983729 * _aces + 0.432951) + 0.238081;
              _aces = _a / _b;
              _aces = clamp(_ACES_OUT * _aces, 0.0, 1.0);
              // sRGB OETF (gamma 2.2 approximation).
              gl_FragColor.rgb = pow(_aces, vec3(1.0 / 2.2));
            }
          `,
        );
      };
      m.toneMapped = false;
      m.needsUpdate = true;
      srgbHits++;
    }
  });
  logger.debug(`[Sara ACES+sRGB] applied to ${srgbHits} lit materials`);
}

// ─── Main loader ─────────────────────────────────────────────────────────────

/**
 * Load a companion VRM (WebGL pipeline). Fetches the file, sanitizes stale
 * VRM0 materialProperties, parses with meshopt decoding + the default
 * three-vrm WebGL MToon plugin, runs VRM optimization + the Sara material
 * pipeline + post-load hooks, corrects VRM0/VRM1 facing, and returns the
 * pieces an engine composes controllers around.
 *
 * Does NOT add vrm.scene to any THREE.Scene — the caller owns composition.
 * Does NOT construct lip-sync/blink/expression/procedural controllers.
 */
export async function loadCompanionVRM(
  url: string,
  opts?: CompanionVRMLoadOptions,
): Promise<CompanionVRMLoadResult> {
  const loader = new GLTFLoader();
  loader.crossOrigin = 'anonymous';
  // The Sara VRM is meshopt-compressed (EXT_meshopt_compression) — decoding
  // support is load-bearing, not optional.
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(
    (parser) =>
      new VRMLoaderPlugin(parser, {
        autoUpdateHumanBones: true,
        // No mtoonMaterialPlugin override → default WebGL MToonMaterial.
      }),
  );

  // Manual fetch + parseAsync (not loadAsync): the buffer must pass through
  // sanitizeVRMMaterialProperties before three-vrm sees it.
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`[vrm-loader] fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  const raw = await response.arrayBuffer();
  const sanitized = sanitizeVRMMaterialProperties(raw);
  const path = url.substring(0, url.lastIndexOf('/') + 1);
  const gltf = await loader.parseAsync(sanitized, path);

  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error(`[vrm-loader] File has no VRM extension data: ${url}`);
  }

  // Optimize: drop unused morph-only vertex data, merge the per-mesh
  // skeletons into one (fewer bind-matrix uploads per frame).
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);

  // Texture quality + base render settings. Sara is non-VRoid, so ami's
  // Ghibli MToon tint pass is intentionally absent (ami skips it for her via
  // the cinematic registry; we dropped the tweak set entirely).
  applyVRMTextureQuality(vrm);
  applyCompanionMeshSettings(vrm);

  // Sara WebGL material pipeline (order matters — see individual docs).
  if (isSaraModel(vrm)) {
    applySaraBodyAndFaceFixes(vrm);
    convertSaraTexturelessBrows(vrm);
    applySaraEnvIntensity(vrm);
    applySaraPonytailAlphaBoost(vrm);
    convertSaraHairToUnlit(vrm);
    applySaraFaceContour(vrm);
    applySaraAcesOutput(vrm);
  }

  // Position/scale (caller adds vrm.scene to its scene). ami also offset
  // z=+0.5 for its home-room camera framing — dropped as scene-specific.
  vrm.scene.position.set(0, opts?.characterPositionY ?? 0, 0);
  vrm.scene.scale.setScalar(opts?.characterScale ?? 1);

  // Per-character post-load hooks (clipping-fix plumbing, BodyCut hides).
  postLoadVRM(vrm, url);

  // Detect VRM version and apply correct facing rotation.
  const baseRotationY = detectAndApplyRotation(vrm);

  // Rest-pose hips (animation retargeting anchor).
  let initialHipsPosition: THREE.Vector3 | null = null;
  const hipsNode = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (hipsNode) {
    initialHipsPosition = hipsNode.position.clone();
  }

  const mixer = new THREE.AnimationMixer(vrm.scene);

  logger.info(`[vrm-loader] VRM loaded: ${url.split('/').pop() ?? url}`);

  return { vrm, gltf, mixer, baseRotationY, initialHipsPosition };
}
