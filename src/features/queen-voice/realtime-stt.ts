"use client";

/**
 * Client helpers for streaming microphone PCM into an OpenAI Realtime
 * transcription session (the same mechanism the agent call modal uses), so
 * Queen Bee voice chat shows words as they are spoken instead of waiting for
 * a post-utterance Whisper upload.
 */

const STT_READY_TIMEOUT_MS = 10_000;
// The client-secret mint must not hang forever (a wedged server or a
// dev-server cold compile can hold the response for minutes) — callers cache
// the pending promise, so an unbounded fetch would poison every later turn.
// Generous on purpose: turn-level arming deadlines live in the caller; this
// only bounds the promise's lifetime so a failure resets the cache.
const STT_MINT_TIMEOUT_MS = 45_000;

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

export type RealtimeSttSession = {
  socket: WebSocket;
  /** True when the SESSION's server-side VAD ends utterances (auto-commit +
   *  speech_started/speech_stopped events); false when the caller must run
   *  its own VAD and commit manually (continuous streaming model). */
  serverVad: boolean;
};

/**
 * Mints a short-lived client secret via /api/phone and opens a realtime
 * transcription websocket, resolving once the session is ready for audio.
 * mode "turns" (default) asks for a server-VAD turn-taking session;
 * "continuous" asks for the streaming pre-commit-deltas model.
 */
export async function prepareRealtimeSttSession(
  mode: "turns" | "continuous" = "turns",
): Promise<RealtimeSttSession> {
  const tokenResponse = await fetch("/api/phone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "local-tts-stt-client-secret", mode }),
    cache: "no-store",
    signal: AbortSignal.timeout(STT_MINT_TIMEOUT_MS),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
    clientSecret?: string;
    turnDetection?: string;
    error?: string;
  } | null;
  if (!tokenResponse.ok || !tokenPayload?.clientSecret) {
    throw new Error(
      tokenPayload?.error ||
        `Realtime STT setup returned HTTP ${tokenResponse.status}.`,
    );
  }
  // Older servers don't send turnDetection; they always minted the
  // continuous model, so default to client-owned end-of-speech.
  const serverVad = tokenPayload.turnDetection === "server";
  const socket = new WebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    ["realtime", `openai-insecure-api-key.${tokenPayload.clientSecret}`],
  );
  const readySocket = await new Promise<WebSocket>((resolve, reject) => {
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
  return { socket: readySocket, serverVad };
}

/**
 * One-slot prewarm cache for turn-taking sessions: the next turn's session
 * mints while the queen thinks/speaks, and a failure resets the slot so the
 * next call re-mints. Age is measured from when the socket became USABLE,
 * not when the mint started — a slow mint must not read as "stale" the
 * moment it finally lands.
 */
export function createRealtimeSttPrewarmCache() {
  let pending: Promise<RealtimeSttSession> | null = null;
  let mintedAt = 0;
  return {
    prepare(): Promise<RealtimeSttSession> {
      if (!pending) {
        mintedAt = performance.now();
        pending = prepareRealtimeSttSession()
          .then((session) => {
            mintedAt = performance.now();
            return session;
          })
          .catch((error) => {
            pending = null;
            throw error;
          });
      }
      return pending;
    },
    ageMs: () => performance.now() - mintedAt,
    /** The caller adopted (or discarded) the cached session. */
    take: () => {
      pending = null;
    },
    /** Teardown: close the socket whenever the pending mint lands. */
    closePending: () => {
      void pending
        ?.then((session) => closeRealtimeSttSocket(session.socket))
        .catch(() => undefined);
    },
  };
}

/**
 * Race a session mint against the turn's absolute arming deadline (measured
 * from `armStartedAtMs`). Resolves "arm-timeout" instead of rejecting so the
 * caller can fall back without cancelling the mint — the abandoned promise
 * stays valid as the next turn's prewarm.
 */
export function raceSttArmDeadline(
  promise: Promise<RealtimeSttSession>,
  armStartedAtMs: number,
  timeoutMs: number,
): Promise<RealtimeSttSession | "arm-timeout"> {
  const remainingMs = Math.max(
    250,
    timeoutMs - (performance.now() - armStartedAtMs),
  );
  return Promise.race([
    promise,
    new Promise<"arm-timeout">((resolve) => {
      window.setTimeout(() => resolve("arm-timeout"), remainingMs);
    }),
  ]);
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
