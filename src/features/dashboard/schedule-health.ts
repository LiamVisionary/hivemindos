import type { AgentSchedule } from "@/features/dashboard/dashboard-types";

/**
 * Brain-loop health over the schedules the dashboard already holds: catches
 * the two silent failure modes found in the 2026-07-05 automation audit —
 * duplicate ENABLED schedules fighting each other (Daily Hive Pulse fired
 * twice at 08:00 for weeks), and enabled-but-dead loops (Weekly Synthesis
 * sat "enabled" with no output for six weeks). Pure functions so the check
 * runs identically in browser, desktop static builds, and hermetic tests.
 */

export type ScheduleHealthWarning = {
  kind: "duplicate" | "stale" | "never-ran";
  scheduleIds: string[];
  title: string;
  detail: string;
};

/**
 * Stable identity for a warning, used both as the React key and as the token a
 * user's dismissal is stored against. Keyed by kind + the schedules involved so
 * a dismissed warning stays hidden while a genuinely new one (different loops)
 * still surfaces.
 */
export function scheduleHealthWarningKey(warning: ScheduleHealthWarning): string {
  return `${warning.kind}-${warning.scheduleIds.join("-")}`;
}

/** Warnings the user hasn't dismissed, given the set of dismissed keys. */
export function visibleScheduleHealthWarnings(
  warnings: ScheduleHealthWarning[],
  dismissedKeys: ReadonlySet<string>,
): ScheduleHealthWarning[] {
  return warnings.filter((warning) => !dismissedKeys.has(scheduleHealthWarningKey(warning)));
}

