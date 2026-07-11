/**
 * Sara Lite default-outfit composer — minimal WebGL port of
 * ami-ai-companion's external-outfit system (`src/lib/utils/
 * externalOutfitLoader.ts` + the wardrobe apply path in
 * `src/lib/utils/vrm-outfit-apply.ts`), trimmed to the one job the hivemind
 * companion needs: dress the Sara Lite base VRM in her default outfit.
 *
 * Default outfit (per Liam): ami's "Peak Dress" default-sara entry
 * (character-outfits.ts; `withSaraLiteAssets` leaves it unchanged — it is
 * already an external GLB shared by the monolith and Lite bases):
 *   - GLB: outfits/retargeted/tomcat-peakdress.opaque.glb — one skinned
 *     mesh (`PeakDress_Verify`, material `PeakDress`, double-sided PBR with
 *     KHR_materials_specular/ior). `.opaque.glb` is ami's default variant;
 *     the BLEND-mode see-thru fabric (tomcat-peakdress.glb) is not used, so
 *     no translucency handling applies on this path.
 *   - Default textures are EMBEDDED in the GLB: albedo
 *     `Dress-peak-alb-09b-solid` (the "Solid Rose" entry of ami's
 *     SARA_PEAK_DRESS_TEXTURES) + `Dress-peak-normal-01` +
 *     `Dress-peak-rough-01`. ami applies texture variants only on explicit
 *     wardrobe picks — a fresh load renders the embedded maps — so the
 *     default look needs no texture fetch or swap.
 *   - NO BodyCut flips (no SARA_LITE_KEEP_BAKED_BY_NAME entry) and NO body
 *     morphs (unlike the V-Dress, the Peak Dress entry has no
 *     `bodyMorphTargets`). Barefoot, same as picking Peak Dress in ami.
 *   - Chest fit-up (ami: growOutfitChestToBody): the Peak Dress was
 *     authored on the flatter Tomcat base body and retargeted to Sara —
 *     without growing the dress chest outward along the body's authored
 *     `Smaller.breast` morph field (inverted), Sara's bust pokes through
 *     the fabric at default size. Runs at rest pose after rebind, gated on
 *     the GLB lacking a baked `Smaller.breast` morph (mirroring ami's
 *     skip-if-baked check; this GLB ships no morphs — verified).
 *   - Chest-coverage hide boxes (ami character-body-hide-regions.ts,
 *     default-sara/chest) applied via the clipping fixer from
 *     ./vrm-post-load: two ungated nipple-bump boxes + three vest-gated
 *     boxes (`requiresMeshVisible: 'Sara-Vest'` — never fire under a
 *     dress; inlined so a future swap back to a vest outfit keeps them).
 *
 * Attach mechanism (ported from `loadExternalOutfitInner` +
 * `rebindSkinnedMesh`, same-character mode):
 *   1. Load the GLB with GLTFLoader + meshopt (the outfit GLBs are
 *      EXT_meshopt_compression, same as the base VRM).
 *   2. De-interleave vertex attributes (defensive; ami does this eagerly).
 *   3. Re-parent each SkinnedMesh under vrm.scene, THEN rebind: build a new
 *      THREE.Skeleton whose bones are the VRM's own bones resolved by NAME
 *      (with alias + ancestor-walk fallback), boneInverses captured from the
 *      VRM bones' rest-pose matrixWorld, and `mesh.bind(skeleton,
 *      mesh.matrixWorld)`. The VRM is snapped to its authored rest pose for
 *      the capture and restored afterwards. For the Peak Dress GLB all 123
 *      joint names exist verbatim on the Sara Lite v148 skeleton (verified);
 *      the alias table + closest-named-ancestor fallback remain as safety
 *      nets for other outfit GLBs (the V-Dress, e.g., needs 14 aliases).
 *   4. Material prep matches ami's external-outfit WebGL path: toneMapped=
 *      false, albedo → sRGB, polygonOffset −2 (clothing wins the body's +2),
 *      and the vest/shirt depth-bias layering (self-gated on BPvest/Tshirt
 *      material names — inert for the single-material V-Dress). DEVIATION:
 *      the sRGB-OETF fragment patch is applied to ALL external outfits here;
 *      ami gates it on `/sara-lite/` paths (so ami's V-Dress skips it and
 *      relies on renderer output encoding). Patching unconditionally keeps
 *      clothing brightness renderer-independent and matched to the body's
 *      self-encoding ACES/OETF materials; under a default sRGB-output
 *      renderer the two paths are visually equivalent.
 *
 * Deliberately dropped from ami (not needed for this outfit): body-fit
 * Y/X offsets (Peak Dress anchors on Left_shoulder with sourceY measured on
 * Sara's own VRM → same-character delta ≈ 0), outfit spring bones (GLB has
 * none), the `Smaller.breast` SHRINK-morph synthesis + morph-influence sync
 * (slider-driven; no body sliders here, influences stay 0 — only the
 * unconditional chest GROW fit-up is ported), undergarment auto-layers,
 * WebGPU branches, hideBakedMeshes (the meshes it names only exist in the
 * old monolithic Sara VRM, not the Lite base).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { VRM } from '@pixiv/three-vrm';
import { logger } from './logger';
import { getCompanionVRMClippingFixer, type HideBoxSpec } from './vrm-post-load';

// ─── Default outfit data (Sara-only) ─────────────────────────────────────────

/** CDN path (ami `/assets/...` form) of the default outfit GLB — V-Dress
 *  opaque variant (ami: character-outfits.ts 'V-Dress' externalGlbPath;
 *  the BLEND see-thru sara-vdress.glb stays a wardrobe option). */
export const SARA_DEFAULT_OUTFIT_GLB_PATH =
  '/assets/models/vrm/tomcat/female-body-a/outfits/retargeted/sara-vdress.opaque.glb';

/** Baked BodyCut meshes made visible while the default outfit is worn.
 *  EMPTY for the V-Dress — ami's SARA_LITE_KEEP_BAKED_BY_NAME has no entry
 *  for it; the dress is worn over the bare full-body skin. (For reference,
 *  the Detective (Vest) outfit used ['Sara-BodyCut-BH-Vest',
 *  'Sara-BodyCut-BF-Jeans'].) */
export const SARA_DEFAULT_OUTFIT_KEEP_BODYCUTS: string[] = [];

