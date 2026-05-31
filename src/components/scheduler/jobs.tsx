// src/components/scheduler/jobs.tsx
"use client";

import { Pause, Play, Plus } from "lucide-react";
import { BeeIcon } from "./bee-icon";
import type { SchedulerJob } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

interface JobsProps {
  jobs: SchedulerJob[];
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onNewJob?: () => void;
  controls?: React.ReactNode;
}

const STATUS_TONE = {
  ok:     { c: "var(--hex-active-border)", bg: "rgba(45,212,191,0.12)", br: "rgba(94,234,212,0.32)", dot: "#2dd4bf" },
  warn:   { c: "var(--hex-honey-border)",  bg: "rgba(255,212,90,0.12)", br: "rgba(255,212,90,0.36)", dot: "var(--hex-honey-border)" },
  failed: { c: "#fecdd3",                  bg: "rgba(251,113,133,0.10)",br: "rgba(251,113,133,0.42)",dot: "#fb7185" },
  stale:  { c: "var(--hex-honey-border)",  bg: "rgba(255,212,90,0.10)", br: "rgba(255,212,90,0.32)", dot: "var(--hex-honey-border)" },
  idle:   { c: "var(--muted)",             bg: "rgba(148,163,184,0.08)",br: "rgba(148,163,184,0.18)",dot: "var(--muted)" },
} as const;

function JobCard({ job, selected, onSelect, onToggle }: {
  job: SchedulerJob; selected: boolean;
  onSelect: () => void; onToggle: (e: React.MouseEvent) => void;
}) {
  const t = STATUS_TONE[job.lastRun.status] || STATUS_TONE.idle;
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className="grid text-left cursor-pointer rounded-xl"
      style={{
        gap: 8, padding: 12,
        border: `1px solid ${selected ? "var(--hex-honey-border)" : "rgba(148,163,184,0.16)"}`,
        background: selected
          ? "linear-gradient(180deg, rgba(255,212,90,0.10), var(--panel-bg))"
          : "var(--panel-card-grad)",
        backdropFilter: "blur(8px) saturate(140%)",
        WebkitBackdropFilter: "blur(8px) saturate(140%)",
        color: "var(--foreground)",
        opacity: job.enabled ? 1 : 0.7,
        transition: "transform 160ms ease, border-color 160ms ease",
      }}>
      <div className="flex justify-between items-center" style={{ gap: 8 }}>
        <span className="inline-flex items-center gap-1.5 uppercase"
          style={{
            padding: "2px 8px", borderRadius: 4,
            border: `1px solid ${t.br}`, background: t.bg, color: t.c,
            fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.08,
          }}>
          <span className={job.enabled ? `${styles.dot} ${styles.dotLive}` : styles.dot}
            style={{ color: t.dot, width: 5, height: 5 }} />
          {job.enabled ? job.cronLabel.split(" · ")[0].toLowerCase() : "paused"}
        </span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{job.nextRun}</span>
      </div>
      <div className="font-bold leading-tight" style={{
        fontFamily: "var(--f-display)", fontSize: 13, letterSpacing: 0,
        wordBreak: "break-word", overflowWrap: "anywhere",
      }}>{job.name}</div>
      <div className="flex items-center" style={{
        gap: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)",
      }}>
        <BeeIcon role="worker" size={14} dim={!job.enabled} />
        <span className="truncate">{job.bee} · {job.machine}</span>
      </div>
      <div className="flex justify-between items-center" style={{
        paddingTop: 6, borderTop: "1px dashed rgba(148,163,184,0.16)",
        fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)",
      }}>
        <span>{job.cronLabel}</span>
        <button onClick={onToggle} aria-label={job.enabled ? "Pause" : "Resume"}
          title={job.enabled ? "Pause" : "Resume"}
          className="inline-grid place-items-center cursor-pointer"
          style={{
            width: 22, height: 22, borderRadius: 5,
            border: `1px solid ${job.enabled ? "var(--hex-honey-border)" : "rgba(94,234,212,0.4)"}`,
            background: job.enabled ? "rgba(255,212,90,0.14)" : "rgba(45,212,191,0.10)",
            color: job.enabled ? "var(--hex-honey-border)" : "var(--hex-active-border)",
          }}>
          {job.enabled ? <Pause size={10} /> : <Play size={10} />}
        </button>
      </div>
    </article>
  );
}

export function Jobs({ jobs, selectedId, onSelect, onToggle, onNewJob, controls }: JobsProps) {
  const enabled = jobs.filter((j) => j.enabled).length;
  return (
    <aside className="flex flex-col overflow-hidden"
      style={{
        gap: 14, height: "100%", minHeight: 0, padding: "20px 18px",
        borderRight: "1px solid rgba(148,163,184,0.16)",
        background: "var(--panel-bg-soft)",
      }}>
      <div>
        <div className={styles.monoCap} style={{ color: "var(--muted)" }}>The flight plan</div>
        <div className="flex justify-between items-baseline">
          <h2 className="font-bold" style={{
            margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 22, letterSpacing: 0,
          }}>Schedules</h2>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--hex-active-border)" }}>
            {enabled}/{jobs.length} active
          </span>
        </div>
        {controls ? <div className={styles.schedulerInlineControls}>{controls}</div> : null}
      </div>
      <div
        className="flex flex-col"
        style={{
          flex: 1,
          minHeight: 0,
          gap: 8,
          overflowX: "hidden",
          overflowY: "auto",
          overscrollBehavior: "contain",
          paddingRight: 4,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <button onClick={onNewJob} aria-label="Schedule new task"
          className="grid place-items-center cursor-pointer text-center"
          style={{
            gap: 6, padding: 14, minHeight: 132, borderRadius: 10,
            border: "1px dashed var(--hex-add-stroke)",
            background: "transparent", color: "var(--hex-active-border)",
            transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(45,212,191,0.06)";
            e.currentTarget.style.borderColor = "rgba(94,234,212,0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "var(--hex-add-stroke)";
          }}>
          <span className="grid place-items-center" style={{
            width: 32, height: 32, borderRadius: 999,
            background: "rgba(45,212,191,0.08)", border: "1px dashed var(--hex-add-stroke)",
          }}>
            <Plus size={16} />
          </span>
          <span className="uppercase font-bold" style={{
            fontFamily: "var(--f-mono)", fontSize: 12, letterSpacing: 0.06,
          }}>Schedule new task</span>
        </button>
        {jobs.map((j) => (
          <JobCard key={j.id} job={j}
            selected={j.id === selectedId}
            onSelect={() => onSelect(j.id)}
            onToggle={(e) => { e.stopPropagation(); onToggle(j.id); }} />
        ))}
      </div>
    </aside>
  );
}
