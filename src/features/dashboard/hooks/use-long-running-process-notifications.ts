import { useEffect, useRef } from "react";

import { processCompletionNotification, type DashboardCompletionNotification } from "@/features/dashboard/dashboard-completion-notifications";
import type { LongRunningProcessSnapshot } from "@/lib/types/long-running-processes";

type UseLongRunningProcessNotificationsOptions = {
  enabled: boolean;
  onNotification: (notification: DashboardCompletionNotification) => void;
};

const PROCESS_POLL_INTERVAL_MS = 1_500;

export function useLongRunningProcessNotifications({
  enabled,
  onNotification,
}: UseLongRunningProcessNotificationsOptions): void {
  const onNotificationRef = useRef(onNotification);

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let initialized = false;
    let revision = 0;
    let timer: number | undefined;
    const notified = new Set<string>();

    const poll = async () => {
      try {
        const query = initialized ? `?afterRevision=${revision}` : "";
        const response = await fetch(`/api/processes${query}`, { cache: "no-store" });
        const snapshot = (await response.json()) as LongRunningProcessSnapshot & { error?: string };
        if (!response.ok) throw new Error(snapshot.error || "Could not read process status.");
        if (cancelled) return;
        const wasInitialized = initialized;
        initialized = true;
        revision = Math.max(revision, snapshot.revision || 0);
        if (wasInitialized) {
          for (const process of snapshot.processes || []) {
            if (process.status === "running" || notified.has(process.id)) continue;
            notified.add(process.id);
            onNotificationRef.current(processCompletionNotification(process));
          }
        }
      } catch {
        // A dev-server rebuild or brief offline window must not stop later polls.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), PROCESS_POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void poll(), 0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);
}
