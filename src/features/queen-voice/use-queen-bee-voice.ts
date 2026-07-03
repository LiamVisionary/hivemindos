"use client";

import * as React from "react";
import {
  BARGE_IN_TUNING,
  createBargeInDetector,
  requestBargeInRecalibration,
  updateBargeInDetector,
} from "./barge-in-detector";
import {
  closeRealtimeSttSocket,
  pcm16ToBase64,
  prepareRealtimeSttSession,
  resampleToPcm16,
} from "./realtime-stt";
import { createSentenceChunker } from "@/lib/services/queen-bee/voice-speech-stream";
import {
  createNdjsonEventReader,
  type ConverseStreamEvent,
} from "./converse-stream";
import {
  playSpokenReply,
  type PlaybackActivity,
  type SpokenReplyOutcome,
} from "./spoken-reply-playback";

export type QueenVoicePhase =
  | "starting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type QueenVoiceTurn = {
  id: number;
  who: "you" | "queen";
  text: string;
  live?: boolean;
  /** Richer findings (markdown) Queen Bee pulled, shown in a modal on demand. */
  detail?: string;
};

/** One live stage of the current turn's work (tool call, fleet scan, ...). */
export type QueenVoiceWorkingStage = { label: string; done: boolean };

type VoiceTurnResponse = {
  ok?: boolean;
  transcript?: string;
  reply?: string;
  error?: string;
};

type SttEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
};

const ECHO_CANCELLED_AUDIO: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

const MIN_UTTERANCE_MS = 300;
const COMMIT_SILENCE_MS = 600;
const MAX_UTTERANCE_MS = 20_000;
// Client-side throttle for fire-and-forget TTS prewarm pings (the server
// dedupes too; this just avoids pointless requests every turn).
const LOCAL_TTS_PREWARM_INTERVAL_MS = 45_000;
// Spoken acknowledgment for slow turns: a clip pre-synthesized on the session's
// voice, played when the reply hasn't resolved by the delay — so delegation
// turns answer "On it" within ~1.5s instead of long dead air.
const ACK_CLIP_TEXT = "On it. Give me a moment.";
const ACK_PLAY_DELAY_MS = 1_400;
// Live "what she's doing" chips: poll cadence for the turn-progress endpoint
// while a converse request is in flight.
const TURN_PROGRESS_POLL_MS = 650;
// Barge-in (interrupt Queen mid-reply) uses the adaptive echo-floor detector
// in ./barge-in-detector.ts so her own speaker bleed cannot self-interrupt
// playback; tuning knobs live there (BARGE_IN_TUNING).
// Continuous capture: one session-long mic pump fills a short PCM pre-roll
// ring buffer even while Queen Bee thinks and speaks. When a listening turn
// arms its STT socket, the frames captured while the socket was still opening
// — or the words that just interrupted her — are flushed in first, so turn
// boundaries and barge-ins lose no speech.
const PRE_ROLL_MAX_MS = 5_000;
// Flush window behind a barge-in trigger: the sustain the detector required
// before firing plus a lead for the first syllable's onset.
const BARGE_IN_FLUSH_LOOKBACK_MS = BARGE_IN_TUNING.sustainMs + 480;
// Recorder fallback only: quiet stretches bloat the Whisper upload, so the
// recording restarts when nothing has been said for a while.
const IDLE_RECORDER_RESTART_MS = 10_000;
// Realtime path: flush silently-accumulated server audio while idle.
const IDLE_BUFFER_CLEAR_MS = 12_000;
const ERROR_RESUME_DELAY_MS = 3_500;

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    RECORDER_MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? ""
  );
}

function utteranceFileName(mimeType: string) {
  return mimeType.includes("mp4") ? "utterance.mp4" : "utterance.webm";
}

/**
 * Hands-free Queen Bee voice loop. Preferred path: microphone PCM streams
 * into an OpenAI Realtime transcription session so the user's words appear on
 * screen while they speak; an energy-based VAD commits each utterance and the
 * final transcript goes straight to the conversational Queen Bee turn. When
 * realtime STT is unavailable, falls back to MediaRecorder + Whisper.
 */
