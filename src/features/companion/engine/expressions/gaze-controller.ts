/**
 * GazeController — First-class gaze behavior (Layer D)
 *
 * Controls eye direction, saccades, eye-contact duration,
 * and natural gaze breaks to avoid the "dead stare" problem.
 */

import type {
  GazeTarget,
  GazeMode,
  ExpressionPersonalityProfile,
  EmotionalState,
} from './types';

interface GazeState {
  current: GazeTarget;
  target: GazeTarget;
  mode: GazeMode;
  holdTimer: number;      // ms remaining in current hold
  breakTimer: number;     // ms until next natural gaze break
  saccadeTimer: number;   // ms until next micro-saccade
  isInBreak: boolean;
}

// Gaze hold durations (ms) by mode
const HOLD_RANGES: Record<GazeMode, [min: number, max: number]> = {
  user_focus:       [2000, 4000],
  soft_eye_contact: [1500, 3500],
  look_away_down:   [800, 2000],
  side_glance:      [500, 1200],
  thinking_up:      [600, 1500],
  scanning:         [300, 800],
  defocused:        [1000, 2500],
  return_to_user:   [200, 500],
};

const SACCADE_INTERVAL: [min: number, max: number] = [400, 1200];
const SACCADE_AMPLITUDE = 0.09; // ~2.5° visible micro-jitter

const BREAK_INTERVAL: [min: number, max: number] = [3000, 7000];
const BREAK_DURATION: [min: number, max: number] = [400, 1000];

// Larger occasional "glance-away" that's clearly visible
const GLANCE_AWAY_CHANCE = 0.3; // 30% of breaks become a full glance-away
const GLANCE_AWAY_AMPLITUDE = 0.45; // strong sideways or downward look

const GAZE_SMOOTH_SPEED = 4.5; // slower lerp = more visible movement

// Upper bound on vertical gaze (eyes up). Mirrors the -0.45 downward limit so the
// iris stays within the eyelids on every rig. The bridge maps this to eye-bone
// pitch as v * 0.52rad, so 0.5 => ~15° up — expressive but well short of the ~25°+
// that bares the sclera on the lower-lidded VRM1 male rigs (Lucas/Liam). Tunable.
const GAZE_V_MAX = 0.5;

export class GazeController {
  private state: GazeState;
  private personality: ExpressionPersonalityProfile;

  // When true, gaze breaks and glance-aways are suppressed — eyes stay on user.
  // Micro-saccades still fire at reduced amplitude for liveliness.
  private speaking: boolean = false;

  // When true, the character is wandering/walking — eyes look forward (walk direction)
  // instead of tracking the user. Gaze breaks are suppressed since we want a
  // consistent forward gaze while in motion.
  private wandering: boolean = false;

  // Idle gaze override — set by IdleMotionOrchestrator for eye-only idle looks.
  // When active, additively shifts gaze target. Auto-expires after durationMs.
  private idleOverride: { h: number; v: number; expiresMs: number } | null = null;

  constructor(personality: ExpressionPersonalityProfile) {
    this.personality = personality;
    this.state = {
      current: { horizontal: 0, vertical: 0 },
      target: { horizontal: 0, vertical: 0 },
      mode: 'soft_eye_contact',
      holdTimer: randomRange(...HOLD_RANGES.soft_eye_contact),
      breakTimer: randomRange(...BREAK_INTERVAL),
      saccadeTimer: randomRange(...SACCADE_INTERVAL),
      isInBreak: false,
    };
  }

  /**
   * Set a temporary gaze override for idle eye-only looks.
   * Additively shifts the gaze target for the given duration, then auto-clears.
   */
  setIdleGazeOverride(horizontal: number, vertical: number, durationMs: number): void {
    this.idleOverride = { h: horizontal, v: vertical, expiresMs: Date.now() + durationMs };
  }

  clearIdleGazeOverride(): void {
    this.idleOverride = null;
  }

