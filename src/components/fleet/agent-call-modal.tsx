"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Cpu, Lock, MessageSquare, Mic, MicOff, Pause, Phone, PhoneOff, UserPlus, Wallet } from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import type {
  AudioCaptureOptions,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TranscriptionSegment,
} from "livekit-client";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { speechRecognitionConstructor } from "@/features/chat/chat-composer";
import type { SpeechRecognitionLike } from "@/features/chat/chat-composer";
import { playRealtimePcmStream } from "@/lib/audio/realtime-pcm-stream-player";
import {
  AgentCallControlButton,
  AgentCallGauge,
  AgentCallHexOrb,
  AgentCallWaveform,
  type AgentCallWaveStyle,
  type OrbState,
  useCallTimer,
  useTranscriptLog,
} from "./agent-call-visuals";
import { completeVoiceRun, recordAgentCaption, recordCallConnected, recordRuntimeFailure, recordToolCompleted, recordToolStarted, recordUserTranscript, type AgentCallVoiceRun } from "./agent-call-run-events";
import type { FleetAgent, FleetMachine } from "./fleet-data";
import styles from "./agent-call.module.css";

export type { AgentCallVoiceRun } from "./agent-call-run-events";

export type AgentCallPhase = "ringing" | "answered" | "talking" | "failed";

type AgentCallModalProps = {
  agent: FleetAgent;
  machine: FleetMachine;
  phase: AgentCallPhase;
  error?: string;
  notice?: string;
  livekit?: AgentCallLiveKit;
  realtime?: AgentCallRealtime;
  localTts?: AgentCallLocalTts;
  runtimeAgent?: AgentCallRuntimeAgent;
  voiceRun?: AgentCallVoiceRun;
  accent?: "cyan" | "honey";
  waveStyle?: AgentCallWaveStyle;
  onClose: () => void;
  onVoiceConnected?: () => void;
  onTransferToChat?: (agent: FleetAgent, machine: FleetMachine) => void;
  onAddAgent?: (agent: FleetAgent, machine: FleetMachine) => void;
  onRedial?: (agent: FleetAgent, machine: FleetMachine) => void;
};

const BAND_COUNT = 24;

export type AgentCallLiveKit = {
  serverUrl: string;
  token: string;
  room?: string;
};

export type AgentCallRealtimeTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AgentCallRealtime = {
  provider?: string;
  model?: string;
  voice?: string;
  clientSecret: string;
  expiresAt?: number;
  instructions?: string;
  tools?: AgentCallRealtimeTool[];
};

export type AgentCallLocalTts = {
  provider: "local-tts";
  appId: string;
  appName: string;
  machineName?: string;
  model: string;
  voice: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  streamingKind?: string;
  streamingImplementation?: string;
  openingLine: string;
};

export type AgentCallRuntimeAgent = {
  hubUrl?: string;
  agent?: Record<string, unknown>;
  machine?: { id?: string; name?: string };
  voiceRunId?: string;
};

type DashboardVoiceStatus = "idle" | "connecting" | "connected" | "blocked" | "failed";
type DashboardAgentWorkStage = "idle" | "tool" | "answer";

const ECHO_CANCELLED_AUDIO: AudioCaptureOptions & MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: true,
};

function idleBands(phase: AgentCallPhase) {
  return Array.from({ length: BAND_COUNT }, (_, index) => {
    if (phase === "failed") return 0.06;
    const wave = Math.sin(index * 0.65) * 0.12 + 0.18;
    return Math.max(0.06, Math.min(0.42, wave));
  });
}

function useDashboardLiveKit(connection: AgentCallLiveKit | undefined, active: boolean, muted: boolean, voiceRunId?: string) {
  const [status, setStatus] = React.useState<DashboardVoiceStatus>("idle");
  const [error, setError] = React.useState("");
  const [agentCaption, setAgentCaption] = React.useState("");
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [userTranscript, setUserTranscript] = React.useState("");
  const [participantCount, setParticipantCount] = React.useState(0);
  const [remoteAudioActive, setRemoteAudioActive] = React.useState(false);
  const [localMicrophoneTrack, setLocalMicrophoneTrack] = React.useState<MediaStreamTrack | null>(null);
  const suppressUserTranscriptUntilRef = React.useRef(0);
  const roomRef = React.useRef<Room | null>(null);

  React.useEffect(() => {
    if (!active || !connection?.serverUrl || !connection.token) {
      return undefined;
    }

    const serverUrl = connection.serverUrl;
    const token = connection.token;
    const roomName = connection.room;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const attachedElements = new Set<HTMLMediaElement>();

    const removeAttachedElement = (element: HTMLMediaElement) => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      element.remove();
      attachedElements.delete(element);
    };

    const detachTrack = (track: RemoteTrack) => {
      track.detach().forEach((element) => removeAttachedElement(element as HTMLMediaElement));
    };

    const attachTrack = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach() as HTMLMediaElement;
      element.autoplay = true;
      element.dataset.agentCallAudio = "true";
      element.style.display = "none";
      document.body.appendChild(element);
      attachedElements.add(element);
      setRemoteAudioActive(true);
      void element.play().catch((playError) => {
        if (cancelled) return;
        setStatus("blocked");
        setError(playError instanceof Error ? playError.message : "Browser blocked call audio playback.");
      });
    };

    const refreshParticipantCount = () => {
      setParticipantCount(room.remoteParticipants.size);
    };

    const attachParticipantAudio = (participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication: RemoteTrackPublication) => {
        if (publication.track && publication.isSubscribed) attachTrack(publication.track);
      });
    };

    const isAgentParticipant = (participant: Participant | undefined) => {
      if (!participant || participant.identity === room.localParticipant.identity) return false;
      return !participant.identity.startsWith("dashboard_")
        && !participant.identity.startsWith("device_")
        && !participant.identity.startsWith("caller_");
    };

    const handleActiveSpeakers = (speakers: Participant[]) => {
      const nextAgentSpeaking = speakers.some(isAgentParticipant);
      if (nextAgentSpeaking) suppressUserTranscriptUntilRef.current = Date.now() + 1_600;
      setAgentSpeaking(nextAgentSpeaking);
    };

    const handleTranscription = (
      segments: TranscriptionSegment[],
      participant?: Participant,
    ) => {
      const text = segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!text) return;
      if (isAgentParticipant(participant)) {
        suppressUserTranscriptUntilRef.current = Date.now() + 2_500;
        setAgentCaption(text);
        void recordAgentCaption(voiceRunId, text, { participant: participant?.identity });
        return;
      }
      if (participant?.identity === room.localParticipant.identity && Date.now() > suppressUserTranscriptUntilRef.current) {
        setUserTranscript(text);
        void recordUserTranscript(voiceRunId, text, { participant: participant.identity });
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, attachTrack)
      .on(RoomEvent.TrackUnsubscribed, detachTrack)
      .on(RoomEvent.ParticipantConnected, refreshParticipantCount)
      .on(RoomEvent.ParticipantDisconnected, refreshParticipantCount)
      .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers)
      .on(RoomEvent.TranscriptionReceived, handleTranscription)
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) setStatus("idle");
      });

    async function connect() {
      try {
        setStatus("connecting");
        setError("");
        await room.connect(serverUrl, token);
        if (cancelled) return;
        setStatus("connected");
        refreshParticipantCount();
        void recordCallConnected(voiceRunId, "Dashboard joined the LiveKit voice room.", { room: roomName });
        room.remoteParticipants.forEach(attachParticipantAudio);
        try {
          const publication: LocalTrackPublication | undefined = await room.localParticipant.setMicrophoneEnabled(true, ECHO_CANCELLED_AUDIO);
          if (!cancelled) setLocalMicrophoneTrack(publication?.track?.mediaStreamTrack ?? null);
        } catch (micError) {
          if (!cancelled) {
            setLocalMicrophoneTrack(null);
            setError(micError instanceof Error ? micError.message : "Microphone permission was not granted.");
          }
        }
      } catch (connectError) {
        if (!cancelled) {
          setStatus("failed");
          setError(connectError instanceof Error ? connectError.message : "Could not connect dashboard audio.");
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      setLocalMicrophoneTrack(null);
      roomRef.current = null;
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, detachTrack);
      room.off(RoomEvent.ParticipantConnected, refreshParticipantCount);
      room.off(RoomEvent.ParticipantDisconnected, refreshParticipantCount);
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
      room.off(RoomEvent.TranscriptionReceived, handleTranscription);
      room.disconnect();
      attachedElements.forEach(removeAttachedElement);
    };
  }, [active, connection?.room, connection?.serverUrl, connection?.token, voiceRunId]);

  React.useEffect(() => {
    const room = roomRef.current;
    if (!room || status !== "connected") return;
    void room.localParticipant.setMicrophoneEnabled(!muted, ECHO_CANCELLED_AUDIO).catch(() => undefined);
  }, [muted, status]);

  const connected = active && Boolean(connection?.serverUrl && connection.token);
  return {
    agentCaption: connected ? agentCaption : "",
    agentSpeaking: connected ? agentSpeaking : false,
    agentWorkStage: "idle" as DashboardAgentWorkStage,
    error: connected ? error : "",
    localMicrophoneTrack: connected ? localMicrophoneTrack : null,
    participantCount: connected ? participantCount : 0,
    remoteAudioActive: connected ? remoteAudioActive : false,
    status: connected ? status : "idle",
    userTranscript: connected ? userTranscript : "",
  };
}

