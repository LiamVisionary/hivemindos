// src/components/scheduler/composer.tsx
"use client";

import * as React from "react";
import { ChevronDown, Copy, Pencil, Play, Trash2 } from "lucide-react";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { BeeIcon } from "./bee-icon";
import { relLabel, statusMeta } from "./automation-decorate";
import type { SchedulerRunState } from "./SchedulerView";
import type { RunStatus, SchedulerJob, SchedulerRunHistoryEntry } from "./scheduler-data";
import styles from "./scheduler-tokens.module.css";

interface ComposerProps {
  job: SchedulerJob;
  runState?: SchedulerRunState;
  fetchHistory?: (job: SchedulerJob) => Promise<SchedulerRunHistoryEntry[]>;
  onRunNow?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

const STATUS_TOKEN: Record<RunStatus, string> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  failed: "var(--status-failed)",
  stale: "var(--status-stale)",
  idle: "var(--status-idle)",
};

function runStatePhase(runState?: SchedulerRunState) {
  return typeof runState === "string" ? runState : runState?.phase;
}
function runStateLabel(runState?: SchedulerRunState) {
  if (!runState) return "Run now";
  if (typeof runState !== "string" && runState.label) return runState.label;
  const phase = runStatePhase(runState);
  if (phase === "assigned") return "assigned";
  if (phase === "thinking") return "thinking";
  if (phase === "executing") return "executing";
  if (phase === "wrapping") return "wrapping up";
  if (phase === "done") return "done";
  return "running";
}

const SCHEDULE_PREVIEW_LIMIT = 260;

