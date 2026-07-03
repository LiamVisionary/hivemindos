// Barge-in detection with an adaptive echo floor.
//
// Problem: while Queen Bee speaks, her own audio bleeds from the speakers into
// the microphone. Browser echo cancellation attenuates it but not reliably to
// zero (WKWebView AEC vs AudioWorklet output), so a fixed energy threshold
// self-interrupts her playback ("the voice playback will interrupt it",
// 2026-07-02). Fix: measure the mic's residual-echo level DURING her playback
// and only call it barge-in when the mic runs well above that floor for a
// sustained stretch — the user talking over her is loud relative to echo;
// her own bleed is the floor itself.
//
// Detection lifecycle per spoken reply:
// - grace window: calibrate the echo floor unconditionally, never trigger
//   (also skips the reply's onset transient).
// - after grace: frames below the trigger threshold keep adapting the floor
//   quickly (tracks her volume envelope down through pauses); frames above it
//   drift the floor up only slightly (so rising echo eventually re-calibrates,
//   but genuine speech is not absorbed before the sustain window fires).
// - trigger: sustained energy >= max(minRms, echoFloor * echoMultiplier).

export const BARGE_IN_TUNING = {
  /** Absolute floor: below this, never treat mic energy as barge-in. */
  minRms: 0.045,
  /** Speech must exceed the measured echo floor by this factor. */
  echoMultiplier: 2.75,
  /** Sustained speech required before interrupting playback. */
  sustainMs: 420,
  /** Unconditional echo-calibration window at playback start. */
  graceMs: 600,
  /** Calibration window after a playback gap resumes (see recalibration). */
  recalibrateMs: 1_000,
  /** Floor adaptation rate during the grace window. */
  calibrationBlend: 0.2,
  /** Floor adaptation rate for frames below the trigger threshold. */
  floorBlendBelow: 0.12,
  /** Tiny upward drift for frames above the threshold (pre-trigger). */
  floorBlendAbove: 0.004,
  /** Starting echo-floor estimate before any calibration frames. */
  initialFloor: 0.015,
} as const;

export type BargeInDetectorState = {
  startedAtMs: number;
  echoFloor: number;
  /** Timestamp when candidate speech started; 0 when below threshold. */
  speechSinceMs: number;
  /** Calibration window end (initial grace, or after a playback gap). */
  calibrateUntilMs: number;
  triggered: boolean;
};

export function createBargeInDetector(nowMs: number): BargeInDetectorState {
  return {
    startedAtMs: nowMs,
    echoFloor: BARGE_IN_TUNING.initialFloor,
    speechSinceMs: 0,
    calibrateUntilMs: nowMs + BARGE_IN_TUNING.graceMs,
    triggered: false,
  };
}

/**
 * Re-enter calibration after a playback gap (buffer underrun). During a gap
 * there is no speaker bleed, so the floor decays toward silence; when her
 * voice resumes, the resumed bleed would read as sustained "speech" over that
 * silence floor and self-interrupt. Underrun-driven recalibration keeps the
 * floor honest through stuttery streams.
 */
export function requestBargeInRecalibration(
  state: BargeInDetectorState,
  nowMs: number,
  forMs = BARGE_IN_TUNING.recalibrateMs,
) {
  state.calibrateUntilMs = Math.max(state.calibrateUntilMs, nowMs + forMs);
  state.speechSinceMs = 0;
  return state;
}

export function bargeInThreshold(state: BargeInDetectorState) {
  return Math.max(BARGE_IN_TUNING.minRms, state.echoFloor * BARGE_IN_TUNING.echoMultiplier);
}

/** Feed one mic RMS sample; returns the same state, mutated. */
export function updateBargeInDetector(
  state: BargeInDetectorState,
  rms: number,
  nowMs: number,
): BargeInDetectorState {
  if (state.triggered) return state;
  if (nowMs <= state.calibrateUntilMs) {
    state.echoFloor =
      state.echoFloor * (1 - BARGE_IN_TUNING.calibrationBlend) +
      rms * BARGE_IN_TUNING.calibrationBlend;
    state.speechSinceMs = 0;
    return state;
  }
  const threshold = bargeInThreshold(state);
  if (rms >= threshold) {
    state.echoFloor =
      state.echoFloor * (1 - BARGE_IN_TUNING.floorBlendAbove) +
      rms * BARGE_IN_TUNING.floorBlendAbove;
    if (!state.speechSinceMs) state.speechSinceMs = nowMs;
    if (nowMs - state.speechSinceMs >= BARGE_IN_TUNING.sustainMs) {
      state.triggered = true;
    }
  } else {
    state.echoFloor =
      state.echoFloor * (1 - BARGE_IN_TUNING.floorBlendBelow) +
      rms * BARGE_IN_TUNING.floorBlendBelow;
    state.speechSinceMs = 0;
  }
  return state;
}
