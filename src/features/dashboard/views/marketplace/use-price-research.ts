"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MarketplaceResearchJob } from "@/lib/services/marketplace/marketplace-types";

/**
 * Start + poll one price-research job (~a minute of real agent work). Polls
 * every 1.2s only while a job is live; the job record carries observed stages
 * for the ticker.
 */

const POLL_MS = 1_200;

export function usePriceResearch() {
  const [job, setJob] = useState<MarketplaceResearchJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const start = useCallback(async (listingId: string, globalComparison: boolean) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/marketplace/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, globalComparison }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string; job?: MarketplaceResearchJob };
      if (!aliveRef.current) return null;
      if (!payload.ok || !payload.job) {
        setStartError(payload.error ?? `HTTP ${res.status}`);
        return null;
      }
      setJob(payload.job);
      return payload.job;
    } catch (error) {
      if (aliveRef.current) setStartError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (aliveRef.current) setStarting(false);
    }
  }, []);

  const active = job !== null && (job.status === "dispatching" || job.status === "running");

  useEffect(() => {
    if (!active || !job) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/marketplace/research?jobId=${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const payload = (await res.json()) as { ok?: boolean; job?: MarketplaceResearchJob };
        if (!cancelled && payload.ok && payload.job) setJob(payload.job);
      } catch {
        // transient — keep polling
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, job]);

  const resetResearch = useCallback(() => {
    setJob(null);
    setStartError(null);
  }, []);

  return { job, active, starting, startError, start, resetResearch };
}