/** Body morph influences held while the outfit is worn. V-Dress: the
 *  authored pelvis-clearance fix that stops groin/hip skin poking through
 *  the hem (ami `bodyMorphTargets`; verified present on every v148 body
 *  mesh). Reset to 0 on dispose. */
export const SARA_DEFAULT_OUTFIT_BODY_MORPHS: Record<string, number> = {
  'Smaller.Pelvis': 2,
};

/** Everything outfit-specific the composer needs to dress Sara. */
export interface SaraOutfitSpec {
  key: string;
  label: string;
  /** CDN path in ami `/assets/...` form. */
  glbPath: string;
  /** BodyCut meshes to show while worn (hidden again on dispose). */
  keepBodyCuts: string[];
  /** Body morph influences held while worn (reset on dispose). */
  bodyMorphs: Record<string, number>;
  /** Grow the chest to the body's bust (Tomcat-base retargets only). */
  chestGrow: boolean;
}

/** Sara's wardrobe — the outfits verified on the CDN. First entry = default. */
export const SARA_OUTFITS: SaraOutfitSpec[] = [
  {
    key: 'outfit-v-dress',
    label: 'V-Dress',
    glbPath: SARA_DEFAULT_OUTFIT_GLB_PATH,
    keepBodyCuts: SARA_DEFAULT_OUTFIT_KEEP_BODYCUTS,
    bodyMorphs: SARA_DEFAULT_OUTFIT_BODY_MORPHS,
    chestGrow: false,
  },
  {
    key: 'outfit-peak-dress',
    label: 'Peak Dress',
    glbPath: '/assets/models/vrm/tomcat/female-body-a/outfits/retargeted/tomcat-peakdress.opaque.glb',
    keepBodyCuts: [],
    bodyMorphs: {},
    // Retargeted from the flatter Tomcat base — without the grow, Sara's
    // bust pokes through the fabric (see growOutfitChestToBody).
    chestGrow: true,
  },
  {
    key: 'outfit-detective-vest',
    label: 'Detective (Vest)',
    glbPath: '/assets/models/vrm/tomcat/female-body-a/sara-lite/sara-detective-vest.glb',
    keepBodyCuts: ['Sara-BodyCut-BH-Vest', 'Sara-BodyCut-BF-Jeans'],
    bodyMorphs: {},
    chestGrow: false,
  },
];

export function saraOutfitByKey(key: string | undefined): SaraOutfitSpec {
  return SARA_OUTFITS.find((outfit) => outfit.key === key) ?? SARA_OUTFITS[0];
}

/** Chest-coverage body hide boxes (ami: character-body-hide-regions.ts,
 *  default-sara → chest; Peak Dress coverage includes 'chest'). Applied
 *  through the clipping fixer installed by ./vrm-post-load. Sara's `bottom`
 *  region is intentionally empty in ami. */
export const SARA_CHEST_COVERAGE_HIDE_BOXES: HideBoxSpec[] = [
  // Nipple bumps — ungated: correct under ANY chest-covering top.
  { center: [-0.045, 1.331, 0.085], size: [0.05, 0.04, 0.05] },
  { center: [0.045, 1.331, 0.085], size: [0.05, 0.04, 0.05] },
  // Vest-only torso/underarm tucks — gated on the baked vest mesh being
  // visible, so they can never cave in the V-Dress décolleté/neck skin
  // (that regression is exactly why ami added the gate).
  { center: [0, 1.245, 0.02], size: [0.38, 0.28, 0.22], requiresMeshVisible: 'Sara-Vest' },
  { center: [-0.185, 1.305, 0.015], size: [0.14, 0.25, 0.2], requiresMeshVisible: 'Sara-Vest' },
  { center: [0.185, 1.305, 0.015], size: [0.14, 0.25, 0.2], requiresMeshVisible: 'Sara-Vest' },
];

// Vest/shirt depth layering (ami: EXTERNAL_TOP_* constants). The vest and
// shirt are near-co-planar surfaces in the same meshes; the vest must win.
const EXTERNAL_TOP_OCCLUDER_MATERIAL_RE = /BPvest|^Coat_simple(?:$|\.(?!shirt))/i;
const EXTERNAL_TOP_SHIRT_MATERIAL_RE = /Tshirt|Coat_simple\.shirt/i;

/** Render order for a fullBody clothing layer (ami slotRenderOrder). */
const FULL_BODY_RENDER_ORDER = 3;

