import * as React from "react";

/* Spinner — the loading state glyph. A ring that spins (matches the Button
   isLoading spinner and the trade tk-spin pending indicator). */

export function Spinner({ size = 18, thickness = 2.4, tone = "honey", label, style, ...props }) {
  const color = tone === "honey" ? "var(--honey)" : tone === "live" ? "var(--live)" : "currentColor";
  const ring = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "hm-spin 0.7s linear infinite", flex: "0 0 auto" }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth={thickness} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth={thickness} strokeLinecap="round" />
      <style>{"@keyframes hm-spin{to{transform:rotate(360deg)}}"}</style>
    </svg>
  );
  if (!label) return ring;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--fg-2)", fontFamily: "var(--font-body)", fontSize: 13, ...style }} {...props}>
      {ring}
      <span>{label}</span>
    </span>
  );
}
