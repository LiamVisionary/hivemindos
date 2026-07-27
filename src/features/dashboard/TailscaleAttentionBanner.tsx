"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import styles from "./TailscaleAttentionBanner.module.css";

export function TailscaleAttentionBanner({
  status,
  onOpenFleet,
}: {
  status: string;
  onOpenFleet: () => void;
}) {
  const prefix = "Tailscale needs attention.";
  if (!status.startsWith(prefix)) return null;
  const detail = status.slice(prefix.length).trim();

  return (
    <aside className={styles.banner} role="alert" aria-live="polite">
      <CircleAlert className={styles.icon} aria-hidden="true" />
      <div className={styles.copy}>
        <strong>Tailscale needs attention</strong>
        <span>{detail}</span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onOpenFleet}>
        Open Fleet
      </Button>
    </aside>
  );
}
