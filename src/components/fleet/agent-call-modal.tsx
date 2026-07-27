"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Cpu, Lock, MessageSquare, Mic, MicOff, Pause, Phone, PhoneOff, UserPlus, Wallet } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { speechRecognitionConstructor } from "@/features/chat/chat-composer";
import type { SpeechRecognitionLike } from "@/features/chat/chat-composer";
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
import { completeVoiceRun, type AgentCallVoiceRun } from "./agent-call-run-events";
import type { FleetAgent, FleetMachine } from "./fleet-data";
import {
  BAND_COUNT,
  ECHO_CANCELLED_AUDIO,
  idleBands,
  useDashboardGeminiLive,
  useDashboardLiveKit,
  useDashboardLocalTts,
  useDashboardRealtime,
  voiceStatusLabel,
  type AgentCallGeminiLive,
  type AgentCallLiveKit,
  type AgentCallLocalTts,
  type AgentCallPhase,
  type AgentCallRealtime,
  type AgentCallRuntimeAgent,
} from "./agent-call-transports";
import styles from "./agent-call.module.css";

export type { AgentCallVoiceRun } from "./agent-call-run-events";
export type {
  AgentCallGeminiLive,
  AgentCallLiveKit,
  AgentCallLocalTts,
  AgentCallPhase,
  AgentCallRealtime,
  AgentCallRealtimeTool,
  AgentCallRuntimeAgent,
} from "./agent-call-transports";



type AgentCallModalProps = {
  agent: FleetAgent;
  machine: FleetMachine;
  phase: AgentCallPhase;
  error?: string;
  notice?: string;
  livekit?: AgentCallLiveKit;
  realtime?: AgentCallRealtime;
  localTts?: AgentCallLocalTts;
  geminiLive?: AgentCallGeminiLive;
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
  geminiLive,
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
  const geminiVoice = useDashboardGeminiLive(geminiLive, runtimeAgent, phase !== "failed", muted || held, voiceRunId);
  const livekitVoice = useDashboardLiveKit(livekit, phase !== "failed" && !realtime && !localTts && !geminiLive, muted || held, voiceRunId);
  const dashboardVoice = geminiLive ? geminiVoice : localTts ? localTtsVoice : realtime ? realtimeVoice : livekitVoice;
  const hasVoiceConnection = Boolean(livekit || realtime || localTts || geminiLive);
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
  const ringingMessage = geminiLive
    ? ringingStep % 2 === 0 ? `Calling ${agent.name}` : "Connecting Gemini Live"
    : realtime
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
    const voiceReady = realtime || localTts || geminiLive
      ? dashboardVoice.status === "connected"
      : dashboardVoice.status === "connected" && dashboardVoice.remoteAudioActive;
    if (!voiceReady || voiceConnectedCalled.current) return;
    voiceConnectedCalled.current = true;
    onVoiceConnected?.();
  }, [dashboardVoice.remoteAudioActive, dashboardVoice.status, geminiLive, localTts, onVoiceConnected, realtime]);

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
