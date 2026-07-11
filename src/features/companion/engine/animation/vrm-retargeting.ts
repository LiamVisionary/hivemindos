/**
 * VRM animation retargeting — ported from ami-ai-companion
 * (src/lib/animations/animation-retargeting.ts + animation-constants.ts +
 * the dampenAnimationTracks pass from avatar-retargeter.ts).
 *
 * Scope: the GLB clip path only. The ami idle/gesture GLBs
 * (e.g. /assets/animations/new-animations/conversation/Idle01_breathing.glb)
 * carry a Mixamo rig ("mixamorig:Hips" bone naming) and MUST be retargeted
 * onto the VRM's normalized humanoid bones before playback. FBX / VMD / VRMA /
 * BVH / RPM-and-DAZ branches from the source were intentionally dropped.
 */

import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { logger } from "../logger";

// ─── Bone maps (from ami animation-constants.ts) ─────────────────────────────

export const MIXAMO_TO_VRM_BONE_MAP: Record<string, VRMHumanBoneName> = {
  mixamorigHips: "hips",
  mixamorigSpine: "spine",
  mixamorigSpine1: "chest",
  mixamorigSpine2: "upperChest",
  mixamorigNeck: "neck",
  mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder",
  mixamorigLeftArm: "leftUpperArm",
  mixamorigLeftForeArm: "leftLowerArm",
  mixamorigLeftHand: "leftHand",
  mixamorigRightShoulder: "rightShoulder",
  mixamorigRightArm: "rightUpperArm",
  mixamorigRightForeArm: "rightLowerArm",
  mixamorigRightHand: "rightHand",
  mixamorigLeftUpLeg: "leftUpperLeg",
  mixamorigLeftLeg: "leftLowerLeg",
  mixamorigLeftFoot: "leftFoot",
  mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg",
  mixamorigRightLeg: "rightLowerLeg",
  mixamorigRightFoot: "rightFoot",
  mixamorigRightToeBase: "rightToes",
  // Left hand fingers (Mixamo 1=metacarpal/proximal, 2=proximal/intermediate,
  // 3=distal; 4=tip — skipped)
  mixamorigLeftHandThumb1: "leftThumbMetacarpal",
  mixamorigLeftHandThumb2: "leftThumbProximal",
  mixamorigLeftHandThumb3: "leftThumbDistal",
  mixamorigLeftHandIndex1: "leftIndexProximal",
  mixamorigLeftHandIndex2: "leftIndexIntermediate",
  mixamorigLeftHandIndex3: "leftIndexDistal",
  mixamorigLeftHandMiddle1: "leftMiddleProximal",
  mixamorigLeftHandMiddle2: "leftMiddleIntermediate",
  mixamorigLeftHandMiddle3: "leftMiddleDistal",
  mixamorigLeftHandRing1: "leftRingProximal",
  mixamorigLeftHandRing2: "leftRingIntermediate",
  mixamorigLeftHandRing3: "leftRingDistal",
  mixamorigLeftHandPinky1: "leftLittleProximal",
  mixamorigLeftHandPinky2: "leftLittleIntermediate",
  mixamorigLeftHandPinky3: "leftLittleDistal",
  // Right hand fingers
  mixamorigRightHandThumb1: "rightThumbMetacarpal",
  mixamorigRightHandThumb2: "rightThumbProximal",
  mixamorigRightHandThumb3: "rightThumbDistal",
  mixamorigRightHandIndex1: "rightIndexProximal",
  mixamorigRightHandIndex2: "rightIndexIntermediate",
  mixamorigRightHandIndex3: "rightIndexDistal",
  mixamorigRightHandMiddle1: "rightMiddleProximal",
  mixamorigRightHandMiddle2: "rightMiddleIntermediate",
  mixamorigRightHandMiddle3: "rightMiddleDistal",
  mixamorigRightHandRing1: "rightRingProximal",
  mixamorigRightHandRing2: "rightRingIntermediate",
  mixamorigRightHandRing3: "rightRingDistal",
  mixamorigRightHandPinky1: "rightLittleProximal",
  mixamorigRightHandPinky2: "rightLittleIntermediate",
  mixamorigRightHandPinky3: "rightLittleDistal",
};

