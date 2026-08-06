"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import {
  TAILSCALE_ATTENTION_PREFIX,
  shouldClearTailscaleAttentionDismissal,
  shouldShowTailscaleAttention,
  tailscaleAttentionIssueKey,
} from "@/lib/native/tailscale-status";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import styles from "./TailscaleAttentionBanner.module.css";

const DISMISSED_TAILSCALE_ISSUE_STATE_KEY = "dashboard.tailscale-attention.dismissed-issue";

export function TailscaleAttentionBanner({
  status,
  onOpenFleet,
  onRetry,
}: {
  status: string;
  onOpenFleet: () => void;
  onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [dismissedIssueKey, rememberDismissedIssueKey, dismissalHydrated] =
    useRememberedDashboardValue(DISMISSED_TAILSCALE_ISSUE_STATE_KEY);
  const issueKey = tailscaleAttentionIssueKey(status);

  useEffect(() => {
    if (!dismissalHydrated) return;
    if (!shouldClearTailscaleAttentionDismissal(status, dismissedIssueKey)) return;
    rememberDismissedIssueKey("");
  }, [dismissalHydrated, dismissedIssueKey, rememberDismissedIssueKey, status]);

  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry, retrying]);

  if (!dismissalHydrated || !issueKey || !shouldShowTailscaleAttention(status, dismissedIssueKey)) return null;
  const detail = status.slice(TAILSCALE_ATTENTION_PREFIX.length).trim();

  return (
    <aside className={styles.banner} role="alert" aria-live="polite">
      <CircleAlert className={styles.icon} aria-hidden="true" />
      <div className={styles.copy}>
        <strong>Tailscale needs attention</strong>
        <span>{detail}</span>
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" size="sm" isLoading={retrying} onClick={handleRetry}>
          {retrying ? "Checking" : "Retry"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenFleet}>
          Open Fleet
        </Button>
        <button
          type="button"
          className={styles.dismiss}
          aria-label="Dismiss Tailscale warning"
          onClick={() => rememberDismissedIssueKey(issueKey)}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