// Bone-name aliases (ami: BONE_NAME_ALIASES, verbatim). The V-Dress GLB
// needs the c_thigh/c_calf/c_upperarm/c_lowerarm entries (its twist-helper
// joints use the raw rig names); the rest keep the composer working
// unchanged for the other Sara outfit GLBs (detective vest, coat, skirt, …).
const BONE_NAME_ALIASES: Record<string, string[]> = {
  c_breast_01_l: ['Breast_01_l'],
  c_breast_01_r: ['Breast_01_r'],
  c_breast_02_l: ['Breast_02_l'],
  c_breast_02_r: ['Breast_02_r'],
  Breast_01_l: ['c_breast_01_l'],
  Breast_01_r: ['c_breast_01_r'],
  Breast_02_l: ['c_breast_02_l'],
  Breast_02_r: ['c_breast_02_r'],
  pelvis: ['Hips'],
  spine_01: ['Spine'],
  spine_02: ['Chest'],
  spine_03: ['UpperChest'],
  spine_04: ['Spine_04'],
  spine_05: ['Neck_Base', 'Neck'],
  neck_01: ['Neck'],
  head: ['Head'],
  thigh_l: ['Left_upperleg'],
  thigh_r: ['Right_upperleg'],
  calf_l: ['Left_lowerleg'],
  calf_r: ['Right_lowerleg'],
  foot_l: ['Left_foot'],
  foot_r: ['Right_foot'],
  ball_l: ['Left_toes'],
  ball_r: ['Right_toes'],
  clavicle_l: ['Left_shoulder'],
  clavicle_r: ['Right_shoulder'],
  upperarm_l: ['Left_upperarm'],
  upperarm_r: ['Right_upperarm'],
  lowerarm_l: ['Left_lowerarm'],
  lowerarm_r: ['Right_lowerarm'],
  hand_l: ['Left_hand'],
  hand_r: ['Right_hand'],
  c_upperarm_l: ['Left_upperarm_twist', 'upperarm_twist_01_l', 'Left_upperarm'],
  c_upperarm_r: ['Right_upperarm_twist', 'upperarm_twist_01_r', 'Right_upperarm'],
  c_lowerarm_l: ['Left_lowerarm_twist', 'lowerarm_twist_01_l', 'Left_lowerarm'],
  c_lowerarm_r: ['Right_lowerarm_twist', 'lowerarm_twist_01_r', 'Right_lowerarm'],
  thumb_01_l: ['Left_thumb_proximal'],
  thumb_01_r: ['Right_thumb_proximal'],
  thumb_02_l: ['Left_thumb_intermediate'],
  thumb_02_r: ['Right_thumb_intermediate'],
  thumb_03_l: ['Left_thumb_distal'],
  thumb_03_r: ['Right_thumb_distal'],
  index_01_l: ['Left_index_proximal'],
  index_01_r: ['Right_index_proximal'],
  index_02_l: ['Left_index_intermediate'],
  index_02_r: ['Right_index_intermediate'],
  index_03_l: ['Left_index_distal'],
  index_03_r: ['Right_index_distal'],
  middle_01_l: ['Left_middle_proximal'],
  middle_01_r: ['Right_middle_proximal'],
  middle_02_l: ['Left_middle_intermediate'],
  middle_02_r: ['Right_middle_intermediate'],
  middle_03_l: ['Left_middle_distal'],
  middle_03_r: ['Right_middle_distal'],
  ring_01_l: ['Left_ring_proximal'],
  ring_01_r: ['Right_ring_proximal'],
  ring_02_l: ['Left_ring_intermediate'],
  ring_02_r: ['Right_ring_intermediate'],
  ring_03_l: ['Left_ring_distal'],
  ring_03_r: ['Right_ring_distal'],
  pinky_01_l: ['Left_little_proximal'],
  pinky_01_r: ['Right_little_proximal'],
  pinky_02_l: ['Left_little_intermediate'],
  pinky_02_r: ['Right_little_intermediate'],
  pinky_03_l: ['Left_little_distal'],
  pinky_03_r: ['Right_little_distal'],
  Left_leg: ['Left_upperleg'],
  Right_leg: ['Right_upperleg'],
  Left_knee: ['Left_lowerleg'],
  Right_knee: ['Right_lowerleg'],
  Left_ankle: ['Left_foot'],
  Right_ankle: ['Right_foot'],
  Left_toe: ['Left_toes'],
  Right_toe: ['Right_toes'],
  Thigh_Twist_l: ['thigh_twist_01_l', 'Left_upperleg_twist', 'Left_upperleg'],
  Thigh_Twist_r: ['thigh_twist_01_r', 'Right_upperleg_twist', 'Right_upperleg'],
  Leg_Twist_l: ['calf_twist_01_l', 'Left_lowerleg_twist', 'Left_lowerleg'],
  Leg_Twist_r: ['calf_twist_01_r', 'Right_lowerleg_twist', 'Right_lowerleg'],
  'Thigh_Twist_l.001': ['thigh_twist_02_l', 'Left_upperleg_twist', 'Left_upperleg'],
  'Thigh_Twist_r.001': ['thigh_twist_02_r', 'Right_upperleg_twist', 'Right_upperleg'],
  'Leg_Twist_l.001': ['calf_twist_02_l', 'Left_lowerleg_twist', 'Left_lowerleg'],
  'Leg_Twist_r.001': ['calf_twist_02_r', 'Right_lowerleg_twist', 'Right_lowerleg'],
  c_thigh_l: ['Left_upperleg_twist', 'thigh_twist_01_l', 'Left_upperleg'],
  c_thigh_r: ['Right_upperleg_twist', 'thigh_twist_01_r', 'Right_upperleg'],
  c_calf_l: ['Left_lowerleg_twist', 'calf_twist_02_l', 'Left_lowerleg'],
  c_calf_r: ['Right_lowerleg_twist', 'calf_twist_02_r', 'Right_lowerleg'],
  Left_arm: ['Left_upperarm'],
  Right_arm: ['Right_upperarm'],
  Left_elbow: ['Left_lowerarm'],
  Right_elbow: ['Right_lowerarm'],
  Left_wrist: ['Left_hand'],
  Right_wrist: ['Right_hand'],
  'Left shoulder': ['Left_shoulder'],
  'Right shoulder': ['Right_shoulder'],
  'Left arm': ['Left_upperarm'],
  'Right arm': ['Right_upperarm'],
  'Left elbow': ['Left_lowerarm'],
  'Right elbow': ['Right_lowerarm'],
  'Left wrist': ['Left_hand'],
  'Right wrist': ['Right_hand'],
  'Left leg': ['Left_upperleg'],
  'Right leg': ['Right_upperleg'],
  'Left knee': ['Left_lowerleg'],
  'Right knee': ['Right_lowerleg'],
  'Left ankle': ['Left_foot'],
  'Right ankle': ['Right_foot'],
  'Left toe': ['Left_toes'],
  'Right toe': ['Right_toes'],
  Arm_Twist_l: ['Left_upperarm_twist'],
  Arm_Twist_r: ['Right_upperarm_twist'],
  Forearm_Twist_l: ['Left_lowerarm_twist'],
  Forearm_Twist_r: ['Right_lowerarm_twist'],
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SaraOutfitHandle {
  /** Wardrobe key of the outfit being worn (SARA_OUTFITS). */
  outfitKey: string;
  /** Resolved URL the GLB was loaded from. */
  glbUrl: string;
  /** SkinnedMeshes attached under vrm.scene. */
  meshes: THREE.SkinnedMesh[];
  /** Remove the outfit meshes, free their GPU resources, and re-hide the
   *  BodyCut meshes this outfit made visible. */
  dispose: () => void;
}

type AnyMaterial = THREE.Material & { [key: string]: any };

const OUTFIT_HANDLE_KEY = '__companionSaraOutfitHandle';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function materialsOf(mesh: THREE.Mesh): AnyMaterial[] {
  if (!mesh.material) return [];
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as AnyMaterial[];
}

/**
 * Replace every InterleavedBufferAttribute with a standalone BufferAttribute
 * (skinIndex as Uint32, everything else Float32). Defensive parity with ami —
 * the detective-vest GLB already stores per-attribute buffers, but some
 * sara-lite extracts (V-Dress family) interleave everything into one view.
 */
function deinterleaveSkinnedGeometry(geometry: THREE.BufferGeometry): void {
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const interleaved = attr as THREE.InterleavedBufferAttribute;
    if (!interleaved?.isInterleavedBufferAttribute) continue;
    const count = interleaved.count;
    const itemSize = interleaved.itemSize;
    if (name === 'skinIndex') {
      // MUST be Uint16 (or Uint8): glTF JOINTS_0 is never wider, and three
      // feeds skinIndex through the float vertexAttribPointer path, where
      // WebGL2 rejects UNSIGNED_INT — a Uint32 attribute here makes Chrome
      // kill every draw of the mesh with a silent INVALID_OPERATION (the
      // V-Dress invisibility bug; found by GPU-side bisection 2026-07-11).
      const out = new Uint16Array(count * itemSize);
      for (let v = 0; v < count; v++) {
        for (let k = 0; k < itemSize; k++) {
          out[v * itemSize + k] = Math.min(65535, Math.max(0, interleaved.getComponent(v, k)));
        }
      }
      geometry.setAttribute(name, new THREE.Uint16BufferAttribute(out, itemSize));
      continue;
    }
    const out = new Float32Array(count * itemSize);
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < itemSize; k++) {
        out[v * itemSize + k] = interleaved.getComponent(v, k);
      }
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(out, itemSize));
  }
}

