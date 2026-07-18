import { constants } from "fs";
import { access, mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { dirname, isAbsolute, join, relative, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type {
  AgentAutonomyReviewMode,
  AgentNotification,
  AgentNotificationKind,
  AgentNotificationPriority,
  AgentNotificationResolution,
  AgentNotificationSettings,
  AgentNotificationSummary,
} from "@/lib/types/agent-notifications";

const DEFAULT_NOTIFICATIONS_FOLDER = DEFAULT_SHARED_VAULT.notificationsFolder;
const SETTINGS_FILE = "settings.json";
const READ_STATE_FILE = "read-state.json";
const RESOLUTION_STATE_FILE = "resolution-state.json";
const VALID_RESOLUTION_STATUSES = new Set(["in-progress", "resolved"]);
const VALID_AUTONOMY_REVIEW_MODES = new Set<AgentAutonomyReviewMode>(["autonomous", "review-high-risk", "review-all"]);
const README_FILE = "README.md";
const VALID_PRIORITIES = new Set<AgentNotificationPriority>(["low", "normal", "high", "urgent"]);
const VALID_KINDS = new Set<AgentNotificationKind>(["message", "decision", "task", "alert", "system"]);

type NotificationStorageOptions = {
  vaultPath?: string | null;
  notificationsFolder?: string | null;
};

export type CreateAgentNotificationInput = {
  id?: string;
  title: string;
  body: string;
  priority?: AgentNotificationPriority;
  kind?: AgentNotificationKind;
  agentName?: string;
  agentId?: string;
  source?: string;
  tags?: string[];
  createdAt?: string;
};

type ReadState = {
  read: Record<string, string>;
  updatedAt: string;
};

// Resolution lifecycle lives in a sidecar (same pattern as read receipts): the
// markdown notes stay immutable and sync-friendly while remediation loops
// stamp "in-progress"/"resolved" against notification ids.
type ResolutionState = {
  entries: Record<string, AgentNotificationResolution>;
  updatedAt: string;
};

export type NotificationListResult = AgentNotificationSummary & {
  notifications: AgentNotification[];
  nextCursor: number | null;
  limit: number;
};

export function resolveNotificationStorage(options: NotificationStorageOptions = {}) {
  const vaultRoot = resolveObsidianVaultPath(options.vaultPath ?? undefined, { requireWritable: true });
  const folder = safeVaultFolder(options.notificationsFolder) || DEFAULT_NOTIFICATIONS_FOLDER;
  const root = join(vaultRoot, folder);
  return {
    vaultRoot,
    folder,
    root,
    notificationsRoot: join(root, "notifications"),
    stateRoot: join(root, "state"),
    settingsFile: join(root, "state", SETTINGS_FILE),
    readStateFile: join(root, "state", READ_STATE_FILE),
    resolutionStateFile: join(root, "state", RESOLUTION_STATE_FILE),
    readmeFile: join(root, README_FILE),
  };
}

export async function listAgentNotifications(options: NotificationStorageOptions & { cursor?: number; limit?: number } = {}): Promise<NotificationListResult> {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const [readState, resolutionState, settings, files] = await Promise.all([
    readReadState(storage.readStateFile),
    readResolutionState(storage.resolutionStateFile),
    readSettings(storage.settingsFile),
    listMarkdownFiles(storage.notificationsRoot),
  ]);
  const notifications = (await Promise.all(files.map((file) => readNotificationFile(file, storage, readState, resolutionState))))
    .filter((notification): notification is AgentNotification => Boolean(notification))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const cursor = Math.max(0, options.cursor ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 40));
  const page = notifications.slice(cursor, cursor + limit);
  const summary = summarizeNotifications(notifications, storage.folder, settings);
  return {
    ...summary,
    notifications: page,
    nextCursor: cursor + limit < notifications.length ? cursor + limit : null,
    limit,
  };
}

export async function markAgentNotificationRead(id: string, options: NotificationStorageOptions = {}) {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const state = await readReadState(storage.readStateFile);
  state.read[id] = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(storage.readStateFile, state);
  return listAgentNotifications({ ...options, cursor: 0, limit: 40 });
}

export async function markAllAgentNotificationsRead(options: NotificationStorageOptions = {}) {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const files = await listMarkdownFiles(storage.notificationsRoot);
  const state = await readReadState(storage.readStateFile);
  const notifications = (await Promise.all(files.map((file) => readNotificationFile(file, storage, state, { entries: {}, updatedAt: "" }))))
    .filter((notification): notification is AgentNotification => Boolean(notification));
  const now = new Date().toISOString();
  for (const notification of notifications) state.read[notification.id] = now;
  state.updatedAt = now;
  await writeJsonAtomic(storage.readStateFile, state);
  return listAgentNotifications({ ...options, cursor: 0, limit: 40 });
}

/**
 * Bulk janitor for task-lifecycle escalation cards. Every "Work is blocked on
 * you" card names its task (a `task:<id>` tag, else the
 * `task-needs-human-<taskId>-<stamp>` id the escalation bridge mints); when
 * that task is no longer in the needs-human lane the card is moot, but only
 * the NEWEST card per dedupe key ever gets a lifecycle stamp — historical
 * re-mints pile up unread forever (measured live: 964 such cards from ~160
 * tasks). This resolves + marks read every matching card in TWO state-file
 * writes total, instead of one read-modify-write per card.
 */
export async function resolveStaleTaskNotifications(
  liveNeedsHumanTaskIds: Iterable<string>,
  options: NotificationStorageOptions & { by?: string; note?: string } = {},
): Promise<{ scanned: number; matched: number; resolved: number }> {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const live = new Set(liveNeedsHumanTaskIds);
  const [readState, resolutionState, files] = await Promise.all([
    readReadState(storage.readStateFile),
    readResolutionState(storage.resolutionStateFile),
    listMarkdownFiles(storage.notificationsRoot),
  ]);
  const notifications = (await Promise.all(files.map((file) => readNotificationFile(file, storage, readState, resolutionState))))
    .filter((notification): notification is AgentNotification => Boolean(notification));
  const now = new Date().toISOString();
  let matched = 0;
  let resolved = 0;
  for (const notification of notifications) {
    const taskId = taskIdForNotification(notification);
    if (!taskId) continue;
    matched += 1;
    if (live.has(taskId)) continue;
    const alreadyResolved = notification.resolution?.status === "resolved";
    if (alreadyResolved && notification.read) continue;
    if (!alreadyResolved) {
      resolutionState.entries[notification.id] = {
        status: "resolved",
        note: options.note ?? "The task behind this alert left the Needs You lane — nothing to do here anymore.",
        by: options.by ?? "stale-task-janitor",
        updatedAt: now,
      };
    }
    readState.read[notification.id] = readState.read[notification.id] ?? now;
    resolved += 1;
  }
  if (resolved > 0) {
    readState.updatedAt = now;
    resolutionState.updatedAt = now;
    await writeJsonAtomic(storage.readStateFile, readState);
    await writeJsonAtomic(storage.resolutionStateFile, resolutionState);
  }
  return { scanned: notifications.length, matched, resolved };
}

/** The Work Board task a lifecycle card tracks: `task:<id>` tag first, escalation id prefix as fallback. */
function taskIdForNotification(notification: Pick<AgentNotification, "id" | "tags">): string | null {
  const tagged = (notification.tags ?? []).find((tag) => tag.startsWith("task:"));
  if (tagged) return tagged.slice("task:".length).trim() || null;
  const match = /^task-needs-human-(.+)-[a-z0-9]+$/.exec(notification.id);
  return match ? match[1] : null;
}

/** Settings only (no notification-file scan) — cheap gate check for escalation senders. */
export async function readAgentNotificationSettings(options: NotificationStorageOptions = {}): Promise<AgentNotificationSettings> {
  const storage = resolveNotificationStorage(options);
  return readSettings(storage.settingsFile);
}

export async function updateAgentNotificationSettings(patch: Partial<AgentNotificationSettings>, options: NotificationStorageOptions = {}) {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const current = await readSettings(storage.settingsFile);
  const next: AgentNotificationSettings = {
    ...current,
    highPriorityMessagingEnabled: patch.highPriorityMessagingEnabled ?? current.highPriorityMessagingEnabled,
    messagingHandledBy: patch.messagingHandledBy?.trim() || current.messagingHandledBy,
    autonomyReviewMode: normalizeAutonomyReviewMode(patch.autonomyReviewMode ?? current.autonomyReviewMode),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(storage.settingsFile, next);
  return listAgentNotifications({ ...options, cursor: 0, limit: 40 });
}

export async function createAgentNotification(input: CreateAgentNotificationInput, options: NotificationStorageOptions = {}) {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const createdAt = parseDate(input.createdAt) ?? new Date().toISOString();
  const id = notificationId(input.id || `${input.agentName || "agent"}-${input.title}`);
  const date = createdAt.slice(0, 10).split("-");
  const dir = join(storage.notificationsRoot, date[0], date[1], date[2]);
  const file = join(dir, `${id}.md`);
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))];
  const frontmatter = [
    "---",
    `id: ${yamlScalar(id)}`,
    `title: ${yamlScalar(input.title.trim() || "Agent notification")}`,
    `createdAt: ${yamlScalar(createdAt)}`,
    `priority: ${normalizePriority(input.priority)}`,
    `kind: ${normalizeKind(input.kind)}`,
    `agentName: ${yamlScalar(input.agentName?.trim() || "Agent")}`,
    input.agentId?.trim() ? `agentId: ${yamlScalar(input.agentId.trim())}` : "",
    input.source?.trim() ? `source: ${yamlScalar(input.source.trim())}` : "",
    tags.length ? `tags: ${tags.join(", ")}` : "",
    "---",
  ].filter(Boolean).join("\n");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${frontmatter}\n\n${input.body.trim()}\n`, { mode: 0o600 });
  // The created id rides along so producers (escalation bridge) can later
  // stamp resolution lifecycle against this exact notification.
  return { id, ...(await listAgentNotifications({ ...options, cursor: 0, limit: 40 })) };
}

async function ensureNotificationRoot(storage: ReturnType<typeof resolveNotificationStorage>) {
  if (!statSync(storage.vaultRoot).isDirectory()) throw new Error("Vault path is not a directory.");
  await access(storage.vaultRoot, constants.R_OK | constants.W_OK);
  await mkdir(storage.notificationsRoot, { recursive: true, mode: 0o700 });
  await mkdir(storage.stateRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(storage.readmeFile)) {
    await writeFile(storage.readmeFile, notificationReadme(storage.folder), { mode: 0o600 });
  }
  if (!existsSync(storage.settingsFile)) {
    await writeJsonAtomic(storage.settingsFile, defaultSettings());
  }
  if (!existsSync(storage.readStateFile)) {
    await writeJsonAtomic(storage.readStateFile, { read: {}, updatedAt: new Date().toISOString() } satisfies ReadState);
  }
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(fullPath);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) return [fullPath];
    return [];
  }));
  return files.flat();
}

async function readNotificationFile(path: string, storage: ReturnType<typeof resolveNotificationStorage>, readState: ReadState, resolutionState: ResolutionState): Promise<AgentNotification | null> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw.trim()) return null;
  const { frontmatter, body } = parseFrontmatter(raw);
  const createdAt = parseDate(frontmatter.createdAt || frontmatter.date) ?? new Date(statSync(path).mtimeMs).toISOString();
  const id = clean(frontmatter.id) || idFromPath(path, storage.notificationsRoot);
  const priority = normalizePriority(frontmatter.priority);
  const kind = normalizeKind(frontmatter.kind || frontmatter.type);
  const title = clean(frontmatter.title) || firstMarkdownHeading(body) || "Agent notification";
  const readAt = readState.read[id];
  return {
    id,
    title,
    body: body.trim(),
    priority,
    kind,
    agentName: clean(frontmatter.agentName || frontmatter.agent) || "Agent",
    agentId: clean(frontmatter.agentId),
    source: clean(frontmatter.source),
    createdAt,
    filePath: relative(storage.vaultRoot, path).split(sep).join("/"),
    read: Boolean(readAt),
    readAt,
    tags: parseTags(frontmatter.tags),
    resolution: resolutionState.entries[id],
  };
}

function parseFrontmatter(raw: string) {
  if (!raw.startsWith("---")) return { frontmatter: {} as Record<string, string>, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {} as Record<string, string>, body: raw };
  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter, body: raw.slice(end + 4).replace(/^\s+/, "") };
}

async function readReadState(path: string): Promise<ReadState> {
  const parsed = await readJson<Partial<ReadState>>(path, { read: {}, updatedAt: new Date().toISOString() });
  return {
    read: parsed.read && typeof parsed.read === "object" ? parsed.read : {},
    updatedAt: parsed.updatedAt || new Date().toISOString(),
  };
}

async function readResolutionState(path: string): Promise<ResolutionState> {
  const parsed = await readJson<Partial<ResolutionState>>(path, { entries: {}, updatedAt: "" });
  const entries: Record<string, AgentNotificationResolution> = {};
  for (const [id, value] of Object.entries(parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {})) {
    if (value && typeof value === "object" && VALID_RESOLUTION_STATUSES.has((value as AgentNotificationResolution).status)) {
      entries[id] = value as AgentNotificationResolution;
    }
  }
  return { entries, updatedAt: parsed.updatedAt || "" };
}

/**
 * Stamp (or clear, with null) the resolution lifecycle of one notification.
 * Called by remediation loops — escalation bridge, autonomy driver — when the
 * reported condition is being retried ("in-progress") or has cleared
 * ("resolved"). No-ops when the stored entry already matches, so periodic
 * sweeps don't rewrite the sidecar every tick.
 */
export async function setAgentNotificationResolution(
  id: string,
  resolution: { status: AgentNotificationResolution["status"]; note?: string; by?: string } | null,
  options: NotificationStorageOptions = {},
): Promise<boolean> {
  const storage = resolveNotificationStorage(options);
  await ensureNotificationRoot(storage);
  const state = await readResolutionState(storage.resolutionStateFile);
  const current = state.entries[id];
  if (!resolution) {
    if (!current) return false;
    delete state.entries[id];
  } else {
    if (current && current.status === resolution.status && (current.note ?? "") === (resolution.note ?? "")) return false;
    state.entries[id] = {
      status: resolution.status,
      note: resolution.note?.trim() || undefined,
      by: resolution.by?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
  }
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(storage.resolutionStateFile, state);
  return true;
}

async function readSettings(path: string): Promise<AgentNotificationSettings> {
  const parsed = await readJson<Partial<AgentNotificationSettings>>(path, {});
  const defaults = defaultSettings();
  return {
    ...defaults,
    ...parsed,
    highPriorityMessagingEnabled: parsed.highPriorityMessagingEnabled ?? defaults.highPriorityMessagingEnabled,
    messagingHandledBy: parsed.messagingHandledBy?.trim() || defaults.messagingHandledBy,
    autonomyReviewMode: normalizeAutonomyReviewMode(parsed.autonomyReviewMode),
    updatedAt: parsed.updatedAt || defaults.updatedAt,
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}

function summarizeNotifications(notifications: AgentNotification[], folder: string, settings: AgentNotificationSettings): AgentNotificationSummary {
  const unreadNotifications = notifications.filter((notification) => !notification.read);
  return {
    total: notifications.length,
    unread: unreadNotifications.length,
    highUnread: unreadNotifications.filter((notification) => notification.priority === "high").length,
    urgentUnread: unreadNotifications.filter((notification) => notification.priority === "urgent").length,
    folder,
    settings,
  };
}

function defaultSettings(): AgentNotificationSettings {
  return {
    highPriorityMessagingEnabled: false,
    messagingHandledBy: "Configured messaging agent",
    autonomyReviewMode: "autonomous",
    updatedAt: new Date().toISOString(),
  };
}

function safeVaultFolder(folder?: string | null) {
  const value = folder?.trim();
  if (!value) return "";
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Notifications folder must be a relative path inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function notificationReadme(folder: string) {
  return `# Agent Notifications

