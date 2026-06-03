"use client";

import * as React from "react";
import { Icon, Pill, aeonStyles as styles, type IconName, type Tone } from "@/components/aeon/parts";

export type UnifiedSkillBrowserItem = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  source?: string;
  sourceId?: string;
  sourceKind?: string;
  providerId?: string;
  category?: string;
  categoryId?: string;
  categoryColor?: string;
  stateLabel?: string;
  stateTone?: Tone;
  stateIcon?: IconName;
  stateActive?: boolean;
  scheduleLabel?: string;
  model?: string;
  capabilities?: string[];
  envKeys?: string[];
  audience?: string;
  safety?: string;
  auditStatus?: string;
  sourceRef?: string;
  includedSkills?: Array<{ slug: string; name: string; description?: string }>;
  imported?: boolean;
  requiresHermesUpdate?: boolean;
  selected?: boolean;
  disabled?: boolean;
};

export type UnifiedSkillBrowserSource = {
  id: string;
  label: string;
  predicate?: (item: UnifiedSkillBrowserItem) => boolean;
};

export type UnifiedSkillBrowserCategory = {
  id: string;
  label: string;
  color?: string;
};

type UnifiedSkillBrowserProps = {
  items: UnifiedSkillBrowserItem[];
  categories?: UnifiedSkillBrowserCategory[];
  sources?: UnifiedSkillBrowserSource[];
  density?: "aeon" | "compact";
  showCardDescription?: boolean;
  showCategoryFilters?: boolean;
  showDefaultDetail?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  controlledSourceId?: string;
  onSourceChange?: (sourceId: string) => void;
  selectedItemId?: string | null;
  onSelectItem?: (item: UnifiedSkillBrowserItem) => void;
  renderActions?: (item: UnifiedSkillBrowserItem) => React.ReactNode;
  renderDetail?: (item: UnifiedSkillBrowserItem | undefined) => React.ReactNode;
};

