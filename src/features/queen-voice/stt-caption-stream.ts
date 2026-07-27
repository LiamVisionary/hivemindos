"use client";

/**
 * Best-effort live captions for a server-VAD listening turn.
 *
 * The turn-taking STT session (gpt-4o-mini-transcribe + server VAD) only
 * transcribes a segment AFTER its auto-commit — nothing streams while the
 * user is mid-sentence (protocol probe 2026-07-06: every delta/completed
 * event lands ~0.6s after speech_stopped), so the live turn showed "..."
 * for the whole utterance. The one model that streams words AS they are
 * spoken (gpt-realtime-whisper, mode "continuous") hard-rejects server VAD,
 * so it can't BE the turn session — instead each armed turn opens this
 * parallel caption stream on it, purely for the live caption text; the
 * authoritative transcript still comes from the turn session and replaces
 * the caption when the utterance settles.
 *
 * Everything here is best-effort by design: a failed, slow, or unavailable
 * caption mint leaves the placeholder ellipsis and never blocks the turn.
 */

import {
  closeRealtimeSttSocket,
  pcm16ToBase64,
  prepareRealtimeSttSession,
} from "./realtime-stt";

export type SttCaptionStream = {
  /** Stream a live PCM frame; drops silently until the socket is armed. */
  push: (pcm: Int16Array) => void;
  /** Accumulated caption text heard so far this turn. */
  text: () => string;
  /** Discard accumulated text (the turn was muted away mid-utterance). */
  reset: () => void;
  close: () => void;
};

export function startSttCaptionStream(opts: {
  /** Pre-roll frames to replay once the socket arms, so the words spoken
   *  while it was still connecting are captioned too. */
  initialFrames: () => Int16Array[];
  /** Fires with the full accumulated caption after every delta. */
  onText: (caption: string) => void;
}): SttCaptionStream {
  let socket: WebSocket | null = null;
  let closed = false;
  let text = "";

  const appendPcm = (target: WebSocket, pcm: Int16Array) => {
    if (target.readyState !== WebSocket.OPEN) return;
    target.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: pcm16ToBase64(pcm),
      }),
    );
  };

  const handleMessage = (event: MessageEvent<string>) => {
    if (closed) return;
    let payload: { type?: string; delta?: string } | null = null;
    try {
      payload = JSON.parse(event.data) as { type?: string; delta?: string };
    } catch {
      return;
    }
    if (
      payload?.type === "conversation.item.input_audio_transcription.delta" &&
      payload.delta
    ) {
      text += payload.delta;
      opts.onText(text.trim());
    }
  };

  void prepareRealtimeSttSession("continuous")
    .then((session) => {
      if (closed) {
        closeRealtimeSttSocket(session.socket);
        return;
      }
      socket = session.socket;
      socket.addEventListener("message", handleMessage);
      for (const pcm of opts.initialFrames()) appendPcm(socket, pcm);
    })
    .catch(() => undefined);

  return {
    push: (pcm) => {
      if (!closed && socket) appendPcm(socket, pcm);
    },
    text: () => text.trim(),
    reset: () => {
      text = "";
    },
    close: () => {
      closed = true;
      closeRealtimeSttSocket(socket);
      socket = null;
    },
  };
}
