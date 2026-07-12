"use client";

/**
 * Capability matrix for live voice captions (words painted WHILE the user
 * speaks). Sources in preference order — browser-native first, the paid
 * OpenAI realtime caption session only as the fallback:
 *
 * - web-speech: the browser's SpeechRecognition (Chrome/Edge browser
 *   contexts; webviews generally lack it). Free, keyless.
 * - openai-realtime: parallel gpt-realtime-whisper session
 *   (stt-caption-stream.ts). Needs an OpenAI key; ~$0.017/min while armed.
 *
 * Availability is probed once per app session and logged, so which source
 * an environment picked is readable from the dev log. Extend the matrix,
 * don't branch at call sites.
 */

import {
  startSttCaptionStream,
  type SttCaptionStream,
} from "./stt-caption-stream";
import {
  isWebSpeechCaptionAvailable,
  startWebSpeechCaptionStream,
} from "./web-speech-caption";

export type CaptionSourceId = "web-speech" | "openai-realtime";

export type CaptionStreamOptions = {
  /** Pre-roll PCM to replay into a socket-fed source once it arms; sources
   *  that capture their own microphone ignore this. */
  initialFrames: () => Int16Array[];
  onText: (caption: string) => void;
};

type CaptionSourceDefinition = {
  id: CaptionSourceId;
  /** No API key and no marginal cost. */
  free: boolean;
  isAvailable: () => boolean | Promise<boolean>;
  start: (opts: CaptionStreamOptions) => SttCaptionStream;
};

const CAPTION_SOURCE_MATRIX: CaptionSourceDefinition[] = [
  {
    id: "web-speech",
    free: true,
    isAvailable: isWebSpeechCaptionAvailable,
    start: (opts) => startWebSpeechCaptionStream({ onText: opts.onText }),
  },
  {
    id: "openai-realtime",
    free: false,
    // Callers only reach this source while an OpenAI realtime TURN session
    // is armed, so the key/mint is known to work; the stream itself is
    // best-effort on top of that.
    isAvailable: () => true,
    start: (opts) => startSttCaptionStream(opts),
  },
];

// One probe per app session; the winner is environment-shaped, not per-turn.
const resolvedByScope = new Map<string, Promise<CaptionSourceDefinition | null>>();

async function resolveSource(freeOnly: boolean) {
  for (const source of CAPTION_SOURCE_MATRIX) {
    if (freeOnly && !source.free) continue;
    try {
      if (await source.isAvailable()) return source;
    } catch {
      // An unavailable source is a skip, never a failure.
    }
  }
  return null;
}

function resolvedSource(freeOnly: boolean) {
  const scope = freeOnly ? "free" : "any";
  let resolved = resolvedByScope.get(scope);
  if (!resolved) {
    resolved = resolveSource(freeOnly).then((source) => {
      console.info(
        `[queen-voice] caption source (${scope}): ${source ? `${source.id}${source.free ? " (free)" : ""}` : "none"}`,
      );
      return source;
    });
    resolvedByScope.set(scope, resolved);
  }
  return resolved;
}

/** Resolves true when a keyless caption source exists in this environment. */
export function hasFreeCaptionSource() {
  return resolvedSource(true).then((source) => source !== null);
}

function startResolvedStream(
  resolved: Promise<CaptionSourceDefinition | null>,
  opts: CaptionStreamOptions,
): SttCaptionStream {
  let inner: SttCaptionStream | null = null;
  let closed = false;
  void resolved.then((source) => {
    if (!source || closed) return;
    inner = source.start(opts);
    if (closed) inner.close();
  });
  return {
    push: (pcm) => inner?.push(pcm),
    text: () => inner?.text() ?? "",
    reset: () => inner?.reset(),
    close: () => {
      closed = true;
      inner?.close();
    },
  };
}

/** Captions for an armed OpenAI realtime turn: best free source, falling
 *  back to the paid parallel caption session. */
export function startTurnCaptionStream(opts: CaptionStreamOptions) {
  return startResolvedStream(resolvedSource(false), opts);
}

/** Captions/transcription with NO OpenAI dependency (recorder-path turns and
 *  key-free environments). Returns a stream that stays silently empty when
 *  no free source exists. */
export function startLocalCaptionStream(opts: CaptionStreamOptions) {
  return startResolvedStream(resolvedSource(true), opts);
}
