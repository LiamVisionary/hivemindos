/**
 * ProceduralAnimationController — procedural breathing/sway/idle micro-motion
 * layered on top of clip animation for a VRM character.
 *
 * Ported from ami-ai-companion (src/components/3d/ProceduralAnimationController.ts).
 * Differences from the source:
 * - Fully typed (the source used @ts-nocheck for three/@pixiv type conflicts).
 * - Config/posture tables live in ./procedural-animation-config.
 * - Dexie device-settings lookup (getIdleAnimationsEnabledSync) replaced with a
 *   constructor option { idleAnimationsEnabled?: boolean } defaulting to true.
 *
 * Most procedural motion writes to NORMALIZED bones via per-frame deltas
 * (normalized bones persist between frames), while head/neck look systems
 * write FULL offsets to RAW bones every frame (VRM.update() resets raw bones
 * from normalized bones each frame).
 */

import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { logger } from '../logger';
import { IdleMotionOrchestrator } from './idle-motion-orchestrator';
import {
  DEFAULT_CONFIG,
  EMOTION_POSTURES,
  EMOTION_TO_POSTURE,
  type EmotionPosture,
  type PostureAdjustment,
  type ProceduralAnimationConfig,
} from './procedural-animation-config';

import type {
  FidgetState,
  FidgetType,
  LookAtImageState,
  LookTarget,
  ManualMotionType,
  ProceduralAnimationOptions,
} from './procedural-animation-config';

export type {
  EmotionPosture,
  FidgetType,
  ManualMotionType,
  ProceduralAnimationConfig,
  ProceduralAnimationOptions,
} from './procedural-animation-config';

export class ProceduralAnimationController {
  private vrm: VRM;
  private config: ProceduralAnimationConfig;
  private enabled: boolean = true;
  private elapsedTime: number = 0;

  // Animation state
  private lookTarget: LookTarget | null = null;
  private currentLookX: number = 0;
  private currentLookY: number = 0;
  private nextLookTime: number = 0;

  private fidgetState: FidgetState = { type: 'none', startTime: 0, duration: 0, intensity: 0, direction: 1 };
  private nextFidgetTime: number = 0;

  // Micro-variation state (Perlin-like noise for natural movement)
  private microNoisePhase: number = Math.random() * 1000;
  private microNoiseSpeed: number = 0.08 + Math.random() * 0.04; // Very slow = very subtle

  // Emotion posture blending state
  private currentPosture: EmotionPosture = 'neutral';
  private targetPosture: EmotionPosture = 'neutral';
  private currentPostureValues: PostureAdjustment = { ...EMOTION_POSTURES.neutral };

  // Look at image state - smooth interpolation for body/head/eye rotation
  private lookAtImageState: LookAtImageState = {
    enabled: false,
    progress: 0,
    bodyRotationY: 0.12,     // ~7 degrees body turn left
    headRotationY: 0.35,     // ~20 degrees head turn left
    headRotationX: 0.08,     // Slight downward tilt
    eyeRotationY: 0.5,       // Eyes look even more left
    screenTarget: null,
  };
  // Current look-at-image offset values (interpolated like currentLookX/Y in updateLookAround)
  private lookAtImageOffsets = { neckY: 0, headY: 0, headX: 0 };

  // Bone references (cached for performance)
  // NOTE: We use NORMALIZED bones for most procedural animations (breathing, sway, etc)
  // but RAW bones for look-at-image (raw bones are the actual rendered bones)
  private spineBone: THREE.Object3D | null = null;
  private chestBone: THREE.Object3D | null = null;
  private neckBone: THREE.Object3D | null = null;
  private headBone: THREE.Object3D | null = null;
  private leftShoulderBone: THREE.Object3D | null = null;
  private rightShoulderBone: THREE.Object3D | null = null;
  private hipsBone: THREE.Object3D | null = null;

  // RAW bone references for look-at-image (these are the actual rendered bones)
  private rawHeadBone: THREE.Object3D | null = null;
  private rawNeckBone: THREE.Object3D | null = null;

  // Reusable objects for quaternion calculations (avoid garbage collection)
  private _lookRotation = new THREE.Quaternion();
  private _lookEuler = new THREE.Euler();

  // Store initial rotations
  private initialRotations: Map<THREE.Object3D, THREE.Euler> = new Map();

  // User-focus override: when true, head/body turns toward camera even without speaking.
  // Used for pre-greeting and greeting sequences.
  private userFocusOverride: boolean = false;
  private headTrackingEnabled: boolean = true;
  // Master switch for ALL procedural head-bone manipulation (look-around, conversational
  // nods, head tilts, expression pose, micro-variations, emotion posture, fidget head tilts,
  // user-focus turn, look-at-image head rotation). Eye gaze via VRM.lookAt remains active.
  private proceduralHeadMotionEnabled: boolean = false;
  // Narrow opt-in for JUST the user-focus head turn (glance toward the user
  // while speaking), independent of the proceduralHeadMotionEnabled master
  // switch. Park walk mode uses this: the master switch would also revive
  // look-around/nods/fidget (deliberately off during the treadmill walk),
  // whereas this enables ONLY updateUserFocusHeadTurn so she turns her head
  // toward the camera when speaking while still walking forward.
  private userFocusHeadTurnEnabled: boolean = false;

  /** Whether the character should face the user (speaking OR override). */
  private get shouldFaceUser(): boolean {
    return this.headTrackingEnabled && (this.isSpeaking || this.userFocusOverride);
  }

  // Conversational motion state
  private isSpeaking: boolean = false;
  private convDemoMode: boolean = false; // Forces speaking state for dev testing
  private speakingBlend: number = 0; // 0 = idle, 1 = fully speaking (smooth blend)
  // Manual one-shot motion overlay (triggered from dev panel)
  private manualMotion: { type: ManualMotionType; startTime: number; duration: number; direction: number } | null = null;
  private convPhase: number = Math.random() * Math.PI * 2; // randomize start phase
  private convEmphasisTimer: number = 0;
  private convEmphasisActive: boolean = false;
  private convEmphasisIntensity: number = 0;
  private convMotionCallback: ((event: string) => void) | null = null;
  private lastReportedMotion: string = ''; // Avoid spamming same event

  // Expression system head pose (from Expressions 2.0)
  // These are target offsets in radians that get smoothly applied additively
  private exprHeadTarget = { pitch: 0, yaw: 0, roll: 0 };

  // Expression system gaze (from Expressions 2.0)
  // Applied via VRM lookAt target position (not blend shapes)
  private exprGazeTarget = { horizontal: 0, vertical: 0 };
  private exprGazeCurrent = { horizontal: 0, vertical: 0 };

  // User-focus head turn: when speaking, actively rotate head toward camera.
  // Body rotation overflow (excess beyond head clamp) is applied directly here.
  private camera: THREE.Camera | null = null;
  private baseRotationY: number = 0; // VRM scene's neutral Y rotation (π for VRM 0.x)
  /** Original base rotation that determines VRM type (0.x vs 1.0). Never changes after init. */
  private originalBaseRotationY: number = 0;
  /** When true, suppress body rotation overflow (e.g. character is seated on furniture). */
  private seated: boolean = false;
  /** When true, allow body to rotate toward camera when speaking. Only enabled in 3D home scene. */
  private bodyFacingEnabled: boolean = false;
  private userFocusCurrent = { yaw: 0, pitch: 0 };
  /** Override: if set, head looks at this world position instead of camera. */
  private headLookOverride: THREE.Vector3 | null = null;
  // Reusable vectors to avoid GC pressure
  private _headWorldPos = new THREE.Vector3();
  private _camWorldPos = new THREE.Vector3();
  private _dirToCamera = new THREE.Vector3();
  private _charForward = new THREE.Vector3();
  private _charRight = new THREE.Vector3();
  private _charUp = new THREE.Vector3();
  private _sceneQuat = new THREE.Quaternion();

  // Idle motion orchestrator — schedules natural behaviors during silence
  public idleMotionOrchestrator: IdleMotionOrchestrator;

