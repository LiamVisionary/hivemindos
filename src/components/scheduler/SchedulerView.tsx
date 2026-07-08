// src/components/scheduler/SchedulerView.tsx
"use client";

import * as React from "react";
import { CalendarClock, List as ListIcon, Search } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { runtimeScheduleFilterOptions } from "@/lib/types/agent-runtime";

import { BeeIcon } from "./bee-icon";
import { Composer } from "./composer";
import { HexTile } from "./hex-tile";
import { AutomationList } from "./jobs";
import { Timeline } from "./timeline";
import type { TimelineRange } from "./timeline";
import type { SchedulerJob, SchedulerRunHistoryEntry } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

export type SchedulerRunPhase = "running" | "assigned" | "thinking" | "executing" | "wrapping" | "done";
type ScheduleRuntimeFilter = "all" | (string & {});
type ScheduleRuntimeOption = { value: ScheduleRuntimeFilter; label: string };
type StatusFilter = "all" | "active" | "paused" | "failed" | "stale";

export type SchedulerRunState = SchedulerRunPhase | {
  phase: SchedulerRunPhase;
  label?: string;
};

interface SchedulerViewProps {
  jobs: SchedulerJob[];
  runStates?: Record<string, SchedulerRunState>;
  onToggleJob?: (j: SchedulerJob) => void;
  onRunNow?: (j: SchedulerJob) => void;
  onEditJob?: (j: SchedulerJob) => void;
  onDuplicateJob?: (j: SchedulerJob) => void;
  onDeleteJob?: (j: SchedulerJob) => void;
  onNewJob?: () => void;
  fetchHistory?: (j: SchedulerJob) => Promise<SchedulerRunHistoryEntry[]>;
  toolbar?: React.ReactNode;
  /** When set, the runtime filter is forced to this value and the toggle is hidden. */
  lockedRuntime?: ScheduleRuntimeFilter;
  lockedRuntimeLabel?: string;
  runtimeOptions?: ScheduleRuntimeOption[];
}

// No "Stale" chip: the mapper never emits lastRun.status === "stale" (it folds
// stale into warn and only ok/failed are ever written), so filtering to it would
// always show an empty list. Only reachable statuses get a chip.
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "failed", label: "Failed" },
];

function matchesStatus(job: SchedulerJob, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return job.enabled;
  if (filter === "paused") return !job.enabled;
  return job.lastRun.status === filter;
}