/**
 * sRGB OETF fragment patch for Sara Lite external clothing (ami:
 * patchSaraLiteExternalMaterial). The body renders through an inline
 * ACES/OETF injection; without the matching encode the clothing reads ~45%
 * darker than the skin next to it. `customProgramCacheKey` is extended so
 * three.js compiles a distinct program for patched materials.
 */
function patchSaraLiteExternalMaterial(material: AnyMaterial): void {
  if (!material || material.userData?.__saraLiteExternalOetfPatched) return;
  if (!material.isMeshBasicMaterial && !material.isMeshStandardMaterial && !material.isMToonMaterial) {
    return;
  }

  const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `
        gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
      `,
    );
  };
  material.customProgramCacheKey = () => {
    const previous = previousCacheKey ? previousCacheKey() : '';
    return `${previous}|sara-lite-external-oetf-v1`;
  };
  material.userData.__saraLiteExternalOetfPatched = true;
}

/**
 * Vest-over-shirt depth bias (ami: applyExternalTopMaterialDepthBias, WebGL
 * branch). The vest (BPvest) and shirt (Tshirt) are near-co-planar in the
 * same mesh; bias the vest slightly forward and draw shirt groups first so
 * the vest wins the depth test. Returns true when this mesh got the bias
 * (its materials then skip the generic −2 clothing offset).
 */
function applyExternalTopMaterialDepthBias(mesh: THREE.Mesh): boolean {
  const materials = materialsOf(mesh);
  const hasOuter = materials.some((m) => EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(m?.name || ''));
  const hasShirt = materials.some((m) => EXTERNAL_TOP_SHIRT_MATERIAL_RE.test(m?.name || ''));
  if (!hasOuter || !hasShirt) return false;

  for (const material of materials) {
    if (!material) continue;
    material.depthTest = true;
    material.polygonOffset = true;
    material.depthWrite = true;
    if (EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(material.name || '')) {
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1;
    } else if (EXTERNAL_TOP_SHIRT_MATERIAL_RE.test(material.name || '')) {
      material.polygonOffsetFactor = 0;
      material.polygonOffsetUnits = 0;
    }
    material.needsUpdate = true;
  }

  // Draw shirt geometry groups before vest groups within the mesh.
  const groups = mesh.geometry?.groups;
  if (groups?.length && Array.isArray(mesh.material)) {
    const sortedGroups = [...groups].sort((a, b) => {
      const aOuter = EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(materials[a.materialIndex ?? 0]?.name || '');
      const bOuter = EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(materials[b.materialIndex ?? 0]?.name || '');
      return Number(aOuter) - Number(bOuter);
    });
    mesh.geometry.clearGroups();
    for (const group of sortedGroups) {
      mesh.geometry.addGroup(group.start, group.count, group.materialIndex);
    }
  }
  return true;
}

/** Sibling render-order nudge between vest meshes and shirt meshes (ami:
 *  applyExternalTopSiblingDepthLayering, WebGL branch; the vertex-tuck
 *  passes it also mentions are dead code in ami — both early-return). */
function applyExternalTopSiblingDepthLayering(meshes: THREE.Mesh[]): void {
  const hasOuter = meshes.some((mesh) =>
    materialsOf(mesh).some((m) => EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(m?.name || '')),
  );
  const hasShirt = meshes.some((mesh) =>
    materialsOf(mesh).some((m) => EXTERNAL_TOP_SHIRT_MATERIAL_RE.test(m?.name || '')),
  );
  if (!hasOuter || !hasShirt) return;

  for (const mesh of meshes) {
    const materials = materialsOf(mesh);
    const isOuterMesh = materials.some((m) => EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(m?.name || ''));
    const isShirtMesh = materials.some((m) => EXTERNAL_TOP_SHIRT_MATERIAL_RE.test(m?.name || ''));
    if (isOuterMesh) mesh.renderOrder += 0.02;
    else if (isShirtMesh) mesh.renderOrder -= 0.02;

    for (const material of materials) {
      if (!material) continue;
      if (EXTERNAL_TOP_OCCLUDER_MATERIAL_RE.test(material.name || '')) {
        material.depthTest = true;
        material.depthWrite = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
        material.needsUpdate = true;
      } else if (EXTERNAL_TOP_SHIRT_MATERIAL_RE.test(material.name || '')) {
        material.depthTest = true;
        material.depthWrite = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = 0;
        material.polygonOffsetUnits = 0;
        material.needsUpdate = true;
      }
    }
  }
}

/** Bones the outfit can bind to: SkinnedMesh skeleton bones first (highest
 *  confidence — definitely animated), then any other Bone in the tree. */
function indexBonesByName(vrm: VRM): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>();
  vrm.scene.traverse((obj) => {
    const sm = obj as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton) return;
    for (const bone of sm.skeleton.bones) {
      if (bone && !map.has(bone.name)) map.set(bone.name, bone);
    }
  });
  vrm.scene.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && !map.has(obj.name)) {
      map.set(obj.name, obj as THREE.Bone);
    }
  });
  return map;
}

