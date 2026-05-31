// src/components/scheduler/timeline.tsx
"use client";

import { BeeIcon } from "./bee-icon";
import { minutesFromLabel, type SchedulerJob } from "./scheduler-data";

interface TimelineProps {
  jobs: SchedulerJob[];
  selectedId: string;
  range: TimelineRange;
  onSelect: (id: string) => void;
}

export type TimelineRange = "24h" | "week" | "month";

const RANGE_CONFIG: Record<TimelineRange, {
  futureHours: number;
  pastHours: number;
  tickStepHours: number;
  majorStepHours: number;
}> = {
  "24h": { futureHours: 24, pastHours: 2, tickStepHours: 1, majorStepHours: 6 },
  week: { futureHours: 24 * 7, pastHours: 12, tickStepHours: 12, majorStepHours: 24 },
  month: { futureHours: 24 * 30, pastHours: 24, tickStepHours: 24 * 3, majorStepHours: 24 * 6 },
};
type TimelineRangeConfig = (typeof RANGE_CONFIG)[TimelineRange];

const COL_W = 280;
const COL_GAP = 12;
const JOB_GUTTER = 44;
const TRACK_PAD_TOP = 22;
const TRACK_PAD_BOTTOM = 14;
const MAX_RECURRING_PINS = 64;
const MIN_RECURRING_INTERVAL_MINUTES = 6 * 60;
const CANVAS_HEIGHT_BY_RANGE: Record<TimelineRange, number> = {
  "24h": 1248,
  week: 1560,
  month: 1680,
};

function PausedGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden style={{ color: "var(--muted)" }}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

function tickHours(config: TimelineRangeConfig) {
  const ticks: number[] = [];
  for (let hour = -config.pastHours; hour <= config.futureHours; hour += config.tickStepHours) {
    ticks.push(hour);
  }
  if (!ticks.includes(0)) ticks.push(0);
  if (!ticks.includes(config.futureHours)) ticks.push(config.futureHours);
  return ticks.sort((a, b) => a - b);
}

function tickLabel(hour: number) {
  if (hour === 0) return "now";
  const sign = hour > 0 ? "+" : "-";
  const absolute = Math.abs(hour);
  if (absolute >= 24 && absolute % 24 === 0) return `${sign}${absolute / 24}d`;
  if (absolute >= 24) return `${sign}${Math.round(absolute / 24)}d`;
  return `${sign}${absolute}h`;
}

