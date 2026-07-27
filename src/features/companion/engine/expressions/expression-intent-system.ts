/**
 * ExpressionIntentSystem — Intent Management (Layer B)
 *
 * Receives, tracks, and manages short-lived expression requests
 * from dialogue, VN, scene logic, vision, idle, etc.
 */

import {
  type ExpressionIntent,
  type IntentSource,
  type Envelope,
  intentEndTimeMs,
} from './types';

let nextIntentId = 0;
function generateIntentId(): string {
  return `intent_${++nextIntentId}_${Date.now().toString(36)}`;
}

export class ExpressionIntentSystem {
  private intents: Map<string, ExpressionIntent> = new Map();
  private currentTimeMs: number = 0;

  /** Submit a new expression intent, returns its ID */
  submit(intent: Omit<ExpressionIntent, 'id'>): string {
    const id = generateIntentId();
    const full: ExpressionIntent = { ...intent, id };
    this.intents.set(id, full);
    return id;
  }

  /** Cancel a specific intent by ID */
  cancel(intentId: string): void {
    this.intents.delete(intentId);
  }

  /** Clear all intents from a given source.
   *  Active intents are fast-released (crossfade out over ~120ms) instead of
   *  being deleted instantly, preventing a visible snap to base emotional state. */
  clearSource(source: IntentSource): void {
    for (const [id, intent] of this.intents) {
      if (intent.source !== source) continue;

      const envWeight = this.evaluateEnvelope(intent);
      if (envWeight > 0.05) {
        // Force the intent into release phase starting now
        // by rewriting its timing so attack+sustain are already elapsed
        const FAST_RELEASE_MS = 120;
        intent.startTimeMs = this.currentTimeMs - intent.envelope.attackMs - intent.envelope.sustainMs;
        intent.envelope = { ...intent.envelope, releaseMs: FAST_RELEASE_MS };
      } else {
        this.intents.delete(id);
      }
    }
  }

  /** Update the system clock and remove expired intents */
  update(currentTimeMs: number): void {
    this.currentTimeMs = currentTimeMs;

    // Expire intents whose full envelope has completed
    for (const [id, intent] of this.intents) {
      if (currentTimeMs > intentEndTimeMs(intent)) {
        this.intents.delete(id);
      }
    }
  }

  /** Get all currently active intents (started and not yet expired) */
  getActiveIntents(): ExpressionIntent[] {
    const active: ExpressionIntent[] = [];
    for (const intent of this.intents.values()) {
      if (this.currentTimeMs >= intent.startTimeMs) {
        active.push(intent);
      }
    }
    // Sort by priority descending so higher priority is first
    active.sort((a, b) => b.priority - a.priority);
    return active;
  }

  /** Get intents that are about to expire (in release phase) for residue handling */
  getDecayingIntents(): ExpressionIntent[] {
    const decaying: ExpressionIntent[] = [];
    for (const intent of this.intents.values()) {
      const elapsed = this.currentTimeMs - intent.startTimeMs;
      const attackEnd = intent.envelope.attackMs;
      const sustainEnd = attackEnd + intent.envelope.sustainMs;
      if (elapsed > sustainEnd && intent.decayToState) {
        decaying.push(intent);
      }
    }
    return decaying;
  }

  /**
   * Evaluate the envelope weight (0..1) for an intent at the current time.
   * This determines how strongly the intent should influence the output.
   */
  evaluateEnvelope(intent: ExpressionIntent): number {
    const elapsed = this.currentTimeMs - intent.startTimeMs;
    if (elapsed < 0) return 0;

    const { attackMs, sustainMs, releaseMs, curve } = intent.envelope;
    const totalMs = attackMs + sustainMs + releaseMs;

    if (elapsed >= totalMs) return 0;

    let t: number;
    if (elapsed < attackMs) {
      // Attack phase
      t = attackMs > 0 ? elapsed / attackMs : 1;
      return applyCurveAttack(t, curve);
    } else if (elapsed < attackMs + sustainMs) {
      // Sustain phase — full strength
      return 1;
    } else {
      // Release phase
      const releaseElapsed = elapsed - attackMs - sustainMs;
      t = releaseMs > 0 ? releaseElapsed / releaseMs : 1;
      return 1 - applyCurveRelease(t, curve);
    }
  }

  getIntentCount(): number {
    return this.intents.size;
  }

  getCurrentTimeMs(): number {
    return this.currentTimeMs;
  }

  clear(): void {
    this.intents.clear();
  }
}

function applyCurveAttack(t: number, curve: Envelope['curve']): number {
  t = Math.max(0, Math.min(1, t));
  switch (curve) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'fastAttackSlowRelease': return 1 - (1 - t) * (1 - t) * (1 - t); // fast attack
    default: return t;
  }
}

function applyCurveRelease(t: number, curve: Envelope['curve']): number {
  t = Math.max(0, Math.min(1, t));
  switch (curve) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'fastAttackSlowRelease': return t * t; // slow release
    default: return t;
  }
}
