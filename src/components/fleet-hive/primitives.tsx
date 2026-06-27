"use client";

/* primitives.tsx — small shared building blocks for the Fleet "Hive" view. */

import type { AgentState } from "./fleet-hive-types";
import { frStateMeta } from "./fleet-hive-types";

export function Dot({ state, size = 7 }: { state: AgentState; size?: number }) {
  const meta = frStateMeta(state);
  return (
    <span
      className={"fr-dot" + (meta.live ? " live" : "")}
      style={{ color: meta.color, width: size, height: size }}
    />
  );
}

/** Thin hexagon — the hive, whispered. Optional inner dot. */
export function HiveMark({
  size = 22,
  stroke = "var(--honey)",
  fill = "none",
  dot = true,
  strokeWidth = 1.4,
}: {
  size?: number;
  stroke?: string;
  fill?: string;
  dot?: boolean;
  strokeWidth?: number;
}) {
  const pts = "12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {dot ? <circle cx="12" cy="12" r="2.1" fill={stroke} /> : null}
    </svg>
  );
}

export function Meter({ value, tone }: { value: number; tone?: string }) {
  const color = value >= 85 ? "var(--danger)" : tone || "var(--fg-3)";
  return (
    <span className="fr-meter" style={{ display: "block", width: "100%" }}>
      <i style={{ width: Math.max(3, value) + "%", background: color }} />
    </span>
  );
}

export function Summary({
  n,
  label,
  live,
  tone,
}: {
  n: number;
  label: string;
  live?: boolean;
  tone?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live ? <span className="fr-dot live" style={{ color: "var(--live)", width: 6, height: 6 }} /> : null}
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: 19, color: tone || "var(--fg)", letterSpacing: "-0.01em" }}>{n}</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 5, letterSpacing: "0.02em" }}>{label}</span>
    </div>
  );
}

export function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