/** VRM humanoid bone names accepted by the VRM-bone-named GLB retargeter. */
export const VRM_BONE_NAMES: readonly string[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
  "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
  "leftThumbProximal", "leftThumbMetacarpal", "leftThumbDistal",
  "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
  "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
  "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
  "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
  "rightThumbProximal", "rightThumbMetacarpal", "rightThumbDistal",
  "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
  "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
  "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
  "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
] as const;

// ─── Retarget context ────────────────────────────────────────────────────────

export interface RetargetContext {
  vrm: VRM;
  /** Normalized hips node local position captured at VRM load time (pre-animation). */
  initialHipsPosition: THREE.Vector3 | null;
  isVRM0: boolean;
  /** World-space |hipsY - rootY| of the target VRM. */
  vrmHipsHeight: number;
}

/** "mixamorig:Hips" → "mixamorigHips" (the ami conversation GLBs use the colon form). */
function normalizeMixamoBoneName(raw: string): string {
  return raw.replace(":", "");
}

function computeRestPoseQuaternions(
  sourceBone: THREE.Object3D | undefined,
  restRotationInverse: THREE.Quaternion,
  parentRestWorldRotation: THREE.Quaternion,
): void {
  if (sourceBone) {
    sourceBone.getWorldQuaternion(restRotationInverse).invert();
    if (sourceBone.parent) {
      sourceBone.parent.getWorldQuaternion(parentRestWorldRotation);
    } else {
      parentRestWorldRotation.identity();
    }
  } else {
    restRotationInverse.identity();
    parentRestWorldRotation.identity();
  }
}

// ─── Mixamo-rig GLB → VRM ────────────────────────────────────────────────────

/**
 * Retarget a Mixamo-rig animation (GLB with mixamorig bone names) onto a VRM's
 * normalized humanoid bones. Verbatim port of ami's
 * retargetMixamoAnimationToVRM (animation-retargeting.ts:68).
 *
 * NOTE: Do NOT call scene.updateMatrixWorld — matches the official three-vrm
 * sample; getWorldQuaternion internally calls updateWorldMatrix(true,false).
 */
