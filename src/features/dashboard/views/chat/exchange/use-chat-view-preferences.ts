"use client";

/**
 * Durable chat-sidebar view preferences: pinned + archived threads, collapsed
 * group state, filters, grouping, and sort. Backed by ONE namespaced dashboard
 * state value (`hivemindos.chat.viewPreferences.v1`) holding a JSON blob —
 * browser storage (localStorage/sessionStorage/IndexedDB) is banned for durable
 * state (guard:browser-durable-state), and `useRememberedDashboardValue` only
 * stores strings, so the blob is JSON-serialized.
 *
 * Pin + archive are durable UI state with NO server API. Delete/duplicate/
 * rename act on chat records/titles via the pure helpers in
 * `chat-thread-actions.ts`.
 *
 * `parseChatViewPreferences` / `serializeChatViewPreferences` are exported as a
 * pure, defensive parse/serialize pair (corrupt JSON -> defaults, never throws)
 * so they are unit-testable without React.
 */
import { useCallback, useMemo } from "react";

import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type {
  ChatThreadActivityFilter,
  ChatThreadFilters,
  ChatThreadGroupBy,
  ChatThreadSortBy,
  ChatThreadStatusFilter,
} from "@/features/dashboard/views/chat/exchange/chat-thread-actions";

export const CHAT_VIEW_PREFERENCES_STATE_KEY = "hivemindos.chat.viewPreferences.v1";

export type ChatViewPreferences = {
  pinned: string[];
  archived: string[];
  collapsed: Record<string, boolean>;
  filters: ChatThreadFilters;
  groupBy: ChatThreadGroupBy;
  sortBy: ChatThreadSortBy;
};

const STATUS_FILTERS: readonly ChatThreadStatusFilter[] = ["all", "active", "idle"];
const ACTIVITY_FILTERS: readonly ChatThreadActivityFilter[] = ["all", "today", "week", "month"];
const GROUP_BYS: readonly ChatThreadGroupBy[] = ["project", "machine", "agent", "date", "flat"];
const SORT_BYS: readonly ChatThreadSortBy[] = ["recency", "name", "activity"];

export const DEFAULT_CHAT_VIEW_PREFERENCES: ChatViewPreferences = {
  pinned: [],
  archived: [],
  collapsed: {},
  // "all" is the sentinel for "no machine filter" across the whole surface:
  // the Views menu labels it, and applyChatThreadFilters treats it as no-op.
  filters: { status: "all", machine: "all", activity: "all" },
  // Matches the redesign: chats group under their project/folder by default.
  groupBy: "project",
  sortBy: "recency",
};

function cloneDefaults(): ChatViewPreferences {
  return {
    pinned: [],
    archived: [],
    collapsed: {},
    filters: { ...DEFAULT_CHAT_VIEW_PREFERENCES.filters },
    groupBy: DEFAULT_CHAT_VIEW_PREFERENCES.groupBy,
    sortBy: DEFAULT_CHAT_VIEW_PREFERENCES.sortBy,
  };
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) seen.add(trimmed);
  }
  return Array.from(seen);
}

function sanitizeCollapsed(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const collapsed: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key && entry === true) collapsed[key] = true;
  }
  return collapsed;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Parse a stored preferences blob defensively. Any malformed input (empty,
 * non-JSON, wrong shape, wrong field types) yields a fresh copy of the
 * defaults; every field is validated independently so a single bad field does
 * not discard the rest. Never throws.
 */
export function parseChatViewPreferences(raw: string): ChatViewPreferences {
  if (typeof raw !== "string" || !raw.trim()) return cloneDefaults();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cloneDefaults();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return cloneDefaults();
  const record = parsed as Record<string, unknown>;
  const filtersRecord = (record.filters && typeof record.filters === "object" && !Array.isArray(record.filters)
    ? record.filters
    : {}) as Record<string, unknown>;
  return {
    pinned: sanitizeStringList(record.pinned),
    archived: sanitizeStringList(record.archived),
    collapsed: sanitizeCollapsed(record.collapsed),
    filters: {
      status: pickEnum(filtersRecord.status, STATUS_FILTERS, "all"),
      machine: typeof filtersRecord.machine === "string" && filtersRecord.machine ? filtersRecord.machine : "all",
      activity: pickEnum(filtersRecord.activity, ACTIVITY_FILTERS, "all"),
    },
    groupBy: pickEnum(record.groupBy, GROUP_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.groupBy),
    sortBy: pickEnum(record.sortBy, SORT_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.sortBy),
  };
}

