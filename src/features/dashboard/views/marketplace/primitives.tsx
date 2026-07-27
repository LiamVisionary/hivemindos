// Marketplace — shared presentational primitives (mirrors the ZHC set; CSS in
// this folder's theme.css under .mkt-root).
import React from "react";

import type { MarketplaceListingState } from "@/lib/services/marketplace/marketplace-types";

// ── Loading primitives ────────────────────────────────────────────────────
// House rule: NEVER render a bare "Loading…" string for a pending state.

/** Inline animated spinner — inherits currentColor. */
export function Spinner({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return <span className="mkt-spinner" aria-hidden style={{ width: size, height: size, ...style }} />;
}

/** A single shimmering skeleton block. */
export function Skeleton({
  width = "100%", height = 12, radius = 6, style,
}: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="mkt-skel" aria-hidden style={{ width, height, borderRadius: radius, ...style }} />;
}

/** N shimmering text lines (last line shortened). */
export function SkeletonText({ lines = 3, gap = 9 }: { lines?: number; gap?: number }) {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={11} width={i === lines - 1 ? "54%" : `${88 - (i % 3) * 11}%`} />
      ))}
    </div>
  );
}

/** Indeterminate loading bar. */
export function LoadingBar({ style }: { style?: React.CSSProperties }) {
  return <div className="mkt-progress" role="progressbar" aria-label="Loading" style={style} />;
}

// ── Chrome ────────────────────────────────────────────────────────────────

/** Generic panel surface. */
export function Panel({
  children, style, pad = "20px 22px",
}: { children: React.ReactNode; style?: React.CSSProperties; pad?: number | string }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--line)", background: "var(--panel)", padding: pad, boxShadow: "var(--shadow)", ...style }}>
      {children}
    </div>
  );
}

/** Section label (mono cap with a hairline rule). */
export function SectionLabel({
  children, color = "var(--fg-3)", right,
}: { children: React.ReactNode; color?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span className="mcap" style={{ color }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      {right}
    </div>
  );
}

// ── Listing status ────────────────────────────────────────────────────────

type ListingDisplayState = MarketplaceListingState | "pending-messages";

const LISTING_STATE_TONE: Record<ListingDisplayState, { label: string; color: string; live?: boolean }> = {
  draft: { label: "Draft", color: "var(--fg-3)" },
  "pending-approval": { label: "Needs approval", color: "var(--honey)", live: true },
  approved: { label: "Approved", color: "var(--honey)" },
  posting: { label: "Posting", color: "var(--honey)", live: true },
  "posted-unverified": { label: "Verifying post", color: "var(--honey)", live: true },
  active: { label: "Listed", color: "var(--live)" },
  "pending-messages": { label: "Messages", color: "var(--honey)", live: true },
  ended: { label: "Ended", color: "var(--fg-4)" },
  rejected: { label: "Rejected", color: "var(--danger)" },
  failed: { label: "Failed", color: "var(--danger)" },
};

export function ListingStatusPill({ state, unread = 0 }: { state: MarketplaceListingState; unread?: number }) {
  const display: ListingDisplayState = unread > 0 && state === "active" ? "pending-messages" : state;
  const tone = LISTING_STATE_TONE[display];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "3px 9px 3px 8px", borderRadius: 999,
      border: `1px solid color-mix(in srgb, ${tone.color} 32%, transparent)`,
      background: `color-mix(in srgb, ${tone.color} 13%, transparent)`,
      color: tone.color, fontFamily: "var(--f-mono)",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.06, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      <span className={"mkt-dot" + (tone.live ? " live" : "")} />
      {display === "pending-messages" && unread > 0 ? `${unread} new` : tone.label}
    </span>
  );
}

/** Primary (honey) button style. */
export function primaryButtonStyle(disabled = false): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "9px 16px", borderRadius: 10,
    background: disabled ? "color-mix(in srgb, var(--btn-bg) 45%, transparent)" : "var(--btn-bg)",
    color: "var(--btn-fg)", border: "1px solid var(--btn-line)",
    fontSize: 13, fontWeight: 500, fontFamily: "var(--f-body)", cursor: disabled ? "default" : "pointer",
  };
}

/** Quiet (outline) button style. */
export function ghostButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "8px 14px", borderRadius: 10,
    background: "transparent", color: "var(--fg-2)",
    border: "1px solid var(--line-2)",
    fontSize: 12.5, fontWeight: 500, fontFamily: "var(--f-body)", cursor: "pointer",
  };
}
