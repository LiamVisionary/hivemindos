"use client";

/**
 * Client-side energy VAD loop — used where the transcription session cannot
 * run server-side turn detection (env-forced gpt-realtime-whisper sessions,
 * and the MediaRecorder + Whisper fallback). Detects sustained mic energy
 * over an adaptive noise floor, calls onCommit at end of speech, and discards
 * an utterance the user muted away mid-sentence.
 *
 * The loop runs on requestAnimationFrame with a low-frequency timer backstop:
 * WKWebView starves rAF for seconds while the page idles, which used to
 * freeze end-of-speech detection until a click/tap woke rAF back up.
 */

export const VAD_MIN_UTTERANCE_MS = 300;
export const VAD_COMMIT_SILENCE_MS = 600;
/** Hard cap so steady background noise cannot hold a turn open forever. */
export const VAD_MAX_UTTERANCE_MS = 20_000;
const BACKSTOP_INTERVAL_MS = 33;
const RAF_STALL_MS = 66;

export type EnergyVadHandlers = {
  /** False ends the loop (turn superseded, session torn down). */
  isActive: () => boolean;
  /** Current mic RMS in 0..1; return 0 while muted. */
  readRms: () => number;
  isMuted: () => boolean;
  onSpeechStart?: () => void;
  /** Speech-visibility edge for the UI (listening dot, captions). */
  onSpeechDetected: (detected: boolean) => void;
  /** A mid-utterance mute threw the fragment away. */
  onSpeechDiscarded?: () => void;
  onCommit: () => void;
  /** Return true to end the loop from an idle stretch (no speech yet). */
  onIdle?: (idleMs: number) => boolean;
};

/**
 * Starts the loop; returns a stop function (idempotent) for teardown. The
 * loop also ends itself when isActive() goes false, when onCommit fires, or
 * when onIdle returns true.
 */
export function startEnergyVadLoop(
  handlers: EnergyVadHandlers,
  initialNoiseFloor: number,
): () => void {
  const startedAt = performance.now();
  let speechStartedAt = 0;
  let lastSpeechAt = 0;
  let noiseFloor = initialNoiseFloor;
  let frame = 0;
  let lastTickAt = performance.now();
  let stopped = false;
  // One VAD pass. Returns false once the loop is over so both the rAF loop
  // and the timer backstop stop rescheduling.
  const runTick = (): boolean => {
    if (stopped || !handlers.isActive()) return false;
    lastTickAt = performance.now();
    const now = lastTickAt;
    const rms = handlers.readRms();
    if (handlers.isMuted() && speechStartedAt) {
      // Muting mid-utterance discards it instead of committing a fragment.
      speechStartedAt = 0;
      lastSpeechAt = 0;
      handlers.onSpeechDetected(false);
      handlers.onSpeechDiscarded?.();
    }
    const threshold = Math.max(0.018, noiseFloor * 3);
    // Down-adaptation matches the barge-in detector's cadence (12% —
    // 0.96/0.04 took ~500ms to converge); marginal above-threshold frames
    // drift the floor UP slightly so hovering room noise cannot pin the
    // silence timer indefinitely (mirrors floorBlendAbove).
    if (rms < threshold) noiseFloor = noiseFloor * 0.88 + rms * 0.12;
    else if (rms < noiseFloor * 4.5)
      noiseFloor = noiseFloor * 0.996 + rms * 0.004;
    if (rms >= threshold) {
      if (!speechStartedAt) {
        speechStartedAt = now;
        handlers.onSpeechDetected(true);
        handlers.onSpeechStart?.();
      }
      lastSpeechAt = now;
    }
    const utteranceMs = speechStartedAt ? now - speechStartedAt : 0;
    const silenceMs = lastSpeechAt ? now - lastSpeechAt : 0;
    if (
      (speechStartedAt &&
        utteranceMs > VAD_MIN_UTTERANCE_MS &&
        silenceMs > VAD_COMMIT_SILENCE_MS) ||
      utteranceMs > VAD_MAX_UTTERANCE_MS
    ) {
      handlers.onCommit();
      return false;
    }
    if (!speechStartedAt && handlers.onIdle?.(now - startedAt)) return false;
    return true;
  };
  const stop = () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    window.clearInterval(backstopId);
  };
  const tick = () => {
    if (runTick()) frame = window.requestAnimationFrame(tick);
    else stop();
  };
  // Timer backstop, same defense as the barge-in watcher: it only does work
  // when rAF has visibly stalled, so it is a no-op cost while rAF is healthy.
  const backstopId = window.setInterval(() => {
    if (performance.now() - lastTickAt <= RAF_STALL_MS) return;
    if (!runTick()) stop();
  }, BACKSTOP_INTERVAL_MS);
  frame = window.requestAnimationFrame(tick);
  return stop;
}