  constructor(vrm: VRM, config?: Partial<ProceduralAnimationConfig>, options?: ProceduralAnimationOptions) {
    this.vrm = vrm;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cacheBones();
    this.scheduleNextLook();
    this.scheduleNextFidget();

    // Initialize idle motion orchestrator and wire it to our APIs
    this.idleMotionOrchestrator = new IdleMotionOrchestrator();
    this.idleMotionOrchestrator.setTarget(this.buildIdleMotionTarget());
    this.idleMotionOrchestrator.setEnabled(options?.idleAnimationsEnabled ?? true);
  }

  private buildIdleMotionTarget() {
    return {
      triggerLook: (x: number, y: number, duration: number) => this.triggerLook(x, y, duration),
      triggerFidget: (type: 'shoulder' | 'weight' | 'headTilt') => this.triggerFidget(type),
      triggerDeepBreath: () => this.triggerDeepBreath(),
      triggerManualMotion: (type: ManualMotionType) => this.triggerManualMotion(type),
    };
  }

  private cacheBones(): void {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;

    // Cache bone references
    this.spineBone = humanoid.getNormalizedBoneNode('spine');
    this.chestBone = humanoid.getNormalizedBoneNode('chest');
    this.neckBone = humanoid.getNormalizedBoneNode('neck');
    this.headBone = humanoid.getNormalizedBoneNode('head');
    this.leftShoulderBone = humanoid.getNormalizedBoneNode('leftShoulder');
    this.rightShoulderBone = humanoid.getNormalizedBoneNode('rightShoulder');
    this.hipsBone = humanoid.getNormalizedBoneNode('hips');

    // Cache RAW bones for look-at-image (raw bones are the actual rendered bones)
    this.rawHeadBone = humanoid.getRawBoneNode('head');
    this.rawNeckBone = humanoid.getRawBoneNode('neck');

    // Store initial rotations for all bones
    [this.spineBone, this.chestBone, this.neckBone, this.headBone,
     this.leftShoulderBone, this.rightShoulderBone, this.hipsBone].forEach(bone => {
      if (bone) {
        this.initialRotations.set(bone, bone.rotation.clone());
      }
    });

    logger.debug('ProceduralAnimationController bones cached:', {
      spine: !!this.spineBone,
      chest: !!this.chestBone,
      neck: !!this.neckBone,
      head: !!this.headBone,
      leftShoulder: !!this.leftShoulderBone,
      rightShoulder: !!this.rightShoulderBone,
      hips: !!this.hipsBone,
      rawHead: !!this.rawHeadBone,
      rawNeck: !!this.rawNeckBone,
    });
  }

  updateFrame(delta: number): void {
    if (!this.enabled) return;

    this.elapsedTime += delta;

    // Tick idle motion orchestrator (dispatches motions when user is silent)
    this.idleMotionOrchestrator.tick();

    // Apply all procedural animations
    this.updateBreathing();
    this.updateIdleSway();
    this.updateLookAround(delta);
    this.updateUserFocusHeadTurn(delta); // Must run after lookAround, before conversational — provides base "face user" rotation
    this.updateFidget();
    this.updateHeadTilt();
    this.updateMicroVariations();
    this.updateEmotionPosture(delta);
    this.updateConversationalMotion(delta);
    this.updateExpressionHeadPose(delta);
    // Expression gaze is handled directly by the channel bridge in ami
    // (it sets lookAt.target and calls lookAt.update() in the same frame).
    this.updateLookAtImage(delta);
  }

  // Track previous breathing values to apply deltas (normalized bones persist between frames)
  private prevBreathSpine = 0;
  private prevBreathChest = 0;

  private updateBreathing(): void {
    if (!this.config.breathing.enabled) return;

    const { speed, intensity } = this.config.breathing;
    const breathsPerSecond = speed / 60;
    const phase = (this.elapsedTime * breathsPerSecond * Math.PI * 2) % (Math.PI * 2);
    const breathValue = Math.sin(phase) * intensity * 0.025;

    const spineVal = breathValue * 0.5;
    const chestVal = breathValue;

    if (this.spineBone) {
      this.spineBone.rotation.x += spineVal - this.prevBreathSpine;
    }
    if (this.chestBone) {
      this.chestBone.rotation.x += chestVal - this.prevBreathChest;
    }

    this.prevBreathSpine = spineVal;
    this.prevBreathChest = chestVal;
  }

  // Track previous sway values for delta application
  private prevSwayHipsZ = 0;
  private prevSwayHipsX = 0;
  private prevSwaySpineZ = 0;

  private updateIdleSway(): void {
    if (!this.config.idleSway.enabled) return;

    const { speed, intensity } = this.config.idleSway;
    const swaysPerSecond = speed / 60;
    const phase1 = this.elapsedTime * swaysPerSecond * Math.PI * 2;
    const phase2 = this.elapsedTime * swaysPerSecond * 0.7 * Math.PI * 2;

    const swayX = Math.sin(phase1) * intensity * 0.015;
    const swayZ = Math.sin(phase2) * intensity * 0.01;

    const hipsZ = swayX;
    const hipsX = swayZ * 0.5;
    const spineZ = -swayX * 0.3;

    if (this.hipsBone) {
      this.hipsBone.rotation.z += hipsZ - this.prevSwayHipsZ;
      this.hipsBone.rotation.x += hipsX - this.prevSwayHipsX;
    }
    if (this.spineBone) {
      this.spineBone.rotation.z += spineZ - this.prevSwaySpineZ;
    }

    this.prevSwayHipsZ = hipsZ;
    this.prevSwayHipsX = hipsX;
    this.prevSwaySpineZ = spineZ;
  }

  private scheduleNextLook(): void {
    const { frequency } = this.config.lookAround;
    const variance = frequency * 0.5;
    this.nextLookTime = this.elapsedTime + frequency + (Math.random() - 0.5) * variance;
  }

  /**
   * Look-around: smoothly turn head (and neck) toward a target then return.
   * Uses FULL offsets applied each frame (same pattern as conversational motion)
   * because VRM.update() resets raw bones every frame.
   *
   * When speaking, look-around is suppressed — the head smoothly returns to
   * forward (facing the user) and any active look target is cancelled.
   * Conversational motion and expression head pose still layer on top additively.
   */
  private updateLookAround(delta: number): void {
    if (!this.headTrackingEnabled) return;
    if (!this.proceduralHeadMotionEnabled) return;
    // Skip when focused on looking at image
    if (this.lookAtImageState.enabled) return;

    // When speaking, cancel any active look target so the head returns to forward (facing user).
    // The speakingBlend is used to smoothly fade out remaining look offsets.
    if (this.shouldFaceUser && this.lookTarget) {
      this.lookTarget = null;
    }

    // Auto-scheduling only runs when enabled AND not facing user
    if (this.config.lookAround.enabled && !this.shouldFaceUser) {
      const { range } = this.config.lookAround;
      if (this.elapsedTime >= this.nextLookTime && !this.lookTarget) {
        const targetX = (Math.random() - 0.5) * range * 0.3;
        const targetY = (Math.random() - 0.5) * range * 0.2;
        this.lookTarget = {
          x: targetX,
          y: targetY,
          startTime: this.elapsedTime,
          duration: 0.8 + Math.random() * 1.2,
        };
        this.scheduleNextLook();
      }
    }

    // Always process the active lookTarget (even if auto-scheduling is off)
    if (!this.lookTarget && Math.abs(this.currentLookX) < 0.0001 && Math.abs(this.currentLookY) < 0.0001) return;

    // Determine where we want to look (0,0 = neutral/forward = facing user)
    let targetX = 0;
    let targetY = 0;

    if (this.lookTarget) {
      const elapsed = this.elapsedTime - this.lookTarget.startTime;
      if (elapsed < this.lookTarget.duration) {
        targetX = this.lookTarget.x;
        targetY = this.lookTarget.y;
      } else {
        this.lookTarget = null;
      }
    }

    // When speaking, use faster interpolation back to forward for snappy user-focus
    // Uses frame-rate-independent exponential smoothing (same as updateUserFocusHeadTurn)
    const lookSpeed = this.shouldFaceUser ? 4.0 : 1.5;
    const lookFactor = 1 - Math.exp(-lookSpeed * delta);
    this.currentLookX += (targetX - this.currentLookX) * lookFactor;
    this.currentLookY += (targetY - this.currentLookY) * lookFactor;

    // Snap to zero when close to prevent perpetual micro-updates
    if (Math.abs(this.currentLookX) < 0.0001) this.currentLookX = 0;
    if (Math.abs(this.currentLookY) < 0.0001) this.currentLookY = 0;

    const totalMag = Math.abs(this.currentLookX) + Math.abs(this.currentLookY);
    if (totalMag < 0.0001) return;

    // Apply FULL offset each frame (VRM.update resets raw bones every frame)
    // Same pattern as updateConversationalMotion and updateExpressionHeadPose.
    if (this.rawHeadBone) {
      this._lookEuler.set(this.currentLookY, this.currentLookX, 0, 'YXZ');
      this._lookRotation.setFromEuler(this._lookEuler);
      this.rawHeadBone.quaternion.multiply(this._lookRotation);
      this.rawHeadBone.updateMatrix();
      this.rawHeadBone.updateMatrixWorld(true);
    }

    // Neck follows at ~30% for distributed, natural movement
    if (this.rawNeckBone) {
      const neckMag = Math.abs(this.currentLookY * 0.3) + Math.abs(this.currentLookX * 0.3);
      if (neckMag > 0.0005) {
        this._lookEuler.set(this.currentLookY * 0.3, this.currentLookX * 0.3, 0, 'YXZ');
        this._lookRotation.setFromEuler(this._lookEuler);
        this.rawNeckBone.quaternion.multiply(this._lookRotation);
        this.rawNeckBone.updateMatrix();
      }
    }
  }

