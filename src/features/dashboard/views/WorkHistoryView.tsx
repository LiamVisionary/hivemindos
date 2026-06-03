"use client";

import { useMemo, type ReactNode } from "react";
import { Boxes, Database, FolderGit2, GitCommitHorizontal, Search, ShieldCheck } from "lucide-react";

import type { WorkView } from "@/features/dashboard/dashboard-types";
import type { WorkHistoryEntry, WorkHistoryPayload, WorkHistoryProject } from "@/lib/types/work-history";
import { WorkSectionHeader, type SectionHeaderStat } from "./WorkSectionHeader";
import styles from "./WorkHistoryView.module.css";

export type WorkHistoryViewProps = {
  activeView: WorkView;
  error?: string;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onProjectChange: (projectId: string) => void;
  onQueryChange: (value: string) => void;
  onSelectMode: (mode: WorkView) => void;
  openCount: number;
  project: string;
  query: string;
  renderSummary?: (text: string) => ReactNode;
  workHistory: WorkHistoryPayload;
};

type Tone = "green" | "honey" | "rose" | "violet" | "cyan";

const TONE_VAR: Record<Tone, string> = {
  cyan: "var(--accent, #2dd4bf)",
  green: "var(--accent, #2dd4bf)",
  honey: "var(--honey, #f2b705)",
  rose: "var(--danger, #fb7185)",
  violet: "#a78bfa",
};

const PROJECT_COLORS = ["#2dd4bf", "#a78bfa", "#f2b705", "#4f7dff", "#5eead4", "#fb7185"];

function projectColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

function statusTone(status?: string): Tone {
  const normalizedStatus = (status || "").toLowerCase();
  if (/revert|fail|block|error|reject/.test(normalizedStatus)) return "rose";
  if (/uncommit|open|draft|wip|todo|pending change/.test(normalizedStatus)) return "honey";
  if (/review|pending|progress|queue|staged/.test(normalizedStatus)) return "violet";
  if (/merg|commit|done|complete|ship|closed|landed/.test(normalizedStatus)) return "green";
  return "cyan";
}

function sourceMeta(source: WorkHistoryProject["source"]) {
  if (source === "vault") return { icon: Database, label: "vault" };
  if (source === "projects") return { icon: Boxes, label: "projects" };
  return { icon: FolderGit2, label: "workspace" };
}

