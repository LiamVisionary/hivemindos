"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MarketplaceDecision } from "@/lib/services/marketplace/marketplace-types";

/**
 * Standalone pending-decisions poller for surfaces OUTSIDE the Marketplace
 * desk (the Alerts "Review first" rail). Mirrors use-spend-approvals
 * ergonomics: deferred kickoff, interval poll, optimistic removal on decide.
 */
export function useMarketplaceDecisions({ pollMs = 30_000, enabled = true }: { pollMs?: number; enabled?: boolean } = {}) {
  const [decisions, setDecisions] = useState<MarketplaceDecision[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/decisions?status=pending", { cache: "no-store" });
      const payload = (await res.json()) as { ok?: boolean; decisions?: MarketplaceDecision[] };
      if (aliveRef.current && payload.ok) setDecisions(payload.decisions ?? []);
    } catch {
      // transient — next poll retries
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [enabled, pollMs, refresh]);

  const decide = useCallback(
    async (id: string, decision: "approved" | "denied", note: string, makeDirective: boolean) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/marketplace/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "decide", id, decision, note, makeDirective }),
        });
        const payload = (await res.json()) as { ok?: boolean; error?: string };
        if (!payload.ok) {
          if (aliveRef.current) setError(payload.error ?? `HTTP ${res.status}`);
          return false;
        }
        if (aliveRef.current) setDecisions((current) => current.filter((candidate) => candidate.id !== id));
        void refresh();
        return true;
      } catch (fetchError) {
        if (aliveRef.current) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        return false;
      } finally {
        if (aliveRef.current) setBusyId(null);
      }
    },
    [refresh],
  );

  const ignore = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/marketplace/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ignore", id }),
        });
        const payload = (await res.json()) as { ok?: boolean; error?: string };
        if (!payload.ok) {
          if (aliveRef.current) setError(payload.error ?? `HTTP ${res.status}`);
          return false;
        }
        if (aliveRef.current) setDecisions((current) => current.filter((candidate) => candidate.id !== id));
        void refresh();
        return true;
      } catch (fetchError) {
        if (aliveRef.current) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        return false;
      } finally {
        if (aliveRef.current) setBusyId(null);
      }
    },
    [refresh],
  );

  return { decisions, busyId, error, refresh, decide, ignore };
}
