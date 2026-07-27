"use client";

/**
 * Free live captions via the browser's Web Speech API (SpeechRecognition),
 * through the app's established `speechRecognitionConstructor()` helper —
 * the same recognizer chat dictation and the agent call modal use.
 * Chrome/Edge browser contexts ship it keyless with interim results;
 * WKWebView/WebView2 generally do NOT expose it, so availability is probed
 * at runtime (see caption-source.ts). The recognizer captures its OWN
 * microphone — pushed PCM is ignored, and muting the app's mic track does
 * not silence it (callers gate on mute) — and recognition sessions
 * self-terminate after silence, so the stream restarts them until closed.
 */

import {
  speechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "@/features/chat/chat-composer";
import type { SttCaptionStream } from "./stt-caption-stream";

// Permission/service failures that must not be retried in a restart loop.
const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
]);

export function isWebSpeechCaptionAvailable() {
  return speechRecognitionConstructor() !== null;
}

export function startWebSpeechCaptionStream(opts: {
  onText: (caption: string) => void;
}): SttCaptionStream {
  const Recognition = speechRecognitionConstructor();
  let recognition: SpeechRecognitionLike | null = null;
  let closed = false;
  // Segments the recognizer marked final, then the in-progress interim tail.
  let finalText = "";
  let interimText = "";

  const text = () => `${finalText} ${interimText}`.trim();

  const startRecognizer = () => {
    if (closed || !Recognition) return;
    try {
      recognition = new Recognition();
    } catch {
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      if (closed) return;
      interimText = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (!transcript) continue;
        if (result.isFinal) finalText = `${finalText} ${transcript}`.trim();
        else interimText = `${interimText} ${transcript}`.trim();
      }
      opts.onText(text());
    };
    recognition.onerror = (event) => {
      if (FATAL_ERRORS.has(event.error || "")) closed = true;
    };
    // Recognition sessions end on their own after silence; keep listening
    // for the whole turn by restarting until close().
    recognition.onend = () => {
      recognition = null;
      if (!closed) startRecognizer();
    };
    try {
      recognition.start();
    } catch {
      // start() throws if a session is already active; onend will restart.
    }
  };
  startRecognizer();

  return {
    push: () => undefined, // captures its own microphone
    text,
    reset: () => {
      finalText = "";
      interimText = "";
    },
    close: () => {
      closed = true;
      try {
        recognition?.abort();
      } catch {
        // Already stopped.
      }
      recognition = null;
    },
  };
}
