"use client";

import { HiveComputeHostConsole } from "@/components/fleet/hive-compute-host-console";
import styles from "@/components/fleet/hive-compute-host-modal.module.css";

/**
 * Dashboard Hive Compute route. Renders the shared {@link HiveComputeHostConsole}
 * — the same UI the fleet host modal uses — as a full-page card that targets
 * this machine (no `machine` prop ⇒ self). The console owns all logic and state;
 * this view only supplies the page shell and the shared token/surface styling.
 */
export function HiveComputePanel() {
  return (
    <div className={styles.pageWrap}>
      <div className={`${styles.tokens} ${styles.surface} ${styles.page}`}>
        <HiveComputeHostConsole />
      </div>
    </div>
  );
}
