// src/components/scheduler/SchedulerView.tsx
"use client";

import * as React from "react";
import { List as ListIcon, Pause, Play, Plane, Search } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { runtimeScheduleFilterOptions } from "@/lib/types/agent-runtime";

import { BeeIcon } from "./bee-icon";
import { Composer } from "./composer";
import { HexTile } from "./hex-tile";
import { DeparturesBoard, TimelineRibbon, type FlightRange } from "./flight-plan";
import { decorateJob, relLabel, type DecoratedJob } from "./automation-decorate";
import type { SchedulerJob, SchedulerRunHistoryEntry } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

export type SchedulerRunPhase = "running" | "assigned" | "thinking" | "executing" | "wrapping" | "done";
type ScheduleRuntimeFilter = "all" | (string & {});
type ScheduleRuntimeOption = { value: ScheduleRuntimeFilter; label: string };
type StatusFilter = "all" | "active" | "paused" | "failed";
type ViewMode = "flight" | "simple";

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
  /** Small action cluster (sync vault / import runtime schedules) rendered in the header. */
  toolbar?: React.ReactNode;
  /** When set, the runtime filter is forced to this value and the toggle is hidden. */
  lockedRuntime?: ScheduleRuntimeFilter;
  lockedRuntimeLabel?: string;
  runtimeOptions?: ScheduleRuntimeOption[];
}

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "failed", label: "Failed" },
];

function matchesStatus(job: DecoratedJob, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return job.enabled;
  if (filter === "paused") return !job.enabled;
  return job.lastRun.status === "failed";
}

