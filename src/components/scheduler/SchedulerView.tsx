// src/components/scheduler/SchedulerView.tsx
"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { runtimeScheduleFilterOptions } from "@/lib/types/agent-runtime";

import { BeeIcon } from "./bee-icon";
import { Composer } from "./composer";
import { HexTile } from "./hex-tile";
import { Jobs } from "./jobs";
import { Timeline } from "./timeline";
import type { TimelineRange } from "./timeline";
import { SCH_JOBS, SCH_TEMPLATES, type SchedulerJob } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

export type SchedulerRunPhase = "running" | "assigned" | "thinking" | "executing" | "wrapping" | "done";
type ScheduleRuntimeFilter = "all" | (string & {});
type ScheduleRuntimeOption = { value: ScheduleRuntimeFilter; label: string };

export type SchedulerRunState = SchedulerRunPhase | {
  phase: SchedulerRunPhase;
  label?: string;
};

interface SchedulerViewProps {
  jobs?: SchedulerJob[];
  runStates?: Record<string, SchedulerRunState>;
  onToggleJob?: (j: SchedulerJob) => void;
  onRunNow?: (j: SchedulerJob) => void;
  onEditJob?: (j: SchedulerJob) => void;
  onNewJob?: () => void;
  toolbar?: React.ReactNode;
  /** When set, the runtime filter is forced to this value and the runtime toggle is hidden. */
  lockedRuntime?: ScheduleRuntimeFilter;
  lockedRuntimeLabel?: string;
  runtimeOptions?: ScheduleRuntimeOption[];
}

