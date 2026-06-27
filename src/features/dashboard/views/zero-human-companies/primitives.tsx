// Zero Human Companies — shared presentational primitives.
import React from "react";
import { STATUS_TONE, PRI, ROLE_GLYPH } from "./data";
import type { CompanyStatus, Priority } from "./types";

/** Circular alignment / progress ring. */
export function Ring({
  pct = 0, size = 54, stroke = 5, color = "var(--cyan)", track = "var(--line-2)", children,
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

/** Status pill — colored dot + label using STATUS_TONE. */
export function StatusPill({ status, mono = true }: { status: CompanyStatus; mono?: boolean }) {
  const t = STATUS_TONE[status] || STATUS_TONE.setup;
  const live = status === "shipping" || status === "drift";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "3px 9px 3px 8px", borderRadius: 999,
      border: `1px solid color-mix(in srgb, ${t.color} 34%, transparent)`,
      background: `color-mix(in srgb, ${t.color} 12%, transparent)`,
      color: t.color, fontFamily: mono ? "var(--f-mono)" : "var(--f-body)",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.08, textTransform: "uppercase",
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
  const color = pct >= 85 ? "var(--danger)" : pct >= 65 ? "var(--honey)" : "var(--cyan)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span className="mono-cap" style={{ color: "var(--fg-4)" }}>USDC / day</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color }}>${today}</span>
          <span style={{ color: "var(--fg-4)" }}> / {cap > 0 ? `$${cap}` : "∞"}</span>
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, transition: "width 500ms ease" }} />
      </div>
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>
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
  working: "var(--cyan)", reviewing: "var(--honey)", scheduled: "var(--fg-3)",
  ready: "var(--fg-3)", idle: "var(--fg-4)", blocked: "var(--danger)", setup: "var(--warn)",
};

/** Hexagon role glyph (SVG polygon so the outline follows the shape cleanly). */
export function RoleGlyph({ role, size = 30 }: { role: string; size?: number; active?: boolean }) {
  const isQueen = role === "Queen";
  const color = isQueen ? "var(--honey-2)" : "var(--fg-2)";
  const stroke = isQueen ? "color-mix(in srgb, var(--honey) 60%, transparent)" : "var(--line-2)";
  const fill = isQueen ? "color-mix(in srgb, var(--honey) 14%, var(--bg-3))" : "var(--bg-3)";
  const W = size, H = size;
  const pts = `${W / 2},1 ${W - 1},${H / 4} ${W - 1},${(3 * H) / 4} ${W / 2},${H - 1} 1,${(3 * H) / 4} 1,${H / 4}`;
  return (
    <span style={{ position: "relative", width: W, height: H, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: "relative", color, fontSize: size * 0.44, lineHeight: 1 }}>{ROLE_GLYPH[role] || "•"}</span>
    </span>
  );
}

/** Section label (mono cap with a hairline rule). */
export function SectionLabel({
  children, color = "var(--fg-3)", right,
}: { children: React.ReactNode; color?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <span className="mono-cap" style={{ color }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      {right}
    </div>
  );
}

/** Generic panel surface. */
export function Panel({
  children, style, pad = 20,
}: { children: React.ReactNode; style?: React.CSSProperties; pad?: number }) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid var(--line)", background: "var(--bg-1)", padding: pad, ...style }}>
      {children}
    </div>
  );
}

/** Tiny muted mono caption. */
export function CardLabel({ children }: { children: React.ReactNode }) {
  return <span className="mono-cap" style={{ color: "var(--fg-4)" }}>{children}</span>;
}
