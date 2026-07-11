/**
 * BlinkModulator — Emotion-aware blink modulation
 *
 * Sits on top of the existing BlinkController, adjusting blink
 * behavior based on emotional state and expression intents.
 * Does NOT replace BlinkController — it provides parameters to it.
 */

import type {
  BlinkModulation,
  EmotionalState,
  ExpressionPersonalityProfile,
} from './types';

const BLINK_SMOOTH_SPEED = 3; // per-second lerp

export class BlinkModulator {
  private current: BlinkModulation = { intervalScale: 1, amplitudeScale: 1, durationScale: 1 };
  private target: BlinkModulation = { intervalScale: 1, amplitudeScale: 1, durationScale: 1 };

  /**
   * Update blink modulation based on emotional state and mixer output.
   * Returns smoothed modulation values.
   */
  update(
    deltaSec: number,
    emotionalState: EmotionalState,
    personality: ExpressionPersonalityProfile,
    mixerBlinkMod: BlinkModulation,
  ): BlinkModulation {
    // Start from mixer output
    this.target = { ...mixerBlinkMod };

    // Personality softness bias
    const softnessBias = personality.blinkSoftness;
    this.target.amplitudeScale += softnessBias * 0.15;
    this.target.durationScale += softnessBias * 0.1;

    // Surprise suppression: briefly suppress blinks
    // (handled by mixer via recipe blinkMod, but we can add extra suppression)

    // Smooth toward target
    const factor = 1 - Math.exp(-BLINK_SMOOTH_SPEED * deltaSec);
    this.current.intervalScale += (this.target.intervalScale - this.current.intervalScale) * factor;
    this.current.amplitudeScale += (this.target.amplitudeScale - this.current.amplitudeScale) * factor;
    this.current.durationScale += (this.target.durationScale - this.current.durationScale) * factor;

    return { ...this.current };
  }

  getCurrent(): BlinkModulation {
    return { ...this.current };
  }

  reset(): void {
    this.current = { intervalScale: 1, amplitudeScale: 1, durationScale: 1 };
    this.target = { intervalScale: 1, amplitudeScale: 1, durationScale: 1 };
  }
}
