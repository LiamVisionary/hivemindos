"use client";

/* ChatPill.tsx — the "Message the hive" pill. Collapsed it shows a breathing
   honey orb + label; on hover/focus it glides open into a full input. Pure CSS
   expansion (see fleet-hive.css) so it stays open while typing. */

import { useEffect, useRef, useState } from "react";
import {
  emitQueenVoiceToggle,
  getQueenVoiceOpen,
  listenForQueenVoiceState,
} from "@/lib/native/queen-voice-events";

export function ChatPill({
  placeholder,
  offsetX = 0,
  onSend,
  tone = "hive",
  wrapStyle,
  topSlot,
}: {
  placeholder?: string;
  /** px to nudge left of centre so the pill centres over the canvas, not under the panel */
  offsetX?: number;
  onSend?: (text: string) => void;
  /** "hive" = honey palette; "legacy" = blue palette to match the graph/map/list views */
  tone?: "hive" | "legacy";
  /** override the wrap positioning (e.g. anchor to a corner in legacy views) */
  wrapStyle?: React.CSSProperties;
  /** rendered inside the (positioned) wrap so it can attach to the pill — e.g.
   *  the chat-history toggle tab that sits on the pill's top-centre edge. */
  topSlot?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Reflect whether Queen Bee voice mode is live so the toggle reads as on/off.
  // The overlay owns the state and broadcasts it (incl. Escape/clap-wake closes).
  const [voiceActive, setVoiceActive] = useState(getQueenVoiceOpen);
  useEffect(() => listenForQueenVoiceState(setVoiceActive), []);
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = ref.current?.value.trim();
    if (v && onSend) onSend(v);
    if (ref.current) ref.current.value = "";
  };
  const resolvedWrapStyle = {
    ...(offsetX ? { left: `calc(50% - ${offsetX}px)` } : null),
    ...wrapStyle,
  };
  return (
    <div
      className="fr-chat-wrap"
      style={Object.keys(resolvedWrapStyle).length ? resolvedWrapStyle : undefined}
    >
      {topSlot}
      <form className={`fr-chat${tone === "legacy" ? " fr-chat--legacy" : ""}`} onSubmit={onSubmit}>
        <span className="fr-chat-orb">
          <span className="ring" />
          <span className="core" />
        </span>
        <span className="fr-chat-label">Message the hive</span>
        <span className="fr-chat-field">
          <input
            ref={ref}
            className="fr-chat-input"
            placeholder={placeholder || "Ask the hive to dispatch a task…"}
            aria-label="Message the hive"
          />
          <button
            type="button"
            className={`fr-chat-voice${voiceActive ? " is-active" : ""}`}
            aria-pressed={voiceActive}
            aria-label={voiceActive ? "Turn off Queen Bee voice" : "Talk to the hive (voice)"}
            title={voiceActive ? "Voice mode on — tap to end" : "Talk to the hive (voice)"}
            onClick={() => emitQueenVoiceToggle()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
          <button type="submit" className="fr-chat-send" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </span>
      </form>
    </div>
  );
}
