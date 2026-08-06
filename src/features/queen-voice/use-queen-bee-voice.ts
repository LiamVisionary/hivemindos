"use client";

import * as React from "react";
import {
  createBargeInDetector,
  requestBargeInRecalibration,
  updateBargeInDetector,
} from "./barge-in-detector";
import {
  closeRealtimeSttSocket,
  createRealtimeSttPrewarmCache,
  pcm16ToBase64,
  raceSttArmDeadline,
  resampleToPcm16,
  type RealtimeSttSession,
} from "./realtime-stt";
import type { SttCaptionStream } from "./stt-caption-stream";
import {
  startLocalCaptionStream,
  startTurnCaptionStream,
} from "./caption-source";
import { runRecordedVoiceTurn } from "./recorded-turn";
import {
  realtimeTranscriptionFailureMessage,
  type RealtimeTranscriptionEvent,
} from "./realtime-transcription-event";
import {
  ACK_PLAY_DELAY_MS,
  BARGE_IN_BACKSTOP_INTERVAL_MS,
  BARGE_IN_FLUSH_LOOKBACK_MS,
  BARGE_IN_RAF_STALL_MS,
  ECHO_CANCELLED_AUDIO,
  ERROR_RESUME_DELAY_MS,
  IDLE_BUFFER_CLEAR_MS,
  IDLE_RECORDER_RESTART_MS,
  LOCAL_TTS_PREWARM_INTERVAL_MS,
  POST_PLAYBACK_FLUSH_LOOKBACK_MS,
  PRE_ROLL_MAX_MS,
  STT_ARM_TIMEOUT_MS,
  STT_COMMIT_FALLBACK_MS,
  STT_PREWARM_MAX_AGE_MS,
  TURN_PROGRESS_POLL_MS,
  pickRecorderMimeType,
  utteranceFileName,
} from "./voice-pipeline-config";
import { createSentenceChunker } from "@/lib/services/queen-bee/voice-speech-stream";
import {
  createNdjsonEventReader,
  voiceTurnBrainMetadata,
  type ConverseStreamEvent,
} from "./converse-stream";
import {
  playSpokenReply,
  type PlaybackActivity,
  type SpokenReplyOutcome,
} from "./spoken-reply-playback";
import { startEnergyVadLoop, VAD_MAX_UTTERANCE_MS } from "./energy-vad-loop";
import { createVoiceAckCues } from "./voice-ack-cues";
import {
  getQueenOutputAnalyser,
  useQueenVoiceLevelPump,
} from "@/lib/audio/queen-voice-amplitude";
import {
  prewarmQueenLocalTts,
  type QueenVoiceNoticeKind,
} from "./local-tts-recovery-client";

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
  brain?: string;
  brainFallback?: { label: string; error: string };
};

/** One live stage of the current turn's work (tool call, fleet scan, ...). */
export type QueenVoiceWorkingStage = { label: string; done: boolean };

type VoiceTurnResponse = {
  ok?: boolean;
  transcript?: string;
  reply?: string;
  brainLabel?: string;
  brainFallback?: { label?: string; error?: string };
  error?: string;
};

/**
 * Hands-free Queen Bee voice loop. Preferred path: microphone PCM streams
 * into an OpenAI Realtime transcription session whose SERVER-side VAD ends
 * each utterance (speech events + auto-commit; final transcript ~0.6s after
 * the user stops) and the transcript goes straight to the conversational
 * Queen Bee turn. Sessions minted without server VAD (env-forced
 * gpt-realtime-whisper, older servers) fall back to a client energy VAD
 * (timer-backstopped against WKWebView rAF starvation) with a manual commit.
 * When realtime STT is unavailable—or the selected voice owns a recorded STT
 * transport—MediaRecorder sends each utterance through that configured provider.
 */