function parseRealtimeFunctionCall(event: unknown): { callId: string; name: string; args: Record<string, unknown> } | null {
  const parsed = event && typeof event === "object" ? event as Record<string, unknown> : null;
  if (!parsed) return null;
  const parseArgs = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== "string") return {};
    try {
      const value = JSON.parse(raw) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
      return {};
    }
  };
  if (parsed.type === "response.function_call_arguments.done" && typeof parsed.call_id === "string" && typeof parsed.name === "string") {
    return { callId: parsed.call_id, name: parsed.name, args: parseArgs(parsed.arguments) };
  }
  if (parsed.type === "response.output_item.done" && parsed.item && typeof parsed.item === "object") {
    const item = parsed.item as Record<string, unknown>;
    if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
      return { callId: item.call_id, name: item.name, args: parseArgs(item.arguments) };
    }
  }
  if (parsed.type === "response.done" && parsed.response && typeof parsed.response === "object") {
    const output = (parsed.response as { output?: unknown }).output;
    const item = Array.isArray(output) ? output.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "function_call") as Record<string, unknown> | undefined : undefined;
    if (item && typeof item.call_id === "string" && typeof item.name === "string") {
      return { callId: item.call_id, name: item.name, args: parseArgs(item.arguments) };
    }
  }
  return null;
}

function realtimeSessionIdFor(target?: AgentCallRuntimeAgent) {
  const agent = target?.agent;
  const id = typeof agent?.id === "string" ? agent.id : typeof agent?.name === "string" ? agent.name : "agent";
  return `voice-${id}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function playCallToolChime() {
  if (typeof window === "undefined") return;
  const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    gain.connect(context.destination);

    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const startAt = now + index * 0.095;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      oscillator.connect(gain);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.16);
    });
    void context.resume?.().catch(() => undefined);
    window.setTimeout(() => void context.close().catch(() => undefined), 520);
  } catch {
    // Audio feedback is best-effort; the visual working state is the source of truth.
  }
}

async function askComputerAgent(target: AgentCallRuntimeAgent | undefined, message: string) {
  const hubUrl = String(target?.hubUrl || "").replace(/\/+$/, "");
  if (!hubUrl) return "The paired HivemindOS hub URL was not attached to this call.";
  const response = await fetch(`${hubUrl}/api/phone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "agent-voice-turn",
      agent: target?.agent,
      machine: target?.machine,
      message,
      runtimeSessionId: realtimeSessionIdFor(target),
      voiceRunId: target?.voiceRunId,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string } | null;
  if (!response.ok || data?.ok === false) return data?.error || `The computer agent returned HTTP ${response.status}.`;
  return data?.text?.trim() || "The computer agent completed the request without a spoken response.";
}

