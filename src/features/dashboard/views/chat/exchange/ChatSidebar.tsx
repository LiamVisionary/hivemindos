"use client";

/* Chat-route sidebar, ported from the `Chat route UI redesign` prototype:
 * brand, search, new chat, a Views menu (status / machine /
 * activity filters + group-by + sort-by), a Pinned section, a General section,
 * grouped project/machine/agent/date sections, and a per-row kebab menu
 * (duplicate / archive / delete).
 *
 * Every preference is durable via `useChatViewPreferences` (dashboard state —
 * localStorage is banned). Grouping/sorting/filtering are the pure helpers in
 * `chat-thread-actions.ts`.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ChatThreadActivityFilter,
  ChatThreadGroupBy,
  ChatThreadRow,
  ChatThreadSortBy,
  ChatThreadStatusFilter,
} from "./chat-thread-actions";
import {
  applyChatThreadFilters,
  CHAT_HISTORY_PAGE_SIZE,
  groupChatThreads,
  nextChatHistoryVisibleCount,
  sortChatThreads,
} from "./chat-thread-actions";
import type { UseChatViewPreferences } from "./use-chat-view-preferences";
import { ICON_PATHS, Ico, POP_STYLE, SearchIco } from "./composer-primitives";

export type SidebarRow = ChatThreadRow & {
  active?: boolean;
  running?: boolean;
  capabilityApprovalPending?: boolean;
  subtitle?: string;
  onOpen?: () => void;
  onStartChat?: () => void;
};

type MenuAnchor = { key: string; x: number; y: number };

const STATUS_OPTS: Array<[ChatThreadStatusFilter, string]> = [["all", "All"], ["active", "Active"], ["idle", "Idle"]];
const ACTIVITY_OPTS: Array<[ChatThreadActivityFilter, string]> = [["all", "All"], ["today", "Today"], ["week", "This week"], ["month", "This month"]];
const GROUP_OPTS: Array<[ChatThreadGroupBy, string]> = [["project", "Project"], ["machine", "Machine"], ["agent", "Agent"], ["date", "Date"], ["flat", "None (flat)"]];
const SORT_OPTS: Array<[ChatThreadSortBy, string]> = [["recency", "Recency"], ["name", "Name"], ["activity", "Activity"]];

const GROUP_SECTION_LABEL: Record<ChatThreadGroupBy, string> = {
  project: "Projects",
  machine: "Machines",
  agent: "Agents",
  date: "By date",
  flat: "",
};

const eyebrow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "13px 12px 6px",
  fontFamily: "var(--f-body)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  color: "var(--fg-4)",
  textTransform: "uppercase",
};

export type ChatSidebarProps = {
  rows: SidebarRow[];
  machineNames: string[];
  prefs: UseChatViewPreferences;
  search: string;
  onSearchChange: (value: string) => void;
  onNewChat?: () => void;
  onNewGeneralChat?: () => void;
  onCreateProject?: () => void;
  onImportProject?: () => void;
  newChatLabel?: string;
  onDuplicate: (storageKey: string) => void;
  onDelete: (storageKey: string) => void;
  footerLabel: string;
  loading?: boolean;
};

export function ChatSidebar(props: ChatSidebarProps) {
  const {
    rows, machineNames, prefs, search, onSearchChange,
    onNewChat, onNewGeneralChat, onCreateProject, onImportProject,
    newChatLabel, onDuplicate, onDelete, footerLabel, loading,
  } = props;

  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsSub, setViewsSub] = useState<"" | "status" | "machine" | "activity" | "group" | "sort">("");
  const [viewsAnchor, setViewsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<MenuAnchor | null>(null);
  const [visibleChatsByGroup, setVisibleChatsByGroup] = useState<Record<string, number>>({});
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!viewsOpen && !projectMenuAnchor && !rowMenu) return undefined;
    function closeOnOutside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-cx-pop]")) return;
      setViewsOpen(false);
      setViewsSub("");
      setProjectMenuAnchor(null);
      setRowMenu(null);
    }
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [projectMenuAnchor, viewsOpen, rowMenu]);

  // Escape closes whichever popover is open.
  useEffect(() => {
    if (!viewsOpen && !projectMenuAnchor && !rowMenu) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setViewsOpen(false);
      setViewsSub("");
      setProjectMenuAnchor(null);
      setRowMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectMenuAnchor, viewsOpen, rowMenu]);

  const [nowMs] = useState(() => Date.now());

  const visible = useMemo(() => {
    const searched = search.trim()
      ? rows.filter((row) => {
        const hay = [row.title, row.agentName, row.machineName, row.projectLabel].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(search.trim().toLowerCase());
      })
      : rows;
    const notArchived = searched.filter((row) => !prefs.archived.includes(row.storageKey));
    const filtered = applyChatThreadFilters(notArchived, prefs.filters, nowMs);
    return sortChatThreads(filtered, prefs.sortBy);
  // `nowMs` is intentionally excluded: it changes every render and the date
  // buckets only need to be right at mount / on a real data change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, prefs.archived, prefs.filters, prefs.sortBy]);

  const pinnedRows = useMemo(
    () => prefs.pinned.map((key) => visible.find((row) => row.storageKey === key)).filter((row): row is SidebarRow => Boolean(row)),
    [prefs.pinned, visible],
  );
  const rest = useMemo(() => visible.filter((row) => !prefs.pinned.includes(row.storageKey)), [visible, prefs.pinned]);
  const generalRows = useMemo(() => rest.filter((row) => !row.machineName && !row.projectLabel && !row.workingDirectoryPath), [rest]);
  const groupedRows = useMemo(() => rest.filter((row) => !generalRows.includes(row)), [rest, generalRows]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupChatThreads(groupedRows, prefs.groupBy, nowMs), [groupedRows, prefs.groupBy]);

  const sectionLabel = GROUP_SECTION_LABEL[prefs.groupBy];
  const noResults = !pinnedRows.length && !generalRows.length && !groups.length;

  const machineOpts: Array<[string, string]> = [["all", "All"], ...machineNames.map((name) => [name, name] as [string, string])];

  const subConfig = (() => {
    switch (viewsSub) {
      case "status": return { title: "Status", opts: STATUS_OPTS, current: prefs.filters.status, pick: (v: string) => prefs.setFilter("status", v as ChatThreadStatusFilter) };
      case "machine": return { title: "Machine", opts: machineOpts, current: prefs.filters.machine || "all", pick: (v: string) => prefs.setFilter("machine", v) };
      case "activity": return { title: "Last activity", opts: ACTIVITY_OPTS, current: prefs.filters.activity, pick: (v: string) => prefs.setFilter("activity", v as ChatThreadActivityFilter) };
      case "group": return { title: "Group by", opts: GROUP_OPTS, current: prefs.groupBy, pick: (v: string) => prefs.setGroupBy(v as ChatThreadGroupBy) };
      case "sort": return { title: "Sort by", opts: SORT_OPTS, current: prefs.sortBy, pick: (v: string) => prefs.setSortBy(v as ChatThreadSortBy) };
      default: return null;
    }
  })();

  const optLabel = (opts: Array<[string, string]>, value: string) => opts.find(([v]) => v === value)?.[1] ?? value;

  return (
    <aside className="fr-chat-sidebar" aria-label="Chats" style={{ position: "relative", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", minHeight: 0, borderRight: "1px solid var(--line)", background: "color-mix(in srgb, var(--bg-soft) 88%, transparent)" }}>
      {/* The rail title lives in the chat's single top header (ChatExchangePanel)
          so collapsing this rail never takes the header's left edge with it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, minHeight: 34, border: "1px solid var(--line-2)", borderRadius: 9, background: "color-mix(in srgb, var(--bg-soft) 74%, transparent)", padding: "0 10px" }}>
          <SearchIco size={14} />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            spellCheck={false}
            style={{ width: "100%", minWidth: 0, border: 0, outline: 0, background: "transparent", color: "var(--fg)", font: "inherit", fontSize: 12.5 }}
          />
        </label>
      </div>

      <div style={{ padding: "2px 12px 8px" }}>
        <button
          type="button"
          className="cx-newchat"
          onClick={onNewChat}
          disabled={!onNewChat}
          title={newChatLabel}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, borderRadius: 10, background: "transparent", color: onNewChat ? "var(--honey)" : "var(--fg-4)", cursor: onNewChat ? "pointer" : "default", fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 600, padding: "9px 13px" }}
        >
          <Ico d={ICON_PATHS.plus} size={17} sw={2.2} />
          <span>New chat</span>
        </button>
      </div>

      <div className="cx-scroll" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "2px 10px 16px" }}>
        {loading ? <SidebarSkeleton /> : null}

        {!loading && pinnedRows.length ? (
          <section style={{ marginBottom: 12 }}>
            <div style={eyebrow}><Ico d={ICON_PATHS.pin} size={12} fill="currentColor" stroke="none" /><span>Pinned</span></div>
            <RowList rows={pinnedRows} prefs={prefs} onOpenMenu={setRowMenu} activeMenuKey={rowMenu?.key} />
          </section>
        ) : null}

        {!loading && generalRows.length ? (
          <section style={{ marginBottom: 12 }}>
            <div className="cx-rowwrap" style={{ display: "flex", alignItems: "center" }}>
              <div style={{ ...eyebrow, flex: 1 }}><Ico d={ICON_PATHS.chat} size={12} sw={2} /><span>General</span></div>
              {onNewGeneralChat ? (
                <button
                  type="button"
                  className="cx-iconbtn"
                  onClick={onNewGeneralChat}
                  title="New general chat"
                  aria-label="New general chat"
                  style={{ display: "grid", placeItems: "center", width: 22, height: 22, margin: "7px 8px 0 0", border: 0, borderRadius: 7, background: "transparent", color: "var(--fg-3)", cursor: "pointer" }}
                >
                  <Ico d={ICON_PATHS.chat} size={14} sw={1.9} />
                </button>
              ) : null}
            </div>
            <RowList rows={generalRows} prefs={prefs} onOpenMenu={setRowMenu} activeMenuKey={rowMenu?.key} />
          </section>
        ) : null}

        {/* Always rendered. Gating this on `sectionLabel` (empty for "flat")
            would make Views unreachable once the user picks flat grouping —
            they could never switch back. */}
        {!loading ? (
          <div className="cx-rowwrap" style={{ position: "relative", minHeight: 24 }}>
            <div style={{ padding: "4px 12px 2px", fontFamily: "var(--f-body)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "var(--fg-4)", textTransform: "uppercase" }}>{sectionLabel}</div>
            <div data-cx-pop style={{ position: "absolute", right: 8, top: 2, display: "flex", alignItems: "center", gap: 2 }}>
              {prefs.groupBy === "project" && (onCreateProject || onImportProject) ? (
                <button
                  type="button"
                  className="cx-iconbtn"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setProjectMenuAnchor((current) => current ? null : { x: rect.right, y: rect.bottom + 8 });
                    setViewsOpen(false);
                    setViewsSub("");
                  }}
                  aria-expanded={Boolean(projectMenuAnchor)}
                  aria-haspopup="menu"
                  title="Add a project"
                  aria-label="Add a project"
                  style={{ display: "grid", placeItems: "center", width: 22, height: 22, border: 0, borderRadius: 7, background: "transparent", color: projectMenuAnchor ? "var(--honey)" : "var(--fg-3)", cursor: "pointer" }}
                >
                  <Ico d={ICON_PATHS.plus} size={15} sw={2.1} />
                </button>
              ) : null}
              <button
                type="button"
                className="cx-iconbtn"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setViewsAnchor({ x: rect.left, y: rect.bottom + 8 });
                  setViewsSub("");
                  setViewsOpen((open) => !open);
                  setProjectMenuAnchor(null);
                }}
                aria-expanded={viewsOpen}
                title="Filter & group chats"
                aria-label="Filter and group chats"
                style={{ display: "grid", placeItems: "center", width: 22, height: 22, border: 0, borderRadius: 7, background: "transparent", color: viewsOpen || prefs.viewsChanged ? "var(--honey)" : "var(--fg-3)", cursor: "pointer" }}
              >
                <Ico d={ICON_PATHS.sliders} size={15}><circle cx="19" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Ico>
              </button>
            </div>
          </div>
        ) : null}

        {!loading && groups.map((group) => {
          const open = !prefs.collapsed[group.label];
          const folderChatAction = prefs.groupBy === "project"
            ? group.chats.find((chat) => chat.active && chat.onStartChat)?.onStartChat
              ?? group.chats.find((chat) => chat.onStartChat)?.onStartChat
            : undefined;
          const visibilityKey = `${prefs.groupBy}:${group.key}`;
          const visibleCount = visibleChatsByGroup[visibilityKey] ?? CHAT_HISTORY_PAGE_SIZE;
          const visibleChats = group.chats.slice(0, visibleCount) as SidebarRow[];
          const remainingCount = Math.max(0, group.chats.length - visibleChats.length);
          const nextPageCount = Math.min(CHAT_HISTORY_PAGE_SIZE, remainingCount);
          return (
            <section key={group.key} style={{ marginBottom: 10 }}>
              <div className="cx-rowwrap">
                <button
                  type="button"
                  className="cx-grouphead"
                  onClick={() => prefs.toggleCollapsed(group.label)}
                  aria-expanded={open}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, borderRadius: 8, background: "transparent", cursor: "pointer", padding: `15px ${folderChatAction ? 72 : 42}px 7px 12px`, textAlign: "left" }}
                >
                  <span className="cx-grouphead-ico" style={{ display: "inline-flex", color: "var(--fg-4)", flexShrink: 0 }}>
                    <Ico d={groupIconPath(prefs.groupBy, open)} size={16} sw={1.7} />
                  </span>
                  <span className="cx-grouphead-label" style={{ flex: 1, fontFamily: "var(--f-body)", fontSize: 15, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>{group.chats.length}</span>
                </button>
                {folderChatAction ? (
                  <button
                    type="button"
                    className="cx-iconbtn cx-hoverbtn"
                    onClick={(event) => { event.stopPropagation(); folderChatAction(); }}
                    title={`New chat in ${group.label}`}
                    aria-label={`New chat in ${group.label}`}
                    style={{ position: "absolute", right: 9, top: 14, display: "grid", placeItems: "center", width: 24, height: 24, border: 0, borderRadius: 7, background: "transparent", color: "var(--fg-3)", cursor: "pointer", zIndex: 2 }}
                  >
                    <Ico d={ICON_PATHS.chat} size={14} sw={1.9} />
                  </button>
                ) : null}
              </div>
              {open ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, marginLeft: 14, paddingLeft: 10, borderLeft: "1px solid var(--line)" }}>
                  <RowList rows={visibleChats} prefs={prefs} onOpenMenu={setRowMenu} activeMenuKey={rowMenu?.key} />
                  {remainingCount ? (
                    <button
                      type="button"
                      onClick={() => setVisibleChatsByGroup((current) => ({
                        ...current,
                        [visibilityKey]: nextChatHistoryVisibleCount(current[visibilityKey] ?? CHAT_HISTORY_PAGE_SIZE, group.chats.length),
                      }))}
                      aria-label={`See ${nextPageCount} more conversations in ${group.label}`}
                      style={{ alignSelf: "flex-start", margin: "4px 0 2px 4px", border: 0, background: "transparent", color: "var(--fg-4)", cursor: "pointer", fontFamily: "var(--f-body)", fontSize: 11.5, fontWeight: 500, lineHeight: 1.4, padding: "3px 7px", textAlign: "left" }}
                    >
                      See {nextPageCount} more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}

        {!loading && noResults ? (
          <p style={{ margin: "16px 10px", border: "1px dashed var(--line-2)", borderRadius: 9, color: "var(--fg-4)", fontFamily: "var(--f-body)", fontSize: 11, lineHeight: 1.5, padding: 16, textAlign: "center" }}>
            {search.trim() || prefs.viewsChanged ? "No chats match these filters. Adjust the view or clear filters." : "No chats yet. Start one from the button above."}
          </p>
        ) : null}
      </div>

      <footer style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line)", color: "var(--fg-3)", fontFamily: "var(--f-body)", fontSize: 11, padding: "12px 16px" }}>
        <span className="cx-dot-live" style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor", color: "var(--live)" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{footerLabel}</span>
      </footer>

      {projectMenuAnchor ? (
        <div
          data-cx-pop
          className="cx-pop"
          role="menu"
          aria-label="Add a project"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(projectMenuAnchor.x - 216, (typeof window === "undefined" ? 1200 : window.innerWidth) - 224)),
            top: projectMenuAnchor.y,
            zIndex: 200,
            width: 216,
            ...POP_STYLE,
          }}
        >
          <button
            type="button"
            className="cx-menuitem"
            role="menuitem"
            disabled={!onCreateProject}
            onClick={() => { onCreateProject?.(); setProjectMenuAnchor(null); }}
            style={{ ...rowMenuItem, color: onCreateProject ? "var(--fg)" : "var(--fg-4)", cursor: onCreateProject ? "pointer" : "default" }}
          >
            <Ico d={ICON_PATHS.folderPlus} size={16} sw={1.7} />
            <span>Create new project</span>
          </button>
          <button
            type="button"
            className="cx-menuitem"
            role="menuitem"
            disabled={!onImportProject}
            onClick={() => { onImportProject?.(); setProjectMenuAnchor(null); }}
            style={{ ...rowMenuItem, color: onImportProject ? "var(--fg)" : "var(--fg-4)", cursor: onImportProject ? "pointer" : "default" }}
          >
            <Ico d={ICON_PATHS.folder} size={16} sw={1.7} />
            <span>Import project</span>
          </button>
        </div>
      ) : null}

      {/* views menu */}
      {viewsOpen && viewsAnchor ? (
        <div ref={popRef} data-cx-pop className="cx-pop cx-scroll" role="menu" aria-label={subConfig ? subConfig.title : "Chat views"} style={{ position: "fixed", left: Math.max(8, Math.min(viewsAnchor.x, (typeof window === "undefined" ? 1200 : window.innerWidth) - 258)), top: viewsAnchor.y, zIndex: 200, width: 250, maxHeight: 340, overflow: "auto", ...POP_STYLE, borderRadius: 13 }}>
          {!subConfig ? (
            <>
              <ViewsRow label="Status" value={optLabel(STATUS_OPTS, prefs.filters.status)} highlighted={prefs.filters.status !== "all"} onClick={() => setViewsSub("status")} />
              <ViewsRow label="Machine" value={optLabel(machineOpts, prefs.filters.machine || "all")} highlighted={(prefs.filters.machine || "all") !== "all"} onClick={() => setViewsSub("machine")} />
              <ViewsRow label="Last activity" value={optLabel(ACTIVITY_OPTS, prefs.filters.activity)} highlighted={prefs.filters.activity !== "all"} onClick={() => setViewsSub("activity")} />
              <div style={{ height: 1, background: "var(--line)", margin: "6px 8px" }} />
              <ViewsRow label="Group by" value={optLabel(GROUP_OPTS, prefs.groupBy)} onClick={() => setViewsSub("group")} />
              <ViewsRow label="Sort by" value={optLabel(SORT_OPTS, prefs.sortBy)} onClick={() => setViewsSub("sort")} />
              {prefs.viewsChanged ? (
                <div style={{ padding: "2px 4px" }}>
                  <button type="button" className="cx-menuitem" onClick={() => { prefs.resetFilters(); setViewsOpen(false); }} style={{ width: "100%", border: 0, borderRadius: 9, background: "transparent", color: "var(--fg-3)", cursor: "pointer", padding: "9px 11px", textAlign: "left", fontFamily: "var(--f-body)", fontSize: 11, letterSpacing: "0.04em" }}>Reset filters</button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" className="cx-viewsrow" onClick={() => setViewsSub("")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 9, background: "transparent", color: "var(--fg-3)", cursor: "pointer", padding: "8px 9px", textAlign: "left", marginBottom: 2 }}>
                <Ico d={ICON_PATHS.chevronLeft} size={14} sw={2} />
                <span style={{ fontFamily: "var(--f-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>{subConfig.title}</span>
              </button>
              {subConfig.opts.map(([value, label]) => {
                const active = value === subConfig.current;
                return (
                  <button
                    key={value}
                    type="button"
                    className="cx-menuitem"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => { subConfig.pick(value); setViewsSub(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, borderRadius: 9, background: active ? "var(--honey-soft)" : "transparent", color: active ? "var(--honey)" : "var(--fg-2)", cursor: "pointer", padding: "10px 11px", textAlign: "left" }}
                  >
                    <span style={{ flex: 1, fontSize: 13.5 }}>{label}</span>
                    {active ? <Ico d={ICON_PATHS.check} size={15} sw={2.2} stroke="var(--honey)" /> : null}
                  </button>
                );
              })}
            </>
          )}
        </div>
      ) : null}

      {/* per-row kebab menu */}
      {rowMenu ? (
        <>
          <div onClick={() => setRowMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 190 }} />
          <div data-cx-pop className="cx-pop" role="menu" aria-label="Chat options" style={{ position: "fixed", left: Math.max(8, Math.min(rowMenu.x, (typeof window === "undefined" ? 1200 : window.innerWidth) - 196)), top: rowMenu.y, zIndex: 200, width: 188, ...POP_STYLE, transformOrigin: "top left" }}>
            <button type="button" className="cx-menuitem" onClick={() => { onDuplicate(rowMenu.key); setRowMenu(null); }} style={rowMenuItem}>
              <Ico d={ICON_PATHS.copy} size={16} sw={1.7}><rect x="9" y="9" width="11" height="11" rx="2" /></Ico>
              <span>Duplicate</span>
            </button>
            <button type="button" className="cx-menuitem" onClick={() => { prefs.archive(rowMenu.key); setRowMenu(null); }} style={rowMenuItem}>
              <Ico d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" size={16} sw={1.7}><rect x="3" y="4" width="18" height="4" rx="1" /></Ico>
              <span>Archive</span>
            </button>
            <div style={{ height: 1, background: "var(--line)", margin: "5px 8px" }} />
            <button type="button" className="cx-menuitem cx-menuitem-danger" onClick={() => { onDelete(rowMenu.key); setRowMenu(null); }} style={{ ...rowMenuItem, color: "var(--danger)" }}>
              <Ico d={ICON_PATHS.trash} size={16} sw={1.7} />
              <span>Delete</span>
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

const rowMenuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  border: 0,
  borderRadius: 9,
  background: "transparent",
  color: "var(--fg)",
  cursor: "pointer",
  padding: "9px 11px",
  textAlign: "left",
  fontSize: 13.5,
};

function ViewsRow({ label, value, highlighted, onClick }: { label: string; value: string; highlighted?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="cx-viewsrow" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, borderRadius: 9, background: "transparent", color: "var(--fg)", cursor: "pointer", padding: "10px 11px", textAlign: "left" }}>
      <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
      <span style={{ fontFamily: "var(--f-body)", fontSize: 12, color: highlighted ? "var(--honey)" : "var(--fg-3)" }}>{value}</span>
      <Ico d={ICON_PATHS.chevronRight} size={14} sw={2} stroke="var(--fg-4)" />
    </button>
  );
}

function RowList({ rows, prefs, onOpenMenu, activeMenuKey }: { rows: SidebarRow[]; prefs: UseChatViewPreferences; onOpenMenu: (anchor: MenuAnchor) => void; activeMenuKey?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((row) => {
        const pinned = prefs.pinned.includes(row.storageKey);
        const dotColor = row.running ? "var(--honey)" : row.status === "active" ? "var(--honey)" : "var(--fg-4)";
        return (
          <div key={row.storageKey} className="cx-rowwrap">
            <button
              type="button"
              className="cx-chatrow"
              data-active={row.active ? "true" : "false"}
              onClick={row.onOpen}
              title={row.title}
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, width: "100%", border: 0, borderRadius: 10, background: "transparent", cursor: "pointer", padding: `10px ${row.capabilityApprovalPending ? 90 : 64}px 10px 13px`, textAlign: "left", overflow: "hidden" }}
            >
              <span className={row.running ? "cx-chatrow-running-dot" : undefined} style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 99, background: "currentColor", color: dotColor }} />
              <span style={{ display: "grid", flex: 1, minWidth: 0, gap: 2 }}>
                <span style={{ fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 500, color: row.active ? "var(--fg)" : "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title || "Untitled chat"}</span>
                {row.subtitle ? <span style={{ fontFamily: "var(--f-body)", fontSize: 11.5, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.subtitle}</span> : null}
              </span>
            </button>
            {row.capabilityApprovalPending ? (
              <span
                role="img"
                aria-label="Capability approval waiting"
                title="Capability approval waiting"
                style={{ position: "absolute", right: 61, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 23, height: 23, border: "1px solid var(--honey-line)", borderRadius: 7, color: "var(--honey)", background: "var(--honey-soft)", pointerEvents: "none", zIndex: 2 }}
              >
                <Ico d={ICON_PATHS.shield} size={13} sw={1.8} />
              </span>
            ) : null}
            <button
              type="button"
              className={pinned ? "cx-pinbtn cx-pinbtn-on" : "cx-pinbtn cx-hoverbtn"}
              onClick={(event) => { event.stopPropagation(); prefs.togglePinned(row.storageKey); }}
              title={pinned ? "Unpin chat" : "Pin chat"}
              aria-label={pinned ? "Unpin chat" : "Pin chat"}
              aria-pressed={pinned}
              style={{ position: "absolute", right: 35, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 24, height: 24, border: 0, background: "transparent", color: pinned ? "var(--honey)" : "var(--fg-3)", cursor: "pointer", zIndex: 2 }}
            >
              <Ico d={ICON_PATHS.pin} size={13} sw={1.7} fill={pinned ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              className={activeMenuKey === row.storageKey ? "cx-pinbtn cx-pinbtn-on" : "cx-hoverbtn"}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenMenu({ key: row.storageKey, x: rect.left, y: rect.bottom + 6 });
              }}
              title="Chat options"
              aria-label="Chat options"
              aria-haspopup="menu"
              style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 24, height: 24, border: 0, background: "transparent", color: "var(--fg-3)", cursor: "pointer", zIndex: 2 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Shape-matched skeleton (AGENTS.md: never a static "Loading…"). */
function SidebarSkeleton() {
  return (
    <div role="status" aria-label="Loading chats" style={{ display: "grid", gap: 10, padding: "12px 4px" }}>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 9px" }}>
          <span className="fr-skel" style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0 }} />
          <span style={{ display: "grid", gap: 5, flex: 1 }}>
            <span className="fr-skel" style={{ height: 9, borderRadius: 5, width: `${72 - index * 7}%` }} />
            <span className="fr-skel" style={{ height: 7, borderRadius: 5, width: `${44 - index * 4}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function groupIconPath(groupBy: ChatThreadGroupBy, open: boolean): string | string[] {
  if (groupBy === "project") {
    return open
      ? ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2", "M3 9h18l-2 9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"]
      : ICON_PATHS.folder;
  }
  if (groupBy === "machine") return "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01";
  if (groupBy === "agent") return "M12 3 19 7v8l-7 4-7-4V7z";
  if (groupBy === "date") return "M3 9h18M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z";
  return "M4 6h16M4 12h16M4 18h16";
}