function dayLabel(sortTime: number): string {
  if (!Number.isFinite(sortTime) || sortTime <= 0) return "Earlier";
  const date = new Date(sortTime < 1e12 ? sortTime * 1000 : sortTime);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (dayDelta <= 0) return "Today";
  if (dayDelta === 1) return "Yesterday";
  if (dayDelta < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function splitAreas(areas?: string): string[] {
  if (!areas) return [];
  return areas.split(/[,.|]/).map((area) => area.trim()).filter(Boolean).slice(0, 6);
}

function HistoryEntry({ entry, renderSummary }: { entry: WorkHistoryEntry; renderSummary?: (text: string) => ReactNode }) {
  const tone = statusTone(entry.status);
  const source = sourceMeta(entry.source);
  const SourceIcon = source.icon;
  const areas = splitAreas(entry.areas);
  return (
    <article className={styles.item} style={{ ["--tone" as string]: TONE_VAR[tone] }}>
      <div className={styles.meta}>
        {entry.timestamp ? <span className={styles.time}>{entry.timestamp}</span> : null}
        {entry.status ? (
          <span className={styles.status} data-tone={tone}>
            <span className={styles.statusDot} />
            {entry.status}
          </span>
        ) : null}
        <span className={styles.project} style={{ ["--proj" as string]: projectColor(entry.projectId) }}>
          {entry.projectName}
        </span>
        <span className={styles.source}>
          <SourceIcon aria-hidden="true" />
          {source.label}
        </span>
      </div>
      <h3 className={styles.title}>{entry.title}</h3>
      {areas.length ? (
        <div className={styles.areas}>
          {areas.map((area) => <span className={styles.area} key={area}>{area}</span>)}
        </div>
      ) : null}
      {entry.summary ? (
        <div className={styles.summary}>
          {renderSummary ? renderSummary(entry.summary) : <p>{entry.summary}</p>}
        </div>
      ) : null}
      {entry.commitSummary || entry.verification ? (
        <div className={styles.foot}>
          {entry.commitSummary ? (
            <span className={`${styles.badge} ${styles.badgeCommit}`}>
              <GitCommitHorizontal aria-hidden="true" />
              <code>{entry.commitSummary}</code>
            </span>
          ) : null}
          {entry.verification ? (
            <span className={`${styles.badge} ${styles.badgeVerified}`}>
              <ShieldCheck aria-hidden="true" />
              {entry.verification}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function WorkHistoryView({
  activeView,
  error,
  loading,
  loadingMore,
  onLoadMore,
  onProjectChange,
  onQueryChange,
  onSelectMode,
  openCount,
  project,
  query,
  renderSummary,
  workHistory,
}: WorkHistoryViewProps) {
  const total = workHistory.totalEntries ?? workHistory.entries.length;
  const stats: SectionHeaderStat[] = [
    { value: workHistory.entries.length, label: "shown", tone: "cyan" },
    { value: workHistory.projects.length, label: "projects", tone: "honey" },
    { value: openCount, label: "open", tone: "danger" },
    { value: total, label: "total" },
  ];

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, WorkHistoryEntry[]>();
    for (const entry of workHistory.entries) {
      const key = dayLabel(entry.sortTime);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)?.push(entry);
    }
    return order.map((key) => [key, map.get(key) ?? []] as const);
  }, [workHistory.entries]);

  const showSkeleton = loading && !workHistory.entries.length;

  return (
    <>
      <WorkSectionHeader
        activeView={activeView}
        onSelect={onSelectMode}
        title="History"
        subtitle="Dynamic changelog"
        stats={stats}
      />

      <div className={styles.controls} aria-label="History filters">
        <div className={styles.chips} role="group" aria-label="Filter by project">
          <button
            type="button"
            className={`${styles.chip} ${project === "" ? styles.chipOn : ""}`}
            aria-pressed={project === ""}
            onClick={() => onProjectChange("")}
          >
            <span className={styles.chipDot} />
            all <b>{total}</b>
          </button>
          {workHistory.projects.map((workProject) => (
            <button
              type="button"
              key={workProject.id}
              className={`${styles.chip} ${project === workProject.id ? styles.chipOn : ""}`}
              aria-pressed={project === workProject.id}
              onClick={() => onProjectChange(workProject.id)}
            >
              <span className={styles.chipDot} style={{ background: projectColor(workProject.id), opacity: 1 }} />
              {workProject.name}
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="title, summary, status..." aria-label="Search history" />
        </label>
        <span className={styles.feed}>
          <span className={styles.feedDot} aria-hidden="true" />
          {loading ? "scanning" : "changelog feed"}
        </span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {showSkeleton ? (
        <div className={styles.list}>
          <section className={styles.day}>
            <span className={styles.dayLabel}>Scanning changelogs</span>
            <div className={styles.track}>
              {Array.from({ length: 3 }).map((_, index) => (
                <div className={styles.skeleton} key={`history-skeleton-${index}`} aria-hidden="true">
                  <span />
                  <strong />
                  <p />
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : workHistory.entries.length ? (
        <div className={styles.list}>
          {groups.map(([day, entries]) => (
            <section className={styles.day} key={day}>
              <span className={styles.dayLabel}>
                {day}
                <span className={styles.dayCount}>/ {entries.length}</span>
              </span>
              <div className={styles.track}>
                {entries.map((entry) => <HistoryEntry key={entry.id} entry={entry} renderSummary={renderSummary} />)}
              </div>
            </section>
          ))}
          {workHistory.hasMore ? (
            <button type="button" className={styles.more} disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading more..." : `Load 10 more (${workHistory.entries.length}/${total})`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>No changelog entries found</strong>
          <p>No matching project updates are available yet.</p>
        </div>
      )}
    </>
  );
}