function useDashboardRealtime(connection: AgentCallRealtime | undefined, runtimeAgent: AgentCallRuntimeAgent | undefined, active: boolean, muted: boolean, voiceRunId?: string) {
  const [status, setStatus] = React.useState<DashboardVoiceStatus>("idle");
  const [error, setError] = React.useState("");
  const [agentCaption, setAgentCaption] = React.useState("");
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [agentWorkStage, setAgentWorkStage] = React.useState<DashboardAgentWorkStage>("idle");
  const [userTranscript, setUserTranscript] = React.useState("");
  const [remoteAudioActive, setRemoteAudioActive] = React.useState(false);
  const [localMicrophoneTrack, setLocalMicrophoneTrack] = React.useState<MediaStreamTrack | null>(null);
  const localMicrophoneTrackRef = React.useRef<MediaStreamTrack | null>(null);

  React.useEffect(() => {
    if (!active || !connection?.clientSecret) return undefined;
    const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const failUnavailable = (message: string) => {
      queueMicrotask(() => {
        setStatus("failed");
        setError(message);
      });
    };
    if (typeof RTCPeerConnection === "undefined") {
      failUnavailable("WebRTC is not available in this browser or desktop webview.");
      return undefined;
    }
    const getUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);
    const clientSecret = connection.clientSecret;
    let cancelled = false;
    let responseStarted = false;
    let captionResponseOpen = false;
    let responseCaption = "";
    let startFallback = 0;
    let connectTimeout = 0;
    let localStream: MediaStream | null = null;
    const handledFunctionCalls = new Set<string>();
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.dataset.agentCallAudio = "true";
    audio.style.display = "none";
    document.body.appendChild(audio);
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events");
    const addReceiveOnlyAudio = () => {
      if (typeof peer.addTransceiver !== "function") return;
      try {
        peer.addTransceiver("audio", { direction: "recvonly" });
      } catch {
        // Older embedded webviews may not support transceivers; the SDP offer can still proceed.
      }
    };

    const fail = (message: string) => {
      if (cancelled) return;
      setStatus("failed");
      setError(message);
    };
    const send = (payload: unknown) => {
      if (cancelled || channel.readyState !== "open") return;
      channel.send(JSON.stringify(payload));
    };
    const startResponse = () => {
      if (responseStarted) return;
      responseStarted = true;
      send({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          ...(connection.instructions ? { instructions: connection.instructions } : {}),
        },
      });
    };

    peer.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteAudioActive(true);
      void audio.play().catch((playError) => {
        if (cancelled) return;
        setStatus("blocked");
        setError(playError instanceof Error ? playError.message : "Browser blocked call audio playback.");
      });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (cancelled) return;
      if (peer.connectionState === "connected") {
        if (connectTimeout) window.clearTimeout(connectTimeout);
        setStatus("connected");
        void recordCallConnected(voiceRunId, "Dashboard Realtime voice connected.", {
          provider: connection.provider,
          model: connection.model,
          voice: connection.voice,
        });
      }
      else if (peer.connectionState === "failed") fail("The Realtime call connection failed.");
      else if (peer.connectionState === "disconnected") setStatus("idle");
    });
    channel.addEventListener("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          ...(connection.instructions ? { instructions: connection.instructions } : {}),
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
              turn_detection: { type: "semantic_vad" },
            },
          },
          ...(connection.tools?.length ? { tools: connection.tools, tool_choice: "auto" } : {}),
        },
      });
      startFallback = window.setTimeout(startResponse, 800);
    });
    channel.addEventListener("message", async (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      if (record.type === "error") {
        const detail = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
        fail(String(detail.message || detail.code || "Realtime session error."));
        void recordRuntimeFailure(voiceRunId, "Realtime session error.", String(detail.message || detail.code || "Realtime session error."));
        return;
      }
      if (record.type === "session.created" || record.type === "session.updated") startResponse();
      if (record.type === "response.created") {
        captionResponseOpen = true;
        responseCaption = "";
        setAgentCaption("");
      }
      if (record.type === "response.output_audio.delta" || record.type === "response.audio.delta") {
        setAgentWorkStage("idle");
        setAgentSpeaking(true);
      }
      if (record.type === "response.done") {
        captionResponseOpen = false;
        setAgentSpeaking(false);
        setAgentWorkStage("idle");
        const finalCaption = responseCaption.trim();
        if (finalCaption) {
          void recordAgentCaption(voiceRunId, finalCaption);
        }
        responseCaption = "";
      }
      if (typeof record.delta === "string" && (record.type === "response.audio_transcript.delta" || record.type === "response.output_audio_transcript.delta")) {
        setAgentWorkStage("idle");
        responseCaption = `${responseCaption}${record.delta}`.slice(-2_000);
        if (!captionResponseOpen) {
          captionResponseOpen = true;
          setAgentCaption(record.delta.slice(-500));
        } else {
          setAgentCaption((current) => `${current}${record.delta}`.slice(-500));
        }
      }
      if (record.type === "conversation.item.input_audio_transcription.completed" && typeof record.transcript === "string") {
        setUserTranscript(record.transcript);
        void recordUserTranscript(voiceRunId, record.transcript);
      }
      const call = parseRealtimeFunctionCall(payload);
      if (call) {
        if (handledFunctionCalls.has(call.callId)) return;
        handledFunctionCalls.add(call.callId);
        const message = typeof call.args.message === "string" ? call.args.message.trim() : "";
        setAgentSpeaking(false);
        setAgentWorkStage("tool");
        playCallToolChime();
        void recordToolStarted(voiceRunId, { callId: call.callId, name: call.name, args: call.args });
        const output = call.name === "ask_computer_agent" && message
          ? await askComputerAgent(runtimeAgent, message)
          : `Unknown or incomplete tool call: ${call.name}`;
        setAgentWorkStage("answer");
        void recordToolCompleted(voiceRunId, { callId: call.callId, name: call.name, output });
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output } });
        send({ type: "response.create", response: { output_modalities: ["audio"] } });
      }
    });

    async function connect() {
      try {
        setStatus("connecting");
        setError("");
        if (getUserMedia) {
          try {
            localStream = await getUserMedia({ audio: ECHO_CANCELLED_AUDIO });
          } catch (micError) {
            if (cancelled) return;
            setError(micError instanceof Error ? [micError.name, micError.message].filter(Boolean).join(": ") : "Microphone permission was not granted.");
            localStream = null;
          }
        } else {
          setError("Microphone capture is not available in this browser or desktop webview. Connecting speaker-only.");
        }
        if (cancelled) return;
        connectTimeout = window.setTimeout(() => {
          if (!cancelled && peer.connectionState !== "connected") fail("OpenAI Realtime did not finish connecting. Check microphone permission and network, then try again.");
        }, 20_000);
        const track = localStream?.getAudioTracks()[0] ?? null;
        if (track) {
          localMicrophoneTrackRef.current = track;
          setLocalMicrophoneTrack(track);
        }
        if (localStream) localStream.getTracks().forEach((streamTrack) => peer.addTrack(streamTrack, localStream!));
        else addReceiveOnlyAudio();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const response = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
          body: offer.sdp || "",
        });
        if (!response.ok) throw new Error(`OpenAI Realtime returned HTTP ${response.status}.`);
        await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
      } catch (connectError) {
        const message = connectError instanceof Error
          ? [connectError.name, connectError.message].filter(Boolean).join(": ")
          : "";
        fail(message || "Could not connect dashboard Realtime audio.");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (startFallback) window.clearTimeout(startFallback);
      if (connectTimeout) window.clearTimeout(connectTimeout);
      channel.close();
      peer.close();
      localStream?.getTracks().forEach((track) => track.stop());
      localMicrophoneTrackRef.current = null;
      setLocalMicrophoneTrack(null);
      setAgentWorkStage("idle");
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    };
  }, [active, connection?.clientSecret, connection?.instructions, connection?.model, connection?.provider, connection?.tools, connection?.voice, runtimeAgent, voiceRunId]);

  React.useEffect(() => {
    const track = localMicrophoneTrackRef.current;
    if (!track) return undefined;
    const previousEnabled = track.enabled;
    track.enabled = !muted;
    return () => {
      track.enabled = previousEnabled;
    };
  }, [localMicrophoneTrack, muted]);

  const connected = active && Boolean(connection?.clientSecret);
  return {
    agentCaption: connected ? agentCaption : "",
    agentSpeaking: connected ? agentSpeaking : false,
    agentWorkStage: connected ? agentWorkStage : "idle",
    error: connected ? error : "",
    localMicrophoneTrack: connected ? localMicrophoneTrack : null,
    participantCount: connected ? 1 : 0,
    remoteAudioActive: connected ? remoteAudioActive : false,
    status: connected ? status : "idle",
    userTranscript: connected ? userTranscript : "",
  };
}

