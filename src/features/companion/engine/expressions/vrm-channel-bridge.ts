/**
 * VRM Channel Bridge — Maps Expression 2.0 channel values to VRM blend shapes
 *
 * Translates the abstract channel output (brows, eyelids, mouthCorners, gaze, etc.)
 * into actual VRM expressionManager.setValue() calls. Also writes gaze look targets
 * and provides blink modulation parameters to the blink controller.
 *
 * Ported from ami-ai-companion `src/lib/expressions2/vrm-channel-bridge.ts`.
 * Port notes:
 * - Blink / lip-sync controllers are typed structurally (BlinkControllerLike /
 *   LipSyncControllerLike below) instead of importing concrete classes, so the
 *   bridge has no dependency on sibling engine modules.
 * - ami's Sara/Tomcat pose-catalog overlay (a per-character morph pose table)
 *   was NOT ported — it is specific to ami's Sara/Tomcat CDN models. The
 *   'saraTomcat' profile's raw smile/frown/lip-bite morph handling IS kept.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { ChannelValues, GazeTarget, BlinkModulation, HeadPoseOffset } from './types';
import { logger } from '../logger';
import type { CharacterExpressionProfile } from './character-expression-profile';

// ---------------------------------------------------------------------------
// Structural interfaces for sibling controllers (ported concurrently; the
// bridge only depends on these members, never on the concrete classes).
// ---------------------------------------------------------------------------

/** Minimal surface of the blink controller the bridge drives. */
export interface BlinkControllerLike {
  /** Set a persistent base eyelid-closure value (0..1) under the blink animation. */
  setBaseBlinkValue(value: number): void;
  /** Adjust blink timing parameters (seconds). */
  updateConfig(config: {
    minInterval?: number;
    maxInterval?: number;
    blinkDuration?: number;
  }): void;
}

/** Minimal surface of the lip-sync controller the bridge reads. */
export interface LipSyncControllerLike {
  isLipSyncActive(): boolean;
}

/** Active expression preset with its resolved mix weight (0..1). */
export interface ActivePresetWeight {
  preset: string;
  weight: number;
}

// Reusable per-frame eye-rotation temps. Creating two Quaternions and two
// Eulers per frame inside applyGazeLookAt would be 240 small THREE allocations
// per second at 60fps. Hoisting to module scope eliminates a steady source of
// minor-GC pressure during idle scenes.
const _eyeQuat = new THREE.Quaternion();
const _eyeEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const RAW_HAPPY_EYE_SOFT_MORPHS = ['Eye.happy'] as const;
const RAW_HAPPY_EYE_CLOSE_MORPHS = ['Eye.close.happy'] as const;
const RAW_HAPPY_EYE_MORPHS = [
  ...RAW_HAPPY_EYE_SOFT_MORPHS,
  ...RAW_HAPPY_EYE_CLOSE_MORPHS,
] as const;
const RAW_SMILE_EYE_MORPHS = [
  ...RAW_HAPPY_EYE_MORPHS,
  'cheekSquintLeft',
  'cheekSquintRight',
] as const;
const RAW_SARA_MOUTH_SMILE_MORPHS = [
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
] as const;
const RAW_SARA_LIP_BITE_MORPHS = ['Mth.BitLi-1', 'Mth.BitLi-2', 'Mth.BitLi-3'] as const;

function isRawSmileMorphTarget(name: string): boolean {
  return name === 'mouthSmileLeft'
    || name === 'mouthSmileRight'
    || name === 'mouthDimpleLeft'
    || name === 'mouthDimpleRight'
    || name === 'cheekSquintLeft'
    || name === 'cheekSquintRight'
    || RAW_HAPPY_EYE_MORPHS.includes(name as (typeof RAW_HAPPY_EYE_MORPHS)[number])
    || /^Mth\.Sml\./.test(name);
}

function isRawFrownMorphTarget(name: string): boolean {
  return name === 'mouthFrownLeft'
    || name === 'mouthFrownRight'
    || name === 'mouthPressLeft'
    || name === 'mouthPressRight'
    || name === 'mouthShrugLower'
    || name === 'Brow.angry'
    || name === 'Brow.frown'
    || name === 'Eye.angry'
    || name === 'Eye.close.down';
}

