"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { simpleStableHash } from "@/features/dashboard/dashboard-light-helpers";

const LAST_SWEEP_STORAGE_KEY = "hivemindos.tailnetCleanup.lastSweepAt";
const DISMISSED_PLAN_STORAGE_KEY = "hivemindos.tailnetCleanup.dismissedPlan";
const SWEEP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SWEEP_POLL_MS = 60 * 60 * 1000;

export type TailnetCleanupCandidateSummary = {
  id: string;
  hostname: string;
  offlineForDays: number;
  scope: "hivemindos" | "duplicate";
};

export type TailnetCleanupPlanSummary = {
  configured: boolean;
  autoCleanupEnabled: boolean;
  staleAgeDays: number;
  candidates: TailnetCleanupCandidateSummary[];
};

type CleanupPostPayload = {
  ok?: boolean;
  deleted?: Array<{ hostname: string }>;
  failed?: Array<{ hostname: string; detail?: string }>;
  error?: string;
};

function planFingerprint(candidates: TailnetCleanupCandidateSummary[]) {
  return simpleStableHash([...candidates.map((candidate) => candidate.id)].sort().join("|"));
}

/**
 * Daily stale-tailnet-node sweep via /api/tailscale/cleanup.
 *
 * Default behavior is REPORT-ONLY: the dry-run plan is exposed so the fleet
 * view can ask the user before anything is deleted. Unattended deletion only
 * happens when the user has opted in (HIVE_TAILNET_AUTO_CLEANUP=1, set by the
 * "Always clean up automatically" action or by hand), and even then it is
 * limited to offline `hivemindos-*` link nodes — the nodes this app registers
 * itself. Requires TAILSCALE_API_KEY in ~/.hivemindos/.env; otherwise no-op.
 */
export function useTailnetAutoCleanup(enabled: boolean) {
  const [stalePlan, setStalePlan] = useState<TailnetCleanupPlanSummary | null>(null);
  const [dismissedFingerprint, setDismissedFingerprint] = useState(() => (
    typeof window === "undefined" ? "" : window.localStorage.getItem(DISMISSED_PLAN_STORAGE_KEY) ?? ""
  ));
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState("");

  const refreshPlan = useCallback(async () => {
    const response = await fetch("/api/tailscale/cleanup", { cache: "no-store" });
    const plan = await response.json().catch(() => null) as (TailnetCleanupPlanSummary & { ok?: boolean }) | null;
    if (!plan?.configured) {
      setStalePlan(null);
      return null;
    }
    const summary: TailnetCleanupPlanSummary = {
      configured: true,
      autoCleanupEnabled: Boolean(plan.autoCleanupEnabled),
      staleAgeDays: plan.staleAgeDays,
      candidates: plan.candidates ?? [],
    };
    setStalePlan(summary);
    return summary;
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let cancelled = false;

    const runSweep = async () => {
      const lastSweepAt = Number(window.localStorage.getItem(LAST_SWEEP_STORAGE_KEY) ?? 0);
      if (Date.now() - lastSweepAt < SWEEP_COOLDOWN_MS) {
        // Refresh the visible plan without re-running the unattended branch.
        await refreshPlan().catch(() => null);
        return;
      }
      // Claim the slot before sweeping so a failing API cannot hot-loop.
      window.localStorage.setItem(LAST_SWEEP_STORAGE_KEY, String(Date.now()));
      try {
        const plan = await refreshPlan();
        if (cancelled || !plan?.candidates.length || !plan.autoCleanupEnabled) return;
        const response = await fetch("/api/tailscale/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "hivemindos", unattended: true }),
        });
        const payload = await response.json().catch(() => null) as CleanupPostPayload | null;
        if (cancelled || !payload) return;
        if (payload.deleted?.length) {
          console.info(
            `[tailnet-cleanup] removed ${payload.deleted.length} stale hivemindos node(s): ${payload.deleted.map((device) => device.hostname).join(", ")}`,
          );
        }
        if (payload.failed?.length) {
          console.warn("[tailnet-cleanup] some stale nodes could not be removed", payload.failed);
        }
        await refreshPlan().catch(() => null);
      } catch {
        // Sweep is best-effort; discovery and the roster do not depend on it.
      }
    };

    void runSweep();
    const handle = window.setInterval(() => void runSweep(), SWEEP_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [enabled, refreshPlan]);

  const visibleCandidates = useMemo(() => stalePlan?.candidates ?? [], [stalePlan]);
  const currentFingerprint = visibleCandidates.length ? planFingerprint(visibleCandidates) : "";
  const stalePlanVisible = Boolean(
    stalePlan?.configured
    && visibleCandidates.length
    && currentFingerprint !== dismissedFingerprint,
  );

  const dismissCleanup = useCallback(() => {
    if (typeof window !== "undefined" && currentFingerprint) {
      window.localStorage.setItem(DISMISSED_PLAN_STORAGE_KEY, currentFingerprint);
    }
    setDismissedFingerprint(currentFingerprint);
    setCleanupNotice("");
  }, [currentFingerprint]);

  const runCleanupNow = useCallback(async () => {
    if (!visibleCandidates.length || cleanupBusy) return;
    setCleanupBusy(true);
    setCleanupNotice("");
    try {
      const response = await fetch("/api/tailscale/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all", deviceIds: visibleCandidates.map((candidate) => candidate.id) }),
      });
      const payload = await response.json().catch(() => null) as CleanupPostPayload | null;
      const deleted = payload?.deleted?.length ?? 0;
      const failed = payload?.failed?.length ?? 0;
      setCleanupNotice(failed
        ? `Removed ${deleted} node(s); ${failed} could not be removed.`
        : `Removed ${deleted} stale node(s) from the tailnet.`);
      await refreshPlan().catch(() => null);
    } catch (error) {
      setCleanupNotice(error instanceof Error ? error.message : "Cleanup failed.");
    } finally {
      setCleanupBusy(false);
    }
  }, [cleanupBusy, refreshPlan, visibleCandidates]);

  const enableAlwaysCleanup = useCallback(async () => {
    if (cleanupBusy) return;
    setCleanupBusy(true);
    setCleanupNotice("");
    try {
      const response = await fetch("/api/tailscale/cleanup/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCleanup: true }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!payload?.ok) throw new Error(payload?.error || "Could not save the cleanup setting.");
    } catch (error) {
      setCleanupBusy(false);
      setCleanupNotice(error instanceof Error ? error.message : "Could not save the cleanup setting.");
      return;
    }
    setCleanupBusy(false);
    // The opt-in click also approves the currently listed nodes.
    await runCleanupNow();
  }, [cleanupBusy, runCleanupNow]);

  return {
    stalePlan,
    stalePlanVisible,
    cleanupBusy,
    cleanupNotice,
    runCleanupNow,
    enableAlwaysCleanup,
    dismissCleanup,
  };
}
