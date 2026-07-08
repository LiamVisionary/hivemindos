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
