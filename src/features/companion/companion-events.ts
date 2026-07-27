"use client";

/* companion-events.ts — cross-surface "show me the companion" signal.
 *
 * The companion lives as a view mode inside FleetHiveView's local state, so
 * the setup modal (rendered at the DashboardApp root) can't set it directly.
 * It instead navigates to the fleet view and fires this request; the fleet
 * view consumes it on mount or live. The pending flag covers the race where
 * the fleet view mounts after the event has already fired.
 */

const COMPANION_OPEN_VIEW_EVENT = "hivemindos:companion-open-view";

let pendingOpenRequest = false;

export function requestCompanionView() {
  if (typeof window === "undefined") return;
  pendingOpenRequest = true;
  window.dispatchEvent(new CustomEvent(COMPANION_OPEN_VIEW_EVENT));
}

/** One-shot read of a queued open request (clears it). */
export function consumePendingCompanionViewRequest(): boolean {
  const pending = pendingOpenRequest;
  pendingOpenRequest = false;
  return pending;
}

export function subscribeCompanionViewRequest(onRequest: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = () => {
    pendingOpenRequest = false;
    onRequest();
  };
  window.addEventListener(COMPANION_OPEN_VIEW_EVENT, handle);
  return () => window.removeEventListener(COMPANION_OPEN_VIEW_EVENT, handle);
}
