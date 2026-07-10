"use client";

import * as React from "react";
import { fetchAgentStatusAnswer } from "@/features/dashboard/agent-status-fetch";
import type { DashboardScreenContext } from "@/features/dashboard/screen-context";
import {
  isHivemindFastContextCommand,
  isWalletReadinessCommand,
} from "@/lib/services/queen-bee/queen-brain";
import { isLikelyEcho } from "./echo-detection";
import {
  actingWalletSourceFromContext,
  fetchHivemindFastContext,
  fetchWalletReadiness,
  fetchXAccountRead,
  withScreenContext,
} from "./queen-fast-context";
import {
  closeRealtimeSttSocket,
  pcm16ToBase64,
  prepareRealtimeSttSession,
  resampleToPcm16,
} from "./realtime-stt";
import type { QueenVoicePhase, QueenVoiceTurn } from "./use-queen-bee-voice";
import {
  createStreamOutputAnalyser,
  useQueenVoiceLevelPump,
} from "@/lib/audio/queen-voice-amplitude";
import {
  voiceTaskApprovalPrompt,
  voiceTaskSubmissionAuthorized,
} from "@/lib/services/queen-bee/voice-task-approval";

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

// How long after the Queen stops speaking a transcribed "user" turn is still
// checked for being her own echo. The mic stays open for barge-in, so her
// loudspeaker tail can keep landing as input for a beat after she finishes.
const RECENT_QUEEN_ECHO_MS = 3_000;

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

// Returns the spoken summary fed back to the model, plus an optional richer
// `detail` (markdown) the overlay can surface in a "what she found" modal.
export async function askHivemindAgent(
  args: Record<string, unknown>,
  screenContext?: DashboardScreenContext,
  options: { preferBuiltInCapability?: boolean } = {},
): Promise<{ speech: string; detail: string }> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message)
    return {
      speech: "The relayed request was empty, so nothing was done.",
      detail: "",
    };
  if (isWalletReadinessCommand(message)) {
    const result = await fetchWalletReadiness(screenContext);
    return { speech: result, detail: result };
  }
  if (isHivemindFastContextCommand(message)) {
    const result = await fetchHivemindFastContext(message, screenContext);
    return { speech: result, detail: result };
  }
  try {
    const response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "agent-turn",
        message: withScreenContext(message, screenContext),
        actingWallet: actingWalletSourceFromContext(screenContext),
        preferBuiltInCapability: options.preferBuiltInCapability === true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      text?: string;
      detail?: string;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      return {
        speech: `The HivemindOS agent could not handle that: ${data?.error || `HTTP ${response.status}`}.`,
        detail: "",
      };
    }
    return {
      speech:
        data.text || "The agent completed the request without a spoken result.",
      detail: typeof data.detail === "string" ? data.detail : "",
    };
  } catch (turnError) {
    return {
      speech: `The HivemindOS agent could not be reached: ${turnError instanceof Error ? turnError.message : "request failed"}.`,
      detail: "",
    };
  }
}

export async function driveDashboard(
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

export async function rememberPreference(args: Record<string, unknown>) {
  const preference =
    typeof args.preference === "string" ? args.preference.trim() : "";
  if (!preference) return "Nothing was saved: the preference was empty.";
  try {
    const response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remember-preference", preference }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      return `That preference could not be saved: ${data?.error || `HTTP ${response.status}`}.`;
    }
    return "Saved - I'll remember that for our future chats.";
  } catch (prefError) {
    return `That preference could not be saved: ${prefError instanceof Error ? prefError.message : "request failed"}.`;
  }
}