  /**
   * User-focus head turn: when speaking, compute the direction from the head bone
   * to the camera and rotate the head (+ neck) to face the user.
   *
   * Head yaw is clamped. Any excess yaw beyond that threshold directly
   * rotates the body (vrm.scene.rotation.y) to absorb the overflow, so the head
   * stays within a comfortable range. Pitch is clamped (head only).
   *
   * Runs BEFORE conversational motion so nods/tilts layer on top additively.
   */
  private static readonly USER_FOCUS_HEAD_MAX = 30 * (Math.PI / 180); // 30° head clamp
  private _headMaxOverride: number | null = null;
  private static readonly USER_FOCUS_PITCH_MAX = 30 * (Math.PI / 180); // 30° pitch clamp
  private static readonly _Y_AXIS = new THREE.Vector3(0, 1, 0);

  private static normalizeAngle(a: number): number {
    let r = a % (2 * Math.PI);
    if (r > Math.PI) r -= 2 * Math.PI;
    if (r < -Math.PI) r += 2 * Math.PI;
    return r;
  }

  private updateUserFocusHeadTurn(delta: number): void {
    if (!this.rawHeadBone || !this.camera) return;
    if (!this.proceduralHeadMotionEnabled && !this.userFocusHeadTurnEnabled) return;
    // Skip when looking at an image (that system takes priority)
    if (this.lookAtImageState.enabled) return;

    const headMax = this._headMaxOverride ?? ProceduralAnimationController.USER_FOCUS_HEAD_MAX;
    const pitchMax = ProceduralAnimationController.USER_FOCUS_PITCH_MAX;
    // Use originalBaseRotationY for VRM-type detection — baseRotationY changes
    // during wander and would flip the facing formula 180°.
    const fwdZ = Math.cos(this.originalBaseRotationY) < 0 ? -1 : 1;
    const facesCameraAtBase = fwdZ === -1; // VRM 0.x

    // When not speaking and blend is done (or head tracking explicitly disabled), head returns to neutral.
    // Body stays where it is — no drift-back. She should remain facing
    // wherever PAC left her (toward camera / look target) until something
    // else explicitly changes body rotation (wander, CFM return, etc.).
    if (!this.headTrackingEnabled || (!this.shouldFaceUser && this.speakingBlend <= 0.01)) {
      const headLerpSpeed = 3.5;
      const headFactor = 1 - Math.exp(-headLerpSpeed * delta);
      this.userFocusCurrent.yaw += (0 - this.userFocusCurrent.yaw) * headFactor;
      this.userFocusCurrent.pitch += (0 - this.userFocusCurrent.pitch) * headFactor;
      if (Math.abs(this.userFocusCurrent.yaw) < 0.001) this.userFocusCurrent.yaw = 0;
      if (Math.abs(this.userFocusCurrent.pitch) < 0.001) this.userFocusCurrent.pitch = 0;
    } else {
      // Look target: headLookOverride (other character) or camera
      if (this.headLookOverride) {
        this._camWorldPos.copy(this.headLookOverride);
      } else {
        this.camera.getWorldPosition(this._camWorldPos);
      }

      const scenePos = this.vrm.scene.position;
      const dx = this._camWorldPos.x - scenePos.x;
      const dz = this._camWorldPos.z - scenePos.z;

      // --- Step 1: Rotate body toward target (absolute, jitter-free) ---
      // Compute the scene.rotation.y that makes the body face the target directly.
      // Uses atan2 for an absolute target — no per-frame deltas that can sign-flip.
      // Only applies in 3D home scene (bodyFacingEnabled) to avoid unwanted rotation in 2D scenes.
      if (!this.seated && this.bodyFacingEnabled) {
        const angleToTarget = Math.atan2(dx, dz);
        const targetBodyRotY = facesCameraAtBase
          ? ProceduralAnimationController.normalizeAngle(Math.PI + angleToTarget)
          : ProceduralAnimationController.normalizeAngle(angleToTarget);
        const bodyDiff = ProceduralAnimationController.normalizeAngle(
          targetBodyRotY - this.vrm.scene.rotation.y,
        );
        if (Math.abs(bodyDiff) > 0.01) {
          const bodyTurnSpeed = 4.0;
          const bodyFactor = 1 - Math.exp(-bodyTurnSpeed * delta);
          this.vrm.scene.rotation.y += bodyDiff * bodyFactor;
        }
      }

      // --- Step 2: Compute head yaw from the (now-updated) body rotation ---
      const currentBodyRotY = this.vrm.scene.rotation.y;
      this._sceneQuat.setFromAxisAngle(ProceduralAnimationController._Y_AXIS, currentBodyRotY);
      this._charForward.set(0, 0, fwdZ).applyQuaternion(this._sceneQuat);
      this._charRight.set(-fwdZ, 0, 0).applyQuaternion(this._sceneQuat);
      this._charUp.set(0, 1, 0).applyQuaternion(this._sceneQuat);

      const horizDist = Math.sqrt(dx * dx + dz * dz);
      const dirX = horizDist > 0.001 ? dx / horizDist : 0;
      const dirZ = horizDist > 0.001 ? dz / horizDist : 0;

      const sinYaw = dirX * this._charRight.x + dirZ * this._charRight.z;
      const cosYaw = dirX * this._charForward.x + dirZ * this._charForward.z;
      const totalYaw = -Math.atan2(sinYaw, cosYaw);
      const clampedYaw = Math.max(-headMax, Math.min(headMax, totalYaw));

      // --- Pitch: compute from head bone position for vertical accuracy ---
      this.rawHeadBone.getWorldPosition(this._headWorldPos);
      this._dirToCamera.subVectors(this._camWorldPos, this._headWorldPos).normalize();
      const sinPitch = this._dirToCamera.dot(this._charUp);
      const horizLen = Math.sqrt(1 - sinPitch * sinPitch);
      const targetPitch = Math.max(-pitchMax, Math.min(pitchMax, Math.atan2(sinPitch, horizLen)));

      const headLerpSpeed = 3.5;
      const headFactor = 1 - Math.exp(-headLerpSpeed * delta);

      this.userFocusCurrent.yaw += (clampedYaw - this.userFocusCurrent.yaw) * headFactor;
      this.userFocusCurrent.pitch += (targetPitch - this.userFocusCurrent.pitch) * headFactor;

      if (Math.abs(this.userFocusCurrent.yaw) < 0.001) this.userFocusCurrent.yaw = 0;
      if (Math.abs(this.userFocusCurrent.pitch) < 0.001) this.userFocusCurrent.pitch = 0;
    }

    // --- Apply head + neck bone rotation ---
    const totalHeadMag = Math.abs(this.userFocusCurrent.yaw) + Math.abs(this.userFocusCurrent.pitch);
    if (totalHeadMag < 0.001) return;

    // Apply to raw head bone (FULL offset — VRM.update resets raw bones each frame)
    this._lookEuler.set(this.userFocusCurrent.pitch, this.userFocusCurrent.yaw, 0, 'YXZ');
    this._lookRotation.setFromEuler(this._lookEuler);
    this.rawHeadBone.quaternion.multiply(this._lookRotation);
    this.rawHeadBone.updateMatrix();
    this.rawHeadBone.updateMatrixWorld(true);

    // Neck follows at ~40% for natural distributed rotation
    if (this.rawNeckBone) {
      const neckYaw = this.userFocusCurrent.yaw * 0.4;
      const neckPitch = this.userFocusCurrent.pitch * 0.4;
      const neckMag = Math.abs(neckYaw) + Math.abs(neckPitch);
      if (neckMag > 0.0005) {
        this._lookEuler.set(neckPitch, neckYaw, 0, 'YXZ');
        this._lookRotation.setFromEuler(this._lookEuler);
        this.rawNeckBone.quaternion.multiply(this._lookRotation);
        this.rawNeckBone.updateMatrix();
      }
    }
  }

