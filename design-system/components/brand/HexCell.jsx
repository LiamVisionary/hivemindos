import * as React from "react";

/* HexCell — the signature honeycomb cell shape. A pointy-top hexagon tile that
   holds an icon/glyph/agent portrait, with tone-driven border + optional pulse.
   This is the brand's core spatial motif (machines, agents, the Queen).
   Intentional addition: distills the fleet-hive HiveStage cell into a reusable
   primitive (see readme "Intentional additions"). */

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

const TONES = {
  honey: { border: "var(--honey)", glow: "var(--honey-soft)" },
  live: { border: "var(--live)", glow: "var(--live-soft)" },
  neutral: { border: "var(--line-3, rgba(148,163,184,0.28))", glow: "transparent" },
  danger: { border: "var(--danger)", glow: "var(--danger-soft)" },
};

export function HexCell({ size = 96, tone = "neutral", selected = false, pulse = false, children, style, ...props }) {
  const t = TONES[tone] || TONES.neutral;
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        width: size,
        height: size * 1.1547, // pointy-top hex ratio H = W * 2/√3
        display: "grid",
        placeItems: "center",
        transformOrigin: "50% 50%",
        transform: hover ? "translateY(-6px) scale(1.05)" : selected ? "scale(1.06)" : "scale(1)",
        transition: "transform 0.5s var(--ease-lift, cubic-bezier(0.22,0.61,0.18,1)), filter 0.5s ease",
        filter: hover ? "drop-shadow(0 12px 18px rgba(0,0,0,0.42))" : "none",
        ...style,
      }}
      {...props}
    >
      {/* border layer */}
      <div style={{ position: "absolute", inset: 0, clipPath: HEX_CLIP, background: t.border, opacity: selected || hover ? 0.9 : 0.55 }} />
      {/* fill layer */}
      <div style={{ position: "absolute", inset: 2, clipPath: HEX_CLIP, background: "var(--panel)", display: "grid", placeItems: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle, ${t.glow}, transparent 70%)`, animation: pulse ? "hm-hex-breathe 4s ease-in-out infinite" : "none" }} />
      </div>
      <div style={{ position: "relative", display: "grid", placeItems: "center", width: "62%", height: "62%" }}>{children}</div>
      <style>{"@keyframes hm-hex-breathe{0%,100%{opacity:0.5}50%{opacity:1}}"}</style>
    </div>
  );
}
