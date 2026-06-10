"use client";

import * as React from "react";
import type { QueenVoicePhase, QueenVoiceTurn } from "./use-queen-bee-voice";

type RealtimeSessionInfo = {
  ok?: boolean;
  clientSecret?: string;
  instructions?: string;
  tools?: unknown[];
  error?: string;
};

type RealtimeEvent = Record<string, unknown>;

const ECHO_CANCELLED_AUDIO: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

const CONNECT_TIMEOUT_MS = 20_000;

function parseFunctionCall(
  event: RealtimeEvent,
): { callId: string; name: string; args: Record<string, unknown> } | null {
  const parseArgs = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== "string") return {};
    try {
      const value = JSON.parse(raw) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  if (
    event.type === "response.function_call_arguments.done" &&
    typeof event.call_id === "string" &&
    typeof event.name === "string"
  ) {
    return {
      callId: event.call_id,
      name: event.name,
      args: parseArgs(event.arguments),
    };
  }
  if (
    event.type === "response.output_item.done" &&
    event.item &&
    typeof event.item === "object"
  ) {
    const item = event.item as Record<string, unknown>;
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string"
    ) {
      return {
        callId: item.call_id,
        name: item.name,
        args: parseArgs(item.arguments),
      };
    }
  }
  return null;
}

async function createHiveTask(args: Record<string, unknown>) {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return "No task was created: the work request was empty.";
  try {
    const response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "submit-task",
        title: typeof args.title === "string" ? args.title : "",
        message,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      summary?: string;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      return `The task could not be created: ${data?.error || `HTTP ${response.status}`}.`;
    }
    return data.summary || "The task was created on the work board.";
  } catch (taskError) {
    return `The task could not be created: ${taskError instanceof Error ? taskError.message : "request failed"}.`;
  }
}

/**
 * Full speech-to-speech Queen Bee session over OpenAI Realtime (WebRTC):
 * semantic turn detection, live captions for both sides, and a
 * create_hive_task tool wired into the Queen Bee control plane. Reports
 * `failed` so the overlay can fall back to the STT + TTS pipeline.
 */