  private scheduleNextFidget(): void {
    const { frequency } = this.config.fidget;
    const variance = frequency * 0.5;
    this.nextFidgetTime = this.elapsedTime + frequency + (Math.random() - 0.5) * variance;
  }

  // Current fidget offset value (not delta)
  private currentFidgetValue = 0;
  private prevFidgetValue = 0;

  private updateFidget(): void {
    // Auto-scheduling only when enabled; always process active fidgets
    if (this.config.fidget.enabled) {
      const { intensity } = this.config.fidget;
      if (this.elapsedTime >= this.nextFidgetTime && this.fidgetState.type === 'none') {
        const fidgetTypes: FidgetState['type'][] = ['shoulder', 'weight', 'headTilt'];
        const type = fidgetTypes[Math.floor(Math.random() * fidgetTypes.length)];
        const duration = type === 'weight'
          ? 4.0 + Math.random() * 1.0   // 4-5s for weight shift (with settle)
          : 0.6 + Math.random() * 0.4;
        this.fidgetState = {
          type,
          startTime: this.elapsedTime,
          duration,
          intensity: intensity * (0.8 + Math.random() * 0.4),
          direction: Math.random() > 0.5 ? 1 : -1,
        };
        this.scheduleNextFidget();
      }
    }

    // Always process active fidget (may be set by triggerFidget())
    if (this.fidgetState.type !== 'none') {
      const elapsed = this.elapsedTime - this.fidgetState.startTime;
      const progress = elapsed / this.fidgetState.duration;

      if (progress >= 1) {
        this.fidgetState.type = 'none';
        this.prevFidgetValue = this.currentFidgetValue;
        this.currentFidgetValue = 0;
        return;
      }

      // Store previous value before calculating new
      this.prevFidgetValue = this.currentFidgetValue;

      // Weight shift uses a custom curve: ease in → settle → ease back
      let curve: number;
      if (this.fidgetState.type === 'weight') {
        // Phase 1 (0-0.2): ease into shifted position
        // Phase 2 (0.2-0.7): hold/settle at shifted position
        // Phase 3 (0.7-1.0): ease back to center
        if (progress < 0.2) {
          // Smooth ease-in (0 → 1)
          const t = progress / 0.2;
          curve = t * t * (3 - 2 * t); // smoothstep
        } else if (progress < 0.7) {
          curve = 1.0; // Hold position
        } else {
          // Smooth ease-out (1 → 0)
          const t = (progress - 0.7) / 0.3;
          curve = 1 - t * t * (3 - 2 * t); // inverse smoothstep
        }
      } else {
        // Standard fidgets: smooth in-out curve 0 -> 1 -> 0
        curve = Math.sin(progress * Math.PI);
      }
      this.currentFidgetValue = curve * this.fidgetState.intensity * this.fidgetState.direction;

      // All fidget types use DELTA (current - prev) to avoid accumulation.
      // Normalized bones persist between frames (not reset by VRM.update),
      // so += fullValue would accumulate infinitely.
      const delta = this.currentFidgetValue - this.prevFidgetValue;

      switch (this.fidgetState.type) {
        case 'shoulder':
          if (this.leftShoulderBone && this.fidgetState.direction > 0) {
            this.leftShoulderBone.rotation.z += delta * 0.1;
          }
          if (this.rightShoulderBone && this.fidgetState.direction < 0) {
            this.rightShoulderBone.rotation.z += -delta * 0.1;
          }
          break;

        case 'weight':
          if (this.hipsBone) {
            this.hipsBone.rotation.z += delta * 0.025;
          }
          break;

        case 'headTilt':
          if (this.proceduralHeadMotionEnabled && this.rawHeadBone && Math.abs(delta) > 0.00001) {
            this._lookEuler.set(0, 0, delta * 0.08, 'YXZ');
            this._lookRotation.setFromEuler(this._lookEuler);
            this.rawHeadBone.quaternion.multiply(this._lookRotation);
            this.rawHeadBone.updateMatrix();
          }
          break;
      }
    }
  }

  // Current head tilt value for continuous subtle tilt
  private currentHeadTilt = 0;
  private prevHeadTilt = 0;

  private updateHeadTilt(): void {
    if (!this.headTrackingEnabled) return;
    if (!this.proceduralHeadMotionEnabled) return;
    if (!this.config.headTilt.enabled) return;

    const { speed, intensity } = this.config.headTilt;
    const tiltsPerSecond = speed / 60;

    // Store previous value
    this.prevHeadTilt = this.currentHeadTilt;

    // Slow, subtle head tilt
    const phase = this.elapsedTime * tiltsPerSecond * Math.PI * 2;
    this.currentHeadTilt = Math.sin(phase) * intensity * 0.025;

    // Calculate delta
    const deltaTilt = this.currentHeadTilt - this.prevHeadTilt;

    // Only apply if not currently doing a fidget head tilt and delta is significant
    if (this.fidgetState.type !== 'headTilt' && this.rawHeadBone && Math.abs(deltaTilt) > 0.00001) {
      this._lookEuler.set(0, 0, deltaTilt, 'YXZ');
      this._lookRotation.setFromEuler(this._lookEuler);
      this.rawHeadBone.quaternion.multiply(this._lookRotation);
      this.rawHeadBone.updateMatrix();
    }
  }

  /**
   * Micro-variations: Subtle random noise applied to bones for more natural, less robotic movement.
   * Uses multiple sine waves at different frequencies to create organic-feeling motion.
   */
  // Track previous micro-variation values for delta application
  private prevMicro = { spineX: 0, spineZ: 0, chestX: 0, headX: 0, headY: 0, neckX: 0 };

  private updateMicroVariations(): void {
    if (!this.config.microVariations.enabled) return;

    const { intensity } = this.config.microVariations;
    const t = this.elapsedTime * this.microNoiseSpeed + this.microNoisePhase;

    const noise1 = Math.sin(t * 1.0) * 0.5 + Math.sin(t * 2.3) * 0.3 + Math.sin(t * 4.1) * 0.2;
    const noise2 = Math.sin(t * 0.7 + 1.5) * 0.5 + Math.sin(t * 1.9 + 0.8) * 0.3 + Math.sin(t * 3.7 + 2.1) * 0.2;
    const noise3 = Math.sin(t * 0.9 + 3.2) * 0.5 + Math.sin(t * 2.1 + 1.7) * 0.3 + Math.sin(t * 3.3 + 0.5) * 0.2;

    const s = intensity * 0.001;
    const cur = {
      spineX: noise1 * s, spineZ: noise2 * s * 0.5,
      chestX: noise2 * s * 0.7,
      headX: noise3 * s * 0.5, headY: noise1 * s * 0.3,
      neckX: noise2 * s * 0.4,
    };

    if (this.spineBone) {
      this.spineBone.rotation.x += cur.spineX - this.prevMicro.spineX;
      this.spineBone.rotation.z += cur.spineZ - this.prevMicro.spineZ;
    }
    if (this.chestBone) {
      this.chestBone.rotation.x += cur.chestX - this.prevMicro.chestX;
    }
    if (this.proceduralHeadMotionEnabled) {
      if (this.headBone) {
        this.headBone.rotation.x += cur.headX - this.prevMicro.headX;
        this.headBone.rotation.y += cur.headY - this.prevMicro.headY;
      }
      if (this.neckBone) {
        this.neckBone.rotation.x += cur.neckX - this.prevMicro.neckX;
      }
    }

    this.prevMicro = cur;
  }

