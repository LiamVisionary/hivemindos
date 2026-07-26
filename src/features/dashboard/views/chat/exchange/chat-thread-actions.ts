/**
 * Pure, importable logic for chat-thread management actions and sidebar
 * grouping/filtering/sorting. No React, no fetch, no `Date.now()` — every
 * time-dependent function takes a `nowMs` argument so callers stay
 * deterministic and these functions stay unit-testable under a hermetic node
 * runner. The dashboard UI wires these into its state; there is NO server API
 * for pin/archive/delete/duplicate/rename — pin + archive are durable UI
 * state (see `use-chat-view-preferences.ts`).
 *
 * `ChatMessage` / `StoredChatThreadTitle` are imported type-only, so this
 * module has no runtime dependency on the (React/CSS-heavy) UI code.
 */
import type { ChatMessage } from "@/features/dashboard/dashboard-types";
import type { StoredChatThreadTitle } from "@/lib/config/chat-thread-title";

/**
 * Minimal structural row the chat sidebar hands to the grouping/filtering
 * helpers. Intentionally NOT the UI's `ChatTreeItem` type — this keeps the
 * pure logic decoupled from the view layer. The sidebar maps its own rows onto
 * this shape.
 */
export type ChatThreadRow = {
  /** The `messagesByAgent` record key for this thread. */
  storageKey: string;
  /** Owning agent id. */
  agentId: string;
  /** Human-facing agent name (falls back to `agentId` when absent). */
  agentName?: string;
  /** Machine the agent lives on, used by the "machine" grouping + filter. */
  machineName?: string;
  /** Pre-computed project/folder label; if absent it is derived from `workingDirectoryPath`. */
  projectLabel?: string;
  /** Working directory / folder path for this thread. */
  workingDirectoryPath?: string;
  /** Thread title (title override or derived preview). */
  title?: string;
  /** Coarse liveness used by the status filter. */
  status?: "active" | "idle";
  /** Epoch ms of the most recent message; drives recency sort + date buckets. */
  updatedAt: number;
};

export type ChatThreadStatusFilter = "all" | "active" | "idle";
export type ChatThreadActivityFilter = "all" | "today" | "week" | "month";
export type ChatThreadGroupBy = "project" | "machine" | "agent" | "date" | "flat";
export type ChatThreadSortBy = "recency" | "name" | "activity";

export type ChatThreadFilters = {
  status: ChatThreadStatusFilter;
  machine: string;
  activity: ChatThreadActivityFilter;
};

export type ChatThreadGroup<Row extends ChatThreadRow = ChatThreadRow> = {
  label: string;
  key: string;
  chats: Row[];
};

/**
 * A project folder the user created that holds no chats yet. The sidebar
 * renders groups derived from chat ROWS, so a project with zero conversations
 * produces zero rows and would otherwise be invisible — which reads as "the
 * project I just made vanished" the moment the empty draft chat stops being
 * the selected leaf (e.g. after a reload). These are merged in as empty groups.
 */