export function SchedulerView({
  jobs: allJobs,
  runStates = {},
  onToggleJob,
  onRunNow,
  onEditJob,
  onDuplicateJob,
  onDeleteJob,
  onNewJob,
  fetchHistory,
  toolbar,
  lockedRuntime,
  lockedRuntimeLabel,
  runtimeOptions: runtimeOptionsProp,
}: SchedulerViewProps) {
  const [selectedId, setSelectedId] = React.useState<string>(allJobs[0]?.id ?? "");
  const [viewMode, setViewMode] = React.useState<"list" | "timeline">("list");
  const [timelineRange, setTimelineRange] = React.useState<TimelineRange>("24h");
  const [runtimeFilter, setRuntimeFilter] = React.useState<ScheduleRuntimeFilter>(lockedRuntime ?? "all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");

  const effectiveRuntime = (lockedRuntime ?? runtimeFilter).trim().toLowerCase();
  const runtimeOptions = React.useMemo<ScheduleRuntimeOption[]>(() => (
    runtimeOptionsProp?.length ? runtimeOptionsProp : [{ value: "all", label: "All" }, ...runtimeScheduleFilterOptions()]
  ), [runtimeOptionsProp]);

  const labelForRuntime = React.useCallback((runtime: ScheduleRuntimeFilter) => {
    const normalized = runtime.trim().toLowerCase();
    if (runtime === lockedRuntime && lockedRuntimeLabel) return lockedRuntimeLabel;
    return runtimeOptions.find((o) => o.value.trim().toLowerCase() === normalized)?.label ?? runtime;
  }, [lockedRuntime, lockedRuntimeLabel, runtimeOptions]);

  const jobs = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = allJobs.filter((job) => {
      if (effectiveRuntime !== "all" && job.runtime.trim().toLowerCase() !== effectiveRuntime) return false;
      if (!matchesStatus(job, statusFilter)) return false;
      if (!needle) return true;
      const hay = `${job.name} ${job.bee} ${job.machine} ${job.runtime} ${job.cronLabel} ${job.tags.join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
    // Nearest upcoming run first; jobs with no upcoming time (paused / no cadence)
    // sink to the bottom, ordered by name for stability.
    return filtered.slice().sort((a, b) => {
      const am = a.nextRunMs, bm = b.nextRunMs;
      if (am != null && bm != null) return am - bm || a.name.localeCompare(b.name);
      if (am != null) return -1;
      if (bm != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allJobs, effectiveRuntime, statusFilter, query]);

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0];
  const effectiveSelectedId = selected?.id ?? "";
  const activeCount = allJobs.filter((j) => j.enabled).length;
  const isFiltered = effectiveRuntime !== "all" || statusFilter !== "all" || query.trim().length > 0;

  const runtimeChips = lockedRuntime ? (
    <span className={styles.schedulerLockedRuntime}>{labelForRuntime(effectiveRuntime)} schedules</span>
  ) : (
    <div className={styles.schedChipRow} role="group" aria-label="Filter by runtime">
      {runtimeOptions.map(({ value, label }) => (
        <button key={value} type="button" aria-pressed={runtimeFilter === value}
          className={`${styles.schedChip} ${runtimeFilter === value ? styles.schedChipActive : ""}`}
          onClick={() => setRuntimeFilter(value)}>{label}</button>
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className={`${styles.root} relative overflow-hidden`} style={{
        width: "100%", height: "100%", maxHeight: "100dvh", minHeight: 0,
        background: "var(--background)", color: "var(--foreground)",
        fontFamily: "var(--f-display), system-ui, sans-serif",
        display: "grid", gridTemplateRows: "minmax(0, 1fr)",
      }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,212,90,0.08), transparent 50%)," +
            "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.06), transparent 50%)",
        }} />

        <div className={`${selected ? styles.schedLayout : styles.schedLayoutSolo} relative z-10`}>
          <div className={styles.schedMain}>
            {/* Toolbar: search + filters + view toggle */}
            <div className={styles.schedToolbar}>
              <div className={styles.schedSearch}>
                <Search size={14} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search automations"
                  aria-label="Search automations"
                />
              </div>
              {runtimeChips}
              <div className={styles.schedChipRow} role="group" aria-label="Filter by status">
                {STATUS_FILTERS.map(({ value, label }) => (
                  <button key={value} type="button" aria-pressed={statusFilter === value}
                    className={`${styles.schedChip} ${statusFilter === value ? styles.schedChipActive : ""}`}
                    onClick={() => setStatusFilter(value)}>{label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto" }}>
                {toolbar ? <div className={styles.schedulerToolbarSlot}>{toolbar}</div> : null}
                <div className={styles.schedSegment} role="group" aria-label="View mode">
                  <button type="button" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
                    <ListIcon size={13} aria-hidden /> List
                  </button>
                  <button type="button" aria-pressed={viewMode === "timeline"} onClick={() => setViewMode("timeline")}>
                    <CalendarClock size={13} aria-hidden /> Timeline
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            {allJobs.length === 0 ? (
              <EmptyState onNewJob={onNewJob} filtered={false} runtimeLabel="" />
            ) : jobs.length === 0 ? (
              <EmptyState onNewJob={onNewJob} filtered runtimeLabel={labelForRuntime(effectiveRuntime)} />
            ) : viewMode === "timeline" ? (
              <div className={styles.schedulerTimelineScroll} style={{ padding: "14px 20px 20px" }}>
                <div className={styles.schedulerRangeGroup} style={{ marginBottom: 12 }}>
                  {(["24h", "week", "month"] as TimelineRange[]).map((value) => (
                    <button key={value} type="button" aria-pressed={timelineRange === value}
                      className={`${styles.schedChip} ${timelineRange === value ? styles.schedChipActive : ""}`}
                      onClick={() => setTimelineRange(value)}>{value}</button>
                  ))}
                </div>
                <Timeline jobs={jobs} selectedId={effectiveSelectedId} range={timelineRange} onSelect={setSelectedId} />
              </div>
            ) : (
              <AutomationList
                jobs={jobs}
                selectedId={effectiveSelectedId}
                runStates={runStates}
                onSelect={setSelectedId}
                onToggle={(id) => { const j = jobs.find((x) => x.id === id); if (j) onToggleJob?.(j); }}
                onRunNow={(j) => onRunNow?.(j)}
                onEdit={(j) => onEditJob?.(j)}
                onDuplicate={(j) => onDuplicateJob?.(j)}
                onDelete={(j) => onDeleteJob?.(j)}
                onNewJob={onNewJob}
              />
            )}
          </div>

          {selected ? (
            <Composer
              job={selected}
              runState={runStates[selected.id]}
              fetchHistory={fetchHistory}
              onRunNow={() => onRunNow?.(selected)}
              onEdit={() => onEditJob?.(selected)}
              onDuplicate={() => onDuplicateJob?.(selected)}
              onDelete={() => onDeleteJob?.(selected)}
            />
          ) : null}
        </div>
      </div>
      {/* isFiltered kept legible for a11y readers of the count */}
      <span className="sr-only" aria-live="polite">{isFiltered ? `${jobs.length} of ${allJobs.length} automations, ${activeCount} active` : `${allJobs.length} automations, ${activeCount} active`}</span>
    </TooltipProvider>
  );
}

function EmptyState({ onNewJob, filtered, runtimeLabel }: { onNewJob?: () => void; filtered: boolean; runtimeLabel: string }) {
  return (
    <div className="relative z-10 grid place-items-center" style={{ minHeight: 0, height: "100%", padding: 28 }}>
      <div className="grid place-items-center text-center" style={{
        gap: 10, maxWidth: 420, padding: 28, borderRadius: 14,
        border: "1px dashed var(--hex-add-stroke)", background: "var(--panel-bg-soft)",
      }}>
        <HexTile size={58} tone="honey"><BeeIcon role="queen" size={34} /></HexTile>
        <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>
          {filtered ? "No matching automations" : "No automations yet"}
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          {filtered
            ? `Nothing matches these filters${runtimeLabel && runtimeLabel !== "All" ? ` on ${runtimeLabel}` : ""}. Clear the search or filters, or create a new automation.`
            : "Create a recurring automation for one of your agents, or import existing runtime schedules to populate this list."}
        </p>
        {onNewJob ? (
          <button type="button" onClick={onNewJob} className="uppercase font-bold cursor-pointer" style={{
            marginTop: 6, padding: "9px 14px", borderRadius: 7,
            border: "1px solid rgba(94,234,212,0.55)", background: "rgba(45,212,191,0.18)",
            color: "var(--hex-active-border)", fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: 0.06,
          }}>New automation</button>
        ) : null}
      </div>
    </div>
  );
}
