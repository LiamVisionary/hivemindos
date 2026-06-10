"use client";

import * as React from "react";

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
};

type VoiceTurnResponse = {
  ok?: boolean;
  transcript?: string;
  reply?: string;
  error?: string;
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
const COMMIT_SILENCE_MS = 800;
const MAX_UTTERANCE_MS = 20_000;
const IDLE_RECORDER_RESTART_MS = 25_000;
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

async function playSpokenReply(text: string, signal: AbortSignal) {
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
    !response.headers.get("content-type")?.includes("audio/")
  ) {
    await speakWithBrowserSynthesis(text, signal);
    return;
  }
  const audioUrl = URL.createObjectURL(await response.blob());
  try {
    if (signal.aborted) return;
    await new Promise<void>((resolvePlayback, rejectPlayback) => {
      const audio = new Audio(audioUrl);
      const stop = () => {
        audio.pause();
        resolvePlayback();
      };
      signal.addEventListener("abort", stop, { once: true });
      audio.onended = () => resolvePlayback();
      audio.onerror = () =>
        rejectPlayback(new Error("Queen Bee reply audio could not be played."));
      void audio.play().catch(rejectPlayback);
    });
  } catch {
    await speakWithBrowserSynthesis(text, signal);
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

/**
 * Hands-free Queen Bee voice loop: an energy-based VAD watches the
 * echo-cancelled microphone, records each utterance, sends it through
 * /api/queen-bee/voice (Whisper STT + Queen Bee submission), then voices the
 * receipt summary before listening again.
 */
export function useQueenBeeVoice(active: boolean, muted: boolean) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const mutedRef = React.useRef(muted);
  const streamRef = React.useRef<MediaStream | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let frame = 0;
    let resumeTimer = 0;
    let nextTurnId = 1;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let recorder: MediaRecorder | null = null;
    let recorderChunks: Blob[] = [];
    const abort = new AbortController();
    const mimeType = pickRecorderMimeType();
    // Finalized turns for this session, sent so Queen Bee keeps conversational context.
    const history: { who: "you" | "queen"; text: string }[] = [];

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

    const runVoiceTurn = async (audio: Blob) => {
      setPhase("thinking");
      setSpeechDetected(false);
      const youTurnId = addTurn("you", "Transcribing...", true);
      try {
        const form = new FormData();
        form.set(
          "audio",
          new File([audio], utteranceFileName(mimeType), {
            type: audio.type || mimeType || "audio/webm",
          }),
        );
        form.set("history", JSON.stringify(history.slice(-8)));
        const response = await fetch("/api/queen-bee/voice", {
          method: "POST",
          body: form,
          cache: "no-store",
          signal: abort.signal,
        });
        const data = (await response
          .json()
          .catch(() => null)) as VoiceTurnResponse | null;
        if (cancelled) return;
        if (!response.ok || !data?.ok || !data.transcript || !data.reply) {
          dropTurn(youTurnId);
          failTurn(
            data?.error ||
              `Queen Bee voice turn returned HTTP ${response.status}.`,
          );
          return;
        }
        updateTurn(youTurnId, data.transcript);
        addTurn("queen", data.reply);
        history.push(
          { who: "you", text: data.transcript },
          { who: "queen", text: data.reply },
        );
        setPhase("speaking");
        await playSpokenReply(data.reply, abort.signal);
        if (!cancelled) startListening();
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

    function startListening() {
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

      const recorderStartedAt = performance.now();
      let speechStartedAt = 0;
      let lastSpeechAt = 0;
      let noiseFloor = 0.012;
      const samples = new Uint8Array(analyser.fftSize);

      const commitUtterance = () => {
        if (!recorder || recorder.state === "inactive") return;
        recorder.onstop = () => {
          const blob = new Blob(recorderChunks, {
            type: mimeType || "audio/webm",
          });
          recorderChunks = [];
          if (!cancelled && blob.size) void runVoiceTurn(blob);
        };
        recorder.stop();
        recorder = null;
      };

      const tick = () => {
        if (cancelled || !analyser || !recorder) return;
        analyser.getByteTimeDomainData(samples);
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
        }
        const threshold = Math.max(0.018, noiseFloor * 3);
        if (rms < threshold) noiseFloor = noiseFloor * 0.96 + rms * 0.04;
        if (rms >= threshold) {
          if (!speechStartedAt) {
            speechStartedAt = now;
            setSpeechDetected(true);
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
          commitUtterance();
          return;
        }
        // Bound idle recordings so quiet stretches never grow unbounded.
        if (
          !speechStartedAt &&
          now - recorderStartedAt > IDLE_RECORDER_RESTART_MS
        ) {
          stopRecorder();
          startListening();
          return;
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
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
        audioContext.createMediaStreamSource(stream).connect(analyser);
        startListening();
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
      stopRecorder();
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContext?.close().catch(() => undefined);
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [active]);

  React.useEffect(() => {
    // Muting hard-disables the mic track; mutedRef also zeroes the VAD signal.
    if (!active) return;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [active, muted]);

  return { phase, error, turns, speechDetected };
}