export type ChatThreadProject = {
  label: string;
  /** Epoch ms the project folder was created; newest empty project sorts first. */
  createdAt?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHAT_HISTORY_PAGE_SIZE = 5;

/** Reveal one more bounded page of conversations in a sidebar history group. */
export function nextChatHistoryVisibleCount(currentVisibleCount: number, totalCount: number): number {
  return Math.min(totalCount, currentVisibleCount + CHAT_HISTORY_PAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Thread record actions
// ---------------------------------------------------------------------------

/**
 * Extract the owning agent id from a `messagesByAgent` storage key. Mirrors the
 * canonical scheme in `chatMessageStorageKey` / `chatStorageIdentity`: a key of
 * `agentId` has no leaf, `agentId::leaf` splits on the first `::`.
 */
export function agentIdFromChatStorageKey(storageKey: string): string {
  const separatorIndex = storageKey.indexOf("::");
  return separatorIndex === -1 ? storageKey : storageKey.slice(0, separatorIndex);
}

/**
 * Delete a thread: returns a NEW record with `storageKey` removed. Never
 * mutates the input. Deleting a thread from the UI means dropping its storage
 * key from `messagesByAgent` (persisted under `hivemindos.chatMessages.v1`).
 */
export function deleteChatThread(
  messagesByAgent: Record<string, ChatMessage[]>,
  storageKey: string,
): Record<string, ChatMessage[]> {
  const next = { ...messagesByAgent };
  delete next[storageKey];
  return next;
}

/**
 * Build the seed for a duplicated thread: a fresh copy of the source messages
 * plus a fresh, collision-free `agent-<id>`-style leaf key derived
 * deterministically from `nowMs` (no `Date.now()` here). The caller feeds these
 * into `startAgentChat(agentId, { fresh: true, chatLeafKey, seedMessages })`.
 * Each message is shallow-copied into a brand-new array so mutating the
 * duplicate cannot reach back into the source thread.
 */
export function duplicateChatThreadSeed(
  messagesByAgent: Record<string, ChatMessage[]>,
  storageKey: string,
  nowMs: number,
): { seedMessages: ChatMessage[]; leafKey: string } {
  const agentId = agentIdFromChatStorageKey(storageKey);
  const source = messagesByAgent[storageKey] ?? [];
  const seedMessages = source.map((message) => ({ ...message }));
  const suffix = shortDeterministicHash(`${storageKey}\u001f${nowMs}`);
  const leafKey = `agent-${agentId}-dup-${nowMs.toString(36)}-${suffix}`;
  return { seedMessages, leafKey };
}

/**
 * Build a new thread from the complete stored conversation through one
 * response. The rendered response identifies the boundary; when the view is a
 * bounded window, the stable message metadata recovers its position in the
 * full stored thread. Later turns are excluded while the clicked response
 * remains available as context in the fork.
 */
export function forkChatThreadSeed(
  renderedMessages: ChatMessage[],
  storageKey: string,
  responseIndex: number,
  nowMs: number,
  storedMessages: ChatMessage[] = renderedMessages,
): { seedMessages: ChatMessage[]; leafKey: string } {
  const agentId = agentIdFromChatStorageKey(storageKey);
  const renderedBoundary = Math.min(
    renderedMessages.length - 1,
    Math.max(-1, Math.trunc(responseIndex)),
  );
  const selectedResponse = renderedMessages[renderedBoundary];
  const storedBoundary = selectedResponse
    ? findForkBoundaryMessage(storedMessages, selectedResponse)
    : -1;
  const sourceMessages = storedBoundary >= 0 ? storedMessages : renderedMessages;
  const boundary = storedBoundary >= 0 ? storedBoundary : renderedBoundary;
  const seedMessages = sourceMessages
    .slice(0, boundary + 1)
    .map((message) => ({ ...message }));
  const suffix = shortDeterministicHash(`${storageKey}\u001f${boundary}\u001f${nowMs}`);
  const leafKey = `agent-${agentId}-fork-${nowMs.toString(36)}-${suffix}`;
  return { seedMessages, leafKey };
}

function findForkBoundaryMessage(messages: ChatMessage[], selectedResponse: ChatMessage) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate || candidate.role !== selectedResponse.role) continue;
    const sameSession = Boolean(
      candidate.sourceSessionId
      && selectedResponse.sourceSessionId
      && candidate.sourceSessionId === selectedResponse.sourceSessionId
    );
    if (
      sameSession
      && Number.isFinite(candidate.sourceIndex)
      && candidate.sourceIndex === selectedResponse.sourceIndex
    ) return index;
    if (
      sameSession
      && Number.isFinite(candidate.createdAt)
      && candidate.createdAt === selectedResponse.createdAt
    ) return index;
    if (
      Number.isFinite(candidate.createdAt)
      && candidate.createdAt === selectedResponse.createdAt
      && candidate.content === selectedResponse.content
    ) return index;
  }
  return -1;
}

/**
 * Rename a thread by writing a title override into the titles map (persisted
 * under `CHAT_THREAD_TITLES_STATE_KEY`). Returns a NEW map; never mutates the
 * input. An empty/blank title clears any existing override for that key.
 *
 * NOTE: `StoredChatThreadTitle.mode` only allows "local" | "cloud"; there is no
 * "manual" mode in the stored type, so a user rename is recorded with the prior
 * entry's mode when present, else "local", and `model: "manual"` as a marker.
 * `parseStoredChatThreadTitles` re-sanitizes titles on load (caps to 7 words /
 * 64 chars, strips trailing punctuation), so very long manual titles are
 * trimmed on the next reload — that is the existing store contract, not a
 * behavior introduced here.
 */
export function renameChatThread(
  titles: Record<string, StoredChatThreadTitle>,
  storageKey: string,
  title: string,
  nowMs: number,
): Record<string, StoredChatThreadTitle> {
  const trimmed = String(title ?? "").replace(/\s+/g, " ").trim();
  const next = { ...titles };
  if (!trimmed) {
    delete next[storageKey];
    return next;
  }
  const existing = titles[storageKey];
  next[storageKey] = {
    title: trimmed.slice(0, 160),
    generatedAt: nowMs,
    mode: existing?.mode === "cloud" || existing?.mode === "local" ? existing.mode : "local",
    model: existing?.model ? existing.model : "manual",
  };
  return next;
}

// ---------------------------------------------------------------------------
// Transcript serialization
// ---------------------------------------------------------------------------

