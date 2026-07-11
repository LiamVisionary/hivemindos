/**
 * VRM lip-sync controller. Ported from ami-ai-companion
 * src/components/3d/LipSyncController.ts (VRM path only — no Streamoji/DAZ).
 *
 * Three drive modes (mutually exclusive; phoneme mode takes priority):
 *   1. Phoneme mode      — startLipSync(phonemes) / updateFrame(delta) / stopLipSync()
 *   2. Audio-reactive    — startAudioReactive(audioElement, audioContext?) analyses an
 *                          HTMLAudioElement's frequency data and drives mouth openness.
 *   3. External amplitude — startExternalAmplitude() / setExternalAmplitude(level) for
 *                          hosts that already own an AnalyserNode-derived 0..1 speaking
 *                          level and feed it per frame. No AudioContext is created;
 *                          the same smoothing/attack-decay as audio-reactive mode is
 *                          reused so it looks identical.
 */
import { logger } from '../logger';
import { IPA_TO_VISEME_INDEX } from './viseme-mapping';
import { enhancePhonemes } from './phoneme-enhancer';
import type { VRM } from '@pixiv/three-vrm';

// Phoneme information for lip sync
export interface PhonemeInfo {
  phoneme: string;
  startOffsetS?: number;
  intensity?: number;
}

const SMOOTH_FACTOR_S = 0.08;
const LAST_PHONEME_DURATION = 0.5;
const EXPRESSION_FACTOR = 0.5;

// Enhancement 5: long-hold relaxation constants
const RELAXATION_THRESHOLD_S = 0.3;
const RELAXATION_AMOUNT = 0.3;

// 30fps throttle for viseme computation (~33ms between updates)
const LIPSYNC_FRAME_INTERVAL_S = 1 / 30;

// Audio-reactive fallback constants
const AUDIO_REACTIVE_FFT_SIZE = 1024;
const AUDIO_REACTIVE_SMOOTHING = 0.5;
const AUDIO_REACTIVE_THRESHOLD = 10;
const AUDIO_REACTIVE_DAMPEN = 53;
const AUDIO_REACTIVE_MIN = 12;
const AUDIO_REACTIVE_BOOST = 1.0;

// External-amplitude mode: incoming levels are 0..1; scale into the same
// byte-average domain the analyser-based path uses so the threshold /
// dampen / boost constants (and therefore the look) are identical.
const EXTERNAL_AMPLITUDE_SCALE = 255;

// Map numeric visemes to VRM expression names. VRM 1.0 commonly exposes
// aa/ih/ou/ee/oh, while VRM0 blendshape groups register a/i/u/e/o.
const VISEME_BLEND_SHAPES = [
  ['aa', 'a', 'A'],  // Viseme 0 - Open mouth (a, p, b, m, k, g)
  ['ih', 'i', 'I'],  // Viseme 1 - Slight open (f, v, r, ə)
  ['ou', 'u', 'U'],  // Viseme 2 - Rounded (w, u, θ, ð)
  ['ee', 'e', 'E'],  // Viseme 3 - Wide (i, e, t, d, s, z, n, l)
  ['oh', 'o', 'O']   // Viseme 4 - Open rounded (o, ʃ, ʒ, tʃ, dʒ)
];

export class LipSyncController {
  private vrm: VRM;
  private phonemeData: PhonemeInfo[] = [];
  private visemeOffsetS: number = 0;
  private currentVisemeData: number[] = [0, 0, 0, 0, 0]; // 5 visemes
  private isActive: boolean = false;
  private isFadingOut: boolean = false;
  private expectedEndTime: number = 0;
  private maxPhonemeDuration: number = 120;
  private animationStartTime: number = 0;
  private enhancedMode: boolean = false;

  // 30fps throttle state
  private accumulatedDelta: number = 0;

  // Audio-reactive fallback state
  private audioReactiveActive: boolean = false;
  private analyser: AnalyserNode | null = null;
  private audioSource: MediaElementAudioSourceNode | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private audioReactiveContext: AudioContext | null = null;

