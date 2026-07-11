/**
 * BlinkController — autonomous eyelid blinking for a loaded VRM.
 *
 * Faithful port of ami-ai-companion's `src/components/3d/BlinkController.ts`.
 * Drives the VRM's `blink` expression (falling back to `blinkLeft`/`blinkRight`)
 * with randomized intervals, occasional double blinks, a settable baseline
 * (for squinted expressions), smoothed baseline transitions, and a freeze
 * mode (e.g. sleep = eyes held closed).
 */

import type { VRM } from '@pixiv/three-vrm';

export interface BlinkConfig {
  minInterval: number; // Minimum time between blinks (seconds)
  maxInterval: number; // Maximum time between blinks (seconds)
  blinkDuration: number; // Duration of a single blink (seconds)
  doubleBlinkChance: number; // Chance of double blink (0-1)
}

const DEFAULT_CONFIG: BlinkConfig = {
  minInterval: 2.0,
  maxInterval: 6.0,
  blinkDuration: 0.15,
  doubleBlinkChance: 0.2,
};

export class BlinkController {
  private vrm: VRM;
  private config: BlinkConfig;

  // Blink state
  private nextBlinkTime = 0;
  private isBlinking = false;
  private blinkProgress = 0;
  private blinkPhase: 'closing' | 'opening' = 'closing';
  private pendingDoubleBlink = false;
  private elapsedTime = 0;

  // Current blink value (0 = open, 1 = closed)
  private currentBlinkValue = 0;

  // Base blink value set by expressions (e.g., 0.3 for squinted angry eyes)
  // Blinks will return to this value instead of 0
  private baseBlinkValue = 0;

  // Baseline smoothing: when an expression asks for a new baseline with a
  // non-zero transition duration, we lerp baseBlinkValue toward the target
  // over that time instead of snapping. Keeps laugh-squint exit from being
  // a jarring "eyes pop open" the moment the preset transitions to neutral.
  private baselineTarget: number | null = null;
  private baselineRatePerSec = 0;

  // Enabled state
  private enabled = true;

  // Frozen value — when set, blink is held at exactly this value (used for sleep: 1 = eyes closed)
  private _frozenValue: number | null = null;

  constructor(vrm: VRM, config?: Partial<BlinkConfig>) {
    this.vrm = vrm;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scheduleNextBlink();
  }

  private scheduleNextBlink(): void {
    const interval =
      this.config.minInterval +
      Math.random() * (this.config.maxInterval - this.config.minInterval);
    this.nextBlinkTime = this.elapsedTime + interval;
  }

  /**
   * Freeze blinking at a fixed value. Pass null to resume normal blinking.
   * Used by sleep: freeze(1) keeps eyes fully closed.
   */
  freeze(value: number | null): void {
    this._frozenValue = value !== null ? Math.max(0, Math.min(1, value)) : null;
    if (this._frozenValue !== null) {
      this.currentBlinkValue = this._frozenValue;
      this.applyBlink();
    }
  }