function useDashboardLocalTts(connection: AgentCallLocalTts | undefined, runtimeAgent: AgentCallRuntimeAgent | undefined, active: boolean, muted: boolean, voiceRunId?: string) {
  const [status, setStatus] = React.useState<DashboardVoiceStatus>("idle");
  const [error, setError] = React.useState("");
  const [agentCaption, setAgentCaption] = React.useState("");
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [agentWorkStage, setAgentWorkStage] = React.useState<DashboardAgentWorkStage>("idle");
  const [userTranscript, setUserTranscript] = React.useState("");
  const [remoteAudioActive, setRemoteAudioActive] = React.useState(false);
  const [localMicrophoneTrack, setLocalMicrophoneTrack] = React.useState<MediaStreamTrack | null>(null);
  const localMicrophoneTrackRef = React.useRef<MediaStreamTrack | null>(null);

  React.useEffect(() => {
    if (!active || !connection?.appId) return undefined;
    const localTtsConfig = connection;
    const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) {
      queueMicrotask(() => {
        setStatus("failed");
        setError("Web Audio is not available in this browser.");
      });
      return undefined;
    }

    let cancelled = false;
    let busy = false;
    let localStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let vadAnalyser: AnalyserNode | null = null;
    let vadSource: MediaStreamAudioSourceNode | null = null;
    let vadProcessor: ScriptProcessorNode | null = null;
    let vadSilentGain: GainNode | null = null;
    let vadFrame = 0;
    let vadListening = false;
    let vadSpeechStartedAt = 0;
    let vadLastSpeechAt = 0;
    let vadNoiseFloor = 0.012;
    let preparedSttSession: Promise<WebSocket> | null = null;
    let realtimeSttSocket: WebSocket | null = null;
    let activeTurnAbort: AbortController | null = null;
    const speechControllers = new Set<AbortController>();
    let restartTimer = 0;

    const stopVadCapture = () => {
      vadListening = false;
      if (vadFrame) window.cancelAnimationFrame(vadFrame);
      vadFrame = 0;
      try {
        vadProcessor?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      try {
        vadSilentGain?.disconnect();
        vadAnalyser?.disconnect();
        vadSource?.disconnect();
      } catch {
        // Audio nodes may already be detached.
      }
      vadProcessor = null;
      vadSilentGain = null;
      vadAnalyser = null;
      vadSource = null;
    };

    const stopAudio = () => {
      activeTurnAbort?.abort();
      activeTurnAbort = null;
      speechControllers.forEach((controller) => controller.abort());
      speechControllers.clear();
    };

    const closeRealtimeStt = () => {
      preparedSttSession = null;
      const socket = realtimeSttSocket;
      realtimeSttSocket = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // Socket may already be closing.
        }
      }
    };

    const pcm16ToBase64 = (pcm: Int16Array) => {
      let binary = "";
      const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return window.btoa(binary);
    };

    const resampleToPcm16 = (input: Float32Array, inputRate: number, outputRate = 24_000) => {
      const ratio = inputRate / outputRate;
      const length = Math.max(0, Math.floor(input.length / ratio));
      const pcm = new Int16Array(length);
      for (let index = 0; index < length; index += 1) {
        const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] ?? 0));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return pcm;
    };

    const prepareRealtimeSttSession = () => {
      if (preparedSttSession) return preparedSttSession;
      preparedSttSession = (async () => {
        const tokenResponse = await fetch("/api/phone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Continuous mode: this modal runs its own VAD + manual commit and
          // shows live deltas while the user talks.
          body: JSON.stringify({ action: "local-tts-stt-client-secret", mode: "continuous" }),
          cache: "no-store",
        });
        const tokenPayload = await tokenResponse.json().catch(() => null) as { clientSecret?: string; error?: string } | null;
        if (!tokenResponse.ok || !tokenPayload?.clientSecret) {
          throw new Error(tokenPayload?.error || `Realtime STT setup returned HTTP ${tokenResponse.status}.`);
        }
        const socket = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", [
          "realtime",
          `openai-insecure-api-key.${tokenPayload.clientSecret}`,
        ]);
        realtimeSttSocket = socket;
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
          const timeout = window.setTimeout(() => fail("Realtime STT did not become ready."), 10_000);
          const onError = () => {
            fail("Realtime STT websocket failed.");
          };
          const onMessage = (event: MessageEvent<string>) => {
            let payload: { type?: string; error?: { message?: string } } | null = null;
            try {
              payload = JSON.parse(event.data) as { type?: string; error?: { message?: string } };
            } catch {
              return;
            }
            if (payload.type === "session.created" || payload.type === "session.updated") {
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
      })().catch((sttError) => {
        preparedSttSession = null;
        throw sttError;
      });
      return preparedSttSession;
    };

    const prewarmLocalTts = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch("/api/phone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "local-tts-speech-stream",
            localTts: connection,
            input: "Ready.",
            utteranceId: `prewarm_${Date.now()}`,
          }),
          signal: controller.signal,
        });
        const reader = response.body?.getReader();
        await reader?.read().catch(() => undefined);
        await reader?.cancel().catch(() => undefined);
      } catch {
        // Prewarm is opportunistic; the spoken call path reports real failures.
      } finally {
        window.clearTimeout(timeout);
        controller.abort();
      }
    };

    const playPcmStream = async (response: Response, metrics: { label: string; startedAt: number }, signal: AbortSignal) => {
      setRemoteAudioActive(true);
      const playback = await playRealtimePcmStream(response, {
        channels: connection.channels || 1,
        sampleRate: connection.sampleRate || 24_000,
        signal,
        startedAt: metrics.startedAt,
        startBufferMs: 520,
        maxBufferMs: 2_000,
        onFirstByte: (elapsedMs) => {
          console.info(`[local-tts-call] ${metrics.label} first_byte_ms=${Math.round(elapsedMs)}`);
        },
        onUnderrun: (event) => {
          console.info(`[local-tts-call] ${metrics.label} underrun count=${event.underruns} buffered_ms=${event.bufferedMs}`);
        },
      });
      console.info(
        `[local-tts-call] ${metrics.label} first_audio_ms=${Math.round(playback.firstAudioMs)} underruns=${playback.underruns} underrun_ms=${playback.underrunMs}`,
      );
    };

    const speak = async (text: string, options: { interrupt?: boolean } = {}) => {
      const input = text.trim();
      if (!input || cancelled) return;
      if (options.interrupt !== false) stopAudio();
      const speechAbort = new AbortController();
      speechControllers.add(speechAbort);
      setAgentSpeaking(true);
      setAgentCaption(input.slice(-500));
      try {
        const startedAt = Date.now();
        const response = await fetch("/api/phone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "local-tts-speech-stream",
            localTts: connection,
            input,
            utteranceId: `call_${Date.now()}`,
          }),
          signal: speechAbort.signal,
        });
        if (!response.ok) {
          const message = await response.text().catch(() => "");
          throw new Error(message || `Local TTS returned HTTP ${response.status}.`);
        }
        await playPcmStream(response, { label: "opening", startedAt }, speechAbort.signal);
        void recordAgentCaption(voiceRunId, input);
      } finally {
        speechControllers.delete(speechAbort);
        if (!cancelled) setAgentSpeaking(false);
      }
    };

    const localTtsTurnFailureMessage = (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      const agentName = runtimeAgent?.agent?.name || "The agent";
      if (/load failed/i.test(message)) {
        return `${agentName} stopped the audio stream before playable speech arrived. The local runtime may still be warming up; try the call again or switch this agent to a faster call model.`;
      }
      if (/abort|timeout|timed out/i.test(message)) {
        return `${agentName} did not answer before the local voice timeout. Try again in a moment or use a faster model for calls.`;
      }
      return message || "Local TTS call turn failed.";
    };

    const streamAgentTextTurn = async (message: string, speechEndedAt: number) => {
      const input = message.trim();
      if (!input || cancelled) return;
      stopAudio();
      const speechAbort = new AbortController();
      activeTurnAbort = speechAbort;
      speechControllers.add(speechAbort);
      setAgentSpeaking(true);
      setAgentCaption("");
      try {
        const startedAt = Date.now();
        const response = await fetch("/api/phone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "local-tts-agent-audio-stream",
            localTts: connection,
            agent: runtimeAgent?.agent ?? {},
            machine: runtimeAgent?.machine ?? {},
            runtimeSessionId: realtimeSessionIdFor(runtimeAgent),
            voiceRunId,
            message: input,
          }),
          signal: speechAbort.signal,
        });
        if (!response.ok) {
          const messageText = await response.text().catch(() => "");
          throw new Error(messageText || `Local TTS VAD/STT orchestrator returned HTTP ${response.status}.`);
        }
        await playPcmStream(response, { label: `turn_after_speech_end_${Math.round(startedAt - speechEndedAt)}ms`, startedAt }, speechAbort.signal);
      } finally {
        speechControllers.delete(speechAbort);
        if (activeTurnAbort === speechAbort) activeTurnAbort = null;
        if (!cancelled) setAgentSpeaking(false);
      }
    };

    const handleTextTurn = async (message: string, speechEndedAt: number) => {
      const input = message.trim();
      if (!input || busy || cancelled) return;
      busy = true;
      stopVadCapture();
      setUserTranscript(input);
      setAgentSpeaking(false);
      setAgentWorkStage("tool");
      playCallToolChime();
      try {
        setAgentWorkStage("answer");
        await streamAgentTextTurn(input, speechEndedAt);
        if (cancelled) return;
      } catch (turnError) {
        if (!cancelled) {
          setStatus("failed");
          setError(localTtsTurnFailureMessage(turnError));
        }
      } finally {
        busy = false;
        if (!cancelled) {
          setAgentSpeaking(false);
          setAgentWorkStage("idle");
          startVadCapture();
        }
      }
    };

    function startVadCapture() {
      if (cancelled || busy || vadListening || !localStream || !audioContext) return;
      void (async () => {
        const socket = await prepareRealtimeSttSession();
        if (cancelled || busy || !localStream || !audioContext || socket.readyState !== WebSocket.OPEN) return;
        vadSpeechStartedAt = 0;
        vadLastSpeechAt = 0;
        vadNoiseFloor = 0.012;
        vadListening = true;
        let committed = false;
        let transcript = "";
        let speechEndedAt = 0;
        const commitTurn = () => {
          if (committed || socket.readyState !== WebSocket.OPEN) return;
          committed = true;
          speechEndedAt = Date.now();
          stopVadCapture();
          setUserTranscript(transcript.trim() || "Finalizing transcript...");
          socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        };
        const messageHandler = (event: MessageEvent<string>) => {
          let payload: { type?: string; delta?: string; transcript?: string; error?: { message?: string } } | null = null;
          try {
            payload = JSON.parse(event.data) as { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
          } catch {
            return;
          }
          if (payload.type === "conversation.item.input_audio_transcription.delta" && payload.delta) {
            transcript += payload.delta;
            setUserTranscript(transcript.trim());
          }
          if (payload.type === "conversation.item.input_audio_transcription.completed") {
            const finalTranscript = (payload.transcript || transcript).trim();
            socket.removeEventListener("message", messageHandler);
            closeRealtimeStt();
            if (!cancelled && finalTranscript) void handleTextTurn(finalTranscript, speechEndedAt || Date.now());
            if (!cancelled && !finalTranscript) restartTimer = window.setTimeout(startVadCapture, 150);
          }
          if (payload.type === "error") {
            socket.removeEventListener("message", messageHandler);
            closeRealtimeStt();
            setStatus("failed");
            setError(payload.error?.message || "Realtime STT returned an error.");
          }
        };
        socket.addEventListener("message", messageHandler);
        vadSource = audioContext.createMediaStreamSource(localStream);
        vadAnalyser = audioContext.createAnalyser();
        vadAnalyser.fftSize = 1024;
        vadSource.connect(vadAnalyser);
        vadProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        vadSilentGain = audioContext.createGain();
        vadSilentGain.gain.value = 0;
        vadSource.connect(vadProcessor);
        vadProcessor.connect(vadSilentGain);
        vadSilentGain.connect(audioContext.destination);
        vadProcessor.onaudioprocess = (event) => {
          if (!vadListening || committed || socket.readyState !== WebSocket.OPEN || !audioContext) return;
          const pcm = resampleToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
          if (pcm.byteLength) {
            socket.send(JSON.stringify({
              type: "input_audio_buffer.append",
              audio: pcm16ToBase64(pcm),
            }));
          }
        };
        const samples = new Uint8Array(vadAnalyser.fftSize);
        const tick = () => {
          if (cancelled || !vadListening || !vadAnalyser || committed) return;
          vadAnalyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / samples.length);
          const now = performance.now();
          const threshold = Math.max(0.018, vadNoiseFloor * 3.0);
          if (rms < threshold) vadNoiseFloor = vadNoiseFloor * 0.96 + rms * 0.04;
          const speaking = rms >= threshold;
          if (speaking) {
            if (!vadSpeechStartedAt) {
              vadSpeechStartedAt = now;
              stopAudio();
              setAgentSpeaking(false);
            }
            vadLastSpeechAt = now;
            setUserTranscript("Listening...");
          }
          const utteranceMs = vadSpeechStartedAt ? now - vadSpeechStartedAt : 0;
          const silenceMs = vadLastSpeechAt ? now - vadLastSpeechAt : 0;
          if ((vadSpeechStartedAt && utteranceMs > 250 && silenceMs > 550) || utteranceMs > 15_000) {
            commitTurn();
            return;
          }
          vadFrame = window.requestAnimationFrame(tick);
        };
        vadFrame = window.requestAnimationFrame(tick);
      })().catch((recognitionError) => {
        if (!cancelled) {
          closeRealtimeStt();
          setStatus("failed");
          setError(recognitionError instanceof Error ? recognitionError.message : "Could not start realtime local STT.");
        }
      });
    }

    async function connect() {
      try {
        setStatus("connecting");
        setError("");
        audioContext = new AudioContextClass();
        if (navigator.mediaDevices?.getUserMedia) {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: ECHO_CANCELLED_AUDIO }).catch(() => null);
          const track = localStream?.getAudioTracks()[0] ?? null;
          localMicrophoneTrackRef.current = track;
          setLocalMicrophoneTrack(track);
        }
        if (cancelled) return;
        setStatus("connected");
        setRemoteAudioActive(true);
        void recordCallConnected(voiceRunId, "Dashboard Local TTS voice connected.", {
          appId: localTtsConfig.appId,
          model: localTtsConfig.model,
          voice: localTtsConfig.voice,
        });
        const sttReady = prepareRealtimeSttSession().catch(() => null);
        await prewarmLocalTts();
        await speak(`${localTtsConfig.openingLine || "Hello Liam, this is your HivemindOS coding agent."} I'm ready to help.`);
        await sttReady;
        if (!cancelled) startVadCapture();
      } catch (connectError) {
        if (!cancelled) {
          setStatus("failed");
          setError(connectError instanceof Error ? connectError.message : "Could not start Local TTS audio.");
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (restartTimer) window.clearTimeout(restartTimer);
      stopVadCapture();
      closeRealtimeStt();
      stopAudio();
      localStream?.getTracks().forEach((track) => track.stop());
      localMicrophoneTrackRef.current = null;
      setLocalMicrophoneTrack(null);
      setAgentSpeaking(false);
      setAgentWorkStage("idle");
      void audioContext?.close().catch(() => undefined);
    };
  }, [active, connection, runtimeAgent, voiceRunId]);

  React.useEffect(() => {
    const track = localMicrophoneTrackRef.current;
    if (!track) return undefined;
    const previousEnabled = track.enabled;
    track.enabled = !muted;
    return () => {
      track.enabled = previousEnabled;
    };
  }, [localMicrophoneTrack, muted]);

  const connected = active && Boolean(connection?.appId);
  return {
    agentCaption: connected ? agentCaption : "",
    agentSpeaking: connected ? agentSpeaking : false,
    agentWorkStage: connected ? agentWorkStage : "idle",
    error: connected ? error : "",
    localMicrophoneTrack: connected ? localMicrophoneTrack : null,
    participantCount: connected ? 1 : 0,
    remoteAudioActive: connected ? remoteAudioActive : false,
    status: connected ? status : "idle",
    userTranscript: connected ? userTranscript : "",
  };
}

