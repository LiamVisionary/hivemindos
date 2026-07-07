import type { AgentSchedule } from "@/features/dashboard/dashboard-types";
import type { HermesCronJob } from "@/lib/services/scheduler/hermes-cron-doc";

/**
 * Machine-scoping / fleet replication planning (pure). A schedule is pinned to
 * its designated machine by default; when `runOnAllMachines` is on, the engine
 * keeps a copy of its cron on every machine. All copies share one deterministic
 * job id so replication is idempotent (re-running upserts the same row) and so
 * "remove from the other machines" targets exactly the copies we created.
 */

export type ReplicationTarget = {
  machineId: string;
  collectorUrl?: string;
  homeDir?: string;
  label?: string;
};

export type ReplicationStep = { target: ReplicationTarget; action: "upsert" | "remove" };

/** Marker field stamped on replicated cron jobs so they're identifiable as ours. */
export const REPLICA_MARKER = "hivemindos_replica_of";

/** Deterministic 12-hex id shared by every machine-copy of a loop (FNV-1a, no deps). */
export function stableReplicaJobId(schedule: AgentSchedule): string {
  const underlying = schedule.externalJobId ? schedule.externalJobId.split(":").pop() : "";
  if (underlying && /^[a-f0-9]{6,}$/i.test(underlying)) return underlying.slice(0, 12);
  const seed = schedule.id || schedule.name || "schedule";
  const fnv = (salt: number) => {
    let h = 0x811c9dc5 ^ salt;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return (fnv(0) + fnv(0x9e3779b9)).slice(0, 12);
}

/** Cron/interval schedule block in the shape Hermes stores in jobs.json. */
export function hermesScheduleFromEvery(every: string): Record<string, unknown> {
  const text = (every ?? "").trim();
  if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(text)) {
    return { kind: "cron", expr: text, display: text };
  }
  const interval = text.match(/^(?:every\s+)?(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)$/i);
  if (interval) {
    const n = Number(interval[1]);
    const unit = /^h/i.test(interval[2]) ? "hours" : "minutes";
    return { kind: "interval", every: n, unit, display: text };
  }
  return { kind: "cron", expr: text || "0 8 * * *", display: text || "0 8 * * *" };
}

/** Map a dashboard schedule to a Hermes cron job row for replication. */
export function hermesCronJobFromSchedule(schedule: AgentSchedule, jobId: string): HermesCronJob {
  const enabled = schedule.enabled !== false;
  return {
    id: jobId,
    name: schedule.name,
    prompt: schedule.prompt || schedule.name,
    enabled,
    state: enabled ? "scheduled" : "paused",
    schedule: hermesScheduleFromEvery(schedule.every),
    schedule_display: schedule.every,
    no_agent: false,
    [REPLICA_MARKER]: schedule.id,
  };
}

/**
 * Which machines to write, and how:
 * - runOnAllMachines → upsert the cron on every machine.
 * - pinned (default) → remove the cron from every machine except the designated
 *   one (so toggling off, or importing a schedule that used to fan out, cleans
 *   up the stray copies). The designated machine keeps its own real cron.
 */
export function planReplication(
  schedule: AgentSchedule,
  designatedMachineId: string,
  targets: ReplicationTarget[],
): ReplicationStep[] {
  const withMachine = targets.filter((target) => target.machineId);
  if (schedule.runOnAllMachines) {
    return withMachine.map((target) => ({ target, action: "upsert" as const }));
  }
  return withMachine
    .filter((target) => target.machineId !== designatedMachineId)
    .map((target) => ({ target, action: "remove" as const }));
}

/** Build replication targets from the dashboard's machine groups. */
export function buildReplicationTargets(
  machineGroups: Array<{ machineId?: string; name?: string; collectorUrl?: string }> | undefined,
): ReplicationTarget[] {
  return (machineGroups ?? [])
    .filter((group) => group.machineId)
    .map((group) => ({ machineId: group.machineId as string, collectorUrl: group.collectorUrl, label: group.name }));
}

/** Fire the fleet replication for a schedule (no-op when there's nothing to do). */
export async function triggerScheduleReplication(
  schedule: AgentSchedule,
  targets: ReplicationTarget[],
  designatedMachineId: string,
): Promise<void> {
  if (!planReplication(schedule, designatedMachineId, targets).length) return;
  await fetch("/api/scheduler/replicate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schedule, designatedMachineId, targets }),
  }).catch(() => undefined);
}
