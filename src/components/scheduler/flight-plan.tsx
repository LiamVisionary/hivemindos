// src/components/scheduler/flight-plan.tsx
"use client";

import * as React from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { BeeIcon } from "./bee-icon";
import { departureClock, departureRel, relLabel, type DecoratedJob } from "./automation-decorate";
import styles from "./scheduler-tokens.module.css";

export type FlightRange = "24h" | "week";

/** Estimated pill width so the lane-packer can avoid overlaps. */
function estWidth(job: DecoratedJob) {
  const label = relLabel(job.nextRunMins);
  return Math.round(56 + job.name.length * 7.1 + label.length * 5.6);
}

interface RibbonProps {
  jobs: DecoratedJob[];
  selectedId: string;
  range: FlightRange;
  zoom: number;
  full: boolean;
  onSelect: (id: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFull: () => void;
}

export function TimelineRibbon({ jobs, selectedId, range, zoom, full, onSelect, onZoomIn, onZoomOut, onToggleFull }: RibbonProps) {
  const horizon = range === "24h" ? 1440 : 10080;
  const pins = jobs.filter((job) => job.nextRunMins != null && (job.nextRunMins as number) <= horizon);
  const tickDefs = range === "24h"
    ? [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({ label: h === 0 ? "now" : `+${h}h`, mins: h * 60 }))
    : [0, 1, 2, 3, 4, 5, 6, 7].map((d) => ({ label: d === 0 ? "now" : `+${d}d`, mins: d * 1440 }));

  return (
    <div className={styles.ribbonCard} style={full ? { flex: "1 1 auto", minHeight: 0, margin: "16px 24px" } : { flex: "0 0 auto", margin: "0 24px 10px" }}>
      <div className={styles.ribbonHead}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>Timeline</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className={styles.toolBtn} title="Zoom out" onClick={onZoomOut}><Minus size={14} aria-hidden /></button>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button type="button" className={styles.toolBtn} title="Zoom in" onClick={onZoomIn}><Plus size={14} aria-hidden /></button>
          <button type="button" className={`${styles.toolBtn} ${styles.toolBtnWide}`} style={{ marginLeft: 6 }} title={full ? "Minimize" : "Expand"} onClick={onToggleFull}>
            <Maximize2 size={12} aria-hidden /> {full ? "Minimize" : "Expand"}
          </button>
        </div>
      </div>
      {pins.length === 0 ? (
        <div style={{ padding: "18px 4px 22px", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          No autonomous runs are scheduled in this window. Only automations owned by a runtime with a known next run appear on the timeline — dashboard-only jobs run on demand.
        </div>
      ) : full ? (
        <VerticalTrack pins={pins} tickDefs={tickDefs} horizon={horizon} zoom={zoom} range={range} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <HorizontalTrack pins={pins} tickDefs={tickDefs} horizon={horizon} zoom={zoom} range={range} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}

interface TrackProps {
  pins: DecoratedJob[];
  tickDefs: Array<{ label: string; mins: number }>;
  horizon: number;
  zoom: number;
  range: FlightRange;
  selectedId: string;
  onSelect: (id: string) => void;
}

function HorizontalTrack({ pins, tickDefs, horizon, zoom, range, selectedId, onSelect }: TrackProps) {
  const trackPx = Math.round((range === "24h" ? 1100 : 1500) * zoom);
  const innerPx = trackPx + 240;
  const lanesEnd: number[] = [];
  const placed = pins.map((job) => {
    const leftX = ((job.nextRunMins as number) / horizon) * trackPx;
    const width = estWidth(job);
    let lane = lanesEnd.findIndex((end) => leftX >= end + 12);
    if (lane === -1) lane = lanesEnd.length;
    lanesEnd[lane] = leftX + width;
    return { job, leftX, top: 6 + lane * 34 };
  });
  const laneCount = Math.max(1, lanesEnd.length);
  const rowsPx = 6 + laneCount * 34 + 6;

  return (
    <div style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
      <div style={{ position: "relative", width: innerPx, minWidth: "100%" }}>
        <div style={{ position: "relative", height: rowsPx }}>
          {placed.map(({ job, leftX, top }) => (
            <Pin key={job.id} job={job} selected={job.id === selectedId} onSelect={onSelect} size={18}
              style={{ left: leftX, top }} />
          ))}
        </div>
        <div style={{ position: "relative", height: 26, flex: "0 0 auto", borderTop: "1px dashed rgba(238,232,220,0.18)", marginTop: 4 }}>
          {tickDefs.map((tick) => (
            <div key={tick.label} style={{ position: "absolute", left: (tick.mins / horizon) * trackPx, top: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <span style={{ width: 1, height: 6, background: "rgba(238,232,220,0.3)" }} />
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)" }}>{tick.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VerticalTrack({ pins, tickDefs, horizon, zoom, range, selectedId, onSelect }: TrackProps) {
  const trackV = Math.round((range === "24h" ? 1500 : 2200) * zoom);
  const colW = 250;
  const GUT = 72;
  const VP = 18;
  const PH = 38;
  const lanesEnd: number[] = [];
  const placed = pins.map((job) => {
    const topY = VP + ((job.nextRunMins as number) / horizon) * trackV;
    let col = lanesEnd.findIndex((end) => topY >= end + 10);
    if (col === -1) col = lanesEnd.length;
    lanesEnd[col] = topY + PH;
    return { job, topY, left: GUT + col * colW };
  });
  const colCount = Math.max(1, lanesEnd.length);

  return (
    <div style={{ overflow: "auto", flex: "1 1 auto", minHeight: 0 }}>
      <div style={{ position: "relative", width: GUT + colCount * colW + 16, minWidth: "100%", height: VP + trackV + 30 }}>
        {tickDefs.map((tick) => (
          <div key={tick.label} style={{ position: "absolute", left: 0, right: 0, top: VP + (tick.mins / horizon) * trackV, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 10, pointerEvents: "none" }}>
            <span style={{ width: 58, flex: "0 0 auto", textAlign: "right", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{tick.label}</span>
            <span style={{ flex: 1, height: 1, background: "rgba(238,232,220,0.12)" }} />
          </div>
        ))}
        {placed.map(({ job, topY, left }) => (
          <Pin key={job.id} job={job} selected={job.id === selectedId} onSelect={onSelect} size={22} style={{ left, top: topY }} />
        ))}
      </div>
    </div>
  );
}

function Pin({ job, selected, onSelect, size, style }: { job: DecoratedJob; selected: boolean; onSelect: (id: string) => void; size: number; style: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(job.id)}
      className={styles.pin}
      style={{
        ...style,
        border: `1px solid ${selected ? "var(--hex-honey-border)" : job.sc.color}`,
        gap: size >= 22 ? 7 : 6,
        padding: size >= 22 ? "4px 12px 4px 5px" : "3px 10px 3px 4px",
      }}
    >
      <BeeIcon role={job.beeRole} workerClass={job.workerClass} size={size} dim={!job.enabled} />
      <span style={{ fontFamily: "var(--f-display)", fontSize: size >= 22 ? 12.5 : 11, fontWeight: 600, color: "var(--foreground)" }}>{job.name}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: size >= 22 ? 10 : 9, color: job.sc.color }}>{relLabel(job.nextRunMins)}</span>
    </button>
  );
}

interface DeparturesProps {
  jobs: DecoratedJob[];
  selectedId: string;
  now: number;
  onSelect: (id: string) => void;
}

export function DeparturesBoard({ jobs, selectedId, now, onSelect }: DeparturesProps) {
  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "10px 24px 24px" }}>
      <div className={styles.depHead}>
        <span>Departs</span><span aria-hidden /><span>Automation</span><span>Where</span><span>Status</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {jobs.map((job) => (
          <div
            key={job.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(job.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(job.id); } }}
            className={`${styles.depRow} ${job.id === selectedId ? styles.depRowSelected : ""}`}
            style={{ opacity: job.enabled ? 1 : 0.6 }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 15, fontWeight: 700, color: "var(--foreground)", letterSpacing: "0.02em" }}>{departureClock(job, now)}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: job.sc.color }}>{departureRel(job)}</span>
            </div>
            <BeeIcon role={job.beeRole} workerClass={job.workerClass} size={30} dim={!job.enabled} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 14.5, fontWeight: 700, color: "var(--foreground)", overflowWrap: "anywhere" }}>{job.name}</div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>{job.bee} · {job.cadence}</div>
            </div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", overflowWrap: "anywhere" }}>{job.machine} · {job.runtime}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className={styles.dot} style={{ color: job.sc.color }} />
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: job.sc.color }}>{job.sc.word}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
