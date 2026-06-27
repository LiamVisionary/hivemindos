"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

import { LottiePlayer } from "@/components/ui/lottie-player";
import { HONEY_BEE_LOTTIE_SRC } from "@/components/ui/lottie-asset-cache";
import type { BeePilotPhase } from "@/features/dashboard/bee-pilot/use-bee-pilot";

import styles from "./bee-pilot.module.css";

const SUGGESTIONS = [
  "Create an agent",
  "Show me my wallets",
  "Draft up an X post about the hive",
  "Create a schedule",
];

type BeePilotPopupProps = {
  open: boolean;
  input: string;
  phase: BeePilotPhase;
  status: string;
  onOpenChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onSubmit: (command: string, origin?: { x: number; y: number }) => void;
  onDismissStatus: () => void;
};

/**
 * Queen Bee quick command popup (Cmd+J / Ctrl+J). While a command runs, the
 * popup collapses to a floating status pill so the bee can fly the dashboard.
 */
export function BeePilotPopup(props: BeePilotPopupProps) {
  const { open, input, phase, status, onOpenChange, onInputChange, onSubmit, onDismissStatus } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const beeIconRef = useRef<HTMLSpanElement | null>(null);
  const busy = phase === "thinking" || phase === "flying";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const submit = (command: string) => {
    if (!command.trim() || busy) return;
    // Measure before the popup unmounts so the bee takes off from its icon.
    // The input is left intact (visible while thinking); the hook clears it
    // when it closes the popup to begin the automation.
    const iconRect = beeIconRef.current?.getBoundingClientRect();
    onSubmit(
      command,
      iconRect ? { x: iconRect.left + iconRect.width / 2, y: iconRect.top + iconRect.height / 2 } : undefined,
    );
  };

  const thinking = phase === "thinking";
  const inlineMessage = (phase === "error" || phase === "done") && status;

  return (
    <>
      {open ? (
        <div
          className={styles.pilotOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <section className={styles.pilotPanel} role="dialog" aria-modal="true" aria-label="Queen Bee command">
            <header className={styles.pilotHeader}>
              <Image src="/icons/queen-bee-v2.png" alt="" width={44} height={44} unoptimized />
              <strong>Queen Bee</strong>
              <kbd>{typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac") ? "⌘B" : "Ctrl B"}</kbd>
            </header>
            <div className={styles.pilotInputRow}>
              <span ref={beeIconRef} style={{ lineHeight: 0 }}>
                <LottiePlayer src={HONEY_BEE_LOTTIE_SRC} size={32} loop autoplay ariaLabel="Queen Bee is listening" />
              </span>
              <input
                ref={inputRef}
                value={input}
                placeholder="What can I help you with?"
                aria-label="Tell Queen Bee what to do"
                disabled={busy}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit(input);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onOpenChange(false);
                  }
                }}
              />
            </div>
            {thinking ? (
              <div className={styles.pilotThinking} role="status" aria-live="polite">
                <span className={styles.pilotThinkingLabel}>Queen Bee is thinking</span>
                <span className={styles.pilotDots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : (
              <>
                {inlineMessage ? (
                  <p className={styles.pilotInlineMessage} data-state={phase === "error" ? "error" : undefined} role="status" aria-live="polite">
                    {status}
                  </p>
                ) : null}
                <div className={styles.pilotSuggestions} aria-label="Examples">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => submit(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
      {!open && phase !== "idle" && status ? (
        <div
          className={styles.pilotStatusPill}
          data-state={phase === "error" ? "error" : undefined}
          role="status"
          aria-live="polite"
        >
          <LottiePlayer src={HONEY_BEE_LOTTIE_SRC} size={26} loop autoplay />
          <span>{status}</span>
          {busy ? null : (
            <button type="button" onClick={onDismissStatus} aria-label="Dismiss Queen Bee status">
              ✕
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
