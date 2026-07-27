"use client";
// Small self-contained bottom-center toast (no shared toast system exists in the
// app yet — only a persistent notification center). Portals to body inside a
// themed .zhc-root so the scoped tokens resolve, announces politely, and
// auto-dismisses. Could be promoted to a shared primitive later.
import React from "react";
import { createPortal } from "react-dom";
import type { Theme } from "./types";

export function Snackbar({
  message,
  sub,
  onClose,
  duration = 3200,
  icon = "🚫",
  theme = "dark",
}: {
  message: string;
  sub?: string;
  onClose: () => void;
  duration?: number;
  icon?: string;
  theme?: Theme;
}) {
  React.useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="zhc-root frfade"
      data-theme={theme}
      role="status"
      aria-live="polite"
      style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 2147483200, display: "flex", alignItems: "center", gap: 11, maxWidth: "min(92vw, 460px)", padding: "12px 14px 12px 16px", borderRadius: 12, border: "1px solid var(--honey-line)", background: "var(--panel-hi)", boxShadow: "0 18px 50px -18px rgba(0,0,0,0.6)" }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{message}</div>
        {sub ? <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 2 }}>{sub}</div> : null}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" style={{ marginLeft: 4, cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 999, width: 22, height: 22, fontSize: 11, lineHeight: 1, flexShrink: 0 }}>✕</button>
    </div>,
    document.body,
  );
}