  /**
   * Emotion posture: Smoothly blend body posture based on current emotional state.
   * Uses delta application — normalized bones persist between frames.
   */
  private prevPostureApplied: PostureAdjustment = { ...EMOTION_POSTURES.neutral };

  private updateEmotionPosture(delta: number): void {
    if (!this.config.emotionPosture.enabled) return;

    const { blendSpeed } = this.config.emotionPosture;
    const targetValues = EMOTION_POSTURES[this.targetPosture];

    const lerpFactor = Math.min(1, blendSpeed * delta * 60);

    this.currentPostureValues.spineX += (targetValues.spineX - this.currentPostureValues.spineX) * lerpFactor;
    this.currentPostureValues.spineZ += (targetValues.spineZ - this.currentPostureValues.spineZ) * lerpFactor;
    this.currentPostureValues.shoulderY += (targetValues.shoulderY - this.currentPostureValues.shoulderY) * lerpFactor;
    this.currentPostureValues.headX += (targetValues.headX - this.currentPostureValues.headX) * lerpFactor;
    this.currentPostureValues.headZ += (targetValues.headZ - this.currentPostureValues.headZ) * lerpFactor;
    this.currentPostureValues.chestX += (targetValues.chestX - this.currentPostureValues.chestX) * lerpFactor;

    // Apply only the delta from previous frame (normalized bones persist)
    if (this.spineBone) {
      this.spineBone.rotation.x += this.currentPostureValues.spineX - this.prevPostureApplied.spineX;
      this.spineBone.rotation.z += this.currentPostureValues.spineZ - this.prevPostureApplied.spineZ;
    }
    if (this.chestBone) {
      this.chestBone.rotation.x += this.currentPostureValues.chestX - this.prevPostureApplied.chestX;
    }
    if (this.proceduralHeadMotionEnabled && this.headBone) {
      this.headBone.rotation.x += this.currentPostureValues.headX - this.prevPostureApplied.headX;
      this.headBone.rotation.z += this.currentPostureValues.headZ - this.prevPostureApplied.headZ;
    }
    if (this.leftShoulderBone) {
      this.leftShoulderBone.rotation.z += this.currentPostureValues.shoulderY - this.prevPostureApplied.shoulderY;
    }
    if (this.rightShoulderBone) {
      this.rightShoulderBone.rotation.z += -(this.currentPostureValues.shoulderY - this.prevPostureApplied.shoulderY);
    }

    this.prevPostureApplied = { ...this.currentPostureValues };
  }

  /**
   * Conversational motion: Natural head nods, tilts, and subtle turns while speaking.
   * Uses multiple overlapping sine waves at different frequencies to create organic,
   * non-repetitive movement patterns.
   *
   * Three motion layers:
   * - Nods (pitch/X): Primary speech rhythm, gentle up-down
   * - Tilts (roll/Z): Side-to-side expressiveness
   * - Turns (yaw/Y): Subtle lateral movement for engagement
   *
   * Plus occasional "emphasis" nods — slightly stronger, triggered stochastically.
   */
  private updateConversationalMotion(delta: number): void {
    if (!this.headTrackingEnabled) return;
    if (!this.proceduralHeadMotionEnabled) return;
    if (!this.config.conversationalMotion.enabled) return;
    if (!this.rawHeadBone) return;

    // Demo mode forces speaking state on
    const effectivelySpeaking = this.isSpeaking || this.convDemoMode;

    // Smooth blend speaking state (avoid sudden snap on/off)
    const targetBlend = effectivelySpeaking ? 1 : 0;
    const blendSpeed = effectivelySpeaking ? 4.0 : 6.0; // Faster onset, fast fade-out (prevents head twitching during rapid speaking cycles)
    this.speakingBlend += (targetBlend - this.speakingBlend) * (1 - Math.exp(-blendSpeed * delta));

    // Snap to zero when negligible to avoid perpetual micro-updates
    if (this.speakingBlend < 0.005 && !this.manualMotion) {
      this.speakingBlend = 0;
      return;
    }
    if (this.speakingBlend < 0.005) {
      this.speakingBlend = 0;
    }

    const { nodIntensity, tiltIntensity, turnIntensity, emphasisChance } = this.config.conversationalMotion;

    // Advance phase — slow, natural conversational cadence
    const baseSpeed = 0.35; // ~0.35 Hz — one gentle cycle every ~2.9s
    this.convPhase += delta * baseSpeed * Math.PI * 2;

    // --- Emphasis system: occasional stronger nods ---
    this.convEmphasisTimer -= delta;
    if (this.convEmphasisTimer <= 0 && effectivelySpeaking) {
      this.convEmphasisActive = Math.random() < emphasisChance;
      this.convEmphasisIntensity = this.convEmphasisActive ? (0.6 + Math.random() * 0.4) : 0;
      this.convEmphasisTimer = 1.5 + Math.random() * 2.0; // Check every 1.5-3.5s
      if (this.convEmphasisActive && this.convMotionCallback) {
        this.convMotionCallback('emphasis nod');
      }
    }
    // Decay emphasis smoothly
    if (!this.convEmphasisActive) {
      this.convEmphasisIntensity *= 0.95;
    }

    // --- Multi-frequency motion layers ---
    const t = this.convPhase;

    // Nod (pitch, X-axis): primary speech rhythm + harmonics
    // Layered frequencies prevent repetitive patterns
    const nodBase = Math.sin(t * 1.0) * 0.45
                  + Math.sin(t * 1.7 + 0.8) * 0.3
                  + Math.sin(t * 0.6 + 2.1) * 0.25;
    const nodEmphasis = this.convEmphasisIntensity * Math.sin(t * 2.2) * 0.5;
    const nodOffset = (nodBase + nodEmphasis) * nodIntensity * 0.25 * this.speakingBlend;

    // Tilt (roll, Z-axis): slower, side-to-side expressiveness
    const tiltOffset = (
      Math.sin(t * 0.5 + 1.3) * 0.5
      + Math.sin(t * 0.8 + 3.7) * 0.35
      + Math.sin(t * 1.3 + 0.4) * 0.15
    ) * tiltIntensity * 0.4 * this.speakingBlend;

    // Turn (yaw, Y-axis): gentle lateral shifts
    const turnOffset = (
      Math.sin(t * 0.4 + 2.5) * 0.5
      + Math.sin(t * 0.9 + 1.1) * 0.3
      + Math.sin(t * 1.5 + 4.0) * 0.2
    ) * turnIntensity * 0.14 * this.speakingBlend;

    // Fire motion event callbacks for dev mode (detect dominant motion)
    if (this.convMotionCallback) {
      const absNod = Math.abs(nodOffset);
      const absTilt = Math.abs(tiltOffset);
      const absTurn = Math.abs(turnOffset);
      let dominant = '';
      if (absNod > absTilt && absNod > absTurn && absNod > 0.005) {
        dominant = nodOffset > 0 ? 'nod down' : 'nod up';
      } else if (absTilt > absNod && absTilt > absTurn && absTilt > 0.004) {
        dominant = tiltOffset > 0 ? 'tilt right' : 'tilt left';
      } else if (absTurn > 0.003) {
        dominant = turnOffset > 0 ? 'turn right' : 'turn left';
      }
      if (dominant && dominant !== this.lastReportedMotion) {
        this.lastReportedMotion = dominant;
        this.convMotionCallback(dominant);
      }
    }

    // --- Manual motion overlay (one-shot from dev panel) ---
    let manualNod = 0, manualTilt = 0, manualTurn = 0;
    if (this.manualMotion) {
      const elapsed = this.elapsedTime - this.manualMotion.startTime;
      const progress = elapsed / this.manualMotion.duration;
      if (progress >= 1) {
        this.manualMotion = null;
      } else {
        // Bell curve with damped spring overshoot at tail end
        let curve: number;
        if (progress < 0.5) {
          // Ramp up smoothly (first half)
          curve = Math.sin(progress * Math.PI);
        } else {
          // Ramp down with spring overshoot — bounces past neutral then settles
          const tailProgress = (progress - 0.5) / 0.5; // 0→1 over second half
          const baseCurve = Math.sin(progress * Math.PI);
          const springBounce = Math.sin(tailProgress * Math.PI * 3) * Math.exp(-tailProgress * 4) * 0.25;
          curve = baseCurve + springBounce;
        }
        const strength = curve * this.manualMotion.direction;
        switch (this.manualMotion.type) {
          case 'nod':        manualNod = strength * 0.2; break;
          case 'tilt':       manualTilt = strength * 0.25; break;
          case 'turn':       manualTurn = strength * 0.15; break;
          case 'emphasisNod': manualNod = strength * 0.35; break;
        }
      }
    }

    // Combine continuous + manual offsets
    const finalNod = nodOffset + manualNod;
    const finalTilt = tiltOffset + manualTilt;
    const finalTurn = turnOffset + manualTurn;

    // Neck follows at ~40% for distributed, natural movement
    const neckNodOffset = finalNod * 0.4;
    const neckTurnOffset = finalTurn * 0.4;

    // --- Apply FULL offsets each frame (VRM.update resets raw bones every frame) ---
    // Same approach as updateLookAtImage — must reapply full rotation, not deltas
    const totalHeadMag = Math.abs(finalNod) + Math.abs(finalTilt) + Math.abs(finalTurn);
    if (totalHeadMag > 0.0001) {
      this._lookEuler.set(finalNod, finalTurn, finalTilt, 'YXZ');
      this._lookRotation.setFromEuler(this._lookEuler);
      this.rawHeadBone.quaternion.multiply(this._lookRotation);
      this.rawHeadBone.updateMatrix();
      this.rawHeadBone.updateMatrixWorld(true);
    }

    // Apply FULL neck offset
    if (this.rawNeckBone) {
      const totalNeckMag = Math.abs(neckNodOffset) + Math.abs(neckTurnOffset);
      if (totalNeckMag > 0.0001) {
        this._lookEuler.set(neckNodOffset, neckTurnOffset, 0, 'YXZ');
        this._lookRotation.setFromEuler(this._lookEuler);
        this.rawNeckBone.quaternion.multiply(this._lookRotation);
        this.rawNeckBone.updateMatrix();
      }
    }
  }

