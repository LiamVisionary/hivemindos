/**
 * Spoken-reply playback ladder for the Queen voice overlay, per reply or per
 * sentence chunk: streamed local-TTS PCM into the shared worklet player, then
 * the buffered `speak` clip, then browser speech synthesis — with the
 * voice-continuity rule that a selected LOCAL voice is never substituted
 * (reply goes text-only "muted" instead). Extracted from
 * use-queen-bee-voice.ts, which orchestrates turns around these primitives.
 */

import { playRealtimePcmStream } from "@/lib/audio/realtime-pcm-stream-player";

// Local TTS streaming: a small jitter buffer keeps first audio fast; the
// worklet queue absorbs the rest (underruns degrade to brief pauses, not
// failures). If nothing arrives by the deadline the request is abandoned for
// the buffered/cloud fallback, so a wedged TTS server cannot hold a turn in
// silence. A stream that dies after this much audio has been scheduled
// finishes what it has instead of re-speaking from the top.
const LOCAL_TTS_START_BUFFER_MS = 140;
const LOCAL_TTS_FIRST_AUDIO_TIMEOUT_MS = 15_000;
const LOCAL_TTS_ACCEPT_STREAM_ERROR_AFTER_MS = 2_000;
// speechSynthesis silently no-ops in some webviews; if speech has not started
// by this deadline, report the reply as unplayable instead of pretending.
const BROWSER_SYNTH_START_TIMEOUT_MS = 4_000;

/** Mutable per-reply playback signals shared with the barge-in watcher. */
export type PlaybackActivity = { underrunAt: number };

type StreamedPlaybackResult = "played" | "partial" | "none";

// Returns true only when speech audibly started (some webviews expose the API
// but never speak; an abort mid-speech still counts as played).
async function speakWithBrowserSynthesis(
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (typeof speechSynthesis === "undefined") return false;
  return await new Promise<boolean>((resolvePlayback) => {
    let spoke = false;
    let settled = false;
    let startTimer = 0;
    const settle = (played: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimer);
      resolvePlayback(played);
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onstart = () => {
      spoke = true;
    };
    utterance.onend = () => settle(spoke);
    utterance.onerror = () => settle(spoke);
    startTimer = window.setTimeout(() => {
      if (!spoke) {
        speechSynthesis.cancel();
        settle(false);
      }
    }, BROWSER_SYNTH_START_TIMEOUT_MS);
    signal.addEventListener(
      "abort",
      () => {
        speechSynthesis.cancel();
        // The turn is over; do not report an aborted reply as a failure.
        settle(true);
      },
      { once: true },
    );
    speechSynthesis.speak(utterance);
  });
}

// Local-TTS streaming playback: request the PCM frame stream and feed it to
// the shared jitter-buffered worklet player (the same engine local TTS calls
// use) on the already-running VAD AudioContext, so audio starts well under a
// second after the server's first frame and chunk seams/underruns are handled.
// Returns "none" on any miss (409 when local TTS isn't selected, app down, no
// audio before the deadline, blocked audio output) so the caller falls back to
// the buffered path; "partial" when the stream died after real audio played.
async function playStreamedLocalTts(
  text: string,
  signal: AbortSignal,
  context: AudioContext,
  activity?: PlaybackActivity,
): Promise<StreamedPlaybackResult> {
  const startedAt = Date.now();
  // The request lives on its own controller so the first-audio deadline can
  // abandon a wedged request without touching the session signal.
  const requestAbort = new AbortController();
  const onSessionAbort = () => requestAbort.abort();
  signal.addEventListener("abort", onSessionAbort, { once: true });
  let sawFirstByte = false;
  const firstAudioTimer = window.setTimeout(() => {
    if (!sawFirstByte) requestAbort.abort();
  }, LOCAL_TTS_FIRST_AUDIO_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "speak-stream", text }),
        cache: "no-store",
        signal: requestAbort.signal,
      });
    } catch {
      return signal.aborted ? "played" : "none";
    }
    if (signal.aborted) return "played";
    const streamOpenMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !response.body || contentType.includes("json")) return "none";
    try {
      const playback = await playRealtimePcmStream(response, {
        channels: 1,
        sampleRate: 24_000,
        context,
        signal,
        startedAt,
        startBufferMs: LOCAL_TTS_START_BUFFER_MS,
        acceptErrorAfterMs: LOCAL_TTS_ACCEPT_STREAM_ERROR_AFTER_MS,
        onFirstByte: () => {
          sawFirstByte = true;
          window.clearTimeout(firstAudioTimer);
        },
        onUnderrun: () => {
          // Playback gap: her voice stops bleeding into the mic, so the
          // barge-in watcher must recalibrate its echo floor around it.
          if (activity) activity.underrunAt = Date.now();
        },
      });
      // Playback-side latency beacon, joined with the server-side stage
      // timings in the shared telemetry log for end-to-end diagnosis. Sent
      // for aborted/partial playback too - those are the turns worth
      // diagnosing.
      void fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "speak-metrics",
          ok: !playback.streamErrorAccepted,
          streamOpenMs,
          firstByteMs: playback.firstByteMs,
          firstAudioMs: playback.firstAudioMs,
          playedMs: playback.playedMs,
          underruns: playback.underruns,
          underrunMs: playback.underrunMs,
          aborted: signal.aborted,
          partial: playback.streamErrorAccepted,
        }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
      if (signal.aborted) return "played";
      if (playback.playedMs <= 0) return "none";
      return playback.streamErrorAccepted ? "partial" : "played";
    } catch {
      // Connect failure (blocked output), pre-audio stream death, or the
      // first-audio watchdog firing: let the buffered path speak instead.
      return signal.aborted ? "played" : "none";
    }
  } finally {
    window.clearTimeout(firstAudioTimer);
    signal.removeEventListener("abort", onSessionAbort);
  }
}

