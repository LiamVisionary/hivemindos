/**
 * EmotionalStateController — Persistent Emotional State (Layer A)
 *
 * Owns Ami's ongoing internal affect as continuous 0..1 dimensions.
 * State changes gradually via per-dimension smoothing rates, never snaps.
 */

import {
  type EmotionalState,
  type ExpressionPersonalityProfile,
  type RelationshipExpressionContext,
  EMOTIONAL_STATE_KEYS,
  EMOTIONAL_SMOOTHING_RATES,
  createNeutralState,
  createDefaultPersonality,
  createDefaultRelationship,
} from './types';

export class EmotionalStateController {
  private current: EmotionalState;
  private target: EmotionalState;
  private personality: ExpressionPersonalityProfile;
  private relationship: RelationshipExpressionContext;

  constructor() {
    this.current = createNeutralState();
    this.target = createNeutralState();
    this.personality = createDefaultPersonality();
    this.relationship = createDefaultRelationship();
  }

  /**
   * Set target emotional state — the system will smoothly lerp toward it.
   * Dimensions present in `partial` are set directly.
   * Dimensions NOT present decay toward 0, preventing stale emotions (e.g. irritation
   * lingering after the character has recovered to happy). The decay is gentle (halved
   * each call) so transitions feel natural, not jarring.
   */
  setTarget(partial: Partial<EmotionalState>): void {
    for (const key of EMOTIONAL_STATE_KEYS) {
      if (key in partial) {
        this.target[key] = Math.max(0, Math.min(1, partial[key]!));
      } else if (this.target[key] > 0.01) {
        // Decay unset dimensions toward 0 — prevents stale negative emotions
        // from persisting across emotion switches (e.g. angry → happy should
        // reduce irritation, not leave it at 0.7 forever)
        this.target[key] *= 0.5;
        if (this.target[key] < 0.01) this.target[key] = 0;
      }
    }
  }

  /** Restore a saved full emotional state without smoothing or partial-decay side effects. */
  restoreImmediate(partial: Partial<EmotionalState>): void {
    const restored = createNeutralState();
    for (const key of EMOTIONAL_STATE_KEYS) {
      if (key in partial && typeof partial[key] === 'number') {
        restored[key] = Math.max(0, Math.min(1, partial[key]!));
      }
    }
    this.current = { ...restored };
    this.target = { ...restored };
  }

  /** Apply relationship-aware biases to the current state */
  private applyRelationshipBias(): void {
    const r = this.relationship;

    // High trust + affection → warmer base, more eye contact comfort
    if (r.trust > 0.6 && r.affection > 0.5) {
      this.target.warmth = Math.max(this.target.warmth, 0.25);
      this.target.affection = Math.max(this.target.affection, 0.15);
    }

    // Tension → guardedness
    if (r.tension > 0.5) {
      this.target.tension = Math.max(this.target.tension, r.tension * 0.4);
      this.target.playfulness = Math.min(this.target.playfulness, 0.2);
    }

    // Flirt mode → boost playfulness and confidence
    if (r.flirtMode) {
      this.target.playfulness = Math.max(this.target.playfulness, 0.3);
      this.target.confidence = Math.max(this.target.confidence, 0.35);
    }

    // Support mode → reduce smirk/playful, boost warmth
    if (r.supportMode) {
      this.target.playfulness = Math.min(this.target.playfulness, 0.15);
      this.target.warmth = Math.max(this.target.warmth, 0.4);
    }
  }

  /** Per-frame update: smoothly move current toward target */
  update(deltaSec: number): EmotionalState {
    this.applyRelationshipBias();

    const recoveryMult = 0.5 + this.personality.recoverySpeed * 1.5;

    for (const key of EMOTIONAL_STATE_KEYS) {
      const rate = EMOTIONAL_SMOOTHING_RATES[key] * recoveryMult;
      const factor = 1 - Math.exp(-rate * deltaSec); // exponential smoothing
      this.current[key] += (this.target[key] - this.current[key]) * factor;
      // Clamp
      this.current[key] = Math.max(0, Math.min(1, this.current[key]));
    }

    return { ...this.current };
  }

  /** Apply emotional residue from a decayed expression intent */
  applyResidue(residue: Partial<EmotionalState>): void {
    for (const key of EMOTIONAL_STATE_KEYS) {
      if (key in residue) {
        // Residue nudges the target, not snaps
        this.target[key] = Math.max(0, Math.min(1, this.target[key] + residue[key]!));
      }
    }
  }

  getCurrent(): EmotionalState {
    return { ...this.current };
  }

  getTarget(): EmotionalState {
    return { ...this.target };
  }

  setPersonality(profile: Partial<ExpressionPersonalityProfile>): void {
    Object.assign(this.personality, profile);
  }

  setRelationship(ctx: Partial<RelationshipExpressionContext>): void {
    Object.assign(this.relationship, ctx);
  }

  getPersonality(): ExpressionPersonalityProfile {
    return { ...this.personality };
  }

  getRelationship(): RelationshipExpressionContext {
    return { ...this.relationship };
  }

  reset(): void {
    this.current = createNeutralState();
    this.target = createNeutralState();
  }
}
