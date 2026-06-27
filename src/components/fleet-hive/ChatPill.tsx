"use client";

/* ChatPill.tsx — the "Message the hive" pill. Collapsed it shows a breathing
   honey orb + label; on hover/focus it glides open into a full input. Pure CSS
   expansion (see fleet-hive.css) so it stays open while typing. */

import { useRef } from "react";

export function ChatPill({
  placeholder,
  offsetX = 0,
  onSend,
  tone = "hive",
  wrapStyle,
}: {
  placeholder?: string;
  /** px to nudge left of centre so the pill centres over the canvas, not under the panel */
  offsetX?: number;
  onSend?: (text: string) => void;
  /** "hive" = honey palette; "legacy" = blue palette to match the graph/map/list views */
  tone?: "hive" | "legacy";
  /** override the wrap positioning (e.g. anchor to a corner in legacy views) */
  wrapStyle?: React.CSSProperties;
}) {
  const ref = useRef<HTMLInputElement>(null);
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
