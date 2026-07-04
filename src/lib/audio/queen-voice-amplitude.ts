"use client";

import * as React from "react";

/**
 * Shared "how loud is the Queen speaking right now" channel.
 *
 * The Queen's voice plays through several output paths — pipeline TTS (a
 * streamed worklet player and buffered clips) on the mic session's shared
 * AudioContext, and the OpenAI Realtime WebRTC stream on a bare <audio>
 * element. None of them exposed a live level before this module. Here we:
 *   (a) attach AnalyserNodes to her OUTPUT audio (not the mic — the mic
 *       analysers already in the voice hooks measure barge-in, the wrong side),
 *   (b) run an envelope-following RMS meter while she speaks, and
 *   (c) publish a single 0..1 `level` + `speaking` flag through an imperative
 *       singleton so any view (the fleet graph particle sphere, the hive Queen
 *       cell) can react at 60fps WITHOUT going through React state.
 *
 * The imperative channel is deliberate: a per-frame setState would re-render the
 * whole fleet tree (AgentsPanel is memoized precisely to dodge the voice
 * waveform). Consumers either poll `readQueenVoiceAmplitude()` inside a loop
 * they already run (the graph canvas) or use `useQueenVoicePulse` to drive a
 * DOM node imperatively.
 */

// ---- the imperative 0..1 channel -----------------------------------------

let currentLevel = 0;
let currentSpeaking = false;
let lastLevelAt = 0;

// Past this, a published level is treated as silence — guards against a pump
// that was torn down without a final zero write leaving a stuck glow.
const LEVEL_STALE_MS = 180;

const SPEAKING_EVENT = "hivemindos:queen-voice-speaking";

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Current voice-reactive amplitude. `level` reads 0 whenever she isn't
 *  speaking or the last sample has gone stale. */
export function readQueenVoiceAmplitude(): { speaking: boolean; level: number } {
  if (!currentSpeaking) return { speaking: false, level: 0 };
  if (nowMs() - lastLevelAt > LEVEL_STALE_MS) return { speaking: true, level: 0 };
  return { speaking: true, level: currentLevel };
}

/** Push a new 0..1 amplitude sample (called by the pump each animation frame). */
export function publishQueenVoiceLevel(level: number) {
  currentLevel = level < 0 ? 0 : level > 1 ? 1 : level;
  lastLevelAt = nowMs();
}

/** Flip the coarse speaking flag; broadcasts only on an actual edge so idle
 *  cost stays at a single event dispatch per turn. */
export function setQueenVoiceSpeaking(speaking: boolean) {
  if (speaking === currentSpeaking) return;
  currentSpeaking = speaking;
  if (!speaking) currentLevel = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SPEAKING_EVENT, { detail: { speaking } }));
  }
}

/** Subscribe to speaking on/off edges. The callback is NOT invoked on
 *  subscribe — read `readQueenVoiceAmplitude()` for the current value. Returns
 *  an unlisten function. */
export function subscribeQueenVoiceSpeaking(onChange: (speaking: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ speaking?: boolean }>).detail;
    onChange(Boolean(detail?.speaking));
  };
  window.addEventListener(SPEAKING_EVENT, handle);
  return () => window.removeEventListener(SPEAKING_EVENT, handle);
}

// ---- tapping her OUTPUT audio for a real level ---------------------------

// One analyser per AudioContext: the pipeline paths (worklet TTS, buffered
// clips) all share the mic session's context, so a single side-tapped analyser
// on it sees every pipeline output node that connects into it.
const analyserByContext = new WeakMap<BaseAudioContext, AnalyserNode>();

export function getQueenOutputAnalyser(context: BaseAudioContext): AnalyserNode {
  let analyser = analyserByContext.get(context);
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    analyserByContext.set(context, analyser);
  }
  return analyser;
}

/**
 * Side-tap a queen-output node into the shared analyser. Analysis only: the
 * node keeps its real connection to the destination for actual playback, and
 * the analyser has no downstream connection — it still receives data because
 * its upstream (a node already routed to the destination) is being pulled.
 */
export function tapQueenOutput(node: AudioNode, context: BaseAudioContext) {
  try {
    node.connect(getQueenOutputAnalyser(context));
  } catch {
    // A node may already be disconnected/ended by the time we tap it.
  }
}

function getAudioContextClass() {
  if (typeof window === "undefined") return undefined;
  const audioWindow = window as Window &
    typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return audioWindow.AudioContext || audioWindow.webkitAudioContext;
}