  // External-amplitude mode state (host-fed 0..1 speaking level)
  private externalAmplitudeActive: boolean = false;
  private externalAmplitudeLevel: number = 0;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.currentVisemeData = [0, 0, 0, 0, 0];
  }

  setEnhancedMode(enabled: boolean): void {
    this.enhancedMode = enabled;
    logger.debug(`LipSync: Enhanced mode ${enabled ? 'ON' : 'OFF'}`);
  }

  isEnhancedMode(): boolean {
    return this.enhancedMode;
  }

  // Exact port of the RPM phoneme→viseme envelope logic
  private RPMPhonemDataToViseme(offset: number, phonemeData: PhonemeInfo[]): number[] {
    const visemeData: number[] = Array(5).fill(0);

    if (!phonemeData || phonemeData.length === 0) {
      return visemeData;
    }

    // Once the generated final phoneme has closed, keep the mouth closed until
    // audio end. Looping the final slice reads as an extra whispered word.
    const lastPhoneme = phonemeData[phonemeData.length - 1];
    const lastPhonemeEnd = lastPhoneme.startOffsetS! + LAST_PHONEME_DURATION;
    const effectiveOffset = offset;

    if (lastPhonemeEnd < offset) {
      return visemeData;
    }

    for (let currentIndex = 0; currentIndex < phonemeData.length; currentIndex++) {
      const currentPhoneme = phonemeData[currentIndex];
      const nextPhoneme = phonemeData[currentIndex + 1];

      const currentOffset = currentPhoneme.startOffsetS!;
      const nextOffset = nextPhoneme
        ? nextPhoneme.startOffsetS!
        : currentOffset + LAST_PHONEME_DURATION;

      const currentPhonemeName = currentPhoneme.phoneme;

      if (!currentPhonemeName) {
        continue;
      }

      const currentViseme = IPA_TO_VISEME_INDEX[currentPhonemeName] ?? 0;
      if (currentViseme === -1) continue; // Skip silent phonemes

      const phonemeDuration = nextOffset - currentOffset;
      let visemeValue = 0;

      const phonemeIntensity = currentPhoneme.intensity ?? 1.0;
      const scaledFactor = EXPRESSION_FACTOR * phonemeIntensity;

      if (effectiveOffset >= currentOffset && effectiveOffset < nextOffset) {
        // We're currently in this phoneme
        const progressInPhoneme = (effectiveOffset - currentOffset) / phonemeDuration;

        // Create envelope: fade in, sustain, fade out
        if (progressInPhoneme < 0.2) {
          visemeValue = scaledFactor * (progressInPhoneme / 0.2);
        } else if (progressInPhoneme > 0.8) {
          visemeValue = scaledFactor * ((1.0 - progressInPhoneme) / 0.2);
        } else {
          visemeValue = scaledFactor;
        }

        // Enhancement 5: long-hold relaxation — reduce intensity past 60% of long phonemes
        if (this.enhancedMode
          && phonemeDuration > RELAXATION_THRESHOLD_S
          && progressInPhoneme > 0.6
        ) {
          const relaxProgress = (progressInPhoneme - 0.6) / 0.4;
          visemeValue *= (1.0 - relaxProgress * RELAXATION_AMOUNT);
        }
      } else if (effectiveOffset < currentOffset) {
        // Phoneme hasn't started yet - smooth lead-in
        const delta = currentOffset - effectiveOffset;
        if (delta < SMOOTH_FACTOR_S) {
          visemeValue = scaledFactor * this.smooth(delta);
        }
      } else {
        // Phoneme has finished - smooth lead-out
        const delta = effectiveOffset - nextOffset;
        if (delta < SMOOTH_FACTOR_S) {
          visemeValue = scaledFactor * this.smooth(delta);
        }
      }

      // Use the strongest value for each viseme
      if (visemeValue > visemeData[currentViseme]) {
        visemeData[currentViseme] = visemeValue;
      }
    }

    return visemeData;
  }

  private smooth(delta: number): number {
    const normalizedDelta = Math.max(0, Math.min(1, delta / SMOOTH_FACTOR_S));
    return 1 - normalizedDelta; // Linear fade
  }

  /**
   * Called when audio actually starts playing - resets timing to sync lip sync with audio
   */
  onAudioStart(): void {
    logger.debug('LipSync: Audio started, resetting timing. Phonemes:', this.phonemeData.length);
    this.visemeOffsetS = 0;
    this.animationStartTime = Date.now() / 1000;
    this.isActive = true;
  }

  startLipSync(phonemes: PhonemeInfo[]): void {
    if (!phonemes || phonemes.length === 0) return;

    // Stop amplitude-driven modes if active - phoneme-based lip sync takes priority
    if (this.audioReactiveActive) {
      this.stopAudioReactive();
    }
    if (this.externalAmplitudeActive) {
      this.stopExternalAmplitude();
    }

    // Check if this is a continuation (new phonemes have higher start times than current offset)
    // This happens with queued TTS audio segments
    const firstNewPhonemeTime = phonemes[0]?.startOffsetS || 0;
    const isAppending = this.isActive && firstNewPhonemeTime > this.visemeOffsetS;

    if (isAppending) {
      logger.debug('LipSync: APPENDING', phonemes.length, 'phonemes (offset:', firstNewPhonemeTime.toFixed(2), 's)');

      // Append new phonemes to existing data
      const combinedPhonemes = [...this.phonemeData, ...phonemes];
      this.phonemeData = combinedPhonemes.sort((a, b) => (a.startOffsetS || 0) - (b.startOffsetS || 0));

      // Remove duplicates
      const uniquePhonemes: PhonemeInfo[] = [];
      this.phonemeData.forEach(p => {
        const exists = uniquePhonemes.some(existing =>
          Math.abs((existing.startOffsetS || 0) - (p.startOffsetS || 0)) < 0.01 &&
          existing.phoneme === p.phoneme
        );
        if (!exists) {
          uniquePhonemes.push(p);
        }
      });
      this.phonemeData = uniquePhonemes;

      // Update expected end time (extend it)
      if (this.phonemeData.length > 0) {
        const lastPhonemeTime = Math.max(...this.phonemeData.map(p => p.startOffsetS || 0));
        this.expectedEndTime = lastPhonemeTime + 0.5;
        logger.debug('LipSync: Extended end time:', this.expectedEndTime.toFixed(2), 's (total phonemes:', this.phonemeData.length, ')');
      }

      // DON'T reset visemeOffsetS - keep current playback position
      return;
    }

    logger.debug('LipSync: startLipSync called with', phonemes.length, 'phonemes');

    // IMPORTANT: Replace phoneme data instead of appending for new messages
    // This prevents stale phonemes from previous messages causing lip sync issues
    // The phonemes array should contain ALL phonemes for the current utterance
    this.phonemeData = [...phonemes].sort((a, b) => (a.startOffsetS || 0) - (b.startOffsetS || 0));

    // Remove duplicates
    const uniquePhonemes: PhonemeInfo[] = [];
    this.phonemeData.forEach(p => {
      const exists = uniquePhonemes.some(existing =>
        Math.abs((existing.startOffsetS || 0) - (p.startOffsetS || 0)) < 0.01 &&
        existing.phoneme === p.phoneme
      );
      if (!exists) {
        uniquePhonemes.push(p);
      }
    });
    this.phonemeData = uniquePhonemes;

    if (this.enhancedMode) {
      this.phonemeData = enhancePhonemes(this.phonemeData);
      logger.debug('LipSync: Enhanced phonemes:', this.phonemeData.length, '(from', phonemes.length, 'original)');
    }

    // Calculate expected end time
    if (this.phonemeData.length > 0) {
      const lastPhonemeTime = Math.max(...this.phonemeData.map(p => p.startOffsetS || 0));
      this.expectedEndTime = lastPhonemeTime + 0.5;
      logger.debug('LipSync: Expected end time:', this.expectedEndTime.toFixed(2), 's');
    }

    // Reset timing offset when new phonemes arrive
    // This ensures lip sync starts from the beginning for new messages
    this.visemeOffsetS = 0;
    this.animationStartTime = Date.now() / 1000;
    this.isActive = true;
    this.isFadingOut = false; // Cancel any in-progress fade-out
  }

  // Debug: track if we've logged the first active frame
  private hasLoggedActiveFrame = false;

  updateFrame(delta: number): void {
    // Amplitude-driven modes run at 30fps too
    if (this.audioReactiveActive || this.externalAmplitudeActive) {
      this.accumulatedDelta += delta;
      if (this.accumulatedDelta < LIPSYNC_FRAME_INTERVAL_S) return;
      if (this.audioReactiveActive) {
        this.updateAudioReactive();
      } else {
        this.updateExternalAmplitude();
      }
      this.accumulatedDelta = 0;
      return;
    }

    if (!this.isActive) {
      this.hasLoggedActiveFrame = false;
      if (this.isFadingOut) {
        this.fadeOutMouth(delta);
        // End fade-out once all visemes are near zero
        const maxViseme = Math.max(...this.currentVisemeData);
        if (maxViseme < 0.01) {
          this.isFadingOut = false;
          this.currentVisemeData = [0, 0, 0, 0, 0];
          this.applyVisemes();
        }
      }
      return;
    }

    if (this.phonemeData.length === 0) {
      this.fadeOutMouth(delta);
      return;
    }

    // Log once when lip sync becomes active
    if (!this.hasLoggedActiveFrame) {
      logger.debug('LipSync updateFrame: ACTIVE', { phonemes: this.phonemeData.length, offset: this.visemeOffsetS.toFixed(2) });
      this.hasLoggedActiveFrame = true;
    }

    // Accumulate time but only recompute visemes at 30fps
    this.visemeOffsetS += delta;
    this.accumulatedDelta += delta;
    if (this.accumulatedDelta < LIPSYNC_FRAME_INTERVAL_S) return;
    this.accumulatedDelta = 0;

    if (this.visemeOffsetS > this.maxPhonemeDuration) {
      logger.warn('VRM Mouth: Max duration exceeded');
      this.resetMouth();
      return;
    }

    // Calculate current viseme data using existing logic
    this.currentVisemeData = this.RPMPhonemDataToViseme(this.visemeOffsetS, this.phonemeData);
    this.applyVisemes();
  }

  private fadeOutMouth(delta: number): void {
    const fadeFactor = Math.min(1.0, delta * 8);

    for (let i = 0; i < this.currentVisemeData.length; i++) {
      this.currentVisemeData[i] = this.lerp(this.currentVisemeData[i], 0, fadeFactor);
    }

    this.applyVisemes();
  }

  // Debug: track if we've logged the first viseme application
  private hasLoggedVisemeApply = false;

  private applyVisemes(): void {
    if (!this.vrm.expressionManager) {
      logger.warn('LipSync: No expressionManager available!');
      return;
    }

    // Log once when visemes have non-zero values
    const hasNonZero = this.currentVisemeData.some(v => v > 0.01);
    if (hasNonZero && !this.hasLoggedVisemeApply) {
      logger.debug('LipSync applyVisemes: Non-zero values', this.currentVisemeData.map(v => v.toFixed(2)));
      this.hasLoggedVisemeApply = true;
    }
    if (!hasNonZero) {
      this.hasLoggedVisemeApply = false;
    }

    // Apply all 5 viseme blend shapes with their calculated intensities
    for (let i = 0; i < 5; i++) {
      const value = this.currentVisemeData[i];

      for (const blendShapeName of VISEME_BLEND_SHAPES[i]) {
        try {
          this.vrm.expressionManager.setValue(blendShapeName, value);
        } catch (e) {
          // Blend shape might not exist in this model
          logger.warn(`LipSync: Failed to set blend shape '${blendShapeName}':`, e);
        }
      }
    }
  }

  /**
   * Hosts that apply expressions after `vrm.update()` should flush the
   * authored VRM viseme expressions once more at the end of the frame. This
   * preserves coordinated lip/teeth/tongue blendshape groups instead of
   * directly poking raw morph targets.
   */
  applyPostUpdateVisemes(): void {
    const active = this.isActive || this.isFadingOut || this.currentVisemeData.some((v) => v > 0.001);
    if (!active) return;
    this.applyVisemes();
    this.vrm.expressionManager?.update();
  }

  stopLipSync(): void {
    logger.debug('LipSync: stopLipSync called');
    // Don't zero currentVisemeData — let fadeOutMouth() handle gradual fade
    // This prevents the mouth snapping from speaking shapes to expression shapes in one frame
    this.phonemeData = [];
    this.visemeOffsetS = 0;
    this.expectedEndTime = 0;
    this.accumulatedDelta = 0;
    this.isActive = false;
    // Only start fade-out if there are non-zero viseme values to fade
    const hasVisemeValues = this.currentVisemeData.some(v => v > 0.01);
    this.isFadingOut = hasVisemeValues;
  }

  /**
   * Check if lip sync is currently active (speaking or fading out).
   * Returns true during fade-out so the expression bridge doesn't
   * immediately override mouth shapes, preventing mouth snap/twitch.
   */
  isLipSyncActive(): boolean {
    return this.isActive || this.isFadingOut;
  }

  resetMouth(): void {
    this.currentVisemeData = [0, 0, 0, 0, 0];
    this.phonemeData = [];
    this.visemeOffsetS = 0;
    this.expectedEndTime = 0;
    this.accumulatedDelta = 0;
    this.isActive = false;
    this.isFadingOut = false;
    this.applyVisemes();
  }

  // ── Audio-reactive fallback ──

  startAudioReactive(audioElement: HTMLAudioElement, audioContext?: AudioContext): void {
    this.stopAudioReactive();
    this.stopExternalAmplitude();

    try {
      const ctx = audioContext ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.audioReactiveContext = audioContext ? null : ctx; // only own it if we created it

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = AUDIO_REACTIVE_FFT_SIZE;
      this.analyser.smoothingTimeConstant = AUDIO_REACTIVE_SMOOTHING;

      this.audioSource = ctx.createMediaElementSource(audioElement);
      this.audioSource.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      this.audioReactiveActive = true;
      this.accumulatedDelta = 0;

      logger.debug('LipSync: Audio-reactive fallback STARTED');
    } catch (e) {
      logger.warn('LipSync: Failed to start audio-reactive fallback:', e);
    }
  }

  stopAudioReactive(): void {
    if (!this.audioReactiveActive && !this.analyser) return;

    try {
      this.audioSource?.disconnect();
      this.analyser?.disconnect();
    } catch { /* already disconnected */ }

    if (this.audioReactiveContext) {
      this.audioReactiveContext.close().catch(() => {});
    }

    this.audioSource = null;
    this.analyser = null;
    this.frequencyData = null;
    this.audioReactiveContext = null;
    this.audioReactiveActive = false;
    this.accumulatedDelta = 0;

    // Fade mouth closed
    this.currentVisemeData = [0, 0, 0, 0, 0];
    this.applyVisemes();
    logger.debug('LipSync: Audio-reactive fallback STOPPED');
  }

  isAudioReactiveActive(): boolean {
    return this.audioReactiveActive;
  }

  private updateAudioReactive(): void {
    if (!this.analyser || !this.frequencyData) return;

    this.analyser.getByteFrequencyData(this.frequencyData);

    let sum = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      sum += this.frequencyData[i];
    }
    const average = sum / this.frequencyData.length;

    this.applyAmplitudeAverage(average);
  }

  // ── External-amplitude mode ──
  //
  // For hosts that already derive a 0..1 speaking level from their own
  // AnalyserNode (e.g. readQueenVoiceAmplitude()) and feed it every frame.
  // No AudioContext or analyser is created in this mode.

  /**
   * Enter external-amplitude mode. The host must call
   * setExternalAmplitude(level) each frame (before updateFrame) with a
   * 0..1 speaking level; the controller maps it onto the same mouth
   * open/close smoothing as audio-reactive mode.
   */
  startExternalAmplitude(): void {
    this.stopAudioReactive();

    this.externalAmplitudeLevel = 0;
    this.externalAmplitudeActive = true;
    this.accumulatedDelta = 0;

    logger.debug('LipSync: External-amplitude mode STARTED');
  }

  /**
   * Feed the current 0..1 speaking amplitude. Values are clamped;
   * non-finite input is treated as 0. Safe to call every frame.
   */
  setExternalAmplitude(level: number): void {
    this.externalAmplitudeLevel = Number.isFinite(level)
      ? Math.max(0, Math.min(1, level))
      : 0;
  }

  stopExternalAmplitude(): void {
    if (!this.externalAmplitudeActive) return;

    this.externalAmplitudeActive = false;
    this.externalAmplitudeLevel = 0;
    this.accumulatedDelta = 0;

    // Fade mouth closed
    this.currentVisemeData = [0, 0, 0, 0, 0];
    this.applyVisemes();
    logger.debug('LipSync: External-amplitude mode STOPPED');
  }

  isExternalAmplitudeActive(): boolean {
    return this.externalAmplitudeActive;
  }

  private updateExternalAmplitude(): void {
    // Scale the 0..1 host level into the analyser byte-average domain so
    // the threshold/dampen/boost constants behave identically to
    // audio-reactive mode.
    this.applyAmplitudeAverage(this.externalAmplitudeLevel * EXTERNAL_AMPLITUDE_SCALE);
  }

  // ── Shared amplitude → mouth mapping (audio-reactive + external) ──

  private applyAmplitudeAverage(average: number): void {
    // Only drive 'aa' (open mouth) — same single-viseme approach as SillyTavern
    // but we keep our multi-viseme array so applyVisemes() still works
    let mouthValue = 0;
    if (average > AUDIO_REACTIVE_THRESHOLD * 2) {
      mouthValue = Math.min(1.0, ((average - AUDIO_REACTIVE_MIN) / AUDIO_REACTIVE_DAMPEN) * AUDIO_REACTIVE_BOOST);
    }

    // Smooth transition
    this.currentVisemeData[0] = this.lerp(this.currentVisemeData[0], mouthValue, 0.3);
    this.currentVisemeData[1] = this.lerp(this.currentVisemeData[1], 0, 0.3);
    this.currentVisemeData[2] = this.lerp(this.currentVisemeData[2], 0, 0.3);
    this.currentVisemeData[3] = this.lerp(this.currentVisemeData[3], 0, 0.3);
    this.currentVisemeData[4] = this.lerp(this.currentVisemeData[4], 0, 0.3);

    this.applyVisemes();
  }

  private lerp(start: number, end: number, factor: number): number {
    return start + (end - start) * factor;
  }
}
