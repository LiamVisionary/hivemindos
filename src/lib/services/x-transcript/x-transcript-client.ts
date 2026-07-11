import type {
  XTranscriptInspection,
  XTranscriptResult,
} from "@/lib/services/x-transcript/x-transcript-service";

export type XTranscriptJobView = {
  id: string;
  status: "running" | "succeeded" | "failed";
  inspection?: XTranscriptInspection;
  result?: XTranscriptResult | null;
  error?: string | null;
};

export type StartedXTranscriptJob = {
  jobId: string;
  inspection: XTranscriptInspection | null;
};

export const X_TRANSCRIPT_POLL_INTERVAL_MS = 1_500;
export const X_TRANSCRIPT_POLL_TIMEOUT_MS = 12 * 60_000;

export async function startXTranscriptJobRequest(url: string): Promise<StartedXTranscriptJob> {
  const response = await fetch("/api/integrations/x-transcript", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", url, summarize: true }),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    jobId?: string;
    inspection?: XTranscriptInspection;
  } | null;
  if (!response.ok || !data?.ok || !data.jobId) {
    throw new Error(data?.error || `Transcript job failed to start with HTTP ${response.status}.`);
  }
  return { jobId: data.jobId, inspection: data.inspection ?? null };
}

export async function readXTranscriptJob(jobId: string): Promise<XTranscriptJobView> {
  const response = await fetch(`/api/integrations/x-transcript?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; job?: XTranscriptJobView } | null;
  if (!response.ok || !data?.ok || !data.job) {
    throw new Error(data?.error || `Transcript status failed with HTTP ${response.status}.`);
  }
  return data.job;
}

export async function pollXTranscriptJob(jobId: string): Promise<XTranscriptResult> {
  const deadline = Date.now() + X_TRANSCRIPT_POLL_TIMEOUT_MS;
  let transientFailures = 0;
  while (Date.now() < deadline) {
    try {
      const job = await readXTranscriptJob(jobId);
      transientFailures = 0;
      if (job.status === "failed") throw new Error(job.error || "Could not pull the transcript.");
      if (job.status === "succeeded" && job.result) return job.result;
    } catch (error) {
      transientFailures += 1;
      if (transientFailures >= 3) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, X_TRANSCRIPT_POLL_INTERVAL_MS));
  }
  throw new Error("The transcript is still running in the background. Retry the command to reconnect to it.");
}
