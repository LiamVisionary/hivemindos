import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import { applyCronWrite } from "@/lib/services/scheduler/cron-write";
import type { CronMutation } from "@/lib/services/scheduler/hermes-cron-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  collectorUrl?: string;
  action?: "set-enabled" | "remove" | "upsert";
  jobId?: string;
  enabled?: boolean;
  job?: Record<string, unknown>;
  homeDir?: string;
  session?: string;
};

function mutationFromBody(body: Body): CronMutation | { error: string } {
  if (body.action === "set-enabled") {
    if (!body.jobId) return { error: "jobId required for set-enabled" };
    return { action: "set-enabled", jobId: body.jobId, enabled: body.enabled !== false };
  }
  if (body.action === "remove") {
    if (!body.jobId) return { error: "jobId required for remove" };
    return { action: "remove", jobId: body.jobId };
  }
  if (body.action === "upsert") {
    if (!body.job?.id) return { error: "job.id required for upsert" };
    return { action: "upsert", job: body.job };
  }
  return { error: `unknown action: ${body.action}` };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Body;
  const mutation = mutationFromBody(body);
  if ("error" in mutation) return errorJson(mutation.error);

  const result = await applyCronWrite({
    collectorUrl: body.collectorUrl,
    homeDir: body.homeDir,
    session: body.session,
    mutation,
  });
  return result.ok ? okJson(result) : errorJson(result.error ?? "cron write failed", 502, result);
}
