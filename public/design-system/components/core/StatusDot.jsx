import * as React from "react";

/* StatusDot — the fr-dot signal from fleet-hive.css. A tiny colored dot that
   optionally pulses to communicate live activity. State drives the color. */

const TONES = {
  live: "var(--live)",
  working: "var(--live)",
  ready: "var(--muted)",
  healthy: "var(--success)",
  scheduled: "var(--honey)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  offline: "var(--fg-4)",
};

export function StatusDot({ tone = "live", pulse, label, style, ...props }) {
  const color = TONES[tone] || TONES.live;
  const doPulse = pulse ?? (tone === "live" || tone === "working");
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "9999px",
        background: color,
        color,
        flex: "0 0 auto",
        boxShadow: doPulse ? "0 0 0 0 currentColor" : "none",
        animation: doPulse ? "hm-pulse 2.4s ease-in-out infinite" : "none",
      }}
    />
  );
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--fg-2)", fontSize: 12, fontFamily: "var(--font-body)", ...style }}
      {...props}
    >
      {dot}
      {label ? <span>{label}</span> : null}
      <style>{"@keyframes hm-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 50%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,currentColor 0%,transparent)}}"}</style>
    </span>
  );
}
