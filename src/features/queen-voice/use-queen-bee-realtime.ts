"use client";

import * as React from "react";
import {
  closeRealtimeSttSocket,
  pcm16ToBase64,
  prepareRealtimeSttSession,
  resampleToPcm16,
} from "./realtime-stt";
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

// Past this, give up and let the overlay fall back to the STT+TTS pipeline
// instead of holding the user on "Connecting...".
const CONNECT_TIMEOUT_MS = 12_000;

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

async function askHivemindAgent(args: Record<string, unknown>) {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return "The relayed request was empty, so nothing was done.";
  try {
    const response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "agent-turn", message }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      text?: string;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      return `The HivemindOS agent could not handle that: ${data?.error || `HTTP ${response.status}`}.`;
    }
    return (
      data.text || "The agent completed the request without a spoken result."
    );
  } catch (turnError) {
    return `The HivemindOS agent could not be reached: ${turnError instanceof Error ? turnError.message : "request failed"}.`;
  }
}

async function driveDashboard(
  args: Record<string, unknown>,
  pilot: ((command: string) => Promise<string>) | undefined,
) {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return "No on-screen command was given.";
  if (!pilot) return "The dashboard isn't available to drive right now.";
  try {
    const reply = await pilot(command);
    return reply || "Done.";
  } catch (driveError) {
    return `I couldn't do that on screen: ${driveError instanceof Error ? driveError.message : "request failed"}.`;
  }
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
  onDriveDashboard?: (command: string) => Promise<string>,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const mutedRef = React.useRef(muted);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  const onFailedRef = React.useRef(onFailed);
  const onDriveDashboardRef = React.useRef(onDriveDashboard);

  React.useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  React.useEffect(() => {
    onDriveDashboardRef.current = onDriveDashboard;
  }, [onDriveDashboard]);

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
    const dropTurn = (id: number) => {
      setTurns((current) => current.filter((turn) => turn.id !== id));
    };

    let liveQueenTurnId = 0;
    let liveQueenText = "";
    let liveUserTurnId = 0;
    let liveUserText = "";
    let speechActive = false;
    // Parallel transcription-intent session purely for live captions: the
    // speech-to-speech session only transcribes input AFTER a turn commits,
    // so on its own the user's words appear as late as the reply.
    let captionSocket: WebSocket | null = null;
    let captionContext: AudioContext | null = null;
    let captionProcessor: ScriptProcessorNode | null = null;
    let captionsLive = false;
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

    const ensureUserTurn = () => {
      if (!liveUserTurnId) liveUserTurnId = addTurn("you", "...", true);
      return liveUserTurnId;
    };

    async function startCaptionStream() {
      try {
        const socket = await prepareRealtimeSttSession();
        if (cancelled || !localStream) {
          closeRealtimeSttSocket(socket);
          return;
        }
        captionSocket = socket;
        socket.addEventListener("message", (event: MessageEvent<string>) => {
          let payload: RealtimeEvent;
          try {
            payload = JSON.parse(event.data) as RealtimeEvent;
          } catch {
            return;
          }
          if (
            payload.type ===
              "conversation.item.input_audio_transcription.delta" &&
            typeof payload.delta === "string" &&
            payload.delta
          ) {
            captionsLive = true;
            // Late deltas after the turn finalized would ghost a new row.
            if (!liveUserTurnId && !speechActive) return;
            liveUserText += payload.delta;
            updateTurn(ensureUserTurn(), liveUserText.trim() || "...", true);
          }
          if (
            payload.type ===
            "conversation.item.input_audio_transcription.completed"
          ) {
            // The caption item closed; the next utterance starts fresh.
            liveUserText = "";
          }
        });
        const audioWindow = window as Window &
          typeof globalThis & { webkitAudioContext?: typeof AudioContext };
        const AudioContextClass =
          audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass) return;
        captionContext = new AudioContextClass();
        const source = captionContext.createMediaStreamSource(localStream);
        captionProcessor = captionContext.createScriptProcessor(4096, 1, 1);
        const silentGain = captionContext.createGain();
        silentGain.gain.value = 0;
        source.connect(captionProcessor);
        captionProcessor.connect(silentGain);
        silentGain.connect(captionContext.destination);
        const activeContext = captionContext;
        captionProcessor.onaudioprocess = (event) => {
          if (cancelled || mutedRef.current) return;
          if (socket.readyState !== WebSocket.OPEN) return;
          const pcm = resampleToPcm16(
            event.inputBuffer.getChannelData(0),
            activeContext.sampleRate,
          );
          if (pcm.byteLength) {
            socket.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: pcm16ToBase64(pcm),
              }),
            );
          }
        };
      } catch (captionError) {
        console.warn(
          "[queen-voice] live captions unavailable; falling back to post-turn transcripts:",
          captionError instanceof Error ? captionError.message : captionError,
        );
      }
    }

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
        speechActive = true;
        // Instant feedback: the live caption row appears as speech begins.
        ensureUserTurn();
      }
      if (payload.type === "input_audio_buffer.speech_stopped") {
        setSpeechDetected(false);
        speechActive = false;
        // Close out the caption item so the next utterance starts fresh.
        if (captionSocket?.readyState === WebSocket.OPEN) {
          captionSocket.send(
            JSON.stringify({ type: "input_audio_buffer.commit" }),
          );
        }
      }
      if (
        payload.type === "conversation.item.input_audio_transcription.delta" &&
        typeof payload.delta === "string" &&
        payload.delta &&
        !captionsLive
      ) {
        // Fallback captions only: the speech-to-speech session transcribes
        // post-commit, so the parallel caption stream owns live text.
        liveUserText += payload.delta;
        updateTurn(ensureUserTurn(), liveUserText.trim() || "...", true);
      }
      if (
        payload.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const finalTranscript = (
          (typeof payload.transcript === "string" ? payload.transcript : "") ||
          liveUserText
        ).trim();
        if (liveUserTurnId) {
          if (finalTranscript) updateTurn(liveUserTurnId, finalTranscript);
          else dropTurn(liveUserTurnId);
        } else if (finalTranscript) {
          addTurn("you", finalTranscript);
        }
        liveUserTurnId = 0;
        liveUserText = "";
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
            : call.name === "ask_hivemind_agent"
              ? await askHivemindAgent(call.args)
              : call.name === "drive_dashboard"
                ? await driveDashboard(call.args, onDriveDashboardRef.current)
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
        const startedAt = performance.now();
        const mark = (label: string) =>
          console.info(
            `[queen-voice] ${label} +${Math.round(performance.now() - startedAt)}ms`,
          );

        // Session mint (server -> OpenAI) and mic permission are independent;
        // running them serially was costing whole seconds per connect.
        const [sessionResponse, mediaStream] = await Promise.all([
          fetch("/api/queen-bee/voice", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "realtime-session" }),
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          }),
          navigator.mediaDevices.getUserMedia({ audio: ECHO_CANCELLED_AUDIO }),
        ]);
        mark("session+mic ready");
        sessionInfo = ((await sessionResponse.json().catch(() => null)) ??
          {}) as RealtimeSessionInfo;
        if (
          !sessionResponse.ok ||
          !sessionInfo.ok ||
          !sessionInfo.clientSecret
        ) {
          mediaStream.getTracks().forEach((track) => track.stop());
          throw new Error(
            sessionInfo.error ||
              `Realtime session returned HTTP ${sessionResponse.status}.`,
          );
        }
        localStream = mediaStream;
        if (cancelled) return;
        // Live captions run on their own transcription stream, in parallel.
        void startCaptionStream();
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
        mark("sdp offer ready");
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
        mark("sdp answer applied");
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
      if (captionProcessor) captionProcessor.onaudioprocess = null;
      try {
        captionProcessor?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      closeRealtimeSttSocket(captionSocket);
      void captionContext?.close().catch(() => undefined);
      localStream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    };
  }, [active]);

  return { phase, error, turns, speechDetected, failed };
}
