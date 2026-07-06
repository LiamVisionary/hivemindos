"use client";
// Reject a deliverable and redirect the crew: a modal wrapping the directive
// composer. On submit it writes a source="reject" directive tagged with the
// deliverable, which lands in company knowledge and the crew's dispatch context.
import React from "react";
import { createPortal } from "react-dom";
import { CompanyDirectiveComposer, type DirectiveDraft } from "./CompanyDirectiveComposer";
import type { Theme } from "./types";

export function RejectDeliverableModal({
  companyId,
  deliverableRef,
  onClose,
  onDone,
  icon = "↩️",
  title = "Reject & redirect the crew",
  intro,
  placeholder = "What's wrong / what to do instead…",
  submitLabel = "Reject & redirect",
  theme = "dark",
}: {
  companyId: string;
  deliverableRef: string;
  onClose: () => void;
  onDone?: () => void;
  /** Header icon (defaults to the reject glyph). */
  icon?: string;
  /** Header title (override for reuse, e.g. an email correction). */
  title?: string;
  /** Explanatory line above the composer. Falls back to the reject copy. */
  intro?: React.ReactNode;
  /** Composer textarea placeholder. */
  placeholder?: string;
  /** Composer submit button label. */
  submitLabel?: string;
  theme?: Theme;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const submit = async (draft: DirectiveDraft) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-directive", id: companyId, directive: { ...draft, source: "reject", deliverableRef } }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error || "Could not submit the rejection.");
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the rejection.");
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="zhc-root" data-theme={theme} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2147483005, background: "rgba(2,4,8,0.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--bg-soft)", border: "1px solid var(--line-2)", borderRadius: 16, padding: 20, boxShadow: "0 30px 80px rgba(0,0,0,0.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span aria-hidden style={{ fontSize: 18 }}>{icon}</span>
          <div style={{ flex: 1, fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 600 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, width: 30, height: 30, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.6, marginBottom: 14 }}>
          {intro ?? (
            <>Rejecting <b style={{ color: "var(--fg-2)" }}>{deliverableRef}</b>. Your feedback becomes a standing directive in company knowledge — the crew reads it on every dispatch, so it corrects course. Optionally point them at a skill or attach references.</>
          )}
        </div>
        <CompanyDirectiveComposer autoFocus placeholder={placeholder} submitLabel={submitLabel} busy={busy} onSubmit={submit} />
        {error && <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger)" }}>{error}</div>}
      </div>
    </div>,
    document.body,
  );
}
