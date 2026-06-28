"use client";

import * as React from "react";
import {
  closeRealtimeSttSocket,
  pcm16ToBase64,
  prepareRealtimeSttSession,
  resampleToPcm16,
} from "./realtime-stt";

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

async function speakWithBrowserSynthesis(text: string, signal: AbortSignal) {
  if (typeof speechSynthesis === "undefined") return;
  await new Promise<void>((resolvePlayback) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onend = () => resolvePlayback();
    utterance.onerror = () => resolvePlayback();
    signal.addEventListener(
      "abort",
      () => {
        speechSynthesis.cancel();
        resolvePlayback();
      },
      { once: true },
    );
    speechSynthesis.speak(utterance);
  });
}

// Local-TTS streaming playback: request the PCM frame stream and schedule each
// chunk back-to-back on the VAD AudioContext as it arrives, so audio starts in
// ~a second instead of waiting for the whole clip to synthesize. Returns false
// (e.g. 409 when local TTS isn't selected/available) so the caller falls back
// to the buffered path. PCM16 little-endian; chunks can split mid-sample, so an
// odd trailing byte is carried into the next chunk.
async function playStreamedLocalTts(
  text: string,
  signal: AbortSignal,
  context: AudioContext,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "speak-stream", text }),
      cache: "no-store",
      signal,
    });
  } catch {
    return false;
  }
  if (signal.aborted) return false;
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !response.body || contentType.includes("json")) return false;
  const sampleRate = Number(response.headers.get("x-audio-sample-rate")) || 24_000;
  await context.resume().catch(() => undefined);
  const reader = response.body.getReader();
  // A small lead-in absorbs network jitter so scheduled chunks stay gapless.
  let playhead = context.currentTime + 0.15;
  let leftover = new Uint8Array(0);
  const sources: AudioBufferSourceNode[] = [];
  const stopAll = () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // already stopped/ended
      }
    }
  };
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    stopAll();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let played = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      if (!value?.length) continue;
      let chunk: Uint8Array;
      if (leftover.length) {
        chunk = new Uint8Array(leftover.length + value.length);
        chunk.set(leftover, 0);
        chunk.set(value, leftover.length);
      } else {
        chunk = value;
      }
      const usable = chunk.length - (chunk.length % 2);
      leftover = usable < chunk.length ? chunk.slice(usable) : new Uint8Array(0);
      if (usable === 0) continue;
      const sampleCount = usable / 2;
      const samples = new Float32Array(sampleCount);
      const view = new DataView(chunk.buffer, chunk.byteOffset, usable);
      for (let i = 0; i < sampleCount; i += 1) {
        samples[i] = view.getInt16(i * 2, true) / 32_768;
      }
      const buffer = context.createBuffer(1, sampleCount, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(playhead, context.currentTime);
      source.start(startAt);
      playhead = startAt + buffer.duration;
      sources.push(source);
      played = true;
    }
  } catch {
    // stream/decoding error mid-flight; if nothing played, let the caller fall back
  }
  if (!played) {
    signal.removeEventListener("abort", onAbort);
    return false;
  }
  // Hold until the scheduled audio finishes (or the turn aborts).
  const remainingMs = Math.max(0, (playhead - context.currentTime) * 1_000);
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, remainingMs + 60);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  signal.removeEventListener("abort", onAbort);
  return true;
}

// WKWebView's autoplay policy blocks `new Audio().play()` without a user
// gesture, so replies are decoded and played through the already-running VAD
// AudioContext instead (the same approach the agent call modal relies on).
async function playSpokenReply(
  text: string,
  signal: AbortSignal,
  context: AudioContext | null,
  streamLocalTts = false,
) {
  // Local TTS: stream frames for sub-second first audio; on any miss (not
  // local-tts, app down) fall through to the buffered path below.
  if (streamLocalTts && context) {
    const streamed = await playStreamedLocalTts(text, signal, context).catch(() => false);
    if (streamed || signal.aborted) return;
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
  if (signal.aborted) return;
  if (
    !response?.ok ||
    !response.headers.get("content-type")?.includes("audio/") ||
    !context
  ) {
    await speakWithBrowserSynthesis(text, signal);
    return;
  }
  try {
    const encoded = await response.arrayBuffer();
    if (signal.aborted) return;
    const buffer = await context.decodeAudioData(encoded);
    if (signal.aborted) return;
    await context.resume().catch(() => undefined);
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
  } catch {
    await speakWithBrowserSynthesis(text, signal);
  }
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
      if (processor) processor.onaudioprocess = null;
      closeRealtimeSttSocket(sttSocket);
      sttSocket = null;
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

    // Step 2 of every turn: the conversational Queen Bee reply, captions,
    // spoken playback, then back to listening.
    const runConverseTurn = async (transcript: string) => {
      setPhase("thinking");
      setSpeechDetected(false);
      try {
        const converseResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "converse",
            transcript,
            history: history.slice(-8),
          }),
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(75_000)]),
        });
        const data = (await converseResponse
          .json()
          .catch(() => null)) as VoiceTurnResponse | null;
        if (cancelled) return;
        history.push({ who: "you", text: transcript });
        if (!converseResponse.ok || !data?.ok || !data.reply) {
          failTurn(
            data?.error ||
              `Queen Bee reply returned HTTP ${converseResponse.status}.`,
          );
          return;
        }
        addTurn("queen", data.reply);
        history.push({ who: "queen", text: data.reply });
        setPhase("speaking");
        await playSpokenReply(data.reply, abort.signal, audioContext, streamLocalTtsRef.current);
        if (!cancelled) startListening();
      } catch (turnError) {
        if (cancelled) return;
        failTurn(
          turnError instanceof Error
            ? turnError.message
            : "Queen Bee voice turn failed.",
        );
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
      await playSpokenReply(openingText, abort.signal, audioContext, streamLocalTtsRef.current);
      if (!cancelled) startListening();
    };

    // Realtime path: stream PCM while listening; partial transcripts caption
    // the live turn as the user speaks.
    async function startRealtimeListening() {
      setPhase("listening");
      setSpeechDetected(false);
      const sessionPromise = prepareStt();
      if (!sessionPromise) {
        startRecorderListening();
        return;
      }
      let socket: WebSocket;
      try {
        socket = await sessionPromise;
      } catch (sttError) {
        realtimeUnavailable = true;
        console.warn(
          "[queen-voice] realtime STT unavailable; falling back to Whisper:",
          sttError instanceof Error ? sttError.message : sttError,
        );
        if (!cancelled) startRecorderListening();
        return;
      }
      preparedStt = null;
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
          restartTimer = window.setTimeout(startListening, 250);
        }
      });

      if (processor && audioContext) {
        const activeContext = audioContext;
        processor.onaudioprocess = (event) => {
          if (cancelled || committed || mutedRef.current) return;
          if (socket.readyState !== WebSocket.OPEN) return;
          const pcm = resampleToPcm16(
            event.inputBuffer.getChannelData(0),
            activeContext.sampleRate,
          );
          if (pcm.byteLength) {
            send({
              type: "input_audio_buffer.append",
              audio: pcm16ToBase64(pcm),
            });
          }
        };
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

  return { phase, error, turns, speechDetected };
}
