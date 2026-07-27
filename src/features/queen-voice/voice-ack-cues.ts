"use client";

/**
 * Session audio cues for the Queen voice loop, extracted from
 * use-queen-bee-voice.ts:
 * - the pre-synthesized "On it. Give me a moment." acknowledgment clip played
 *   on slow turns (fetched once on the session's voice, decoded and cached),
 * - the soft descending blip that marks replies going text-only while the
 *   selected voice server is unreachable.
 * All playback is scoped to the session's AbortSignal.
 */

export const ACK_CLIP_TEXT = "On it. Give me a moment.";

export type VoiceAckCues = {
  /** Fetch + decode the ack clip if not cached yet (re-invokable until a clip
   *  in the RIGHT voice is cached; see the wav guard). */
  fetchAckClip: () => Promise<void>;
  /** Play the cached ack clip; no-ops when uncached/already playing. */
  playAckClip: () => void;
  /** Resolves when any in-flight ack playback finishes (immediately if none). */
  waitForAckPlayback: () => Promise<void>;
  /** True while the ack clip is audible. */
  ackPlaying: () => boolean;
  /** Cut an ack that only just began (<350ms) — the reply's first speech
   *  arrived and "On it" must not play back-to-back with it; one that is
   *  mid-sentence finishes (cutting a word is worse than a beat of overlap). */
  cancelPendingAck: () => void;
  /** One soft descending blip: replies just went text-only. */
  playVoiceMutedCue: () => void;
};

export function createVoiceAckCues(opts: {
  signal: AbortSignal;
  getContext: () => AudioContext | null;
  /** A local voice is selected — only a local (WAV) ack clip may be cached; an
   *  OpenAI mp3 fetched during a TTS-server flap would ack in a different
   *  voice for the whole session. */
  isLocalVoiceSelected: () => boolean;
}): VoiceAckCues {
  const { signal, getContext } = opts;
  let ackBuffer: AudioBuffer | null = null;
  let ackPlayback: Promise<void> | null = null;
  let ackFetchInFlight = false;
  let cancelAckPlayback: (() => void) | null = null;
  let ackStartedAtMs = 0;

  const fetchAckClip = async () => {
    if (signal.aborted || ackBuffer || ackFetchInFlight) return;
    ackFetchInFlight = true;
    try {
      const response = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "speak", text: ACK_CLIP_TEXT }),
        cache: "no-store",
        signal,
      });
      if (signal.aborted || !response.ok) return;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("audio/")) return;
      if (opts.isLocalVoiceSelected() && !contentType.includes("wav")) return;
      const encoded = await response.arrayBuffer();
      const context = getContext();
      if (signal.aborted || !context) return;
      ackBuffer = await context.decodeAudioData(encoded);
    } catch {
      // No ack clip; the turn still resolves normally, just without the cue.
    } finally {
      ackFetchInFlight = false;
    }
  };

  const playAckClip = () => {
    const context = getContext();
    if (!ackBuffer || !context || context.state !== "running" || ackPlayback)
      return;
    const buffer = ackBuffer;
    ackPlayback = new Promise<void>((resolvePlayback) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const stop = () => {
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
        resolvePlayback();
      };
      signal.addEventListener("abort", stop, { once: true });
      source.onended = () => {
        signal.removeEventListener("abort", stop);
        cancelAckPlayback = null;
        resolvePlayback();
      };
      ackStartedAtMs = performance.now();
      cancelAckPlayback = stop;
      source.start();
    }).finally(() => {
      ackPlayback = null;
      cancelAckPlayback = null;
    });
  };

  const cancelPendingAck = () => {
    if (cancelAckPlayback && performance.now() - ackStartedAtMs < 350) {
      cancelAckPlayback();
      cancelAckPlayback = null;
    }
  };

  // One soft descending blip when replies go text-only (selected voice
  // unreachable) — synthesized on the session context, no asset needed.
  const playVoiceMutedCue = () => {
    const context = getContext();
    if (!context || context.state !== "running") return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.24);
    } catch {
      // The cue is best-effort.
    }
  };

  return {
    fetchAckClip,
    playAckClip,
    waitForAckPlayback: () => ackPlayback ?? Promise.resolve(),
    ackPlaying: () => ackPlayback !== null,
    cancelPendingAck,
    playVoiceMutedCue,
  };
}
