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
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = React.useRef<HTMLElement | null>(null);

  // Escape to close, plus a focus trap: focus enters the dialog on open, Tab
  // cycles inside it, and focus returns to the opener on close.
  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Hive Compute host setup for ${machineName}`}
        className={`${styles.tokens} ${styles.surface} ${styles.modal}`}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        tabIndex={-1}
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
