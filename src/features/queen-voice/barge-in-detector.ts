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
//
// Onset-coincidence guard: a resume-recalibration window absorbs every frame
// into the floor, so a user who starts talking exactly as a new sentence's
// audio resumes gets blended into the echo floor and latched deaf. Once her
// bleed for this reply is ESTABLISHED (peakFloor risen meaningfully above the
// initial estimate), a resume window absorbs only frames at or below her bleed
// ceiling (max(minRms, peakFloor * guardMultiplier)); a frame louder than any
// bleed she has produced is provably the user, so it is let through to the
// trigger path and breaks in mid-window. The guard is GATED on establishment:
// a first-chunk resume with no prior bleed reference (silent grace, or synth
// TTFB > graceMs) falls back to today's unconditional absorb, so her own
// resumed bleed can never be mistaken for the user and self-interrupt.

export const BARGE_IN_TUNING = {
  /** Absolute floor: below this, never treat mic energy as barge-in. */
  minRms: 0.045,
  /** Speech must exceed the measured echo floor by this factor. */
  echoMultiplier: 2.75,
  /** Sustained speech required before interrupting playback. */
  sustainMs: 420,
  /** Unconditional echo-calibration window at playback start. */
  graceMs: 600,
  /**
   * Calibration window after a playback gap resumes. Anchored at the audio
   * RESUME (onFirstByte), not the chunk seam, so it only needs to cover the
   * bleed onset transient — kept short so it does not blanket the rest of a
   * sentence and suppress a genuine barge-in (2026-07-04: 1000ms windows,
   * fired at every chunk seam, made her un-interruptible).
   */
  recalibrateMs: 600,
  /** Floor adaptation rate during the grace window. */
  calibrationBlend: 0.2,
  /** Floor adaptation rate for frames below the trigger threshold. */
  floorBlendBelow: 0.12,
  /** Tiny upward drift for frames above the threshold (pre-trigger). */
  floorBlendAbove: 0.004,
  /** Starting echo-floor estimate before any calibration frames. */
  initialFloor: 0.015,
  /**
   * Onset-coincidence guard. During an ESTABLISHED-bleed resume window, a frame
   * is absorbed only if it is at or below max(minRms, peakFloor * this) — the
   * ceiling of any bleed she has produced this reply. Louder frames are the
   * user and fall through to the trigger path. Headroom above 1 covers her own
   * resume onset transient (briefly louder than steady bleed) without letting
   * it accumulate sustain; kept below echoMultiplier so a passed frame can
   * still reach the trigger threshold.
   */
  guardMultiplier: 1.8,
  /**
   * Bleed is "established" once peakFloor rises at least this factor above
   * initialFloor. Below it the onset-coincidence guard is disabled and the
   * resume window falls back to unconditional absorb — a silent grace or a
   * first chunk after a slow synth never has a bleed reference, so any
   * amplitude discriminator there would let her resumed bleed self-trigger.
   */
  establishedFloorRatio: 1.6,
} as const;

export type BargeInDetectorState = {
  startedAtMs: number;
  echoFloor: number;
  /** Loudest echo floor seen this reply — the ceiling of her observed bleed. */
  peakFloor: number;
  /** Timestamp when candidate speech started; 0 when below threshold. */
  speechSinceMs: number;
  /** Calibration window end (initial grace, or after a playback gap). */
  calibrateUntilMs: number;
  /**
   * Whether the current recalibration window applies the peak-keyed guard.
   * Latched per window at requestBargeInRecalibration time: true only once her
   * bleed is established, so the initial grace and a no-reference first-chunk
   * resume stay unconditional-absorb.
   */
  guardActiveWindow: boolean;
  triggered: boolean;
};

export function createBargeInDetector(nowMs: number): BargeInDetectorState {
  return {
    startedAtMs: nowMs,
    echoFloor: BARGE_IN_TUNING.initialFloor,
    peakFloor: BARGE_IN_TUNING.initialFloor,
    speechSinceMs: 0,
    calibrateUntilMs: nowMs + BARGE_IN_TUNING.graceMs,
    guardActiveWindow: false,
    triggered: false,
  };
}

/**
 * Her bleed for this reply has been observed loud enough to key the guard off.
 * A silent grace or the initial estimate leaves peakFloor at initialFloor, so
 * this stays false and the guard falls back to unconditional absorb.
 */
function bleedEstablished(state: BargeInDetectorState) {
  return (
    state.peakFloor >=
    BARGE_IN_TUNING.initialFloor * BARGE_IN_TUNING.establishedFloorRatio
  );
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
  // Latch the guard decision for this window. Only a window opened after her
  // bleed is established can let a louder-than-any-bleed frame (the user) break
  // in mid-window; before establishment we absorb unconditionally so a resumed
  // bleed with no reference (first chunk / slow synth) cannot self-interrupt.
  state.guardActiveWindow = bleedEstablished(state);
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
    // Peak-keyed guard: in an established-bleed resume window, a frame louder
    // than any bleed she has produced is provably the user — do not absorb it;
    // fall through to the trigger path so a barge-in coinciding with a new
    // sentence's onset still breaks in mid-window. Her bleed (and the whole
    // initial grace / unestablished first-chunk window) is absorbed as before.
    const guardBar = Math.max(
      BARGE_IN_TUNING.minRms,
      state.peakFloor * BARGE_IN_TUNING.guardMultiplier,
    );
    if (!(state.guardActiveWindow && rms >= guardBar)) {
      state.echoFloor =
        state.echoFloor * (1 - BARGE_IN_TUNING.calibrationBlend) +
        rms * BARGE_IN_TUNING.calibrationBlend;
      if (state.echoFloor > state.peakFloor) state.peakFloor = state.echoFloor;
      state.speechSinceMs = 0;
      return state;
    }
    // Louder than her bleed ceiling — evaluate it as candidate speech below.
  }
  const threshold = bargeInThreshold(state);
  if (rms >= threshold) {
    state.echoFloor =
      state.echoFloor * (1 - BARGE_IN_TUNING.floorBlendAbove) +
      rms * BARGE_IN_TUNING.floorBlendAbove;
    if (state.echoFloor > state.peakFloor) state.peakFloor = state.echoFloor;
    if (!state.speechSinceMs) state.speechSinceMs = nowMs;
    if (nowMs - state.speechSinceMs >= BARGE_IN_TUNING.sustainMs) {
      state.triggered = true;
    }
  } else {
    state.echoFloor =
      state.echoFloor * (1 - BARGE_IN_TUNING.floorBlendBelow) +
      rms * BARGE_IN_TUNING.floorBlendBelow;
    if (state.echoFloor > state.peakFloor) state.peakFloor = state.echoFloor;
    state.speechSinceMs = 0;
  }
  return state;
}
