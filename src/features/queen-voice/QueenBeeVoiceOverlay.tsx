"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Crown, Mic, MicOff, Settings2, X } from "lucide-react";
import { listenForQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { QueenVoiceGlow } from "./QueenVoiceGlow";
import { useQueenBeeRealtime } from "./use-queen-bee-realtime";
import {
  useQueenBeeVoice,
  type QueenVoicePhase,
  type QueenVoiceTurn,
} from "./use-queen-bee-voice";
import styles from "./queen-voice.module.css";

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

function TranscriptTurns({ turns }: { turns: QueenVoiceTurn[] }) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [turns]);

  if (!turns.length) return null;
  return (
    <div ref={panelRef} className={styles.transcriptPanel} aria-live="polite">
      {turns.map((turn) => (
        <div key={turn.id} className={styles.turn}>
          <span
            className={`${styles.turnWho} ${turn.who === "queen" ? styles.turnWhoQueen : styles.turnWhoYou}`}
          >
            {turn.who === "queen" ? "Queen Bee" : "You"}
          </span>
          <p
            className={`${styles.turnText} ${turn.live ? styles.turnTextLive : ""}`}
          >
            {turn.text}
          </p>
        </div>
      ))}
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
export function QueenBeeVoiceOverlay() {
  const [open, setOpen] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);
  // Bumping the nonce restarts the realtime session (e.g. new voice).
  const [sessionNonce, setSessionNonce] = React.useState(0);
  const [realtimeFailedNonce, setRealtimeFailedNonce] = React.useState(-1);
  const sessionNonceRef = React.useRef(sessionNonce);
  React.useEffect(() => {
    sessionNonceRef.current = sessionNonce;
  }, [sessionNonce]);
  const realtimeMode = realtimeFailedNonce !== sessionNonce;

  const handleRealtimeFailed = React.useCallback(() => {
    // Remember which session failed so this nonce falls back to the pipeline.
    setRealtimeFailedNonce(sessionNonceRef.current);
  }, []);
  const realtime = useQueenBeeRealtime(
    open && realtimeMode,
    muted,
    handleRealtimeFailed,
  );
  const pipeline = useQueenBeeVoice(open && !realtimeMode, muted);
  const voiceState = realtimeMode ? realtime : pipeline;

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let lastToggleAt = 0;
    void listenForQueenVoiceToggle(() => {
      // The desktop shell can deliver one menu click as two events.
      const now = Date.now();
      if (now - lastToggleAt < 300) return;
      lastToggleAt = now;
      setOpen((current) => !current);
      setMuted(false);
      setVoicePickerOpen(false);
      setSessionNonce((current) => current + 1);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <QueenVoiceGlow active={open} />
      <div
        className={styles.overlayShell}
        role="dialog"
        aria-label="Queen Bee voice chat"
      >
        <TranscriptTurns turns={voiceState.turns} />
        {voicePickerOpen ? (
          <VoicePicker
            onVoiceChanged={() => {
              // Restart the session so the new voice takes effect now.
              setVoicePickerOpen(false);
              setSessionNonce((current) => current + 1);
            }}
          />
        ) : null}
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
      </div>
    </>,
    document.body,
  );
}
