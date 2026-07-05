"use client";

import { BrainCircuit, Crown } from "lucide-react";
import type { BrainReadiness } from "@/features/dashboard/hooks/use-brain-readiness";
import styles from "./brain-readiness-banner.module.css";

/**
 * Subtle fleet-view banner keeping the second brain runnable: it names the
 * brain loops blocked by a missing/unfinished Queen Bee and routes the user
 * into the queen's settings (or the create-agent flow), and once the queen
 * works it offers the explicit one-click enable of the seeded brain loops.
 * Styled to the fleet Hive view's warm-neutral palette (scoped tokens in the
 * CSS module; honey = queen attention, live-teal = ready-to-enable).
 */
export function BrainReadinessBanner({ readiness }: { readiness: BrainReadiness }) {
  if (readiness.status === "hidden") return null;
  const loops = readiness.blockedLoops.join(" and ");

  if (readiness.status === "loops-off") {
    return (
      <div className={styles.banner} data-tone="loops" role="status" aria-live="polite">
        <span className={styles.badge} aria-hidden="true"><BrainCircuit /></span>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>Brain loops</span>
          <strong className={styles.title}>Ready to turn on</strong>
          <p className={styles.detail}>
            {readiness.notice || `${loops} can run on ${readiness.queenName} on their seeded schedules. Enabling spends scheduled model usage; tune or disable each loop in Schedules.`}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.action} disabled={readiness.busy} onClick={readiness.onEnableLoops}>
            {readiness.busy ? "Enabling..." : `Enable ${loops}`}
          </button>
          <button type="button" className={styles.dismiss} onClick={readiness.onDismissLoops}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  const title = readiness.status === "no-queen"
    ? "Brain loops need a working agent"
    : readiness.status === "multiple-queens"
      ? "Multiple Queen Bees are configured"
      : `${readiness.queenName} needs a model`;
  const detail = readiness.status === "no-queen"
    ? `${loops} run through your Queen Bee, and no agent holds that role yet. Create one (or finish setting up an agent) to bring the second brain online.`
    : readiness.status === "multiple-queens"
      ? "More than one agent has the Queen Bee role, so routing is ambiguous. Keep one queen and set the others back to workers."
      : `${loops} are waiting on the queen's model. Pick a provider and model in her settings to bring the second brain online.`;
  const action = readiness.status === "no-queen" ? "Create Queen Bee" : "Open Queen Bee settings";

  return (
    <div className={styles.banner} data-tone="queen" role="status" aria-live="polite">
      <span className={styles.badge} aria-hidden="true"><Crown /></span>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>The Queen</span>
        <strong className={styles.title}>{title}</strong>
        <p className={styles.detail}>{detail}</p>
      </div>
      <div className={styles.actions}>
        {readiness.status === "multiple-queens" && readiness.strongestName ? (
          <button type="button" className={styles.action} onClick={readiness.onCrownStrongest}>
            Crown {readiness.strongestName}
          </button>
        ) : null}
        <button
          type="button"
          className={readiness.status === "multiple-queens" && readiness.strongestName ? styles.dismiss : styles.action}
          onClick={readiness.onSetUpQueen}
        >
          {action}
        </button>
      </div>
    </div>
  );
}