  /**
   * Set expression head pose target from the expression system.
   * Values are in degrees and get converted to radians internally.
   * Applied additively on top of conversational/idle head motion.
   */
  setExpressionHeadPose(pitch: number, yaw: number, roll: number): void {
    const DEG_TO_RAD = Math.PI / 180;
    // VRM 0.x has π rotation: both pitch and yaw axes are inverted
    this.exprHeadTarget.pitch = -pitch * DEG_TO_RAD;
    this.exprHeadTarget.yaw = -yaw * DEG_TO_RAD;
    this.exprHeadTarget.roll = roll * DEG_TO_RAD;
  }

  /**
   * Apply expression head pose to raw head bone.
   * No smoothing here — the caller's head-motion controller already smooths the values.
   * Runs after conversational motion so both layers compose naturally.
   */
  private updateExpressionHeadPose(_delta: number): void {
    if (!this.rawHeadBone) return;
    if (!this.proceduralHeadMotionEnabled) return;

    // exprHeadTarget is already in radians (set by setExpressionHeadPose)
    const { pitch, yaw, roll } = this.exprHeadTarget;
    const totalMag = Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll);
    if (totalMag < 0.001) return;

    // Apply to raw head bone (additive, same pattern as conversational motion)
    this._lookEuler.set(pitch, yaw, roll, 'YXZ');
    this._lookRotation.setFromEuler(this._lookEuler);
    this.rawHeadBone.quaternion.multiply(this._lookRotation);
    this.rawHeadBone.updateMatrix();
    this.rawHeadBone.updateMatrixWorld(true);

