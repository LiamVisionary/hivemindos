"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Mic2, PhoneCall, PhoneOff, Waves } from "lucide-react";
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
import { BeeIcon } from "./bee-icon";
import type { FleetAgent, FleetMachine } from "./fleet-data";
import styles from "./fleet-tokens.module.css";

export type AgentCallPhase = "ringing" | "answered" | "talking" | "failed";

type AgentCallModalProps = {
  agent: FleetAgent;
  machine: FleetMachine;
  phase: AgentCallPhase;
  error?: string;
  notice?: string;
  livekit?: AgentCallLiveKit;
  realtime?: AgentCallRealtime;
  runtimeAgent?: AgentCallRuntimeAgent;
  onClose: () => void;
  onVoiceConnected?: () => void;
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

export type AgentCallRuntimeAgent = {
  hubUrl?: string;
  agent?: Record<string, unknown>;
  machine?: { id?: string; name?: string };
};

type DashboardVoiceStatus = "idle" | "connecting" | "connected" | "blocked" | "failed";

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

function useDashboardLiveKit(connection: AgentCallLiveKit | undefined, active: boolean) {
  const [status, setStatus] = React.useState<DashboardVoiceStatus>("idle");
  const [error, setError] = React.useState("");
  const [agentCaption, setAgentCaption] = React.useState("");
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [userTranscript, setUserTranscript] = React.useState("");
  const [participantCount, setParticipantCount] = React.useState(0);
  const [remoteAudioActive, setRemoteAudioActive] = React.useState(false);
  const [localMicrophoneTrack, setLocalMicrophoneTrack] = React.useState<MediaStreamTrack | null>(null);
  const suppressUserTranscriptUntilRef = React.useRef(0);

  React.useEffect(() => {
    if (!active || !connection?.serverUrl || !connection.token) {
      return undefined;
    }

    const serverUrl = connection.serverUrl;
    const token = connection.token;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
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
        return;
      }
      if (participant?.identity === room.localParticipant.identity && Date.now() > suppressUserTranscriptUntilRef.current) {
        setUserTranscript(text);
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
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, detachTrack);
      room.off(RoomEvent.ParticipantConnected, refreshParticipantCount);
      room.off(RoomEvent.ParticipantDisconnected, refreshParticipantCount);
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
      room.off(RoomEvent.TranscriptionReceived, handleTranscription);
      room.disconnect();
      attachedElements.forEach(removeAttachedElement);
    };
  }, [active, connection?.serverUrl, connection?.token]);

  const connected = active && Boolean(connection?.serverUrl && connection.token);
  return {
    agentCaption: connected ? agentCaption : "",
    agentSpeaking: connected ? agentSpeaking : false,
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
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string } | null;
  if (!response.ok || data?.ok === false) return data?.error || `The computer agent returned HTTP ${response.status}.`;
  return data?.text?.trim() || "The computer agent completed the request without a spoken response.";
}

