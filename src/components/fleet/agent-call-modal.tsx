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
  onClose: () => void;
  onVoiceConnected?: () => void;
};

const BAND_COUNT = 24;

export type AgentCallLiveKit = {
  serverUrl: string;
  token: string;
  room?: string;
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

export function AgentCallModal({ agent, machine, phase, error, notice, livekit, onClose, onVoiceConnected }: AgentCallModalProps) {
  const dashboardVoice = useDashboardLiveKit(livekit, phase !== "failed");
  const feedbackActive = phase !== "ringing" && phase !== "failed";
  const browserTranscriptionActive = feedbackActive && dashboardVoice.status !== "connected" && !dashboardVoice.agentSpeaking;
  const { bands, micStatus, speechStatus, transcript, volume } = useLiveVoiceFeedback(feedbackActive, browserTranscriptionActive, dashboardVoice.localMicrophoneTrack);
  const isAgentSpeaking = dashboardVoice.agentSpeaking || (dashboardVoice.status !== "connected" && phase === "talking");
  const isListening = (phase === "answered" || phase === "talking") && !isAgentSpeaking;
  const isRinging = phase === "ringing";
  const isAnsweredTransition = phase === "answered";
  const dashboardVoiceMessage = dashboardVoice.error || voiceStatusLabel(dashboardVoice.status, Boolean(livekit));
  const displayedTranscript = dashboardVoice.status === "connected" ? dashboardVoice.userTranscript : transcript;
  const transcriptStatusLabel = dashboardVoice.status === "connected"
    ? dashboardVoice.agentSpeaking ? "Transcript paused" : "Transcript live"
    : speechStatus === "listening" ? "Transcript live" : speechStatus === "paused" ? "Transcript paused" : "Transcript idle";
  const voiceConnectedCalled = React.useRef(false);
  const [ringingCycle, setRingingCycle] = React.useState({ agentId: agent.id, step: 0 });
  const ringingStep = ringingCycle.agentId === agent.id ? ringingCycle.step : 0;
  const ringingMessage = ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Creating agent room";

  React.useEffect(() => {
    if (dashboardVoice.status !== "connected" || voiceConnectedCalled.current) return;
    voiceConnectedCalled.current = true;
    onVoiceConnected?.();
  }, [dashboardVoice.status, onVoiceConnected]);

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
            <div className={styles.callAgentCaption} aria-live="polite">
              {dashboardVoice.agentCaption}
            </div>
          ) : null}
          <div className={styles.callAgentHalo} />
          {isRinging ? <div className={styles.callRingOrbit} aria-hidden="true" /> : null}
          <div className={`${styles.callAgentOrb} ${phase === "failed" ? styles.callAgentOrbDanger : ""}`}>
            <BeeIcon
              role={agent.beeRole === "queen" ? "queen" : "worker"}
              workerClass={agent.workerClass}
              size={88}
              dim={phase === "ringing"}
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
              <span><PhoneCall size={13} aria-hidden="true" /> {dashboardVoice.status === "connected" ? `${dashboardVoice.participantCount} remote` : dashboardVoiceMessage}</span>
            </div>
          </>
        )}

        {!isRinging ? (
          <div className={styles.callTranscript} aria-live="polite">
            {error ? (
              <span>{error}</span>
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
          {phase === "failed" ? <PhoneOff size={15} aria-hidden="true" /> : <PhoneCall size={15} aria-hidden="true" />}
          {phase === "failed" ? "Close" : "End call"}
        </button>
      </section>
    </div>,
    document.body,
  );
}
