// guard:allow-hive-action-route - dashboard-only Slack session retrieval; reads
// the user's own connected Slack session server-side. Not an agent-invocable Hive
// action for now (session capture + retrieval is a consented user flow).
import { NextRequest } from "next/server";

import { getSlackRetrievalJob, slackRetrievalJobView, startSlackRetrievalJob } from "@/lib/services/integrations/slack-retrieval-job";
import { slackSessionAuthTest, type SlackIgnoredFileType } from "@/lib/services/integrations/slack-session";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIgnoredFileTypes(value: unknown): SlackIgnoredFileType[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => item !== "image")) return null;
  return [...new Set(value)] as SlackIgnoredFileType[];
}

/** Report which workspace the stored Slack session belongs to (or not connected). */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
  if (jobId) {
    const job = getSlackRetrievalJob(jobId);
    if (!job) return errorJson("Unknown or expired Slack retrieval job.", 404);
    return okJson({ job: slackRetrievalJobView(job) });
  }
  const result = await slackSessionAuthTest();
  return okJson(result);
}

/** Start a detached channel retrieval. The UI polls GET so long crawls never hold the proxy open. */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: { channel?: unknown; saveDir?: unknown; ignoreFileTypes?: unknown; deepDownload?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }
  const channel = typeof body.channel === "string" ? body.channel.trim() : "";
  const saveDir = typeof body.saveDir === "string" ? body.saveDir.trim() : "";
  const ignoreFileTypes = parseIgnoredFileTypes(body.ignoreFileTypes);
  const deepDownload = body.deepDownload === undefined ? false : body.deepDownload;
  if (!channel) return errorJson("A Slack channel name or id is required (e.g. #general).", 400);
  if (!ignoreFileTypes) return errorJson("Unsupported Slack file filter. Supported values: image.", 400);
  if (typeof deepDownload !== "boolean") return errorJson("deepDownload must be a boolean.", 400);

  try {
    const job = startSlackRetrievalJob({
      channel,
      ...(saveDir ? { saveDir } : {}),
      options: { ignoreFileTypes, deepDownload },
    });
    return okJson({ jobId: job.id, job: slackRetrievalJobView(job) });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start Slack retrieval.", 502);
  }
}
