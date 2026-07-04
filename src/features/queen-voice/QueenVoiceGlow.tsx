"use client";

import styles from "./queen-voice.module.css";

/**
 * Screen-perimeter glow shown while Queen Bee voice chat is open.
 *
 * A soft purple halo that hugs the viewport edges (an inset box-shadow that
 * gently cycles hue purple -> magenta -> indigo), matching the Page Agent
 * whole-page glow. `active` fades it in via `.glowRoot` / `.glowRootActive`.
 *
 * (Previously an SVG rounded-rect perimeter trace with a warm brand gradient;
 * replaced with the box-shadow glow per design request.)
 */
export function QueenVoiceGlow({ active }: { active: boolean }) {
  return (
    <div
      data-queen-glow-root=""
      className={`${styles.glowRoot} ${active ? styles.glowRootActive : ""}`}
      aria-hidden="true"
    >
      <div data-queen-glow-frame="" className={styles.glowFrame} />
    </div>
  );
}