/**
 * The Realtime path plays through a bare <audio> element fed a MediaStream, off
 * any AudioContext. To measure it we build a dedicated analysis-only context:
 *   stream -> source -> analyser -> silent gain -> destination.
 * The zero gain keeps the graph "pulled" (some WebKit builds won't process an
 * analyser that has no path to the destination) while staying silent — the
 * <audio> element remains the thing you actually hear. Returns null if Web
 * Audio is unavailable or the context is blocked.
 */
export function createStreamOutputAnalyser(
  stream: MediaStream,
): { analyser: AnalyserNode; dispose: () => void } | null {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) return null;
  try {
    const context = new AudioContextClass();
    void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silent);
    silent.connect(context.destination);
    return {
      analyser,
      dispose: () => {
        try {
          source.disconnect();
          analyser.disconnect();
          silent.disconnect();
        } catch {
          // Nodes may already be detached.
        }
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}

// ---- the source pump: analyser -> enveloped 0..1 -> channel ---------------

// Scale raw time-domain RMS (speech peaks land around 0.1-0.25) up into a
// usable 0..1 range.
const LEVEL_GAIN = 3.6;
// Fast attack so onsets "pop" on the beat; slower release so syllables and
// cadence read as a smooth breathe instead of a strobe.
const ATTACK = 0.55;
const RELEASE = 0.14;
// A 30Hz timer backstops rAF through WKWebView's idle-page rAF starvation —
// the same defense the barge-in watcher uses. It only does real work once rAF
// has visibly stalled, so it's a no-op cost while rAF is healthy.
const BACKSTOP_MS = 33;
const RAF_STALL_MS = 64;

function readAnalyserRms(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const normalized = (buffer[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * While `active` (she's in the speaking phase), run an rAF loop that reads her
 * output analyser, envelope-follows the RMS, and publishes the 0..1 level +
 * speaking flag. On stop it publishes 0 and clears the flag. `analyserRef` is
 * read at effect start; wire it up before she can reach the speaking phase.
 */
export function useQueenVoiceLevelPump(
  analyserRef: React.RefObject<AnalyserNode | null>,
  active: boolean,
) {
  React.useEffect(() => {
    if (!active) return undefined;
    const analyser = analyserRef.current;
    if (!analyser) return undefined;
    const buffer = new Uint8Array(analyser.fftSize);
    let level = 0;
    let raf = 0;
    let lastTickAt = nowMs();
    setQueenVoiceSpeaking(true);
    const tick = () => {
      lastTickAt = nowMs();
      const rms = readAnalyserRms(analyser, buffer);
      const target = Math.min(1, rms * LEVEL_GAIN);
      level += (target - level) * (target > level ? ATTACK : RELEASE);
      publishQueenVoiceLevel(level);
    };
    const loop = () => {
      raf = window.requestAnimationFrame(loop);
      if (typeof document !== "undefined" && document.hidden) return;
      tick();
    };
    raf = window.requestAnimationFrame(loop);
    const backstop = window.setInterval(() => {
      if (nowMs() - lastTickAt <= RAF_STALL_MS) return; // rAF healthy
      tick();
    }, BACKSTOP_MS);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(backstop);
      setQueenVoiceSpeaking(false);
      publishQueenVoiceLevel(0);
    };
  }, [analyserRef, active]);
}

/**
 * Sink helper: imperatively pulse a DOM node to her voice WITHOUT React state.
 * While she speaks, writes `--queen-amp` (0..1) on the node every frame and
 * marks it `data-voice="speaking"`; on stop, resets to 0. The rAF only runs
 * while she is actually speaking, so idle cost is a single event listener.
 */
export function useQueenVoicePulse<T extends HTMLElement>(
  nodeRef: React.RefObject<T | null>,
) {
  React.useEffect(() => {
    let raf = 0;
    let backstop = 0;
    let running = false;
    const apply = () => {
      const node = nodeRef.current;
      if (!node) return;
      const { speaking, level } = readQueenVoiceAmplitude();
      if (speaking) {
        node.dataset.voice = "speaking";
        node.style.setProperty("--queen-amp", level.toFixed(3));
      } else {
        delete node.dataset.voice;
        node.style.setProperty("--queen-amp", "0");
      }
    };
    const loop = () => {
      raf = window.requestAnimationFrame(loop);
      if (typeof document !== "undefined" && document.hidden) return;
      apply();
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = window.requestAnimationFrame(loop);
      backstop = window.setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        apply();
      }, BACKSTOP_MS);
    };
    const stop = () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.clearInterval(backstop);
      apply(); // final reset to baseline
    };
    const unsubscribe = subscribeQueenVoiceSpeaking((speaking) => {
      if (speaking) start();
      else stop();
    });
    // Catch a session that is already speaking when this node mounts.
    if (readQueenVoiceAmplitude().speaking) start();
    return () => {
      unsubscribe();
      stop();
    };
  }, [nodeRef]);
}