  /**
   * Set wandering state. When wandering, gaze stays forward (walk direction)
   * instead of tracking the user. Only micro-saccades fire for liveliness.
   */
  setWandering(isWandering: boolean): void {
    if (this.wandering === isWandering) return;
    this.wandering = isWandering;
    if (isWandering) {
      // Cancel any active gaze break — snap to forward
      this.state.isInBreak = false;
      this.state.breakTimer = randomRange(...BREAK_INTERVAL);
      this.idleOverride = null;
    }
  }

  /**
   * Set speaking state. When speaking, gaze breaks and glance-aways are
   * suppressed so the character maintains eye contact with the user.
   * Micro-saccades still fire at reduced amplitude for natural liveliness.
   */
  setSpeaking(isSpeaking: boolean): void {
    if (this.speaking === isSpeaking) return;
    this.speaking = isSpeaking;
    if (isSpeaking) {
      // Cancel any active gaze break — snap back to user focus
      this.state.isInBreak = false;
      this.state.breakTimer = randomRange(...BREAK_INTERVAL);
      this.idleOverride = null;
    }
  }

  /** Set the desired gaze mode (from mixer or intent) */
  setMode(mode: GazeMode): void {
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    this.state.holdTimer = randomRange(...(HOLD_RANGES[mode] ?? HOLD_RANGES.soft_eye_contact));
  }

  /** Set explicit gaze target (from mixer output) */
  setTarget(target: GazeTarget): void {
    this.state.target = { ...target };
  }

  setPersonality(p: ExpressionPersonalityProfile): void {
    this.personality = p;
  }

