"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  FileText,
  Mic,
  MicOff,
  Settings2,
  X,
} from "lucide-react";
import { listenForQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { QueenVoiceGlow } from "./QueenVoiceGlow";
import { useQueenClapActivation } from "./use-queen-clap-activation";
import { useQueenBeeRealtime } from "./use-queen-bee-realtime";
import {
  useQueenBeeVoice,
  type QueenVoicePhase,
} from "./use-queen-bee-voice";
import { useQueenChat, type QueenChatTurn } from "./queen-chat-store";
import styles from "./queen-voice.module.css";

const QUEEN_VOICE_ACTIVATION_SOUND_SRC = "/audio/sfx/scifi-ping.wav";
const QUEEN_VOICE_OPENING_LINE =
  "Hey Liam, I'm here. What should we work on first?";

// Spoken while a tool call runs (the 10-15s dead-air pause), so the user knows
// Queen Bee is working rather than stuck. One is picked per pause and held.
const QUEEN_THINKING_FILLERS = [
  "Let me check…",
  "On it…",
  "Let me see…",
  "Searching your hive…",
  "One sec, looking that up…",
];

function playQueenVoiceActivationSound() {
  if (typeof Audio === "undefined") return;
  const audio = new Audio(QUEEN_VOICE_ACTIVATION_SOUND_SRC);
  audio.volume = 0.72;
  void audio.play().catch(() => undefined);
}

// A softer cue the moment Queen Bee starts working a tool call.
function playQueenThinkingSound() {
  if (typeof Audio === "undefined") return;
  const audio = new Audio(QUEEN_VOICE_ACTIVATION_SOUND_SRC);
  audio.volume = 0.4;
  audio.playbackRate = 0.82;
  void audio.play().catch(() => undefined);
}

function statusLabel(
  phase: QueenVoicePhase,
  muted: boolean,
  speechDetected: boolean,
) {
  if (muted) return "Mic muted";
  if (phase === "starting") return "Connecting...";
  if (phase === "listening")
    return speechDetected ? "Listening..." : "Your turn - speak to Queen Bee";
  if (phase === "thinking") return "Queen Bee is thinking...";
  if (phase === "speaking") return "Queen Bee is speaking";
  return "Voice chat hit a snag";
}

function statusDotClass(phase: QueenVoicePhase) {
  if (phase === "listening") return styles.statusDotListening;
  if (phase === "thinking") return styles.statusDotThinking;
  if (phase === "speaking") return styles.statusDotSpeaking;
  if (phase === "error") return styles.statusDotError;
  return "";
}

function clapWakeTitle(status: string, error: string) {
  if (status === "listening") return "Clap wake is listening";
  if (status === "paused") return "Clap wake resumes after this chat";
  if (status === "starting") return "Clap wake is starting";
  if (status === "error") return error || "Clap wake is unavailable";
  return "Enable clap wake";
}

function TranscriptTurns({
  turns,
  minimized,
  onToggleMinimize,
  thinking,
  thinkingLabel,
  onShowDetail,
}: {
  turns: QueenChatTurn[];
  minimized: boolean;
  onToggleMinimize: () => void;
  thinking: boolean;
  thinkingLabel: string;
  onShowDetail: (detail: string) => void;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (minimized) return;
    const panel = panelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [turns, minimized, thinking]);

  if (!turns.length && !thinking) return null;
  return (
    <div
      className={`${styles.transcriptPanel} ${minimized ? styles.transcriptPanelMinimized : ""}`}
    >
      <button
        type="button"
        className={styles.minimizeButton}
        onClick={onToggleMinimize}
        aria-label={minimized ? "Expand chat history" : "Minimize chat history"}
        aria-pressed={minimized}
        title={minimized ? "Expand chat history" : "Minimize chat history"}
      >
        {minimized ? (
          <ChevronUp size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </button>
      {minimized ? null : (
        <div
          ref={panelRef}
          className={styles.transcriptScroll}
          aria-live="polite"
        >
          {turns.slice(-3).map((turn) => (
            <div key={turn.id} className={styles.turn}>
              <span
                className={`${styles.turnWho} ${turn.who === "queen" ? styles.turnWhoQueen : styles.turnWhoYou}`}
              >
                {turn.who === "queen" ? "Queen Bee" : "You"}
              </span>
              <p
                className={`${styles.turnText} ${turn.live ? styles.turnTextLive : ""} ${turn.pending && !turn.text ? styles.turnTextThinking : ""}`}
              >
                {turn.pending && !turn.text ? (
                  // steady label keeps the bubble height stable while the dots
                  // animation cycles through its empty frame
                  <>Thinking<span className={styles.thinkingDots} aria-hidden="true" /></>
                ) : (
                  turn.text
                )}
              </p>
              {turn.detail ? (
                <button
                  type="button"
                  className={styles.detailButton}
                  onClick={() => onShowDetail(turn.detail ?? "")}
                >
                  <FileText size={12} aria-hidden="true" />
                  Show what she found
                </button>
              ) : null}
            </div>
          ))}
          {thinking ? (
            <div className={styles.turn}>
              <span className={`${styles.turnWho} ${styles.turnWhoQueen}`}>
                Queen Bee
              </span>
              <p className={`${styles.turnText} ${styles.turnTextThinking}`}>
                {thinkingLabel || "Checking"}
                <span className={styles.thinkingDots} aria-hidden="true" />
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function VoicePicker({ onVoiceChanged }: { onVoiceChanged: () => void }) {
  const [voices, setVoices] = React.useState<string[]>([]);
  const [voice, setVoice] = React.useState("");
  const [saving, setSaving] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    void fetch("/api/queen-bee/voice", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { voice?: string; voices?: string[] }) => {
        if (disposed) return;
        if (Array.isArray(data.voices)) setVoices(data.voices);
        if (typeof data.voice === "string") setVoice(data.voice);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const selectVoice = async (nextVoice: string) => {
    if (nextVoice === voice || saving) return;
    setSaving(nextVoice);
    try {
      const response = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-voice", voice: nextVoice }),
        cache: "no-store",
      });
      if (response.ok) {
        setVoice(nextVoice);
        onVoiceChanged();
      }
    } finally {
      setSaving("");
    }
  };

  return (
    <div
      className={styles.voicePicker}
      role="listbox"
      aria-label="Queen Bee voice"
    >
      <span className={styles.voicePickerTitle}>Queen Bee voice</span>
      {voices.map((option) => (
        <button
          key={option}
          type="button"
          role="option"
          aria-selected={option === voice}
          className={`${styles.voiceOption} ${option === voice ? styles.voiceOptionActive : ""}`}
          onClick={() => void selectVoice(option)}
          disabled={Boolean(saving)}
        >
          {option === voice ? <Check size={12} aria-hidden="true" /> : null}
          {option}
          {saving === option ? "..." : ""}
        </button>
      ))}
      {!voices.length ? (
        <span className={styles.voicePickerEmpty}>Loading voices...</span>
      ) : null}
    </div>
  );
}

/**
 * Full-window Queen Bee voice chat: the Apple Intelligence-style perimeter
 * glow plus live transcription captions for both sides of the conversation.
 * Defaults to OpenAI Realtime speech-to-speech; falls back to the realtime
 * STT + conversational turn + TTS pipeline when a realtime session cannot be
 * established. Toggled from the menu bar tray icon or Cmd+Shift+V.
 */
export function QueenBeeVoiceOverlay({
  clapWakeEnabled = false,
  onClapWakeEnabledChange,
  onDriveDashboard,
}: {
  clapWakeEnabled?: boolean;
  onClapWakeEnabledChange?: (enabled: boolean) => void;
  onDriveDashboard?: (
    command: string,
    opts?: { onModalOpen?: () => void },
  ) => Promise<string>;
} = {}) {
  const [open, setOpen] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);
  const [minimized, setMinimized] = React.useState(false);
  // Bumping the nonce restarts the realtime session (e.g. new voice).
  const [sessionNonce, setSessionNonce] = React.useState(0);
  const [realtimeFailedNonce, setRealtimeFailedNonce] = React.useState(-1);
  const sessionNonceRef = React.useRef(sessionNonce);
  React.useEffect(() => {
    sessionNonceRef.current = sessionNonce;
  }, [sessionNonce]);
  const realtimeMode = realtimeFailedNonce !== sessionNonce;

  const resetVoiceSessionUi = React.useCallback(() => {
    setMuted(false);
    setVoicePickerOpen(false);
    setMinimized(false);
    setSessionNonce((current) => current + 1);
  }, []);

  const openQueenVoiceChat = React.useCallback(() => {
    setOpen((current) => {
      if (!current) playQueenVoiceActivationSound();
      return true;
    });
    resetVoiceSessionUi();
  }, [resetVoiceSessionUi]);

  const toggleQueenVoiceChat = React.useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (next) playQueenVoiceActivationSound();
      return next;
    });
    resetVoiceSessionUi();
  }, [resetVoiceSessionUi]);

  const toggleClapWake = React.useCallback(() => {
    onClapWakeEnabledChange?.(!clapWakeEnabled);
  }, [clapWakeEnabled, onClapWakeEnabledChange]);

  const clapActivation = useQueenClapActivation({
    enabled: clapWakeEnabled,
    paused: open,
    onActivation: openQueenVoiceChat,
  });

  const handleRealtimeFailed = React.useCallback(() => {
    // Remember which session failed so this nonce falls back to the pipeline.
    setRealtimeFailedNonce(sessionNonceRef.current);
  }, []);
  // Drive the dashboard; collapse the chat out of the way ONLY when the bee
  // opens a modal (it would otherwise cover it). Plain navigation keeps the
  // chat history visible.
  const driveDashboard = React.useCallback(
    async (command: string) => {
      if (!onDriveDashboard) return "The dashboard isn't available to drive right now.";
      return onDriveDashboard(command, { onModalOpen: () => setMinimized(true) });
    },
    [onDriveDashboard],
  );
  const realtime = useQueenBeeRealtime(
    open && realtimeMode,
    muted,
    handleRealtimeFailed,
    onDriveDashboard ? driveDashboard : undefined,
    QUEEN_VOICE_OPENING_LINE,
  );
  const pipeline = useQueenBeeVoice(
    open && !realtimeMode,
    muted,
    QUEEN_VOICE_OPENING_LINE,
  );
  const voiceState = realtimeMode ? realtime : pipeline;

  // The shared Queen conversation (typed + voice live here together).
  const chat = useQueenChat();
  const { upsertTurn: chatUpsertTurn, removeTurn: chatRemoveTurn } = chat;

  // Bridge voice turns into the shared store (append-only diff). Namespace ids
  // per voice session so turns from different sessions never collide, and mirror
  // the hooks' echo-drops by removing ids that vanished since the last tick.
  const voiceSeenRef = React.useRef<Set<string>>(new Set());
  const voiceSessionRef = React.useRef(0);
  const prevSessionNonceRef = React.useRef(sessionNonce);
  const prevRealtimeModeRef = React.useRef(realtimeMode);
  React.useEffect(() => {
    if (sessionNonce !== prevSessionNonceRef.current || realtimeMode !== prevRealtimeModeRef.current) {
      prevSessionNonceRef.current = sessionNonce;
      prevRealtimeModeRef.current = realtimeMode;
      voiceSessionRef.current += 1;
      voiceSeenRef.current = new Set();
    }
    const sid = voiceSessionRef.current;
    const currentIds = new Set<string>();
    for (const turn of voiceState.turns) {
      const storeId = `voice-${sid}-${turn.id}`;
      currentIds.add(storeId);
      chatUpsertTurn({
        id: storeId,
        who: turn.who,
        text: turn.text,
        live: turn.live,
        detail: turn.detail,
        source: "voice",
      });
    }
    for (const prevId of voiceSeenRef.current) {
      if (!currentIds.has(prevId)) chatRemoveTurn(prevId);
    }
    voiceSeenRef.current = currentIds;
  }, [voiceState.turns, sessionNonce, realtimeMode, chatUpsertTurn, chatRemoveTurn]);

  // When Queen Bee starts working a tool call she goes silent for several
  // seconds; cue a soft sound and a held filler line so the pause reads as
  // "working", not "stuck".
  const [thinkingFiller, setThinkingFiller] = React.useState("");
  const [detailContent, setDetailContent] = React.useState<string | null>(null);
  const prevPhaseRef = React.useRef<QueenVoicePhase>("starting");
  React.useEffect(() => {
    const previous = prevPhaseRef.current;
    prevPhaseRef.current = voiceState.phase;
    if (voiceState.phase === "thinking" && previous !== "thinking") {
      setThinkingFiller(
        QUEEN_THINKING_FILLERS[
          Math.floor(Math.random() * QUEEN_THINKING_FILLERS.length)
        ],
      );
      playQueenThinkingSound();
    }
  }, [voiceState.phase]);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let lastToggleAt = 0;
    void listenForQueenVoiceToggle(() => {
      // The desktop shell can deliver one menu click as two events.
      const now = Date.now();
      if (now - lastToggleAt < 300) return;
      lastToggleAt = now;
      toggleQueenVoiceChat();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toggleQueenVoiceChat]);

  React.useEffect(() => {
    if (!open && detailContent === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The details modal closes first; a second Escape ends a live voice chat.
      if (detailContent !== null) setDetailContent(null);
      else if (open) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, detailContent]);

  if (typeof document === "undefined") return null;
  // Always-mounted: the transcript shows for typed turns too, not just voice.
  if (!open && chat.turns.length === 0) return null;

  return createPortal(
    <>
      {open ? <QueenVoiceGlow active={open} /> : null}
      <div
        className={styles.overlayShell}
        // Lift the whole stack clear of the "Message the hive" pill (bottom:26,
        // ~52px tall) so the chat history sits above it.
        style={{ paddingBottom: 96 }}
        role="dialog"
        aria-label="Queen Bee voice chat"
      >
        <TranscriptTurns
          turns={chat.turns}
          minimized={minimized}
          onToggleMinimize={() => setMinimized((current) => !current)}
          thinking={open && voiceState.phase === "thinking"}
          thinkingLabel={thinkingFiller}
          onShowDetail={setDetailContent}
        />
        {detailContent !== null ? (
          <div
            className={styles.detailBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Queen Bee details"
            onClick={() => setDetailContent(null)}
          >
            <div
              className={styles.detailModal}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.detailModalHeader}>
                <span className={styles.detailModalTitle}>
                  <Crown size={14} aria-hidden="true" />
                  What Queen Bee found
                </span>
                <button
                  type="button"
                  className={styles.detailModalClose}
                  onClick={() => setDetailContent(null)}
                  aria-label="Close details"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.detailModalBody}>{detailContent}</div>
            </div>
          </div>
        ) : null}
        {voicePickerOpen ? (
          <VoicePicker
            onVoiceChanged={() => {
              // Restart the session so the new voice takes effect now.
              setVoicePickerOpen(false);
              setSessionNonce((current) => current + 1);
            }}
          />
        ) : null}
        {open ? (
          <div className={styles.controlBar}>
            <span className={styles.statusBadge}>
              <Crown size={14} aria-hidden="true" />
              <span
                className={`${styles.statusDot} ${statusDotClass(voiceState.phase)}`}
              />
              {statusLabel(voiceState.phase, muted, voiceState.speechDetected)}
            </span>
            {voiceState.phase === "error" && voiceState.error ? (
              <p className={styles.errorText}>{voiceState.error}</p>
            ) : null}
            <button
              type="button"
              className={`${styles.controlButton} ${voicePickerOpen ? styles.controlButtonActive : ""}`}
              onClick={() => setVoicePickerOpen((current) => !current)}
              aria-label="Queen Bee voice settings"
            >
              <Settings2 size={14} aria-hidden="true" />
              Voice
            </button>
            <button
              type="button"
              className={`${styles.controlButton} ${clapWakeEnabled ? styles.controlButtonWakeActive : ""}`}
              onClick={toggleClapWake}
              aria-label={clapWakeEnabled ? "Disable clap wake" : "Enable clap wake"}
              aria-pressed={clapWakeEnabled}
              title={clapWakeTitle(clapActivation.status, clapActivation.error)}
            >
              <AudioLines size={14} aria-hidden="true" />
              Clap
            </button>
            <button
              type="button"
              className={`${styles.controlButton} ${muted ? styles.controlButtonActive : ""}`}
              onClick={() => setMuted((current) => !current)}
            >
              {muted ? (
                <MicOff size={14} aria-hidden="true" />
              ) : (
                <Mic size={14} aria-hidden="true" />
              )}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              className={`${styles.controlButton} ${styles.controlButtonEnd}`}
              onClick={() => setOpen(false)}
            >
              <X size={14} aria-hidden="true" />
              End
            </button>
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