/** Closest ancestor of the source bone that exists on the target armature;
 *  last resort: Hips. */
function findFallbackBone(
  origBone: THREE.Bone,
  targetByName: Map<string, THREE.Bone>,
): THREE.Bone | null {
  let cur: THREE.Object3D | null = origBone.parent;
  while (cur) {
    if (cur.name && targetByName.has(cur.name)) return targetByName.get(cur.name)!;
    cur = cur.parent;
  }
  return targetByName.get('Hips') ?? null;
}

/**
 * Rebind one outfit SkinnedMesh onto the VRM's own bones (ami:
 * rebindSkinnedMesh, same-character mode, batch pose handling — the caller
 * has already snapped the VRM to rest pose). boneInverses are captured from
 * the matched bones' current (rest) matrixWorld, so at rest the outfit sits
 * exactly at its authored vertex positions and follows every animation the
 * body plays.
 */
function rebindSkinnedMesh(
  mesh: THREE.SkinnedMesh,
  targetByName: Map<string, THREE.Bone>,
  stats: { matched: number; missing: number; missingNames: Set<string> },
): boolean {
  const oldBones = mesh.skeleton.bones;
  const newBones: THREE.Bone[] = new Array(oldBones.length);

  for (let i = 0; i < oldBones.length; i++) {
    const ob = oldBones[i];
    let hit = targetByName.get(ob.name);
    if (!hit) {
      const aliases = BONE_NAME_ALIASES[ob.name];
      if (aliases) {
        for (const alt of aliases) {
          const altHit = targetByName.get(alt);
          if (altHit) {
            hit = altHit;
            break;
          }
        }
      }
    }
    if (hit) {
      newBones[i] = hit;
      stats.matched++;
    } else {
      const fallback = findFallbackBone(ob, targetByName);
      if (!fallback) return false; // no Hips? bail
      newBones[i] = fallback;
      stats.missing++;
      stats.missingNames.add(ob.name);
    }
  }

  const newBoneInverses: THREE.Matrix4[] = new Array(oldBones.length);
  for (let i = 0; i < oldBones.length; i++) {
    newBoneInverses[i] = new THREE.Matrix4().copy(newBones[i].matrixWorld).invert();
  }

  const newSkeleton = new THREE.Skeleton(newBones, newBoneInverses);
  mesh.updateMatrixWorld(true);
  mesh.bind(newSkeleton, mesh.matrixWorld);
  return true;
}

// ─── Peak Dress chest fit-up (ami: growOutfitChestToBody + helpers) ──────────

/** First non-outfit SkinnedMesh with meaningful weights on a bone matching
 *  the regex (sampled over the first 500 verts) — used to find the body-skin
 *  mesh with breast-bone weights (ami: findBodyMeshByBoneRegex). */
function findBodyMeshByBoneRegex(vrm: VRM, boneNameRegex: RegExp): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  vrm.scene.traverse((obj) => {
    if (found) return;
    const sm = obj as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    if (sm.userData.__externalOutfitMesh) return;
    if (!sm.geometry?.attributes?.skinIndex || !sm.geometry?.attributes?.skinWeight) return;
    const matchSlots = new Set<number>();
    sm.skeleton.bones.forEach((b, i) => {
      if (boneNameRegex.test(b.name)) matchSlots.add(i);
    });
    if (matchSlots.size === 0) return;
    const sj = sm.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sw = sm.geometry.attributes.skinWeight as THREE.BufferAttribute;
    const sampleN = Math.min(sj.count, 500);
    for (let v = 0; v < sampleN; v++) {
      const slots = [sj.getX(v), sj.getY(v), sj.getZ(v), sj.getW(v)];
      const wts = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)];
      for (let k = 0; k < 4; k++) {
        if (matchSlots.has(slots[k]) && wts[k] > 0.05) {
          found = sm;
          return;
        }
      }
    }
  });
  return found;
}

/**
 * Each body vertex's visible rest WORLD position via manual skinning
 * (bindMatrix · Σ(w · bone.matrixWorld · boneInverse) · vert). The body's
 * stored verts live in its glTF bind-pose frame which differs from the
 * current rest pose, so raw `matrixWorld * vert` gives wrong NN matches
 * (ami: computeBodyDeformedRestPositions — call at rest pose).
 */
function computeBodyDeformedRestPositions(bodyMesh: THREE.SkinnedMesh): Float32Array {
  bodyMesh.updateMatrixWorld(true);
  const positions = bodyMesh.geometry.attributes.position as THREE.BufferAttribute;
  const skinIndex = bodyMesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const skinWeight = bodyMesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const skeleton = bodyMesh.skeleton;
  const bindMatrix = bodyMesh.bindMatrix;
  const result = new Float32Array(positions.count * 3);
  const tmpV = new THREE.Vector3();
  const skinningM = new THREE.Matrix4();
  const boneM = new THREE.Matrix4();
  for (let v = 0; v < positions.count; v++) {
    const j = [skinIndex.getX(v), skinIndex.getY(v), skinIndex.getZ(v), skinIndex.getW(v)];
    const w = [skinWeight.getX(v), skinWeight.getY(v), skinWeight.getZ(v), skinWeight.getW(v)];
    for (let i = 0; i < 16; i++) skinningM.elements[i] = 0;
    let totalW = 0;
    for (let k = 0; k < 4; k++) {
      if (w[k] <= 0) continue;
      const bone = skeleton.bones[j[k]];
      if (!bone) continue;
      boneM.copy(bone.matrixWorld).multiply(skeleton.boneInverses[j[k]]);
      for (let i = 0; i < 16; i++) skinningM.elements[i] += w[k] * boneM.elements[i];
      totalW += w[k];
    }
    tmpV.set(positions.getX(v), positions.getY(v), positions.getZ(v));
    if (totalW >= 0.001) tmpV.applyMatrix4(skinningM);
    tmpV.applyMatrix4(bindMatrix);
    result[v * 3] = tmpV.x;
    result[v * 3 + 1] = tmpV.y;
    result[v * 3 + 2] = tmpV.z;
  }
  return result;
}

/** Per-outfit-vertex nearest body vertex by world rest position (brute
 *  force; ami pays the same cost once per outfit load). Call at rest pose,
 *  after the outfit mesh is rebound (its matrixWorld·vert IS its visible
 *  rest position then). */
