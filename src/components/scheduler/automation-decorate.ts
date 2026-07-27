// src/components/scheduler/automation-decorate.ts
// Shared, pure decoration for the redesigned Automations route. Turns the real
// SchedulerJob into the view-model the Flight Plan / Simple list / detail panel
// all render from, so status colour, cadence phrasing, and the "next run"
// countdown are derived once and consistently. Nothing here fabricates data:
// jobs with no known upcoming run get null (they simply don't appear on the
// timeline), exactly matching the honest scheduler model.

import { humanizeCadence, type RunStatus, type SchedulerJob } from "./scheduler-data";
import type { SchedulerRunState } from "./SchedulerView";

export type StatusKey = "paused" | "failed" | "warn" | "ok" | "idle";

export interface StatusMeta {
  key: StatusKey;
  /** A CSS var() reference, so the colour stays theme-aware (dark / hive-light). */
  color: string;
  word: string;
}

export function statusMeta(job: Pick<SchedulerJob, "enabled" | "lastRun">): StatusMeta {
  if (!job.enabled) return { key: "paused", color: "var(--muted)", word: "paused" };
  const status: RunStatus = job.lastRun.status;
  if (status === "failed") return { key: "failed", color: "var(--status-failed)", word: "failed" };
  if (status === "warn" || status === "stale") return { key: "warn", color: "var(--status-warn)", word: "stalled" };
  if (status === "ok") return { key: "ok", color: "var(--status-ok)", word: "healthy" };
  return { key: "idle", color: "var(--muted)", word: "idle" };
}

export interface DecoratedJob extends SchedulerJob {
  sc: StatusMeta;
  /** Minutes until the next KNOWN autonomous run, or null (paused / dashboard-only
   *  on-demand / cron with no runtime-provided next-run). */
  nextRunMins: number | null;
  timed: boolean;
  isAttn: boolean;
  running: boolean;
  cadence: string;
  lastLine: string;
}

export function runPhaseOf(runState?: SchedulerRunState) {
  return typeof runState === "string" ? runState : runState?.phase;
}

export function isRunning(runState?: SchedulerRunState) {
  const phase = runPhaseOf(runState);
  return Boolean(phase && phase !== "done");
}

export function decorateJob(job: SchedulerJob, runStates: Record<string, SchedulerRunState>): DecoratedJob {
  const sc = statusMeta(job);
  const nextRunMins = job.enabled && job.nextRunMs != null && job.nextRunMs > 0
    ? Math.max(0, Math.round(job.nextRunMs / 60_000))
    : null;
  return {
    ...job,
    sc,
    nextRunMins,
    timed: nextRunMins != null,
    isAttn: job.enabled && (job.lastRun.status === "failed" || job.lastRun.status === "warn" || job.lastRun.status === "stale"),
    running: isRunning(runStates[job.id]),
    cadence: humanizeCadence(job.cron, job.cronLabel),
    lastLine: job.lastRun.at === "not run yet" || job.lastRun.at === "never"
      ? "never run"
      : `${sc.word} · ${job.lastRun.at}`,
  };
}

/** Wall-clock label (HH:MM local) for a job's next run, or a short honest token
 *  when there's no known departure time. */
export function departureClock(job: DecoratedJob, now: number): string {
  if (job.nextRunMins == null) return "—";
  const at = new Date(now + job.nextRunMins * 60_000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Short relative phrase for the departure sub-label. */
export function departureRel(job: DecoratedJob): string {
  if (job.nextRunMins != null) return relLabel(job.nextRunMins);
  if (!job.enabled) return "paused";
  return job.external ? "scheduled" : "on demand";
}

export function relLabel(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${Math.round(mins / 1440)}d`;
}

export function nextRunBig(job: DecoratedJob): string {
  if (!job.enabled) return "paused";
  if (job.nextRunMins != null) return relLabel(job.nextRunMins);
  return job.external ? "scheduled" : "on demand";
}
