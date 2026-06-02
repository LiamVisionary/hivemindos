// src/components/fleet/hex-tile.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import styles from "./fleet-tokens.module.css";

export type HexTone = "default" | "active" | "honey" | "danger" | "ghost";

const TONE_VARS: Record<HexTone, { bg: string; border: string; glow: string }> = {
  default: { bg: "var(--hex-default-bg)", border: "var(--hex-default-border)", glow: "var(--hex-default-glow)" },
  active:  { bg: "var(--hex-active-bg)",  border: "var(--hex-active-border)",  glow: "var(--hex-active-glow)"  },
  honey:   { bg: "var(--hex-honey-bg)",   border: "var(--hex-honey-border)",   glow: "var(--hex-honey-glow)"   },
  danger:  { bg: "var(--hex-danger-bg)",  border: "var(--hex-danger-border)",  glow: "var(--hex-danger-glow)"  },
  ghost:   { bg: "var(--hex-ghost-bg)",   border: "var(--hex-ghost-border)",   glow: "var(--hex-ghost-glow)"   },
};

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

interface HexTileProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  tone?: HexTone;
  surface?: "frosted" | "flat";
  children?: React.ReactNode;
}

/**
 * Frosted-glass hexagonal tile. The fill uses CSS clip-path so backdrop blur
 * follows the shape. The border is rendered as a single SVG polygon stroke
 * centered on the hex edge — so adjacent cells in a cluster blend into one
 * shared edge instead of two parallel 1px lines.
 */
export const HexTile = React.forwardRef<HTMLDivElement, HexTileProps>(function HexTile(
  { size = 80, tone = "default", surface = "frosted", children, className, onClick, style, ...rest },
  ref,
) {
  const t = TONE_VARS[tone] ?? TONE_VARS.default;
  const W = size;
  const H = (size * 2) / Math.sqrt(3);
  const pts = `${W / 2},0 ${W},${H / 4} ${W},${(3 * H) / 4} ${W / 2},${H} 0,${(3 * H) / 4} 0,${H / 4}`;

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn("relative", onClick && styles.hexInteractive, className)}
      style={{
        width: W,
        height: H,
        transition: "transform 180ms ease, filter 180ms ease",
        filter: t.glow !== "transparent" ? `drop-shadow(0 0 14px ${t.glow})` : undefined,
        ...style,
      }}
      {...rest}
    >
      {/* Clipped fill — gradient + frosted glass */}
      <div
        className={`${styles.hexFill} absolute inset-0`}
        style={{
          clipPath: HEX_CLIP,
          background: t.bg,
          ...(surface === "frosted"
            ? {
                backdropFilter: "blur(10px) saturate(140%)",
                WebkitBackdropFilter: "blur(10px) saturate(140%)",
              }
            : undefined),
        }}
      />
      {/* Border overlay — single shared SVG stroke */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ overflow: "visible" }}
      >
        <polygon
          className={styles.hexStroke}
          points={pts}
          fill="none"
          stroke={t.border}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ transition: "stroke 160ms ease, stroke-width 160ms ease" }}
        />
      </svg>
      {/* Content */}
      <div className={styles.hexContent}>{children}</div>
    </div>
  );
});