function normalizeSearch(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function itemSearchText(item: UnifiedSkillBrowserItem) {
  const includedSkills = item.includedSkills?.flatMap((skill) => [skill.slug, skill.name, skill.description]) ?? [];
  return [
    item.name,
    item.slug,
    item.description,
    item.source,
    item.sourceId,
    item.sourceKind,
    item.category,
    item.categoryId,
    item.stateLabel,
    item.scheduleLabel,
    item.model,
    item.audience,
    item.safety,
    item.auditStatus,
    item.sourceRef,
    ...(item.capabilities ?? []),
    ...(item.envKeys ?? []),
    ...includedSkills,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuery(item: UnifiedSkillBrowserItem, query: string) {
  if (!query) return true;
  return itemSearchText(item).includes(query);
}

function defaultCategoryLabel(item: UnifiedSkillBrowserItem) {
  return item.category ?? item.categoryId ?? "Skill";
}

function categoryForItem(item: UnifiedSkillBrowserItem) {
  return item.categoryId ?? item.category ?? "uncategorized";
}

function buildDerivedCategories(items: UnifiedSkillBrowserItem[]): UnifiedSkillBrowserCategory[] {
  const categories = new Map<string, UnifiedSkillBrowserCategory>();
  for (const item of items) {
    const id = categoryForItem(item);
    if (!categories.has(id)) {
      categories.set(id, {
        id,
        label: defaultCategoryLabel(item),
        color: item.categoryColor,
      });
    }
  }
  return Array.from(categories.values());
}

function SkillCategoryChip({ active, color, count, label, onClick }: { active: boolean; color?: string; count: number; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.interactiveSubtle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 11px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${active ? "var(--aeon-line)" : "var(--line)"}`,
        background: active ? "var(--aeon-soft)" : "rgba(2,6,23,0.32)",
        color: active ? "var(--cyan-3)" : "var(--fg-3)",
        transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease",
      }}
      onMouseDown={(event) => {
        event.currentTarget.style.transform = "translateY(1px) scale(0.99)";
      }}
      onMouseUp={(event) => {
        event.currentTarget.style.transform = "none";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "none";
      }}
    >
      {color ? <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color }} /> : null}
      {label}
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, border: "1px solid var(--line)", color: "var(--fg-4)" }}>{count}</span>
    </button>
  );
}

function SkillCard({
  density,
  item,
  selected,
  onSelect,
  renderActions,
  showDescription,
}: {
  density: "aeon" | "compact";
  item: UnifiedSkillBrowserItem;
  selected: boolean;
  onSelect?: (item: UnifiedSkillBrowserItem) => void;
  renderActions?: (item: UnifiedSkillBrowserItem) => React.ReactNode;
  showDescription: boolean;
}) {
  const categoryLabel = defaultCategoryLabel(item);
  const categoryColor = item.categoryColor ?? "var(--aeon)";
  const actions = renderActions?.(item);
  const compact = density === "compact";

  return (
    <article
      data-selected={selected ? "true" : "false"}
      onClick={() => {
        if (!item.disabled) onSelect?.(item);
      }}
      className={styles.interactiveSubtle}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 8 : 11,
        minHeight: compact ? 0 : 190,
        padding: compact ? 12 : 14,
        borderRadius: compact ? 10 : 11,
        cursor: item.disabled ? "not-allowed" : "pointer",
        opacity: item.disabled ? 0.58 : 1,
        border: `1px solid ${selected || item.selected ? "var(--aeon-line)" : "var(--line)"}`,
        background: selected || item.selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
        transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease, filter 140ms ease",
      }}
      onMouseDown={(event) => {
        event.currentTarget.style.transform = "translateY(1px) scale(0.995)";
      }}
      onMouseUp={(event) => {
        event.currentTarget.style.transform = "none";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: compact ? 13.5 : 14, fontWeight: 600, color: "var(--fg)", lineHeight: 1.25, overflowWrap: "anywhere" }}>{item.name}</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 10.5, fontFamily: "var(--f-mono)", textTransform: "uppercase", letterSpacing: 0, color: "var(--fg-4)" }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: categoryColor }} />
            {categoryLabel}
          </span>
        </div>
        {item.stateLabel ? (
          <Pill tone={item.stateTone ?? "muted"} icon={item.stateIcon} dot={item.stateActive} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            {item.stateLabel}
          </Pill>
        ) : null}
      </div>

      {showDescription ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{item.description || "No description provided yet."}</p>
      ) : null}

      {!compact && item.audience ? <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-4)" }}>{item.audience}</p> : null}

      {!compact && item.capabilities?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} aria-label="Skill capabilities">
          {item.capabilities.slice(0, 8).map((capability) => (
            <Pill key={capability} tone="muted" style={{ fontSize: 10, padding: "3px 7px" }}>{capability}</Pill>
          ))}
        </div>
      ) : null}

      {!compact && item.includedSkills?.length ? (
        <div style={{ display: "grid", gap: 7, padding: 9, borderRadius: 9, background: "rgba(2,6,23,0.28)", border: "1px solid var(--line)" }}>
          {item.includedSkills.slice(0, 4).map((includedSkill) => (
            <div key={includedSkill.slug}>
              <strong style={{ display: "block", fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.25 }}>{includedSkill.name}</strong>
              {includedSkill.description ? <p style={{ margin: "2px 0 0", fontSize: 11, lineHeight: 1.35, color: "var(--fg-4)" }}>{includedSkill.description}</p> : null}
            </div>
          ))}
          {item.includedSkills.length > 4 ? <span style={{ fontSize: 11, color: "var(--fg-4)" }}>+{item.includedSkills.length - 4} more skills in this pack</span> : null}
        </div>
      ) : null}

      {!compact && item.safety ? <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: "var(--honey-2)" }}>{item.safety}</p> : null}

      {!compact && (item.auditStatus || item.envKeys?.length || item.sourceRef) ? (
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-4)", overflowWrap: "anywhere" }}>
          {item.auditStatus ? `Audit: ${item.auditStatus}. ` : ""}
          {item.envKeys?.length ? `Env: ${item.envKeys.slice(0, 4).join(", ")}. ` : ""}
          {item.sourceRef ? `Source: ${item.sourceRef}.` : ""}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: "auto", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", overflowWrap: "anywhere" }}>
          {item.scheduleLabel || item.model || item.source || ""}
        </span>
        {actions ? (
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, flexWrap: "wrap" }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DetailLine({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <span style={{ fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", textTransform: "uppercase", letterSpacing: 0 }}>{label}</span>
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function DefaultSkillDetail({ item, renderActions }: { item: UnifiedSkillBrowserItem | undefined; renderActions?: (item: UnifiedSkillBrowserItem) => React.ReactNode }) {
  if (!item) {
    return (
      <section style={{ display: "grid", gap: 6, padding: 13, borderRadius: 12, border: "1px dashed var(--line)", background: "rgba(2,6,23,0.26)", color: "var(--fg-3)" }}>
        <strong style={{ color: "var(--fg)" }}>Select a skill</strong>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>Pick a skill to inspect its source, requirements, and full description.</p>
      </section>
    );
  }
  const actions = renderActions?.(item);
  return (
    <section style={{ display: "grid", gap: 12, padding: 14, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", textTransform: "uppercase", letterSpacing: 0 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: item.categoryColor ?? "var(--aeon)" }} />
            {defaultCategoryLabel(item)}
          </span>
          <h3 style={{ margin: "5px 0 0", fontSize: 17, lineHeight: 1.2, color: "var(--fg)", overflowWrap: "anywhere" }}>{item.name}</h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {item.stateLabel ? (
            <Pill tone={item.stateTone ?? "muted"} icon={item.stateIcon} dot={item.stateActive} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
              {item.stateLabel}
            </Pill>
          ) : null}
          {actions ? <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>{actions}</div> : null}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--fg-2)", overflowWrap: "anywhere" }}>{item.description || "No description provided yet."}</p>
      {item.capabilities?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {item.capabilities.map((capability) => <Pill key={capability} tone="muted" style={{ fontSize: 10.5, padding: "3px 7px" }}>{capability}</Pill>)}
        </div>
      ) : null}
      {item.includedSkills?.length ? (
        <div style={{ display: "grid", gap: 8, padding: 10, borderRadius: 10, border: "1px solid var(--line)", background: "rgba(2,6,23,0.24)" }}>
          {item.includedSkills.map((includedSkill) => (
            <div key={includedSkill.slug}>
              <strong style={{ display: "block", fontSize: 12, color: "var(--fg-2)" }}>{includedSkill.name}</strong>
              {includedSkill.description ? <p style={{ margin: "2px 0 0", fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-4)" }}>{includedSkill.description}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <DetailLine label="Source" value={item.sourceRef || item.source} />
        <DetailLine label="Audience" value={item.audience} />
        <DetailLine label="Model" value={item.model} />
        <DetailLine label="Schedule" value={item.scheduleLabel} />
        <DetailLine label="Audit" value={item.auditStatus} />
        <DetailLine label="Environment" value={item.envKeys?.join(", ")} />
        <DetailLine label="Safety" value={item.safety} />
      </div>
    </section>
  );
}

export function UnifiedSkillBrowser({
  items,
  categories,
  sources,
  density = "aeon",
  showCardDescription = true,
  showCategoryFilters = true,
  showDefaultDetail = false,
  query: controlledQuery,
  onQueryChange,
  searchPlaceholder = "Search skills",
  toolbar,
  loading,
  loadingLabel = "Loading skills",
  emptyTitle = "No skills found",
  emptyDescription = "Try another search or filter.",
  controlledSourceId,
  onSourceChange,
  selectedItemId,
  onSelectItem,
  renderActions,
  renderDetail,
}: UnifiedSkillBrowserProps) {
  const [internalQuery, setInternalQuery] = React.useState("");
  const [internalSourceId, setInternalSourceId] = React.useState(sources?.[0]?.id ?? "all");
  const [categoryId, setCategoryId] = React.useState("all");
  const [internalSelectedId, setInternalSelectedId] = React.useState<string | null>(null);
  const query = controlledQuery ?? internalQuery;
  const normalizedQuery = normalizeSearch(query);
  const activeSourceId = controlledSourceId ?? internalSourceId;
  const activeSource = sources?.find((source) => source.id === activeSourceId) ?? sources?.[0];
  const sourceFilteredItems = activeSource?.predicate ? items.filter(activeSource.predicate) : items;
  const derivedCategories = categories ?? buildDerivedCategories(sourceFilteredItems);
  const availableCategories = derivedCategories
    .map((category) => ({
      ...category,
      count: sourceFilteredItems.filter((item) => categoryForItem(item) === category.id).length,
    }))
    .filter((category) => category.count > 0);
  const activeCategoryId = categoryId === "all" || availableCategories.some((category) => category.id === categoryId) ? categoryId : "all";
  const categoryFilteredItems = activeCategoryId === "all"
    ? sourceFilteredItems
    : sourceFilteredItems.filter((item) => categoryForItem(item) === activeCategoryId);
  const visibleItems = categoryFilteredItems.filter((item) => matchesQuery(item, normalizedQuery));
  const effectiveSelectedItemId = selectedItemId === undefined ? internalSelectedId : selectedItemId;
  const selectedItem = visibleItems.find((item) => item.id === effectiveSelectedItemId || item.slug === effectiveSelectedItemId);
  const compact = density === "compact";

  const updateQuery = (nextQuery: string) => {
    if (onQueryChange) {
      onQueryChange(nextQuery);
      return;
    }
    setInternalQuery(nextQuery);
  };

  const updateSource = (sourceId: string) => {
    setCategoryId("all");
    if (onSourceChange) {
      onSourceChange(sourceId);
      return;
    }
    setInternalSourceId(sourceId);
  };

  const selectItem = (item: UnifiedSkillBrowserItem) => {
    if (onSelectItem) {
      onSelectItem(item);
      return;
    }
    setInternalSelectedId(item.id);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: sources && sources.length > 0 ? "minmax(220px, 300px) minmax(260px, 1fr) auto" : "minmax(260px, 1fr) auto", gap: 10, alignItems: "center" }}>
        {sources && sources.length > 0 ? (
          <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)" }}>
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => updateSource(source.id)}
                className={styles.interactiveSubtle}
                style={{
                  flex: 1,
                  padding: "6px 13px",
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: 0,
                  color: activeSource?.id === source.id ? "var(--cyan-3)" : "var(--fg-3)",
                  background: activeSource?.id === source.id ? "var(--aeon-soft)" : "transparent",
                }}
              >
                {source.label}
              </button>
            ))}
          </div>
        ) : null}
        <label style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--fg-4)" }}>
            <Icon name="search" size={15} />
          </span>
          <input
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            style={{
              width: "100%",
              padding: "9px 12px 9px 34px",
              borderRadius: 9,
              fontSize: 13,
              background: "rgba(2,6,23,0.5)",
              border: "1px solid var(--line-2)",
              color: "var(--fg)",
              fontFamily: "var(--f-body)",
              outline: "none",
            }}
          />
        </label>
        {toolbar ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{toolbar}</div> : null}
      </div>

      {showCategoryFilters && availableCategories.length ? (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <SkillCategoryChip label="All" active={activeCategoryId === "all"} count={sourceFilteredItems.length} onClick={() => setCategoryId("all")} />
          {availableCategories.map((category) => (
            <SkillCategoryChip
              key={category.id}
              label={category.label}
              color={category.color}
              count={category.count}
              active={activeCategoryId === category.id}
              onClick={() => setCategoryId(category.id)}
            />
          ))}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "grid", placeItems: "center", gap: 8, minHeight: compact ? 132 : 180, padding: 18, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg-soft)", color: "var(--fg-3)" }}>
          <Icon name="refresh" size={18} />
          <strong style={{ color: "var(--fg)" }}>{loadingLabel}</strong>
        </div>
      ) : visibleItems.length ? (
        <div style={{ display: "grid", gap: compact ? 8 : 11, gridTemplateColumns: compact ? "repeat(auto-fill, minmax(188px, 1fr))" : "repeat(auto-fill, minmax(248px, 1fr))" }}>
          {visibleItems.map((item) => (
            <SkillCard
              key={`${item.source ?? "skill"}-${item.id}`}
              density={density}
              item={item}
              selected={Boolean((effectiveSelectedItemId && (item.id === effectiveSelectedItemId || item.slug === effectiveSelectedItemId)) || item.selected)}
              onSelect={selectItem}
              renderActions={renderActions}
              showDescription={showCardDescription}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", placeItems: "center", gap: 6, minHeight: compact ? 132 : 180, padding: 18, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg-soft)", color: "var(--fg-3)", textAlign: "center" }}>
          <Icon name="sparkles" size={18} />
          <strong style={{ color: "var(--fg)" }}>{emptyTitle}</strong>
          <p style={{ margin: 0, maxWidth: 420, fontSize: 12.5, lineHeight: 1.5 }}>{emptyDescription}</p>
        </div>
      )}

      {renderDetail ? renderDetail(selectedItem) : showDefaultDetail ? <DefaultSkillDetail item={selectedItem} renderActions={renderActions} /> : null}
    </div>
  );
}