/** Serialize preferences to the stored JSON string (normalized shape). */
export function serializeChatViewPreferences(prefs: ChatViewPreferences): string {
  return JSON.stringify({
    pinned: sanitizeStringList(prefs.pinned),
    archived: sanitizeStringList(prefs.archived),
    collapsed: sanitizeCollapsed(prefs.collapsed),
    filters: {
      status: pickEnum(prefs.filters?.status, STATUS_FILTERS, "all"),
      machine: typeof prefs.filters?.machine === "string" && prefs.filters.machine ? prefs.filters.machine : "all",
      activity: pickEnum(prefs.filters?.activity, ACTIVITY_FILTERS, "all"),
    },
    groupBy: pickEnum(prefs.groupBy, GROUP_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.groupBy),
    sortBy: pickEnum(prefs.sortBy, SORT_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.sortBy),
  });
}

/**
 * True when a FILTER differs from its default. Scoped to exactly what
 * `resetFilters()` clears (status / machine / activity) — counting pins,
 * archives, collapsed groups, grouping or sort here would surface a
 * "Reset filters" button that silently does not undo them.
 */
export function chatViewPreferencesChanged(prefs: ChatViewPreferences): boolean {
  return (
    prefs.filters.status !== "all" ||
    prefs.filters.machine !== "all" ||
    prefs.filters.activity !== "all"
  );
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export type UseChatViewPreferences = {
  pinned: string[];
  togglePinned: (storageKey: string) => void;
  archived: string[];
  archive: (storageKey: string) => void;
  unarchive: (storageKey: string) => void;
  collapsed: Record<string, boolean>;
  toggleCollapsed: (groupLabel: string) => void;
  filters: ChatThreadFilters;
  setFilter: <K extends keyof ChatThreadFilters>(key: K, value: ChatThreadFilters[K]) => void;
  groupBy: ChatThreadGroupBy;
  setGroupBy: (value: ChatThreadGroupBy) => void;
  sortBy: ChatThreadSortBy;
  setSortBy: (value: ChatThreadSortBy) => void;
  resetFilters: () => void;
  viewsChanged: boolean;
};

export function useChatViewPreferences(): UseChatViewPreferences {
  const [raw, setRaw] = useRememberedDashboardValue(CHAT_VIEW_PREFERENCES_STATE_KEY, "");
  const prefs = useMemo(() => parseChatViewPreferences(raw), [raw]);

  const write = useCallback(
    (next: ChatViewPreferences) => {
      setRaw(serializeChatViewPreferences(next));
    },
    [setRaw],
  );

  const togglePinned = useCallback(
    (storageKey: string) => {
      const key = storageKey.trim();
      if (!key) return;
      write({ ...prefs, pinned: toggleInList(prefs.pinned, key) });
    },
    [prefs, write],
  );

  const archive = useCallback(
    (storageKey: string) => {
      const key = storageKey.trim();
      if (!key) return;
      write({
        ...prefs,
        archived: prefs.archived.includes(key) ? prefs.archived : [...prefs.archived, key],
        pinned: prefs.pinned.filter((item) => item !== key),
      });
    },
    [prefs, write],
  );

  const unarchive = useCallback(
    (storageKey: string) => {
      const key = storageKey.trim();
      if (!key) return;
      write({ ...prefs, archived: prefs.archived.filter((item) => item !== key) });
    },
    [prefs, write],
  );

  const toggleCollapsed = useCallback(
    (groupLabel: string) => {
      const key = groupLabel.trim();
      if (!key) return;
      const collapsed = { ...prefs.collapsed };
      if (collapsed[key]) delete collapsed[key];
      else collapsed[key] = true;
      write({ ...prefs, collapsed });
    },
    [prefs, write],
  );

  const setFilter = useCallback(
    <K extends keyof ChatThreadFilters>(key: K, value: ChatThreadFilters[K]) => {
      write({ ...prefs, filters: { ...prefs.filters, [key]: value } });
    },
    [prefs, write],
  );

  const setGroupBy = useCallback(
    (value: ChatThreadGroupBy) => {
      write({ ...prefs, groupBy: pickEnum(value, GROUP_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.groupBy) });
    },
    [prefs, write],
  );

  const setSortBy = useCallback(
    (value: ChatThreadSortBy) => {
      write({ ...prefs, sortBy: pickEnum(value, SORT_BYS, DEFAULT_CHAT_VIEW_PREFERENCES.sortBy) });
    },
    [prefs, write],
  );

  const resetFilters = useCallback(() => {
    write({ ...prefs, filters: { ...DEFAULT_CHAT_VIEW_PREFERENCES.filters } });
  }, [prefs, write]);

  const viewsChanged = useMemo(() => chatViewPreferencesChanged(prefs), [prefs]);

  return {
    pinned: prefs.pinned,
    togglePinned,
    archived: prefs.archived,
    archive,
    unarchive,
    collapsed: prefs.collapsed,
    toggleCollapsed,
    filters: prefs.filters,
    setFilter,
    groupBy: prefs.groupBy,
    setGroupBy,
    sortBy: prefs.sortBy,
    setSortBy,
    resetFilters,
    viewsChanged,
  };
}
