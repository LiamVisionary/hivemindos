"use client";

import * as React from "react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { FleetMachine } from "@/components/fleet/fleet-data";
import { HiveComputeHostConsole } from "./hive-compute-host-console";
import styles from "./hive-compute-host-modal.module.css";

/**
 * Fleet-side chrome around {@link HiveComputeHostConsole}: a modal dialog for
 * renting out one fleet machine's spare compute. The console (readiness meter +
 * intro/setup/manage/earnings flow) is shared verbatim with the dashboard Hive
 * Compute route; only the backdrop, dialog framing, and close affordance live
 * here.
 */
export function HiveComputeHostModal({
  machine,
  machines,
  onClose,
}: {
  machine: FleetMachine;
  machines?: FleetMachine[];
  onClose: () => void;
}) {
  const machineName = machine.name || "this machine";

  // Escape to close (modal-only chrome).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Hive Compute host setup for ${machineName}`}
        className={`${styles.tokens} ${styles.surface} ${styles.modal}`}
        onClick={(event) => event.stopPropagation()}
      >
        <CloseIconButton
          type="button"
          title="Close"
          aria-label="Close Hive Compute host setup"
          onClick={onClose}
          className={styles.close}
        />
        <HiveComputeHostConsole machine={machine} machines={machines} onClose={onClose} />
      </section>
    </div>
  );
}