export type SpokenReplyOutcome =
  | "local-stream"
  | "local-stream-partial"
  | "buffered"
  | "browser"
  | "muted"
  | "none";

// WKWebView's autoplay policy blocks `new Audio().play()` without a user
// gesture, so replies are decoded and played through the already-running VAD
// AudioContext instead (the same approach the agent call modal relies on).
// Returns how the reply was voiced; "none" means every path failed and the
// user heard nothing.
export async function playSpokenReply(
  text: string,
  signal: AbortSignal,
  context: AudioContext | null,
  streamLocalTts = false,
  activity?: PlaybackActivity,
): Promise<SpokenReplyOutcome> {
  // Local TTS: stream frames for sub-second first audio; on any miss (not
  // local-tts, app down) fall through to the buffered path below.
  if (streamLocalTts && context) {
    const streamed = await playStreamedLocalTts(text, signal, context, activity)
      .catch(() => "none" as const);
    if (streamed === "partial") return "local-stream-partial";
    if (streamed === "played" || signal.aborted) return "local-stream";
  }
  let response: Response | null = null;
  try {
    response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "speak", text }),
      cache: "no-store",
      signal,
    });
  } catch {
    response = null;
  }
  if (signal.aborted) return "buffered";
  if (
    !response?.ok ||
    !response.headers.get("content-type")?.includes("audio/") ||
    !context
  ) {
    // Voice continuity: when the user's selected LOCAL voice is unreachable
    // the server reports the outage instead of substituting a cloud voice.
    // Honor it — no browser synthesis either (that's a third stranger's
    // voice); the reply stays on screen and the voice auto-recovers.
    if (response && !response.headers.get("content-type")?.includes("audio/")) {
      const payload = (await response.json().catch(() => null)) as {
        voiceUnavailable?: boolean;
      } | null;
      if (payload?.voiceUnavailable) return "muted";
    }
    // Voice continuity: with a local voice selected, never substitute the
    // browser voice (a third stranger's voice) — the reply stays as text and
    // the outage notice explains it, same as the server's voiceUnavailable.
    if (streamLocalTts) return "muted";
    return (await speakWithBrowserSynthesis(text, signal)) ? "browser" : "none";
  }
  try {
    const encoded = await response.arrayBuffer();
    if (signal.aborted) return "buffered";
    const buffer = await context.decodeAudioData(encoded);
    if (signal.aborted) return "buffered";
    await context.resume().catch(() => undefined);
    if (context.state !== "running") {
      // A suspended context renders nothing and `onended` never fires — this
      // path used to hang here until the session closed. Speak audibly instead
      // (text-only for local voices — continuity over a substitute voice).
      if (streamLocalTts) return "muted";
      return (await speakWithBrowserSynthesis(text, signal)) ? "browser" : "none";
    }
    await new Promise<void>((resolvePlayback) => {
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
      source.onended = () => resolvePlayback();
      source.start();
    });
    return "buffered";
  } catch {
    if (streamLocalTts) return "muted";
    return (await speakWithBrowserSynthesis(text, signal)) ? "browser" : "none";
  }
}