function voiceStatusLabel(status: DashboardVoiceStatus, hasConnection: boolean) {
  if (!hasConnection) return "Dashboard audio pending";
  if (status === "connected") return "Dashboard audio connected";
  if (status === "connecting") return "Dashboard audio connecting";
  if (status === "blocked") return "Tap to allow audio";
  if (status === "failed") return "Dashboard audio failed";
  return "Dashboard audio idle";
}

function useLiveVoiceFeedback(active: boolean, transcriptionActive: boolean, sourceTrack: MediaStreamTrack | null) {
  const [bands, setBands] = React.useState<number[]>(() => idleBands("ringing"));
  const [volume, setVolume] = React.useState(0);
  const [transcript, setTranscript] = React.useState("");
  const [micStatus, setMicStatus] = React.useState<"idle" | "listening" | "unavailable">("idle");
  const [speechStatus, setSpeechStatus] = React.useState<"idle" | "listening" | "paused" | "unavailable">("idle");

  React.useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let recognition: SpeechRecognitionLike | null = null;

    async function startAnalyser() {
      if (!sourceTrack && !navigator.mediaDevices?.getUserMedia) {
        setMicStatus("unavailable");
        return;
      }
      try {
        const mediaStream = sourceTrack ? new MediaStream([sourceTrack]) : await navigator.mediaDevices.getUserMedia({ audio: ECHO_CANCELLED_AUDIO });
        stream = sourceTrack ? null : mediaStream;
        if (cancelled && stream) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
        const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass) {
          setMicStatus("unavailable");
          return;
        }
        audioContext = new AudioContextClass();
        await audioContext.resume().catch(() => undefined);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        audioContext.createMediaStreamSource(mediaStream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const binSize = Math.max(1, Math.floor(data.length / BAND_COUNT));
          const next = Array.from({ length: BAND_COUNT }, (_, index) => {
            const start = index * binSize;
            let total = 0;
            for (let offset = 0; offset < binSize; offset += 1) total += data[start + offset] ?? 0;
            return Math.min(1, total / Math.max(1, binSize) / 160);
          });
          const peak = next.reduce((max, value) => Math.max(max, value), 0);
          setBands(next);
          setVolume(peak);
          frame = window.requestAnimationFrame(tick);
        };
        setMicStatus("listening");
        tick();
      } catch {
        setMicStatus("unavailable");
      }
    }

    const Recognition = transcriptionActive ? speechRecognitionConstructor() : null;
    if (!transcriptionActive) {
      queueMicrotask(() => {
        if (!cancelled) {
          setSpeechStatus("paused");
          setTranscript("");
        }
      });
    } else if (Recognition) {
      try {
        recognition = new Recognition();
        let committedTranscript = "";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";
        recognition.onresult = (event) => {
          let interimTranscript = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = Array.from({ length: result.length }, (_, partIndex) => result[partIndex]?.transcript ?? "").join("");
            if (result.isFinal) committedTranscript = `${committedTranscript} ${text}`.trim();
            else interimTranscript = `${interimTranscript} ${text}`.trim();
          }
          setTranscript(`${committedTranscript} ${interimTranscript}`.trim());
        };
        recognition.onerror = () => setSpeechStatus("unavailable");
        recognition.onend = () => {
          if (!cancelled) setSpeechStatus((current) => current === "listening" ? "idle" : current);
        };
        recognition.start();
        queueMicrotask(() => {
          if (!cancelled) setSpeechStatus("listening");
        });
      } catch {
        queueMicrotask(() => {
          if (!cancelled) setSpeechStatus("unavailable");
        });
      }
    } else {
      queueMicrotask(() => {
        if (!cancelled) setSpeechStatus("unavailable");
      });
    }

    void startAnalyser();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      recognition?.abort();
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close().catch(() => undefined);
    };
  }, [active, sourceTrack, transcriptionActive]);

  return { bands, micStatus, speechStatus, transcript, volume };
}