export class VRMChannelBridge {
  private vrm: VRM | null = null;
  private blinkController: BlinkControllerLike | null = null;
  private lipSyncController: LipSyncControllerLike | null = null;

  private _debugCounter: number = 0;
  private _laughPhase: number = 0;
  private _laughHeadBobCallback: ((nod: number, roll: number) => void) | null = null;
  private _rawSmileSuppressionUntilMs: number = 0;
  private _characterExpressionProfile: CharacterExpressionProfile = 'default';
  private _activeExpressionPresets: string[] = [];
  private _activeExpressionPresetWeights: ActivePresetWeight[] = [];

  /** name → list of {influences, idx} so setMorphTarget skips the per-frame scene.traverse. */
  private _morphTargetCache: Map<string, Array<{ influences: number[]; idx: number }>> | null = null;

  setVRM(vrm: VRM): void {
    this.vrm = vrm;
    this._eyeBonesResolved = false; // Re-resolve eye bones for new VRM
    this._morphTargetCache = null; // Drop morph cache; next setMorphTarget rebuilds it.
  }

  setCharacterExpressionProfile(profile: CharacterExpressionProfile): void {
    this._characterExpressionProfile = profile;
  }

  setActiveExpressionPresets(presets: string[]): void {
    this._activeExpressionPresets = presets;
    this._activeExpressionPresetWeights = presets.map((preset) => ({ preset, weight: 1 }));
  }

  setActiveExpressionPresetWeights(presets: ActivePresetWeight[]): void {
    this._activeExpressionPresetWeights = presets;
    this._activeExpressionPresets = presets.map((entry) => entry.preset);
  }