export function useQueenBeeRealtime(
  active: boolean,
  muted: boolean,
  onFailed?: () => void,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const mutedRef = React.useRef(muted);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  const onFailedRef = React.useRef(onFailed);

  React.useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  React.useEffect(() => {
    mutedRef.current = muted;
    const track = trackRef.current;
    if (track) track.enabled = !muted;
  }, [muted]);

  React.useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let nextTurnId = 1;
    let connectTimeout = 0;
    let localStream: MediaStream | null = null;
    const handledFunctionCalls = new Set<string>();
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events");
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.dataset.queenVoiceAudio = "true";
    audio.style.display = "none";
    document.body.appendChild(audio);

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

    let liveQueenTurnId = 0;
    let liveQueenText = "";
    const fail = (message: string) => {
      if (cancelled) return;
      setPhase("error");
      setError(message);
      setFailed(true);
      onFailedRef.current?.();
    };
    const send = (payload: unknown) => {
      if (!cancelled && channel.readyState === "open") {
        channel.send(JSON.stringify(payload));
      }
    };

    let sessionInfo: RealtimeSessionInfo = {};

    channel.addEventListener("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          ...(sessionInfo.instructions
            ? { instructions: sessionInfo.instructions }
            : {}),
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "en",
              },
              turn_detection: { type: "semantic_vad" },
            },
          },
          ...(sessionInfo.tools?.length
            ? { tools: sessionInfo.tools, tool_choice: "auto" }
            : {}),
        },
      });
    });

    channel.addEventListener("message", async (event) => {
      let payload: RealtimeEvent;
      try {
        payload = JSON.parse(String(event.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (payload.type === "error") {
        const detail =
          payload.error && typeof payload.error === "object"
            ? (payload.error as Record<string, unknown>)
            : {};
        fail(
          String(detail.message || detail.code || "Realtime session error."),
        );
        return;
      }
      if (payload.type === "input_audio_buffer.speech_started") {
        setSpeechDetected(true);
      }
      if (payload.type === "input_audio_buffer.speech_stopped") {
        setSpeechDetected(false);
      }
      if (
        payload.type ===
          "conversation.item.input_audio_transcription.completed" &&
        typeof payload.transcript === "string" &&
        payload.transcript.trim()
      ) {
        addTurn("you", payload.transcript.trim());
      }
      if (
        payload.type === "response.output_audio.delta" ||
        payload.type === "response.audio.delta"
      ) {
        setPhase("speaking");
      }
      if (
        typeof payload.delta === "string" &&
        (payload.type === "response.audio_transcript.delta" ||
          payload.type === "response.output_audio_transcript.delta")
      ) {
        liveQueenText = `${liveQueenText}${payload.delta}`.slice(-1_000);
        if (!liveQueenTurnId) {
          liveQueenTurnId = addTurn("queen", liveQueenText, true);
        } else {
          updateTurn(liveQueenTurnId, liveQueenText, true);
        }
      }
      if (payload.type === "response.done") {
        if (liveQueenTurnId) updateTurn(liveQueenTurnId, liveQueenText);
        liveQueenTurnId = 0;
        liveQueenText = "";
        setPhase("listening");
      }
      const call = parseFunctionCall(payload);
      if (call && !handledFunctionCalls.has(call.callId)) {
        handledFunctionCalls.add(call.callId);
        setPhase("thinking");
        const output =
          call.name === "create_hive_task"
            ? await createHiveTask(call.args)
            : `Unknown tool: ${call.name}`;
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output,
          },
        });
        send({ type: "response.create" });
      }
    });

    peer.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch((playError) => {
        fail(
          playError instanceof Error
            ? `Reply audio was blocked: ${playError.message}`
            : "Reply audio was blocked by the webview.",
        );
      });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (cancelled) return;
      if (peer.connectionState === "connected") {
        window.clearTimeout(connectTimeout);
        setPhase("listening");
      } else if (peer.connectionState === "failed") {
        fail("The realtime voice connection failed.");
      }
    });

    async function connect() {
      try {
        setPhase("starting");
        setError("");
        setTurns([]);
        setFailed(false);

        const sessionResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "realtime-session" }),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        sessionInfo = ((await sessionResponse.json().catch(() => null)) ??
          {}) as RealtimeSessionInfo;
        if (
          !sessionResponse.ok ||
          !sessionInfo.ok ||
          !sessionInfo.clientSecret
        ) {
          throw new Error(
            sessionInfo.error ||
              `Realtime session returned HTTP ${sessionResponse.status}.`,
          );
        }
        if (cancelled) return;

        localStream = await navigator.mediaDevices.getUserMedia({
          audio: ECHO_CANCELLED_AUDIO,
        });
        if (cancelled) return;
        const track = localStream.getAudioTracks()[0] ?? null;
        trackRef.current = track;
        if (track) track.enabled = !mutedRef.current;
        localStream
          .getTracks()
          .forEach((streamTrack) => peer.addTrack(streamTrack, localStream!));

        connectTimeout = window.setTimeout(() => {
          if (!cancelled && peer.connectionState !== "connected") {
            fail("OpenAI Realtime did not finish connecting.");
          }
        }, CONNECT_TIMEOUT_MS);

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const callResponse = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sessionInfo.clientSecret}`,
              "Content-Type": "application/sdp",
            },
            body: offer.sdp || "",
          },
        );
        if (!callResponse.ok) {
          throw new Error(
            `OpenAI Realtime returned HTTP ${callResponse.status}.`,
          );
        }
        await peer.setRemoteDescription({
          type: "answer",
          sdp: await callResponse.text(),
        });
      } catch (connectError) {
        fail(
          connectError instanceof Error
            ? connectError.message
            : "Could not start realtime voice chat.",
        );
      }
    }

    void connect();

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimeout);
      try {
        channel.close();
      } catch {
        // Channel may already be closed.
      }
      peer.close();
      localStream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    };
  }, [active]);

  return { phase, error, turns, speechDetected, failed };
}
