"use client";

import * as React from "react";
import styles from "./queen-voice.module.css";

type GlowFrame = {
  height: number;
  inset: number;
  path: string;
  radius: number;
  width: number;
};

function roundedRectPath(width: number, height: number, inset: number, radius: number) {
  const x = inset;
  const y = inset;
  const w = Math.max(0, width - inset * 2);
  const h = Math.max(0, height - inset * 2);
  const r = Math.min(radius, w / 2, h / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function glowFrameFromViewport(width: number, height: number): GlowFrame {
  const vmin = Math.min(width, height) / 100;
  const inset = Math.min(14, Math.max(8, vmin * 0.72));
  const radius = Math.min(48, Math.max(32, vmin * 2.9));
  return {
    height,
    inset,
    path: roundedRectPath(width, height, inset, radius),
    radius,
    width,
  };
}

function useGlowFrame(active: boolean) {
  const [frame, setFrame] = React.useState<GlowFrame | null>(null);

  React.useEffect(() => {
    if (!active) return undefined;
    const updateFrame = () => {
      setFrame(glowFrameFromViewport(window.innerWidth, window.innerHeight));
    };
    updateFrame();
    window.addEventListener("resize", updateFrame);
    return () => window.removeEventListener("resize", updateFrame);
  }, [active]);

  return frame;
}

/**
 * Screen-perimeter glow. The rounded rectangle is drawn from measured viewport
 * geometry so it follows the app chrome, while CSS breathes the blurred
 * full-path strokes for soft Apple-style bloom.
 */
export function QueenVoiceGlow({ active }: { active: boolean }) {
  const frame = useGlowFrame(active);

  return (
    <div
      data-queen-glow-root=""
      className={`${styles.glowRoot} ${active ? styles.glowRootActive : ""}`}
      aria-hidden="true"
    >
      {frame ? (
        <svg
          className={styles.glowSvg}
          data-queen-glow-frame=""
          data-queen-glow-inset={frame.inset.toFixed(2)}
          data-queen-glow-radius={frame.radius.toFixed(2)}
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          width={frame.width}
          height={frame.height}
          style={
            {
              "--queen-glow-inset-px": `${frame.inset}px`,
              "--queen-glow-radius-px": `${frame.radius}px`,
            } as React.CSSProperties
          }
        >
          <defs>
            <linearGradient
              id="queen-voice-glow-gradient"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={frame.width}
              y2={frame.height}
            >
              <stop offset="0%" stopColor="#ffba71" />
              <stop offset="18%" stopColor="#ff6778" />
              <stop offset="42%" stopColor="#bc82f3" />
              <stop offset="64%" stopColor="#8d9fff" />
              <stop offset="82%" stopColor="#f5b9ea" />
              <stop offset="100%" stopColor="#ff6778" />
            </linearGradient>
          </defs>
          <g className={styles.glowBreath}>
            <path
              className={styles.glowTraceOuter}
              data-queen-glow-layer=""
              d={frame.path}
              stroke="url(#queen-voice-glow-gradient)"
            />
            <path
              className={styles.glowTraceBloom}
              data-queen-glow-layer=""
              d={frame.path}
              stroke="url(#queen-voice-glow-gradient)"
            />
            <path
              className={styles.glowTraceCore}
              data-queen-glow-layer=""
              d={frame.path}
              stroke="url(#queen-voice-glow-gradient)"
            />
          </g>
        </svg>
      ) : null}
    </div>
  );
}
