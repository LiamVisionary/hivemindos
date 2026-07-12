"use client";

import React from "react";
import { Panel, SectionLabel } from "./primitives";
import { summarizeImportedSchedule, type ImportedScheduleOccurrence, type ImportedScheduleSummary } from "./imported-schedule-summary";
import type { Colony } from "./types";
import type { ImportedSchedule, ImportedScript, ImportedService, ImportedWorkflow } from "@/lib/types/company-import";

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-2)", padding: "13px 14px" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 25, fontWeight: 650, color: value ? "var(--honey)" : "var(--fg-4)", lineHeight: 1 }}>{value}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 7 }}>{label}</div>
    </div>
  );
}

function Row({ title, meta, path, children }: { title: string; meta?: string; path?: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg-2)", padding: "11px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 650, color: "var(--fg)", lineHeight: 1.25, wordBreak: "break-word" }}>{title}</span>
        {meta ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)", lineHeight: 1.35, wordBreak: "break-word" }}>{meta}</span> : null}
      </div>
      {children}
      {path ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45, wordBreak: "break-word" }}>{path}</span> : null}
    </div>
  );
}

function WorkflowRow({ workflow }: { workflow: ImportedWorkflow }) {
  return (
    <Row title={workflow.name} meta={workflow.triggers.join(" · ")} path={workflow.path}>
      {workflow.schedules?.length ? (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.45 }}>
          schedule {workflow.schedules.join(" · ")}
        </span>
      ) : null}
    </Row>
  );
}

type ScheduleTimelineRow = {
  schedule: ImportedSchedule;
  summary: ImportedScheduleSummary;
};

type ScheduleTimelineEvent = ScheduleTimelineRow & {
  id: string;
  occurrence: ImportedScheduleOccurrence;
  occurrenceIndex: number;
};

const TIMELINE_VISIBLE_EVENT_COUNT = 5;
const TIMELINE_EVENT_MIN_HEIGHT = 116;
const TIMELINE_VISIBLE_MAX_HEIGHT = TIMELINE_VISIBLE_EVENT_COUNT * TIMELINE_EVENT_MIN_HEIGHT;

function providerLabel(schedule: ImportedSchedule) {
  return schedule.target || schedule.kind.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").filter(Boolean).join(" ");
}

function buildScheduleTimeline(schedules: ImportedSchedule[]) {
  const rows: ScheduleTimelineRow[] = schedules.map((schedule) => ({
    schedule,
    summary: summarizeImportedSchedule(schedule),
  }));
  const events = rows
    .flatMap((row) => row.summary.upcomingOccurrences.slice(0, 4).map((occurrence, occurrenceIndex) => ({
      ...row,
      id: `${row.schedule.id}-${occurrence.atMs}-${occurrenceIndex}`,
      occurrence,
      occurrenceIndex,
    })))
    .sort((left, right) => left.occurrence.atMs - right.occurrence.atMs)
    .slice(0, 12);
  return { rows, events };
}

function TimelinePill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "honey" | "live" }) {
  const toneColor = tone === "live" ? "var(--live)" : tone === "honey" ? "var(--honey)" : "var(--fg-3)";
  return (
    <span style={{ border: "1px solid var(--line-2)", borderRadius: 999, padding: "3px 8px", fontFamily: "var(--f-mono)", fontSize: 10, color: toneColor, lineHeight: 1.3, background: "rgba(148,163,184,0.05)", wordBreak: "break-word" }}>
      {children}
    </span>
  );
}

