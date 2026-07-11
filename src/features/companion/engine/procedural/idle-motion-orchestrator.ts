/**
 * IdleMotionOrchestrator — Dispatches natural idle behaviors when the user
 * hasn't sent a message for a while.
 *
 * After ~10 seconds of silence, begins scheduling procedural idle motions:
 * - Head-only looks (turn head to glance somewhere)
 * - Eye-only looks (gaze shift via GazeController override)
 * - Combined head+eye looks (natural "looking around")
 * - Fidgets (weight shift, shoulder shrug, head tilt)
 * - Deep breaths
 * - Posture shifts
 *
 * Eye gaze is routed through a gaze controller (setIdleGazeOverride) so it
 * flows through the same eye-bone pipeline as all other gaze behavior.
 *
 * Ported from ami-ai-companion (src/components/3d/IdleMotionOrchestrator.ts).
 * The ami GazeController type import is replaced with the minimal structural
 * IdleGazeController interface below.
 */

import { logger } from '../logger';

// ─── Motion catalog ─────────────────────────────────────────────────────────

export type IdleMotionType =
  | 'head_glance_left'
  | 'head_glance_right'
  | 'head_glance_up'
  | 'head_glance_down'
  | 'eyes_glance_left'
  | 'eyes_glance_right'
  | 'eyes_glance_up'
  | 'eyes_glance_down'
  | 'combined_look_left'
  | 'combined_look_right'
  | 'combined_look_up_right'
  | 'combined_look_down_left'
  | 'weight_shift'
  | 'shoulder_shrug'
  | 'head_tilt'
  | 'deep_breath'
  | 'posture_settle'
  | 'look_away_then_back'
  | 'slow_blink_settle';

export interface IdleMotionDef {
  type: IdleMotionType;
  label: string;
  category: 'look_head' | 'look_eyes' | 'look_combined' | 'fidget' | 'breathing' | 'posture';
  description: string;
  /** Duration in seconds before the motion naturally completes */
  durationSec: number;
}

export const IDLE_MOTION_CATALOG: IdleMotionDef[] = [
  // Head-only looks (longer durations for natural feel)
  { type: 'head_glance_left',  label: 'Head Glance Left',  category: 'look_head', description: 'Turn head slightly left then return', durationSec: 3.5 },
  { type: 'head_glance_right', label: 'Head Glance Right', category: 'look_head', description: 'Turn head slightly right then return', durationSec: 3.5 },
  { type: 'head_glance_up',    label: 'Head Glance Up',    category: 'look_head', description: 'Tilt head up briefly (daydreaming)', durationSec: 3.0 },
  { type: 'head_glance_down',  label: 'Head Glance Down',  category: 'look_head', description: 'Drop head down briefly (thinking)', durationSec: 3.0 },

  // Eye-only looks
  { type: 'eyes_glance_left',  label: 'Eyes Glance Left',  category: 'look_eyes', description: 'Eyes dart left without moving head', durationSec: 2.0 },
  { type: 'eyes_glance_right', label: 'Eyes Glance Right', category: 'look_eyes', description: 'Eyes dart right without moving head', durationSec: 2.0 },
  { type: 'eyes_glance_up',    label: 'Eyes Glance Up',    category: 'look_eyes', description: 'Eyes look up (recalling/thinking)', durationSec: 2.5 },
  { type: 'eyes_glance_down',  label: 'Eyes Glance Down',  category: 'look_eyes', description: 'Eyes drop down (shy/contemplative)', durationSec: 2.5 },

  // Combined head+eye looks
  { type: 'combined_look_left',     label: 'Look Left',       category: 'look_combined', description: 'Head turns + eyes lead left', durationSec: 4.0 },
  { type: 'combined_look_right',    label: 'Look Right',      category: 'look_combined', description: 'Head turns + eyes lead right', durationSec: 4.0 },
  { type: 'combined_look_up_right', label: 'Look Up-Right',   category: 'look_combined', description: 'Dreamy upward gaze to the right', durationSec: 4.5 },
  { type: 'combined_look_down_left',label: 'Look Down-Left',  category: 'look_combined', description: 'Thoughtful downward gaze to the left', durationSec: 4.0 },
  { type: 'look_away_then_back',    label: 'Look Away & Back',category: 'look_combined', description: 'Glance away then slowly return to user', durationSec: 5.0 },

  // Fidgets
  { type: 'weight_shift',   label: 'Weight Shift',   category: 'fidget', description: 'Shift weight from one foot to the other', durationSec: 5.0 },
  { type: 'shoulder_shrug', label: 'Shoulder Shrug',  category: 'fidget', description: 'Small shoulder shrug and settle', durationSec: 1.2 },
  { type: 'head_tilt',      label: 'Head Tilt',       category: 'fidget', description: 'Tilt head to one side curiously', durationSec: 2.0 },

  // Breathing
  { type: 'deep_breath', label: 'Deep Breath', category: 'breathing', description: 'Visible deep inhale and slow exhale', durationSec: 4.0 },

  // Posture
  { type: 'posture_settle',    label: 'Posture Settle',    category: 'posture', description: 'Subtle posture readjustment', durationSec: 2.0 },
  { type: 'slow_blink_settle', label: 'Slow Blink Settle', category: 'posture', description: 'Slow comfortable blink + slight settle', durationSec: 3.0 },
];