function normalizeScheduleMarkdown(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+-\s+(?=([`"']?[A-Z0-9][^-\n]{0,90}:|`[^`]+`|[A-Z][a-z]))/g, "\n- ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function previewScheduleMarkdown(markdown: string) {
  const paragraph: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { if (paragraph.length) break; continue; }
    if (paragraph.length && /^[-*]\s+/.test(trimmed)) break;
    paragraph.push(trimmed);
    if (/^[-*]\s+/.test(trimmed)) break;
  }
  const preview = (paragraph.join(" ") || markdown).replace(/^[-*]\s+/, "").replace(/\s+/g, " ").trim();
  if (preview.length <= SCHEDULE_PREVIEW_LIMIT) return preview;
  const clipped = preview.slice(0, SCHEDULE_PREVIEW_LIMIT).replace(/\s+\S*$/, "").trim();
  return `${clipped || preview.slice(0, SCHEDULE_PREVIEW_LIMIT).trim()}...`;
}

function Cap({ children, color }: { children: React.ReactNode; color?: string }) {
  return <div className={styles.monoCap} style={{ color: color ?? "var(--muted)" }}>{children}</div>;
}

export function Composer({ job, runState, fetchHistory, onRunNow, onEdit, onDuplicate, onDelete }: ComposerProps) {
  // Track expansion against the job id so switching automations resets the
  // affordance without a setState-in-effect (derived during render).
  const [descriptionState, setDescriptionState] = React.useState({ jobId: "", expanded: false });
  const [history, setHistory] = React.useState<SchedulerRunHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const sc = statusMeta(job);
  const phase = runStatePhase(runState);
  const running = Boolean(phase && phase !== "done");
  const done = phase === "done";
  const runLabel = runStateLabel(runState);
  const isAttn = job.enabled && (job.lastRun.status === "failed" || job.lastRun.status === "warn" || job.lastRun.status === "stale");
  const nextRunMins = job.enabled && job.nextRunMs != null && job.nextRunMs > 0
    ? Math.max(0, Math.round(job.nextRunMs / 60_000))
    : null;
  const nextBig = !job.enabled ? "paused" : nextRunMins != null ? relLabel(nextRunMins) : job.external ? "scheduled" : "on demand";

  const descriptionMarkdown = normalizeScheduleMarkdown(job.description);
  const descriptionPreview = previewScheduleMarkdown(descriptionMarkdown);
  const canToggleDescription = descriptionPreview !== descriptionMarkdown;
  const descriptionExpanded = descriptionState.jobId === job.id && descriptionState.expanded;

  // Keep the latest fetchHistory in a ref (updated in an effect, never during
  // render) so the history effect below can call it without depending on its
  // new-every-render identity.
  const fetchHistoryRef = React.useRef(fetchHistory);
  React.useEffect(() => { fetchHistoryRef.current = fetchHistory; });

  // Load the REAL archived run history — only when the selected automation
  // changes (keyed on job.id), never on every parent re-render.
  React.useEffect(() => {
    let cancelled = false;
    const fetchFn = fetchHistoryRef.current;
    if (!fetchFn) { setHistory([]); setHistoryLoading(false); return; }
    setHistoryLoading(true);
    setHistory(null);
    fetchFn(job)
      .then((entries) => { if (!cancelled) setHistory(entries); })
      .catch(() => { if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  return (
    <div key={job.id} className={styles.riseIn} style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 18px", minHeight: "100%" }}>
      <div>
        <Cap>Detail</Cap>
        <div className="font-bold leading-tight" style={{
          margin: "5px 0 0", fontFamily: "var(--f-display)", fontSize: 20, letterSpacing: 0,
          wordBreak: "break-word", overflowWrap: "anywhere",
        }}>{job.name}</div>
        {descriptionMarkdown ? (
          <div className={styles.scheduleDescription}>
            <ChatMarkdown
              text={descriptionExpanded ? descriptionMarkdown : descriptionPreview}
              className={styles.scheduleDescriptionMarkdown}
              headingClassName={styles.scheduleDescriptionHeading}
            />
            {canToggleDescription ? (
              <button
                type="button"
                aria-expanded={descriptionExpanded}
                className={styles.scheduleDescriptionToggle}
                onClick={() => setDescriptionState({ jobId: job.id, expanded: !descriptionExpanded })}
              >
                <ChevronDown aria-hidden className={descriptionExpanded ? styles.scheduleDescriptionCaretOpen : undefined} size={14} />
                <span>{descriptionExpanded ? "Collapse" : "Expand"}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isAttn ? (
        <div className={styles.autoAlert} style={{
          border: `1px solid color-mix(in srgb, ${sc.color} 42%, transparent)`,
          background: `color-mix(in srgb, ${sc.color} 12%, transparent)`,
        }}>
          <span className={styles.dot} style={{ color: sc.color, marginTop: 5 }} />
          <span style={{ color: "var(--foreground)" }}>
            {job.lastRun.status === "failed"
              ? `Last run failed${job.lastRun.at && job.lastRun.at !== "not run yet" ? ` · ${job.lastRun.at}` : ""}. Check the run history below before retrying.`
              : `Enabled but the last run stalled${job.lastRun.at && job.lastRun.at !== "not run yet" ? ` · ${job.lastRun.at}` : ""}. The runtime schedule may need a re-import or edit.`}
          </span>
        </div>
      ) : null}

      {/* Next run tile */}
      <div className="grid" style={{
        padding: "14px 15px", borderRadius: 12, gap: 5,
        border: "1px solid var(--hex-honey-border)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--hex-honey-border) 14%, transparent), transparent)",
      }}>
        <Cap color="var(--hex-honey-border)">{job.external ? "Next run" : "Runs"}</Cap>
        <div className="font-bold" style={{ fontFamily: "var(--f-display)", fontSize: 27, color: "var(--foreground)", lineHeight: 1 }}>
          {nextBig}
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)" }}>{job.cronLabel}</div>
        {!job.external ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", lineHeight: 1.4, marginTop: 2 }}>
            Dashboard-only — runs when you trigger it; no background scheduler fires it automatically.
          </div>
        ) : null}
        <div className="flex" style={{ gap: 8, marginTop: 10 }}>
          <button onClick={onRunNow} disabled={running || done} className="uppercase font-bold cursor-pointer"
            style={{
              flex: 1, padding: "10px", borderRadius: 8,
              border: "1px solid rgba(111,205,186,0.5)",
              background: done ? "rgba(111,205,186,0.24)" : "rgba(111,205,186,0.16)",
              color: "var(--hex-active-border)",
              fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: 0.06,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              opacity: running || done ? 0.95 : 1,
            }}>
            {running ? <span className={styles.runSpinner} aria-hidden /> : done ? <span className={styles.runCheck} aria-hidden>✓</span> : <Play size={12} aria-hidden />}
            {runLabel}
          </button>
          <button onClick={onEdit} className="uppercase font-bold cursor-pointer" aria-label="Edit automation"
            style={{
              padding: "10px 13px", borderRadius: 8,
              border: "1px solid rgba(238,232,220,0.22)", background: "transparent", color: "var(--foreground)",
              fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: 0.06,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}><Pencil size={12} aria-hidden /> edit</button>
        </div>
      </div>

      {/* Assignment */}
      <section className="grid" style={{ gap: 8 }}>
        <Cap>Assigned to</Cap>
        <div className="grid items-center" style={{
          gridTemplateColumns: "auto 1fr", gap: 11, padding: "11px 13px", borderRadius: 10,
          border: "1px solid rgba(238,232,220,0.16)", background: "var(--panel-bg-soft)",
        }}>
          <BeeIcon role={job.beeRole} workerClass={job.workerClass} size={30} dim={!job.enabled} />
          <div style={{ minWidth: 0 }}>
            <div className="font-semibold" style={{ fontFamily: "var(--f-display)", fontSize: 13, wordBreak: "break-word", overflowWrap: "anywhere" }}>{job.bee}</div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", wordBreak: "break-word", overflowWrap: "anywhere" }}>
              {job.runtime} · {job.machine}
            </div>
          </div>
        </div>
      </section>

      {/* Real run history */}
      <section className="grid" style={{ gap: 8 }}>
        <div className="flex justify-between items-baseline">
          <Cap>Recent runs</Cap>
          {history ? (
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>
              {history.length} {history.length === 1 ? "run" : "runs"}
            </span>
          ) : null}
        </div>
        {historyLoading ? (
          <div className="grid" role="status" aria-label="Loading run history" style={{ gap: 6 }}>
            {[0, 1, 2].map((i) => <div key={i} className={styles.schedSkel} style={{ height: 44 }} />)}
          </div>
        ) : history && history.length ? (
          <div className="grid" style={{ gap: 6 }}>
            {history.map((entry) => {
              const tone = STATUS_TOKEN[entry.status] ?? STATUS_TOKEN.idle;
              return (
                <div key={entry.id} className="grid" style={{
                  gridTemplateColumns: "auto 1fr", gap: 10, padding: "9px 11px", borderRadius: 8,
                  border: "1px solid rgba(238,232,220,0.16)", background: "var(--panel-bg-soft)",
                }}>
                  <span className={styles.dot} style={{ color: tone, marginTop: 5 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className={styles.monoCap} style={{ color: tone }}>{entry.status}</span>
                      {typeof entry.runNumber === "number" ? (
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>run {entry.runNumber}</span>
                      ) : null}
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--foreground)" }}>{entry.atLabel}</span>
                    </div>
                    {entry.summary ? (
                      <div style={{ fontFamily: "var(--f-display)", fontSize: 12, color: "var(--muted)", lineHeight: 1.45, marginTop: 2, wordBreak: "break-word", overflowWrap: "anywhere" }}>
                        {entry.summary}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{
            padding: "12px 14px", borderRadius: 8, border: "1px dashed rgba(238,232,220,0.2)",
            background: "var(--panel-bg-soft)", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5,
          }}>
            No runs recorded yet. History appears here after this automation runs (or when you use “Run now”).
          </div>
        )}
      </section>

      {/* Destructive actions */}
      <section className="grid" style={{ gap: 8, marginTop: "auto", paddingTop: 6 }}>
        <div className="flex" style={{ gap: 8 }}>
          <button type="button" onClick={onDuplicate} className="cursor-pointer" style={{
            flex: 1, padding: "9px 10px", borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            border: "1px solid rgba(238,232,220,0.22)", background: "transparent", color: "var(--foreground)",
            fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: 0.04, textTransform: "uppercase",
          }}><Copy size={12} aria-hidden /> Duplicate</button>
          <button type="button" onClick={onDelete} className="cursor-pointer" style={{
            flex: 1, padding: "9px 10px", borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            border: "1px solid color-mix(in srgb, var(--status-failed) 45%, transparent)", background: "transparent", color: "var(--status-failed)",
            fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: 0.04, textTransform: "uppercase",
          }}><Trash2 size={12} aria-hidden /> Delete</button>
        </div>
      </section>
    </div>
  );
}