function sortJobs(list: DecoratedJob[]) {
  return list.slice().sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const am = a.nextRunMins ?? Number.POSITIVE_INFINITY;
    const bm = b.nextRunMins ?? Number.POSITIVE_INFINITY;
    return am - bm || a.name.localeCompare(b.name);
  });
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
  const [viewMode, setViewMode] = React.useState<ViewMode>("flight");
  const [range, setRange] = React.useState<FlightRange>("24h");
  const [zoom, setZoom] = React.useState(0.75);
  const [full, setFull] = React.useState(false);
  const [runtimeFilter, setRuntimeFilter] = React.useState<ScheduleRuntimeFilter>(lockedRuntime ?? "all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");

  // Wall-clock anchor for departure times — mount-time is fine (the board is
  // relative-minute driven; a few minutes of drift is immaterial and keeps render pure).
  const [now] = React.useState(() => Date.now());

  const effectiveRuntime = (lockedRuntime ?? runtimeFilter).trim().toLowerCase();
  const runtimeOptions = React.useMemo<ScheduleRuntimeOption[]>(() => (
    runtimeOptionsProp?.length ? runtimeOptionsProp : [{ value: "all", label: "All runtimes" }, ...runtimeScheduleFilterOptions()]
  ), [runtimeOptionsProp]);

  const labelForRuntime = React.useCallback((runtime: ScheduleRuntimeFilter) => {
    const normalized = runtime.trim().toLowerCase();
    if (runtime === lockedRuntime && lockedRuntimeLabel) return lockedRuntimeLabel;
    return runtimeOptions.find((o) => o.value.trim().toLowerCase() === normalized)?.label ?? runtime;
  }, [lockedRuntime, lockedRuntimeLabel, runtimeOptions]);

  const decorated = React.useMemo(
    () => allJobs.map((job) => decorateJob(job, runStates)),
    [allJobs, runStates],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = decorated.filter((job) => {
      if (effectiveRuntime !== "all" && job.runtime.trim().toLowerCase() !== effectiveRuntime) return false;
      if (!matchesStatus(job, statusFilter)) return false;
      if (!needle) return true;
      const hay = `${job.name} ${job.bee} ${job.machine} ${job.runtime} ${job.cronLabel} ${job.cadence} ${job.tags.join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
    return sortJobs(list);
  }, [decorated, effectiveRuntime, statusFilter, query]);

  // Prefer a selection that is actually in the visible (filtered) list so the
  // detail panel never desyncs from what's on screen; only fall back to the raw
  // selected/first job when the current filter hides everything.
  const selected = filtered.find((j) => j.id === selectedId) ?? filtered[0] ?? decorated.find((j) => j.id === selectedId) ?? decorated[0] ?? null;
  const effectiveSelectedId = selected?.id ?? "";

  // Counts for the hero.
  const activeCount = decorated.filter((j) => j.enabled).length;
  const agentCount = new Set(decorated.filter((j) => j.enabled).map((j) => j.bee)).size;
  const heroCount = decorated.filter((j) => j.enabled && j.nextRunMins != null && j.nextRunMins <= 1440).length;
  const isFiltered = effectiveRuntime !== "all" || statusFilter !== "all" || query.trim().length > 0;

  const departures = viewMode === "flight" ? filtered.filter((j) => j.enabled) : filtered;

  const viewToggle = (
    <div className={styles.autoIconSeg} role="group" aria-label="View mode">
      <button type="button" aria-pressed={viewMode === "flight"} title="Flight plan" onClick={() => setViewMode("flight")}><Plane size={16} aria-hidden /></button>
      <button type="button" aria-pressed={viewMode === "simple"} title="Simple list" onClick={() => setViewMode("simple")}><ListIcon size={16} aria-hidden /></button>
    </div>
  );

  const runtimeChips = lockedRuntime ? (
    <span className={styles.schedulerLockedRuntime}>{labelForRuntime(effectiveRuntime)} schedules</span>
  ) : (
    <div className={styles.schedChipRow} role="group" aria-label="Filter by runtime">
      {runtimeOptions.map(({ value, label }) => (
        <button key={value} type="button" aria-pressed={effectiveRuntime === value.trim().toLowerCase()}
          className={`${styles.schedChip} ${effectiveRuntime === value.trim().toLowerCase() ? styles.schedChipActive : ""}`}
          onClick={() => setRuntimeFilter(value)}>{value === "all" ? "All runtimes" : label}</button>
      ))}
    </div>
  );

  const body = allJobs.length === 0 ? (
    <EmptyState onNewJob={onNewJob} filtered={false} runtimeLabel="" />
  ) : viewMode === "flight" ? (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "hidden" }}>
      {!full ? (
        <div className={styles.autoHero}>
          <div>
            <div className={styles.autoEyebrow}>The flight plan</div>
            <div className={styles.autoHeadline}>
              {heroCount > 0
                ? <>While you sleep, <em>{heroCount} flight{heroCount === 1 ? "" : "s"}</em> depart.</>
                : <>Nothing is queued <em>to depart</em> yet.</>}
            </div>
            <div className={styles.autoSub}>Next 24 hours · {activeCount} automation{activeCount === 1 ? "" : "s"} live across {agentCount} agent{agentCount === 1 ? "" : "s"}</div>
          </div>
          <div className={styles.autoHeroSide}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {toolbar ? <div className={styles.autoTopActions}>{toolbar}</div> : null}
              {viewToggle}
            </div>
            <div className={styles.autoHeroControls}>
              <div className={styles.schedChipRow}>
                {(["24h", "week"] as FlightRange[]).map((value) => (
                  <button key={value} type="button" aria-pressed={range === value}
                    className={`${styles.schedChip} ${range === value ? styles.schedChipActive : ""}`}
                    onClick={() => { setRange(value); setZoom(0.75); }}>{value === "24h" ? "24 h" : "Week"}</button>
                ))}
              </div>
              <button type="button" className={`${styles.honeyBtn} ${styles.honeyBtnPill}`} onClick={onNewJob}>+ New flight</button>
            </div>
          </div>
        </div>
      ) : null}
      {!full ? (
        <div className={styles.schedToolbar} aria-label="Filter flight plan">
          <div className={styles.schedSearch}>
            <Search size={14} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" aria-label="Search automations" />
          </div>
          {runtimeChips}
          <div className={styles.schedChipRow} role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={statusFilter === value}
                className={`${styles.schedChip} ${statusFilter === value ? styles.schedChipActive : ""}`}
                onClick={() => setStatusFilter(value)}>{label}</button>
            ))}
          </div>
          {isFiltered ? (
            <button type="button" className={`${styles.toolBtn} ${styles.toolBtnWide}`} onClick={() => { setQuery(""); setStatusFilter("all"); if (!lockedRuntime) setRuntimeFilter("all"); }}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
      <TimelineRibbon
        jobs={filtered}
        selectedId={effectiveSelectedId}
        range={range}
        zoom={zoom}
        full={full}
        onSelect={setSelectedId}
        onZoomIn={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
        onZoomOut={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
        onToggleFull={() => setFull((f) => !f)}
      />
      {!full ? (
        departures.length ? (
          <DeparturesBoard jobs={departures} selectedId={effectiveSelectedId} now={now} onSelect={setSelectedId} />
        ) : (
          <FilteredEmpty onNewJob={onNewJob} isFiltered={isFiltered} />
        )
      ) : null}
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "hidden" }}>
      <div className={styles.autoHero} style={{ paddingBottom: 6 }}>
        <div>
          <div className={styles.autoEyebrow}>All automations</div>
          <div className={styles.autoHeadline} style={{ fontSize: 26 }}>Everything the hive runs.</div>
          <div className={styles.autoSub}>{activeCount} automation{activeCount === 1 ? "" : "s"} live across {agentCount} agent{agentCount === 1 ? "" : "s"} · {decorated.length - activeCount} paused</div>
        </div>
        <div className={styles.autoHeroSide}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {toolbar ? <div className={styles.autoTopActions}>{toolbar}</div> : null}
            {viewToggle}
          </div>
        </div>
      </div>
      <div className={styles.schedToolbar}>
        <div className={styles.schedSearch}>
          <Search size={14} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search automations" aria-label="Search automations" />
        </div>
        {runtimeChips}
        <div className={styles.schedChipRow} role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={statusFilter === value}
              className={`${styles.schedChip} ${statusFilter === value ? styles.schedChipActive : ""}`}
              onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
        <button type="button" className={`${styles.honeyBtn}`} style={{ marginLeft: "auto" }} onClick={onNewJob}>+ New automation</button>
      </div>
      {filtered.length === 0 ? (
        <FilteredEmpty onNewJob={onNewJob} isFiltered runtimeLabel={labelForRuntime(effectiveRuntime)} />
      ) : (
        <div className={styles.schedListScroll}>
          {filtered.map((job) => (
            <SimpleRow
              key={job.id}
              job={job}
              selected={job.id === effectiveSelectedId}
              onSelect={() => setSelectedId(job.id)}
              onRun={() => onRunNow?.(job)}
              onToggle={() => onToggleJob?.(job)}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className={`${styles.root} ${styles.autoTheme} relative`} style={{
        width: "100%", height: "100%", minHeight: 0,
        background: "var(--background)", color: "var(--foreground)",
        fontFamily: "var(--f-display), system-ui, sans-serif",
        display: "grid", gridTemplateRows: "minmax(0, 1fr)", overflow: "hidden",
      }}>
        <div className={selected ? styles.schedLayout : styles.schedLayoutSolo}>
          <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {body}
          </div>
          {selected ? (
            <aside className={styles.schedDrawer}>
              <Composer
                job={selected}
                runState={runStates[selected.id]}
                fetchHistory={fetchHistory}
                onRunNow={() => onRunNow?.(selected)}
                onEdit={() => onEditJob?.(selected)}
                onDuplicate={() => onDuplicateJob?.(selected)}
                onDelete={() => onDeleteJob?.(selected)}
              />
            </aside>
          ) : null}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{isFiltered ? `${filtered.length} of ${allJobs.length} automations, ${activeCount} active` : `${allJobs.length} automations, ${activeCount} active`}</span>
    </TooltipProvider>
  );
}

function SimpleRow({ job, selected, onSelect, onRun, onToggle }: {
  job: DecoratedJob; selected: boolean; onSelect: () => void; onRun: () => void; onToggle: () => void;
}) {
  const nextLabel = !job.enabled ? "paused" : job.nextRunMins != null ? relLabel(job.nextRunMins) : job.external ? "scheduled" : "on demand";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
      className={`${styles.schedRow} ${selected ? styles.schedRowSelected : ""} ${job.enabled ? "" : styles.schedRowPaused}`}
    >
      <BeeIcon role={job.beeRole} workerClass={job.workerClass} size={34} dim={!job.enabled} />
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{job.name}</span>
          <span style={{
            fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 7px", borderRadius: 999,
            color: job.external ? "var(--hex-active-border)" : "var(--muted)",
            border: `1px solid ${job.external ? "rgba(111,205,186,0.32)" : "rgba(238,232,220,0.2)"}`,
            background: job.external ? "rgba(111,205,186,0.08)" : "rgba(238,232,220,0.05)",
          }}>{job.external ? job.runtime : "on demand"}</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: "var(--foreground)" }}>{job.cadence}</span><span>·</span><span>{nextLabel}</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{job.bee} · {job.machine}</span><span>·</span><span style={{ color: job.sc.color }}>{job.lastLine}</span>
        </div>
      </div>
      <div className={styles.schedRowActions} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.schedIconBtn} title="Run now" aria-label={`Run ${job.name} now`} disabled={job.running} onClick={onRun}>
          {job.running ? <span className={styles.runSpinner} aria-hidden /> : <Play size={12} aria-hidden />}
        </button>
        <button type="button" className={styles.schedIconBtn} title={job.enabled ? "Pause" : "Resume"} aria-label={`${job.enabled ? "Pause" : "Resume"} ${job.name}`} onClick={onToggle}>
          {job.enabled ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function FilteredEmpty({ onNewJob, isFiltered, runtimeLabel }: { onNewJob?: () => void; isFiltered: boolean; runtimeLabel?: string }) {
  return (
    <div className="grid place-items-center" style={{ minHeight: 0, height: "100%", padding: 28 }}>
      <div className="grid place-items-center text-center" style={{ gap: 10, maxWidth: 380, padding: 24 }}>
        <HexTile size={54} tone="honey"><BeeIcon role="queen" size={30} /></HexTile>
        <div className={styles.monoCap} style={{ color: "var(--hex-honey-border)" }}>{isFiltered ? "No matching automations" : "Nothing scheduled"}</div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          {isFiltered
            ? `Nothing matches these filters${runtimeLabel && runtimeLabel !== "All" ? ` on ${runtimeLabel}` : ""}. Clear the search or filters, or tell the hive something new to do.`
            : "Create a recurring automation for one of your agents to fill this timeline."}
        </p>
        {onNewJob ? <button type="button" onClick={onNewJob} className={styles.honeyBtn} style={{ marginTop: 4 }}>+ New automation</button> : null}
      </div>
    </div>
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
          <button type="button" onClick={onNewJob} className={styles.honeyBtn} style={{ marginTop: 6 }}>+ New automation</button>
        ) : null}
      </div>
    </div>
  );
}