// ─── Orchestrator ────────────────────────────────────────────────────────────

/** Minimal interface — only the PAC methods we actually call */
export interface IdleMotionTarget {
  triggerLook(x: number, y: number, duration: number): void;
  triggerFidget(type: 'shoulder' | 'weight' | 'headTilt'): void;
  triggerDeepBreath(): void;
  triggerManualMotion(type: 'nod' | 'tilt' | 'turn' | 'emphasisNod'): void;
}

/**
 * Minimal gaze-controller surface for eye-only idle looks. Structurally
 * compatible with the expression system's GazeController in ami.
 */
export interface IdleGazeController {
  setIdleGazeOverride(horizontal: number, vertical: number, durationMs: number): void;
  clearIdleGazeOverride(): void;
}

const IDLE_THRESHOLD_MS = 10_000; // 10 seconds before idle motions begin
const MIN_MOTION_INTERVAL_MS = 4_000; // minimum gap between motions
const MAX_MOTION_INTERVAL_MS = 9_000; // maximum gap between motions

/** Weighted pools by category — looks happen more than fidgets */
const CATEGORY_WEIGHTS: Record<IdleMotionDef['category'], number> = {
  look_eyes: 30,
  look_head: 25,
  look_combined: 20,
  fidget: 12,
  posture: 8,
  breathing: 5,
};

export class IdleMotionOrchestrator {
  private lastUserMessageMs: number = Date.now();
  private nextMotionMs: number = 0;
  private isIdle: boolean = false;
  private activeMotion: IdleMotionType | null = null;
  private activeMotionEndMs: number = 0;
  private target: IdleMotionTarget | null = null;
  private gazeController: IdleGazeController | null = null;
  private enabled: boolean = true;
  /** When true, idle motions are suppressed regardless of the enabled setting.
   *  Used when a tool card is visible and the character should hold its gaze. */
  private toolCardActive: boolean = false;

  /** Callback for dev modal — reports which motion fired */
  onMotionFired: ((motion: IdleMotionType) => void) | null = null;

  setTarget(target: IdleMotionTarget | null): void {
    this.target = target;
  }

