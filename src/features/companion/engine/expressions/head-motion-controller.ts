/**
 * HeadMotionController — Subtle head micro-motions (Layer D)
 *
 * Applies tiny head tilts, nods, recoils, and posture offsets
 * coupled to expressions. Keeps amplitudes small (pitch ±4, yaw ±5, roll ±6)
 * for subtle, lifelike motion rather than cartoony bobbing.
 */

import type {
  HeadPoseOffset,
  ExpressionPersonalityProfile,
  EmotionalState,
} from './types';

const HEAD_SMOOTH_SPEED = 8; // per-second exponential lerp (fast enough to be responsive)
const IDLE_DRIFT_SPEED = 0.3; // how fast idle drift moves (radians/sec conceptually)
const IDLE_DRIFT_AMPLITUDE = 0.6; // max degrees of idle drift

// Music bob: slow melodic nod at ~0.8 Hz (one full cycle every ~1.25s)
const MUSIC_BOB_HZ = 0.82;
const MUSIC_BOB_PITCH_AMP = 2.8;  // degrees up-down
const MUSIC_BOB_ROLL_AMP  = 0.7;  // degrees side sway (organic feel)
const MUSIC_BOB_FADE_SPEED = 0.4; // fade in/out speed (per second)

export class HeadMotionController {
  private current: HeadPoseOffset = { pitch: 0, yaw: 0, roll: 0 };
  private target: HeadPoseOffset = { pitch: 0, yaw: 0, roll: 0 };
  private personality: ExpressionPersonalityProfile;

  // Idle drift state (perlin-like smooth noise via sine combination)
  private driftPhase = {
    pitch: Math.random() * Math.PI * 2,
    yaw: Math.random() * Math.PI * 2,
    roll: Math.random() * Math.PI * 2,
  };

  // Music bob state
  private musicBobActive = false;
  private musicBobPhase = 0;
  private musicBobFade = 0; // 0..1 smoothed fade factor

  constructor(personality: ExpressionPersonalityProfile) {
    this.personality = personality;
  }

  /** Set target head pose from mixer output */
  setTarget(pose: HeadPoseOffset): void {
    this.target = { ...pose };
  }

  setPersonality(p: ExpressionPersonalityProfile): void {
    this.personality = p;
  }

  setMusicBobbing(active: boolean): void {
    this.musicBobActive = active;
  }

  /**
   * Per-frame update. Returns smoothed head pose with idle drift.
   * @param deltaSec frame delta in seconds
   * @param emotionalState current emotional state
   * @param mixerPose the head pose target from the expression mixer
   */
  update(
    deltaSec: number,
    emotionalState: EmotionalState,
    mixerPose: HeadPoseOffset,
  ): HeadPoseOffset {
    this.target = { ...mixerPose };

    // Add idle drift (subtle ambient head motion)
    const motionAmount = this.personality.headMotionAmount;
    const energyFactor = 0.5 + emotionalState.energy * 0.5; // less drift when sleepy
    const tensionDampen = 1 - emotionalState.tension * 0.5; // less drift when tense (stillness)
    const driftScale = IDLE_DRIFT_AMPLITUDE * motionAmount * energyFactor * tensionDampen;

    // Advance drift phases at different speeds for organic motion
    this.driftPhase.pitch += deltaSec * IDLE_DRIFT_SPEED * 0.7;
    this.driftPhase.yaw += deltaSec * IDLE_DRIFT_SPEED * 1.0;
    this.driftPhase.roll += deltaSec * IDLE_DRIFT_SPEED * 0.5;

    // Multi-sine for organic feel (avoids pure sine wave predictability)
    const driftPitch = (
      Math.sin(this.driftPhase.pitch) * 0.6 +
      Math.sin(this.driftPhase.pitch * 2.3 + 1.2) * 0.3 +
      Math.sin(this.driftPhase.pitch * 0.7 + 3.1) * 0.1
    ) * driftScale * 0.8;

    const driftYaw = (
      Math.sin(this.driftPhase.yaw) * 0.5 +
      Math.sin(this.driftPhase.yaw * 1.7 + 0.8) * 0.35 +
      Math.sin(this.driftPhase.yaw * 0.5 + 2.4) * 0.15
    ) * driftScale;

    const driftRoll = (
      Math.sin(this.driftPhase.roll) * 0.5 +
      Math.sin(this.driftPhase.roll * 2.1 + 1.7) * 0.3 +
      Math.sin(this.driftPhase.roll * 0.6 + 0.5) * 0.2
    ) * driftScale * 1.1;

    // Music bob: slow melodic nod (overrides idle drift when active)
    // Fade in smoothly when music starts, fade out when it stops.
    const fadeTarget = this.musicBobActive ? 1 : 0;
    this.musicBobFade += (fadeTarget - this.musicBobFade) * Math.min(1, MUSIC_BOB_FADE_SPEED * deltaSec);
    this.musicBobPhase += deltaSec * MUSIC_BOB_HZ * Math.PI * 2;

    // Slight swing variation so it doesn't feel perfectly metronomic
    const bobPitch = Math.sin(this.musicBobPhase) * MUSIC_BOB_PITCH_AMP * this.musicBobFade;
    // Roll sways at half the bob rate for organic asymmetry
    const bobRoll  = Math.sin(this.musicBobPhase * 0.5 + 0.8) * MUSIC_BOB_ROLL_AMP * this.musicBobFade;

    // Combine mixer target with drift (reduced when bobbing) and bob
    const driftBlend = 1 - this.musicBobFade * 0.6; // dampen drift while bobbing
    const combinedTarget: HeadPoseOffset = {
      pitch: this.target.pitch + driftPitch * driftBlend + bobPitch,
      yaw: this.target.yaw + driftYaw * driftBlend,
      roll: this.target.roll + driftRoll * driftBlend + bobRoll,
    };

    // Smooth interpolation
    const factor = 1 - Math.exp(-HEAD_SMOOTH_SPEED * deltaSec);
    this.current.pitch += (combinedTarget.pitch - this.current.pitch) * factor;
    this.current.yaw += (combinedTarget.yaw - this.current.yaw) * factor;
    this.current.roll += (combinedTarget.roll - this.current.roll) * factor;

    // Clamp to safe ranges (generous enough for visible expression head poses)
    this.current.pitch = clamp(this.current.pitch, -10, 10);
    this.current.yaw = clamp(this.current.yaw, -12, 12);
    this.current.roll = clamp(this.current.roll, -12, 12);

    return { ...this.current };
  }

  getCurrent(): HeadPoseOffset {
    return { ...this.current };
  }

  reset(): void {
    this.current = { pitch: 0, yaw: 0, roll: 0 };
    this.target = { pitch: 0, yaw: 0, roll: 0 };
    this.musicBobActive = false;
    this.musicBobFade = 0;
    this.musicBobPhase = 0;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