/**
 * Function that renders a message to its display text. The UI passes
 * `chatDisplayContent` (from `chat-composer.tsx`) here so the copied transcript
 * matches exactly what is rendered on screen. It is INJECTED rather than
 * imported because `chat-composer.tsx` pulls in React/CSS and cannot load in a
 * hermetic node runner (same dependency-injection pattern as
 * `chat-panel-helpers.ts`). When omitted, the default falls back to the raw
 * `message.content`.
 */
export type ChatTranscriptDisplayContent = (message: ChatMessage) => string;

function defaultTranscriptDisplayContent(message: ChatMessage): string {
  return message.content ?? "";
}

/**
 * Prefer the complete stored thread when copying a chat. The rendered message
 * list can be a bounded window (for example, a task preview showing only the
 * latest turn), so it is only a fallback for transient, not-yet-stored chats.
 */
export function chatTranscriptSourceMessages(
  messagesByAgent: Record<string, ChatMessage[]>,
  storageKey: string,
  renderedMessages: ChatMessage[],
): ChatMessage[] {
  const storedMessages = storageKey ? messagesByAgent[storageKey] : undefined;
  return storedMessages?.length ? storedMessages : renderedMessages;
}

/**
 * Serialize a thread's messages to a plain-text transcript. One block per
 * message separated by a blank line: `User: ...` for user turns and
 * `<agentName|Assistant>: ...` for assistant turns, using `displayContent` for
 * assistant text. System messages and messages with no text AND no attachments
 * are skipped. Attachment names are appended in brackets when present.
 */
export function serializeChatTranscript(
  messages: ChatMessage[],
  opts: { agentName?: string; displayContent?: ChatTranscriptDisplayContent } = {},
): string {
  const agentLabel = opts.agentName?.trim() || "Assistant";
  const display = opts.displayContent ?? defaultTranscriptDisplayContent;
  const blocks: string[] = [];
  for (const message of messages) {
    if (!message || message.role === "system") continue;
    const roleLabel = message.role === "user" ? "User" : agentLabel;
    const rawBody = message.role === "assistant" ? display(message) : (message.content ?? "");
    const body = String(rawBody ?? "").trim();
    const attachmentNames = (message.attachments ?? [])
      .map((attachment) => String(attachment?.name ?? "").trim())
      .filter(Boolean);
    const attachmentSuffix = attachmentNames.length ? `[${attachmentNames.join(", ")}]` : "";
    if (!body && !attachmentSuffix) continue;
    const detail = [body, attachmentSuffix].filter(Boolean).join(" ");
    blocks.push(`${roleLabel}: ${detail}`);
  }
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Sidebar filter / sort / group helpers
// ---------------------------------------------------------------------------

/**
 * Filter rows by status, machine, and activity window. `machine: ""` (or
 * "all") and `status: "all"` / `activity: "all"` are pass-through. Activity
 * windows are rolling from `nowMs`: today = last calendar day (local midnight),
 * week = last 7 days, month = last 30 days.
 */
export function applyChatThreadFilters<Row extends ChatThreadRow>(
  rows: Row[],
  filters: ChatThreadFilters,
  nowMs: number,
): Row[] {
  const machine = filters.machine?.trim() ?? "";
  const activityFloor = activityWindowFloor(filters.activity, nowMs);
  return rows.filter((row) => {
    if (filters.status !== "all" && (row.status ?? "idle") !== filters.status) return false;
    if (machine && machine !== "all" && (row.machineName ?? "") !== machine) return false;
    if (activityFloor !== null && Number(row.updatedAt || 0) < activityFloor) return false;
    return true;
  });
}

function activityWindowFloor(activity: ChatThreadActivityFilter, nowMs: number): number | null {
  switch (activity) {
    case "today":
      return startOfLocalDay(nowMs);
    case "week":
      return nowMs - 7 * DAY_MS;
    case "month":
      return nowMs - 30 * DAY_MS;
    default:
      return null;
  }
}

/**
 * Sort rows (returns a NEW array; input not mutated). All sorts break ties on
 * `storageKey` for stability.
 * - recency: newest `updatedAt` first.
 * - name: title / agent name ascending (locale-aware, case-insensitive).
 * - activity: active threads first, then newest `updatedAt` first.
 */
export function sortChatThreads<Row extends ChatThreadRow>(
  rows: Row[],
  sortBy: ChatThreadSortBy,
): Row[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    let primary = 0;
    if (sortBy === "name") {
      primary = rowSortName(a).localeCompare(rowSortName(b), undefined, { sensitivity: "base" });
    } else if (sortBy === "activity") {
      const activeDelta = statusRank(a) - statusRank(b);
      primary = activeDelta !== 0 ? activeDelta : Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    } else {
      primary = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    }
    if (primary !== 0) return primary;
    return a.storageKey.localeCompare(b.storageKey);
  });
  return copy;
}

