import "server-only";

import { randomUUID } from "node:crypto";

import { numberEnv } from "@/lib/config/env";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";
import { buildPriceResearchPrompt } from "@/lib/services/marketplace/marketplace-agent-context";
import { parseResearchResultBlock } from "@/lib/services/marketplace/marketplace-agent-report";
import { abandonUnclaimedQueenTask, awaitQueenTaskResult, submitMarketplaceQueenTask } from "@/lib/services/marketplace/marketplace-dispatch";
import { getMarketplaceListing, updateMarketplaceListing } from "@/lib/services/marketplace/marketplace-listings-store";
import { getMarketplaceAccount } from "@/lib/services/marketplace/marketplace-store";
import { getResearchJob, patchResearchJob, readMarketplaceRuntime, upsertResearchJob } from "@/lib/services/marketplace/marketplace-runtime";
import type { MarketplaceResearchJob, MarketplaceResearchResult, MarketplaceResearchStage } from "@/lib/services/marketplace/marketplace-types";

/**
 * Queen price research: forward the listing's description + photos + locale to
 * the strongest research-capable agent, poll the Work Board task, and persist
 * the parsed RESEARCH_RESULT on the listing. Stages come from OBSERVED task
 * state (queued → claimed → working → parsing) — never a fake progress
 * animation. Progress lives on the job record so the UI polls one endpoint.
 */

// 15 min: a real research session measured 6.9 min end-to-end (2026-07-18,
// task t_mrqvfovf_r609r) — the original 5-min cap threw away its finished,
// parseable result two minutes before it landed.
const researchTimeoutMs = () => numberEnv("HIVEMINDOS_MARKETPLACE_RESEARCH_TIMEOUT_MS", 15 * 60_000);

function stage(label: string, done: boolean): MarketplaceResearchStage {
  return { label, at: new Date().toISOString(), done };
}

async function appendStage(jobId: string, label: string, options?: { completePrevious?: boolean }) {
  await patchResearchJob(jobId, (job) => {
    const stages = options?.completePrevious === false ? [...job.stages] : job.stages.map((entry) => ({ ...entry, done: true }));
    if (stages.some((entry) => entry.label === label)) return { ...job, stages, updatedAt: new Date().toISOString() };
    return { ...job, stages: [...stages, stage(label, false)], updatedAt: new Date().toISOString() };
  });
}

async function finishJob(jobId: string, patch: Partial<MarketplaceResearchJob>) {
  await patchResearchJob(jobId, (job) => ({
    ...job,
    ...patch,
    stages: job.stages.map((entry) => ({ ...entry, done: true })),
    updatedAt: new Date().toISOString(),
  }));
}

