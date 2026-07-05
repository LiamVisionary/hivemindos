"use client";
// Small self-contained bottom-center toast (no shared toast system exists in the
// app yet — only a persistent notification center). Portals to body, announces
// politely, and auto-dismisses. Could be promoted to a shared primitive later.
import React from "react";
import { createPortal } from "react-dom";

export function Snackbar({
  message,
  sub,
  onClose,
  duration = 3200,
  icon = "🚫",
}: {
  message: string;
  sub?: string;
  onClose: () => void;
  duration?: number;
  icon?: string;
}) {
  React.useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 1100, display: "flex", alignItems: "center", gap: 11, maxWidth: "min(92vw, 440px)", padding: "12px 14px 12px 16px", borderRadius: 12, border: "1px solid var(--line-2)", background: "var(--bg-0)", boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{message}</div>
        {sub ? <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 2 }}>{sub}</div> : null}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" style={{ marginLeft: 4, cursor: "pointer", border: "none", background: "var(--bg-3)", color: "var(--fg-3)", borderRadius: 999, width: 20, height: 20, fontSize: 11, lineHeight: 1, flexShrink: 0 }}>✕</button>
    </div>,
    document.body,
  );
}
