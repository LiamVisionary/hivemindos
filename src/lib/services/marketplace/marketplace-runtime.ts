import "server-only";

import { promises as fs } from "node:fs";

import {
  MARKETPLACE_RUNTIME_PATH,
  enqueueMarketplaceWrite,
  writeFileAtomic,
} from "@/lib/services/marketplace/marketplace-store-io";
import type { MarketplaceAgentOp } from "@/lib/services/marketplace/adapters/types";
import type { MarketplaceResearchJob } from "@/lib/services/marketplace/marketplace-types";

/**
 * Per-machine hot state for the marketplace monitor + research jobs. Never
 * replicated: poll stamps and in-flight markers are meaningful only on the
 * machine running them. Missing/corrupt overlay resets to empty by design.
 */

export type MarketplaceAccountRuntime = {
  lastPollAt?: string;
  /** Last time anything happened (agent replied / buyer messaged) — drives the backoff ladder. */
  lastActivityAt?: string;
  nextPollAt?: string;
  /** Last full base-cadence sweep (catalog sync + inbox) — hot rungs only probe. */
  lastSweepAt?: string;
  /** Set while an agent session, probe, or posted-unverified promotion check is running; suppresses overlapping work. */
  inFlightOp?: MarketplaceAgentOp | "probe" | "verify-listing";
  inFlightSince?: string;
  lastError?: string;
};

export type MarketplaceRuntimeOverlay = {
  version: 1;
  perAccount: Record<string, MarketplaceAccountRuntime>;
  researchJobs: MarketplaceResearchJob[];
  lastTickAt?: string;
};

const EMPTY_OVERLAY: MarketplaceRuntimeOverlay = { version: 1, perAccount: {}, researchJobs: [] };

export async function readMarketplaceRuntime(): Promise<MarketplaceRuntimeOverlay> {
  try {
    const text = await fs.readFile(MARKETPLACE_RUNTIME_PATH, "utf8");
    const parsed = JSON.parse(text) as MarketplaceRuntimeOverlay;
    if (parsed && typeof parsed === "object" && parsed.perAccount && typeof parsed.perAccount === "object") {
      return {
        version: 1,
        perAccount: parsed.perAccount,
        researchJobs: Array.isArray(parsed.researchJobs) ? parsed.researchJobs : [],
        ...(typeof parsed.lastTickAt === "string" ? { lastTickAt: parsed.lastTickAt } : {}),
      };
    }
  } catch {
    // missing/corrupt overlay resets to empty — hot state is rebuildable
  }
  return { ...EMPTY_OVERLAY, perAccount: {}, researchJobs: [] };
}

export async function mutateMarketplaceRuntime<T>(
  mutate: (overlay: MarketplaceRuntimeOverlay) => T | Promise<T>,
): Promise<T> {
  return enqueueMarketplaceWrite(async () => {
    const overlay = await readMarketplaceRuntime();
    const result = await mutate(overlay);
    await writeFileAtomic(MARKETPLACE_RUNTIME_PATH, JSON.stringify(overlay, null, 2));
    return result;
  });
}

export async function patchAccountRuntime(accountId: string, patch: Partial<MarketplaceAccountRuntime>): Promise<MarketplaceAccountRuntime> {
  return mutateMarketplaceRuntime((overlay) => {
    const current = overlay.perAccount[accountId] ?? {};
    const next: MarketplaceAccountRuntime = { ...current, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key as keyof MarketplaceAccountRuntime];
    }
    overlay.perAccount[accountId] = next;
    return next;
  });
}

export async function upsertResearchJob(job: MarketplaceResearchJob): Promise<void> {
  await mutateMarketplaceRuntime((overlay) => {
    const index = overlay.researchJobs.findIndex((candidate) => candidate.id === job.id);
    if (index >= 0) overlay.researchJobs[index] = job;
    else overlay.researchJobs.push(job);
    // Bound the job list — finished jobs older than the newest 50 age out.
    if (overlay.researchJobs.length > 50) {
      overlay.researchJobs = overlay.researchJobs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
    }
  });
}

export async function getResearchJob(jobId: string): Promise<MarketplaceResearchJob | null> {
  const overlay = await readMarketplaceRuntime();
  return overlay.researchJobs.find((job) => job.id === jobId) ?? null;
}

export async function patchResearchJob(
  jobId: string,
  patch: (job: MarketplaceResearchJob) => MarketplaceResearchJob,
): Promise<MarketplaceResearchJob | null> {
  return mutateMarketplaceRuntime((overlay) => {
    const index = overlay.researchJobs.findIndex((candidate) => candidate.id === jobId);
    if (index < 0) return null;
    const next = patch(overlay.researchJobs[index]);
    overlay.researchJobs[index] = next;
    return next;
  });
}