function ScheduleTimelineItem({ event, first, last }: { event: ScheduleTimelineEvent; first: boolean; last: boolean }) {
  const { schedule, summary, occurrence, occurrenceIndex } = event;
  const source = providerLabel(schedule);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "clamp(72px, 16vw, 94px) 18px minmax(0, 1fr)", gap: 12, alignItems: "stretch", minHeight: TIMELINE_EVENT_MIN_HEIGHT }}>
      <time dateTime={occurrence.iso} style={{ display: "grid", alignContent: "start", gap: 4, paddingTop: 3, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 760, color: "var(--fg)", lineHeight: 1.05 }}>{occurrence.clockLabel}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", lineHeight: 1.35 }}>{occurrence.dateLabel}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--live)", lineHeight: 1.35 }}>{occurrence.relativeLabel}</span>
      </time>
      <div aria-hidden="true" style={{ position: "relative", display: "grid", justifyItems: "center" }}>
        <span style={{ position: "absolute", top: first ? 10 : 0, bottom: last ? "calc(100% - 10px)" : 0, width: 1, background: "linear-gradient(180deg, rgba(94,234,212,0.45), rgba(255,212,90,0.22))" }} />
        <span style={{ position: "relative", zIndex: 1, marginTop: 5, width: 11, height: 11, borderRadius: 999, border: "1px solid rgba(94,234,212,0.75)", background: occurrenceIndex === 0 ? "var(--live)" : "var(--panel-2)", boxShadow: occurrenceIndex === 0 ? "0 0 0 4px rgba(45,212,191,0.12)" : "0 0 0 3px rgba(255,212,90,0.08)" }} />
      </div>
      <div style={{ minWidth: 0, padding: "0 0 16px", borderBottom: last ? "none" : "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 14.5, fontWeight: 720, color: "var(--fg)", lineHeight: 1.25, wordBreak: "break-word" }}>{schedule.name}</span>
          <TimelinePill tone="honey">{source}</TimelinePill>
          <TimelinePill>{summary.cadence}</TimelinePill>
        </div>
        <div style={{ marginTop: 7, display: "grid", gap: 4, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.5 }}>
          <span>Last expected: {summary.previousRun?.compactLabel ?? summary.previousRunTimeLabel}{summary.previousRunRelativeLabel ? ` (${summary.previousRunRelativeLabel})` : ""}</span>
          <span>{summary.sourceTimezone} {"->"} {summary.deviceTimezone}</span>
        </div>
        <details style={{ marginTop: 7 }}>
          <summary style={{ cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.4 }}>Source details</summary>
          <div style={{ display: "grid", gap: 5, marginTop: 7, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45 }}>
            {summary.upcomingCompactLabels.length ? <span>Upcoming: {summary.upcomingCompactLabels.join(" · ")}</span> : null}
            <span>{summary.sourceCron ? `Source cron: ${summary.sourceCron}` : summary.parseError || schedule.detail || "Schedule expression unavailable."}</span>
            <span>{summary.runHistoryLabel}</span>
            {schedule.path ? <span style={{ wordBreak: "break-word" }}>{schedule.path}</span> : null}
          </div>
        </details>
      </div>
    </div>
  );
}

function ScheduleDefinitionRow({ row }: { row: ScheduleTimelineRow }) {
  const { schedule, summary } = row;
  return (
    <div style={{ border: "1px dashed var(--line-2)", borderRadius: 8, padding: "10px 11px", display: "grid", gap: 5, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.45 }}>
      <strong style={{ fontFamily: "var(--f-display)", fontSize: 13, color: "var(--fg-2)" }}>{schedule.name}</strong>
      <span>{summary.parseError || schedule.detail || "No future occurrences could be calculated from the imported expression."}</span>
      {summary.sourceCron ? <span>Source cron: {summary.sourceCron}</span> : null}
    </div>
  );
}

function ScheduleSection({ schedules }: { schedules: ImportedSchedule[] }) {
  const { rows, events } = React.useMemo(() => buildScheduleTimeline(schedules), [schedules]);
  const timezone = rows[0]?.summary.deviceTimezone ?? "";
  const unresolvedRows = rows.filter((row) => !row.summary.upcomingOccurrences.length);
  const timelineScrollable = events.length > TIMELINE_VISIBLE_EVENT_COUNT;
  return (
    <Panel pad="16px">
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{events.length ? `${events.length} upcoming` : schedules.length}{timezone ? ` · ${timezone}` : ""}</span>}>Schedules And Crons</SectionLabel>
      {schedules.length ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.45 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--live)" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--live)" }} />Expected timeline</span>
            <span>{schedules.length} schedules imported</span>
            {timezone ? <span>Device timezone: {timezone}</span> : null}
          </div>
          {events.length ? (
            <div style={{ display: "grid", gap: 0, maxHeight: timelineScrollable ? TIMELINE_VISIBLE_MAX_HEIGHT : undefined, overflowY: timelineScrollable ? "auto" : undefined, overscrollBehavior: "contain", paddingRight: timelineScrollable ? 8 : 0, WebkitOverflowScrolling: "touch" }}>
              {events.map((event, index) => (
                <ScheduleTimelineItem key={event.id} event={event} first={index === 0} last={index === events.length - 1} />
              ))}
            </div>
          ) : (
            <div style={{ border: "1px dashed var(--line-2)", borderRadius: 10, padding: "16px 12px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>No upcoming runs could be calculated from the imported schedule definitions.</div>
          )}
          {unresolvedRows.length ? (
            <details style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <summary style={{ cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.4 }}>{unresolvedRows.length} schedule definitions need review</summary>
              <div style={{ display: "grid", gap: 7, marginTop: 9 }}>
                {unresolvedRows.map((row) => <ScheduleDefinitionRow key={row.schedule.id} row={row} />)}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <div style={{ border: "1px dashed var(--line-2)", borderRadius: 10, padding: "16px 12px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>No schedules or cron jobs were detected yet.</div>
      )}
    </Panel>
  );
}

function ServiceRow({ service }: { service: ImportedService }) {
  return (
    <Row title={service.name} meta={service.kind} path={service.path}>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.45 }}>
        {[service.serviceType, service.schedule, service.detail].filter(Boolean).join(" · ") || "Detected service"}
      </span>
    </Row>
  );
}