  /** Build (once per VRM) a map of morph-target name → meshes that have that morph. */
  private _ensureMorphCache(): Map<string, Array<{ influences: number[]; idx: number }>> | null {
    if (this._morphTargetCache) return this._morphTargetCache;
    if (!this.vrm) return null;
    const cache = new Map<string, Array<{ influences: number[]; idx: number }>>();
    this.vrm.scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh & {
        morphTargetDictionary?: Record<string, number>;
        morphTargetInfluences?: number[];
      };
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      for (const name of Object.keys(mesh.morphTargetDictionary)) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx === undefined) continue;
        let entries = cache.get(name);
        if (!entries) { entries = []; cache.set(name, entries); }
        entries.push({ influences: mesh.morphTargetInfluences, idx });
      }
    });
    this._morphTargetCache = cache;
    return cache;
  }

  setBlinkController(bc: BlinkControllerLike): void {
    this.blinkController = bc;
  }

  setLipSyncController(lsc: LipSyncControllerLike): void {
    this.lipSyncController = lsc;
  }

  setLaughHeadBobCallback(cb: (nod: number, roll: number) => void): void {
    this._laughHeadBobCallback = cb;
  }

  suppressRawSmileMorphs(durationMs: number): void {
    this._rawSmileSuppressionUntilMs = Math.max(
      this._rawSmileSuppressionUntilMs,
      Date.now() + durationMs,
    );
  }

  dumpActiveSmileMorphs(threshold = 0.001): Array<{ name: string; value: number }> {
    const cache = this._ensureMorphCache();
    if (!cache) return [];
    const active: Array<{ name: string; value: number }> = [];
    for (const [name, entries] of cache) {
      if (!isRawSmileMorphTarget(name) && !/smile|happy|fun|joy|relaxed/i.test(name)) continue;
      const value = Math.max(...entries.map((entry) => entry.influences[entry.idx] ?? 0));
      if (value > threshold) active.push({ name, value });
    }
    return active.sort((a, b) => b.value - a.value);
  }

  /**
   * Apply channel values to the VRM model.
   * Called every frame after ExpressionSystem.update().
   */
  apply(channels: ChannelValues): void {
    if (!this.vrm?.expressionManager) return;

    const em = this.vrm.expressionManager;
    const isLipSyncActive = this.lipSyncController?.isLipSyncActive() ?? false;

    // Clear smile expressions that V2 doesn't use directly. Sara/Tomcat-style
    // models expose raw ARKit smile morphs; clear those whenever the active
    // channel is not smiling, and during explicit upset suppression.
    safeSetValue(em, this.vrm, 'happy', 0);
    safeSetValue(em, this.vrm, 'relaxed', 0);
    if (channels.mouthCorners <= 0.05 || Date.now() < this._rawSmileSuppressionUntilMs) {
      this.clearRawSmileMorphTargets();
    }
    const forceUpsetRawFace = channels.mouthCorners < -0.05 || Date.now() < this._rawSmileSuppressionUntilMs;

    // Debug: log every ~60 frames (1/sec) if values are non-trivial
    this._debugCounter++;
    if (this._debugCounter % 60 === 0) {
      const hasActivity = Math.abs(channels.brows) > 0.01 || Math.abs(channels.mouthCorners) > 0.01
        || Math.abs(channels.gaze.horizontal) > 0.01 || Math.abs(channels.gaze.vertical) > 0.01;
      if (hasActivity) {
        logger.debug('[VRMBridge] channels:', {
          brows: channels.brows.toFixed(3),
          eyelids: channels.eyelids.toFixed(3),
          mouth: channels.mouthCorners.toFixed(3),
          gazeH: channels.gaze.horizontal.toFixed(3),
          gazeV: channels.gaze.vertical.toFixed(3),
          headP: channels.headPose.pitch.toFixed(2),
        });
      }
    }

    // --- Brows ---
    // Use individual morph targets (Fcl_BRW_*) instead of compound VRM expressions.
    // The compound 'Surprised' expression opens mouth + widens eyes too.
    if (channels.brows >= 0) {
      const browValue = Math.min(1, channels.brows * 2.5);
      const hasRawBrow = this.setMorphTarget('Fcl_BRW_Surprised', browValue);
      this.setMorphTarget('Fcl_BRW_Angry', 0);
      safeSetValue(em, this.vrm, 'brows_up', hasRawBrow ? 0 : browValue);
      safeSetValue(em, this.vrm, 'Brows Up', hasRawBrow ? 0 : browValue);
      safeSetValue(em, this.vrm, 'brows_angry', 0);
      safeSetValue(em, this.vrm, 'Brows Down', 0);
      // Also clear compound expressions to prevent stale values
      safeSetValue(em, this.vrm, 'surprised', 0);
      safeSetValue(em, this.vrm, 'angry', 0);
    } else {
      const browValue = Math.min(1, Math.abs(channels.brows) * 2.5);
      const hasRawBrow = this.setMorphTarget('Fcl_BRW_Angry', browValue);
      const rawBrowValue = this.isSaraTomcatProfile()
        ? Math.min(0.7, browValue * (channels.brows < -0.36 ? 0.75 : 0.4))
        : browValue;
      this.setRawMorphTargets(['Brow.angry', 'Brow.frown', 'browDownLeft', 'browDownRight'], rawBrowValue);
      this.setMorphTarget('Fcl_BRW_Surprised', 0);
      safeSetValue(em, this.vrm, 'brows_angry', hasRawBrow ? 0 : browValue);
      safeSetValue(em, this.vrm, 'Brows Down', hasRawBrow ? 0 : browValue);
      safeSetValue(em, this.vrm, 'brows_up', 0);
      safeSetValue(em, this.vrm, 'Brows Up', 0);
      safeSetValue(em, this.vrm, 'angry', 0);
      safeSetValue(em, this.vrm, 'surprised', 0);
    }

    // --- Eyelids ---
    // negative → squint, positive → wide open
    // Three modes based on emotional context:
    //   happy squint  (mouth corners > 0.3)  → keep eyes open; mouth carries smile
    //   sad squint    (mouth corners < -0.2)  → Fcl_EYE_Sorrow (drooping sorrow lids)
    //   neutral squint                        → blink controller (generic)
    if (channels.eyelids < 0) {
      const isHappySquint = channels.mouthCorners > 0.3;
      const isSadSquint = channels.mouthCorners < -0.2;
      if (isHappySquint) {
        // Joy-eye morphs are authored as closed lids on Sara/Tomcat-style models,
        // so keep happy smiles mouth-led and leave eyelids open.
        this.clearSmileEyeTargets();
        this.setMorphTarget('Fcl_EYE_Sorrow', 0);
        safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
        safeSetValue(em, this.vrm, 'brows_sad', 0);
        this.blinkController?.setBaseBlinkValue(0);
      } else if (isSadSquint) {
        // Sorrow eye squint: drooping upper eyelids for crying/sad look
        const sorrowValue = Math.min(1, Math.abs(channels.eyelids) * 2.0);
        const hasRawSorrow = this.setMorphTarget('Fcl_EYE_Sorrow', sorrowValue);
        this.setMorphTarget('Fcl_EYE_Joy', 0);
        this.setMorphTarget('Fcl_EYE_Surprised', 0);
        safeSetValue(em, this.vrm, 'brows_sad', hasRawSorrow ? 0 : sorrowValue * 0.6);
        safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
        safeSetValue(em, this.vrm, 'eyes_wide', 0);
        this.blinkController?.setBaseBlinkValue(hasRawSorrow ? 0 : Math.min(0.12, sorrowValue * 0.12));
      } else {
        // Generic squint via blink controller
        const squintValue = Math.min(0.5, Math.abs(channels.eyelids) * 0.8);
        if (forceUpsetRawFace) {
          this.setRawMorphTargets(['Eye.angry', 'Eye.close.down'], Math.min(0.65, Math.abs(channels.eyelids) * 1.2 + 0.2));
        }
        this.blinkController?.setBaseBlinkValue(squintValue);
        this.setMorphTarget('Fcl_EYE_Joy', 0);
        this.setMorphTarget('Fcl_EYE_Sorrow', 0);
        this.setMorphTarget('Fcl_EYE_Surprised', 0);
        safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
        safeSetValue(em, this.vrm, 'brows_sad', 0);
        safeSetValue(em, this.vrm, 'eyes_wide', 0);
      }
    } else if (channels.eyelids > 0.15) {
      // Wide-open eyes: surprised/scared look via Fcl_EYE_Surprised
      const wideValue = Math.min(1, channels.eyelids * 1.4);
      const hasRawWide = this.setMorphTarget('Fcl_EYE_Surprised', wideValue);
      this.setMorphTarget('Fcl_EYE_Joy', 0);
      this.setMorphTarget('Fcl_EYE_Sorrow', 0);
      safeSetValue(em, this.vrm, 'eyes_wide', hasRawWide ? 0 : wideValue);
      safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
      safeSetValue(em, this.vrm, 'brows_sad', 0);
      this.blinkController?.setBaseBlinkValue(0);
    } else {
      this.setMorphTarget('Fcl_EYE_Surprised', 0);
      this.blinkController?.setBaseBlinkValue(0);
      this.setMorphTarget('Fcl_EYE_Joy', 0);
      this.setMorphTarget('Fcl_EYE_Sorrow', 0);
      safeSetValue(em, this.vrm, 'eyes_wide', 0);
      safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
      safeSetValue(em, this.vrm, 'brows_sad', 0);
    }

    // --- Mouth Corners ---
    // Use individual morph targets for fine-grained control.
    // Only apply if lip sync is NOT active (avoid fighting mouth shapes).
    if (isLipSyncActive && channels.mouthCorners < -0.05) {
      this.setMorphTarget('Fcl_MTH_Fun', 0);
      this.clearRawSmileMorphTargets();
      this.applyRawFrownMorphTargets(Math.min(1, Math.abs(channels.mouthCorners) * 1.35));
      safeSetValue(em, this.vrm, 'smile_closed', 0);
      safeSetValue(em, this.vrm, 'smile_soft_open', 0);
      safeSetValue(em, this.vrm, 'smile_open', 0);
      safeSetValue(em, this.vrm, 'relaxed', 0);
      safeSetValue(em, this.vrm, 'happy', 0);
    }
    if (!isLipSyncActive) {
      if (channels.mouthCorners >= 0) {
        // Smile → Fcl_MTH_Fun (just mouth smile, no eye/brow effects)
        const smileValue = Math.min(1, channels.mouthCorners * 1.5);
        const useSaraRawSmileOnly = this.isSaraTomcatProfile();
        const hasRawSmile = useSaraRawSmileOnly ? false : this.setMorphTarget('Fcl_MTH_Fun', smileValue);
        if (useSaraRawSmileOnly) this.setMorphTarget('Fcl_MTH_Fun', 0);
        this.setMorphTarget('Fcl_MTH_Sorrow', 0);
        this.clearSmileEyeTargets();
        this.clearRawFrownMorphTargets();
        this.applySaraRawSmileMorphTargets(smileValue);
        this.applySaraLipBiteMorphTargets(this.isLipBitePresetActive() ? smileValue : 0);
        safeSetValue(em, this.vrm, 'smile_closed', useSaraRawSmileOnly || hasRawSmile ? 0 : smileValue * 0.55);
        safeSetValue(em, this.vrm, 'smile_soft_open', useSaraRawSmileOnly || hasRawSmile ? 0 : smileValue * 0.35);
        safeSetValue(em, this.vrm, 'smile_open', 0);
        safeSetValue(em, this.vrm, 'mouth_sad', 0);
        safeSetValue(em, this.vrm, 'relaxed', 0);
        safeSetValue(em, this.vrm, 'sad', 0);
      } else {
        // Frown → Fcl_MTH_Sorrow (just mouth frown)
        const frownValue = Math.min(1, Math.abs(channels.mouthCorners) * 1.5);
        const useSaraRawFrownOnly = this.isSaraTomcatProfile();
        const hasRawFrown = useSaraRawFrownOnly ? false : this.setMorphTarget('Fcl_MTH_Sorrow', frownValue);
        if (useSaraRawFrownOnly) this.setMorphTarget('Fcl_MTH_Sorrow', 0);
        this.setMorphTarget('Fcl_MTH_Fun', 0);
        this.clearRawSmileMorphTargets();
        this.applyRawFrownMorphTargets(frownValue);
        this.applySaraLipBiteMorphTargets(0);
        safeSetValue(em, this.vrm, 'mouth_sad', useSaraRawFrownOnly || hasRawFrown ? 0 : frownValue);
        safeSetValue(em, this.vrm, 'smile_closed', 0);
        safeSetValue(em, this.vrm, 'smile_soft_open', 0);
        safeSetValue(em, this.vrm, 'smile_open', 0);
        safeSetValue(em, this.vrm, 'sad', 0);
        safeSetValue(em, this.vrm, 'relaxed', 0);
      }
    }

    // --- Jaw Bias (mouth opening) ---
    // Only when lip sync is NOT active.
    // When laughing (high smile + jaw open), animate rhythmic "ha ha ha" mouth movement.
    if (!isLipSyncActive && channels.jawBias > 0.05) {
      const isLaughing = channels.mouthCorners > 0.4 && channels.jawBias > 0.2;
      const keepSaraSmileClosed = this.isSaraTomcatProfile()
        && channels.mouthCorners > 0.15
        && !this._activeExpressionPresets.includes('laughing')
        && !this._activeExpressionPresets.includes('delighted');
      let jawValue: number;

      if (keepSaraSmileClosed) {
        jawValue = 0;
        this._laughPhase = 0;
      } else if (isLaughing) {
        // Organic laugh: layered rhythms at slightly different speeds
        // so it never repeats exactly — feels alive, not looped
        this._laughPhase += (1 / 60) * 24;
        const t = this._laughPhase;

        // Primary "ha" rhythm with irregular spacing
        const ha1 = Math.max(0, Math.sin(t)) ** 1.5;
        const ha2 = Math.max(0, Math.sin(t * 1.13 + 0.7)) ** 2 * 0.6; // offset harmonic
        const drift = Math.sin(t * 0.19) * 0.08; // slow intensity wander

        // Mouth: always open, pulses between open and more open
        const baseOpen = 0.25;
        const mouthPulse = ha1 * 0.1 + ha2 * 0.05 + drift;
        jawValue = baseOpen + Math.max(0, mouthPulse);

        // Head bob: small springy nods with overshoot, gentle roll
        if (this._laughHeadBobCallback) {
          // Springy: sharp impulse that overshoots and settles
          const impulse = ha1 ** 0.5; // softer curve for the trigger
          const spring = impulse * Math.exp(-((t % 0.26) * 12)) * 1.2; // fast decay with overshoot
          const nodPulse = spring * 0.03 + ha2 * 0.012;
          const rollWobble = Math.sin(t * 0.6 + 2.1) * 0.011;
          this._laughHeadBobCallback(nodPulse, rollWobble);
        }
      } else {
        jawValue = Math.min(0.8, channels.jawBias * 0.8);
        this._laughPhase = 0;
      }

      safeSetValue(em, this.vrm, 'aa', jawValue);
      // Also slightly reduce smile during jaw open peaks to avoid fighting
      if (isLaughing && channels.mouthCorners > 0) {
        const smileReduce = jawValue * 0.3;
        const smileValue = Math.max(0, Math.min(1, channels.mouthCorners * 1.5) - smileReduce);
        const hasRawSmile = this.setMorphTarget('Fcl_MTH_Fun', smileValue);
        safeSetValue(em, this.vrm, 'smile_closed', hasRawSmile ? 0 : smileValue * 0.45);
        safeSetValue(em, this.vrm, 'smile_soft_open', hasRawSmile ? 0 : smileValue * 0.25);
      }
    } else if (!isLipSyncActive) {
      safeSetValue(em, this.vrm, 'aa', 0);
      this._laughPhase = 0;
    }

    // --- Gaze ---
    // Gaze blend shapes typically have 0 bindings on these models (bone-based
    // lookAt). Apply gaze by rotating the eye bones directly.
    this.applyGazeLookAt(channels.gaze);

    // --- Blink Modulation ---
    // The blink controller doesn't have direct modulation parameters,
    // but we can adjust the base blink value and timing through config
    this.applyBlinkModulation(channels.blinkMod);

    // Note: HeadPose is applied externally via the head bone transform,
    // not through the VRM expression manager. The scene integration handles
    // reading channels.headPose and applying it to the head bone.

    // Flush expression values to mesh morph targets.
    // Bridge runs AFTER vrm.update(), so we call em.update() to apply our values.
    em.update();
  }

  private applyBlinkModulation(mod: BlinkModulation): void {
    if (!this.blinkController) return;

    // Adjust blink controller config based on modulation
    // intervalScale affects how often blinks happen
    // We map this to the controller's config
    const baseMinInterval = 2.0;
    const baseMaxInterval = 6.0;

    this.blinkController.updateConfig({
      minInterval: baseMinInterval * mod.intervalScale,
      maxInterval: baseMaxInterval * mod.intervalScale,
      blinkDuration: 0.15 * mod.durationScale,
    });
  }

  // Gaze smoothing state + eye bone cache
  private _gazeCurrent = { h: 0, v: 0 };
  private _leftEyeBone: THREE.Object3D | null = null;
  private _rightEyeBone: THREE.Object3D | null = null;
  private _eyeBonesResolved = false;

  /**
   * Apply gaze by directly rotating eye bones every frame.
   * Must run AFTER vrm.update() since VRM resets raw bones each frame.
   */
  private applyGazeLookAt(gaze: GazeTarget): void {
    if (!this.vrm?.humanoid) return;

    // Cache eye bones on first call
    if (!this._eyeBonesResolved) {
      this._eyeBonesResolved = true;
      this._leftEyeBone = this.vrm.humanoid.getRawBoneNode('leftEye');
      this._rightEyeBone = this.vrm.humanoid.getRawBoneNode('rightEye');
      logger.debug('[VRMBridge] Eye bones:', { left: !!this._leftEyeBone, right: !!this._rightEyeBone });
    }

    if (!this._leftEyeBone && !this._rightEyeBone) return;

    // Light smoothing only — GazeController already handles primary smoothing
    const lerpSpeed = 10.0;
    const dt = 1 / 60;
    const factor = 1 - Math.exp(-lerpSpeed * dt);
    this._gazeCurrent.h += (gaze.horizontal - this._gazeCurrent.h) * factor;
    this._gazeCurrent.v += (gaze.vertical - this._gazeCurrent.v) * factor;

    // Convert gaze channels to eye rotation (radians)
    const maxAngle = 0.52; // ~30 degrees max — enough for visible glance-aways
    const yaw = -this._gazeCurrent.h * maxAngle;
    const pitch = this._gazeCurrent.v * maxAngle;

    // Apply rotation in the PARENT (head) frame via premultiply, NOT the eye
    // bone's local frame. VRM0 rigs have an identity eye-bone rest, so
    // local-frame multiply happened to work. But VRM1 rigs can have a
    // non-identity (tilted ~21°) eye-bone rest, and a local-frame multiply
    // couples vertical gaze into opposite-direction horizontal drift on the two
    // eyes (they diverge/roll as they pitch up — the "eyes rolled back" bug).
    // premultiply keeps pitch/yaw head-aligned on every rig; it is a provable
    // no-op for identity-rest VRM0 models. Both eyes share one quaternion.
    if (this._leftEyeBone || this._rightEyeBone) {
      _eyeEuler.set(pitch, yaw, 0, 'YXZ');
      _eyeQuat.setFromEuler(_eyeEuler);
      if (this._leftEyeBone) this._leftEyeBone.quaternion.premultiply(_eyeQuat);
      if (this._rightEyeBone) this._rightEyeBone.quaternion.premultiply(_eyeQuat);
    }
  }

  /**
   * Directly set a morph target by name on all face meshes.
   * Bypasses VRM expression manager for fine-grained control
   * (e.g. Fcl_BRW_Surprised for just eyebrows, not the compound expression).
   */
  private setMorphTarget(name: string, value: number): boolean {
    const cache = this._ensureMorphCache();
    if (!cache) return false;
    const entries = cache.get(name);
    if (!entries) return false;
    const clamped = Math.max(0, Math.min(1, value));
    // Direct write — no scene.traverse, no per-call closure allocation.
    for (let i = 0; i < entries.length; i++) {
      entries[i].influences[entries[i].idx] = clamped;
    }
    return true;
  }

  private setRawMorphTargets(names: readonly string[], value: number): boolean {
    let wrote = false;
    for (let i = 0; i < names.length; i++) {
      wrote = this.setMorphTarget(names[i], value) || wrote;
    }
    return wrote;
  }

  private isSaraTomcatProfile(): boolean {
    return this._characterExpressionProfile === 'saraTomcat';
  }

  private isLipBitePresetActive(): boolean {
    return this.isSaraTomcatProfile() && this._activeExpressionPresets.includes('lipBite');
  }

  private applySaraRawSmileMorphTargets(value: number): boolean {
    if (!this.isSaraTomcatProfile()) return false;
    const activePresets = new Set(this._activeExpressionPresets);
    const isSmirk = activePresets.has('teasing') || activePresets.has('smug') || activePresets.has('lipBite');
    const clamped = Math.max(0, Math.min(0.75, value));
    const left = isSmirk ? clamped * 0.45 : clamped;
    const right = isSmirk ? clamped : clamped;
    const wroteLeft = this.setRawMorphTargets([RAW_SARA_MOUTH_SMILE_MORPHS[0]], left);
    const wroteRight = this.setRawMorphTargets([RAW_SARA_MOUTH_SMILE_MORPHS[1]], right);
    const wroteLeftDimple = this.setRawMorphTargets([RAW_SARA_MOUTH_SMILE_MORPHS[2]], isSmirk ? left * 0.7 : clamped * 0.25);
    const wroteRightDimple = this.setRawMorphTargets([RAW_SARA_MOUTH_SMILE_MORPHS[3]], isSmirk ? right * 0.7 : clamped * 0.25);
    return wroteLeft || wroteRight || wroteLeftDimple || wroteRightDimple;
  }

  private applySaraLipBiteMorphTargets(value: number): boolean {
    if (!this.isSaraTomcatProfile()) return false;
    const clamped = Math.max(0, Math.min(0.6, value * 0.85));
    return this.setRawMorphTargets([...RAW_SARA_LIP_BITE_MORPHS], clamped);
  }

  private applyRawFrownMorphTargets(value: number): boolean {
    const clamped = Math.max(0, Math.min(1, value));
    const wroteFrown = this.isSaraTomcatProfile()
      ? this.setRawMorphTargets(['mouthFrownLeft', 'mouthFrownRight'], clamped)
        || this.setRawMorphTargets(['mouthLowerDownLeft', 'mouthLowerDownRight'], clamped * 0.35)
      : this.setRawMorphTargets([
        'mouthFrownLeft',
        'mouthFrownRight',
        'mouthPressLeft',
        'mouthPressRight',
        'mouthShrugLower',
      ], clamped);
    const clearedLipBite = this.applySaraLipBiteMorphTargets(0);
    return wroteFrown || clearedLipBite;
  }

  private clearSmileEyeTargets(): boolean {
    const clearedRaw = this.setRawMorphTargets([...RAW_SMILE_EYE_MORPHS], 0);
    const clearedJoy = this.setMorphTarget('Fcl_EYE_Joy', 0);
    return clearedRaw || clearedJoy;
  }

  private clearRawSmileMorphTargets(): boolean {
    const cache = this._ensureMorphCache();
    if (!cache) return false;
    let cleared = false;
    for (const [name, entries] of cache) {
      if (!isRawSmileMorphTarget(name)) continue;
      for (let i = 0; i < entries.length; i++) {
        entries[i].influences[entries[i].idx] = 0;
      }
      cleared = true;
    }
    return cleared;
  }

  private clearRawFrownMorphTargets(): boolean {
    const cache = this._ensureMorphCache();
    if (!cache) return false;
    let cleared = false;
    for (const [name, entries] of cache) {
      if (!isRawFrownMorphTarget(name) && !/^Mth\.BitLi-/.test(name)) continue;
      for (let i = 0; i < entries.length; i++) {
        entries[i].influences[entries[i].idx] = 0;
      }
      cleared = true;
    }
    return cleared;
  }

  /**
   * Get the current head pose offset for external application.
   * The caller (scene integration) applies this to the head bone.
   */
  getHeadPoseFromChannels(channels: ChannelValues): HeadPoseOffset {
    return channels.headPose;
  }

  reset(): void {
    if (this.vrm?.expressionManager) {
      const em = this.vrm.expressionManager;
      safeSetValue(em, this.vrm, 'happy', 0);
      safeSetValue(em, this.vrm, 'angry', 0);
      safeSetValue(em, this.vrm, 'sad', 0);
      safeSetValue(em, this.vrm, 'relaxed', 0);
      safeSetValue(em, this.vrm, 'surprised', 0);
      safeSetValue(em, this.vrm, 'lookUp', 0);
      safeSetValue(em, this.vrm, 'lookDown', 0);
      safeSetValue(em, this.vrm, 'lookLeft', 0);
      safeSetValue(em, this.vrm, 'lookRight', 0);
      safeSetValue(em, this.vrm, 'eyes_wide', 0);
      safeSetValue(em, this.vrm, 'eyes_gaze_soft', 0);
      safeSetValue(em, this.vrm, 'brows_up', 0);
      safeSetValue(em, this.vrm, 'brows_sad', 0);
      safeSetValue(em, this.vrm, 'brows_angry', 0);
      safeSetValue(em, this.vrm, 'Brows Up', 0);
      safeSetValue(em, this.vrm, 'Brows Down', 0);
      safeSetValue(em, this.vrm, 'smile_closed', 0);
      safeSetValue(em, this.vrm, 'smile_soft_open', 0);
      safeSetValue(em, this.vrm, 'smile_open', 0);
      safeSetValue(em, this.vrm, 'mouth_sad', 0);
      safeSetValue(em, this.vrm, 'mouth_sneer', 0);
    }
    this.blinkController?.setBaseBlinkValue(0);
    this.blinkController?.updateConfig({
      minInterval: 2.0,
      maxInterval: 6.0,
      blinkDuration: 0.15,
    });
  }
}