export function retargetMixamoAnimationToVRM(
  sourceScene: THREE.Group,
  clip: THREE.AnimationClip,
  ctx: RetargetContext,
): THREE.AnimationClip {
  const hipsObject =
    sourceScene.getObjectByName("mixamorigHips") ??
    sourceScene.getObjectByName("mixamorig:Hips") ??
    sourceScene.getObjectByName("Hips") ??
    sourceScene.getObjectByName("hip");

  if (!hipsObject) {
    throw new Error("No hip bone found - incompatible rig");
  }

  const rawHipsHeight = hipsObject.position.y;
  const isCentimeters = rawHipsHeight > 10;
  const motionHipsHeight = isCentimeters ? rawHipsHeight / 100 : rawHipsHeight;
  const hipsPositionScale = ctx.vrmHipsHeight / (motionHipsHeight || 1);
  const unitScale = isCentimeters ? 0.01 : 1;

  logger.debug(
    `[retarget] Mixamo→VRM: rawH=${rawHipsHeight.toFixed(1)}, unit=${isCentimeters ? "cm" : "m"}, ` +
      `motionH=${motionHipsHeight.toFixed(3)}, vrmH=${ctx.vrmHipsHeight.toFixed(3)}, ` +
      `scale=${hipsPositionScale.toFixed(3)}, isVRM0=${ctx.isVRM0}`,
  );

  // Pre-build name→object map to avoid O(n) scene traversal per track.
  const mixamoBoneMap = new Map<string, THREE.Object3D>();
  sourceScene.traverse((obj) => mixamoBoneMap.set(obj.name, obj));

  const tracks: THREE.KeyframeTrack[] = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();

  let matchedTracks = 0;

  for (const track of clip.tracks) {
    const trackSplitted = track.name.split(".");
    const rawBoneName = trackSplitted[0];
    const mixamoRigName = normalizeMixamoBoneName(rawBoneName);

    const vrmBoneName = MIXAMO_TO_VRM_BONE_MAP[mixamoRigName];
    if (!vrmBoneName) continue;

    const vrmNodeName = ctx.vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;
    const mixamoRigNode = mixamoBoneMap.get(rawBoneName);
    if (vrmNodeName == null || !mixamoRigNode) continue;

    const propertyName = trackSplitted[1];

    // Store rest-pose rotations — matches official three-vrm sample exactly.
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    if (mixamoRigNode.parent) {
      mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
    } else {
      parentRestWorldRotation.identity();
    }

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // Hips: skip rest pose correction — just apply VRM0 flip. Applying rest
      // pose correction to hips produces wrong results because GLB Armature
      // parents can inject unwanted rotations into getWorldQuaternion.
      if (vrmBoneName === "hips" && propertyName === "quaternion") {
        const values = new Float32Array(track.values.length);
        if (ctx.isVRM0) {
          for (let i = 0; i < track.values.length; i += 4) {
            values[i] = -track.values[i]; // X negated
            values[i + 1] = track.values[i + 1]; // Y kept
            values[i + 2] = -track.values[i + 2]; // Z negated
            values[i + 3] = track.values[i + 3]; // W kept
          }
        } else {
          values.set(track.values);
        }
        tracks.push(
          new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, values),
        );
        matchedTracks++;
        continue;
      }

      // All other bones: rest pose correction + VRM0 flip in a single pass.
      const values = new Float32Array(track.values.length);
      if (ctx.isVRM0) {
        for (let i = 0; i < track.values.length; i += 4) {
          _quatA.fromArray(track.values, i);
          _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
          values[i] = -_quatA.x;
          values[i + 1] = _quatA.y;
          values[i + 2] = -_quatA.z;
          values[i + 3] = _quatA.w;
        }
      } else {
        for (let i = 0; i < track.values.length; i += 4) {
          _quatA.fromArray(track.values, i);
          _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
          _quatA.toArray(values, i);
        }
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, values),
      );
      matchedTracks++;
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      if (vrmBoneName === "hips" && propertyName === "position") {
        const values = new Float32Array(track.values.length);
        const initialY = track.values[1];

        for (let i = 0; i < track.values.length; i += 3) {
          const relativeY = (track.values[i + 1] - initialY) * unitScale;
          // Y axis is the same in VRM0 and VRM1 (both Y-up) — do NOT negate.
          const scaledY = relativeY * hipsPositionScale;

          values[i] = ctx.initialHipsPosition?.x ?? 0;
          values[i + 1] = scaledY + (ctx.initialHipsPosition?.y ?? 0);
          values[i + 2] = ctx.initialHipsPosition?.z ?? 0;
        }

        tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.position`, track.times, values));
        matchedTracks++;
      }
      // Skip non-hips position/scale tracks — GLB exports include position+scale
      // for every bone but only hips position is meaningful in Mixamo animations.
      // Retargeting those would break the VRM humanoid constraint system.
    }
  }

  logger.debug(`[retarget] result: ${matchedTracks}/${clip.tracks.length} tracks retargeted`);

  return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
}

// ─── VRM-bone-named GLB → VRM ────────────────────────────────────────────────

/**
 * Retarget a GLB animation whose tracks already use VRM bone names ("hips",
 * "spine", …) onto the target VRM's normalized bones. Verbatim port of ami's
 * retargetVRMBoneGLBToVRM (animation-retargeting.ts:408). Used as the fallback
 * branch when a clip GLB has no mixamorig hips node.
 */
export function retargetVRMBoneGLBToVRM(
  scene: THREE.Group,
  clip: THREE.AnimationClip,
  ctx: RetargetContext,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  // Build bone map from the GLB scene
  const sourceBoneMap: Record<string, THREE.Bone> = {};
  let sourceHipsHeight = 1.0;
  scene.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      const bone = child as THREE.Bone;
      sourceBoneMap[bone.name] = bone;
      if (bone.name === "hips" || bone.name === "Hips") {
        sourceHipsHeight = Math.abs(bone.position.y) || 1.0;
      }
    }
  });

  const hipsPositionScale = ctx.vrmHipsHeight / sourceHipsHeight;

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();

  for (const track of clip.tracks) {
    // GLB track names are "boneName.property" (e.g. "hips.quaternion")
    const dotIndex = track.name.indexOf(".");
    if (dotIndex === -1) continue;

    const boneName = track.name.substring(0, dotIndex);
    const propertyName = track.name.substring(dotIndex + 1);

    if (!VRM_BONE_NAMES.includes(boneName)) continue;

    const vrmNode = ctx.vrm.humanoid?.getNormalizedBoneNode(boneName as VRMHumanBoneName);
    if (!vrmNode) continue;

    const vrmNodeName = vrmNode.name;
    const sourceBone = sourceBoneMap[boneName];

    if (track instanceof THREE.QuaternionKeyframeTrack && propertyName === "quaternion") {
      computeRestPoseQuaternions(sourceBone, restRotationInverse, parentRestWorldRotation);

      const values = new Float32Array(track.values.length);

      if (boneName === "hips") {
        for (let i = 0; i < track.values.length; i += 4) {
          let x = track.values[i];
          const y = track.values[i + 1];
          let z = track.values[i + 2];
          const w = track.values[i + 3];

          if (ctx.isVRM0) {
            x = -x;
            z = -z;
          }

          values[i] = x;
          values[i + 1] = y;
          values[i + 2] = z;
          values[i + 3] = w;
        }
      } else {
        for (let i = 0; i < track.values.length; i += 4) {
          _quatA.set(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]);
          _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);

          let x = _quatA.x;
          const y = _quatA.y;
          let z = _quatA.z;
          const w = _quatA.w;

          if (ctx.isVRM0) {
            x = -x;
            z = -z;
          }

          values[i] = x;
          values[i + 1] = y;
          values[i + 2] = z;
          values[i + 3] = w;
        }
      }

      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.quaternion`, track.times, values));
    } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === "position") {
      if (boneName !== "hips") continue;

      const values = new Float32Array(track.values.length);
      const initialY = track.values[1];

      for (let i = 0; i < track.values.length; i += 3) {
        const relativeY = track.values[i + 1] - initialY;
        // Y axis is the same in VRM0 and VRM1 (both Y-up) — do NOT negate.
        const scaledY = relativeY * hipsPositionScale;

        values[i] = ctx.initialHipsPosition?.x ?? 0;
        values[i + 1] = scaledY + (ctx.initialHipsPosition?.y ?? 0);
        values[i + 2] = ctx.initialHipsPosition?.z ?? 0;
      }

      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.position`, track.times, values));
    }
  }

  return new THREE.AnimationClip("vrmBoneGLBAnimation", clip.duration, tracks);
}

// ─── Per-animation dampening (from ami avatar-retargeter.ts) ─────────────────

/**
 * Per-animation quaternion dampening overrides.
 * Keys are substrings matched against the animation URL (case-insensitive).
 * `factor` = how much to slerp toward rest (0 = no change, 1 = frozen).
 * `bones` = which bones to dampen (matched via .includes on lowercase track name).
 */
const ANIMATION_DAMPEN_OVERRIDES: { urlMatch: string; factor: number; bones: string[] }[] = [
  { urlMatch: "idle19_shyrefusal", factor: 0.25, bones: ["head", "neck"] },
];

/**
 * Slerp matching bones' quaternion keyframes toward each track's first frame.
 * Runs on every retargeted GLB clip (URL-matched; usually a no-op). Verbatim
 * port of ami's dampenAnimationTracks (avatar-retargeter.ts:29) minus the
 * FBX-only "shaking head no" override.
 */
export function dampenAnimationTracks(clip: THREE.AnimationClip, url: string): boolean {
  const lowerUrl = url.toLowerCase();
  const override = ANIMATION_DAMPEN_OVERRIDES.find((o) => lowerUrl.includes(o.urlMatch));
  if (!override) return false;

  const q = new THREE.Quaternion();
  const restQ = new THREE.Quaternion();
  let count = 0;

  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const boneName = track.name.split(".")[0].toLowerCase();
    if (!override.bones.some((b) => boneName.includes(b))) continue;

    const values = track.values;
    if (values.length < 4) continue;

    restQ.set(values[0], values[1], values[2], values[3]);
    for (let i = 4; i < values.length; i += 4) {
      q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
      q.slerp(restQ, override.factor);
      values[i] = q.x;
      values[i + 1] = q.y;
      values[i + 2] = q.z;
      values[i + 3] = q.w;
    }
    count++;
  }

  if (count > 0) {
    logger.debug(`[dampen] dampened ${count} tracks in "${url}" by ${(override.factor * 100).toFixed(0)}%`);
  }
  return count > 0;
}
