"use client";

import * as React from "react";
import type { DashboardScreenContext } from "@/features/dashboard/screen-context";
import {
  fetchHivemindFastContext,
  fetchWalletReadiness,
  fetchXAccountRead,
} from "./queen-fast-context";
import type { QueenVoicePhase, QueenVoiceTurn } from "./use-queen-bee-voice";
import {
  askHivemindAgent,
  createHiveTask,
  driveDashboard,
  readAgentStatus,
  rememberPreference,
} from "./use-queen-bee-realtime";

type GeminiLiveSessionInfo = {
  ok?: boolean;
  token?: string;
  wsUrl?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  inputSampleRate?: number;
  outputSampleRate?: number;
  tools?: Array<{
    type?: string;
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  error?: string;
};

type GeminiLiveMessage = Record<string, unknown>;

const ECHO_CANCELLED_AUDIO: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

const CONNECT_TIMEOUT_MS = 20_000;

function base64ToPcmBytes(base64: string): Int16Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function pcm16ToBase64(pcm: Int16Array): string {
  let binary = "";
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function resamplePcm16(input: Float32Array, inputRate: number, outputRate: number): Int16Array {
  const ratio = inputRate / outputRate;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function recordArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function useQueenBeeGeminiLive(
  active: boolean,
  muted: boolean,
  openingLine = "",
  onDriveDashboard?: (command: string) => Promise<string>,
  screenContext?: DashboardScreenContext,
) {
  const [phase, setPhase] = React.useState<QueenVoicePhase>("starting");
  const [error, setError] = React.useState("");
  const [turns, setTurns] = React.useState<QueenVoiceTurn[]>([]);
  const [speechDetected, setSpeechDetected] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [sessionSerial, setSessionSerial] = React.useState(0);
  const mutedRef = React.useRef(muted);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  const micAnalyserRef = React.useRef<AnalyserNode | null>(null);
  const screenContextRef = React.useRef(screenContext);
  const driveDashboardRef = React.useRef(onDriveDashboard);
  // Set by the live session effect; lets the overlay's camera loop stream webcam
  // frames into the Gemini Live session as native realtime video input.
  const sendVideoFrameRef = React.useRef<((base64Jpeg: string) => void) | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
    const track = trackRef.current;
    if (track) track.enabled = !muted;
  }, [muted]);

  React.useEffect(() => {
    screenContextRef.current = screenContext;
  }, [screenContext]);

  React.useEffect(() => {
    driveDashboardRef.current = onDriveDashboard;
  }, [onDriveDashboard]);

  React.useEffect(() => {
    if (!active) return undefined;

    const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass || typeof WebSocket === "undefined") {
      queueMicrotask(() => {
        setPhase("error");
        setError("This browser or webview cannot run the Gemini Live audio session.");
        setFailed(true);
      });
      return undefined;
    }

    let cancelled = false;
    let nextTurnId = 1;
    let ws: WebSocket | null = null;
    let audioContext: AudioContext | null = null;
    let localStream: MediaStream | null = null;
    let micSource: MediaStreamAudioSourceNode | null = null;
    let micProcessor: ScriptProcessorNode | null = null;
    let micSilentGain: GainNode | null = null;
    let connectTimeout = 0;
    let outputRate = 24_000;
    let inputRate = 16_000;
    let nextPlayTime = 0;
    let liveQueenTurnId = 0;
    let liveQueenText = "";
    let liveUserTurnId = 0;
    let liveUserText = "";
    let lastUserTranscript = "";
    let lastQueenUtterance = "";
    let pendingQueenDetail = "";
    const playing = new Set<AudioBufferSourceNode>();
    const handledCalls = new Set<string>();

    const addTurn = (who: QueenVoiceTurn["who"], text: string, live = false, detail?: string) => {
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
        current.map((turn) => (turn.id === id ? { ...turn, text, live } : turn)),
      );
    };
    const ensureUserTurn = () => {
      if (!liveUserTurnId) liveUserTurnId = addTurn("you", "...", true);
      return liveUserTurnId;
    };
    const finalizeUserTurn = () => {
      const text = liveUserText.trim();
      if (!text) return;
      if (liveUserTurnId) updateTurn(liveUserTurnId, text);
      else addTurn("you", text);
      lastUserTranscript = text;
      liveUserTurnId = 0;
      liveUserText = "";
    };
    const addPendingDetail = (detail: string) => {
      const trimmed = detail.trim();
      if (!trimmed) return;
      pendingQueenDetail = pendingQueenDetail
        ? `${pendingQueenDetail}\n\n---\n\n${trimmed}`
        : trimmed;
    };
    const fail = (message: string) => {
      if (cancelled) return;
      setPhase("error");
      setError(message);
      setFailed(true);
    };
    const send = (payload: unknown) => {
      if (!cancelled && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };
    // Gemini Live accepts realtime video frames natively alongside the audio
    // stream; each frame is a base64 JPEG the model sees in near real time.
    sendVideoFrameRef.current = (base64Jpeg: string) => {
      send({ realtimeInput: { video: { data: base64Jpeg, mimeType: "image/jpeg" } } });
    };
    const flushPlayback = () => {
      playing.forEach((node) => {
        try {
          node.stop();
        } catch {
          // Node may already have stopped.
        }
      });
      playing.clear();
      nextPlayTime = 0;
    };
    const enqueuePcm = (pcm: Int16Array) => {
      if (!audioContext || !pcm.length) return;
      const float = new Float32Array(pcm.length);
      for (let index = 0; index < pcm.length; index += 1) {
        float[index] = (pcm[index] ?? 0) / 0x8000;
      }
      const buffer = audioContext.createBuffer(1, float.length, outputRate);
      buffer.copyToChannel(float, 0);
      const node = audioContext.createBufferSource();
      node.buffer = buffer;
      node.connect(audioContext.destination);
      const startAt = Math.max(audioContext.currentTime + 0.02, nextPlayTime);
      node.start(startAt);
      nextPlayTime = startAt + buffer.duration;
      playing.add(node);
      node.onended = () => {
        playing.delete(node);
        if (!cancelled && playing.size === 0) setPhase("listening");
      };
      setPhase("speaking");
    };
    const startMic = () => {
      if (!audioContext || !localStream) return;
      micSource = audioContext.createMediaStreamSource(localStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      micSource.connect(analyser);
      micAnalyserRef.current = analyser;
      micProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      micSilentGain = audioContext.createGain();
      micSilentGain.gain.value = 0;
      micSource.connect(micProcessor);
      micProcessor.connect(micSilentGain);
      micSilentGain.connect(audioContext.destination);
      micProcessor.onaudioprocess = (event) => {
        if (cancelled || mutedRef.current || !audioContext || ws?.readyState !== WebSocket.OPEN) return;
        const pcm = resamplePcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate, inputRate);
        if (pcm.byteLength) {
          send({ realtimeInput: { audio: { data: pcm16ToBase64(pcm), mimeType: `audio/pcm;rate=${inputRate}` } } });
        }
      };
    };

    async function executeTool(name: string, args: Record<string, unknown>) {
      const context = screenContextRef.current;
      if (name === "create_hive_task") {
        return createHiveTask(args, {
          latestUserTranscript: lastUserTranscript,
          lastQueenUtterance,
        });
      }
      if (name === "ask_hivemind_agent" || name === "use_hive_capability") {
        const result = await askHivemindAgent(args, context, {
          preferBuiltInCapability: name === "use_hive_capability",
        });
        addPendingDetail(result.detail);
        return result.speech;
      }
      if (name === "drive_dashboard") {
        return driveDashboard(args, driveDashboardRef.current);
      }
      if (name === "remember_preference") {
        return rememberPreference(args);
      }
      if (name === "read_wallet_readiness") {
        const output = await fetchWalletReadiness(context);
        addPendingDetail(output);
        return output;
      }
      if (name === "read_hivemind_context") {
        const output = await fetchHivemindFastContext(String(args.query ?? ""), context);
        addPendingDetail(output);
        return output;
      }
      if (name === "read_x_account") {
        const output = await fetchXAccountRead(args);
        addPendingDetail(output);
        return output;
      }
      if (name === "read_agent_status") {
        return readAgentStatus(args);
      }
      return `Unknown tool: ${name}`;
    }

    async function connect() {
      try {
        setPhase("starting");
        setError("");
        setTurns([]);
        setFailed(false);
        setSessionSerial((serial) => serial + 1);
        const sessionResponse = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "gemini-live-session" }),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        const session = ((await sessionResponse.json().catch(() => null)) ?? {}) as GeminiLiveSessionInfo;
        if (!sessionResponse.ok || !session.ok || !session.token || !session.wsUrl) {
          throw new Error(session.error || `Gemini Live session returned HTTP ${sessionResponse.status}.`);
        }
        if (cancelled) return;
        outputRate = session.outputSampleRate || 24_000;
        inputRate = session.inputSampleRate || 16_000;
        audioContext = new AudioContextClass();
        await audioContext.resume().catch(() => undefined);
        localStream = await navigator.mediaDevices.getUserMedia({ audio: ECHO_CANCELLED_AUDIO });
        const track = localStream.getAudioTracks()[0] ?? null;
        trackRef.current = track;
        if (track) track.enabled = !mutedRef.current;
        if (cancelled) return;

        const socketModel = session.model?.startsWith("models/")
          ? session.model
          : `models/${session.model || ""}`;
        const geminiTools = session.tools?.length
          ? [{
              functionDeclarations: session.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            }]
          : undefined;
        ws = new WebSocket(`${session.wsUrl}?access_token=${encodeURIComponent(session.token)}`);
        let connected = false;
        connectTimeout = window.setTimeout(() => {
          if (!cancelled && !connected) {
            fail("Gemini Live did not finish connecting. Check the key and network, then retry.");
          }
        }, CONNECT_TIMEOUT_MS);

        ws.addEventListener("open", () => {
          send({
            setup: {
              model: socketModel,
              generationConfig: {
                responseModalities: ["AUDIO"],
                ...(session.voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: session.voice } } } } : {}),
              },
              ...(session.instructions ? { systemInstruction: { parts: [{ text: session.instructions }] } } : {}),
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              ...(geminiTools ? { tools: geminiTools } : {}),
            },
          });
        });

        ws.addEventListener("message", async (event: MessageEvent) => {
          const raw = typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(await (event.data as Blob).arrayBuffer().catch(() => new ArrayBuffer(0)));
          let message: GeminiLiveMessage;
          try {
            message = JSON.parse(raw) as GeminiLiveMessage;
          } catch {
            return;
          }
          if (message.setupComplete) {
            if (connectTimeout) window.clearTimeout(connectTimeout);
            connected = true;
            setPhase("listening");
            startMic();
            const line = openingLine.trim();
            if (line) {
              send({
                clientContent: {
                  turns: [{ role: "user", parts: [{ text: `Say exactly this brief opening line, then wait for Liam: ${JSON.stringify(line)}` }] }],
                  turnComplete: true,
                },
              });
            }
            return;
          }
          const serverContent = message.serverContent as Record<string, unknown> | undefined;
          if (serverContent) {
            const modelTurn = serverContent.modelTurn as { parts?: Array<{ inlineData?: { data?: string } }> } | undefined;
            for (const part of modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                finalizeUserTurn();
                enqueuePcm(base64ToPcmBytes(part.inlineData.data));
              }
            }
            const outputText = (serverContent.outputTranscription as { text?: string } | undefined)?.text;
            if (outputText) {
              liveQueenText = `${liveQueenText}${outputText}`.slice(-1_000);
              if (!liveQueenTurnId) {
                liveQueenTurnId = addTurn("queen", liveQueenText, true, pendingQueenDetail || undefined);
                pendingQueenDetail = "";
              } else {
                updateTurn(liveQueenTurnId, liveQueenText, true);
              }
            }
            const inputText = (serverContent.inputTranscription as { text?: string } | undefined)?.text;
            if (inputText) {
              setSpeechDetected(true);
              liveUserText = inputText.slice(-1_000);
              updateTurn(ensureUserTurn(), liveUserText.trim() || "...", true);
            }
            if (serverContent.interrupted) flushPlayback();
            if (serverContent.turnComplete) {
              if (liveQueenTurnId) updateTurn(liveQueenTurnId, liveQueenText);
              if (liveQueenText) lastQueenUtterance = liveQueenText;
              liveQueenTurnId = 0;
              liveQueenText = "";
              setSpeechDetected(false);
              if (playing.size === 0) setPhase("listening");
            }
            return;
          }
          const toolCall = message.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> } | undefined;
          if (toolCall?.functionCalls?.length) {
            finalizeUserTurn();
            for (const call of toolCall.functionCalls) {
              const callId = call.id || call.name || "";
              if (!callId || !call.name || handledCalls.has(callId)) continue;
              handledCalls.add(callId);
              setPhase("thinking");
              const output = await executeTool(call.name, recordArgs(call.args));
              send({
                toolResponse: {
                  functionResponses: [{ id: call.id, name: call.name, response: { result: output } }],
                },
              });
            }
          }
        });

        ws.addEventListener("error", () => fail("The Gemini Live connection failed."));
        ws.addEventListener("close", (event: CloseEvent) => {
          if (cancelled) return;
          if (event.code === 1000 || event.code === 1005) setPhase("listening");
          else fail(`Gemini Live closed (${event.code})${event.reason ? `: ${event.reason}` : ""}.`);
        });
      } catch (connectError) {
        fail(connectError instanceof Error ? connectError.message : "Could not connect Gemini Live audio.");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (connectTimeout) window.clearTimeout(connectTimeout);
      flushPlayback();
      try {
        if (micProcessor) micProcessor.onaudioprocess = null;
        micProcessor?.disconnect();
        micSilentGain?.disconnect();
        micSource?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      try {
        ws?.close(1000, "queen voice closed");
      } catch {
        // Socket may already be closing.
      }
      localStream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
      micAnalyserRef.current = null;
      setSpeechDetected(false);
      void audioContext?.close().catch(() => undefined);
    };
  }, [active, openingLine]);

  const sendVideoFrame = React.useCallback((base64Jpeg: string) => {
    if (base64Jpeg) sendVideoFrameRef.current?.(base64Jpeg);
  }, []);

  return { phase, error, turns, speechDetected, failed, micAnalyserRef, sessionSerial, sendVideoFrame };
}
