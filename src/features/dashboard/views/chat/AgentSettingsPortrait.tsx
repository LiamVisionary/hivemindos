"use client";

import type { CSSProperties } from "react";
import { Bot } from "lucide-react";

type PortraitTone = "idle" | "duty";

const HEX_CLIP = "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)";

const TONE: Record<PortraitTone, { core: string; glow: string; line: string; wash: string }> = {
  idle: {
    core: "var(--aeon)",
    glow: "rgba(45,212,191,0.36)",
    line: "rgba(94,234,212,0.42)",
    wash: "rgba(45,212,191,0.18)",
  },
  duty: {
    core: "var(--honey-2)",
    glow: "rgba(255,212,90,0.34)",
    line: "rgba(255,212,90,0.46)",
    wash: "rgba(255,212,90,0.16)",
  },
};

export function AgentSettingsPortrait({
  iconSrc,
  tone = "idle",
  size = 124,
  style,
}: {
  iconSrc?: string;
  tone?: PortraitTone;
  size?: number;
  style?: CSSProperties;
}) {
  const colors = TONE[tone];
  const iconSize = size * 0.6;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 48%, ${colors.glow}, transparent 64%)`,
          filter: "blur(8px)",
          opacity: 0.82,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: size * 0.08,
          clipPath: HEX_CLIP,
          background: `linear-gradient(145deg, rgba(255,255,255,0.20), ${colors.line} 46%, rgba(2,6,23,0.18))`,
          filter: `drop-shadow(0 0 ${size * 0.14}px ${colors.glow})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 1.5,
            clipPath: HEX_CLIP,
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
            background: `radial-gradient(circle at 50% 20%, rgba(255,255,255,0.22), transparent 25%), linear-gradient(155deg, ${colors.wash}, rgba(8,12,20,0.82) 76%)`,
            boxShadow: `inset 0 ${size * 0.11}px ${size * 0.2}px rgba(255,255,255,0.08), inset 0 -${size * 0.15}px ${size * 0.24}px rgba(0,0,0,0.42)`,
          }}
        >
          {iconSrc ? (
            <span
              style={{
                width: iconSize,
                height: iconSize,
                color: colors.core,
                backgroundImage: `url(${iconSrc})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
                filter: `drop-shadow(0 ${size * 0.03}px ${size * 0.06}px rgba(0,0,0,0.42)) drop-shadow(0 0 ${size * 0.04}px ${colors.glow})`,
              }}
            />
          ) : (
            <Bot
              size={iconSize * 0.76}
              strokeWidth={1.45}
              style={{
                color: colors.core,
                filter: `drop-shadow(0 0 ${size * 0.04}px ${colors.glow})`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
