import "server-only";

import { randomUUID } from "node:crypto";

import {
  resolveXTranscript,
  type ResolveXTranscriptInput,
  type XTranscriptInspection,
  type XTranscriptResult,
} from "@/lib/services/x-transcript/x-transcript-service";

export type XTranscriptJob = {
  id: string;
  key: string;
  status: "running" | "succeeded" | "failed";
  inspection: XTranscriptInspection;
  result: XTranscriptResult | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
};

type XTranscriptJobStore = {
  jobs: Map<string, XTranscriptJob>;
  activeByKey: Map<string, string>;
};

type XTranscriptJobGlobal = typeof globalThis & {
  __hivemindXTranscriptJobs?: XTranscriptJobStore;
};

const JOB_RETENTION_MS = 60 * 60_000;
const MAX_RETAINED_JOBS = 40;
export const X_TRANSCRIPT_PIPELINE_VERSION = "caption-structure-v2";
const jobGlobal = globalThis as XTranscriptJobGlobal;
const store = jobGlobal.__hivemindXTranscriptJobs ??= {
  jobs: new Map<string, XTranscriptJob>(),
  activeByKey: new Map<string, string>(),
};

export function xTranscriptJobCacheKey(
  input: ResolveXTranscriptInput,
  pipelineVersion = X_TRANSCRIPT_PIPELINE_VERSION,
): string {
  return JSON.stringify({
    pipelineVersion,
    threadId: input.threadId?.trim() || "unscoped",
    url: input.url.trim(),
    summarize: input.summarize === true,
  });
}

function isReusableJob(job: XTranscriptJob, inspection: XTranscriptInspection): boolean {
  if (job.status === "running") return true;
  if (job.status !== "succeeded" || !job.result) return false;
  // A video can fall through to its root post after every media path fails.
  // That keeps the first response useful, but it is not a completed video
  // transcript and must never block a later retry through an improved pipeline.
  return inspection.kind !== "video" || job.result.kind === "video";
}

function pruneJobs(now: number): void {
  for (const [id, job] of store.jobs) {
    if (job.status !== "running" && now - job.updatedAt > JOB_RETENTION_MS) store.jobs.delete(id);
  }
  if (store.jobs.size <= MAX_RETAINED_JOBS) return;
  const finished = [...store.jobs.values()]
    .filter((job) => job.status !== "running")
    .sort((left, right) => left.updatedAt - right.updatedAt);
  for (const job of finished) {
    if (store.jobs.size <= MAX_RETAINED_JOBS) break;
    store.jobs.delete(job.id);
  }
}

async function runJob(
  job: XTranscriptJob,
  input: ResolveXTranscriptInput,
  runner: typeof resolveXTranscript,
): Promise<void> {
  try {
    job.result = await runner(input);
    job.status = "succeeded";
  } catch (error) {
    job.error = error instanceof Error ? error.message : "Could not pull the transcript.";
    job.status = "failed";
  } finally {
    job.updatedAt = Date.now();
    // Keep successful jobs addressable by key for the retention window so a
    // repeated command reconnects to its result instead of buying it twice.
    if (!isReusableJob(job, job.inspection) && store.activeByKey.get(job.key) === job.id) {
      store.activeByKey.delete(job.key);
    }
  }
}

export function startXTranscriptJob(
  input: ResolveXTranscriptInput,
  inspection: XTranscriptInspection,
  runner: typeof resolveXTranscript = resolveXTranscript,
): XTranscriptJob {
  const now = Date.now();
  pruneJobs(now);
  const key = xTranscriptJobCacheKey(input);
  const activeId = store.activeByKey.get(key);
  const active = activeId ? store.jobs.get(activeId) : undefined;
  if (active && isReusableJob(active, inspection)) return active;
  if (activeId && store.activeByKey.get(key) === activeId) store.activeByKey.delete(key);

  const job: XTranscriptJob = {
    id: randomUUID(),
    key,
    status: "running",
    inspection,
    result: null,
    error: null,
    startedAt: now,
    updatedAt: now,
  };
  store.jobs.set(job.id, job);
  store.activeByKey.set(key, job.id);
  void runJob(job, input, runner);
  return job;
}

export function getXTranscriptJob(id: string): XTranscriptJob | null {
  pruneJobs(Date.now());
  return store.jobs.get(id) ?? null;
}

export function xTranscriptJobView(job: XTranscriptJob) {
  return {
    id: job.id,
    status: job.status,
    inspection: { ...job.inspection },
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  };
}
