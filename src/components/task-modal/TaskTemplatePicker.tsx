"use client";

import * as React from "react";
import styles from "./task-modal.module.css";
import {
  TASK_TEMPLATE_PAGE_SIZE,
  TASK_TEMPLATES,
  taskTemplateSearchText,
  type TaskTemplateDefinition,
} from "./task-templates";

const TEMPLATE_FILTERS = ["All", "AEON", "Loop", "Brain", "Ops", "Channels", "Simulation", "Security"] as const;

export function TaskTemplatePicker({
  onSelect,
  pageSize = TASK_TEMPLATE_PAGE_SIZE,
  selectedId,
  templates = TASK_TEMPLATES,
}: {
  onSelect: (template: TaskTemplateDefinition) => void;
  pageSize?: number;
  selectedId?: string | null;
  templates?: TaskTemplateDefinition[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<(typeof TEMPLATE_FILTERS)[number]>("All");
  const [page, setPage] = React.useState(0);

  const updateQuery = (value: string) => {
    setPage(0);
    setQuery(value);
  };

  const updateFilter = (value: (typeof TEMPLATE_FILTERS)[number]) => {
    setPage(0);
    setFilter(value);
  };

  const filtered = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesFilter = filter === "All"
        || template.section === filter
        || template.badges.some((badge) => badge.toLowerCase() === filter.toLowerCase())
        || (filter === "Loop" && template.badges.some((badge) => badge.toLowerCase().includes("loop")));
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return taskTemplateSearchText(template).includes(normalizedQuery);
    });
  }, [filter, query, templates]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleTemplates = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className={styles.templatePicker}>
      <div className={styles.templateToolbar}>
        <label className={styles.templateSearch}>
          <span>Search templates</span>
          <input
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search by outcome, skill, or loop"
            spellCheck={false}
          />
        </label>
        <div className={styles.templateFilters} role="list" aria-label="Template filters">
          {TEMPLATE_FILTERS.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={filter === item}
              data-active={filter === item ? "true" : undefined}
              onClick={() => updateFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.templateGrid}>
        {visibleTemplates.length ? visibleTemplates.map((template) => {
          const active = selectedId === template.id;
          return (
            <button
              type="button"
              key={template.id}
              className={styles.templateCard}
              data-active={active ? "true" : undefined}
              onClick={() => onSelect(template)}
            >
              <span className={styles.templateCardTop}>
                <strong>{template.label}</strong>
                <span>{template.section}</span>
              </span>
              <small>{template.id}</small>
              <span>{template.desc}</span>
              <span className={styles.templateBadgeRow}>
                {template.credit ? <b>{template.credit}</b> : null}
                {template.badges.map((badge) => <em key={badge}>{badge}</em>)}
              </span>
            </button>
          );
        }) : (
          <div className={styles.templateEmpty}>No templates match this filter.</div>
        )}
      </div>
      <div className={styles.templatePager}>
        <span>{filtered.length} templates - page {safePage + 1} of {pageCount}</span>
        <div>
          <button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Prev</button>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      </div>
    </div>
  );
}