/** Rough interval for a cadence string; null when unknowable (e.g. "manual"). */
export function scheduleCadenceMs(every: string | undefined): number | null {
  const text = (every ?? "").trim().toLowerCase();
  if (!text || text === "manual" || text === "custom") return null;
  const minutes = text.match(/^(?:every\s+)?(\d+)\s*(m|min|minute|minutes)$/);
  if (minutes) return Number(minutes[1]) * 60_000;
  const hours = text.match(/^(?:every\s+)?(\d+)\s*(h|hr|hour|hours)$/);
  if (hours) return Number(hours[1]) * 3_600_000;
  const everyUnit = text.match(/^every\s+(\d+)\s+(minute|hour|day|week)s?$/);
  if (everyUnit) {
    const n = Number(everyUnit[1]);
    const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[everyUnit[2] as "minute" | "hour" | "day" | "week"];
    return n * unit;
  }
  if (text.startsWith("daily")) return 86_400_000;
  if (text.startsWith("weekly")) return 604_800_000;
  if (text.startsWith("monthly")) return 30 * 86_400_000;
  // cron: "m h * * *" daily, "m h * * D" weekly
  const cron = text.match(/^\S+\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (cron) {
    if (cron[1] === "*" && cron[2] === "*" && cron[3] === "*") return 86_400_000;
    if (cron[1] === "*" && cron[2] === "*") return 604_800_000;
    return 30 * 86_400_000;
  }
  return null;
}

/** Normalized key used to spot the same loop wearing different names. */
export function normalizedLoopKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Stable signature for the underlying loop a schedule drives — runtime +
 * underlying job id (the trailing segment of externalJobId) + normalized name.
 * A machine's hostname churn mints a fresh per-machine `externalJobId` prefix
 * for the SAME physical cron job, so the raw schedule id can't dedupe them;
 * this signature can (the NYC MacBook forked its watchdog into 5 enabled rows
 * that all shared underlying job id 567853dca5a5).
 */
export function scheduleLoopSignature(schedule: AgentSchedule): string {
  if (!schedule.externalJobId) return `id::${schedule.id}`;
  const source = schedule.externalSource ?? "dashboard";
  const jobId = schedule.externalJobId.split(":").pop() || schedule.externalJobId;
  // Agent-aware: the SAME underlying job armed on DIFFERENT agents (e.g. an Aeon
  // skill seeded onto aeon-9 and aeon-10) is TWO automations and must not merge.
  // Hostname-rename forks of one agent keep the same agentId, so they still
  // collapse (the machine segment of externalJobId churns, agentId does not).
  return `${source}::${jobId}::${normalizedLoopKey(schedule.name)}::${schedule.agentId || ""}`;
}

/**
 * Which fork's identity survives: the live one (most-recently updated — i.e.
 * the identity currently being re-imported), tie-broken by having a real run.
 * The run stamp itself is merged separately, so a stale identity holding the
 * only recorded run still donates it to the survivor.
 */
function isFresherSchedule(candidate: AgentSchedule, incumbent: AgentSchedule): boolean {
  const candidateUpdated = candidate.updatedAt ?? 0;
  const incumbentUpdated = incumbent.updatedAt ?? 0;
  if (candidateUpdated !== incumbentUpdated) return candidateUpdated > incumbentUpdated;
  return (candidate.lastRunAt ?? 0) > (incumbent.lastRunAt ?? 0);
}

/**
 * Collapse schedules that describe the same underlying loop into one row,
 * keeping the freshest and carrying the newest run stamp / vault links forward
 * so a real last-run survives the collapse. Preserves first-seen order. Pure so
 * it runs identically in the browser, desktop static builds, and hermetic tests.
 */
export function dedupeSchedulesByLoop(schedules: AgentSchedule[]): AgentSchedule[] {
  const bySignature = new Map<string, AgentSchedule>();
  const order: string[] = [];
  for (const schedule of schedules) {
    const signature = scheduleLoopSignature(schedule);
    const incumbent = bySignature.get(signature);
    if (!incumbent) {
      bySignature.set(signature, schedule);
      order.push(signature);
      continue;
    }
    const winner = isFresherSchedule(schedule, incumbent) ? schedule : incumbent;
    const loser = winner === incumbent ? schedule : incumbent;
    bySignature.set(signature, {
      ...winner,
      lastRunAt: Math.max(winner.lastRunAt ?? 0, loser.lastRunAt ?? 0) || winner.lastRunAt,
      lastStatus: winner.lastStatus ?? loser.lastStatus,
      lastSummary: winner.lastSummary ?? loser.lastSummary,
      sharedSchedulePath: winner.sharedSchedulePath ?? loser.sharedSchedulePath,
      sharedRunFolder: winner.sharedRunFolder ?? loser.sharedRunFolder,
    });
  }
  return order.map((signature) => bySignature.get(signature) as AgentSchedule);
}

/**
 * The identity a runtime schedule was imported from — the machine/agent segment
 * of its externalJobId (`hermes:<owner>:jobs.json:<jobId>` → `<owner>`), or null
 * for dashboard-native schedules that carry no external job.
 */
export function scheduleOwnerId(schedule: AgentSchedule): string | null {
  if (!schedule.externalJobId) return null;
  const parts = schedule.externalJobId.split(":");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/**
 * Drop runtime schedules whose owning identity is gone from the fleet — hostname
 * churn and deleted crons leave rows pointing at identities no live agent claims,
 * which then read as enabled-but-dead forever. Conservatively gated: never prunes
 * when the known set is empty (an unpopulated fleet snapshot must not nuke real
 * rows) and never touches dashboard-native schedules (no owner). Pass the union
 * of every live/known agent identity plus the owners seen in the latest import.
 */
export function dropOrphanScheduleRows(
  schedules: AgentSchedule[],
  knownOwnerIds: ReadonlySet<string>,
): AgentSchedule[] {
  if (!knownOwnerIds.size) return schedules;
  return schedules.filter((schedule) => {
    const owner = scheduleOwnerId(schedule);
    if (!owner) return true;
    return knownOwnerIds.has(owner);
  });
}

/**
 * Reconcile against a fresh import: when a machine's collector was reached this
 * round (its owner id appears in `reachedOwnerIds`), any still-stored runtime
 * schedule for that owner that the collector did NOT report (`freshExternalIds`)
 * is a deleted cron — drop it. Owners we did NOT reach are left untouched, so an
 * offline machine never loses its schedules. This catches the "live agent, dead
 * cron" ghost that owner-existence alone (dropOrphanScheduleRows) can't.
 */
export function reconcileReachedOwners(
  schedules: AgentSchedule[],
  reachedOwnerIds: ReadonlySet<string>,
  freshExternalIds: ReadonlySet<string>,
): AgentSchedule[] {
  if (!reachedOwnerIds.size) return schedules;
  return schedules.filter((schedule) => {
    if (!schedule.externalSource) return true;
    const owner = scheduleOwnerId(schedule);
    if (!owner || !reachedOwnerIds.has(owner)) return true;
    const externalId = schedule.externalJobId ? `${schedule.externalSource}:${schedule.externalJobId}` : schedule.id;
    return freshExternalIds.has(externalId);
  });
}

/**
 * Full cleanup for a fresh runtime import: collapse hostname-fork duplicates,
 * drop rows whose owning identity is gone from the fleet, and reconcile away
 * deleted crons for the machines we actually reached. One entry point so the
 * scheduler controller stays a thin caller (and the whole pipeline is tested).
 */
export function cleanImportedSchedules(
  schedules: AgentSchedule[],
  fleet: { agentIds: Array<string | undefined>; jobs: Array<{ runtime: string; id: string }> },
): AgentSchedule[] {
  const knownOwnerIds = new Set<string>(fleet.agentIds.filter((id): id is string => Boolean(id)));
  const reachedOwnerIds = new Set<string>();
  const freshExternalIds = new Set<string>();
  for (const job of fleet.jobs) {
    const owner = String(job.id ?? "").split(":")[1];
    if (owner) { knownOwnerIds.add(owner); reachedOwnerIds.add(owner); }
    freshExternalIds.add(`${job.runtime}:${job.id}`);
  }
  return reconcileReachedOwners(
    dropOrphanScheduleRows(dedupeSchedulesByLoop(schedules), knownOwnerIds),
    reachedOwnerIds,
    freshExternalIds,
  );
}

/**
 * Collapse the per-machine copies of a `runOnAllMachines` loop into a single
 * representative (keyed by normalized name) so an intended fleet-wide fan-out
 * isn't read as a pile of duplicates. Machine-pinned schedules pass through
 * untouched, so accidental cross-machine same-name loops still surface.
 */
export function collapseAllMachinesReplicas(schedules: AgentSchedule[]): AgentSchedule[] {
  const seen = new Set<string>();
  const out: AgentSchedule[] = [];
  for (const schedule of schedules) {
    if (schedule.runOnAllMachines) {
      const key = normalizedLoopKey(schedule.name);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
    }
    out.push(schedule);
  }
  return out;
}

const MIN_PREFIX_GROUP_LENGTH = 10;
const STALE_SLACK_MS = 6 * 3_600_000;

function scheduleLabel(schedule: AgentSchedule): string {
  return schedule.name || schedule.id;
}

export function computeScheduleHealthWarnings(
  schedules: AgentSchedule[],
  now: number,
): ScheduleHealthWarning[] {
  const warnings: ScheduleHealthWarning[] = [];
  const enabled = collapseAllMachinesReplicas(schedules.filter((schedule) => schedule.enabled));

  // Duplicates: exact normalized-name collisions, plus one enabled loop's
  // name being a long prefix of another's (daily-hive-pulse vs
  // daily-hive-pulse-base-ai-agents).
  const byKey = new Map<string, AgentSchedule[]>();
  for (const schedule of enabled) {
    const key = normalizedLoopKey(schedule.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), schedule]);
  }
  const keys = [...byKey.keys()].sort();
  const grouped = new Map<string, Set<AgentSchedule>>();
  for (const key of keys) {
    const root = keys.find((candidate) => (
      candidate.length >= MIN_PREFIX_GROUP_LENGTH && key !== candidate && key.startsWith(candidate)
    )) ?? key;
    const group = grouped.get(root) ?? new Set<AgentSchedule>();
    for (const schedule of byKey.get(key) ?? []) group.add(schedule);
    grouped.set(root, group);
  }
  for (const [root, group] of grouped) {
    if (group.size < 2) continue;
    const members = [...group];
    warnings.push({
      kind: "duplicate",
      scheduleIds: members.map((schedule) => schedule.id),
      title: `${members.length} enabled schedules look like the same loop (${root})`,
      detail: `${members.map(scheduleLabel).join(", ")} are all enabled. Keep one owner and disable the rest so they stop fighting over the same outputs.`,
    });
  }

  // Staleness: an enabled loop whose last recorded run is far older than its
  // cadence, or which has never recorded a run at all.
  for (const schedule of enabled) {
    const cadence = scheduleCadenceMs(schedule.every);
    if (!cadence) continue;
    const staleAfter = Math.max(2 * cadence, cadence + STALE_SLACK_MS);
    if (schedule.lastRunAt) {
      if (now - schedule.lastRunAt > staleAfter) {
        const days = Math.round((now - schedule.lastRunAt) / 86_400_000);
        warnings.push({
          kind: "stale",
          scheduleIds: [schedule.id],
          title: `${scheduleLabel(schedule)} is enabled but has not run in ${days} day${days === 1 ? "" : "s"}`,
          detail: `Its cadence is "${schedule.every}". Check the owning runtime/agent, or disable it so it stops reading as active.`,
        });
      }
    } else if (now - (schedule.updatedAt || schedule.createdAt || now) > staleAfter) {
      warnings.push({
        kind: "never-ran",
        scheduleIds: [schedule.id],
        title: `${scheduleLabel(schedule)} is enabled but has no recorded runs`,
        detail: `Enabled since ${new Date(schedule.updatedAt || schedule.createdAt).toLocaleDateString()} with cadence "${schedule.every}" and no run has ever been recorded. It may be silently dead.`,
      });
    }
  }

  return warnings;
}