export async function createHiveTask(
  args: Record<string, unknown>,
  approval: { latestUserTranscript?: string; lastQueenUtterance?: string } = {},
) {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return "No task was created: the work request was empty.";
  const history = approval.lastQueenUtterance
    ? [{ who: "queen" as const, text: approval.lastQueenUtterance }]
    : [];
  if (!voiceTaskSubmissionAuthorized(approval.latestUserTranscript || "", history)) {
    return voiceTaskApprovalPrompt({
      title: typeof args.title === "string" ? args.title : "",
      message,
    });
  }
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

export async function readAgentStatus(args: Record<string, unknown>) {
  // Shared with the typed chat executor: reads live fleet telemetry and, when a
  // matched agent is unhealthy, appends a nudge to OFFER a create_hive_task fix.
  // The Queen relays the result and only creates the task once the user agrees.
  const agentName = typeof args.agentName === "string" ? args.agentName : "";
  return fetchAgentStatusAnswer(agentName);
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
  openingLine = "",
  screenContext?: DashboardScreenContext,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  // Bumped per (re)connect alongside the `turns` reset; the overlay's history
  // bridge keys its id namespace on this — see useQueenBeeVoice.sessionSerial.
  const [sessionSerial, setSessionSerial] = React.useState(0);
  const mutedRef = React.useRef(muted);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  // Analyser built off her remote WebRTC audio track, read by the fleet
  // voice-reactive animation while she speaks. Analysis only — the <audio>
  // element still does the actual playback.
  const queenOutputAnalyserRef = React.useRef<AnalyserNode | null>(null);
  useQueenVoiceLevelPump(queenOutputAnalyserRef, phase === "speaking");
  // Analyser on the MIC input (tapped off the caption context), exposed for
  // the control bar's live input waveform.
  const micAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const onFailedRef = React.useRef(onFailed);
  const onDriveDashboardRef = React.useRef(onDriveDashboard);
  const screenContextRef = React.useRef(screenContext);

  React.useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  React.useEffect(() => {
    onDriveDashboardRef.current = onDriveDashboard;
  }, [onDriveDashboard]);

  React.useEffect(() => {
    screenContextRef.current = screenContext;
  }, [screenContext]);

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
    let queenOutputTap: { analyser: AnalyserNode; dispose: () => void } | null = null;
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
      detail?: string,
    ) => {
      const id = nextTurnId;
      nextTurnId += 1;
      setTurns((current) => [
        ...current.map((turn) => ({ ...turn, live: false })),
        { id, who, text, live, detail },
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
    // Detail content from a tool call, attached to the spoken turn it produces
    // so the overlay can offer a "what she found" modal on that turn.
    let pendingQueenDetail = "";
    // The Queen's last words linger briefly after she stops so a just-committed
    // input turn can still be matched against them (liveQueenText is cleared the
    // instant her response ends).
    let lastQueenUtterance = "";
    let lastQueenEndedAt = 0;
    let lastFinalUserTranscript = "";
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
    const createQueenResponse = (instructions?: string) => {
      send(
        instructions
          ? { type: "response.create", response: { instructions } }
          : { type: "response.create" },
      );
    };

    let sessionInfo: RealtimeSessionInfo = {};
    const openingText = openingLine.trim();

    const ensureUserTurn = () => {
      if (!liveUserTurnId) liveUserTurnId = addTurn("you", "...", true);
      return liveUserTurnId;
    };

    async function startCaptionStream() {
      try {
        // Continuous mode: live pre-commit deltas are the whole point here —
        // this stream captions the user WHILE they talk to the s2s session.
        const { socket } = await prepareRealtimeSttSession("continuous");
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
        // Side-tap for the control bar's live mic waveform (analysis only).
        const micAnalyser = captionContext.createAnalyser();
        micAnalyser.fftSize = 1024;
        source.connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;
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
              // Far-field reduction filters laptop/loudspeaker-mic bleed before
              // it reaches VAD and the model, cutting false turn detections on
              // the Queen's own echo (per OpenAI's near_field/far_field guide).
              noise_reduction: { type: "far_field" },
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "en",
              },
              // create_response:false makes the CLIENT the sole trigger of a
              // reply (see the echo gate in the transcription-completed handler)
              // so the Queen can never auto-answer her own loudspeaker bleed.
              // interrupt_response stays true so the server still natively
              // truncates her in-flight audio when the user genuinely barges in
              // — the only reliable way to stop buffered audio over WebRTC.
              turn_detection: {
                type: "semantic_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
          },
          ...(sessionInfo.tools?.length
            ? { tools: sessionInfo.tools, tool_choice: "auto" }
            : {}),
        },
      });
      if (openingText) {
        createQueenResponse(
          `Say exactly this brief opening line, then wait for Liam: ${JSON.stringify(openingText)}`,
        );
      }
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
        // Is this really the user, or the Queen's own loudspeaker audio bleeding
        // back into the still-open mic? Compare against what she's saying right
        // now, or just said within the recency window.
        const queenReference =
          liveQueenTurnId !== 0 ? liveQueenText : lastQueenUtterance;
        const withinEchoWindow =
          liveQueenTurnId !== 0 ||
          Date.now() - lastQueenEndedAt < RECENT_QUEEN_ECHO_MS;
        const isEcho =
          !finalTranscript ||
          (withinEchoWindow && isLikelyEcho(finalTranscript, queenReference));
        if (isEcho) {
          // Drop the ghost row and stay silent: she never answers herself.
          if (liveUserTurnId) dropTurn(liveUserTurnId);
          liveUserTurnId = 0;
          liveUserText = "";
          return;
        }
        if (liveUserTurnId) {
          updateTurn(liveUserTurnId, finalTranscript);
        } else {
          addTurn("you", finalTranscript);
        }
        lastFinalUserTranscript = finalTranscript;
        liveUserTurnId = 0;
        liveUserText = "";
        // With create_response:false the server no longer auto-replies, so the
        // client is now the sole trigger for the Queen's spoken answer.
        createQueenResponse();
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
          liveQueenTurnId = addTurn(
            "queen",
            liveQueenText,
            true,
            pendingQueenDetail || undefined,
          );
          pendingQueenDetail = "";
        } else {
          updateTurn(liveQueenTurnId, liveQueenText, true);
        }
      }
      if (payload.type === "response.done") {
        if (liveQueenTurnId) updateTurn(liveQueenTurnId, liveQueenText);
        if (liveQueenText) {
          lastQueenUtterance = liveQueenText;
          lastQueenEndedAt = Date.now();
        }
        liveQueenTurnId = 0;
        liveQueenText = "";
        setPhase("listening");
      }
      const call = parseFunctionCall(payload);
      if (call && !handledFunctionCalls.has(call.callId)) {
        handledFunctionCalls.add(call.callId);
        setPhase("thinking");
        let output: string;
        const addPendingDetail = (detail: string) => {
          const trimmed = detail.trim();
          if (!trimmed) return;
          pendingQueenDetail = pendingQueenDetail
            ? `${pendingQueenDetail}\n\n---\n\n${trimmed}`
            : trimmed;
        };
        const liveScreenContext = screenContextRef.current;
        if (call.name === "create_hive_task") {
          output = await createHiveTask(call.args, {
            latestUserTranscript: lastFinalUserTranscript,
            lastQueenUtterance,
          });
        } else if (call.name === "ask_hivemind_agent" || call.name === "use_hive_capability") {
          const result = await askHivemindAgent(call.args, liveScreenContext, {
            preferBuiltInCapability: call.name === "use_hive_capability",
          });
          output = result.speech;
          // Hold the findings for the spoken turn this tool call triggers.
          addPendingDetail(result.detail);
        } else if (call.name === "drive_dashboard") {
          output = await driveDashboard(call.args, onDriveDashboardRef.current);
        } else if (call.name === "remember_preference") {
          output = await rememberPreference(call.args);
        } else if (call.name === "read_wallet_readiness") {
          output = await fetchWalletReadiness(liveScreenContext);
          addPendingDetail(output);
        } else if (call.name === "read_hivemind_context") {
          output = await fetchHivemindFastContext(
            String(call.args.query ?? ""),
            liveScreenContext,
          );
          addPendingDetail(output);
        } else if (call.name === "read_x_account") {
          output = await fetchXAccountRead(call.args);
          addPendingDetail(output);
        } else if (call.name === "read_agent_status") {
          output = await readAgentStatus(call.args);
        } else {
          output = `Unknown tool: ${call.name}`;
        }
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output,
          },
        });
        createQueenResponse();
      }
    });

    peer.addEventListener("track", (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      void audio.play().catch((playError) => {
        fail(
          playError instanceof Error
            ? `Reply audio was blocked: ${playError.message}`
            : "Reply audio was blocked by the webview.",
        );
      });
      // Tap her remote audio for the fleet voice-reactive animation. Best-effort:
      // a blocked analysis context just leaves the pulse idle, playback is
      // unaffected. Verify on-device (WKWebView may keep the context suspended).
      queenOutputTap?.dispose();
      queenOutputTap = createStreamOutputAnalyser(stream);
      queenOutputAnalyserRef.current = queenOutputTap?.analyser ?? null;
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
        setSessionSerial((serial) => serial + 1);
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
      queenOutputTap?.dispose();
      queenOutputTap = null;
      queenOutputAnalyserRef.current = null;
      micAnalyserRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    };
  }, [active, openingLine]);

  return { phase, error, turns, speechDetected, failed, micAnalyserRef, sessionSerial };
}
