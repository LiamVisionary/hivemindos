"use client";

import * as React from "react";
import styles from "./queen-voice.module.css";

// Apple Intelligence palette from jacobamobin/AppleIntelligenceGlowEffect.
const GLOW_COLORS = [
  "#BC82F3",
  "#F5B9EA",
  "#8D9FFF",
  "#FF6778",
  "#FFBA71",
  "#C686FF",
];

// Ring stack from the original effect: width (px) / blur (px).
const GLOW_LAYERS = [
  { width: 6, blur: 0 },
  { width: 9, blur: 4 },
  { width: 11, blur: 12 },
  { width: 15, blur: 15 },
];

const RETARGET_INTERVAL_MS = 700;
const SMOOTHING_PER_FRAME = 0.055;
const ROTATION_DEGREES_PER_SECOND = 6;

function randomSortedStops() {
  return Array.from({ length: GLOW_COLORS.length }, () => Math.random()).sort(
    (a, b) => a - b,
  );
}

function gradientString(stops: number[], rotationDeg: number) {
  const entries = stops.map(
    (stop, index) => `${GLOW_COLORS[index]} ${(stop * 100).toFixed(2)}%`,
  );
  // Close the ring with the first color so the conic seam never shows.
  entries.push(`${GLOW_COLORS[0]} 100%`);
  return `conic-gradient(from ${rotationDeg.toFixed(2)}deg, ${entries.join(", ")})`;
}

/**
 * Screen-perimeter glow: four stacked conic-gradient rings whose color stop
 * positions drift toward freshly randomized targets, like the SwiftUI
 * original's 0.5s re-randomize + 1s ease animation, plus a slow rotation.
 */
export function QueenVoiceGlow({ active }: { active: boolean }) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!active) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;

    let frame = 0;
    let lastFrameAt = performance.now();
    let rotation = -90;
    const current = randomSortedStops();
    let target = randomSortedStops();
    const retarget = window.setInterval(() => {
      target = randomSortedStops();
    }, RETARGET_INTERVAL_MS);

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      rotation += ROTATION_DEGREES_PER_SECOND * deltaSeconds;
      for (let index = 0; index < current.length; index += 1) {
        current[index] +=
          (target[index] - current[index]) * SMOOTHING_PER_FRAME;
      }
      root.style.setProperty(
        "--queen-glow-gradient",
        gradientString(current, rotation),
      );
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.clearInterval(retarget);
      window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return (
    <div
      ref={rootRef}
      className={`${styles.glowRoot} ${active ? styles.glowRootActive : ""}`}
      aria-hidden="true"
    >
      {GLOW_LAYERS.map((layer) => (
        <div
          key={`${layer.width}-${layer.blur}`}
          className={styles.glowLayer}
          style={
            {
              "--ring-width": `${layer.width}px`,
              "--ring-blur": `${layer.blur}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
