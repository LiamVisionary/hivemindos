import type { BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";

export type RunStatus = "ok" | "warn" | "failed" | "stale" | "idle";

export interface JobRun { status: RunStatus; at: string; dur: string; }
export interface SchedulerJob {
  id: string;
  name: string;
  description: string;
  cron: string;
  cronLabel: string;
  runtime: string;
  machine: string;
  bee: string;
  /** Assigned agent's bee role/class — drives the role-accurate bee icon in the
   *  Automations UI. Absent when the schedule's agent can't be resolved. */
  beeRole?: BeeAgentRole;
  workerClass?: BeeWorkerClass;
  enabled: boolean;
  nextRun: string;          // "in 23m", "paused", etc.
  nextRunISO: string;
  lastRun: JobRun;
  history: JobRun[];
  tags: string[];
  /** True when an external runtime (Hermes/Aeon) owns a real cron job for this
   *  automation. Dashboard-only schedules (false) have no autonomous executor —
   *  the UI labels them honestly rather than implying they fire on their own. */
  external?: boolean;
  externalRuntimeLabel?: string;
  /** True only when `nextRun` came from a runtime-provided next-run timestamp.
   *  When false, any interval-derived countdown is a guess we must not present
   *  as an authoritative "next in X" for external runtimes. */
  nextRunKnown?: boolean;
  /** Milliseconds until the next run (for sorting nearest-upcoming first).
   *  null when there is no upcoming run to order by (paused, or no cadence). */
  nextRunMs?: number | null;
}

/** One real archived run, parsed from the shared-vault run notes. Distinct from
 *  the single synthetic `SchedulerJob.history` entry — this is the true history. */
export interface SchedulerRunHistoryEntry {
  id: string;
  runNumber?: number;
  status: RunStatus;
  at: string | null;
  atLabel: string;
  summary: string;
}

export function minutesFromLabel(s: string | null | undefined): number | null {
  if (!s || s === "paused") return null;
  const re = /(\d+)\s*([hm])/g;
  let m: RegExpExecArray | null, total = 0;
  while ((m = re.exec(s))) total += parseInt(m[1], 10) * (m[2] === "h" ? 60 : 1);
  return total || null;
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function humanizeDayList(field: string): string {
  const parts = field.split(",").flatMap((chunk) => {
    const range = chunk.match(/^(\d)-(\d)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      const out: number[] = [];
      for (let d = lo; d <= hi; d += 1) out.push(d % 7);
      return out;
    }
    const n = Number(chunk);
    return Number.isFinite(n) ? [n % 7] : [];
  });
  const uniq = [...new Set(parts)].sort((a, b) => a - b);
  if (uniq.length === 7) return "every day";
  if (uniq.length === 5 && [1, 2, 3, 4, 5].every((d) => uniq.includes(d))) return "weekdays";
  if (uniq.length === 2 && uniq.includes(0) && uniq.includes(6)) return "weekends";
  return uniq.map((d) => DOW_NAMES[d]).join(", ");
}

/** Turn a raw `every` value (interval like "15m"/"2h" OR a 5-field cron) into a
 *  friendly, honest cadence label for the Automations UI. Falls back to the raw
 *  string when it can't be parsed, so nothing is ever silently misrepresented. */
export function humanizeCadence(every: string | null | undefined, fallback?: string): string {
  const raw = (every ?? "").trim();
  if (!raw) return fallback ?? "custom";
  if (raw === "manual") return "On demand";
  const interval = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (interval) {
    const value = Number(interval[1]);
    const unit = interval[2].toLowerCase();
    if (unit === "d") return `Every ${value}d`;
    if (unit === "h") return `Every ${value}h`;
    if (unit === "m") return `Every ${value}m`;
    if (unit === "s") return `Every ${value}s`;
    return `Every ${value}ms`;
  }
  const cron = raw.split(/\s+/);
  if (cron.length === 5) {
    const [min, hour, dom, , dow] = cron;
    const at = (h: string, m: string) =>
      `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    // */N minutes
    const everyMin = min.match(/^\*\/(\d+)$/);
    if (everyMin && hour === "*" && dom === "*" && dow === "*") return `Every ${everyMin[1]}m`;
    // 0 */N * * *  → every N hours
    const everyHour = hour.match(/^\*\/(\d+)$/);
    if (min === "0" && everyHour && dom === "*" && dow === "*") return `Every ${everyHour[1]}h`;
    // fixed time, specific days
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      if (dom === "*" && dow !== "*") return `${cap(humanizeDayList(dow))} at ${at(hour, min)}`;
      if (dom === "*" && dow === "*") return `Every day at ${at(hour, min)}`;
      return `At ${at(hour, min)}`;
    }
  }
  return fallback ?? raw;
}

function cap(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