  /** Set the gaze controller for eye-only idle looks */
  setGazeController(gc: IdleGazeController | null): void {
    this.gazeController = gc;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isActive(): boolean {
    return this.isIdle;
  }

  getActiveMotion(): IdleMotionType | null {
    return this.activeMotion;
  }

  /** Call when user sends a message — resets idle timer */
  onUserMessage(): void {
    this.lastUserMessageMs = Date.now();
    this.isIdle = false;
    this.activeMotion = null;
    this.gazeController?.clearIdleGazeOverride();
  }

  /** Suppress idle motions while a tool card is visible (character should hold gaze) */
  setToolCardActive(active: boolean): void {
    if (this.toolCardActive === active) return;
    this.toolCardActive = active;
    if (active && this.isIdle) {
      this.isIdle = false;
      this.activeMotion = null;
      this.gazeController?.clearIdleGazeOverride();
    }
  }

  /** Call when AI speaks (e.g. vision reaction) — resets idle timer.
   *  During screen share the user doesn't message, but the AI is actively
   *  commentating so idle motions should not compete with speaking animations. */
  onAISpeaking(): void {
    this.lastUserMessageMs = Date.now();
    if (this.isIdle) {
      this.isIdle = false;
      this.activeMotion = null;
      this.gazeController?.clearIdleGazeOverride();
    }
  }

  /** Called per frame from PAC.updateFrame() */
  tick(): void {
    if (!this.enabled || !this.target || this.toolCardActive) return;

    const now = Date.now();
    const idleDuration = now - this.lastUserMessageMs;

    // Not idle yet
    if (idleDuration < IDLE_THRESHOLD_MS) {
      this.isIdle = false;
      return;
    }

    // Just entered idle
    if (!this.isIdle) {
      this.isIdle = true;
      this.nextMotionMs = now + randomRange(1000, 3000);
      logger.debug('[IdleMotion] Entered idle state');
    }

    // Wait for active motion to finish
    if (this.activeMotion && now < this.activeMotionEndMs) {
      return;
    }
    if (this.activeMotion) {
      this.activeMotion = null;
    }

    // Time for next motion?
    if (now >= this.nextMotionMs) {
      this.dispatchRandomMotion();
      this.nextMotionMs = now + randomRange(MIN_MOTION_INTERVAL_MS, MAX_MOTION_INTERVAL_MS);
    }
  }

  /** Manually trigger a specific motion (from dev modal) */
  triggerMotion(type: IdleMotionType): void {
    if (!this.target) return;
    this.executeMotion(type);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private dispatchRandomMotion(): void {
    const motion = this.pickWeightedMotion();
    this.executeMotion(motion.type);
  }

  private executeMotion(type: IdleMotionType): void {
    if (!this.target) return;

    const def = IDLE_MOTION_CATALOG.find(m => m.type === type);
    if (!def) return;

    this.activeMotion = type;
    this.activeMotionEndMs = Date.now() + def.durationSec * 1000;

    logger.debug(`[IdleMotion] Playing: ${def.label}`);
    this.onMotionFired?.(type);

    switch (type) {
      // ── Head-only looks (slower, longer holds) ──
      case 'head_glance_left':
        this.target.triggerLook(-0.3, 0.025, 3.0);
        break;
      case 'head_glance_right':
        this.target.triggerLook(0.3, 0.025, 3.0);
        break;
      case 'head_glance_up':
        this.target.triggerLook(0.025, 0.09, 2.5);
        break;
      case 'head_glance_down':
        this.target.triggerLook(0.025, -0.18, 2.5);
        break;

      // ── Eye-only looks (via gaze controller override) ──
      case 'eyes_glance_left':
        this.gazeShift(-0.65, 0, 2000);
        break;
      case 'eyes_glance_right':
        this.gazeShift(0.65, 0, 2000);
        break;
      case 'eyes_glance_up':
        this.gazeShift(-0.1, 0.25, 2500);
        break;
      case 'eyes_glance_down':
        this.gazeShift(0.1, -0.55, 2500);
        break;

      // ── Combined head+eye looks ──
      case 'combined_look_left':
        this.target.triggerLook(-0.25, 0.04, 3.5);
        this.gazeShift(-0.45, 0.05, 3500);
        break;
      case 'combined_look_right':
        this.target.triggerLook(0.25, 0.04, 3.5);
        this.gazeShift(0.45, 0.05, 3500);
        break;
      case 'combined_look_up_right':
        this.target.triggerLook(0.18, 0.08, 4.0);
        this.gazeShift(0.3, 0.2, 4000);
        break;
      case 'combined_look_down_left':
        this.target.triggerLook(-0.18, -0.12, 3.5);
        this.gazeShift(-0.35, -0.35, 3500);
        break;
      case 'look_away_then_back': {
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.target.triggerLook(dir * 0.3, 0.05, 4.5);
        this.gazeShift(dir * 0.5, 0.08, 4500);
        break;
      }

      // ── Fidgets ──
      case 'weight_shift':
        this.target.triggerFidget('weight');
        break;
      case 'shoulder_shrug':
        this.target.triggerFidget('shoulder');
        break;
      case 'head_tilt': {
        // Slow head tilt to one side via triggerLook (uses the smooth 1.5 lerp)
        const tiltDir = Math.random() < 0.5 ? -1 : 1;
        this.target.triggerLook(tiltDir * 0.15, -0.05, 3.0);
        break;
      }

      // ── Breathing ──
      case 'deep_breath':
        this.target.triggerDeepBreath();
        break;

      // ── Posture ──
      case 'posture_settle':
        // Gentle downward settle — reads as a relaxed posture shift
        this.target.triggerLook(0.025, -0.08, 3.0);
        break;
      case 'slow_blink_settle':
        this.target.triggerLook(0, -0.05, 2.5);
        this.gazeShift(0, -0.2, 2500);
        break;
    }
  }

  /** Shift gaze via the expression system's gaze controller */
  private gazeShift(h: number, v: number, durationMs: number): void {
    if (!this.gazeController) return;
    this.gazeController.setIdleGazeOverride(h, v, durationMs);
  }

  private pickWeightedMotion(): IdleMotionDef {
    const weighted: { def: IdleMotionDef; weight: number }[] = IDLE_MOTION_CATALOG.map(def => ({
      def,
      weight: CATEGORY_WEIGHTS[def.category],
    }));

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.def;
    }

    return weighted[weighted.length - 1].def;
  }

  reset(): void {
    this.lastUserMessageMs = Date.now();
    this.isIdle = false;
    this.activeMotion = null;
    this.gazeController?.clearIdleGazeOverride();
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