/** Background completion loop for one job (detached; survives only this process — the UI treats stale jobs as failed). */
async function runResearchJob(jobId: string, queenTaskId: string, listingId: string): Promise<void> {
  const deadline = Date.now() + researchTimeoutMs();
  // Observe claim/working transitions for honest stage reporting.
  let sawWorking = false;
  while (Date.now() < deadline) {
    const board = await readBoard(null, {}).catch(() => null);
    const task = board?.tasks.find((candidate) => candidate.id === queenTaskId);
    if (task?.status === "working" && !sawWorking) {
      sawWorking = true;
      await appendStage(jobId, "Researching comparable prices");
    }
    if (task?.status === "done") break;
    if (task?.status === "needs-human" || task?.status === "archived") {
      await finishJob(jobId, { status: "failed", failure: `Research task ended ${task.status}.` });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  const outcome = await awaitQueenTaskResult(queenTaskId, { timeoutMs: 1, pollMs: 1 });
  if (outcome.status !== "done") {
    // Never-started task: archive it so the pending re-router can't fire a
    // stale session later. A task an agent is actively working stays alive —
    // recoverLateMarketplaceResearch applies its result if it lands.
    const abandoned = await abandonUnclaimedQueenTask(queenTaskId);
    await finishJob(jobId, {
      status: "failed",
      failure: abandoned
        ? "No research agent picked this up in time — try again in a bit."
        : sawWorking
          ? "Research timed out — if the researcher still finishes, the result attaches automatically; or try again / set the price manually."
          : "Research timed out — try again, or set the price manually.",
    });
    return;
  }
  await appendStage(jobId, "Reading the results");
  const result = parseResearchResultBlock(outcome.result);
  if (!result) {
    await finishJob(jobId, { status: "failed", failure: "The researcher returned no parseable result — try again.", lateResultUnavailable: true });
    return;
  }
  await applyResearchResult(jobId, listingId, result);
}

/** Persist a parsed result onto the listing + job (shared by the live loop and late recovery). */
async function applyResearchResult(jobId: string, listingId: string, result: MarketplaceResearchResult): Promise<void> {
  await updateMarketplaceListing(listingId, {
    research: {
      jobId,
      suggestedPriceUsd: result.suggestedPriceUsd,
      priceRangeUsd: result.priceRangeUsd,
      compsCount: result.comps.length,
      confidence: result.confidence,
      completedAt: new Date().toISOString(),
    },
  });
  await finishJob(jobId, { status: "succeeded", result });
}

/** Recovery sweep only rechecks jobs young enough for a session to plausibly still land. */
const LATE_RECOVERY_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Second-chance pass for timed-out research (driver-tick hook): a session that
 * finishes AFTER the job gave up still lands its result instead of wasting a
 * multi-minute agent run — seen live 2026-07-18, when a 6.9-min session beat
 * the old 5-min cap by two minutes and its parseable result was dropped.
 * Terminal no-result tasks are flagged so the sweep never rechecks them.
 * Returns the number of jobs recovered.
 */
export async function recoverLateMarketplaceResearch(
  options?: { readBoardImpl?: typeof readBoard },
): Promise<number> {
  const overlay = await readMarketplaceRuntime();
  const now = Date.now();
  const candidates = overlay.researchJobs.filter((job) =>
    job.status === "failed"
    && Boolean(job.queenTaskId)
    && !job.result
    && !job.lateResultUnavailable
    && now - Date.parse(job.updatedAt) < LATE_RECOVERY_WINDOW_MS,
  );
  if (!candidates.length) return 0;
  const board = await (options?.readBoardImpl ?? readBoard)(null, {}).catch(() => null);
  if (!board) return 0;
  let recovered = 0;
  for (const job of candidates) {
    const task = board.tasks.find((candidate) => candidate.id === job.queenTaskId);
    const markUnavailable = async (failure?: string) => {
      await patchResearchJob(job.id, (current) => ({
        ...current,
        lateResultUnavailable: true,
        ...(failure ? { failure } : {}),
        updatedAt: new Date().toISOString(),
      }));
    };
    if (!task || task.status === "needs-human" || task.status === "archived") {
      await markUnavailable();
      continue;
    }
    if (task.status !== "done") continue; // still running — recheck next pass
    const result = parseResearchResultBlock(task.result ?? "");
    if (!result) {
      await markUnavailable("The researcher returned no parseable result — try again.");
      continue;
    }
    // Never clobber research a newer job already wrote to this listing.
    const listing = await getMarketplaceListing(job.listingId);
    if (!listing) {
      await markUnavailable();
      continue;
    }
    if (listing.research && listing.research.jobId !== job.id) {
      await patchResearchJob(job.id, (current) => ({ ...current, status: "succeeded", result, updatedAt: new Date().toISOString() }));
      continue;
    }
    await appendStage(job.id, "Recovered the researcher's late result");
    await applyResearchResult(job.id, job.listingId, result);
    recovered += 1;
  }
  return recovered;
}

export async function startMarketplacePriceResearch(input: {
  listingId: string;
  globalComparison?: boolean;
}): Promise<MarketplaceResearchJob> {
  const listing = await getMarketplaceListing(input.listingId);
  if (!listing) throw new Error(`Unknown listing: ${input.listingId}`);
  if (!listing.description.trim()) {
    throw new Error("Write the item description first — the Queen researches from it.");
  }
  const account = await getMarketplaceAccount(listing.accountId);
  if (!account) throw new Error(`Account ${listing.accountId} no longer exists.`);
  const globalComparison = input.globalComparison ?? account.locale.globalComparison;
  const job: MarketplaceResearchJob = {
    id: `mres_${randomUUID()}`,
    listingId: listing.id,
    accountId: account.id,
    status: "dispatching",
    stages: [stage("Handing the brief to the Queen", false)],
    globalComparison,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await upsertResearchJob(job);
  const prompt = buildPriceResearchPrompt(account, listing, globalComparison);
  try {
    const submitted = await submitMarketplaceQueenTask({
      // Phrasing intentionally hits the router's research worker-class keywords
      // (research/compare/market) so a research-capable agent is chosen.
      message: prompt,
      taskTitle: `Price research: ${listing.title}`,
    });
    await patchResearchJob(job.id, (current) => ({
      ...current,
      status: "running",
      queenTaskId: submitted.taskId,
      stages: [...current.stages.map((entry) => ({ ...entry, done: true })), stage("Waiting for a research agent", false)],
      updatedAt: new Date().toISOString(),
    }));
    // Detached completion loop; the GET endpoint serves whatever state this has reached.
    void runResearchJob(job.id, submitted.taskId, listing.id).catch(async (error) => {
      await finishJob(job.id, { status: "failed", failure: error instanceof Error ? error.message : String(error) });
    });
  } catch (error) {
    await finishJob(job.id, { status: "failed", failure: error instanceof Error ? error.message : String(error) });
  }
  return (await getResearchJob(job.id)) ?? job;
}

/** Poll target for the UI. Jobs that stopped updating (server restart) read as failed after the timeout window. */
export async function readMarketplaceResearchJob(jobId: string): Promise<MarketplaceResearchJob | null> {
  const job = await getResearchJob(jobId);
  if (!job) return null;
  if ((job.status === "running" || job.status === "dispatching") && Date.now() - Date.parse(job.updatedAt) > researchTimeoutMs() + 60_000) {
    await finishJob(job.id, { status: "failed", failure: "Research stalled (the server may have restarted) — try again." });
    return getResearchJob(jobId);
  }
  return job;
}
