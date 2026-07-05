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
  const enabled = schedules.filter((schedule) => schedule.enabled);

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
