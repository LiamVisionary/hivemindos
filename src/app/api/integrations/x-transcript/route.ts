import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";
import { getXTranscriptJob, startXTranscriptJob, xTranscriptJobView } from "@/lib/services/x-transcript/x-transcript-job";
import { inspectXTranscript, resolveXTranscript } from "@/lib/services/x-transcript/x-transcript-service";
import { looksLikeXPost } from "@/lib/services/x-transcript/x-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long videos download + transcribe in chunks; give the whole pipeline room.
export const maxDuration = 300;

/** Poll a detached transcript job so reconnects never depend on one long HTTP request. */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
  if (!jobId) return errorJson("A transcript job id is required.", 400);
  const job = getXTranscriptJob(jobId);
  if (!job) return errorJson("Unknown or expired transcript job.", 404);
  return okJson({ job: xTranscriptJobView(job) });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as { action?: unknown; url?: unknown; summarize?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return errorJson("An X post URL is required.", 400);
  if (!looksLikeXPost(url)) return errorJson("That doesn't look like an X post link. Paste a link like https://x.com/user/status/123…", 400);

  try {
    if (body.action === "start") {
      const inspection = await inspectXTranscript(url);
      const job = startXTranscriptJob(
        { request, url, summarize: body.summarize === true },
        inspection,
      );
      return okJson({ jobId: job.id, inspection, job: xTranscriptJobView(job) });
    }
    if (body.action === "inspect") {
      const inspection = await inspectXTranscript(url);
      return okJson({ inspection });
    }
    const result = await resolveXTranscript({ request, url, summarize: body.summarize === true });
    return okJson({ result });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not pull the transcript.", 502);
  }
}