function computeOutfitToBodyNearestNeighborMap(
  outfitMesh: THREE.SkinnedMesh,
  bodyMesh: THREE.SkinnedMesh,
): Int32Array {
  outfitMesh.updateMatrixWorld(true);
  const bodyWorld = computeBodyDeformedRestPositions(bodyMesh);
  const ap = outfitMesh.geometry.attributes.position as THREE.BufferAttribute;
  const tmpV = new THREE.Vector3();
  const bodyCount = bodyWorld.length / 3;
  const map = new Int32Array(ap.count);
  for (let v = 0; v < ap.count; v++) {
    tmpV.set(ap.getX(v), ap.getY(v), ap.getZ(v)).applyMatrix4(outfitMesh.matrixWorld);
    let nearest = 0;
    let nearestDsq = Infinity;
    for (let bv = 0; bv < bodyCount; bv++) {
      const dx = bodyWorld[bv * 3] - tmpV.x;
      const dy = bodyWorld[bv * 3 + 1] - tmpV.y;
      const dz = bodyWorld[bv * 3 + 2] - tmpV.z;
      const dsq = dx * dx + dy * dy + dz * dz;
      if (dsq < nearestDsq) {
        nearestDsq = dsq;
        nearest = bv;
      }
    }
    map[v] = nearest;
  }
  return map;
}

/**
 * Grow the dress chest outward to match the runtime body's bust by adding
 * `-body_delta * fitScale` per outfit vertex, where body_delta is the
 * artist-authored `Smaller.breast` morph at the NN-matched body vertex
 * (ami: growOutfitChestToBody — the fix for the Tomcat-base→Sara retarget
 * leaving the original flatter cup curve, which lets Sara's bust poke
 * through the Peak Dress fabric). The inverted morph field is smooth (zero
 * off-chest), so the grow has no hard edges. Recomputes vertex normals —
 * without that the grown area shades with stale pre-grow normals and looks
 * wrinkled/patchy.
 */
function growOutfitChestToBody(
  outfitMesh: THREE.SkinnedMesh,
  bodyMesh: THREE.SkinnedMesh,
  nnMap: Int32Array,
  label: string,
  fitScale: number,
): void {
  const outfitPos = outfitMesh.geometry.attributes.position as THREE.BufferAttribute;
  const bodyMorphIdx = bodyMesh.morphTargetDictionary?.['Smaller.breast'];
  if (bodyMorphIdx === undefined) return;
  const bodyMorphAttr = bodyMesh.geometry.morphAttributes?.position?.[bodyMorphIdx] as
    | THREE.BufferAttribute
    | undefined;
  if (!bodyMorphAttr) return;

  let grown = 0;
  for (let v = 0; v < outfitPos.count; v++) {
    const bv = nnMap[v];
    const dx = bodyMorphAttr.getX(bv);
    const dy = bodyMorphAttr.getY(bv);
    const dz = bodyMorphAttr.getZ(bv);
    if (dx === 0 && dy === 0 && dz === 0) continue;
    outfitPos.setXYZ(
      v,
      outfitPos.getX(v) - dx * fitScale,
      outfitPos.getY(v) - dy * fitScale,
      outfitPos.getZ(v) - dz * fitScale,
    );
    grown++;
  }

  if (grown > 0) {
    outfitPos.needsUpdate = true;
    outfitMesh.geometry.computeVertexNormals();
    const normalAttr = outfitMesh.geometry.attributes.normal as THREE.BufferAttribute | undefined;
    if (normalAttr) normalAttr.needsUpdate = true;
    outfitMesh.geometry.computeBoundingBox();
    outfitMesh.geometry.computeBoundingSphere();
    logger.debug(`[outfit-composer] ${label}: grew ${grown}/${outfitPos.count} chest verts (fitScale=${fitScale})`);
  }
}

/**
 * Synthesize a `Smaller.breast` morph target on an outfit mesh from the
 * body's artist-authored morph deltas at the NN-matched body vertices (ami:
 * the outfit-side breast-morph synthesis in externalOutfitLoader). The Peak
 * Dress GLB ships no morphs, so without this the dress keeps its full-bust
 * shape while the body shrinks underneath. Relative morph (glTF-style):
 * influence k moves each dress vert by the same delta the body vert moves,
 * so dress and body track exactly. Runs after growOutfitChestToBody — the
 * grow rebases the dress to the FULL bust, and the shrink morph walks both
 * meshes inward together from there.
 */
function synthesizeOutfitBreastMorph(
  outfitMesh: THREE.SkinnedMesh,
  bodyMesh: THREE.SkinnedMesh,
  nnMap: Int32Array,
  label: string,
): boolean {
  const bodyMorphIdx = bodyMesh.morphTargetDictionary?.['Smaller.breast'];
  if (bodyMorphIdx === undefined) return false;
  const bodyMorphAttr = bodyMesh.geometry.morphAttributes?.position?.[bodyMorphIdx] as
    | THREE.BufferAttribute
    | undefined;
  if (!bodyMorphAttr) return false;

  const outfitPos = outfitMesh.geometry.attributes.position as THREE.BufferAttribute;
  const deltas = new Float32Array(outfitPos.count * 3);
  let touched = 0;
  for (let v = 0; v < outfitPos.count; v++) {
    const bv = nnMap[v];
    const dx = bodyMorphAttr.getX(bv);
    const dy = bodyMorphAttr.getY(bv);
    const dz = bodyMorphAttr.getZ(bv);
    if (dx === 0 && dy === 0 && dz === 0) continue;
    deltas[v * 3] = dx;
    deltas[v * 3 + 1] = dy;
    deltas[v * 3 + 2] = dz;
    touched++;
  }
  if (touched === 0) return false;

  const geometry = outfitMesh.geometry;
  geometry.morphAttributes.position = geometry.morphAttributes.position ?? [];
  const morphIndex = geometry.morphAttributes.position.length;
  geometry.morphAttributes.position.push(new THREE.BufferAttribute(deltas, 3));
  geometry.morphTargetsRelative = true;
  outfitMesh.morphTargetDictionary = outfitMesh.morphTargetDictionary ?? {};
  outfitMesh.morphTargetDictionary['Smaller.breast'] = morphIndex;
  outfitMesh.morphTargetInfluences = outfitMesh.morphTargetInfluences ?? [];
  while (outfitMesh.morphTargetInfluences.length <= morphIndex) {
    outfitMesh.morphTargetInfluences.push(0);
  }
  // The material was (possibly) compiled without morph defines.
  for (const m of materialsOf(outfitMesh)) {
    if (m) m.needsUpdate = true;
  }
  logger.debug(`[outfit-composer] ${label}: synthesized Smaller.breast morph (${touched}/${outfitPos.count} verts)`);
  return true;
}