  updateFrame(delta: number): void {
    // Smoothed baseline transition — lerps baseBlinkValue toward the target
    // set by setBaseBlinkValue(value, transitionMs). Runs every frame even
    // while disabled/sleeping so a laugh→neutral release continues to
    // smooth out even if another state change interrupts briefly.
    if (this.baselineTarget !== null) {
      const diff = this.baselineTarget - this.baseBlinkValue;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), this.baselineRatePerSec * delta);
      this.baseBlinkValue += step;
      if (Math.abs(this.baselineTarget - this.baseBlinkValue) < 0.001) {
        this.baseBlinkValue = this.baselineTarget;
        this.baselineTarget = null;
      }
      // If not mid-blink, the visible eyelid follows the baseline.
      if (!this.isBlinking && this._frozenValue === null) {
        this.currentBlinkValue = this.baseBlinkValue;
        this.applyBlink();
      }
    }

    // Sleep mode — hold eyes at the frozen value, no blinking
    if (this._frozenValue !== null) {
      if (this.currentBlinkValue !== this._frozenValue) {
        this.currentBlinkValue = this._frozenValue;
        this.applyBlink();
      }
      return;
    }

    if (!this.enabled) {
      // Ensure eyes are open when disabled
      if (this.currentBlinkValue > 0) {
        this.currentBlinkValue = Math.max(0, this.currentBlinkValue - delta * 10);
        this.applyBlink();
      }
      return;
    }

    this.elapsedTime += delta;

    if (this.isBlinking) {
      this.updateBlink(delta);
    } else if (this.elapsedTime >= this.nextBlinkTime) {
      this.startBlink();
    }
  }

  private startBlink(): void {
    this.isBlinking = true;
    this.blinkProgress = 0;
    this.blinkPhase = 'closing';

    // Determine if this will be a double blink
    if (!this.pendingDoubleBlink) {
      this.pendingDoubleBlink = Math.random() < this.config.doubleBlinkChance;
    }
  }

  private updateBlink(delta: number): void {
    const blinkSpeed = 1 / this.config.blinkDuration;
    this.blinkProgress += delta * blinkSpeed;

    if (this.blinkPhase === 'closing') {
      // Closing phase (0 to 0.5 of progress)
      if (this.blinkProgress < 0.5) {
        // Ease-in for closing, starting from base value
        const t = this.blinkProgress * 2; // 0 to 1
        this.currentBlinkValue =
          this.baseBlinkValue + (1 - this.baseBlinkValue) * this.easeInQuad(t);
      } else {
        this.currentBlinkValue = 1;
        this.blinkPhase = 'opening';
      }
    } else {
      // Opening phase (0.5 to 1.0 of progress)
      if (this.blinkProgress < 1.0) {
        const t = (this.blinkProgress - 0.5) * 2; // 0 to 1
        // Return to base value, not 0
        this.currentBlinkValue = 1 - (1 - this.baseBlinkValue) * this.easeOutQuad(t);
      } else {
        // Blink complete - return to base value
        this.currentBlinkValue = this.baseBlinkValue;
        this.isBlinking = false;

        if (this.pendingDoubleBlink) {
          // Schedule immediate second blink
          this.pendingDoubleBlink = false;
          this.nextBlinkTime = this.elapsedTime + 0.1; // Short delay for double blink
        } else {
          this.scheduleNextBlink();
        }
      }
    }

    this.applyBlink();
  }

  private applyBlink(): void {
    if (!this.vrm.expressionManager) {
      return;
    }

    try {
      // VRM uses 'blink' expression for both eyes
      this.vrm.expressionManager.setValue('blink', this.currentBlinkValue);
    } catch {
      // Try individual eye blinks if 'blink' doesn't exist
      try {
        this.vrm.expressionManager.setValue('blinkLeft', this.currentBlinkValue);
        this.vrm.expressionManager.setValue('blinkRight', this.currentBlinkValue);
      } catch {
        // Model might not have blink expressions
      }
    }
  }

  // Easing functions for natural blink motion
  private easeInQuad(t: number): number {
    return t * t;
  }

  private easeOutQuad(t: number): number {
    return t * (2 - t);
  }

  // Manual blink trigger
  triggerBlink(): void {
    if (!this.isBlinking) {
      this.startBlink();
    }
  }

  // Enable/disable blinking
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Update config
  updateConfig(config: Partial<BlinkConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Reset state
  reset(): void {
    this.isBlinking = false;
    this.currentBlinkValue = this.baseBlinkValue;
    this.blinkProgress = 0;
    this.pendingDoubleBlink = false;
    this.elapsedTime = 0;
    this.applyBlink();
    this.scheduleNextBlink();
  }

  /**
   * Set the baseline blink value (what the eyes hold between full blinks).
   * Pass `transitionMs > 0` to smoothly lerp to the new value over that
   * duration — used when exiting a squinted state (e.g. laugh → neutral)
   * so the eyes don't pop open instantly.
   */
  setBaseBlinkValue(value: number, transitionMs = 0): void {
    const clamped = Math.max(0, Math.min(1, value));

    if (transitionMs <= 0) {
      // Instant path (original behavior).
      this.baselineTarget = null;
      this.baseBlinkValue = clamped;
      // Don't override current value when frozen — freeze takes priority.
      if (!this.isBlinking && this._frozenValue === null) {
        this.currentBlinkValue = this.baseBlinkValue;
        this.applyBlink();
      }
      return;
    }

    // Smoothed path: lerp baseBlinkValue toward `clamped` over `transitionMs`.
    // Rate is distance/time so the total duration is respected regardless of
    // how far we're moving.
    this.baselineTarget = clamped;
    const distance = Math.abs(clamped - this.baseBlinkValue);
    this.baselineRatePerSec = distance > 0 ? distance / (transitionMs / 1000) : 0;
  }

  // Get current base blink value
  getBaseBlinkValue(): number {
    return this.baseBlinkValue;
  }
}