export function useQueenBeeVoice(
  active: boolean,
  muted: boolean,
  openingLine = "",
  streamLocalTts = false,
  // Conversation context provider: returns the SHARED Queen chat history
  // (typed + voice turns from the whole app) so a spoken turn continues the
  // same conversation the text pill sees. Without it the session-local
  // history array is used, which only ever contains this session's voice
  // turns — typed turns would be invisible to spoken replies.
  getSharedHistory?: () => { who: "you" | "queen"; text: string }[],
  preferRecordedInput = false,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  // Bumped every time a session (re)connects and resets `turns`. The overlay's
  // history bridge keys its id namespace on this so a restarted session (dev
  // Fast Refresh, error recovery) can never collide with — and scramble — the
  // rows an earlier session already wrote to the shared chat.
  const [sessionSerial, setSessionSerial] = React.useState(0);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [working, setWorking] = React.useState<QueenVoiceWorkingStage[]>([]);
  // Non-fatal voice status, e.g. "local voice unreachable, replies shown as
  // text" — the session keeps listening while it shows.
  const [voiceNotice, setVoiceNotice] = React.useState("");
  const [voiceNoticeKind, setVoiceNoticeKind] = React.useState<QueenVoiceNoticeKind | "">("");
  const mutedRef = React.useRef(muted);
  // Read at playback time so the long-lived session effect never goes stale.
  const streamLocalTtsRef = React.useRef(streamLocalTts);
  const streamRef = React.useRef<MediaStream | null>(null);
  // Analyser tapped off her OUTPUT audio (all pipeline paths share this
  // session's context), read by the fleet voice-reactive animation while she
  // speaks. Set once the session context exists; see the effect below.
  const queenOutputAnalyserRef = React.useRef<AnalyserNode | null>(null);
  useQueenVoiceLevelPump(queenOutputAnalyserRef, phase === "speaking");
  // Analyser on the MIC input (the same node the VAD/barge-in watchers read),
  // exposed for the control bar's live input waveform.
  const micAnalyserRef = React.useRef<AnalyserNode | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    streamLocalTtsRef.current = streamLocalTts;
  }, [streamLocalTts]);

  // Read at converse time so the long-lived session effect never goes stale.
  const getSharedHistoryRef = React.useRef(getSharedHistory);
  React.useEffect(() => {
    getSharedHistoryRef.current = getSharedHistory;
  }, [getSharedHistory]);

  React.useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
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
    const sttPrewarm = createRealtimeSttPrewarmCache();
    let realtimeUnavailable = preferRecordedInput;
    // Session-long mic pump state: PCM streams to sttLiveSocket while a
    // listening turn is armed; the pre-roll ring buffer fills the whole time.
    let sttLiveSocket: WebSocket | null = null;
    // Live words-while-speaking per listening turn (see stt-caption-stream.ts).
    let captionStream: SttCaptionStream | null = null;
    let pendingFlushSinceMs = 0;
    // Last echo/room floor the barge-in detector measured during playback —
    // seeds the listening VAD so it starts calibrated to this acoustic scene.
    let lastKnownEchoFloor = 0;
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
    const updateTurn = (id: number, text: string, live = false,
      metadata: Partial<Pick<QueenVoiceTurn, "brain" | "brainFallback">> = {}) => {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, text, live, ...metadata } : turn,
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
      captionStream?.close();
      captionStream = null;
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

    const prepareStt = () =>
      realtimeUnavailable ? null : sttPrewarm.prepare();

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

    // Pre-synthesized "On it" clip + voice-outage blip (voice-ack-cues.ts).
    // The clip is fetched after the prewarm lands so a cold local TTS model
    // is loaded exactly once; re-attempted on later turns until a clip in the
    // RIGHT voice is cached.
    const cues = createVoiceAckCues({
      signal: abort.signal,
      getContext: () => audioContext,
      isLocalVoiceSelected: () => streamLocalTtsRef.current,
    });
    const { fetchAckClip, playAckClip, cancelPendingAck } = cues;

    // Voice-outage bookkeeping: cue once per outage, clear when speech returns.
    let voiceOutageActive = false;
    let currentVoiceNoticeKind: QueenVoiceNoticeKind | "" = "";
    const showVoiceNotice = (message: string, kind: QueenVoiceNoticeKind) => {
      currentVoiceNoticeKind = kind;
      setVoiceNotice(message);
      setVoiceNoticeKind(kind);
    };
    const noteVoiceOutage = (
      message?: string,
      kind: QueenVoiceNoticeKind = "loading",
    ) => {
      if (!voiceOutageActive) {
        voiceOutageActive = true;
        cues.playVoiceMutedCue();
      }
      if (!message && currentVoiceNoticeKind === "error") return;
      showVoiceNotice(message || "Local voice server not loaded, loading now…", kind);
    };
    const clearVoiceOutage = () => {
      voiceOutageActive = false;
      currentVoiceNoticeKind = "";
      setVoiceNotice("");
      setVoiceNoticeKind("");
    };
    const prewarmLocalTtsEngine = () => {
      if (!streamLocalTtsRef.current || cancelled) return Promise.resolve(false);
      const now = Date.now();
      if (now - lastPrewarmAt < LOCAL_TTS_PREWARM_INTERVAL_MS) return Promise.resolve(false);
      lastPrewarmAt = now;
      return prewarmQueenLocalTts({
        signal: abort.signal,
        onNotice: showVoiceNotice,
        onHealthy: clearVoiceOutage,
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
      let lastTickAt = performance.now();
      // One watcher pass. Returns false once the watch is over (session/turn
      // aborted, or a barge-in fired) so both the rAF loop and the timer
      // backstop stop rescheduling.
      const runTick = () => {
        if (cancelled || playbackSignal.aborted) return false;
        lastTickAt = performance.now();
        // A playback gap (buffer underrun) or the next chunk's audio resuming
        // returns her speaker bleed; the echo floor must recalibrate around it
        // or the resumed voice would read as the user interrupting.
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
        lastKnownEchoFloor = detector.echoFloor;
        if (detector.triggered) {
          setSpeechDetected(true);
          // The words that interrupted her are already in the pre-roll ring
          // buffer; hand them to the next listening turn instead of making
          // the user repeat themselves.
          pendingFlushSinceMs = performance.now() - BARGE_IN_FLUSH_LOOKBACK_MS;
          speakAbort.abort();
          return false;
        }
        return true;
      };
      const tick = () => {
        if (runTick()) frameId = window.requestAnimationFrame(tick);
      };
      // Timer backstop: only does work when rAF has visibly stalled, so it is a
      // no-op cost while rAF is healthy but keeps the watcher ticking at ~30Hz
      // through a WKWebView rAF freeze during her spoken tail.
      const backstopId = window.setInterval(() => {
        if (performance.now() - lastTickAt <= BARGE_IN_RAF_STALL_MS) return;
        if (!runTick()) window.clearInterval(backstopId);
      }, BARGE_IN_BACKSTOP_INTERVAL_MS);
      frameId = window.requestAnimationFrame(tick);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearInterval(backstopId);
      };
    };

    // Speak a reply with barge-in armed: playback runs on its own abort scope
    // combined with the session's (AbortSignal.any handles a session that is
    // already aborted), so interrupting her never tears down the mic. The
    // shared activity object lets the watcher see playback gaps live.
    const speakReplyWithBargeIn = async (text: string): Promise<SpokenReplyOutcome> => {
      if (cues.ackPlaying()) await cues.waitForAckPlayback();
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
            if (cues.ackPlaying()) await cues.waitForAckPlayback();
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
          // NOTE: do NOT recalibrate here. The seam between chunks is a silent
          // gap the user can barge into — marking it as an underrun opened a
          // suppression window at every sentence boundary that made her
          // un-interruptible (2026-07-04). The echo floor is instead
          // recalibrated when the NEXT chunk's audio actually resumes
          // (onFirstByte -> activity.underrunAt, in spoken-reply-playback.ts),
          // which is the only moment her bleed returns.
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

    // Client energy VAD (extracted to energy-vad-loop.ts, timer-backstopped
    // against WKWebView rAF stalls) — used by the recorder fallback and by
    // sessions minted without server VAD. The noise floor seeds from the
    // barge-in detector's measured room/echo floor (it just calibrated on
    // this exact acoustic scene during her playback) instead of a cold
    // constant: a cold-low floor made post-playback ambience read as endless
    // "speech", restarting the silence timer for seconds — the "takes
    // forever to send after I stop talking" complaint.
    let stopVadLoop: (() => void) | null = null;
    const startVadLoop = (handlers: {
      isActive: () => boolean;
      onSpeechStart?: () => void;
      onSpeechDiscarded?: () => void;
      onCommit: () => void;
      onIdle?: (idleMs: number) => boolean;
    }) => {
      if (!analyser) return;
      const activeAnalyser = analyser;
      const samples = new Uint8Array(activeAnalyser.fftSize);
      stopVadLoop?.();
      stopVadLoop = startEnergyVadLoop(
        {
          ...handlers,
          isActive: () => !cancelled && handlers.isActive(),
          isMuted: () => mutedRef.current,
          onSpeechDetected: setSpeechDetected,
          readRms: () => {
            if (mutedRef.current) return 0;
            activeAnalyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) {
              const normalized = (sample - 128) / 128;
              sum += normalized * normalized;
            }
            return Math.sqrt(sum / samples.length);
          },
        },
        Math.min(0.03, Math.max(0.012, lastKnownEchoFloor)),
      );
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
      // Slow-turn cue: if no speech has streamed in by the delay, speak the
      // cached "On it" clip so pre-speech work never reads as dead air. The
      // first speech delta (or the buffered reply) cancels it.
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
      // Prefer the shared chat history (typed turns included) over the
      // session-local voice array. The current transcript may already be
      // mirrored into the store as the trailing user turn — drop it so the
      // model doesn't see the question twice.
      let turnHistory = history.slice(-8);
      const sharedHistory = getSharedHistoryRef.current?.();
      if (sharedHistory && sharedHistory.length) {
        const merged = sharedHistory.slice();
        const last = merged[merged.length - 1];
        if (last?.who === "you" && last.text.trim() === transcript.trim()) merged.pop();
        turnHistory = merged.slice(-8);
      }
      try {
        const converseResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "converse-stream",
            transcript,
            turnId,
            history: turnHistory,
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
          const responseTurnId = addTurn("queen", data.reply);
          updateTurn(responseTurnId, data.reply, false, voiceTurnBrainMetadata(data));
          history.push({ who: "queen", text: data.reply });
          setPhase("speaking");
          // The reply is here; a late "On it" ack would talk over it.
          window.clearTimeout(ackTimer);
          cancelPendingAck();
          const spoken = await speakReplyWithBargeIn(data.reply);
          if (cancelled) return;
          if (spoken === "none" && !abort.signal.aborted) {
            failTurn("The reply could not be played out loud. Check the Calls voice settings and speaker output.");
            return;
          }
          if (spoken === "muted") noteVoiceOutage();
          else if (spoken === "local-stream-partial") {
            noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.", "error");
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
            // Speech is streaming — the reply is imminent; an ack now would
            // just talk over her first sentence, and a barely-started one is cut.
            window.clearTimeout(ackTimer);
            cancelPendingAck();
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
              if (queenTurnId) updateTurn(queenTurnId, finalReply, false, voiceTurnBrainMetadata(outcome.done ?? {}));
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
        if (queenTurnId) updateTurn(queenTurnId, finalReply, false, voiceTurnBrainMetadata(outcome.done ?? {}));
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
          noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.", "error");
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
        noteVoiceOutage("Her voice cut out mid-reply (the TTS stream dropped). The full reply is on screen.", "error");
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
      // opening words while the session connects. The window reaches BACK
      // before this moment: speech that starts in her playback tail (too
      // short to trigger barge-in, which needs 420ms sustain) or during the
      // speaking→listening flip was captured by the pump but used to be cut
      // off by a flush window that started at listening-start — the classic
      // "spoke right after her and nothing registered" turn.
      const listeningStartedAt = performance.now();
      const flushSinceMs =
        pendingFlushSinceMs || listeningStartedAt - POST_PLAYBACK_FLUSH_LOOKBACK_MS;
      pendingFlushSinceMs = 0;
      const sessionPromise = prepareStt();
      if (!sessionPromise) {
        startRecorderListening();
        return;
      }
      // One absolute arming deadline per turn, shared by prewarm adoption and
      // a fresh re-mint. The abandoned mint is NOT cancelled — it resolves
      // into preparedStt for the next turn (or teardown closes it).
      const withArmDeadline = (promise: Promise<RealtimeSttSession>) =>
        raceSttArmDeadline(promise, listeningStartedAt, STT_ARM_TIMEOUT_MS);
      const armTimedOut = (abandoned: Promise<RealtimeSttSession>) => {
        console.warn(
          `[queen-voice] stt not armed +${Math.round(performance.now() - listeningStartedAt)}ms (mint stalled); recorder fallback for this turn`,
        );
        // An abandoned-mint failure already resets the prewarm cache.
        void abandoned.catch(() => undefined);
        if (cancelled) return;
        noteVoiceOutage(
          "Live transcription is taking a moment to connect, so this turn uses standard transcription. If you already said something, say it again.",
        );
        startRecorderListening();
      };
      let session: RealtimeSttSession;
      try {
        const adopted = await withArmDeadline(sessionPromise);
        if (adopted === "arm-timeout") {
          armTimedOut(sessionPromise);
          return;
        }
        session = adopted;
        const prewarmAgeMs = sttPrewarm.ageMs();
        sttPrewarm.take();
        // A prewarmed socket can go stale during a long thinking/speaking
        // stretch: idle sessions get closed upstream — sometimes half-dead
        // with readyState still OPEN, so appended audio silently goes nowhere
        // until the late close event restarts the turn ("first transcription
        // took 5+ seconds"). Re-mint instead of adopting anything old; the
        // fresh mint (~0.9s) overlaps the pre-roll flush, losing no speech.
        const prewarmTooOld = prewarmAgeMs > STT_PREWARM_MAX_AGE_MS;
        if (
          (session.socket.readyState !== WebSocket.OPEN || prewarmTooOld) &&
          !cancelled
        ) {
          console.info(
            `[queen-voice] stt prewarm ${prewarmTooOld ? `too old (${Math.round(prewarmAgeMs / 1000)}s)` : "already closed"}; minting fresh session`,
          );
          closeRealtimeSttSocket(session.socket);
          const freshSession = prepareStt();
          if (!freshSession) {
            startRecorderListening();
            return;
          }
          const fresh = await withArmDeadline(freshSession);
          if (fresh === "arm-timeout") {
            armTimedOut(freshSession);
            return;
          }
          session = fresh;
          sttPrewarm.take();
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
        closeRealtimeSttSocket(session.socket);
        return;
      }
      const socket = session.socket;
      const serverVad = session.serverVad;
      sttSocket = socket;

      // Turn lifecycle, two modes decided by the mint handshake:
      // - serverVad (default, gpt-4o-mini-transcribe): OpenAI's VAD ends the
      //   utterance — speech_started/speech_stopped arrive as events, the
      //   segment auto-commits, and the final transcript lands ~0.6s after
      //   the user stops (measured 2026-07-06: 614ms vs 1376ms for the old
      //   client-VAD + continuous-model path). No client energy heuristics.
      // - client VAD (env-forced gpt-realtime-whisper, or an older server):
      //   the model streams deltas WHILE the user speaks but rejects
      //   turn_detection, so the timer-backstopped energy VAD below decides
      //   end of speech and commits manually.
      let committed = false; // client-VAD path only
      let liveTranscript = "";
      // Server mode: finalized segments already transcribed this turn — a
      // quick resume after a short pause merges instead of losing words.
      let committedTranscript = "";
      let youTurnId = 0;
      let speechActive = false;
      let speechStartedAtMs = 0;
      // Committed segments whose transcription is still in flight; a mute
      // discard swallows exactly that many late `completed` events.
      let pendingTranscripts = 0;
      let swallowTranscripts = 0;
      let utteranceFinalized = false;
      let commitFallbackTimer = 0;
      let serverWatcher = 0;
      let lastIdleClearAt = performance.now();
      let lastStopAtMs = 0;
      // Terse turn timings in the console — the dev server forwards these
      // into its log, so STT lag reports can be diagnosed from timestamps
      // instead of feel ("was it the VAD, the transcribe, or the reply?").
      const sinceListening = () =>
        `+${Math.round(performance.now() - listeningStartedAt)}ms`;
      const ensureYouTurn = () => {
        if (!youTurnId) youTurnId = addTurn("you", "...", true);
        return youTurnId;
      };
      const send = (payload: unknown) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      };
      const shownTranscript = () =>
        `${committedTranscript} ${liveTranscript}`.trim();

      const messageHandler = (event: MessageEvent<string>) => {
        let payload: RealtimeTranscriptionEvent | null = null;
        try {
          payload = JSON.parse(event.data) as RealtimeTranscriptionEvent;
        } catch {
          return;
        }
        const transcriptionFailure = realtimeTranscriptionFailureMessage(payload);
        if (transcriptionFailure) {
          window.clearTimeout(commitFallbackTimer);
          window.clearInterval(serverWatcher);
          socket.removeEventListener("message", messageHandler);
          closeSttSocket();
          if (youTurnId) dropTurn(youTurnId);
          failTurn(`Voice transcription failed: ${transcriptionFailure}`);
          return;
        }
        if (
          serverVad &&
          payload.type === "input_audio_buffer.speech_started"
        ) {
          speechActive = true;
          if (!speechStartedAtMs) speechStartedAtMs = performance.now();
          console.info(`[queen-voice] stt speech_started ${sinceListening()}`);
          setSpeechDetected(true);
          ensureYouTurn();
          // Speech resumed before the previous segment finalized the turn —
          // its completion will merge instead of finalizing, so the
          // stop-armed fallback must not fire mid-sentence either.
          window.clearTimeout(commitFallbackTimer);
          commitFallbackTimer = 0;
        }
        if (
          serverVad &&
          payload.type === "input_audio_buffer.speech_stopped"
        ) {
          // The server VAD called end-of-speech and auto-committed the
          // segment; its transcription is in flight (~0.5s).
          speechActive = false;
          pendingTranscripts += 1;
          lastStopAtMs = performance.now();
          console.info(`[queen-voice] stt speech_stopped ${sinceListening()}`);
          setSpeechDetected(false);
          setPhase("thinking");
          // "Transcribing..." only when there's no live caption to keep.
          if (!shownTranscript() && !captionStream?.text()) {
            updateTurn(ensureYouTurn(), "Transcribing...", true);
          }
          if (!commitFallbackTimer) {
            commitFallbackTimer = window.setTimeout(
              () => finalizeUtterance(shownTranscript()),
              STT_COMMIT_FALLBACK_MS,
            );
          }
        }
        if (
          payload.type ===
            "conversation.item.input_audio_transcription.delta" &&
          payload.delta
        ) {
          liveTranscript += payload.delta;
          updateTurn(ensureYouTurn(), shownTranscript() || "...", true);
        }
        if (
          payload.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          if (!serverVad) {
            finalizeUtterance(payload.transcript || liveTranscript);
            return;
          }
          if (pendingTranscripts > 0) pendingTranscripts -= 1;
          if (swallowTranscripts > 0) {
            // Transcription of a segment the user muted away — drop it.
            swallowTranscripts -= 1;
            return;
          }
          committedTranscript =
            `${committedTranscript} ${(payload.transcript || liveTranscript).trim()}`.trim();
          liveTranscript = "";
          if (speechActive || pendingTranscripts > 0) {
            // The user resumed talking before this segment's transcription
            // landed; merge the next segment into this same turn rather
            // than cutting them off mid-thought.
            return;
          }
          finalizeUtterance(committedTranscript);
        }
        if (payload.type === "error") {
          window.clearTimeout(commitFallbackTimer);
          window.clearInterval(serverWatcher);
          socket.removeEventListener("message", messageHandler);
          closeSttSocket();
          failTurn(payload.error?.message || "Realtime STT returned an error.");
        }
      };
      // Shared by the completion event, the fallback timer, and the stuck-VAD
      // cap: a stalled/lost completion must not strand the turn in
      // "Transcribing...".
      const finalizeUtterance = (finalText: string) => {
        if (utteranceFinalized) return;
        utteranceFinalized = true;
        // A lost/empty authoritative transcript falls back to the caption the
        // user watched build — visible words must not vanish. Read before
        // closeSttSocket() discards the stream.
        const finalTranscript =
          finalText.trim() || (mutedRef.current ? "" : captionStream?.text() || "");
        console.info(
          `[queen-voice] stt transcript settled ${sinceListening()}${lastStopAtMs ? ` (${Math.round(performance.now() - lastStopAtMs)}ms after speech_stopped)` : ""}, ${finalTranscript.length} chars`,
        );
        window.clearTimeout(commitFallbackTimer);
        window.clearInterval(serverWatcher);
        socket.removeEventListener("message", messageHandler);
        closeSttSocket();
        // Prewarm the next session while Queen Bee thinks and speaks.
        void prepareStt()?.catch(() => undefined);
        if (cancelled) return;
        if (finalTranscript) {
          const turnId = ensureYouTurn();
          updateTurn(turnId, finalTranscript);
          void runConverseTurn(finalTranscript);
        } else {
          if (youTurnId) dropTurn(youTurnId);
          restartTimer = window.setTimeout(startListening, 150);
        }
      };
      socket.addEventListener("message", messageHandler);
      socket.addEventListener("close", () => {
        // A dropped socket mid-listen should restart, not strand the session.
        if (
          !cancelled &&
          !utteranceFinalized &&
          !committed &&
          sttSocket === socket
        ) {
          window.clearInterval(serverWatcher);
          sttSocket = null;
          sttLiveSocket = null;
          captionStream?.close();
          captionStream = null;
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
      console.info(
        `[queen-voice] stt listening armed ${sinceListening()} (serverVad=${String(serverVad)})`,
      );

      if (serverVad) {
        // Parallel caption stream paints the live turn while the user talks;
        // the authoritative transcript replaces it at settle. Source comes
        // from the caption matrix: free native/web speech when the
        // environment has one, the paid OpenAI caption session otherwise.
        captionStream?.close();
        captionStream = startTurnCaptionStream({
          initialFrames: () =>
            preRoll.filter((f) => f.at >= flushSinceMs).map((f) => f.pcm),
          onText: (caption) => {
            // The authoritative path wins the moment it has any text, and a
            // trailing delta after a mute-discard must not resurrect the turn.
            if (cancelled || utteranceFinalized || mutedRef.current) return;
            if (committedTranscript || liveTranscript || !caption) return;
            updateTurn(ensureYouTurn(), caption, true);
          },
        });
        // The client-side jobs left in server mode run on a plain interval
        // (rAF is not trustworthy in WKWebView): discard an utterance the
        // user muted away mid-sentence, and cap a VAD held open by steady
        // background noise.
        serverWatcher = window.setInterval(() => {
          if (cancelled || utteranceFinalized || sttSocket !== socket) {
            window.clearInterval(serverWatcher);
            return;
          }
          if (
            mutedRef.current &&
            (speechActive || liveTranscript || committedTranscript || youTurnId)
          ) {
            // Muting mid-utterance discards it instead of sending a fragment.
            speechActive = false;
            speechStartedAtMs = 0;
            liveTranscript = "";
            committedTranscript = "";
            captionStream?.reset();
            swallowTranscripts = pendingTranscripts;
            send({ type: "input_audio_buffer.clear" });
            window.clearTimeout(commitFallbackTimer);
            commitFallbackTimer = 0;
            setSpeechDetected(false);
            setPhase("listening");
            if (youTurnId) {
              dropTurn(youTurnId);
              youTurnId = 0;
            }
          }
          if (
            speechStartedAtMs &&
            performance.now() - speechStartedAtMs > VAD_MAX_UTTERANCE_MS
          ) {
            finalizeUtterance(shownTranscript());
          }
        }, 200);
        return;
      }

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
          commitFallbackTimer = window.setTimeout(
            () => finalizeUtterance(liveTranscript),
            STT_COMMIT_FALLBACK_MS,
          );
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

    // Fallback path: record the utterance and transcribe it with Whisper
    // (extracted to recorded-turn.ts).
    const runVoiceTurnFromRecording = (audio: Blob) =>
      runRecordedVoiceTurn(audio, {
        abortSignal: abort.signal,
        isCancelled: () => cancelled,
        mimeType,
        utteranceFileName,
        setPhase,
        setSpeechDetected,
        addTurn,
        updateTurn,
        dropTurn,
        failTurn,
        resumeListening: () => {
          restartTimer = window.setTimeout(startListening, 150);
        },
        runConverseTurn,
      });

    function startRecorderListening() {
      if (cancelled || !stream || !analyser) return;
      setPhase("listening");
      setSpeechDetected(false);
      // The recorder path can't consume PCM pre-roll; drop any pending flush.
      pendingFlushSinceMs = 0;

      // Free local captions (native/web speech): live words while talking,
      // and — when present at commit — the transcript itself, so this path
      // no longer needs an OpenAI key at all. Absent a free source this
      // stream stays silently empty and the Whisper upload runs as before.
      let liveTurnId = 0;
      captionStream?.close();
      const captions = startLocalCaptionStream({
        initialFrames: () => [],
        onText: (caption) => {
          if (cancelled || mutedRef.current || !recorder || !caption) return;
          if (!liveTurnId) liveTurnId = addTurn("you", caption, true);
          else updateTurn(liveTurnId, caption, true);
        },
      });
      captionStream = captions;

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
          if (cancelled) return;
          const captionTranscript = captions.text();
          captions.close();
          if (captionStream === captions) captionStream = null;
          if (captionTranscript) {
            // Free path: the local recognizer already transcribed the turn —
            // no upload, no key.
            setPhase("thinking");
            setSpeechDetected(false);
            const turnId = liveTurnId || addTurn("you", captionTranscript, true);
            liveTurnId = 0;
            updateTurn(turnId, captionTranscript);
            void runConverseTurn(captionTranscript);
            return;
          }
          if (liveTurnId) {
            dropTurn(liveTurnId);
            liveTurnId = 0;
          }
          if (blob.size) void runVoiceTurnFromRecording(blob);
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
        setSessionSerial((serial) => serial + 1);
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
        // Eagerly create the shared queen-output analyser so playback nodes tap
        // the same instance the fleet animation reads (WeakMap-keyed by context).
        queenOutputAnalyserRef.current = getQueenOutputAnalyser(audioContext);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(analyser);
        micAnalyserRef.current = analyser;
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
            captionStream?.push(pcm);
          }
        };
        // Start warming the local TTS model right away so the first spoken
        // reply doesn't pay a cold model load, then cache the "On it" ack clip
        // on the warmed voice for instant slow-turn cues.
        void prewarmLocalTtsEngine().then(() => {
          if (!cancelled) void fetchAckClip();
        });
        // Mint the first STT session now, overlapping the greeting — the
        // first listening turn otherwise pays the whole mint (worst case a
        // dev-server cold compile of /api/phone) inside its arming deadline.
        void prepareStt()?.catch(() => undefined);
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
      stopVadLoop?.();
      if (resumeTimer) window.clearTimeout(resumeTimer);
      if (restartTimer) window.clearTimeout(restartTimer);
      stopRecorder();
      closeSttSocket();
      sttPrewarm.closePending();
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      try {
        if (processor) processor.onaudioprocess = null;
        processor?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      void audioContext?.close().catch(() => undefined);
      queenOutputAnalyserRef.current = null;
      micAnalyserRef.current = null;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [active, openingLine, preferRecordedInput]);

  React.useEffect(() => {
    // Muting hard-disables the mic track; mutedRef also zeroes the VAD signal.
    if (!active) return;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [active, muted]);

  return { phase, error, turns, speechDetected, working, voiceNotice, voiceNoticeKind, micAnalyserRef, sessionSerial };
}
