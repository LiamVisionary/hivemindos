// guard:allow-hive-action-route - dashboard scheduler replication fan-out across machine collectors; operator scheduling plumbing.
import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import type { AgentSchedule } from "@/features/dashboard/dashboard-types";
import { applyCronWrite } from "@/lib/services/scheduler/cron-write";
import type { CronMutation } from "@/lib/services/scheduler/hermes-cron-doc";
import {
  hermesCronJobFromSchedule,
  planReplication,
  stableReplicaJobId,
  type ReplicationTarget,
} from "@/features/dashboard/schedule-replication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  schedule?: AgentSchedule;
  designatedMachineId?: string;
  targets?: ReplicationTarget[];
};

/**
 * Fan a machine-scoped schedule across the fleet: upsert its cron on every
 * machine when runOnAllMachines is on, or strip stray copies off the
 * non-designated machines when it's pinned. Each step is applied independently
 * so one unreachable machine doesn't abort the rest — its failure is reported.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Body;
  if (!body.schedule?.id) return errorJson("schedule required");
  const targets = Array.isArray(body.targets) ? body.targets : [];
  const jobId = stableReplicaJobId(body.schedule);
  const steps = planReplication(body.schedule, body.designatedMachineId ?? "", targets);

  const results = await Promise.all(steps.map(async (step) => {
    const mutation: CronMutation = step.action === "upsert"
      ? { action: "upsert", job: hermesCronJobFromSchedule(body.schedule as AgentSchedule, jobId) }
      : { action: "remove", jobId };
    const result = await applyCronWrite({
      collectorUrl: step.target.collectorUrl,
      homeDir: step.target.homeDir,
      mutation,
    });
    return { machineId: step.target.machineId, label: step.target.label ?? "", action: step.action, ...result };
  }));

  return okJson({
    jobId,
    planned: steps.length,
    succeeded: results.filter((result) => result.ok).length,
    results,
  });
}