    // Distribute ~35% to neck for natural movement
    if (this.rawNeckBone) {
      const neckFraction = 0.35;
      const neckMag = Math.abs(pitch * neckFraction) + Math.abs(yaw * neckFraction);
      if (neckMag > 0.0005) {
        this._lookEuler.set(pitch * neckFraction, yaw * neckFraction, 0, 'YXZ');
        this._lookRotation.setFromEuler(this._lookEuler);
        this.rawNeckBone.quaternion.multiply(this._lookRotation);
        this.rawNeckBone.updateMatrix();
      }
    }
  }

  /**
   * Set expression gaze target from the expression system.
   * horizontal: -1 (look left) to 1 (look right)
   * vertical: -1 (look down) to 1 (look up)
   * Applied via VRM lookAt target position, not blend shapes.
   */
  setExpressionGaze(horizontal: number, vertical: number): void {
    this.exprGazeTarget.horizontal = horizontal;
    this.exprGazeTarget.vertical = vertical;
  }

  /**
   * Apply expression gaze via VRM lookAt target position.
   * Only active when lookAtImage is NOT enabled (lookAtImage takes priority).
   *
   * NOTE: not called from updateFrame — in ami, expression gaze is driven
   * directly by the channel bridge (it sets lookAt.target and calls
   * lookAt.update() in the same frame). Kept public so a scene driver can
   * opt in per frame if no channel bridge exists.
   */
  updateExpressionGaze(delta: number): void {
    const lookAt = this.vrm.lookAt;
    if (!lookAt) return;
    // lookAtImage takes priority
    if (this.lookAtImageState.enabled) return;
    // When head tracking is disabled (e.g. split-view panel), skip gaze updates
    // so eyes stay neutral rather than tracking the camera.
    if (!this.headTrackingEnabled) return;

    // Ensure lookAt target exists (create one if needed)
    if (!lookAt.target) {
      const target = new THREE.Object3D();
      // VRM 0.x is rotated π, so it faces positive Z (toward camera).
      // Place target in front of character at head height.
      target.position.set(0, 1.4, 0.8);
      if (this.vrm.scene.parent) {
        this.vrm.scene.parent.add(target);
      } else {
        this.vrm.scene.add(target);
      }
      lookAt.target = target;
      logger.debug('[ProceduralAnim] Created VRM lookAt target');
    }

    const lerpSpeed = 5.0;
    const lerpFactor = 1.0 - Math.exp(-lerpSpeed * delta);

    this.exprGazeCurrent.horizontal += (this.exprGazeTarget.horizontal - this.exprGazeCurrent.horizontal) * lerpFactor;
    this.exprGazeCurrent.vertical += (this.exprGazeTarget.vertical - this.exprGazeCurrent.vertical) * lerpFactor;

    // Only move the lookAt target when there's meaningful gaze offset
    const gazeMag = Math.abs(this.exprGazeCurrent.horizontal) + Math.abs(this.exprGazeCurrent.vertical);
    if (gazeMag < 0.01) {
      // Neutral gaze: look straight ahead (close target = large angular response)
      lookAt.target.position.set(0, 1.4, 0.8);
      return;
    }

    // Map gaze channels to lookAt target position.
    // Close z (0.8m) so small offsets produce large angular eye movement.
    // gazeScale controls how far the target moves for -1..1 channel range.
    const gazeScale = 0.6;
    lookAt.target.position.x = this.exprGazeCurrent.horizontal * gazeScale;
    lookAt.target.position.y = 1.4 + this.exprGazeCurrent.vertical * gazeScale;
    lookAt.target.position.z = 0.8;
  }

  /**
   * Look at image: Smoothly rotate head and neck to look at an image on the left side.
   * Uses RAW bones with quaternion multiplication. Applies FULL accumulated offset each frame
   * because VRM.update() resets raw bones from normalized bones every frame.
   */
  private updateLookAtImage(delta: number): void {
    if (!this.rawHeadBone) return;

    // Compute target yaw/pitch from screen position of the video/image.
    // The screen target is the normalized (0-1) center of the card.
    // The character's head screen position is roughly where the camera points.
    // We convert the horizontal/vertical offset into bone-local yaw/pitch.
    let targetYaw = 0;
    let targetPitch = 0;

    if (this.lookAtImageState.enabled) {
      const st = this.lookAtImageState.screenTarget;
      if (st) {
        // Screen target is in 0-1 coords. Character's head is roughly at screen center
        // or wherever headPosition is — but for the bone offset we just need the direction.
        // x < 0.5 = video is to the left of center, x > 0.5 = right
        // y < 0.5 = video is above center, y > 0.5 = below
        // Map to yaw: negative = look left. Scale so edge-of-screen ≈ 0.7 rad (~40°)
        targetYaw = -(0.5 - st.x) * 1.4;   // left of center → negative → look left
        targetPitch = -(0.5 - st.y) * 0.6;  // above center → negative → look up
        // Clamp
        targetYaw = Math.max(-0.7, Math.min(0.7, targetYaw));
        targetPitch = Math.max(-0.4, Math.min(0.4, targetPitch));
      } else {
        // Fallback: hardcoded angles for chat scene (no screen target provided)
        targetYaw = -0.5;   // ~29 degrees left
        targetPitch = -0.15; // ~9 degrees up
      }
    }

    // Smooth interpolation of offset values
    const lerpSpeed = 3.0;
    const lerpFactor = 1.0 - Math.exp(-lerpSpeed * delta);

    // Interpolate offsets toward target
    this.lookAtImageOffsets.headY += (targetYaw - this.lookAtImageOffsets.headY) * lerpFactor;
    this.lookAtImageOffsets.headX += (targetPitch - this.lookAtImageOffsets.headX) * lerpFactor;
    this.lookAtImageOffsets.neckY += (targetYaw * 0.4 - this.lookAtImageOffsets.neckY) * lerpFactor;

    // Skip if offsets are negligible (animation complete)
    const totalOffset = Math.abs(this.lookAtImageOffsets.headY) +
                        Math.abs(this.lookAtImageOffsets.headX) +
                        Math.abs(this.lookAtImageOffsets.neckY);
    if (totalOffset < 0.001) {
      return;
    }

    if (this.proceduralHeadMotionEnabled) {
      // Apply FULL offset to NECK (VRM.update resets bones each frame, so we must reapply)
      if (this.rawNeckBone) {
        this._lookEuler.set(this.lookAtImageOffsets.headX * 0.4, this.lookAtImageOffsets.neckY, 0, 'YXZ');
        this._lookRotation.setFromEuler(this._lookEuler);
        this.rawNeckBone.quaternion.multiply(this._lookRotation);
        this.rawNeckBone.updateMatrix();
      }

      // Apply FULL offset to HEAD
      this._lookEuler.set(this.lookAtImageOffsets.headX * 0.6, this.lookAtImageOffsets.headY * 0.6, 0, 'YXZ');
      this._lookRotation.setFromEuler(this._lookEuler);
      this.rawHeadBone.quaternion.multiply(this._lookRotation);

      // Force update the bone matrices (critical for rendering!)
      this.rawHeadBone.updateMatrix();
      this.rawHeadBone.updateMatrixWorld(true);
    }

    // Apply eye look via VRM lookAt target (only when lookAtImage is active)
    // When disabled, expression gaze controls the lookAt target instead.
    const lookAtTarget = this.vrm.lookAt?.target;
    if (this.lookAtImageState.enabled && lookAtTarget) {
      lookAtTarget.position.x = 1.0;
    }
  }

  // Public API
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetToInitial();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateConfig(config: Partial<ProceduralAnimationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      breathing: { ...this.config.breathing, ...config.breathing },
      idleSway: { ...this.config.idleSway, ...config.idleSway },
      lookAround: { ...this.config.lookAround, ...config.lookAround },
      fidget: { ...this.config.fidget, ...config.fidget },
      headTilt: { ...this.config.headTilt, ...config.headTilt },
      microVariations: { ...this.config.microVariations, ...config.microVariations },
      emotionPosture: { ...this.config.emotionPosture, ...config.emotionPosture },
      conversationalMotion: { ...this.config.conversationalMotion, ...config.conversationalMotion },
    };
  }

  getConfig(): ProceduralAnimationConfig {
    return { ...this.config };
  }

  // Enable/disable individual animations
  setBreathingEnabled(enabled: boolean): void {
    this.config.breathing.enabled = enabled;
  }

  setIdleSwayEnabled(enabled: boolean): void {
    this.config.idleSway.enabled = enabled;
  }

  setLookAroundEnabled(enabled: boolean): void {
    this.config.lookAround.enabled = enabled;
  }

  setFidgetEnabled(enabled: boolean): void {
    this.config.fidget.enabled = enabled;
  }

  setHeadTiltEnabled(enabled: boolean): void {
    this.config.headTilt.enabled = enabled;
  }

  setMicroVariationsEnabled(enabled: boolean): void {
    this.config.microVariations.enabled = enabled;
  }

  setEmotionPostureEnabled(enabled: boolean): void {
    this.config.emotionPosture.enabled = enabled;
  }

  setConversationalMotionEnabled(enabled: boolean): void {
    this.config.conversationalMotion.enabled = enabled;
  }

  /**
   * Set the camera reference so the character can face the user while speaking.
   * @param baseRotationY The VRM scene's neutral Y rotation (π for VRM 0.x)
   */
  setCamera(camera: THREE.Camera, baseRotationY: number): void {
    this.camera = camera;
    this.baseRotationY = baseRotationY;
    this.originalBaseRotationY = baseRotationY;
  }

  /** Update base rotation used for head-turn yaw computation. */
  setBaseRotationY(newBaseRotationY: number): void {
    this.baseRotationY = newBaseRotationY;
    this.userFocusCurrent = { yaw: 0, pitch: 0 };
  }

  /**
   * Force the character to face the user (head + body turn) independently of speaking state.
   * Used for pre-greeting/greeting sequences where TTS hasn't started yet.
   * The override is automatically cleared when setSpeaking(true) fires (TTS takes over).
   */
  setUserFocusOverride(enabled: boolean): void {
    this.userFocusOverride = enabled;
    if (enabled) {
      this.lookTarget = null;
      this.idleMotionOrchestrator.onAISpeaking();
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  setSeated(seated: boolean): void {
    this.seated = seated;
  }

  /** Enable/disable body rotation toward camera when speaking. Should only be true in 3D home scene. */
  setBodyFacingEnabled(enabled: boolean): void {
    this.bodyFacingEnabled = enabled;
  }

  /**
   * Enable/disable ONLY the user-focus head turn (glance toward the user
   * while speaking) without flipping the proceduralHeadMotionEnabled master
   * switch. Park walk mode uses this so she turns just her head/neck toward
   * the camera when speaking while the other procedural head behaviors
   * (look-around, nods, fidget) stay off. Pair with setBodyFacingEnabled(false)
   * so the body keeps facing the walk direction (only the head/neck turn).
   */
  setUserFocusHeadTurnEnabled(enabled: boolean): void {
    this.userFocusHeadTurnEnabled = enabled;
  }

  /**
   * Master switch for ALL procedural head-bone manipulation (look-around,
   * conversational nods, head tilts, expression pose, micro-variation head
   * noise, emotion-posture head lean, fidget head tilts, user-focus turn,
   * look-at-image head rotation). Defaults to OFF, matching ami — where this
   * flag deliberately has no setter and consumers opt into the narrow
   * setUserFocusHeadTurnEnabled instead. Exposed here so hivemind scene
   * drivers can reach the master switch without patching private state.
   */
  setProceduralHeadMotionEnabled(enabled: boolean): void {
    this.proceduralHeadMotionEnabled = enabled;
  }

  /** Override the head yaw clamp (radians). Pass null to reset to default 30°. */
  setHeadMaxOverride(radians: number | null): void {
    this._headMaxOverride = radians;
  }

  /** Enable/disable head tracking toward camera. */
  setHeadTrackingEnabled(enabled: boolean): void {
    this.headTrackingEnabled = enabled;
  }

  /**
   * Set whether the character is currently speaking.
   * Conversational head motion activates/deactivates with smooth blending.
   */
  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    if (speaking) {
      // Cancel any active look target immediately so head returns to face user
      this.lookTarget = null;
      // Reset idle timer + suppress idle motions while speaking
      this.idleMotionOrchestrator.onUserMessage();
      this.idleMotionOrchestrator.onAISpeaking();
    } else {
      // Speech just ended — reset idle timer so she doesn't immediately
      // start looking away. The 10s idle threshold restarts from now.
      this.idleMotionOrchestrator.onAISpeaking();
    }
  }

  /**
   * Override where the head looks. Pass a world position to look at another character,
   * or null to revert to looking at the camera.
   */
  setHeadLookOverride(worldPos: THREE.Vector3 | null): void {
    this.headLookOverride = worldPos;
  }

  /**
   * Toggle demo mode: forces conversational motion to run indefinitely without speech.
   * Returns the new demo state.
   */
  toggleConversationalMotionDemo(callback?: ((event: string) => void) | null): boolean {
    this.convDemoMode = !this.convDemoMode;
    this.convMotionCallback = this.convDemoMode ? (callback ?? null) : null;
    if (!this.convDemoMode) {
      this.lastReportedMotion = '';
    }
    logger.debug(`Conversational motion demo: ${this.convDemoMode ? 'ON' : 'OFF'}`);
    return this.convDemoMode;
  }

  isConversationalMotionDemoActive(): boolean {
    return this.convDemoMode;
  }

  /**
   * Trigger a single manual head motion (from dev panel).
   * Plays once over ~1s then fades out, applied as an overlay on top of any existing motion.
   */
  triggerManualMotion(type: ManualMotionType): void {
    this.manualMotion = {
      type,
      startTime: this.elapsedTime,
      duration: type === 'emphasisNod' ? 0.6 : 1.0,
      direction: Math.random() > 0.5 ? 1 : -1,
    };
    logger.debug(`Manual motion triggered: ${type}`);
  }

  /**
   * Set the target emotion posture - the controller will smoothly blend to this posture
   * @param posture - The emotion posture to blend to
   */
  setEmotionPosture(posture: EmotionPosture): void {
    if (this.targetPosture !== posture) {
      logger.debug(`Emotion posture changing: ${this.targetPosture} → ${posture}`);
      this.currentPosture = this.targetPosture;
      this.targetPosture = posture;
    }
  }

  getEmotionPosture(): EmotionPosture {
    return this.targetPosture;
  }

  /**
   * Map an emotion string to a posture (for integration with emotion detection)
   */
  setEmotionFromString(emotion: string): void {
    const posture = EMOTION_TO_POSTURE[emotion.toLowerCase()] || 'neutral';
    this.setEmotionPosture(posture);
  }

  // Trigger specific animations manually
  triggerLook(x: number, y: number, duration: number = 2.0): void {
    logger.debug('triggerLook called:', { x, y, duration, hasHead: !!this.headBone });
    // x and y are in range -1 to 1, scale to radians (about 20-30 degrees max)
    this.lookTarget = {
      x: x * 0.35,  // ~20 degrees
      y: y * 0.25,  // ~15 degrees
      startTime: this.elapsedTime,
      duration,
    };
  }

  triggerFidget(type: FidgetType): void {
    if (type === 'none') return;

    logger.debug('triggerFidget called:', { type, hasHips: !!this.hipsBone, hasShoulders: !!this.leftShoulderBone, hasHead: !!this.headBone });
    // Weight shift is slower: ease in, settle for a few seconds, ease back
    const duration = type === 'weight'
      ? 4.0 + Math.random() * 1.0   // 4-5 seconds (with ~2.5s settle)
      : 1.0 + Math.random() * 0.5;  // 1-1.5 seconds
    this.fidgetState = {
      type,
      startTime: this.elapsedTime,
      duration,
      intensity: 1.0,  // Full intensity for manual triggers
      direction: Math.random() > 0.5 ? 1 : -1,
    };
    this.currentFidgetValue = 0;
  }

  triggerDeepBreath(): void {
    logger.debug('triggerDeepBreath called');
    // Temporarily enable and increase breathing intensity
    const wasEnabled = this.config.breathing.enabled;
    const originalIntensity = this.config.breathing.intensity;
    this.config.breathing.enabled = true;
    this.config.breathing.intensity = 1.5;

    setTimeout(() => {
      this.config.breathing.intensity = originalIntensity;
      this.config.breathing.enabled = wasEnabled;
    }, 4000);
  }

  /**
   * Set whether the character should look at an image on the left side.
   * The transition is smoothly interpolated.
   * @param enabled - true to look at image, false to return to neutral
   */
  setLookAtImage(enabled: boolean, screenTarget?: { x: number; y: number }): void {
    if (this.lookAtImageState.enabled !== enabled) {
      logger.debug(`Look at image: ${enabled ? 'ENABLED' : 'DISABLED'}`);
      this.lookAtImageState.enabled = enabled;

      // Only reset offsets when ENABLING (to start fresh)
      // When disabling, let offsets interpolate back to 0 naturally for smooth return
      // Suppress idle motions while looking at a tool card — the character
      // should hold their gaze, not randomly look around or fidget
      this.idleMotionOrchestrator.setToolCardActive(enabled);

      if (enabled) {
        this.lookAtImageOffsets = { neckY: 0, headY: 0, headX: 0 };
        this.lookAtImageState.screenTarget = screenTarget ?? null;
      } else {
        this.lookAtImageState.screenTarget = null;
      }
    } else if (enabled && screenTarget) {
      // Update screen target even if already enabled (position may have changed)
      this.lookAtImageState.screenTarget = screenTarget;
    }
  }

  /**
   * Update the screen-space target the character is looking at (normalized 0-1 coords).
   * Call this when the video/image card position changes on screen.
   */
  setLookAtScreenTarget(x: number, y: number): void {
    this.lookAtImageState.screenTarget = { x, y };
  }

  /**
   * Check if currently looking at an image
   */
  isLookingAtImage(): boolean {
    return this.lookAtImageState.enabled;
  }

  private resetToInitial(): void {
    this.initialRotations.forEach((rotation, bone) => {
      bone.rotation.copy(rotation);
    });

    this.currentLookX = 0;
    this.currentLookY = 0;
    this.lookTarget = null;
    this.fidgetState = { type: 'none', startTime: 0, duration: 0, intensity: 0, direction: 1 };
    this.currentFidgetValue = 0;
    this.prevFidgetValue = 0;
    this.targetPosture = 'neutral';
    this.currentPostureValues = { ...EMOTION_POSTURES.neutral };
    this.prevPostureApplied = { ...EMOTION_POSTURES.neutral };
    this.prevBreathSpine = 0;
    this.prevBreathChest = 0;
    this.prevSwayHipsZ = 0;
    this.prevSwayHipsX = 0;
    this.prevSwaySpineZ = 0;
    this.prevMicro = { spineX: 0, spineZ: 0, chestX: 0, headX: 0, headY: 0, neckX: 0 };
    this.lookAtImageState.enabled = false;
    this.lookAtImageState.screenTarget = null;
    this.lookAtImageOffsets = { neckY: 0, headY: 0, headX: 0 };
    this.isSpeaking = false;
    this.userFocusOverride = false;
    this.speakingBlend = 0;
    this.userFocusCurrent = { yaw: 0, pitch: 0 };
  }

  reset(): void {
    this.elapsedTime = 0;
    this.resetToInitial();
    this.scheduleNextLook();
    this.scheduleNextFidget();
    this.idleMotionOrchestrator.reset();
  }

  /** Notify that the user just sent a message — resets idle motion timer */
  notifyUserMessage(): void {
    this.idleMotionOrchestrator.onUserMessage();
  }

  // Set VRM (for model switching)
  setVRM(vrm: VRM): void {
    this.vrm = vrm;
    this.initialRotations.clear();
    this.cacheBones();
    this.reset();
    this.idleMotionOrchestrator.setTarget(this.buildIdleMotionTarget());
    // Gaze controller is re-wired externally by the scene driver after expression system init
  }
}