export function SchedulerView({
  jobs: initialJobs = SCH_JOBS,
  runStates = {},
  onToggleJob,
  onRunNow,
  onEditJob,
  onNewJob,
  toolbar,
  lockedRuntime,
  lockedRuntimeLabel,
  runtimeOptions: runtimeOptionsProp,
}: SchedulerViewProps = {}) {
  const [selectedId, setSelectedId] = React.useState<string>(initialJobs[0]?.id ?? "");
  const [timelineRange, setTimelineRange] = React.useState<TimelineRange>("24h");
  const [runtimeFilter, setRuntimeFilter] = React.useState<ScheduleRuntimeFilter>(lockedRuntime ?? "all");
  const effectiveFilter = lockedRuntime ?? runtimeFilter;
  const normalizedEffectiveFilter = effectiveFilter.trim().toLowerCase();
  const runtimeOptions = React.useMemo<ScheduleRuntimeOption[]>(() => {
    if (runtimeOptionsProp?.length) return runtimeOptionsProp;
    return [
      { value: "all", label: "All" },
      ...runtimeScheduleFilterOptions(),
    ];
  }, [runtimeOptionsProp]);
  const labelForRuntime = React.useCallback((runtime: ScheduleRuntimeFilter) => {
    const normalizedRuntime = runtime.trim().toLowerCase();
    if (runtime === lockedRuntime && lockedRuntimeLabel) return lockedRuntimeLabel;
    return runtimeOptions.find((option) => option.value.trim().toLowerCase() === normalizedRuntime)?.label ?? runtime;
  }, [lockedRuntime, lockedRuntimeLabel, runtimeOptions]);
  const effectiveFilterLabel = labelForRuntime(effectiveFilter);
  const jobs = React.useMemo(() => (
    normalizedEffectiveFilter !== "all"
      ? initialJobs.filter((job) => job.runtime.trim().toLowerCase() === normalizedEffectiveFilter)
      : initialJobs
  ), [initialJobs, normalizedEffectiveFilter]);
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0];
  const effectiveSelectedId = selected?.id ?? "";
  const timelineLabel = timelineRange === "24h" ? "next 24 hours" : timelineRange === "week" ? "next 7 days" : "next 30 days";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });

  const toggleJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    onToggleJob?.({ ...job, enabled: !job.enabled, nextRun: job.enabled ? "paused" : job.nextRun });
  };

  // Empty because of the runtime filter, not because there are no schedules at all.
  const filteredEmpty = normalizedEffectiveFilter !== "all" && initialJobs.length > 0;
  const runtimeControls = lockedRuntime ? (
    <span className={styles.schedulerLockedRuntime}>{effectiveFilterLabel} schedules</span>
  ) : (
    runtimeOptions.map(({ value, label }) => {
      const active = runtimeFilter === value;
      return (
        <button
          key={value}
          type="button"
          data-scheduler-filter={value}
          aria-label={`Show ${label} schedules`}
          aria-pressed={active}
          className="uppercase cursor-pointer"
          onClick={() => setRuntimeFilter(value)}
          style={{
            fontFamily: "var(--f-mono)", fontSize: 10, padding: "5px 12px", borderRadius: 999,
            background: active ? "rgba(255,212,90,0.13)" : "rgba(148,163,184,0.04)",
            color: active ? "var(--foreground)" : "var(--muted)",
            border: `1px solid ${active ? "rgba(255,212,90,0.42)" : "rgba(148,163,184,0.16)"}`,
            letterSpacing: 0.1,
          }}
        >
          {label}
        </button>
      );
    })
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className={`${styles.root} relative overflow-hidden`} style={{
        width: "100%", height: "100%", maxHeight: "100dvh", flex: "1 1 auto", minHeight: 0,
        background: "var(--background)", color: "var(--foreground)",
        fontFamily: "var(--f-display), system-ui, sans-serif",
        display: "grid", gridTemplateRows: "minmax(0, 1fr)",
      }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,212,90,0.10), transparent 50%)," +
            "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.08), transparent 50%)",
        }} />

        {/* BODY */}
        {selected ? <div className={`${styles.schedulerBody} relative z-10`}>
          <Jobs jobs={jobs} selectedId={effectiveSelectedId}
            onSelect={setSelectedId} onToggle={toggleJob} onNewJob={onNewJob}
            controls={runtimeControls} />

          <section className="grid overflow-hidden" style={{
            minWidth: 0, minHeight: 0,
            padding: "20px 28px 28px", gap: 16, gridTemplateRows: "auto minmax(0, 1fr)",
          }}>
            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14 }}>
              <div className="grid" style={{ gap: 7, minWidth: 0 }}>
                <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>
                  <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "#2dd4bf" }} />
                  &nbsp; Automations · {timelineLabel}
                </div>
                <div className={`${styles.schedulerMetaInline} uppercase`}>
                  {today} · cron · <span>synced</span>
                </div>
              </div>
              <div className={styles.schedulerTimelineToolbar}>
                {toolbar ? <div className={styles.schedulerToolbarSlot}>{toolbar}</div> : null}
                <div className={styles.schedulerRangeGroup}>
                  {(["24h", "week", "month"] as TimelineRange[]).map((value) => {
                    const active = timelineRange === value;
                    return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className="uppercase cursor-pointer"
                      onClick={() => setTimelineRange(value)}
                      style={{
                        fontFamily: "var(--f-mono)", fontSize: 10, padding: "5px 10px", borderRadius: 999,
                        background: active ? "rgba(45,212,191,0.12)" : "transparent",
                        color: active ? "var(--foreground)" : "var(--muted)",
                        border: `1px solid ${active ? "rgba(94,234,212,0.42)" : "rgba(148,163,184,0.16)"}`,
                        letterSpacing: 0.1,
                      }}
                    >
                      {value}
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className={styles.schedulerTimelineScroll}>
              <Timeline jobs={jobs} selectedId={effectiveSelectedId} range={timelineRange} onSelect={setSelectedId} />
            </div>
          </section>

          <Composer job={selected} templates={SCH_TEMPLATES}
            runState={runStates[selected.id]}
            onRunNow={() => onRunNow?.(selected)}
            onEdit={() => onEditJob?.(selected)} />
        </div> : (
          <div className="relative z-10 grid place-items-center" style={{ minHeight: 0, height: "100%", padding: 28 }}>
            <div className="grid place-items-center text-center" style={{
              gap: 10, maxWidth: 420, padding: 28, borderRadius: 14,
              border: "1px dashed var(--hex-add-stroke)",
              background: "var(--panel-bg-soft)",
            }}>
              <HexTile size={58} tone="honey"><BeeIcon role="queen" size={34} /></HexTile>
              <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>
                {filteredEmpty ? `No ${effectiveFilterLabel} schedules` : "No schedules yet"}
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                {filteredEmpty
                  ? lockedRuntime
                    ? `Nothing scheduled on the ${effectiveFilterLabel} runtime yet. Schedule a new task or import existing ${effectiveFilterLabel} schedules to populate the dispatch rail.`
                    : `Nothing scheduled on the ${effectiveFilterLabel} runtime yet. Switch to All to see your other automations, or import existing ${effectiveFilterLabel} schedules.`
                  : "Import existing runtime schedules or create a new task to populate the dispatch rail."}
              </p>
              {onNewJob ? (
                <button type="button" onClick={onNewJob} className="uppercase font-bold cursor-pointer" style={{
                  marginTop: 6, padding: "9px 12px", borderRadius: 7,
                  border: "1px solid rgba(94,234,212,0.55)",
                  background: "rgba(45,212,191,0.18)", color: "var(--hex-active-border)",
                  fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: 0.06,
                }}>
                  Schedule new task
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
