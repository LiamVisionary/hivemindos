"use client";

/**
 * Free on-device live captions via the desktop shell's native speech
 * recognizer (macOS SFSpeechRecognizer through the Tauri bridge; other
 * platforms report unavailable). Zero install bloat and no API key — the OS
 * ships the model. The native side captures its OWN microphone via
 * AVAudioEngine — pushed PCM is ignored, and muting the app's mic track
 * does not silence it (callers gate on mute). Partial transcripts stream
 * back as Tauri events.
 */

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { SttCaptionStream } from "./stt-caption-stream";

export const NATIVE_SPEECH_PARTIAL_EVENT = "hivemindos:speech-partial";

type NativeSpeechPartial = {
  sessionId?: string;
  text?: string;
  isFinal?: boolean;
};

export async function isNativeSpeechCaptionAvailable(): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("speech_recognition_available");
  } catch {
    // Older shells without the command, or a denied speech permission.
    return false;
  }
}

export function startNativeSpeechCaptionStream(opts: {
  onText: (caption: string) => void;
}): SttCaptionStream {
  const sessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let closed = false;
  let text = "";
  let unlisten: (() => void) | null = null;

  void (async () => {
    try {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);
      const stop = await listen<NativeSpeechPartial>(
        NATIVE_SPEECH_PARTIAL_EVENT,
        (event) => {
          if (closed || event.payload?.sessionId !== sessionId) return;
          const partial = (event.payload.text || "").trim();
          if (!partial) return;
          // SFSpeechRecognizer partials are cumulative for the task — each
          // event carries the best transcription so far, not a delta.
          text = partial;
          opts.onText(text);
        },
      );
      if (closed) {
        stop();
        return;
      }
      unlisten = stop;
      await invoke("speech_recognition_start", { sessionId });
    } catch {
      // Best-effort captions: a failed native start just leaves the
      // placeholder; the caller's other sources still work.
    }
  })();

  return {
    push: () => undefined, // native side captures its own microphone
    text: () => text,
    reset: () => {
      text = "";
    },
    close: () => {
      closed = true;
      unlisten?.();
      unlisten = null;
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("speech_recognition_stop", { sessionId }))
        .catch(() => undefined);
    },
  };
}