/** Set a named morph-target influence on every NON-outfit mesh that has it
 *  (ami: setVRMMorphTarget via applyBodyMorphTargetsForPlan). Returns the
 *  number of meshes updated. */
function setBodyMorphInfluence(vrm: VRM, morphName: string, value: number): number {
  let matched = 0;
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh && !(mesh as THREE.Mesh).isMesh) return;
    if (mesh.userData?.__externalOutfitMesh) return;
    const idx = mesh.morphTargetDictionary?.[morphName];
    if (idx === undefined || !mesh.morphTargetInfluences) return;
    mesh.morphTargetInfluences[idx] = value;
    matched++;
  });
  return matched;
}

function setBodyCutVisibility(vrm: VRM, names: string[], visible: boolean): number {
  const nameSet = new Set(names);
  let flipped = 0;
  vrm.scene.traverse((obj) => {
    if (nameSet.has(obj.name)) {
      obj.visible = visible;
      flipped++;
    }
  });
  return flipped;
}

function disposeOutfitMeshes(meshes: THREE.SkinnedMesh[]): void {
  for (const mesh of meshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose();
    for (const m of materialsOf(mesh)) m?.dispose?.();
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Load Sara's default outfit GLB, bind it onto the already-loaded Sara Lite
 * VRM, and apply the paired BodyCut visibility flips. Idempotent — a second
 * call while the outfit is attached returns the existing handle. Call
 * `handle.dispose()` to undress (meshes removed + GPU resources freed +
 * BodyCuts re-hidden).
 *
 * `resolveUrl` maps an ami-style `/assets/...` CDN path to a fetchable URL
 * (e.g. `companionAssetUrl` + the Cache API in companion-assets.ts).
 */
export async function applySaraDefaultOutfit(
  vrm: VRM,
  resolveUrl: (cdnPath: string) => Promise<string> | string,
): Promise<SaraOutfitHandle> {
  return applySaraOutfit(vrm, SARA_OUTFITS[0], resolveUrl);
}

/** Dress Sara in a specific wardrobe outfit (see SARA_OUTFITS). */
export async function applySaraOutfit(
  vrm: VRM,
  spec: SaraOutfitSpec,
  resolveUrl: (cdnPath: string) => Promise<string> | string,
): Promise<SaraOutfitHandle> {
  const record = vrm as unknown as Record<string, unknown>;
  const existing = record[OUTFIT_HANDLE_KEY] as SaraOutfitHandle | undefined;
  if (existing) return existing;

  const glbUrl = await resolveUrl(spec.glbPath);
  const loader = new GLTFLoader();
  loader.crossOrigin = 'anonymous';
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(glbUrl);

  const skinned: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(obj as THREE.SkinnedMesh);
  });
  if (skinned.length === 0) {
    throw new Error(`[outfit-composer] Outfit GLB has no SkinnedMesh: ${glbUrl}`);
  }

  const targetByName = indexBonesByName(vrm);
  if (targetByName.size === 0) {
    throw new Error('[outfit-composer] Target VRM has no bones');
  }

  // Mesh + material prep (ami loadExternalOutfitInner main path, WebGL).
  for (const mesh of skinned) {
    deinterleaveSkinnedGeometry(mesh.geometry as THREE.BufferGeometry);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = FULL_BODY_RENDER_ORDER;
    mesh.userData.__externalOutfitMesh = true;
    const hasTopDepthBias = applyExternalTopMaterialDepthBias(mesh);
    for (const m of materialsOf(mesh)) {
      if (!m) continue;
      m.toneMapped = false;
      const map = m.map as THREE.Texture | undefined;
      if (map && map.colorSpace !== THREE.SRGBColorSpace) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
      }
      if (!hasTopDepthBias) {
        // Mild polygon offset — beats the body skin's +2 offset without
        // clothing layers fighting each other.
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -2;
      }
      patchSaraLiteExternalMaterial(m);
      m.needsUpdate = true;
    }
  }
  applyExternalTopSiblingDepthLayering(skinned);

  // Snap the VRM to its authored rest pose ONCE for the whole batch (ami's
  // skipPoseReset batch mode): boneInverse capture must see rest-pose
  // matrixWorld, not the current animation frame. Non-humanoid bones are
  // restored via a raw quaternion snapshot.
  const humanoid = vrm.humanoid as unknown as {
    getNormalizedPose?: () => unknown;
    setNormalizedPose?: (pose: unknown) => void;
    resetNormalizedPose?: () => void;
    update?: () => void;
  } | null;
  const hasHumanoid = !!humanoid && typeof humanoid.resetNormalizedPose === 'function';
  const savedPose = hasHumanoid ? humanoid!.getNormalizedPose?.() : null;
  const allBones: THREE.Bone[] = [];
  vrm.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone);
  });
  const savedQuats = allBones.map((b) => b.quaternion.clone());
  if (hasHumanoid) {
    humanoid!.resetNormalizedPose?.();
    humanoid!.update?.();
    vrm.scene.updateMatrixWorld(true);
  }

  // Re-parent FIRST, then rebind — bind() captures mesh.matrixWorld into
  // bindMatrix, and it must agree with the post-parent world transform or
  // the mesh renders warped. No runtime rotation on the mesh: the VRM0
  // facing flip is baked into the outfit vertex positions at export.
  const attached: THREE.SkinnedMesh[] = [];
  const stats = { matched: 0, missing: 0, missingNames: new Set<string>() };
  try {
    for (const mesh of skinned) {
      mesh.parent?.remove(mesh);
      mesh.layers.mask = vrm.scene.layers.mask;
      vrm.scene.add(mesh);
      attached.push(mesh);
    }
    vrm.scene.updateMatrixWorld(true);

    for (const mesh of skinned) {
      if (!rebindSkinnedMesh(mesh, targetByName, stats)) {
        throw new Error(`[outfit-composer] Rebind failed for mesh ${mesh.name} — no Hips on target?`);
      }
    }

    // Chest handling. Must run while the VRM is still at rest pose (the NN
    // map compares body rest positions against the freshly rebound dress)
    // and AFTER rebind. Two parts, both skipped for meshes that already
    // carry a baked `Smaller.breast` morph (ami's skip-if-baked check):
    //   - grow: Peak Dress only (retargeted from the flatter Tomcat base;
    //     same-character extracts like the V-Dress already fit).
    //   - shrink-morph synthesis: EVERY outfit mesh, so
    //     setSaraBreastReduction moves fabric and skin together.
    {
      const bodyMesh = findBodyMeshByBoneRegex(vrm, /^Breast_\d+_[lr]$/i);
      if (bodyMesh) {
        const needsGrow = spec.chestGrow;
        for (const mesh of skinned) {
          if (mesh.morphTargetDictionary?.['Smaller.breast'] !== undefined) continue;
          const nnMap = computeOutfitToBodyNearestNeighborMap(mesh, bodyMesh);
          if (needsGrow) {
            growOutfitChestToBody(mesh, bodyMesh, nnMap, `Outfit "${mesh.name}"`, 1.0);
          }
          synthesizeOutfitBreastMorph(mesh, bodyMesh, nnMap, `Outfit "${mesh.name}"`);
        }
      } else {
        logger.warn('[outfit-composer] no breast-weighted body mesh found — chest fit-up/morph skipped');
      }
    }
  } catch (e) {
    disposeOutfitMeshes(attached);
    // Restore the animation state before propagating.
    for (let i = 0; i < allBones.length; i++) allBones[i].quaternion.copy(savedQuats[i]);
    if (hasHumanoid && savedPose) {
      humanoid!.setNormalizedPose?.(savedPose);
      humanoid!.update?.();
    }
    vrm.scene.updateMatrixWorld(true);
    throw e;
  }

  // Restore the full animation state.
  for (let i = 0; i < allBones.length; i++) allBones[i].quaternion.copy(savedQuats[i]);
  if (hasHumanoid && savedPose) {
    humanoid!.setNormalizedPose?.(savedPose);
    humanoid!.update?.();
  }
  vrm.scene.updateMatrixWorld(true);

  // Baked-mesh visibility flips paired with this outfit (empty for V-Dress —
  // all BodyCuts stay hidden; see SARA_DEFAULT_OUTFIT_KEEP_BODYCUTS).
  const shown = setBodyCutVisibility(vrm, spec.keepBodyCuts, true);

  // Body morphs held while worn (V-Dress: Smaller.Pelvis = 2, the authored
  // pelvis-clearance fix that stops groin/hip skin poking through the hem).
  let morphMeshes = 0;
  for (const [morphName, value] of Object.entries(spec.bodyMorphs)) {
    const n = setBodyMorphInfluence(vrm, morphName, value);
    morphMeshes += n;
    if (n === 0) logger.warn(`[outfit-composer] body morph not found on any mesh: ${morphName}`);
  }

  // Chest-coverage hide boxes through the clipping fixer (installed by
  // vrm-post-load). The vest-gated boxes resolve to empty under the V-Dress.
  const fixer = getCompanionVRMClippingFixer(vrm);
  fixer?.updateExtraHideBoxes(SARA_CHEST_COVERAGE_HIDE_BOXES);

  if (stats.missing > 0) {
    logger.warn(
      `[outfit-composer] ${stats.missing} outfit joints had no name match (fallback-bound):`,
      [...stats.missingNames],
    );
  }
  logger.info(
    `[outfit-composer] Default outfit attached: ${skinned.length} meshes, ` +
      `${stats.matched} joints matched, ${stats.missing} fallback, ${shown} BodyCuts shown, ` +
      `body morphs on ${morphMeshes} meshes, hide boxes=${SARA_CHEST_COVERAGE_HIDE_BOXES.length}`,
  );

  const handle: SaraOutfitHandle = {
    outfitKey: spec.key,
    glbUrl,
    meshes: skinned,
    dispose: () => {
      disposeOutfitMeshes(skinned);
      setBodyCutVisibility(vrm, spec.keepBodyCuts, false);
      for (const morphName of Object.keys(spec.bodyMorphs)) {
        setBodyMorphInfluence(vrm, morphName, 0);
      }
      setBodyMorphInfluence(vrm, 'Smaller.breast', 0);
      getCompanionVRMClippingFixer(vrm)?.updateExtraHideBoxes([]);
      if (record[OUTFIT_HANDLE_KEY] === handle) delete record[OUTFIT_HANDLE_KEY];
    },
  };
  record[OUTFIT_HANDLE_KEY] = handle;
  setSaraBreastReduction(vrm, SARA_DEFAULT_BREAST_REDUCTION);
  return handle;
}

