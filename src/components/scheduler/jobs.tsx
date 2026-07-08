// src/components/scheduler/jobs.tsx
"use client";

import * as React from "react";
import { Copy, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { BeeIcon } from "./bee-icon";
import type { RunStatus, SchedulerJob } from "./scheduler-data";
import type { SchedulerRunState } from "./SchedulerView";
import styles from "./scheduler-tokens.module.css";

interface AutomationListProps {
  jobs: SchedulerJob[];
  selectedId: string;
  runStates?: Record<string, SchedulerRunState>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRunNow?: (job: SchedulerJob) => void;
  onEdit?: (job: SchedulerJob) => void;
  onDuplicate?: (job: SchedulerJob) => void;
  onDelete?: (job: SchedulerJob) => void;
  onNewJob?: () => void;
}

const STATUS_TOKEN: Record<RunStatus, string> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  failed: "var(--status-failed)",
  stale: "var(--status-stale)",
  idle: "var(--status-idle)",
};

const STATUS_WORD: Record<RunStatus, string> = {
  ok: "ok", warn: "warn", failed: "failed", stale: "stale", idle: "—",
};

function runStatePhase(runState?: SchedulerRunState) {
  return typeof runState === "string" ? runState : runState?.phase;
}

// Honest "when it next runs": a real countdown only when we could compute one.
// Dashboard-only automations (no external runtime cron) never auto-fire, so we
// say "on demand" instead of implying an autonomous schedule the app can't keep.
function nextRunLabel(job: SchedulerJob) {
  if (!job.enabled) return "paused";
  if (!job.external) return "on demand";
  // Only show a countdown when the runtime actually told us the next fire time;
  // an interval-from-anchor guess doesn't match a wall-clock cron.
  if (job.nextRunKnown && /\d/.test(job.nextRun)) {
    return `next ${job.nextRun.startsWith("in") ? job.nextRun : `in ${job.nextRun}`}`;
  }
  return "scheduled";
}

function AutomationRow({
  job, selected, runState, onSelect, onToggle, onRunNow, onEdit, onDuplicate, onDelete,
}: {
  job: SchedulerJob;
  selected: boolean;
  runState?: SchedulerRunState;
  onSelect: () => void;
  onToggle: () => void;
  onRunNow?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const tone = STATUS_TOKEN[job.lastRun.status] ?? STATUS_TOKEN.idle;
  const phase = runStatePhase(runState);
  const running = Boolean(phase && phase !== "done");

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
      }}
      className={`${styles.schedRow} ${selected ? styles.schedRowSelected : ""} ${job.enabled ? "" : styles.schedRowPaused}`}
    >
      {/* Status dot */}
      <span
        aria-hidden
        className={job.enabled && job.lastRun.status === "ok" ? `${styles.dot} ${styles.dotLive}` : styles.dot}
        style={{ color: tone, width: 9, height: 9 }}
      />

      {/* Body — wraps, never truncated */}
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--foreground)",
            wordBreak: "break-word", overflowWrap: "anywhere", lineHeight: 1.25,
          }}>{job.name}</span>
          {job.external ? (
            <span style={{
              fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: 0.06, textTransform: "uppercase",
              padding: "1px 7px", borderRadius: 999, color: "var(--hex-active-border)",
              border: "1px solid rgba(94,234,212,0.32)", background: "rgba(45,212,191,0.08)",
            }}>{job.externalRuntimeLabel || "runtime"}</span>
          ) : (
            <span title="Runs when you trigger it — no background scheduler fires dashboard-only automations." style={{
              fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: 0.06, textTransform: "uppercase",
              padding: "1px 7px", borderRadius: 999, color: "var(--muted)",
              border: "1px solid rgba(148,163,184,0.22)", background: "rgba(148,163,184,0.06)",
            }}>on demand</span>
          )}
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: "var(--foreground)" }}>{job.cronLabel}</span>
          <span aria-hidden>·</span>
          <span>{nextRunLabel(job)}</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <BeeIcon role="worker" size={13} dim={!job.enabled} />
          <span style={{ wordBreak: "break-word", overflowWrap: "anywhere" }} title={`${job.bee} · ${job.machine}`}>{job.bee} · {job.machine}</span>
          {job.lastRun.at && job.lastRun.at !== "not run yet" ? (
            <>
              <span aria-hidden>·</span>
              <span style={{ color: tone }}>{STATUS_WORD[job.lastRun.status]}</span>
              <span>{job.lastRun.at}</span>
            </>
          ) : (
            <><span aria-hidden>·</span><span>never run</span></>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className={styles.schedRowActions} onClick={stop}>
        <button
          type="button"
          className={styles.schedIconBtn}
          aria-label={running ? "Running" : "Run now"}
          title={running ? "Running" : "Run now"}
          disabled={running}
          onClick={() => onRunNow?.()}
        >
          {running ? <span className={styles.runSpinner} aria-hidden /> : <Play size={13} />}
        </button>
        <button
          type="button"
          className={styles.schedIconBtn}
          aria-label={job.enabled ? "Pause" : "Resume"}
          title={job.enabled ? "Pause" : "Resume"}
          onClick={onToggle}
          style={job.enabled ? undefined : { borderColor: "rgba(94,234,212,0.4)", color: "var(--hex-active-border)" }}
        >
          {job.enabled ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className={styles.schedIconBtn}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen ? (
            <div className={styles.schedMenu} role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit?.(); }}>
                <Pencil size={14} aria-hidden /> Edit
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate?.(); }}>
                <Copy size={14} aria-hidden /> Duplicate
              </button>
              <button type="button" role="menuitem" className={styles.schedMenuDanger} onClick={() => { setMenuOpen(false); onDelete?.(); }}>
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AutomationList({
  jobs, selectedId, runStates = {}, onSelect, onToggle, onRunNow, onEdit, onDuplicate, onDelete, onNewJob,
}: AutomationListProps) {
  return (
    <div className={styles.schedListScroll}>
      <button
        type="button"
        onClick={onNewJob}
        aria-label="New automation"
        className={styles.schedRow}
        style={{
          gridTemplateColumns: "auto 1fr", justifyContent: "flex-start", gap: 10,
          borderStyle: "dashed", borderColor: "var(--hex-add-stroke)",
          background: "transparent", color: "var(--hex-active-border)", cursor: "pointer",
        }}
      >
        <span className="grid place-items-center" style={{
          width: 30, height: 30, borderRadius: 999,
          background: "rgba(45,212,191,0.08)", border: "1px dashed var(--hex-add-stroke)",
        }}>
          <Plus size={16} />
        </span>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 700 }}>New automation</span>
      </button>
      {jobs.map((job) => (
        <AutomationRow
          key={job.id}
          job={job}
          selected={job.id === selectedId}
          runState={runStates[job.id]}
          onSelect={() => onSelect(job.id)}
          onToggle={() => onToggle(job.id)}
          onRunNow={() => onRunNow?.(job)}
          onEdit={() => onEdit?.(job)}
          onDuplicate={() => onDuplicate?.(job)}
          onDelete={() => onDelete?.(job)}
        />
      ))}
    </div>
  );
}
