import "server-only";

import { randomUUID } from "node:crypto";

import { completeLongRunningProcess, failLongRunningProcess, startLongRunningProcess, updateLongRunningProcess } from "@/lib/services/long-running-processes";
import type { LongRunningProcessProgress } from "@/lib/types/long-running-processes";
import { retrieveSlackChannel, type SlackRetrievalOptions } from "./slack-session";

type SlackRetrievalResult = Awaited<ReturnType<typeof retrieveSlackChannel>>;
type SlackRetrievalRunner = typeof retrieveSlackChannel;

export type SlackRetrievalJobInput = {
  channel: string;
  saveDir?: string;
  options: SlackRetrievalOptions;
};

export type SlackRetrievalJob = {
  id: string;
  key: string;
  channel: string;
  status: "running" | "succeeded" | "failed";
  progress: LongRunningProcessProgress;
  result: SlackRetrievalResult | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
};

type SlackRetrievalJobStore = {
  jobs: Map<string, SlackRetrievalJob>;
  activeByKey: Map<string, string>;
};

type SlackRetrievalJobGlobal = typeof globalThis & {
  __hivemindSlackRetrievalJobs?: SlackRetrievalJobStore;
};

const JOB_RETENTION_MS = 60 * 60_000;
const MAX_RETAINED_JOBS = 40;
const jobGlobal = globalThis as SlackRetrievalJobGlobal;
const store = jobGlobal.__hivemindSlackRetrievalJobs ??= {
  jobs: new Map<string, SlackRetrievalJob>(),
  activeByKey: new Map<string, string>(),
};

function retrievalKey(input: SlackRetrievalJobInput): string {
  return JSON.stringify({
    channel: input.channel.trim(),
    saveDir: input.saveDir?.trim() || "",
    deepDownload: input.options.deepDownload === true,
    ignoreFileTypes: [...(input.options.ignoreFileTypes || [])].sort(),
  });
}

function pruneJobs(now: number): void {
  for (const [id, job] of store.jobs) {
    if (job.status !== "running" && now - job.updatedAt > JOB_RETENTION_MS) {
      store.jobs.delete(id);
    }
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
  job: SlackRetrievalJob,
  input: SlackRetrievalJobInput,
  runner: SlackRetrievalRunner,
): Promise<void> {
  try {
    job.result = await runner(input.channel, input.saveDir, {
      ...input.options,
      onProgress: (progress) => {
        job.progress = { ...progress };
        job.updatedAt = Date.now();
        updateLongRunningProcess(job.id, progress);
      },
    });
    const completionMessage = slackRetrievalCompletionMessage(input.channel, job.result);
    job.progress = {
      stage: "complete",
      label: "Slack download complete",
      completed: 1,
      total: 1,
      detail: job.result.saveDir,
    };
    job.status = "succeeded";
    completeLongRunningProcess(job.id, completionMessage);
  } catch (error) {
    job.error = error instanceof Error ? error.message : "Slack retrieval failed.";
    job.status = "failed";
    failLongRunningProcess(job.id, job.error);
  } finally {
    job.updatedAt = Date.now();
    if (store.activeByKey.get(job.key) === job.id) store.activeByKey.delete(job.key);
  }
}

function slackRetrievalCompletionMessage(
  channel: string,
  result: SlackRetrievalResult,
): string {
  const linked = result.linkedPages || result.linkedFiles
    ? `, ${result.linkedPages} linked page${result.linkedPages === 1 ? "" : "s"}, and ${result.linkedFiles} linked file${result.linkedFiles === 1 ? "" : "s"}`
    : "";
  const completeness = result.linkedItemsDiscovered > 0
    ? result.linkedComplete
      ? ` All ${result.linkedItemsDiscovered} discovered linked items completed.`
      : ` Linked extraction was incomplete: ${result.linkedItemsProcessed}/${result.linkedItemsDiscovered} items processed.`
    : "";
  return `Downloaded ${channel}: ${result.messages} message${result.messages === 1 ? "" : "s"}, ${result.downloaded} Slack file${result.downloaded === 1 ? "" : "s"}${linked}.${completeness}`;
}

export function startSlackRetrievalJob(
  input: SlackRetrievalJobInput,
  runner: SlackRetrievalRunner = retrieveSlackChannel,
): SlackRetrievalJob {
  const now = Date.now();
  pruneJobs(now);
  const key = retrievalKey(input);
  const activeId = store.activeByKey.get(key);
  const active = activeId ? store.jobs.get(activeId) : undefined;
  if (active?.status === "running") return active;

  const job: SlackRetrievalJob = {
    id: randomUUID(),
    key,
    channel: input.channel.trim(),
    status: "running",
    progress: {
      stage: "starting",
      label: "Starting Slack download",
      detail: input.channel.trim(),
    },
    result: null,
    error: null,
    startedAt: now,
    updatedAt: now,
  };
  store.jobs.set(job.id, job);
  store.activeByKey.set(key, job.id);
  startLongRunningProcess({
    id: job.id,
    kind: "slack-channel-download",
    title: "Slack channel download",
    destination: {
      view: "integrations",
      integration: "slack",
      integrationTab: "actions",
      integrationAction: "slack-channel-download",
    },
    progress: job.progress,
  });
  void runJob(job, input, runner);
  return job;
}

export function getSlackRetrievalJob(id: string): SlackRetrievalJob | null {
  pruneJobs(Date.now());
  return store.jobs.get(id) ?? null;
}

export function slackRetrievalJobView(job: SlackRetrievalJob) {
  return {
    id: job.id,
    channel: job.channel,
    status: job.status,
    progress: { ...job.progress },
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  };
}
