"use client";

import * as React from "react";

import type { ChatTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import { openExternalUrl } from "@/lib/native/open-external-url";

function InlineSpinner({ size = 14 }: { size?: number }) {
  // SMIL rotate keeps spinning under WKWebView's rAF starvation (unlike a
  // JS/Lottie loop) and needs no global CSS class, so it animates anywhere.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none" }}>
      <circle cx="12" cy="12" r="9" stroke="var(--line-2)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--honey)" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function kindLabel(kind?: ChatTranscriptCard["kind"]): string {
  if (kind === "video") return "Video";
  if (kind === "thread") return "Thread";
  if (kind === "single") return "Post";
  return "Transcript";
}

function durationLabel(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const CARD_STYLE: React.CSSProperties = {
  display: "grid",
  gap: 10,
  border: "1px solid var(--line-2)",
  borderRadius: 12,
  background: "var(--panel-2, rgba(255,255,255,0.02))",
  padding: 13,
};

const LABEL_STYLE: React.CSSProperties = {
  color: "var(--fg-4)",
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export function TranscriptCard({ card }: { card: ChatTranscriptCard }) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const duration = durationLabel(card.durationSec);
  const target = card.canonicalUrl || card.url;

  async function copyTranscript() {
    if (!card.transcript) return;
    try {
      await navigator.clipboard.writeText(card.transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 11 }}>
        <span style={{ border: "1px solid var(--honey-line)", color: "var(--honey)", borderRadius: 999, padding: "2px 9px" }}>{kindLabel(card.kind)}</span>
        {card.author?.handle ? (
          <button type="button" onClick={() => target && openExternalUrl(target)} style={{ background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", padding: 0, fontFamily: "var(--f-mono)", fontSize: 11 }}>
            @{card.author.handle}
          </button>
        ) : null}
        {duration ? <span style={{ color: "var(--fg-4)" }}>{duration}</span> : null}
        {typeof card.postCount === "number" && card.postCount > 1 ? <span style={{ color: "var(--fg-4)" }}>{card.postCount} posts</span> : null}
        {card.source && card.status === "ready" ? <span style={{ color: "var(--fg-4)", marginLeft: "auto" }}>{card.source}</span> : null}
      </div>

      {card.status === "running" ? (
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--fg-2)", fontSize: 13 }}>
          <InlineSpinner />
          <span>Pulling the transcript{card.title ? ` — ${card.title}` : ""}… long videos transcribe in chunks.</span>
        </div>
      ) : null}

      {card.status === "error" ? (
        <div role="alert" style={{ color: "var(--fg)", fontSize: 13, lineHeight: 1.6 }}>
          {card.error || "Could not pull the transcript."}
        </div>
      ) : null}

      {card.status === "ready" && card.transcript ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={LABEL_STYLE}>Transcript</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={copyTranscript} style={miniButton}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" onClick={() => setExpanded((value) => !value)} style={miniButton}>{expanded ? "Collapse" : "Show full"}</button>
            </span>
          </div>
          <div
            style={{
              maxHeight: expanded ? 460 : 132,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              color: "var(--fg)",
              fontSize: 13.5,
              lineHeight: 1.7,
              background: "var(--panel, rgba(0,0,0,0.14))",
              borderRadius: 10,
              padding: 12,
              transition: "max-height 0.16s ease",
            }}
          >
            {card.transcript}
          </div>
        </div>
      ) : null}

      {card.warnings?.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.55 }}>
          {card.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

const miniButton: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  color: "var(--fg-2)",
  cursor: "pointer",
  padding: "2px 9px",
  fontSize: 11,
};

export default TranscriptCard;
