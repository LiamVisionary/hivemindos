"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Crown, Mic, MicOff, X } from "lucide-react";
import { listenForQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { QueenVoiceGlow } from "./QueenVoiceGlow";
import { useQueenBeeVoice, type QueenVoicePhase, type QueenVoiceTurn } from "./use-queen-bee-voice";
import styles from "./queen-voice.module.css";

function statusLabel(phase: QueenVoicePhase, muted: boolean, speechDetected: boolean) {
  if (muted) return "Mic muted";
  if (phase === "starting") return "Connecting microphone...";
  if (phase === "listening") return speechDetected ? "Listening..." : "Your turn - speak to Queen Bee";
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
          <span className={`${styles.turnWho} ${turn.who === "queen" ? styles.turnWhoQueen : styles.turnWhoYou}`}>
            {turn.who === "queen" ? "Queen Bee" : "You"}
          </span>
          <p className={`${styles.turnText} ${turn.live ? styles.turnTextLive : ""}`}>{turn.text}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Full-window Queen Bee voice chat: the Apple Intelligence-style perimeter
 * glow plus live transcription captions for both sides of the conversation.
 * Toggled from the dedicated menu bar tray icon or Cmd+Shift+V.
 */
export function QueenBeeVoiceOverlay() {
  const [open, setOpen] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const { phase, error, turns, speechDetected } = useQueenBeeVoice(open, muted);

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
      <div className={styles.overlayShell} role="dialog" aria-label="Queen Bee voice chat">
        <TranscriptTurns turns={turns} />
        <div className={styles.controlBar}>
          <span className={styles.statusBadge}>
            <Crown size={14} aria-hidden="true" />
            <span className={`${styles.statusDot} ${statusDotClass(phase)}`} />
            {statusLabel(phase, muted, speechDetected)}
          </span>
          {phase === "error" && error ? <p className={styles.errorText}>{error}</p> : null}
          <button
            type="button"
            className={`${styles.controlButton} ${muted ? styles.controlButtonActive : ""}`}
            onClick={() => setMuted((current) => !current)}
          >
            {muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
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
