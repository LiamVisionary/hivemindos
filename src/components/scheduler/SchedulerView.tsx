// src/components/scheduler/SchedulerView.tsx
"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

import { BeeIcon } from "./bee-icon";
import { Composer } from "./composer";
import { HexTile } from "./hex-tile";
import { Jobs } from "./jobs";
import { Timeline } from "./timeline";
import type { TimelineRange } from "./timeline";
import { SCH_JOBS, SCH_TEMPLATES, type SchedulerJob } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

export type SchedulerRunPhase = "running" | "assigned" | "thinking" | "executing" | "wrapping" | "done";
type ScheduleRuntimeFilter = "all" | "aeon";

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
  status?: React.ReactNode;
  /** When set, the runtime filter is forced to this value and the All/Aeon toggle is hidden. */
  lockedRuntime?: ScheduleRuntimeFilter;
}

export function SchedulerView({
  jobs: initialJobs = SCH_JOBS, runStates = {}, onToggleJob, onRunNow, onEditJob, onNewJob, toolbar, status, lockedRuntime,
}: SchedulerViewProps = {}) {
  const [selectedId, setSelectedId] = React.useState<string>(initialJobs[0]?.id ?? "");
  const [timelineRange, setTimelineRange] = React.useState<TimelineRange>("24h");
  const [runtimeFilter, setRuntimeFilter] = React.useState<ScheduleRuntimeFilter>(lockedRuntime ?? "all");
  const effectiveFilter = lockedRuntime ?? runtimeFilter;
  const jobs = React.useMemo(() => (
    effectiveFilter === "aeon"
      ? initialJobs.filter((job) => job.runtime.trim().toLowerCase() === "aeon")
      : initialJobs
  ), [initialJobs, effectiveFilter]);
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

  const upcoming = jobs.filter((j) => j.enabled).length;
  const failedLast = jobs.filter((j) => j.lastRun.status === "failed").length;
  // Empty because of the Aeon filter, not because there are no schedules at all.
  const filteredEmpty = effectiveFilter === "aeon" && initialJobs.length > 0;

  return (
    <TooltipProvider delayDuration={120}>
      <div className={`${styles.root} relative overflow-hidden`} style={{
        width: "100%", height: "100%", maxHeight: "100dvh", flex: "1 1 auto", minHeight: 0,
        background: "var(--background)", color: "var(--foreground)",
        fontFamily: "var(--f-display), system-ui, sans-serif",
        display: "grid", gridTemplateRows: "auto auto 1fr",
      }}>
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,212,90,0.10), transparent 50%)," +
            "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.08), transparent 50%)",
        }} />

        {/* MASTHEAD */}
        <header className="relative z-10" style={{
          padding: "22px 32px 16px", borderBottom: "1px solid rgba(148,163,184,0.16)",
        }}>
          <div className="grid items-center" style={{ gridTemplateColumns: "auto 1fr auto", gap: 24 }}>
            <div className="flex items-center" style={{ gap: 14 }}>
              <HexTile size={42} tone="honey"><BeeIcon role="queen" size={26} /></HexTile>
              <div>
                <div className={styles.monoCap} style={{ color: "var(--hex-honey-border)" }}>
                  Hivemind Dispatch · Scheduler
                </div>
                <div className="font-bold" style={{
                  fontFamily: "var(--f-display)", fontSize: 18, letterSpacing: 0,
                }}>The bees keep flying</div>
              </div>
            </div>
            <div className="text-center uppercase" style={{
              fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", letterSpacing: 0.1,
            }}>
              {today} · cron · <span style={{ color: "var(--hex-active-border)" }}>synced</span>
            </div>
            <div className="flex justify-end">{toolbar}</div>
          </div>

          <div className="mt-4 grid items-end" style={{ gridTemplateColumns: "1fr auto", gap: 24 }}>
            <h1 className="m-0 font-bold" style={{
              fontFamily: "var(--f-display)", fontSize: "clamp(40px, 5vw, 64px)",
              lineHeight: 0.95, letterSpacing: 0,
            }}>
              While you{" "}
              <span style={{ fontStyle: "italic", color: "var(--hex-honey-border)", fontWeight: 500 }}>sleep.</span>
            </h1>
            <div className="flex" style={{ gap: 18, paddingBottom: 6 }}>
              <BigStat n={upcoming} label="active" tone="cyan" />
              <BigStat n={jobs.length - upcoming} label="paused" tone="honey" />
              <BigStat n={failedLast} label="failed last" tone="danger" />
              <BigStat n={jobs.length} label="total" />
            </div>
          </div>
          {status ? <div style={{ marginTop: 12 }}>{status}</div> : null}
        </header>

        {/* RUNTIME FILTER — always visible so you can switch back to All even when the filtered view is empty.
            Hidden when lockedRuntime pins the view to a single runtime (e.g. the AEON-only scheduler). */}
        {lockedRuntime ? null : (
        <div className="relative z-10 flex justify-center" style={{ padding: "14px 32px 0", gap: 6 }}>
          {([
            ["all", "All"],
            ["aeon", "Aeon"],
          ] as const).map(([value, label]) => {
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
          })}
        </div>
        )}

        {/* BODY */}
        {selected ? <div className="relative z-10 grid" style={{
          gridTemplateColumns: "300px minmax(0, 1fr) 360px", minHeight: 0, overflow: "hidden",
        }}>
          <Jobs jobs={jobs} selectedId={effectiveSelectedId}
            onSelect={setSelectedId} onToggle={toggleJob} onNewJob={onNewJob} />

          <section className="grid overflow-hidden" style={{
            minWidth: 0, minHeight: 0,
            padding: "20px 28px 28px", gap: 16, gridTemplateRows: "auto 1fr",
          }}>
            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
              <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>
                <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "#2dd4bf" }} />
                &nbsp; {timelineLabel}
              </div>
              <div className="flex justify-end" style={{ gap: 6 }}>
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
            <Timeline jobs={jobs} selectedId={effectiveSelectedId} range={timelineRange} onSelect={setSelectedId} />
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
                {filteredEmpty ? "No Aeon schedules" : "No schedules yet"}
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                {filteredEmpty
                  ? lockedRuntime
                    ? "Nothing scheduled on the Aeon runtime yet. Schedule a new task or import existing Aeon schedules to populate the dispatch rail."
                    : "Nothing scheduled on the Aeon runtime yet. Switch to All to see your other automations, or import existing Aeon schedules."
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

function BigStat({ n, label, tone }: { n: number; label: string; tone?: "cyan" | "honey" | "danger" }) {
  const color =
    tone === "cyan"   ? "var(--hex-active-border)" :
    tone === "honey"  ? "var(--hex-honey-border)"  :
    tone === "danger" ? "#fb7185"                  :
                        "var(--foreground)";
  return (
    <div className="text-right">
      <div className="font-bold" style={{
        fontFamily: "var(--f-display)", fontSize: 36, color, lineHeight: 1, letterSpacing: 0,
      }}>{n}</div>
      <div className={styles.monoCap} style={{ color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