  /**
   * Per-frame update. Returns smoothed gaze values.
   * @param deltaSec frame delta in seconds
   * @param emotionalState current emotional state for modulation
   * @param mixerGaze the gaze target from the expression mixer
   */
  update(
    deltaSec: number,
    emotionalState: EmotionalState,
    mixerGaze: GazeTarget,
  ): GazeTarget {
    const deltaMs = deltaSec * 1000;

    // When wandering (and NOT speaking), eyes look forward — no user tracking.
    // Speaking always takes priority so she looks at the user when talking.
    if (this.wandering && !this.speaking) {
      this.state.target.horizontal = 0;
      this.state.target.vertical = 0;

      // Micro-saccades only
      this.state.saccadeTimer -= deltaMs;
      if (this.state.saccadeTimer <= 0) {
        this.state.saccadeTimer = randomRange(...SACCADE_INTERVAL);
        const amp = SACCADE_AMPLITUDE * 0.5;
        this.state.target.horizontal += (Math.random() - 0.5) * amp;
        this.state.target.vertical += (Math.random() - 0.5) * amp * 0.7;
      }

      // Smooth interpolation
      const factor = 1 - Math.exp(-GAZE_SMOOTH_SPEED * deltaSec);
      this.state.current.horizontal += (this.state.target.horizontal - this.state.current.horizontal) * factor;
      this.state.current.vertical += (this.state.target.vertical - this.state.current.vertical) * factor;
      this.state.current.horizontal = clamp(this.state.current.horizontal, -1, 1);
      this.state.current.vertical = clamp(this.state.current.vertical, -0.45, GAZE_V_MAX);
      return { ...this.state.current };
    }

    // Apply mixer gaze as base target
    this.state.target.horizontal = mixerGaze.horizontal;
    this.state.target.vertical = mixerGaze.vertical;

    // Apply idle gaze override (from IdleMotionOrchestrator)
    if (this.idleOverride) {
      if (Date.now() > this.idleOverride.expiresMs) {
        this.idleOverride = null;
      } else {
        this.state.target.horizontal += this.idleOverride.h;
        this.state.target.vertical += this.idleOverride.v;
      }
    }

    // Natural gaze breaks (anti-staring) — suppressed while speaking
    // so the character maintains eye contact with the user
    if (!this.speaking) {
      this.state.breakTimer -= deltaMs;
      if (this.state.breakTimer <= 0 && !this.state.isInBreak) {
        this.state.isInBreak = true;
        this.state.holdTimer = randomRange(...BREAK_DURATION);

        const shyFactor = this.personality.shynessBias + emotionalState.shyness * 0.3;
        const stabilityDampen = 1 - this.personality.gazeStability * 0.6;

        if (Math.random() < GLANCE_AWAY_CHANCE) {
          // Full glance-away — clearly visible "thinking" or "shy" look
          const direction = Math.random();
          if (direction < 0.25 + shyFactor * 0.15) {
            // Look down (shy/thoughtful) — reduced bias
            this.state.target.horizontal += (Math.random() - 0.5) * 0.2;
            this.state.target.vertical -= GLANCE_AWAY_AMPLITUDE * 0.6 * stabilityDampen;
          } else if (direction < 0.6) {
            // Look to the side (casual/distracted) — most common
            this.state.target.horizontal += (Math.random() < 0.5 ? 1 : -1) * GLANCE_AWAY_AMPLITUDE * stabilityDampen;
            this.state.target.vertical += (Math.random() - 0.5) * 0.1;
          } else {
            // Look up (thinking/recalling)
            this.state.target.horizontal += (Math.random() - 0.5) * 0.15;
            this.state.target.vertical += GLANCE_AWAY_AMPLITUDE * 0.7 * stabilityDampen;
          }
          // Glance-aways hold slightly longer
          this.state.holdTimer = randomRange(500, 1200);
        } else {
          // Subtle break — small random offset (no directional bias)
          this.state.target.horizontal += (Math.random() - 0.5) * 0.5 * stabilityDampen;
          this.state.target.vertical += (Math.random() - 0.5) * 0.3 * stabilityDampen;
        }
      }

      if (this.state.isInBreak) {
        this.state.holdTimer -= deltaMs;
        if (this.state.holdTimer <= 0) {
          this.state.isInBreak = false;
          this.state.breakTimer = randomRange(...BREAK_INTERVAL) * this.personality.gazeStability;
        }
      }
    }

    // Micro-saccades for liveliness — reduced amplitude while speaking
    // so eyes stay focused on user but don't look dead
    this.state.saccadeTimer -= deltaMs;
    if (this.state.saccadeTimer <= 0) {
      this.state.saccadeTimer = randomRange(...SACCADE_INTERVAL);
      const amp = this.speaking ? SACCADE_AMPLITUDE * 0.4 : SACCADE_AMPLITUDE;
      this.state.target.horizontal += (Math.random() - 0.5) * amp;
      this.state.target.vertical += (Math.random() - 0.5) * amp * 0.7;
    }

    // Smooth interpolation
    const factor = 1 - Math.exp(-GAZE_SMOOTH_SPEED * deltaSec);
    this.state.current.horizontal += (this.state.target.horizontal - this.state.current.horizontal) * factor;
    this.state.current.vertical += (this.state.target.vertical - this.state.current.vertical) * factor;

    // Clamp — vertical is bounded in BOTH directions to keep the iris within the
    // eyelids on every rig. Downward was always limited (pupils clipping below the
    // lids); upward must be limited too, or rigs with lower/narrower lids (the VRM1
    // males, e.g. Lucas) roll the iris fully under the upper lid -> white sclera.
    // GAZE_V_MAX is the tunable upper bound (was an unprotected 1.0).
    this.state.current.horizontal = clamp(this.state.current.horizontal, -1, 1);
    this.state.current.vertical = clamp(this.state.current.vertical, -0.45, GAZE_V_MAX);

    return { ...this.state.current };
  }

  getCurrent(): GazeTarget {
    return { ...this.state.current };
  }

  reset(): void {
    this.state.current = { horizontal: 0, vertical: 0 };
    this.state.target = { horizontal: 0, vertical: 0 };
    this.state.isInBreak = false;
    this.state.breakTimer = randomRange(...BREAK_INTERVAL);
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
