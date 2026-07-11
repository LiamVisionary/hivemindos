/**
 * IdleLayer — Ambient micro-behaviors when not actively emoting
 *
 * Generates low-priority expression intents for:
 * - subtle gaze drift
 * - micro-smile flickers in warm states
 * - small brow adjustments
 * - ambient eye shape modulation
 *
 * These keep the face alive during silence/pauses.
 */

import type {
  EmotionalState,
  ExpressionPersonalityProfile,
  ExpressionIntent,
  IntentSource,
} from './types';
import { PRIORITY } from './types';

const IDLE_TICK_INTERVAL_MS = 2500; // how often idle layer generates new micro-expressions
const _MICRO_EXPRESSION_DURATION_MS = 1800;

export class IdleLayer {
  private lastTickMs: number = 0;
  private pendingIntents: Omit<ExpressionIntent, 'id'>[] = [];

  /**
   * Called per frame. Periodically generates idle micro-expression intents.
   * Returns any newly generated intents to be submitted to the intent system.
   */
  update(
    currentTimeMs: number,
    emotionalState: EmotionalState,
    personality: ExpressionPersonalityProfile,
    activeIntentCount: number,
  ): Omit<ExpressionIntent, 'id'>[] {
    // Don't generate idle expressions if there are already active intents
    // (let the real expressions play out)
    if (activeIntentCount > 1) {
      this.lastTickMs = currentTimeMs;
      return [];
    }

    if (currentTimeMs - this.lastTickMs < IDLE_TICK_INTERVAL_MS) {
      return [];
    }

    this.lastTickMs = currentTimeMs;
    this.pendingIntents = [];

    // Higher expressiveness = more idle micro-expressions
    if (Math.random() > 0.3 + personality.expressiveness * 0.4) {
      return [];
    }

    this.generateIdleMicroExpression(currentTimeMs, emotionalState, personality);
    return this.pendingIntents;
  }

  private generateIdleMicroExpression(
    currentTimeMs: number,
    state: EmotionalState,
    _personality: ExpressionPersonalityProfile,
  ): void {
    const source: IntentSource = 'idle';

    // Warm micro-smile flicker
    if (state.warmth > 0.3 && Math.random() < 0.4) {
      this.pendingIntents.push({
        source,
        kind: 'micro_expression',
        preset: 'warm',
        intensity: 0.15 + Math.random() * 0.15,
        priority: PRIORITY.IDLE_AMBIENT,
        startTimeMs: currentTimeMs + Math.random() * 500,
        envelope: {
          attackMs: 300 + Math.random() * 200,
          sustainMs: 600 + Math.random() * 400,
          releaseMs: 400 + Math.random() * 300,
          curve: 'easeInOut',
        },
        interruptible: true,
        regionMask: ['mouthCorners', 'eyelids'],
      });
      return;
    }

    // Playful brow raise
    if (state.playfulness > 0.3 && Math.random() < 0.3) {
      this.pendingIntents.push({
        source,
        kind: 'micro_expression',
        preset: 'teasing',
        intensity: 0.1 + Math.random() * 0.12,
        priority: PRIORITY.IDLE_AMBIENT,
        startTimeMs: currentTimeMs + Math.random() * 600,
        envelope: {
          attackMs: 200,
          sustainMs: 400 + Math.random() * 300,
          releaseMs: 350,
          curve: 'easeInOut',
        },
        interruptible: true,
        regionMask: ['brows'],
      });
      return;
    }

    // Subtle tension flicker (slight brow furrow)
    if (state.tension > 0.3 && Math.random() < 0.25) {
      this.pendingIntents.push({
        source,
        kind: 'micro_expression',
        preset: 'tense',
        intensity: 0.1 + Math.random() * 0.1,
        priority: PRIORITY.IDLE_AMBIENT,
        startTimeMs: currentTimeMs + Math.random() * 400,
        envelope: {
          attackMs: 250,
          sustainMs: 500,
          releaseMs: 400,
          curve: 'easeIn',
        },
        interruptible: true,
        regionMask: ['brows', 'eyelids'],
      });
      return;
    }

    // Curiosity glance (eyes widen slightly)
    if (state.curiosity > 0.25 && Math.random() < 0.25) {
      this.pendingIntents.push({
        source,
        kind: 'micro_expression',
        preset: 'impressed',
        intensity: 0.08 + Math.random() * 0.1,
        priority: PRIORITY.IDLE_AMBIENT,
        startTimeMs: currentTimeMs + Math.random() * 500,
        envelope: {
          attackMs: 200,
          sustainMs: 300,
          releaseMs: 350,
          curve: 'easeInOut',
        },
        interruptible: true,
        regionMask: ['brows', 'eyelids'],
      });
      return;
    }

    // Sad settling (slight downturn, heavier lids)
    if (state.sadness > 0.3 && Math.random() < 0.3) {
      this.pendingIntents.push({
        source,
        kind: 'micro_expression',
        preset: 'low',
        intensity: 0.12 + Math.random() * 0.1,
        priority: PRIORITY.IDLE_AMBIENT,
        startTimeMs: currentTimeMs + Math.random() * 600,
        envelope: {
          attackMs: 400,
          sustainMs: 700,
          releaseMs: 500,
          curve: 'easeInOut',
        },
        interruptible: true,
        regionMask: ['eyelids', 'mouthCorners'],
      });
    }
  }

  reset(): void {
    this.lastTickMs = 0;
    this.pendingIntents = [];
  }
}
