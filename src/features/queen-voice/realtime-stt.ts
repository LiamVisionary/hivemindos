"use client";

/**
 * Client helpers for streaming microphone PCM into an OpenAI Realtime
 * transcription session (the same mechanism the agent call modal uses), so
 * Queen Bee voice chat shows words as they are spoken instead of waiting for
 * a post-utterance Whisper upload.
 */

const STT_READY_TIMEOUT_MS = 10_000;

export function pcm16ToBase64(pcm: Int16Array) {
  let binary = "";
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return window.btoa(binary);
}

export function resampleToPcm16(
  input: Float32Array,
  inputRate: number,
  outputRate = 24_000,
) {
  const ratio = inputRate / outputRate;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.max(
      -1,
      Math.min(1, input[Math.floor(index * ratio)] ?? 0),
    );
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

/**
 * Mints a short-lived client secret via /api/phone and opens a realtime
 * transcription websocket, resolving once the session is ready for audio.
 */
export async function prepareRealtimeSttSession(): Promise<WebSocket> {
  const tokenResponse = await fetch("/api/phone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "local-tts-stt-client-secret" }),
    cache: "no-store",
  });
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
    clientSecret?: string;
    error?: string;
  } | null;
  if (!tokenResponse.ok || !tokenPayload?.clientSecret) {
    throw new Error(
      tokenPayload?.error ||
        `Realtime STT setup returned HTTP ${tokenResponse.status}.`,
    );
  }
  const socket = new WebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    ["realtime", `openai-insecure-api-key.${tokenPayload.clientSecret}`],
  );
  return await new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.clearTimeout(timeout);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("message", onMessage);
    };
    const fail = (reason: string) => {
      if (settled) return;
      cleanup();
      try {
        socket.close();
      } catch {
        // Socket may already be closing.
      }
      reject(new Error(reason));
    };
    const timeout = window.setTimeout(
      () => fail("Realtime STT did not become ready."),
      STT_READY_TIMEOUT_MS,
    );
    const onError = () => fail("Realtime STT websocket failed.");
    const onMessage = (event: MessageEvent<string>) => {
      let payload: { type?: string; error?: { message?: string } } | null =
        null;
      try {
        payload = JSON.parse(event.data) as {
          type?: string;
          error?: { message?: string };
        };
      } catch {
        return;
      }
      if (
        payload.type === "session.created" ||
        payload.type === "session.updated"
      ) {
        cleanup();
        resolve(socket);
      }
      if (payload.type === "error") {
        fail(payload.error?.message || "Realtime STT returned an error.");
      }
    };
    socket.addEventListener("error", onError);
    socket.addEventListener("message", onMessage);
  });
}

export function closeRealtimeSttSocket(socket: WebSocket | null) {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    try {
      socket.close();
    } catch {
      // Socket may already be closing.
    }
  }
}