This folder is the shared notification inbox for local agents.

## Folder map

- \`notifications/YYYY/MM/DD/*.md\` - agent-authored notification notes
- \`state/read-state.json\` - dashboard read receipts
- \`state/settings.json\` - dashboard notification settings

## Agent note format

\`\`\`md
---
id: agent-unique-id
title: Short user-facing title
createdAt: 2026-05-19T12:00:00.000Z
priority: normal
kind: message
agentName: Hermes
agentId: hermes-orchestrator
source: optional run, task, or file reference
tags: hivemind, user-attention
---

Write the notification body here. Keep it concise and say what the user needs to know or decide.
\`\`\`

Priorities: \`low\`, \`normal\`, \`high\`, \`urgent\`.
Kinds: \`message\`, \`decision\`, \`task\`, \`alert\`, \`system\`.

High-priority messaging escalation is only a preference flag. Delivery to Telegram, iMessage, Discord, or other channels should be handled by a configured messaging agent, not the dashboard.

Autonomy review mode defaults to \`autonomous\`, so agents can continue operating without mandatory approval. Operators may opt into \`review-high-risk\` or \`review-all\` from the dashboard Alerts view when they want more human review.

Vault-relative folder: \`${folder}\`
`;
}

function clean(value?: string) {
  return value?.trim() || undefined;
}

function normalizePriority(value?: string): AgentNotificationPriority {
  const candidate = value?.trim().toLowerCase() as AgentNotificationPriority | undefined;
  return candidate && VALID_PRIORITIES.has(candidate) ? candidate : "normal";
}

function normalizeKind(value?: string): AgentNotificationKind {
  const candidate = value?.trim().toLowerCase() as AgentNotificationKind | undefined;
  return candidate && VALID_KINDS.has(candidate) ? candidate : "message";
}

function normalizeAutonomyReviewMode(value?: string): AgentAutonomyReviewMode {
  const candidate = value?.trim().toLowerCase() as AgentAutonomyReviewMode | undefined;
  return candidate && VALID_AUTONOMY_REVIEW_MODES.has(candidate) ? candidate : "autonomous";
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstMarkdownHeading(body: string) {
  return body.split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
}

function parseTags(value?: string) {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(/[, ]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean);
}

function idFromPath(path: string, root: string) {
  return relative(root, path).replace(/\.md$/i, "").split(sep).join("/");
}

function notificationId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || `notification-${Date.now().toString(36)}`;
}

function yamlScalar(value: string) {
  return JSON.stringify(value);
}