function rowSortName(row: ChatThreadRow): string {
  return (row.title || row.agentName || row.agentId || row.storageKey).trim();
}

function statusRank(row: ChatThreadRow): number {
  return row.status === "active" ? 0 : 1;
}

/**
 * Group rows into labelled buckets for the sidebar. `nowMs` is only consulted
 * for `groupBy: "date"`.
 * - project: by project/folder label (from `projectLabel` or `workingDirectoryPath` basename).
 * - machine: by machine name.
 * - agent: by agent name (falls back to agent id).
 * - date: Today / This week / Earlier, computed from `updatedAt` vs `nowMs` using local-day boundaries.
 * - flat: a single "Recent chats" bucket.
 * Non-date groups appear in first-seen order; empty buckets are omitted.
 */
export function groupChatThreads<Row extends ChatThreadRow>(
  rows: Row[],
  groupBy: ChatThreadGroupBy,
  nowMs: number,
): Array<ChatThreadGroup<Row>> {
  if (groupBy === "flat") {
    return rows.length ? [{ label: "Recent chats", key: "flat", chats: rows.slice() }] : [];
  }
  if (groupBy === "date") {
    return groupChatThreadsByDate(rows, nowMs);
  }

  const order: string[] = [];
  const buckets = new Map<string, ChatThreadGroup<Row>>();
  for (const row of rows) {
    const { key, label } = groupKeyLabel(row, groupBy);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, key, chats: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.chats.push(row);
  }
  return order.map((key) => buckets.get(key)!);
}

/** Group key a project label lands on under `groupBy: "project"`. */
export function chatThreadProjectGroupKey(label: string): string {
  return `project:${label.trim()}`;
}

/**
 * Append chat-less project folders to the project groups as empty buckets.
 * A project whose label already has a group (it holds chats) is skipped, so an
 * empty folder never duplicates a live one. Empty projects keep their own
 * order — newest created first — and always sort AFTER groups that hold chats,
 * so adding a project never pushes active work down the rail. Returns a NEW
 * array; the input groups are not mutated.
 */
export function mergeEmptyProjectGroups<Row extends ChatThreadRow, Project extends ChatThreadProject>(
  groups: Array<ChatThreadGroup<Row>>,
  projects: Project[],
): Array<ChatThreadGroup<Row>> {
  const seen = new Set(groups.map((group) => group.key));
  const empties: Array<ChatThreadGroup<Row>> = [];
  for (const project of [...projects].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))) {
    const label = project.label?.trim() ?? "";
    if (!label) continue;
    const key = chatThreadProjectGroupKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    empties.push({ label, key, chats: [] });
  }
  return [...groups, ...empties];
}

function groupKeyLabel(
  row: ChatThreadRow,
  groupBy: Exclude<ChatThreadGroupBy, "flat" | "date">,
): { key: string; label: string } {
  if (groupBy === "machine") {
    const label = row.machineName?.trim() || "Unknown machine";
    return { key: `machine:${label}`, label };
  }
  if (groupBy === "agent") {
    const label = row.agentName?.trim() || row.agentId?.trim() || "Unknown agent";
    return { key: `agent:${label}`, label };
  }
  // project
  const label = row.projectLabel?.trim() || folderLabelFromPath(row.workingDirectoryPath) || "No project";
  return { key: `project:${label}`, label };
}

function groupChatThreadsByDate<Row extends ChatThreadRow>(
  rows: Row[],
  nowMs: number,
): Array<ChatThreadGroup<Row>> {
  const todayStart = startOfLocalDay(nowMs);
  const weekStart = todayStart - 6 * DAY_MS;
  const today: Row[] = [];
  const week: Row[] = [];
  const earlier: Row[] = [];
  for (const row of rows) {
    const updatedAt = Number(row.updatedAt || 0);
    if (updatedAt >= todayStart) today.push(row);
    else if (updatedAt >= weekStart) week.push(row);
    else earlier.push(row);
  }
  const groups: Array<ChatThreadGroup<Row>> = [];
  if (today.length) groups.push({ label: "Today", key: "today", chats: today });
  if (week.length) groups.push({ label: "This week", key: "week", chats: week });
  if (earlier.length) groups.push({ label: "Earlier", key: "earlier", chats: earlier });
  return groups;
}

// ---------------------------------------------------------------------------
// Small pure utilities
// ---------------------------------------------------------------------------

/** Local-midnight epoch ms for the day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Last path segment of a directory path (handles `/` and `\`, trailing separators). */
function folderLabelFromPath(path?: string): string {
  if (!path) return "";
  const trimmed = path.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : "";
}

/** Deterministic short base36 hash (djb2) — collision-resistant enough for leaf keys. */
function shortDeterministicHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
