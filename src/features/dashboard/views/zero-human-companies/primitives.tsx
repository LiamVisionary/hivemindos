// Zero Human Companies — shared presentational primitives.
// Reskinned to the "Zero Human Companies" Claude Design handoff (honey / clay).
import React from "react";
import { STATUS_TONE, PRI, ROLE_GLYPH } from "./data";
import type { CompanyStatus, Priority } from "./types";

/** Alignment ring color by score (fresh companies read as neutral, not "drift"). */
export function alignColor(align: number, fresh = false): string {
  if (fresh) return "var(--fg-3)";
  return align >= 75 ? "var(--live)" : align >= 55 ? "var(--honey)" : "var(--danger)";
}

/** Circular alignment / progress ring. */
export function Ring({
  pct = 0, size = 54, stroke = 5, color = "var(--live)", track = "var(--line-2)", children,
}: {
  pct?: number; size?: number; stroke?: number; color?: string; track?: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ - (Math.max(0, Math.min(100, pct)) / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.2,.7,.3,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{children}</div>
    </div>
  );
}

/** Status pill — colored dot + label using STATUS_TONE. Live pulse on shipping / board-review. */
export function StatusPill({ status, mono = true }: { status: CompanyStatus; mono?: boolean }) {
  const t = STATUS_TONE[status] || STATUS_TONE.setup;
  const live = status === "shipping" || status === "review";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "3px 9px 3px 8px", borderRadius: 999,
      border: `1px solid color-mix(in srgb, ${t.dot} 32%, transparent)`,
      background: `color-mix(in srgb, ${t.dot} 13%, transparent)`,
      color: t.color, fontFamily: mono ? "var(--f-mono)" : "var(--f-body)",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.06, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      <span className={"dot" + (live ? " live" : "")} style={{ color: t.dot }} />
      {t.label}
    </span>
  );
}

/** USDC-burn budget bar: today vs daily cap. */
export function BurnBar({
  today, cap, week, runway, compact = false,
}: { today: number; cap: number; week: number; runway: number; compact?: boolean }) {
  const pct = cap > 0 ? Math.min(100, Math.round((today / cap) * 100)) : 0;
  const color = pct >= 85 ? "var(--danger)" : pct >= 65 ? "var(--honey)" : "var(--fg-2)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span className="mcap" style={{ color: "var(--fg-4)" }}>USDC / day</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color }}>${today}</span>
          <span style={{ color: "var(--fg-4)" }}> / {cap > 0 ? `$${cap}` : "∞"}</span>
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--line-2)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, transition: "width 500ms ease" }} />
      </div>
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>
          <span>${week} this week</span>
          <span>runway ~{runway}d</span>
        </div>
      )}
    </div>
  );
}

/** Priority tag (P0–P3). */
export function PriTag({ pri }: { pri: Priority }) {
  const p = PRI[pri] || PRI.low;
  return (
    <span style={{
      fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.06,
      color: p.color, border: `1px solid color-mix(in srgb, ${p.color} 40%, transparent)`,
      borderRadius: 4, padding: "1px 4px", lineHeight: 1.3,
    }}>{p.label}</span>
  );
}

/** Agent state → dot color. */
export const STATE_COLOR: Record<string, string> = {
  working: "var(--live)", reviewing: "var(--honey)", scheduled: "var(--fg-3)",
  ready: "var(--fg-3)", idle: "var(--fg-4)", blocked: "var(--danger)", setup: "var(--honey)",
};

/** Hexagon badge holding an arbitrary glyph (role glyph, deliverable type, …). */
export function HexBadge({
  glyph, size = 28, fill = "var(--panel-hi)", stroke = "var(--line-2)", color = "var(--fg-2)",
}: { glyph: React.ReactNode; size?: number; fill?: string; stroke?: string; color?: string }) {
  const W = size, H = size;
  const pts = `${W / 2},1 ${W - 1},${H / 4} ${W - 1},${(3 * H) / 4} ${W / 2},${H - 1} 1,${(3 * H) / 4} 1,${H / 4}`;
  return (
    <span style={{ position: "relative", width: W, height: H, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: "relative", color, fontSize: size * 0.42, lineHeight: 1 }}>{glyph}</span>
    </span>
  );
}

/** Hexagon role glyph (queen reads as honey / CEO). */
export function RoleGlyph({ role, size = 30 }: { role: string; size?: number; active?: boolean }) {
  const isQueen = role === "Queen";
  return (
    <HexBadge
      size={size}
      glyph={ROLE_GLYPH[role] || "•"}
      color={isQueen ? "var(--honey)" : "var(--fg-2)"}
      stroke={isQueen ? "var(--honey-line)" : "var(--line-2)"}
      fill={isQueen ? "color-mix(in srgb, var(--honey) 14%, var(--panel-2))" : "var(--panel-2)"}
    />
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

/** Generic panel surface — the card chrome used across the cockpit tabs. */
export function Panel({
  children, style, pad = "22px 24px",
}: { children: React.ReactNode; style?: React.CSSProperties; pad?: number | string }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--line)", background: "var(--panel)", padding: pad, boxShadow: "var(--shadow)", ...style }}>
      {children}
    </div>
  );
}

/** Tiny muted mono caption. */
export function CardLabel({ children }: { children: React.ReactNode }) {
  return <span className="mcap" style={{ color: "var(--fg-4)" }}>{children}</span>;
}

// ── Loading primitives ────────────────────────────────────────────────────
// House rule: NEVER render a bare "Loading…" / "…" string for a pending state.
// Every loader in this route is animated — a spinner for inline/button busy
// states, a shape-matched skeleton for regions, or an indeterminate bar. CSS
// lives in theme.css (.zhc-spinner / .zhc-skel / .zhc-progress).

/** Inline animated spinner — the canonical busy indicator. Inherits
 *  currentColor, so it drops into any button or label at the given px size. */
export function Spinner({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return <span className="zhc-spinner" aria-hidden style={{ width: size, height: size, ...style }} />;
}

/** A single shimmering skeleton block. */
export function Skeleton({
  width = "100%", height = 12, radius = 6, style,
}: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="zhc-skel" aria-hidden style={{ width, height, borderRadius: radius, ...style }} />;
}

/** N shimmering text lines (last line shortened) for body/text placeholders. */
export function SkeletonText({ lines = 3, gap = 9 }: { lines?: number; gap?: number }) {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={11} width={i === lines - 1 ? "54%" : `${88 - (i % 3) * 11}%`} />
      ))}
    </div>
  );
}

/** Indeterminate loading bar — for a determinate-looking "work in progress". */
export function LoadingBar({ style }: { style?: React.CSSProperties }) {
  return <div className="zhc-progress" role="progressbar" aria-label="Loading" style={style} />;
}