function ScriptRow({ script }: { script: ImportedScript }) {
  return (
    <Row title={script.name} meta={script.category} path={script.path}>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.45, wordBreak: "break-word" }}>{script.command}</span>
    </Row>
  );
}

function Section<T>({ title, items, render, empty }: { title: string; items: T[]; render: (item: T) => React.ReactNode; empty: string }) {
  return (
    <Panel pad="16px">
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{items.length}</span>}>{title}</SectionLabel>
      {items.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {items.map((item, index) => <React.Fragment key={index}>{render(item)}</React.Fragment>)}
        </div>
      ) : (
        <div style={{ border: "1px dashed var(--line-2)", borderRadius: 10, padding: "16px 12px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>{empty}</div>
      )}
    </Panel>
  );
}

export function ImportedOperationsPanel({ colony }: { colony: Colony }) {
  const ops = colony.importedOperations;
  if (!ops) {
    return (
      <Panel>
        <SectionLabel>systems</SectionLabel>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", lineHeight: 1.6 }}>
          This company was founded inside HivemindOS. Imported repository systems will appear here when a legacy project is linked.
        </div>
      </Panel>
    );
  }
  const git = ops.git;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>imported legacy company</span>}>source of record</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 15 }}>
          <Stat label="actions" value={ops.workflows.length} />
          <Stat label="schedules" value={ops.schedules.length} />
          <Stat label="services" value={ops.services.length} />
          <Stat label="scripts" value={ops.scripts.length} />
        </div>
        <div style={{ border: "1px solid var(--honey-line)", borderRadius: 10, background: "var(--honey-soft)", padding: "12px 13px", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)", lineHeight: 1.65, wordBreak: "break-word" }}>
          <div>{ops.projectPath || "Repository path not stored"}</div>
          {git ? <div>{[git.repoName || git.remoteUrl, git.branch, git.commit].filter(Boolean).join(" · ")}</div> : null}
          <div style={{ color: "var(--fg-4)" }}>Discovered {new Date(ops.lastDiscoveredAt).toLocaleString()}</div>
          <div style={{ color: "var(--fg-4)" }}>Historical and off-platform revenue carries no HivemindOS fee. Treasury recording remains available for operating history.</div>
        </div>
      </Panel>

      <Section title="GitHub Actions" items={ops.workflows} render={(item) => <WorkflowRow workflow={item} />} empty="No GitHub Actions workflows were detected in this repository." />
      <ScheduleSection schedules={ops.schedules} />
      <Section title="Hosted Services" items={ops.services} render={(item) => <ServiceRow service={item} />} empty="No hosting service manifests were detected yet." />
      <Section title="Package Scripts" items={ops.scripts} render={(item) => <ScriptRow script={item} />} empty="No package scripts were detected." />
      <Panel pad="14px 16px" style={{ borderColor: "var(--line-2)", background: "var(--panel-2)" }}>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
          Tracking {countLabel(ops.workflows.length, "workflow")}, {countLabel(ops.schedules.length, "schedule")}, {countLabel(ops.services.length, "service")}, and {countLabel(ops.scripts.length, "script")} from the imported repository.
        </div>
      </Panel>
    </div>
  );
}