function futureLabel(minutes: number) {
  if (minutes < 60) return `in ${Math.max(1, Math.round(minutes))}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `+${Math.round(hours / 24)}d`;
}

function parseCronPart(part: string, min: number, max: number) {
  const values = new Set<number>();
  for (const rawToken of part.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;
    if (token === "*") {
      for (let value = min; value <= max; value += 1) values.add(value);
      continue;
    }
    const stepMatch = /^\*\/(\d+)$/.exec(token);
    if (stepMatch) {
      const step = Math.max(1, Number(stepMatch[1]));
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Math.max(min, Number(rangeMatch[1]));
      const end = Math.min(max, Number(rangeMatch[2]));
      for (let value = start; value <= end; value += 1) values.add(value);
      continue;
    }
    const value = Number(token);
    if (Number.isInteger(value) && value >= min && value <= max) values.add(value);
  }
  return values;
}

function cronRecurringIntervalMinutes(cron: string) {
  const [minute = "", hour = "", day = "*", month = "*", weekday = "*"] = cron.trim().split(/\s+/);
  if (!minute || !hour || !day || !month || !weekday || day !== "*" || month !== "*") return null;
  if (/^\*\/\d+$/.test(minute) && hour === "*" && weekday === "*") return Number(minute.slice(2));
  if (/^\d+$/.test(minute) && hour === "*" && weekday === "*") return 60;
  if (/^\d+$/.test(minute) && /^(\*\/\d+)$/.test(hour) && weekday === "*") return Number(hour.slice(2)) * 60;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 24 * 60;
  return null;
}

function cronOffsets(cron: string, horizonMinutes: number) {
  const [minute = "", hour = "", day = "*", month = "*", weekday = "*"] = cron.trim().split(/\s+/);
  if (!minute || !hour || day !== "*" || month !== "*") return [];

  const interval = cronRecurringIntervalMinutes(cron);
  if (!interval || interval < MIN_RECURRING_INTERVAL_MINUTES) return [];

  const minuteValues = parseCronPart(minute, 0, 59);
  const hourValues = parseCronPart(hour, 0, 23);
  const weekdayValues = parseCronPart(weekday === "*" ? "0-6" : weekday.replace(/\b7\b/g, "0"), 0, 6);
  if (!minuteValues.size || !hourValues.size || !weekdayValues.size) return [];

  const now = new Date();
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const offsets: number[] = [];
  for (let offset = 1; offset <= horizonMinutes; offset += 1) {
    if (
      minuteValues.has(cursor.getMinutes())
      && hourValues.has(cursor.getHours())
      && weekdayValues.has(cursor.getDay())
    ) {
      offsets.push(offset);
      if (offsets.length > MAX_RECURRING_PINS) return offsets.slice(0, 1);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return offsets;
}

function occurrenceMinutes(job: SchedulerJob, horizonMinutes: number) {
  const first = minutesFromLabel(job.nextRun);
  const interval = cronRecurringIntervalMinutes(job.cron);
  if (first != null) {
    if (!interval || interval < MIN_RECURRING_INTERVAL_MINUTES) return first <= horizonMinutes ? [first] : [];
    const offsets: number[] = [];
    for (let offset = first; offset <= horizonMinutes; offset += interval) {
      offsets.push(offset);
      if (offsets.length > MAX_RECURRING_PINS) return offsets.slice(0, 1);
    }
    return offsets;
  }
  return cronOffsets(job.cron, horizonMinutes);
}

export function Timeline({ jobs, selectedId, range = "24h", onSelect }: TimelineProps) {
  const config = RANGE_CONFIG[range];
  const totalHours = config.pastHours + config.futureHours;
  const horizonMinutes = config.futureHours * 60;
  const ticks = tickHours(config);
  const nowT = config.pastHours / totalHours;
  const toTrackT = (futureMinutes: number) => (futureMinutes / 60 + config.pastHours) / totalHours;
  const trackTop = (t: number) => `calc(${TRACK_PAD_TOP}px + ${t * 100}% - ${(TRACK_PAD_TOP + TRACK_PAD_BOTTOM) * t}px)`;

  type Pin = {
    job: SchedulerJob;
    t: number;
    mins: number;
    isPaused: boolean;
    occurrenceIndex: number;
    occurrenceLabel: string;
    compact: boolean;
    _col?: number;
    _slotT?: number;
  };
  const placed: Pin[] = jobs
    .flatMap((j) => {
      if (!j.enabled || j.nextRun === "paused") return [];
      return occurrenceMinutes(j, horizonMinutes).map((m, occurrenceIndex) => {
        const t = Math.min(Math.max(toTrackT(m), 0), 1);
        return {
          job: j,
          t,
          mins: m,
          isPaused: false,
          occurrenceIndex,
          occurrenceLabel: occurrenceIndex === 0 && minutesFromLabel(j.nextRun) != null ? j.nextRun : futureLabel(m),
          compact: occurrenceIndex > 0,
        };
      });
    })
    .filter((x) => x.mins <= horizonMinutes);
  const floatingJobs = jobs.filter((j) => {
    if (!j.enabled || j.nextRun === "paused") return false;
    return occurrenceMinutes(j, horizonMinutes).length === 0;
  });

  const bucketed: Pin[] = [];
  const colLastT: number[] = [];
  const recurringJobCols = new Map<string, number>();
  const MIN_GAP = 0.045;
  for (const p of [...placed].sort((a, b) => a.t - b.t)) {
    const stickyCol = p.compact ? recurringJobCols.get(p.job.id) : undefined;
    const col = stickyCol ?? colLastT.findIndex((lastT) => p.t - lastT >= MIN_GAP);
    const nextCol = col === -1 ? colLastT.length : col;
    p._col = nextCol;
    p._slotT = p.t;
    if (!p.compact) recurringJobCols.set(p.job.id, nextCol);
    colLastT[nextCol] = p.t;
    bucketed.push(p);
  }
  const maxCols = Math.max(colLastT.length, 1);
  const railWidth = JOB_GUTTER + maxCols * COL_W + (maxCols - 1) * COL_GAP;
  const canvasHeight = CANVAS_HEIGHT_BY_RANGE[range];

  return (
    <div className="relative grid overflow-hidden rounded-2xl"
      style={{
        gridTemplateColumns: "64px 1fr", height: canvasHeight, minHeight: canvasHeight,
        border: "1px solid rgba(148,163,184,0.16)",
        background: "var(--panel-grad)",
        backdropFilter: "blur(10px) saturate(140%)",
        WebkitBackdropFilter: "blur(10px) saturate(140%)",
      }}>
      {/* Time axis */}
      <div className="relative" style={{ borderRight: "1px dashed rgba(148,163,184,0.16)", padding: "8px 0" }}>
        {ticks.map((h) => {
          const isMajor = h === 0 || h % config.majorStepHours === 0;
          return (
            <div key={h} className="flex items-center justify-end" style={{
              position: "absolute", top: trackTop((h + config.pastHours) / totalHours), left: 0, right: 0,
              transform: "translateY(-50%)", gap: 6, paddingRight: 10, height: 18,
            }}>
              <span style={{
                fontFamily: "var(--f-mono)", fontSize: isMajor ? 11 : 9,
                color: isMajor ? "var(--foreground)" : "var(--muted)",
                fontWeight: isMajor ? 700 : 500, letterSpacing: 0.04,
              }}>{tickLabel(h)}</span>
              <span style={{
                width: isMajor ? 10 : 5, height: 1,
                background: isMajor ? "rgba(148,163,184,0.32)" : "rgba(148,163,184,0.16)",
              }} />
            </div>
          );
        })}
      </div>

      {/* Rail */}
      <div className="relative overflow-x-auto overflow-y-hidden"
        style={{ padding: "0 16px 0 28px" }}>
        <div className="relative" style={{ width: railWidth, minWidth: "100%", height: "100%" }}>
          {ticks.slice(0, -1).map((h) => h % config.majorStepHours === 0 && (
            <div key={h} style={{
              position: "absolute", left: 0, right: 0,
              top: trackTop((h + config.pastHours) / totalHours),
              height: `calc(${(config.majorStepHours / totalHours) * 100}% - ${((TRACK_PAD_TOP + TRACK_PAD_BOTTOM) * config.majorStepHours) / totalHours}px)`,
              background: h % (config.majorStepHours * 2) === 0 ? "rgba(255,212,90,0.025)" : "rgba(45,212,191,0.02)",
              pointerEvents: "none",
            }} />
          ))}
          <div style={{
            position: "absolute", top: trackTop(nowT), left: 0, right: 0, height: 0,
            borderTop: "1px dashed var(--accent, #2dd4bf)", zIndex: 2, pointerEvents: "none",
            opacity: 0.5,
          }}>
            <span className="uppercase font-bold" style={{
              position: "absolute", left: 10, top: -10,
              padding: "2px 8px", borderRadius: 999,
              background: "var(--accent, #2dd4bf)", color: "#0a0e16",
              fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: 0.1,
            }}>now</span>
          </div>

          {bucketed.map(({ job, _col, _slotT, isPaused, occurrenceIndex, occurrenceLabel, compact }) => compact ? (
            <button
              key={`${job.id}-${occurrenceIndex}`}
              onClick={() => onSelect(job.id)}
              aria-label={`${job.name} ${occurrenceLabel}`}
              aria-pressed={selectedId === job.id}
              title={`${job.name} · ${occurrenceLabel}`}
              className="grid place-items-center cursor-pointer"
              style={{
                position: "absolute",
                left: JOB_GUTTER + (_col ?? 0) * (COL_W + COL_GAP),
                top: trackTop(_slotT ?? nowT),
                transform: "translateY(-50%)",
                width: 32,
                height: 32,
                borderRadius: 999,
                border: `1px solid ${selectedId === job.id ? "var(--hex-honey-border)" : "rgba(148,163,184,0.18)"}`,
                background: selectedId === job.id ? "rgba(255,212,90,0.18)" : "var(--panel-card-grad)",
                color: "var(--hex-honey-border)",
                boxShadow: selectedId === job.id ? "0 10px 28px rgba(255,212,90,0.18)" : "0 4px 12px rgba(0,0,0,0.16)",
                zIndex: selectedId === job.id ? 3 : 1,
              }}
            >
              <BeeIcon role="worker" size={18} />
            </button>
          ) : (
            <button key={`${job.id}-${occurrenceIndex}`}
              onClick={() => onSelect(job.id)}
              aria-pressed={selectedId === job.id}
              className="grid items-center text-left cursor-pointer"
              style={{
                position: "absolute",
                left: JOB_GUTTER + (_col ?? 0) * (COL_W + COL_GAP),
                top: trackTop(_slotT ?? nowT),
                transform: "translateY(-50%)",
                gridTemplateColumns: "28px 1fr", gap: 8,
                width: COL_W, padding: "6px 10px 6px 6px", borderRadius: 999,
                border: `1px solid ${selectedId === job.id ? "var(--hex-honey-border)" : "rgba(148,163,184,0.16)"}`,
                background: selectedId === job.id
                  ? "linear-gradient(90deg, rgba(255,212,90,0.16), var(--panel-bg))"
                  : "var(--panel-card-grad)",
                color: "var(--foreground)",
                boxShadow: selectedId === job.id
                  ? "0 12px 32px rgba(255,212,90,0.18)"
                  : "0 4px 12px rgba(0,0,0,0.18)",
                backdropFilter: "blur(8px) saturate(140%)",
                WebkitBackdropFilter: "blur(8px) saturate(140%)",
                opacity: isPaused ? 0.55 : 1,
                zIndex: selectedId === job.id ? 3 : 1,
                transition: "border-color 160ms ease, transform 160ms ease",
              }}>
              <span aria-hidden className="relative grid place-items-center"
                style={{
                  width: 28, height: 28, borderRadius: 999,
                  background: isPaused ? "rgba(148,163,184,0.18)" : "rgba(255,212,90,0.16)",
                  border: `1px solid ${isPaused ? "rgba(148,163,184,0.32)" : "var(--hex-honey-border)"}`,
                }}>
                {isPaused ? <PausedGlyph /> : <BeeIcon role="worker" size={18} />}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="block truncate font-semibold"
                  style={{
                    fontFamily: "var(--f-display)", fontSize: 12,
                    color: selectedId === job.id ? "var(--hex-honey-border)" : "var(--foreground)",
                  }}>{job.name}</span>
                <span className="flex items-center" style={{
                  gap: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)",
                }}>
                  <span>{isPaused ? "paused" : occurrenceLabel}</span>
                  <span>·</span>
                  <span className="truncate">{job.machine} · {job.bee}</span>
                </span>
              </span>
            </button>
          ))}
          {floatingJobs.length ? (
            <div className="grid" style={{
              position: "absolute", left: JOB_GUTTER, right: 12, bottom: 18,
              gap: 8, maxWidth: COL_W * 2 + COL_GAP,
            }}>
              <div className="uppercase font-bold" style={{
                fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: 0.08,
                color: "var(--muted)",
              }}>Runtime-managed schedules</div>
              {floatingJobs.map((job) => (
                <button key={job.id}
                  onClick={() => onSelect(job.id)}
                  aria-pressed={selectedId === job.id}
                  className="grid items-center text-left cursor-pointer"
                  style={{
                    gridTemplateColumns: "28px 1fr", gap: 8,
                    width: COL_W, padding: "6px 10px 6px 6px", borderRadius: 999,
                    border: `1px solid ${selectedId === job.id ? "var(--hex-honey-border)" : "rgba(148,163,184,0.16)"}`,
                    background: selectedId === job.id
                      ? "linear-gradient(90deg, rgba(255,212,90,0.16), var(--panel-bg))"
                      : "var(--panel-card-grad)",
                    color: "var(--foreground)",
                    boxShadow: selectedId === job.id
                      ? "0 12px 32px rgba(255,212,90,0.18)"
                      : "0 4px 12px rgba(0,0,0,0.18)",
                    backdropFilter: "blur(8px) saturate(140%)",
                    WebkitBackdropFilter: "blur(8px) saturate(140%)",
                    transition: "border-color 160ms ease, transform 160ms ease",
                  }}>
                  <span aria-hidden className="relative grid place-items-center"
                    style={{
                      width: 28, height: 28, borderRadius: 999,
                      background: "rgba(255,212,90,0.16)",
                      border: "1px solid var(--hex-honey-border)",
                    }}>
                    <BeeIcon role="worker" size={18} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="block truncate font-semibold"
                      style={{
                        fontFamily: "var(--f-display)", fontSize: 12,
                        color: selectedId === job.id ? "var(--hex-honey-border)" : "var(--foreground)",
                      }}>{job.name}</span>
                    <span className="flex items-center" style={{
                      gap: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)",
                    }}>
                      <span>{job.nextRun}</span>
                      <span>·</span>
                      <span className="truncate">{job.machine} · {job.bee}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
