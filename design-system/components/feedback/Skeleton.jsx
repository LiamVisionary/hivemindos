import * as React from "react";

/* Skeleton — shimmer placeholder shown on first load and view switches.
   Ported from trade/skeletons.tsx (.sk): panel-2 block with a sweeping
   highlight. Respects prefers-reduced-motion. Compose several to mimic the
   real layout while data loads. */

export function Skeleton({ w = "100%", h = 12, r = 6, style, ...props }) {
  return (
    <span
      style={{
        position: "relative",
        overflow: "hidden",
        display: "block",
        flex: "0 0 auto",
        width: w,
        height: h,
        borderRadius: r,
        background: "var(--panel-2, #181b22)",
        ...style,
      }}
      {...props}
    >
      <span
        style={{
          content: '""',
          position: "absolute",
          inset: 0,
          transform: "translateX(-100%)",
          background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--fg) 7%, transparent), transparent)",
          animation: "hm-sk-shimmer 1.25s infinite",
        }}
      />
      <style>{"@keyframes hm-sk-shimmer{100%{transform:translateX(100%)}}@media (prefers-reduced-motion:reduce){[data-slot='skeleton'] span{animation:none}}"}</style>
    </span>
  );
}