export function AgentCallModal({
  agent,
  machine,
  phase,
  error,
  notice,
  livekit,
  realtime,
  localTts,
  runtimeAgent,
  voiceRun,
  accent = "cyan",
  waveStyle = "bars",
  onClose,
  onVoiceConnected,
  onTransferToChat,
  onAddAgent,
  onRedial,
}: AgentCallModalProps) {
  const [muted, setMuted] = React.useState(false);
  const [held, setHeld] = React.useState(false);
  const voiceRunId = runtimeAgent?.voiceRunId || voiceRun?.id;
  const realtimeVoice = useDashboardRealtime(realtime, runtimeAgent, phase !== "failed", muted || held, voiceRunId);
  const localTtsVoice = useDashboardLocalTts(localTts, runtimeAgent, phase !== "failed", muted || held, voiceRunId);
  const livekitVoice = useDashboardLiveKit(livekit, phase !== "failed" && !realtime && !localTts, muted || held, voiceRunId);
  const dashboardVoice = localTts ? localTtsVoice : realtime ? realtimeVoice : livekitVoice;
  const hasVoiceConnection = Boolean(livekit || realtime || localTts);
  const voiceFailed = hasVoiceConnection && (dashboardVoice.status === "failed" || dashboardVoice.status === "blocked");
  const displayError = error || (voiceFailed ? dashboardVoice.error || voiceStatusLabel(dashboardVoice.status, true) : "");
  const visualPhase: AgentCallPhase = displayError ? "failed" : phase;
  const connected = visualPhase !== "ringing" && visualPhase !== "failed";
  const hasCallMicrophone = Boolean(dashboardVoice.localMicrophoneTrack);
  const microphoneProblem = connected && hasVoiceConnection && !hasCallMicrophone
    ? dashboardVoice.error || "Microphone capture is not available, so the agent cannot hear you."
    : "";
  const feedbackActive = visualPhase !== "ringing" && visualPhase !== "failed" && !held;
  const browserTranscriptionActive = feedbackActive && !muted && !localTts && dashboardVoice.status !== "connected" && !dashboardVoice.agentSpeaking;
  const analyserActive = feedbackActive && !muted && (dashboardVoice.status !== "connected" || hasCallMicrophone);
  const { bands, transcript, volume } = useLiveVoiceFeedback(analyserActive, browserTranscriptionActive, dashboardVoice.localMicrophoneTrack);
  const isAgentSpeaking = dashboardVoice.agentSpeaking || (dashboardVoice.status !== "connected" && visualPhase === "talking");
  const isListening = (visualPhase === "answered" || visualPhase === "talking") && !isAgentSpeaking && !muted && !held && !microphoneProblem;
  const isRinging = visualPhase === "ringing";
  const isAnsweredTransition = visualPhase === "answered";
  const isAgentWorking = dashboardVoice.agentWorkStage !== "idle";
  const userText = dashboardVoice.status === "connected" ? dashboardVoice.userTranscript : transcript;
  const turns = useTranscriptLog(dashboardVoice.agentCaption, userText);
  const timer = useCallTimer(connected);
  const voiceConnectedCalled = React.useRef(false);
  const [ringingCycle, setRingingCycle] = React.useState({ agentId: agent.id, step: 0 });
  const ringingStep = ringingCycle.agentId === agent.id ? ringingCycle.step : 0;
  const ringingMessage = realtime
    ? ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Connecting Realtime audio"
    : localTts
      ? ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Connecting Local TTS"
    : ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Creating agent room";
  const workingMessage = dashboardVoice.agentWorkStage === "answer"
    ? `${agent.name} is preparing the reply...`
    : `${agent.name} is checking ${machine.name}...`;
  const subText = displayError ? "Audio channel lost - agent unreachable"
    : isRinging ? ringingMessage
    : held ? "On hold"
    : muted ? "Mic muted"
    : microphoneProblem ? microphoneProblem
    : isAgentWorking ? workingMessage
    : isAnsweredTransition ? "Securing audio channel..."
    : isAgentSpeaking ? `${agent.name} is speaking`
    : isListening ? "Your turn - go ahead"
    : "On the line";
  const orbState: OrbState = visualPhase === "failed" ? "failed"
    : isRinging ? "ringing"
    : isAnsweredTransition ? "answered"
    : isAgentSpeaking ? "talking"
    : isListening ? "listening"
    : "answered";
  const cpu = Number.isFinite(machine.cpu) ? Math.round(machine.cpu) : 0;
  const ram = Number.isFinite(machine.ram) ? Math.round(machine.ram) : 0;
  const wallet = agent.wallet && agent.wallet !== "—" ? agent.wallet : "None";
  const visibleTurns = turns.slice(-3);
  const liveWho = isAgentSpeaking ? "agent" : isListening ? "you" : null;
  const finishCall = React.useCallback((reason: string, status: "ended" | "failed" = displayError ? "failed" : "ended") => {
    void completeVoiceRun(voiceRunId, status, reason);
  }, [displayError, voiceRunId]);
  const handleClose = React.useCallback(() => {
    finishCall(displayError ? `Call closed after failure: ${displayError}` : "Call closed from dashboard.", displayError ? "failed" : "ended");
    onClose();
  }, [displayError, finishCall, onClose]);

  React.useEffect(() => {
    const voiceReady = realtime
      ? dashboardVoice.status === "connected"
      : localTts
        ? dashboardVoice.status === "connected"
      : dashboardVoice.status === "connected" && dashboardVoice.remoteAudioActive;
    if (!voiceReady || voiceConnectedCalled.current) return;
    voiceConnectedCalled.current = true;
    onVoiceConnected?.();
  }, [dashboardVoice.remoteAudioActive, dashboardVoice.status, localTts, onVoiceConnected, realtime]);

  React.useEffect(() => {
    if (!isRinging) return undefined;
    const interval = window.setInterval(() => {
      setRingingCycle((current) => current.agentId === agent.id
        ? { agentId: agent.id, step: current.step + 1 }
        : { agentId: agent.id, step: 0 });
    }, 1400);
    return () => window.clearInterval(interval);
  }, [agent.id, isRinging]);

  const renderTranscript = () => {
    if (displayError || microphoneProblem) return <p className={`${styles.transcriptNote} ${styles.transcriptNoteDanger}`}>{displayError || microphoneProblem}</p>;
    if (isRinging) return <p className={styles.transcriptNote}>{ringingMessage}</p>;
    if (visibleTurns.length === 0) {
      return <p className={styles.transcriptNote}>{notice || (isAnsweredTransition ? `${agent.name} answered. Connecting audio...` : `${agent.name} is on the line.`)}</p>;
    }
    return (
      <div className={styles.turns}>
        {visibleTurns.map((turn, index) => {
          const live = index === visibleTurns.length - 1 && turn.who === liveWho;
          const speaker = turn.who === "agent" ? agent.name.split("-")[0].toUpperCase().slice(0, 7) : "YOU";
          return (
            <div key={`${turn.who}-${index}`} className={`${styles.turn} ${live ? styles.turnLive : ""}`}>
              <span className={`${styles.turnWho} ${turn.who === "agent" ? styles.turnWhoAgent : ""}`}>{speaker}</span>
              <p className={`${styles.turnText} ${live ? styles.turnTextLive : ""} ${live && turn.who === "you" ? styles.turnTextInterim : ""}`}>
                {turn.text}{live && turn.who === "you" ? <span className={styles.caret}> |</span> : null}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section className={styles.card} data-accent={accent} data-danger={visualPhase === "failed" ? "1" : "0"} role="dialog" aria-modal="true" aria-labelledby="agent-call-title">
        <CloseIconButton onClick={handleClose} aria-label="Close call" className={styles.close} />
        <span className={styles.secure}>
          <Lock size={12} aria-hidden="true" /> Encrypted voice
          <span style={{ opacity: 0.5 }}>|</span>
          <span className={styles.secureTime} style={{ color: connected ? "var(--acc-2)" : undefined }}>{connected ? timer : "--:--"}</span>
        </span>

        <AgentCallHexOrb state={orbState} level={volume} />
        <h2 id="agent-call-title" className={styles.name}>{agent.name}</h2>
        <p className={styles.meta}>{machine.name} | {agent.runtime} | {agent.role}</p>
        <div className={styles.status}>
          <span className={[styles.dot, feedbackActive ? styles.dotLive : "", visualPhase === "failed" ? styles.dotRed : ""].filter(Boolean).join(" ")} />
          <span className={styles.statusText} style={visualPhase === "failed" ? { color: "var(--danger-2)" } : !connected ? { color: "var(--fg-3)" } : undefined}>{subText}</span>
        </div>

        <div className={styles.strip}>
          <div className={styles.chip}>
            <span className={styles.chipLabel}><Cpu size={12} aria-hidden="true" /> HOST</span>
            <b className={styles.chipVal}>{machine.name}</b>
          </div>
          <div className={styles.chip}>
            <span className={styles.chipLabel}><Wallet size={12} aria-hidden="true" /> WALLET</span>
            <b className={`${styles.chipVal} ${styles.chipValHoney}`}>{wallet}</b>
          </div>
          <div className={styles.chip}>
            <span className={styles.chipLabel}><Cpu size={12} aria-hidden="true" /> LOAD</span>
            <div className={styles.gaugeStack}>
              <AgentCallGauge label="CPU" value={cpu} />
              <AgentCallGauge label="RAM" value={ram} tone="warn" />
            </div>
          </div>
        </div>

        {agent.task ? (
          <div className={styles.workingOn}>
            <span className={styles.workingOnLabel}>Working on</span>
            <span className={styles.workingOnText}>{agent.task}</span>
          </div>
        ) : null}

        <div className={styles.wfWrap}>
          <AgentCallWaveform bands={bands} waveStyle={waveStyle} idle={!analyserActive} />
        </div>

        <div className={styles.transcript} aria-live="polite">
          <span className={styles.transcriptCap}>Transcript {feedbackActive ? <span className={styles.transcriptLive}>| live</span> : null}</span>
          {renderTranscript()}
        </div>

        <div className={styles.controls}>
          {visualPhase === "failed" ? (
            <>
              <AgentCallControlButton icon={<Phone size={19} aria-hidden="true" />} label="Redial" onClick={() => onRedial?.(agent, machine)} />
              <AgentCallControlButton icon={<PhoneOff size={22} aria-hidden="true" />} label="Dismiss" big danger onClick={handleClose} />
              <AgentCallControlButton icon={<MessageSquare size={19} aria-hidden="true" />} label="Open chat" onClick={() => {
                finishCall("Call transferred to chat.", displayError ? "failed" : "ended");
                onTransferToChat?.(agent, machine);
              }} />
            </>
          ) : (
            <>
              <AgentCallControlButton icon={muted ? <MicOff size={19} aria-hidden="true" /> : <Mic size={19} aria-hidden="true" />} label={muted ? "Unmute" : "Mute"} on={muted} onClick={() => setMuted((current) => !current)} />
              <AgentCallControlButton icon={<Pause size={19} aria-hidden="true" />} label="Hold" on={held} onClick={() => setHeld((current) => !current)} />
              <AgentCallControlButton icon={<PhoneOff size={22} aria-hidden="true" />} label="End call" big danger onClick={handleClose} />
              <AgentCallControlButton icon={<MessageSquare size={19} aria-hidden="true" />} label="To chat" onClick={() => {
                finishCall("Call transferred to chat.");
                onTransferToChat?.(agent, machine);
              }} />
              <AgentCallControlButton icon={<UserPlus size={19} aria-hidden="true" />} label="Add agent" onClick={() => {
                finishCall("Call moved to add-agent flow.");
                onAddAgent?.(agent, machine);
              }} />
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