function useDashboardRealtime(connection: AgentCallRealtime | undefined, runtimeAgent: AgentCallRuntimeAgent | undefined, active: boolean) {
  const [status, setStatus] = React.useState<DashboardVoiceStatus>("idle");
  const [error, setError] = React.useState("");
  const [agentCaption, setAgentCaption] = React.useState("");
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [userTranscript, setUserTranscript] = React.useState("");
  const [remoteAudioActive, setRemoteAudioActive] = React.useState(false);
  const [localMicrophoneTrack, setLocalMicrophoneTrack] = React.useState<MediaStreamTrack | null>(null);

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
    let startFallback = 0;
    let connectTimeout = 0;
    let localStream: MediaStream | null = null;
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
        return;
      }
      if (record.type === "session.created" || record.type === "session.updated") startResponse();
      if (record.type === "response.created") {
        captionResponseOpen = true;
        setAgentCaption("");
      }
      if (record.type === "response.output_audio.delta" || record.type === "response.audio.delta") setAgentSpeaking(true);
      if (record.type === "response.done") {
        captionResponseOpen = false;
        setAgentSpeaking(false);
      }
      if (typeof record.delta === "string" && (record.type === "response.audio_transcript.delta" || record.type === "response.output_audio_transcript.delta")) {
        if (!captionResponseOpen) {
          captionResponseOpen = true;
          setAgentCaption(record.delta.slice(-500));
        } else {
          setAgentCaption((current) => `${current}${record.delta}`.slice(-500));
        }
      }
      if (record.type === "conversation.item.input_audio_transcription.completed" && typeof record.transcript === "string") setUserTranscript(record.transcript);
      const call = parseRealtimeFunctionCall(payload);
      if (call) {
        const message = typeof call.args.message === "string" ? call.args.message.trim() : "";
        const output = call.name === "ask_computer_agent" && message
          ? await askComputerAgent(runtimeAgent, message)
          : `Unknown or incomplete tool call: ${call.name}`;
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
        if (track) setLocalMicrophoneTrack(track);
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
      setLocalMicrophoneTrack(null);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    };
  }, [active, connection?.clientSecret, connection?.instructions, connection?.tools, runtimeAgent]);

  const connected = active && Boolean(connection?.clientSecret);
  return {
    agentCaption: connected ? agentCaption : "",
    agentSpeaking: connected ? agentSpeaking : false,
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

export function AgentCallModal({ agent, machine, phase, error, notice, livekit, realtime, runtimeAgent, onClose, onVoiceConnected }: AgentCallModalProps) {
  const realtimeVoice = useDashboardRealtime(realtime, runtimeAgent, phase !== "failed");
  const livekitVoice = useDashboardLiveKit(livekit, phase !== "failed" && !realtime);
  const dashboardVoice = realtime ? realtimeVoice : livekitVoice;
  const voiceFailed = Boolean(livekit || realtime) && (dashboardVoice.status === "failed" || dashboardVoice.status === "blocked");
  const displayError = error || (voiceFailed ? dashboardVoice.error || voiceStatusLabel(dashboardVoice.status, true) : "");
  const visualPhase: AgentCallPhase = displayError ? "failed" : phase;
  const feedbackActive = visualPhase !== "ringing" && visualPhase !== "failed";
  const browserTranscriptionActive = feedbackActive && dashboardVoice.status !== "connected" && !dashboardVoice.agentSpeaking;
  const { bands, micStatus, speechStatus, transcript, volume } = useLiveVoiceFeedback(feedbackActive, browserTranscriptionActive, dashboardVoice.localMicrophoneTrack);
  const isAgentSpeaking = dashboardVoice.agentSpeaking || (dashboardVoice.status !== "connected" && visualPhase === "talking");
  const isListening = (visualPhase === "answered" || visualPhase === "talking") && !isAgentSpeaking;
  const isRinging = visualPhase === "ringing";
  const isAnsweredTransition = visualPhase === "answered";
  const dashboardVoiceMessage = dashboardVoice.error || voiceStatusLabel(dashboardVoice.status, Boolean(livekit || realtime));
  const dashboardVoiceMetric = dashboardVoice.status === "connected"
    ? dashboardVoice.error ? "Speaker-only" : `${dashboardVoice.participantCount} remote`
    : dashboardVoiceMessage;
  const displayedTranscript = dashboardVoice.status === "connected" ? dashboardVoice.userTranscript : transcript;
  const transcriptStatusLabel = dashboardVoice.status === "connected"
    ? dashboardVoice.agentSpeaking ? "Transcript paused" : "Transcript live"
    : speechStatus === "listening" ? "Transcript live" : speechStatus === "paused" ? "Transcript paused" : "Transcript idle";
  const voiceConnectedCalled = React.useRef(false);
  const [ringingCycle, setRingingCycle] = React.useState({ agentId: agent.id, step: 0 });
  const ringingStep = ringingCycle.agentId === agent.id ? ringingCycle.step : 0;
  const ringingMessage = realtime
    ? ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Connecting Realtime audio"
    : ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Creating agent room";

  React.useEffect(() => {
    const voiceReady = realtime
      ? dashboardVoice.status === "connected"
      : dashboardVoice.status === "connected" && dashboardVoice.remoteAudioActive;
    if (!voiceReady || voiceConnectedCalled.current) return;
    voiceConnectedCalled.current = true;
    onVoiceConnected?.();
  }, [dashboardVoice.remoteAudioActive, dashboardVoice.status, onVoiceConnected, realtime]);

  React.useEffect(() => {
    if (!isRinging) return undefined;
    const interval = window.setInterval(() => {
      setRingingCycle((current) => current.agentId === agent.id
        ? { agentId: agent.id, step: current.step + 1 }
        : { agentId: agent.id, step: 0 });
    }, 1400);
    return () => window.clearInterval(interval);
  }, [agent.id, isRinging]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.callModalBackdrop} role="presentation">
      <section
        className={styles.callModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-call-title"
      >
        <CloseIconButton
          onClick={onClose}
          aria-label="Close call"
          className={styles.callModalClose}
        />

        <div
          className={[
            styles.callAgentIconShell,
            isRinging ? styles.callAgentIconRinging : "",
            isAnsweredTransition ? styles.callAgentIconAnswered : "",
            isAgentSpeaking ? styles.callAgentIconTalking : "",
            isListening ? styles.callAgentIconListening : "",
          ].filter(Boolean).join(" ")}
          style={{ "--call-volume": String(Math.max(0.18, volume)) } as React.CSSProperties}
        >
          {dashboardVoice.agentCaption ? (
            <div className={styles.callAgentCaption} aria-live="polite" data-testid="agent-call-agent-caption">
              {dashboardVoice.agentCaption}
            </div>
          ) : null}
          <div className={styles.callAgentHalo} />
          {isRinging ? <div className={styles.callRingOrbit} aria-hidden="true" /> : null}
          <div className={`${styles.callAgentOrb} ${visualPhase === "failed" ? styles.callAgentOrbDanger : ""}`}>
            <BeeIcon
              role={agent.beeRole === "queen" ? "queen" : "worker"}
              workerClass={agent.workerClass}
              size={88}
              dim={visualPhase === "ringing"}
            />
          </div>
        </div>

        <div className={styles.callIdentity}>
          <h2 id="agent-call-title">{agent.name}</h2>
          <p>{machine.name} | {agent.runtime} | {agent.role}</p>
        </div>

        {isRinging ? (
          <div className={styles.callRingingStage} aria-live="polite">
            <span>{ringingMessage}</span>
            <div className={styles.callRingingDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.callWaveform} aria-label={micStatus === "listening" ? "Live microphone waveform" : "Microphone waveform idle"}>
              {bands.map((band, index) => (
                <span
                  key={index}
                  style={{ height: `${Math.max(8, Math.round((band || 0.06) * 84))}px` }}
                />
              ))}
            </div>

            <div className={styles.callTelemetry}>
              <span><Mic2 size={13} aria-hidden="true" /> {micStatus === "listening" ? "Mic live" : "Mic idle"}</span>
              <span><Waves size={13} aria-hidden="true" /> {transcriptStatusLabel}</span>
              <span><PhoneCall size={13} aria-hidden="true" /> {dashboardVoiceMetric}</span>
            </div>
          </>
        )}

        {!isRinging ? (
          <div className={styles.callTranscript} aria-live="polite">
            {displayError ? (
              <span>{displayError}</span>
            ) : displayedTranscript ? (
              <span>{displayedTranscript}</span>
            ) : notice ? (
              <span>{notice}</span>
            ) : isAnsweredTransition ? (
              <span>{agent.name} answered. Connecting audio...</span>
            ) : (
              <span>{agent.name} is on the line.</span>
            )}
          </div>
        ) : null}

        <button type="button" className={styles.callHangupButton} onClick={onClose}>
          {visualPhase === "failed" ? <PhoneOff size={15} aria-hidden="true" /> : <PhoneCall size={15} aria-hidden="true" />}
          {visualPhase === "failed" ? "Close" : "End call"}
        </button>
      </section>
    </div>,
    document.body,
  );
}