/** Default bust reduction applied while the outfit is worn (Liam 2026-07-11:
 *  "30% smaller", then "30% smaller still" → 0.6). Drives the body's
 *  `Smaller.breast` morph plus the synthesized dress morph so fabric
 *  follows skin. */
export const SARA_DEFAULT_BREAST_REDUCTION = 0.6;

/**
 * Set the bust-reduction influence (0 = authored size, 1 = the morph's full
 * shrink) on the body meshes AND any attached outfit meshes carrying a baked
 * or synthesized `Smaller.breast` morph. Returns the number of meshes set.
 */
export function setSaraBreastReduction(vrm: VRM, influence: number): number {
  const value = Math.min(1, Math.max(0, influence));
  let matched = setBodyMorphInfluence(vrm, 'Smaller.breast', value);
  const handle = getSaraOutfitHandle(vrm);
  if (handle) {
    for (const mesh of handle.meshes) {
      const idx = mesh.morphTargetDictionary?.['Smaller.breast'];
      if (idx === undefined || !mesh.morphTargetInfluences) continue;
      mesh.morphTargetInfluences[idx] = value;
      matched++;
    }
  }
  if (matched === 0) {
    logger.warn('[outfit-composer] Smaller.breast morph not found on any mesh');
  }
  return matched;
}

/** Currently attached default-outfit handle, if any. */
export function getSaraOutfitHandle(vrm: VRM): SaraOutfitHandle | null {
  return ((vrm as unknown as Record<string, unknown>)[OUTFIT_HANDLE_KEY] as SaraOutfitHandle) ?? null;
}