/**
 * Build a case-insensitive name map from the VRM's registered expressions.
 * Called once per VRM model, caches the mapping.
 */
let _nameMap: Map<string, string> | null = null;
let _nameMapVRM: VRM | null = null;

function getExpressionNameMap(em: NonNullable<VRM['expressionManager']>, vrm: VRM): Map<string, string> {
  if (_nameMap && _nameMapVRM === vrm) return _nameMap;
  _nameMap = new Map();
  _nameMapVRM = vrm;
  const expressions = (em as unknown as { expressions?: Array<{ expressionName?: string }> }).expressions ?? [];
  for (const expr of expressions) {
    const name = expr.expressionName ?? '';
    _nameMap.set(name.toLowerCase(), name);
  }
  return _nameMap;
}

/**
 * Case-insensitive expression setValue.
 * Some VRM models register expressions with non-standard casing (e.g. "Surprised" vs "surprised").
 */
function safeSetValue(
  em: NonNullable<VRM['expressionManager']>,
  vrm: VRM | null,
  name: string,
  value: number,
): void {
  try {
    const clamped = Math.max(0, Math.min(1, value));
    // Resolve to actual registered name (handles case mismatches)
    const resolved = vrm ? getExpressionNameMap(em, vrm).get(name.toLowerCase()) ?? name : name;
    em.setValue(resolved, clamped);
  } catch {
    // Silently ignore — expression might not exist on this model
  }
}
