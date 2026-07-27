import * as React from "react";

/* ProgressBar — loading bars & metric meters. Determinate (value 0–100),
   indeterminate (sweeping), or a thin 3px "meter" (the fr-meter used for
   CPU/RAM/survival). Rounded track, tone-driven fill. */

const TONES = {
  honey: "var(--honey)",
  live: "var(--live)",
  danger: "var(--danger)",
  neutral: "var(--fg-3)",
};

export function ProgressBar({ value = 0, indeterminate = false, tone = "honey", thickness = 8, label, style, ...props }) {
  const fill = TONES[tone] || TONES.honey;
  const pct = Math.max(0, Math.min(100, value));
  const isMeter = thickness <= 4;

  return (
    <div style={{ display: "grid", gap: label ? 6 : 0, ...style }} {...props}>
      {label ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>
          <span>{label}</span>
          {!indeterminate ? <span style={{ color: "var(--fg-2)" }}>{pct}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          position: "relative",
          height: thickness,
          borderRadius: 9999,
          background: "var(--line-2)",
          overflow: "hidden",
        }}
      >
        {indeterminate ? (
          <span style={{ position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 9999, background: fill, animation: "hm-prog-sweep 1.3s var(--ease-out) infinite" }} />
        ) : (
          <span style={{ display: "block", height: "100%", width: `${pct}%`, borderRadius: 9999, background: fill, transition: "width 0.5s cubic-bezier(.2,.7,.3,1)" }} />
        )}
        <style>{"@keyframes hm-prog-sweep{0%{left:-40%}100%{left:100%}}"}</style>
      </div>
    </div>
  );
}