export function useQueenBeeVoice(
  active: boolean,
  muted: boolean,
  openingLine = "",
  streamLocalTts = false,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [working, setWorking] = React.useState<QueenVoiceWorkingStage[]>([]);
  // Non-fatal voice status, e.g. "local voice unreachable, replies shown as
  // text" — the session keeps listening while it shows.
  const [voiceNotice, setVoiceNotice] = React.useState("");
  const mutedRef = React.useRef(muted);
  // Read at playback time so the long-lived session effect never goes stale.
  const streamLocalTtsRef = React.useRef(streamLocalTts);
  const streamRef = React.useRef<MediaStream | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    streamLocalTtsRef.current = streamLocalTts;
  }, [streamLocalTts]);

  React.useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let frame = 0;
    let resumeTimer = 0;
    let restartTimer = 0;
    let nextTurnId = 1;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let recorder: MediaRecorder | null = null;
    let recorderChunks: Blob[] = [];
    let sttSocket: WebSocket | null = null;
    let preparedStt: Promise<WebSocket> | null = null;
    let realtimeUnavailable = false;
    // Session-long mic pump state: PCM streams to sttLiveSocket while a
    // listening turn is armed; the pre-roll ring buffer fills the whole time.
    let sttLiveSocket: WebSocket | null = null;
    let pendingFlushSinceMs = 0;
    const preRoll: { at: number; pcm: Int16Array }[] = [];
    const abort = new AbortController();
    const mimeType = pickRecorderMimeType();
    // Finalized turns for this session, sent so Queen Bee keeps conversational context.
    const history: { who: "you" | "queen"; text: string }[] = [];
    const openingText = openingLine.trim();

    const addTurn = (
      who: QueenVoiceTurn["who"],
      text: string,
      live = false,
    ) => {
      const id = nextTurnId;
      nextTurnId += 1;
      setTurns((current) => [
        ...current.map((turn) => ({ ...turn, live: false })),
        { id, who, text, live },
      ]);
      return id;
    };
    const updateTurn = (id: number, text: string, live = false) => {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, text, live } : turn,
        ),
      );
    };
    const dropTurn = (id: number) => {
      setTurns((current) => current.filter((turn) => turn.id !== id));
    };

    const stopRecorder = () => {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be stopping during teardown.
        }
      }
      recorder = null;
      recorderChunks = [];
    };

    const closeSttSocket = () => {
      sttLiveSocket = null;
      closeRealtimeSttSocket(sttSocket);
      sttSocket = null;
    };

    // Replay buffered pre-roll frames captured since `sinceMs` into a freshly
    // armed STT socket, ahead of the live pump taking over.
    const flushPreRollTo = (socket: WebSocket, sinceMs: number) => {
      for (const entry of preRoll) {
        if (entry.at < sinceMs) continue;
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: pcm16ToBase64(entry.pcm),
          }),
        );
      }
    };

    const prepareStt = () => {
      if (realtimeUnavailable) return null;
      if (!preparedStt) {
        preparedStt = prepareRealtimeSttSession().catch((sttError) => {
          preparedStt = null;
          throw sttError;
        });
      }
      return preparedStt;
    };

    const failTurn = (message: string) => {
      if (cancelled) return;
      setPhase("error");
      setError(message);
      resumeTimer = window.setTimeout(() => {
        if (!cancelled) {
          setError("");
          startListening();
        }
      }, ERROR_RESUME_DELAY_MS);
    };

    // Fire-and-forget: ask the server to warm the selected local TTS server
    // (cold model loads measured 5-30s) while the session opens and while the
    // reply is being composed, so speech starts promptly when it's time.
    let lastPrewarmAt = 0;
    const prewarmLocalTtsEngine = () => {
      if (!streamLocalTtsRef.current || cancelled) return Promise.resolve();
      const now = Date.now();
      if (now - lastPrewarmAt < LOCAL_TTS_PREWARM_INTERVAL_MS) return Promise.resolve();
      lastPrewarmAt = now;
      return fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "speak-prewarm" }),
        cache: "no-store",
        signal: abort.signal,
      }).then(() => undefined, () => undefined);
    };

    // Pre-synthesized "On it" clip on the session's voice, decoded once and
    // kept for instant playback on slow turns. Fetched after the prewarm lands
    // so a cold local TTS model is loaded exactly once; re-attempted on later
    // turns until a clip in the RIGHT voice is cached.
    let ackBuffer: AudioBuffer | null = null;
    let ackPlayback: Promise<void> | null = null;
    let ackFetchInFlight = false;
    const fetchAckClip = async () => {
      if (cancelled || ackBuffer || ackFetchInFlight) return;
      ackFetchInFlight = true;
      try {
        const response = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "speak", text: ACK_CLIP_TEXT }),
          cache: "no-store",
          signal: abort.signal,
        });
        if (cancelled || !response.ok) return;
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("audio/")) return;
        // Voice consistency: with a local voice selected, only a local (WAV)
        // clip may be cached — an OpenAI mp3 fetched during a TTS-server flap
        // would ack in a different voice for the whole session.
        if (streamLocalTtsRef.current && !contentType.includes("wav")) return;
        const encoded = await response.arrayBuffer();
        if (cancelled || !audioContext) return;
        ackBuffer = await audioContext.decodeAudioData(encoded);
      } catch {
        // No ack clip; the turn still resolves normally, just without the cue.
      } finally {
        ackFetchInFlight = false;
      }
    };

    // One soft descending blip when replies go text-only (selected voice
    // unreachable) — synthesized on the session context, no asset needed.
    const playVoiceMutedCue = () => {
      const context = audioContext;
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

    // Voice-outage bookkeeping: cue once per outage, clear when speech returns.
    let voiceOutageActive = false;
    const noteVoiceOutage = (
      message = "Her voice server is unreachable, so replies show as text. The voice returns automatically once it's back.",
    ) => {
      if (!voiceOutageActive) {
        voiceOutageActive = true;
        playVoiceMutedCue();
      }
      setVoiceNotice(message);
    };
    const clearVoiceOutage = () => {
      if (!voiceOutageActive) return;
      voiceOutageActive = false;
      setVoiceNotice("");
    };
    const playAckClip = () => {
      const context = audioContext;
      if (!ackBuffer || !context || context.state !== "running" || ackPlayback) return;
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
        abort.signal.addEventListener("abort", stop, { once: true });
        source.onended = () => {
          abort.signal.removeEventListener("abort", stop);
          resolvePlayback();
        };
        source.start();
      }).finally(() => {
        ackPlayback = null;
      });
    };

    // Watch the mic for sustained speech while Queen Bee talks; on barge-in,
    // abort HER playback (not the session) so the turn snaps back to
    // listening. The adaptive echo-floor detector calibrates on her own
    // speaker bleed so residual echo (imperfect AEC) cannot self-interrupt —
    // only mic energy well above that measured floor counts as the user.
    const watchForBargeIn = (
      speakAbort: AbortController,
      playbackSignal: AbortSignal,
      activity: PlaybackActivity,
    ) => {
      if (!analyser) return () => undefined;
      const activeAnalyser = analyser;
      const samples = new Uint8Array(activeAnalyser.fftSize);
      const detector = createBargeInDetector(performance.now());
      let lastUnderrunSeen = 0;
      let frameId = 0;
      const tick = () => {
        if (cancelled || playbackSignal.aborted) return;
        // A playback gap (buffer underrun) silences her speaker bleed; the
        // echo floor must recalibrate around it or the resumed voice would
        // read as the user interrupting.
        if (activity.underrunAt > lastUnderrunSeen) {
          lastUnderrunSeen = activity.underrunAt;
          requestBargeInRecalibration(detector, performance.now());
        }
        // Muted mic: feed zeros so the floor decays but nothing can trigger.
        let rms = 0;
        if (!mutedRef.current) {
          activeAnalyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          rms = Math.sqrt(sum / samples.length);
        }
        updateBargeInDetector(detector, rms, performance.now());
        if (detector.triggered) {
          setSpeechDetected(true);
          // The words that interrupted her are already in the pre-roll ring
          // buffer; hand them to the next listening turn instead of making
          // the user repeat themselves.
          pendingFlushSinceMs = performance.now() - BARGE_IN_FLUSH_LOOKBACK_MS;
          speakAbort.abort();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(frameId);
    };

    // Speak a reply with barge-in armed: playback runs on its own abort scope
    // combined with the session's (AbortSignal.any handles a session that is
    // already aborted), so interrupting her never tears down the mic. The
    // shared activity object lets the watcher see playback gaps live.
    const speakReplyWithBargeIn = async (text: string): Promise<SpokenReplyOutcome> => {
      if (ackPlayback) await ackPlayback;
      const speakAbort = new AbortController();
      const playbackSignal = AbortSignal.any([abort.signal, speakAbort.signal]);
      const activity: PlaybackActivity = { underrunAt: 0 };
      const stopWatching = watchForBargeIn(speakAbort, playbackSignal, activity);
      try {
        return await playSpokenReply(
          text,
          playbackSignal,
          audioContext,
          streamLocalTtsRef.current,
          activity,
        );
      } finally {
        stopWatching();
      }
    };

    // Sentence-streaming playback for one turn: chunks arrive while the model
    // is still writing and play strictly in order through the same fallback
    // ladder as a whole reply (playSpokenReply). ONE barge-in watcher spans
    // the whole turn, and every chunk boundary recalibrates the echo floor the
    // same way an underrun does — otherwise her own resumed voice would read
    // as the user interrupting (the pinned 2026-07-02 regression shape).
    const createChunkSpeaker = (onFirstChunk?: () => void) => {
      const speakAbort = new AbortController();
      const playbackSignal = AbortSignal.any([abort.signal, speakAbort.signal]);
      const activity: PlaybackActivity = { underrunAt: 0 };
      const outcomes: SpokenReplyOutcome[] = [];
      let stopWatching: (() => void) | null = null;
      let generation = 0;
      let attemptAbort = new AbortController();
      let muted = false;
      let chain = Promise.resolve();

      const enqueue = (chunk: string) => {
        // Punctuation-only fragments synthesize to zero bytes, which the
        // server records as a TTS failure and trips the 45s breaker on a
        // healthy engine — never send them.
        if (!/[\p{L}\p{N}]/u.test(chunk)) return;
        const chunkGeneration = generation;
        const attemptSignal = attemptAbort.signal;
        const chunkSignal = AbortSignal.any([playbackSignal, attemptSignal]);
        chain = chain.then(async () => {
          if (cancelled || playbackSignal.aborted || muted) return;
          if (chunkGeneration !== generation) return; // superseded by a reset
          if (!stopWatching) {
            if (ackPlayback) await ackPlayback;
            onFirstChunk?.();
            setPhase("speaking");
            stopWatching = watchForBargeIn(speakAbort, playbackSignal, activity);
          }
          const outcome = await playSpokenReply(
            chunk,
            chunkSignal,
            audioContext,
            streamLocalTtsRef.current,
            activity,
          );
          // A chunk cut by a mid-play reset says nothing about the turn's
          // audibility (an abort reads back as "played"); don't record it.
          if (!attemptSignal.aborted || playbackSignal.aborted) {
            outcomes.push(outcome);
            // Voice continuity: once a chunk goes text-only, the rest of the
            // reply stays on screen instead of re-probing the down server.
            if (outcome === "muted") muted = true;
          }
          // The pause before the next chunk silences her speaker bleed just
          // like an underrun; recalibrate or the watcher self-triggers.
          activity.underrunAt = Date.now();
        });
      };
      // A failed model attempt was superseded: stop its audio mid-word and
      // drop its queued chunks; the fallback attempt starts a new generation.
      const resetAttempt = () => {
        generation += 1;
        attemptAbort.abort();
        attemptAbort = new AbortController();
      };
      // Hard stop for a failed turn: kill current audio and the watcher.
      const stop = () => {
        speakAbort.abort();
        stopWatching?.();
      };
      const end = async () => {
        await chain;
        stopWatching?.();
        return outcomes;
      };
      return {
        enqueue,
        resetAttempt,
        stop,
        end,
        bargeInSignal: speakAbort.signal,
        get interrupted() {
          return speakAbort.signal.aborted;
        },
      };
    };

    // VAD shared by both listening paths. Calls onSpeechDiscarded when a
    // mid-utterance mute throws the fragment away, onCommit at end of speech.
    const startVadLoop = (handlers: {
      isActive: () => boolean;
      onSpeechStart?: () => void;
      onSpeechDiscarded?: () => void;
      onCommit: () => void;
      onIdle?: (idleMs: number) => boolean;
    }) => {
      if (!analyser) return;
      const activeAnalyser = analyser;
      const startedAt = performance.now();
      let speechStartedAt = 0;
      let lastSpeechAt = 0;
      let noiseFloor = 0.012;
      const samples = new Uint8Array(activeAnalyser.fftSize);
      const tick = () => {
        if (cancelled || !handlers.isActive()) return;
        activeAnalyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = mutedRef.current ? 0 : Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (mutedRef.current && speechStartedAt) {
          // Muting mid-utterance discards it instead of committing a fragment.
          speechStartedAt = 0;
          lastSpeechAt = 0;
          setSpeechDetected(false);
          handlers.onSpeechDiscarded?.();
        }
        const threshold = Math.max(0.018, noiseFloor * 3);
        if (rms < threshold) noiseFloor = noiseFloor * 0.96 + rms * 0.04;
        if (rms >= threshold) {
          if (!speechStartedAt) {
            speechStartedAt = now;
            setSpeechDetected(true);
            handlers.onSpeechStart?.();
          }
          lastSpeechAt = now;
        }
        const utteranceMs = speechStartedAt ? now - speechStartedAt : 0;
        const silenceMs = lastSpeechAt ? now - lastSpeechAt : 0;
        if (
          (speechStartedAt &&
            utteranceMs > MIN_UTTERANCE_MS &&
            silenceMs > COMMIT_SILENCE_MS) ||
          utteranceMs > MAX_UTTERANCE_MS
        ) {
          handlers.onCommit();
          return;
        }
        if (!speechStartedAt && handlers.onIdle?.(now - startedAt)) return;
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };

    // Step 2 of every turn: the conversational Queen Bee reply streams in as
    // NDJSON speech events; sentence chunks are spoken while the model is
    // still writing (captions fill live), the canonical reply text lands with
    // the final "done" event, then back to listening.
    const runConverseTurn = async (transcript: string) => {
      setPhase("thinking");
      setSpeechDetected(false);
      // Warm the TTS model while the reply is being composed; once warm,
      // retry the ack-clip cache if it still isn't in the right voice.
      void prewarmLocalTtsEngine().then(() => {
        if (!cancelled) void fetchAckClip();
      });
      // Slow-turn cue: if the reply hasn't resolved shortly, speak the cached
      // "On it" clip so delegation work never reads as dead air.
      const ackTimer = window.setTimeout(() => {
        if (!cancelled && !abort.signal.aborted) playAckClip();
      }, ACK_PLAY_DELAY_MS);
      // Live working chips: poll the server's per-turn progress while the
      // converse request is in flight.
      const turnId = `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      setWorking([]);
      const progressPoll = window.setInterval(() => {
        void fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "turn-progress", turnId }),
          cache: "no-store",
          signal: abort.signal,
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload: { known?: boolean; stages?: QueenVoiceWorkingStage[] } | null) => {
            if (cancelled || !payload?.known || !Array.isArray(payload.stages)) return;
            setWorking(payload.stages.map((stage) => ({
              label: String(stage.label ?? ""),
              done: Boolean(stage.done),
            })));
          })
          .catch(() => undefined);
      }, TURN_PROGRESS_POLL_MS);
      try {
        const converseResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "converse-stream",
            transcript,
            turnId,
            history: history.slice(-8),
          }),
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(75_000)]),
        });
        if (cancelled) return;
        history.push({ who: "you", text: transcript });
        const contentType =
          converseResponse.headers.get("content-type") || "";
        if (
          !converseResponse.ok ||
          !converseResponse.body ||
          !contentType.includes("ndjson")
        ) {
          // Error envelope (or a proxy that buffered the stream away): handle
          // it the way the buffered `converse` turn always did.
          const data = (await converseResponse
            .json()
            .catch(() => null)) as VoiceTurnResponse | null;
          if (!data?.ok || !data.reply) {
            failTurn(
              data?.error ||
                `Queen Bee reply returned HTTP ${converseResponse.status}.`,
            );
            return;
          }
          addTurn("queen", data.reply);
          history.push({ who: "queen", text: data.reply });
          setPhase("speaking");
          // The reply is here; a late "On it" ack would talk over it.
          window.clearTimeout(ackTimer);
          const spoken = await speakReplyWithBargeIn(data.reply);
          if (cancelled) return;
          if (spoken === "none" && !abort.signal.aborted) {
            failTurn("The reply could not be played out loud. Check the Calls voice settings and speaker output.");
            return;
          }
          if (spoken === "muted") noteVoiceOutage();
          else if (spoken === "local-stream-partial") {
            noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.");
          } else clearVoiceOutage();
          startListening();
          return;
        }

        // Streaming turn: speech text arrives as NDJSON events while the
        // model writes; sentence chunks play as they complete so first audio
        // never waits for the full reply.
        const speaker = createChunkSpeaker(() => window.clearTimeout(ackTimer));
        let chunker = createSentenceChunker();
        let liveSpeech = "";
        let queenTurnId = 0;
        // Object holder (not plain lets): the fields are assigned inside the
        // event closure, which TS flow analysis would otherwise narrow away.
        const outcome: { done: ConverseStreamEvent | null; error: string } = {
          done: null,
          error: "",
        };
        const showCaption = (text: string, live: boolean) => {
          if (!queenTurnId) queenTurnId = addTurn("queen", text || "...", live);
          else updateTurn(queenTurnId, text || "...", live);
        };
        const handleEvent = (event: ConverseStreamEvent) => {
          if (event.type === "speech" && event.text) {
            liveSpeech += event.text;
            showCaption(liveSpeech.trim(), true);
            for (const chunk of chunker.push(event.text)) speaker.enqueue(chunk);
          } else if (event.type === "reset") {
            // A failed model attempt was superseded server-side; discard its
            // captions, queued chunks, and any audio mid-play.
            liveSpeech = "";
            chunker = createSentenceChunker();
            speaker.resetAttempt();
            if (queenTurnId) updateTurn(queenTurnId, "...", true);
          } else if (event.type === "done") {
            outcome.done = event;
          } else if (event.type === "error") {
            outcome.error = event.error || "Queen Bee voice turn failed.";
          }
        };
        const stream = createNdjsonEventReader<ConverseStreamEvent>(
          converseResponse.body,
        );
        const drainEvents = () => {
          for (const event of stream.take()) handleEvent(event);
        };
        // Pumps race the barge-in signal: when the user interrupts while the
        // model is still writing, the turn must snap back to listening NOW —
        // the pre-roll ring only holds ~5s of their words. The reader's
        // shared pump means a lost race never drops bytes.
        const bargeIn = new Promise<"barge-in">((resolveBargeIn) => {
          speaker.bargeInSignal.addEventListener(
            "abort",
            () => resolveBargeIn("barge-in"),
            { once: true },
          );
        });
        let detached = false;
        try {
          for (;;) {
            const next = await Promise.race([stream.pump(), bargeIn]);
            if (cancelled) return;
            if (next === "barge-in") {
              detached = !abort.signal.aborted;
              break;
            }
            drainEvents();
            if (!next) break;
          }
        } catch (readError) {
          // A dead stream (network drop, the 75s turn timeout) must also stop
          // the chunk queue and the barge-in watcher — route it through the
          // same failure path as a server error event.
          outcome.error =
            outcome.error ||
            (readError instanceof Error
              ? readError.message
              : "Queen Bee voice turn failed.");
        }
        if (detached) {
          // Reserve the queen's history slot NOW: the next user turn can start
          // before the background drain finishes, and a late push would land
          // AFTER that turn's you-entry, misattributing this reply to the next
          // question for the rest of the session. The entry is updated in
          // place; empty text is filtered server-side (historyFromForm).
          const historyEntry = { who: "queen" as const, text: liveSpeech.trim() };
          history.push(historyEntry);
          // Finish collecting the reply in the background so the transcript
          // and any delegation receipt still land; server-side work (task
          // submission) is unaffected by the interruption.
          void (async () => {
            while (await stream.pump().catch(() => false)) drainEvents();
            drainEvents();
            if (cancelled) return;
            const finalReply =
              (outcome.done?.ok && outcome.done.reply ? outcome.done.reply : "") ||
              liveSpeech.trim();
            if (finalReply) {
              showCaption(finalReply, false);
              historyEntry.text = finalReply;
            } else if (queenTurnId) {
              dropTurn(queenTurnId);
            }
          })();
          startListening();
          return;
        }
        if (cancelled) return;
        const finalReply =
          outcome.done?.ok && outcome.done.reply ? outcome.done.reply : "";
        if (outcome.error || !finalReply) {
          speaker.stop();
          // Part of a failed turn may already have been said out loud; keep
          // what she audibly spoke on screen, otherwise drop the live bubble.
          if (liveSpeech.trim()) {
            showCaption(liveSpeech.trim(), false);
            history.push({ who: "queen", text: liveSpeech.trim() });
          } else if (queenTurnId) {
            dropTurn(queenTurnId);
          }
          failTurn(outcome.error || "Queen Bee returned no reply.");
          return;
        }
        for (const chunk of chunker.flush()) speaker.enqueue(chunk);
        showCaption(finalReply, false);
        history.push({ who: "queen", text: finalReply });
        const outcomes = await speaker.end();
        if (cancelled) return;
        if (speaker.interrupted || abort.signal.aborted) {
          // Barge-in during the spoken tail: the turn is over, listen now.
          startListening();
          return;
        }
        const audible = outcomes.some(
          (outcome) =>
            outcome === "local-stream" ||
            outcome === "local-stream-partial" ||
            outcome === "buffered" ||
            outcome === "browser",
        );
        if (outcomes.length && !audible) {
          if (outcomes.includes("muted")) {
            // Voice continuity: the reply stays as text and the session keeps
            // going; the voice returns automatically when the server does.
            noteVoiceOutage();
            startListening();
            return;
          }
          // Every voice engine failed silently; say so instead of pretending
          // the reply was spoken. The reply text stays on screen.
          failTurn("The reply could not be played out loud. Check the Calls voice settings and speaker output.");
          return;
        }
        if (outcomes.includes("muted")) noteVoiceOutage();
        else if (
          outcomes.includes("local-stream-partial") ||
          outcomes.includes("none")
        ) {
          noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.");
        } else if (audible) clearVoiceOutage();
        startListening();
      } catch (turnError) {
        if (cancelled) return;
        failTurn(
          turnError instanceof Error
            ? turnError.message
            : "Queen Bee voice turn failed.",
        );
      } finally {
        window.clearTimeout(ackTimer);
        window.clearInterval(progressPoll);
        setWorking([]);
      }
    };

    const runOpeningTurn = async () => {
      if (!openingText) {
        startListening();
        return;
      }
      addTurn("queen", openingText);
      history.push({ who: "queen", text: openingText });
      setPhase("speaking");
      const spoken = await speakReplyWithBargeIn(openingText);
      if (cancelled) return;
      if (spoken === "none" && !abort.signal.aborted) {
        failTurn("The opening line could not be played out loud. Check the Calls voice settings and speaker output.");
        return;
      }
      if (spoken === "muted") noteVoiceOutage();
      else if (spoken === "local-stream-partial") {
        noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.");
      } else clearVoiceOutage();
      startListening();
    };

    // Realtime path: stream PCM while listening; partial transcripts caption
    // the live turn as the user speaks.
    async function startRealtimeListening() {
      setPhase("listening");
      setSpeechDetected(false);
      // Words spoken from this moment on (or since a barge-in trigger) are in
      // the pre-roll ring buffer; they flush into the socket once it's armed,
      // so "Your turn" registers speech immediately instead of dropping the
      // opening words while the session connects.
      const listeningStartedAt = performance.now();
      const flushSinceMs = pendingFlushSinceMs || listeningStartedAt;
      pendingFlushSinceMs = 0;
      const sessionPromise = prepareStt();
      if (!sessionPromise) {
        startRecorderListening();
        return;
      }
      let socket: WebSocket;
      try {
        socket = await sessionPromise;
        preparedStt = null;
        if (socket.readyState !== WebSocket.OPEN && !cancelled) {
          // A prewarmed socket can go stale during a long thinking/speaking
          // stretch (idle sessions get closed upstream); adopting it would
          // wedge the turn on a socket whose close event already fired.
          const freshSession = prepareStt();
          if (!freshSession) {
            startRecorderListening();
            return;
          }
          socket = await freshSession;
          preparedStt = null;
        }
      } catch (sttError) {
        realtimeUnavailable = true;
        console.warn(
          "[queen-voice] realtime STT unavailable; falling back to Whisper:",
          sttError instanceof Error ? sttError.message : sttError,
        );
        if (!cancelled) startRecorderListening();
        return;
      }
      if (cancelled) {
        closeRealtimeSttSocket(socket);
        return;
      }
      sttSocket = socket;

      let committed = false;
      let liveTranscript = "";
      let youTurnId = 0;
      let lastIdleClearAt = performance.now();
      const ensureYouTurn = () => {
        if (!youTurnId) youTurnId = addTurn("you", "...", true);
        return youTurnId;
      };
      const send = (payload: unknown) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      };

      const messageHandler = (event: MessageEvent<string>) => {
        let payload: SttEvent | null = null;
        try {
          payload = JSON.parse(event.data) as SttEvent;
        } catch {
          return;
        }
        if (
          payload.type ===
            "conversation.item.input_audio_transcription.delta" &&
          payload.delta
        ) {
          liveTranscript += payload.delta;
          updateTurn(ensureYouTurn(), liveTranscript.trim() || "...", true);
        }
        if (
          payload.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          socket.removeEventListener("message", messageHandler);
          closeSttSocket();
          // Prewarm the next session while Queen Bee thinks and speaks.
          void prepareStt()?.catch(() => undefined);
          if (cancelled) return;
          const finalTranscript = (payload.transcript || liveTranscript).trim();
          if (finalTranscript) {
            const turnId = ensureYouTurn();
            updateTurn(turnId, finalTranscript);
            void runConverseTurn(finalTranscript);
          } else {
            if (youTurnId) dropTurn(youTurnId);
            restartTimer = window.setTimeout(startListening, 150);
          }
        }
        if (payload.type === "error") {
          socket.removeEventListener("message", messageHandler);
          closeSttSocket();
          failTurn(payload.error?.message || "Realtime STT returned an error.");
        }
      };
      socket.addEventListener("message", messageHandler);
      socket.addEventListener("close", () => {
        // A dropped socket mid-listen should restart, not strand the session.
        if (!cancelled && !committed && sttSocket === socket) {
          sttSocket = null;
          sttLiveSocket = null;
          // Recover speech that straddled the drop from the pre-roll buffer.
          pendingFlushSinceMs = performance.now() - 1_500;
          restartTimer = window.setTimeout(startListening, 250);
        }
      });

      // Arm the session-long mic pump: flush the pre-roll captured while the
      // socket was opening (or the speech that triggered a barge-in), then
      // let the pump stream live frames. No handler swap, no lost audio.
      flushPreRollTo(socket, flushSinceMs);
      sttLiveSocket = socket;

      startVadLoop({
        isActive: () => sttSocket === socket && !committed,
        onSpeechDiscarded: () => {
          send({ type: "input_audio_buffer.clear" });
          liveTranscript = "";
          if (youTurnId) {
            dropTurn(youTurnId);
            youTurnId = 0;
          }
        },
        onCommit: () => {
          if (committed) return;
          committed = true;
          // Stop live streaming; the pump keeps filling the pre-roll buffer
          // for the next turn while this utterance is transcribed.
          sttLiveSocket = null;
          setPhase("thinking");
          if (!liveTranscript.trim()) {
            updateTurn(ensureYouTurn(), "Transcribing...", true);
          }
          send({ type: "input_audio_buffer.commit" });
        },
        onIdle: () => {
          // Drop silence the server has buffered so far; keeps the session lean.
          const now = performance.now();
          if (now - lastIdleClearAt > IDLE_BUFFER_CLEAR_MS && !liveTranscript) {
            lastIdleClearAt = now;
            send({ type: "input_audio_buffer.clear" });
          }
          return false;
        },
      });
    }

    // Fallback path: record the utterance and transcribe it with Whisper.
    const runVoiceTurnFromRecording = async (audio: Blob) => {
      setPhase("thinking");
      setSpeechDetected(false);
      const youTurnId = addTurn("you", "Transcribing...", true);
      abort.signal.addEventListener("abort", () => dropTurn(youTurnId), {
        once: true,
      });
      try {
        const form = new FormData();
        form.set(
          "audio",
          new File([audio], utteranceFileName(mimeType), {
            type: audio.type || mimeType || "audio/webm",
          }),
        );
        const transcribeResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          body: form,
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
        });
        const transcribed = (await transcribeResponse
          .json()
          .catch(() => null)) as VoiceTurnResponse | null;
        if (cancelled) return;
        if (
          !transcribeResponse.ok ||
          !transcribed?.ok ||
          !transcribed.transcript
        ) {
          dropTurn(youTurnId);
          failTurn(
            transcribed?.error ||
              `Queen Bee transcription returned HTTP ${transcribeResponse.status}.`,
          );
          return;
        }
        updateTurn(youTurnId, transcribed.transcript);
        await runConverseTurn(transcribed.transcript);
      } catch (turnError) {
        if (cancelled) return;
        dropTurn(youTurnId);
        failTurn(
          turnError instanceof Error
            ? turnError.message
            : "Queen Bee voice turn failed.",
        );
      }
    };

    function startRecorderListening() {
      if (cancelled || !stream || !analyser) return;
      setPhase("listening");
      setSpeechDetected(false);
      // The recorder path can't consume PCM pre-roll; drop any pending flush.
      pendingFlushSinceMs = 0;

      recorderChunks = [];
      try {
        recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
      } catch (recorderError) {
        failTurn(
          recorderError instanceof Error
            ? recorderError.message
            : "Microphone recording is unavailable in this webview.",
        );
        return;
      }
      const activeRecorder = recorder;
      activeRecorder.ondataavailable = (event) => {
        if (event.data.size) recorderChunks.push(event.data);
      };
      activeRecorder.start();

      const commitUtterance = () => {
        if (!recorder || recorder.state === "inactive") return;
        recorder.onstop = () => {
          const blob = new Blob(recorderChunks, {
            type: mimeType || "audio/webm",
          });
          recorderChunks = [];
          if (!cancelled && blob.size) void runVoiceTurnFromRecording(blob);
        };
        recorder.stop();
        recorder = null;
      };

      startVadLoop({
        isActive: () => Boolean(recorder),
        onCommit: commitUtterance,
        onIdle: (idleMs) => {
          // Bound idle recordings so quiet stretches never grow unbounded.
          if (idleMs > IDLE_RECORDER_RESTART_MS) {
            stopRecorder();
            startRecorderListening();
            return true;
          }
          return false;
        },
      });
    }

    function startListening() {
      if (cancelled) return;
      if (realtimeUnavailable) startRecorderListening();
      else void startRealtimeListening();
    }

    async function connect() {
      try {
        // Reset any state left over from a previous voice session.
        setPhase("starting");
        setError("");
        setTurns([]);
        setSpeechDetected(false);
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            `Microphone capture is not available in this webview (origin ${location.origin}, secure context ${String(window.isSecureContext)}). ` +
              "On the desktop app this usually means the app bundle is missing NSMicrophoneUsageDescription.",
          );
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: ECHO_CANCELLED_AUDIO,
        });
        streamRef.current = stream;
        if (cancelled) return;
        const audioWindow = window as Window &
          typeof globalThis & { webkitAudioContext?: typeof AudioContext };
        const AudioContextClass =
          audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass)
          throw new Error("Web Audio is not available in this browser.");
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(analyser);
        // Silent processor chain keeps PCM flowing for realtime STT streaming.
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        sourceNode.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
        // Session-long mic pump: always fill the pre-roll ring buffer (so
        // turn boundaries and barge-ins lose no speech), and stream to the
        // armed STT socket while a listening turn is live.
        const pumpContext = audioContext;
        processor.onaudioprocess = (event) => {
          if (cancelled || mutedRef.current) return;
          const pcm = resampleToPcm16(
            event.inputBuffer.getChannelData(0),
            pumpContext.sampleRate,
          );
          if (!pcm.byteLength) return;
          const at = performance.now();
          preRoll.push({ at, pcm });
          while (preRoll.length && preRoll[0].at < at - PRE_ROLL_MAX_MS) {
            preRoll.shift();
          }
          const liveSocket = sttLiveSocket;
          if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
            liveSocket.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: pcm16ToBase64(pcm),
              }),
            );
          }
        };
        // Start warming the local TTS model right away so the first spoken
        // reply doesn't pay a cold model load, then cache the "On it" ack clip
        // on the warmed voice for instant slow-turn cues.
        void prewarmLocalTtsEngine().then(() => {
          if (!cancelled) void fetchAckClip();
        });
        void runOpeningTurn();
      } catch (connectError) {
        if (!cancelled) {
          setPhase("error");
          setError(
            connectError instanceof Error
              ? connectError.message
              : "Could not start Queen Bee voice chat.",
          );
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      abort.abort();
      if (frame) window.cancelAnimationFrame(frame);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      if (restartTimer) window.clearTimeout(restartTimer);
      stopRecorder();
      closeSttSocket();
      void preparedStt
        ?.then((socket) => closeRealtimeSttSocket(socket))
        .catch(() => undefined);
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      try {
        if (processor) processor.onaudioprocess = null;
        processor?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      void audioContext?.close().catch(() => undefined);
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [active, openingLine]);

  React.useEffect(() => {
    // Muting hard-disables the mic track; mutedRef also zeroes the VAD signal.
    if (!active) return;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [active, muted]);

  return { phase, error, turns, speechDetected, working, voiceNotice };
}
