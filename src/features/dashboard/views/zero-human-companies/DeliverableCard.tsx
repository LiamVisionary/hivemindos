"use client";
// Zero Human Companies — deliverable cards. A deliverable is rendered as a
// modern flat-skeuomorphic card: a file-type icon badge (depth via a top
// highlight + inner shadow), a HUMAN title, what-it-is, and one clear action.
// Meant to read at a glance for a non-engineer — links open the site, files
// open in the in-app viewer, and junk never reaches this component (the model
// buckets it into the collapsed "working files" group).
import React from "react";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import { FileViewerModal } from "./FileViewer";
import { RejectDeliverableModal } from "./RejectDeliverableModal";
import { Snackbar } from "./Snackbar";
import { Spinner } from "./primitives";
import { dispatchedAgo } from "./company-deliverables";
import { deliverableHref } from "./deliverables-model";
import type { ClassifiedDeliverable, DeliverableIcon } from "./deliverables-model";
import type { Theme } from "./types";

// ── skeuomorphic file-type icon ────────────────────────────────────────────

const ICON_TONE: Record<DeliverableIcon, { from: string; to: string; glyph: React.ReactNode }> = {
  site: { from: "#22d3ee", to: "#0891b2", glyph: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></> },
  payment: { from: "#fbbf24", to: "#d97706", glyph: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></> },
  booking: { from: "#a78bfa", to: "#7c3aed", glyph: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></> },
  status: { from: "#34d399", to: "#059669", glyph: <path d="M3 12h4l2 6 4-14 2 8h6" /> },
  link: { from: "#5eead4", to: "#0d9488", glyph: <><path d="M9 15l6-6" /><path d="M10.5 6.5l1-1a4 4 0 015.5 5.5l-1 1" /><path d="M13.5 17.5l-1 1a4 4 0 01-5.5-5.5l1-1" /></> },
  doc: { from: "#f8fafc", to: "#cbd5e1", glyph: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></> },
  sheet: { from: "#4ade80", to: "#16a34a", glyph: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></> },
  data: { from: "#38bdf8", to: "#0369a1", glyph: <><path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 3 1 1 2 1.5 2 3v2c0 2 1 3 3 3" /><path d="M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 3-1 1-2 1.5-2 3v2c0 2-1 3-3 3" /></> },
  image: { from: "#c084fc", to: "#9333ea", glyph: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-7 7" /></> },
  video: { from: "#f472b6", to: "#db2777", glyph: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></> },
  cog: { from: "#94a3b8", to: "#475569", glyph: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></> },
};

export function FileTypeIcon({ icon, size = 40 }: { icon: DeliverableIcon; size?: number }) {
  const tone = ICON_TONE[icon] ?? ICON_TONE.data;
  const glyphSize = Math.round(size * 0.56);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
        display: "grid", placeItems: "center",
        background: `linear-gradient(160deg, ${tone.from}, ${tone.to})`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 2px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.28)`,
      }}
    >
      <svg width={glyphSize} height={glyphSize} viewBox="0 0 24 24" fill="none" stroke="rgba(9,14,24,0.82)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {tone.glyph}
      </svg>
    </span>
  );
}

// ── deliverable card ───────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = { visit: "Open ↗", open: "View", download: "Download ↓", none: "" };
const HERO_ACTION_LABEL: Record<string, string> = { visit: "Open site ↗", open: "Open", download: "Download ↓", none: "" };

/** Host + path for the skeuomorphic browser bar on a hero link card. */
function urlChrome(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, "") || u.host;
  } catch {
    return url;
  }
}

/** The little address-bar / file-chip strip under a hero card's title. */
function HeroChrome({ isLink, text }: { isLink: boolean; text: string }) {
  return (
    <span
      style={{
        display: "flex", alignItems: "center", gap: 7, minWidth: 0,
        borderRadius: 9, padding: "6px 9px", border: "1px solid var(--line)",
        background: "linear-gradient(180deg, var(--bg-1), var(--bg-3))",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.22)",
      }}
    >
      <span aria-hidden style={{ fontSize: 10, color: "var(--fg-4)", flexShrink: 0 }}>{isLink ? "🔒" : "📄"}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
    </span>
  );
}

export function DeliverableCard({ item, machineName, timestampMs, theme = "dark", layout = "card", companyId, initiallyRejected = false }: {
  item: ClassifiedDeliverable; machineName?: string; timestampMs?: number; theme?: Theme; layout?: "card" | "row" | "hero"; companyId?: string; initiallyRejected?: boolean;
}) {
  const [viewing, setViewing] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejected, setRejected] = React.useState(false);
  const [toast, setToast] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  // Opening an external link routes through the OS opener (a server round trip in
  // the Tauri shell — a couple of seconds); without this the card looked dead on
  // press. Mirrors the email-modal link chips.
  const [opening, setOpening] = React.useState(false);
  const { deliverable, icon, title, kindLabel, action, url } = item;

  const openLink = React.useCallback(async (href: string) => {
    if (!isExternalHttpUrl(href)) return;
    setOpening(true);
    try {
      await openExternalUrl(href);
    } finally {
      setOpening(false);
    }
  }, []);
  const isLink = action === "visit" && !!url;
  const hero = layout === "hero";
  const actionText = (hero ? HERO_ACTION_LABEL : ACTION_LABEL)[action] ?? "";
  const timeAgo = dispatchedAgo(timestampMs);
  const timeTitle = timestampMs && Number.isFinite(timestampMs) ? new Date(timestampMs).toLocaleString() : undefined;

  const surface: React.CSSProperties = {
    display: "flex",
    flexDirection: hero ? "column" : "row",
    alignItems: hero ? "stretch" : layout === "row" ? "center" : "flex-start",
    gap: hero ? 12 : 12,
    width: "100%", textAlign: "left", textDecoration: "none", cursor: action === "none" ? "default" : "pointer",
    borderRadius: hero ? 16 : 14, padding: hero ? "16px 16px 14px" : layout === "row" ? "10px 12px" : "13px 14px",
    border: `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
    background: hero
      ? "linear-gradient(180deg, color-mix(in srgb, var(--cyan) 6%, var(--bg-2)), var(--bg-1))"
      : "linear-gradient(180deg, var(--bg-2), var(--bg-1))",
    boxShadow: hover
      ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 10px 26px rgba(0,0,0,0.32)"
      : "inset 0 1px 0 rgba(255,255,255,0.05)",
    transform: hover && action !== "none" ? "translateY(-2px)" : "none",
    transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
    font: "inherit", color: "inherit",
  };

  const chromeText = isLink ? urlChrome(url!) : deliverable.path ? (deliverable.path.split(/[\\/]/).pop() ?? "") : "";

  const body = hero ? (
    <>
      <span style={{ display: "flex", alignItems: "flex-start", gap: 13, minWidth: 0 }}>
        <FileTypeIcon icon={icon} size={52} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere", lineHeight: 1.25 }}>{title}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="mono-cap" style={{ color: "var(--cyan-2)" }}>{kindLabel}</span>
            {machineName ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", opacity: 0.7 }}>· {machineName}</span> : null}
            {timeAgo ? <span title={timeTitle} style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", opacity: 0.7 }}>· {timeAgo}</span> : null}
          </span>
        </span>
      </span>
      {chromeText ? <HeroChrome isLink={isLink} text={chromeText} /> : null}
      {actionText ? (
        <span style={{ display: "flex", justifyContent: "flex-end" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 11.5, fontWeight: 600, color: hover ? "var(--cyan-2)" : "var(--cyan)", borderRadius: 8, padding: "5px 11px", border: "1px solid color-mix(in srgb, var(--cyan) 32%, var(--line))", background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>{opening ? <><Spinner size={12} /> Opening…</> : actionText}</span>
        </span>
      ) : null}
    </>
  ) : (
    <>
      <FileTypeIcon icon={icon} size={layout === "row" ? 34 : 40} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: layout === "row" ? 13 : 14, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere", lineHeight: 1.25 }}>{title}</span>
        <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="mono-cap" style={{ color: "var(--fg-4)" }}>{kindLabel}</span>
          {machineName ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", opacity: 0.7 }}>· {machineName}</span> : null}
          {timeAgo ? <span title={timeTitle} style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", opacity: 0.7 }}>· {timeAgo}</span> : null}
        </span>
      </span>
      {actionText ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 11, color: hover ? "var(--cyan-2)" : "var(--cyan)", flexShrink: 0, alignSelf: layout === "row" ? "center" : "flex-start", marginTop: layout === "row" ? 0 : 2 }}>{opening ? <><Spinner size={11} /> Opening…</> : actionText}</span>
      ) : null}
    </>
  );

  const hoverProps = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };

  const cardEl = isLink ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={surface}
      {...hoverProps}
      onClick={(event) => { if (url && isExternalHttpUrl(url)) { event.preventDefault(); void openLink(url); } }}
    >{body}</a>
  ) : action === "none" ? (
    <div style={{ ...surface, opacity: 0.75 }} title={item.internalReason ? `${deliverable.path || deliverableHref(deliverable) || ""} — ${item.internalReason}` : undefined}>{body}</div>
  ) : (
    // Real file → open the authenticated in-app viewer.
    <>
      <button type="button" onClick={() => setViewing(true)} style={surface} {...hoverProps}>{body}</button>
      {viewing && <FileViewerModal deliverable={deliverable} displayTitle={title} displayKind={kindLabel} machineName={machineName} theme={theme} onClose={() => setViewing(false)} />}
    </>
  );

  // Once rejected (just now or on a prior cycle), the deliverable is no longer a
  // live output — show a struck-through tombstone; the redirect lives on as a
  // standing directive in company knowledge.
  if (rejected || initiallyRejected) {
    return (
      <>
        <div title="Rejected — the crew was redirected via a standing directive" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, border: "1px dashed var(--line-2)", background: "var(--bg-2)", opacity: 0.62 }}>
          <span aria-hidden style={{ fontSize: 15 }}>🚫</span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-display)", fontSize: 13, color: "var(--fg-3)", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger-2)" }}>rejected · crew redirected{timeAgo ? ` · ${timeAgo}` : ""}</span>
        </div>
        {toast && <Snackbar message="Rejected deliverable" sub="Feedback directed to company" theme={theme} onClose={() => setToast(false)} />}
      </>
    );
  }

  if (!companyId) return cardEl;
  // A human can reject a deliverable to redirect the crew — the feedback becomes
  // a standing directive in company knowledge (RejectDeliverableModal).
  return (
    <div style={{ position: "relative" }}>
      {cardEl}
      <button
        type="button"
        onClick={() => setRejecting(true)}
        title="Reject & redirect the crew"
        aria-label="Reject deliverable"
        style={{ position: "absolute", top: 8, right: 8, zIndex: 2, cursor: "pointer", border: "1px solid var(--line-2)", background: "color-mix(in srgb, var(--danger) 14%, var(--bg-2))", color: "var(--danger-2)", borderRadius: 8, padding: "3px 9px", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 600, letterSpacing: 0.04 }}
      >
        reject
      </button>
      {rejecting && <RejectDeliverableModal companyId={companyId} deliverableRef={title} theme={theme} onClose={() => setRejecting(false)} onDone={() => { setRejected(true); setToast(true); }} />}
    </div>
  );
}
