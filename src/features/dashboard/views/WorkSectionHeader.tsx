"use client";

import type { ReactNode } from "react";
import type { WorkView } from "@/features/dashboard/dashboard-types";
import styles from "./work-section-header.module.css";

export type SectionHeaderStat = {
  label: string;
  tone?: "cyan" | "honey" | "danger" | "plain";
  value: number | string;
};

export type SectionHeaderMode<TMode extends string = string> = {
  id: TMode;
  label: string;
};

type SectionModeHeaderProps<TMode extends string> = {
  actions?: ReactNode;
  activeMode: TMode;
  ariaLabel: string;
  modes: Array<SectionHeaderMode<TMode>>;
  onSelect: (mode: TMode) => void;
  stats: SectionHeaderStat[];
  subtitle: ReactNode;
  title: ReactNode;
};

type WorkSectionHeaderProps = {
  activeView: WorkView;
  onSelect: (mode: WorkView) => void;
  stats: SectionHeaderStat[];
  subtitle: string;
  title: string;
};

const WORK_MODES: Array<SectionHeaderMode<WorkView>> = [
  { id: "kanban", label: "Workboard" },
  { id: "scheduler", label: "Automations" },
  { id: "swarm", label: "Simulation" },
  { id: "history", label: "History" },
];

export function SectionModeHeader<TMode extends string>({
  actions,
  activeMode,
  ariaLabel,
  modes,
  onSelect,
  stats,
  subtitle,
  title,
}: SectionModeHeaderProps<TMode>) {
  const hasModes = modes.length > 0;
  return (
    <header className={`${styles.header} ${hasModes ? "" : styles.noModes}`} data-work-section-header="true">
      <div className={styles.titleBlock}>
        <div className={styles.titleText}>{title}</div>
        <span>{subtitle}</span>
      </div>
      {hasModes ? (
        <nav className={styles.modeRail} role="tablist" aria-label={ariaLabel}>
          {modes.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeMode === id}
              className={activeMode === id ? styles.activeMode : undefined}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={styles.rightBlock}>
        <div className={styles.stats} aria-label={`${ariaLabel} summary`}>
          {stats.map((stat) => (
            <span className={stat.tone ? styles[stat.tone] : undefined} key={stat.label}>
              <strong>{stat.value}</strong>
              {stat.label}
            </span>
          ))}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </header>
  );
}

export function WorkSectionHeader({ activeView, onSelect, stats, subtitle, title }: WorkSectionHeaderProps) {
  return (
    <SectionModeHeader
      activeMode={activeView}
      ariaLabel="Work view mode"
      modes={WORK_MODES}
      onSelect={onSelect}
      stats={stats}
      subtitle={subtitle}
      title={title}
    />
  );
}
