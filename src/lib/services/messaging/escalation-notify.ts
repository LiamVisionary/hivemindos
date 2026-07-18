import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { listMessagingChannels, sendHiveMessage } from "@/lib/services/messaging/channels";
import {
  createAgentNotification,
  listAgentNotifications,
  markAgentNotificationRead,
  readAgentNotificationSettings,
  setAgentNotificationResolution,
} from "@/lib/services/obsidian/agent-notifications";
import { listApprovals } from "@/lib/services/wallet/spend-approvals";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";
import { companySpendRollup, readCompanies } from "@/lib/services/companies-store";
import type { Company } from "@/lib/types/company";
import type { KanbanTask } from "@/lib/types/kanban";
import { formatReasoningTrailForPlainText } from "@/lib/types/reasoning-trail";
import { DEFAULT_QUEEN_BEE_NAME } from "@/lib/config/queen-bee-personality";

/**
 * Escalation bridge: routes the events an unattended operator must hear about —
 * blocked ("needs-human") work, pending/expiring spend approvals, exhausted
 * company budgets, dispatch failures — through the user-configured messaging
 * channels (Telegram/Discord/Slack/iMessage/webhook). This is what makes the
 * dormant `highPriorityMessagingEnabled` toggle real: escalations send only
 * while it is on AND at least one enabled channel exists.
 *
 * Delivery model: `runEscalationSweep` is called from the company-autonomy
 * driver's tick (so it works headless, no dashboard open), plus a couple of
 * immediate hooks (approval enqueue). Every event carries a dedupe key persisted
 * in ~/.hivemindos/escalation-notify.json — an event re-notifies only after its
 * TTL, so a stuck task pings daily instead of every 5 minutes. Sends are
 * best-effort: failures are logged, never thrown into business logic, and the
 * dedupe key is only marked after at least one channel accepted the message.
 */

export const ESCALATION_STATE_PATH = path.join(homedir(), ".hivemindos", "escalation-notify.json");

const DAY_MS = 24 * 60 * 60 * 1_000;
const APPROVAL_EXPIRY_WARNING_MS = 6 * 60 * 60 * 1_000;
const STATE_RETENTION_MS = 30 * DAY_MS;
const CHANNELS_MISSING_KEY = "escalation-channels-missing";

/**
 * Above this many blocked tasks in one company, per-task escalation collapses
 * into a single per-company daily digest. Per-task cards at scale are the
 * measured overload mechanism (115 daily severity-high events from one company);
 * a handful of genuinely-distinct asks still get their own rich cards.
 */
const digestThreshold = () => {
  const parsed = Number.parseInt(process.env.HIVEMINDOS_ESCALATION_DIGEST_THRESHOLD ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
};

export type EscalationEvent = {
  /** Stable dedupe key; the event re-notifies only after `ttlMs` since last send. */
  key: string;
  title: string;
  body: string;
  /**
   * high/urgent are true escalations — they also fan out to the user's messaging
   * channels. low/normal are in-app-only informational nudges (weekly status,
   * FYI): they still create a deduped dashboard card but never ping Telegram/etc.
   */
  severity: "low" | "normal" | "high" | "urgent";
  /** Re-notify interval. Defaults to 24h. */
  ttlMs?: number;
  tags?: string[];
};

/** Only true escalations (high/urgent) fan out to external messaging channels. */
function isExternallyDeliverable(severity: EscalationEvent["severity"]): boolean {
  return severity === "high" || severity === "urgent";
}

type EscalationState = {
  sent: Record<string, number>;
  /** Dedupe key → when its dashboard card was last created. Separate from `sent`
   *  (external delivery): channel-outage retries must not mint duplicate cards. */
  carded: Record<string, number>;
  /** Dedupe key → vault notification id, so resolvers can stamp lifecycle on the exact card. */
  notes: Record<string, string>;
  /**
   * Dedupe key → every card id this key ever minted (bounded). Resolution must
   * stamp ALL of them: before this existed, each 24h TTL re-fire minted a fresh
   * card and re-pointed `notes`, so only the newest card could ever auto-resolve
   * — 859 orphaned "Work is blocked on you" cards measured live 2026-07-16.
   */
  noteHistory: Record<string, string[]>;
  /** Epoch ms of the last stale-card janitor pass (it runs at most daily). */
  lastJanitorAt?: number;
};

type EscalationOptions = { vaultPath?: string | null; markReadWhenResolved?: boolean };

async function readState(): Promise<EscalationState> {
  try {
    const parsed = JSON.parse(await fs.readFile(ESCALATION_STATE_PATH, "utf8")) as Partial<EscalationState>;
    return {
      sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {},
      carded: parsed.carded && typeof parsed.carded === "object" ? parsed.carded : {},
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      noteHistory: parsed.noteHistory && typeof parsed.noteHistory === "object" ? parsed.noteHistory : {},
      lastJanitorAt: typeof parsed.lastJanitorAt === "number" ? parsed.lastJanitorAt : undefined,
    };
  } catch {
    return { sent: {}, carded: {}, notes: {}, noteHistory: {} };
  }
}

async function writeState(state: EscalationState): Promise<void> {
  await fs.mkdir(path.dirname(ESCALATION_STATE_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(ESCALATION_STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

const MAX_NOTE_HISTORY_PER_KEY = 24;

function pruneState(state: EscalationState, now: number): EscalationState {
  const sent: Record<string, number> = {};
  for (const [key, at] of Object.entries(state.sent)) {
    if (Number.isFinite(at) && now - at < STATE_RETENTION_MS) sent[key] = at;
  }
  const carded: Record<string, number> = {};
  for (const [key, at] of Object.entries(state.carded)) {
    if (Number.isFinite(at) && now - at < STATE_RETENTION_MS) carded[key] = at;
  }
  const notes: Record<string, string> = {};
  for (const [key, id] of Object.entries(state.notes)) {
    if ((sent[key] || carded[key]) && typeof id === "string" && id) notes[key] = id;
  }
  const noteHistory: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(state.noteHistory ?? {})) {
    if (!(sent[key] || carded[key]) || !Array.isArray(ids)) continue;
    const kept = ids.filter((id) => typeof id === "string" && id).slice(-MAX_NOTE_HISTORY_PER_KEY);
    if (kept.length) noteHistory[key] = kept;
  }
  return { sent, carded, notes, noteHistory, lastJanitorAt: state.lastJanitorAt };
}

function rememberCardId(state: EscalationState, key: string, id: string) {
  state.notes[key] = id;
  const history = state.noteHistory[key] ?? [];
  if (!history.includes(id)) history.push(id);
  state.noteHistory[key] = history.slice(-MAX_NOTE_HISTORY_PER_KEY);
}

/** Every card id this key has minted (newest last) — resolution stamps them all. */
function cardIdsForKey(state: EscalationState, key: string): string[] {
  const ids = [...(state.noteHistory[key] ?? [])];
  const latest = state.notes[key];
  if (latest && !ids.includes(latest)) ids.push(latest);
  return ids;
}

/** Channels escalations go to: the queen-bee defaults first, else every enabled channel. */
async function escalationChannels(options: EscalationOptions) {
  const { channels } = await listMessagingChannels({ vaultPath: options.vaultPath });
  const enabled = channels.filter((channel) => channel.enabled);
  const defaults = enabled.filter((channel) => channel.defaultForAgent);
  return defaults.length > 0 ? defaults : enabled;
}

function formatMessage(event: EscalationEvent): string {
  const icon = event.severity === "urgent" ? "🚨" : event.severity === "high" ? "⚠️" : "ℹ️";
  return `${icon} HivemindOS — ${event.title}\n\n${event.body}`;
}

/**
 * Send one escalation through the configured channels (dedupe-gated) and mirror
 * it into the vault notifications feed so the dashboard shows it too. Returns
 * true when at least one external channel accepted the message.
 */
export async function notifyEscalation(event: EscalationEvent, options: EscalationOptions = {}): Promise<boolean> {
  const now = Date.now();
  try {
    const state = pruneState(await readState(), now);
    const lastSentAt = state.sent[event.key];
    const ttl = event.ttlMs ?? DAY_MS;
    if (lastSentAt && now - lastSentAt < ttl) return false;

    // The in-app notification is created regardless of external messaging so
    // the dashboard feed stays complete. A key with a LIVE card (carded + a
    // remembered id whose condition never resolved) re-uses that card instead
    // of minting another: before this, each 24h TTL re-fire minted a fresh
    // `${key}-${timestamp}` card, so one task blocked 18 days left 18 cards,
    // 17 of them permanently orphaned (859 total measured live 2026-07-16).
    // Resolution deletes `carded[key]`, so a condition that RE-fires after
    // being resolved still gets a brand-new card. Explicit id: the default
    // (agentName+title slug) made same-day escalations with the same title
    // silently overwrite each other's card file.
    const hasLiveCard = Boolean(state.carded[event.key] && state.notes[event.key]);
    if (!hasLiveCard) {
      const created = await createAgentNotification({
        id: `${event.key}-${now.toString(36)}`,
        title: event.title,
        body: event.body,
        priority: event.severity,
        kind: "alert",
        agentId: "queen-bee",
        agentName: DEFAULT_QUEEN_BEE_NAME,
        source: "escalation-bridge",
        tags: ["escalation", ...(event.tags ?? [])],
      }, { vaultPath: options.vaultPath ?? undefined }).catch(() => undefined);
      if (created?.id) {
        state.carded[event.key] = now;
        // Remember which card this key produced so a later recovery can stamp
        // resolution lifecycle on it (history keeps every id ever minted).
        rememberCardId(state, event.key, created.id);
      }
    }

    // Informational nudges (low/normal) live only in the dashboard feed — the
    // card above is the whole delivery. Record sent so the TTL dedupe holds and
    // return false: nothing reached an external channel by design.
    if (!isExternallyDeliverable(event.severity)) {
      state.sent[event.key] = now;
      await writeState(state);
      return false;
    }

    const settings = await readAgentNotificationSettings({ vaultPath: options.vaultPath ?? undefined }).catch(() => null);
    if (!settings?.highPriorityMessagingEnabled) {
      // Messaging is off: record the event so the vault feed doesn't repeat, but
      // report false so callers know nothing reached an external channel.
      state.sent[event.key] = now;
      await writeState(state);
      return false;
    }

    const channels = await escalationChannels(options);
    if (channels.length === 0) {
      // The user turned urgent messaging ON but no channel exists — every
      // escalation was silently swallowed here for weeks (measured: 861
      // high-severity events, zero ever delivered externally). Surface ONE
      // deduped setup card, and do NOT stamp `sent`: the event re-tries next
      // sweep so it actually delivers once a channel is connected.
      console.warn(`[escalation-notify] no enabled messaging channel for: ${event.title}`);
      // Persist THIS event's card bookkeeping BEFORE the nested self-check
      // notification: the nested call reads+writes the same state file, and a
      // later write from our stale snapshot would erase its dedupe stamps —
      // re-minting the setup card once per swallowed event.
      await writeState(state);
      if (event.key !== CHANNELS_MISSING_KEY) {
        await notifyEscalation({
          key: CHANNELS_MISSING_KEY,
          title: "Urgent alerts have nowhere to go",
          body: [
            "\"Message me for urgent items\" is on, but no messaging channel is connected, so escalations only appear in the dashboard feed.",
            "Connect a Telegram/Discord/Slack/iMessage/webhook channel in Settings → Messaging to receive them.",
          ].join("\n"),
          severity: "normal", // card-only by design: an external ping is exactly what cannot happen here
          ttlMs: 7 * DAY_MS,
          tags: ["setup", "messaging"],
        }, options).catch(() => undefined);
      }
      return false;
    }

    let delivered = false;
    for (const channel of channels) {
      try {
        const result = await sendHiveMessage({ channelId: channel.id, message: formatMessage(event), vaultPath: options.vaultPath });
        delivered = delivered || result.ok;
      } catch (error) {
        console.warn(`[escalation-notify] ${channel.provider} send failed:`, error instanceof Error ? error.message : error);
      }
    }
    // Only mark delivered events so a transient channel outage retries next
    // sweep — but always persist the card bookkeeping (carded/notes).
    if (delivered) state.sent[event.key] = now;
    await writeState(state);
    return delivered;
  } catch (error) {
    console.warn("[escalation-notify] escalation failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Stamp resolution lifecycle on the dashboard card a previously-sent escalation
 * created (looked up by its dedupe key). Pass null to clear — the condition
 * re-fired and the card is live again. Best-effort; false when the key never
 * produced a card (or it aged out of state retention).
 */
export async function resolveEscalationNotification(
  key: string,
  resolution: { status: "in-progress" | "resolved"; note?: string } | null,
  options: EscalationOptions = {},
): Promise<boolean> {
  try {
    const state = await readState();
    const ids = cardIdsForKey(state, key);
    if (ids.length === 0) return false;
    // Stamp EVERY card this key ever minted, not just the newest — the whole
    // point of noteHistory (orphaned duplicates were the top alert-feed bloat).
    let changed = false;
    for (const id of ids) {
      const stamped = await setAgentNotificationResolution(
        id,
        resolution ? { ...resolution, by: "escalation-bridge" } : null,
        { vaultPath: options.vaultPath ?? undefined },
      ).catch(() => false);
      changed = changed || stamped;
      if (resolution?.status === "resolved" && options.markReadWhenResolved) {
        const markedRead = await markAgentNotificationRead(id, { vaultPath: options.vaultPath ?? undefined })
          .then(() => true)
          .catch(() => false);
        changed = changed || markedRead;
      }
    }
    // A resolved condition frees its key: if it fires again later, that is a
    // NEW incident and deserves a fresh card (notifyEscalation checks carded).
    if (resolution?.status === "resolved" && (state.carded[key] || state.notes[key])) {
      delete state.carded[key];
      delete state.notes[key];
      await writeState(state);
    }
    return changed;
  } catch {
    return false;
  }
}

export async function resolveSpendApprovalEscalationNotifications(
  approvalId: string,
  decision: "approved" | "denied",
  options: EscalationOptions = {},
): Promise<boolean> {
  const note = `Spend approval ${decision}.`;
  const normal = await resolveEscalationNotification(
    `approval:${approvalId}`,
    { status: "resolved", note },
    { ...options, markReadWhenResolved: true },
  );
  const expiring = await resolveEscalationNotification(
    `approval-expiring:${approvalId}`,
    { status: "resolved", note },
    { ...options, markReadWhenResolved: true },
  );
  return normal || expiring;
}

/**
 * Pure: the resolution a needs-human escalation should carry given its task's
 * CURRENT board status. null = the escalation is live (still needs-human), so
 * any earlier in-progress/resolved stamp must be cleared.
 */
export function needsHumanResolutionFor(taskStatus: string | null): { status: "in-progress" | "resolved"; note: string } | null {
  if (taskStatus === null) return { status: "resolved", note: "The task is no longer on the Work Board." };
  if (taskStatus === "done") return { status: "resolved", note: "The task completed — no action needed anymore." };
  if (taskStatus === "archived") return { status: "resolved", note: "The task was archived." };
  if (taskStatus === "ready" || taskStatus === "working") {
    return { status: "in-progress", note: "The task was re-dispatched and is being worked again — no action needed unless it blocks again." };
  }
  return null;
}

function companyForTask(task: Pick<KanbanTask, "source">, companies: Company[]): Company | null {
  const source = task.source ?? "";
  if (!source.startsWith("company:")) return null;
  const id = source.split(":")[1] ?? "";
  return companies.find((company) => company.id === id) ?? null;
}

function snippet(text: string | undefined, max = 220): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function approvalNotificationBody(input: {
  approval: Awaited<ReturnType<typeof listApprovals>>[number];
  company?: Company;
  expiresIn: string;
}): string {
  const { approval, company, expiresIn } = input;
  const fallback = [
    `${approval.agentName || approval.agentId} wants to ${approval.kind} ~$${approval.amountUsd.toFixed(2)}${approval.target ? ` -> ${approval.target}` : ""}.`,
    company ? `Company: ${company.name}` : null,
    `Reason: ${approval.reason}`,
  ].filter(Boolean).join("\n");
  return [
    approval.explanation ? formatReasoningTrailForPlainText(approval.explanation) : fallback,
    `Expires in ${expiresIn}. Approve or deny in the dashboard (Companies -> approvals, or Wallet).`,
  ].join("\n");
}

function blockedTaskNotificationBody(input: {
  task: KanbanTask;
  company: Company | null;
  waitingTotal: number;
}): string {
  const { task, company, waitingTotal } = input;
  const evidence = [
    task.lastFailureReason ? `Failure: ${task.lastFailureReason}` : null,
    snippet(task.result) ? `Latest result: ${snippet(task.result)}` : null,
  ].filter(Boolean);
  return [
    "This Work Board task is blocked and waiting for a human decision or missing input.",
    "Why now: the task is in Needs You.",
    `Task: ${task.title}`,
    company ? `Company: ${company.name}` : null,
    task.assignee ? `Agent: ${task.assignee}` : null,
    evidence.length ? "Evidence:" : null,
    ...evidence.map((line) => `- ${line}`),
    `Decision needed: open the Work Board -> Needs You to unblock it (${waitingTotal} waiting total).`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

/** One per-company daily rollup of everything blocked, oldest first. */
function needsHumanDigestBody(tasks: KanbanTask[], company: Company | null): string {
  const now = Date.now();
  const ageDays = (task: KanbanTask) => Math.max(0, Math.floor((now - (task.createdAt ?? now)) / DAY_MS));
  const newToday = tasks.filter((task) => now - (task.createdAt ?? 0) < DAY_MS).length;
  const oldest = Math.max(0, ...tasks.map(ageDays));
  const top = [...tasks].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).slice(0, 5);
  return [
    `${tasks.length} Work Board tasks are waiting on a human${company ? ` for ${company.name}` : ""} (${newToday} new in the last day, oldest ${oldest}d).`,
    "",
    "Oldest first:",
    ...top.map((task) => `- [${ageDays(task)}d] ${task.title}`),
    tasks.length > top.length ? `…and ${tasks.length - top.length} more.` : "",
    "",
    "Open the Work Board → Needs You to triage. Infrastructure failures are retried automatically; what remains here needs a decision or a missing input.",
  ].filter(Boolean).join("\n");
}

/**
 * Sweep the board, approvals, and company budgets for escalation-worthy state.
 * Called from the autonomy driver's tick so it runs headless. Returns how many
 * events were delivered externally this pass.
 */
export async function runEscalationSweep(options: EscalationOptions = {}): Promise<number> {
  let delivered = 0;
  const companies = await readCompanies().catch(() => [] as Company[]);

  // 1. Blocked work. A task the operator has parked (held) is intentionally
  //    deferred — it must not keep pinging. Kill switch HIVEMINDOS_APPROVAL_HOLD=0
  //    restores pinging. Delivery shape depends on volume PER COMPANY:
  //    - a handful of blocked tasks → one rich card per task (as before);
  //    - above the digest threshold → ONE per-company daily digest. Per-task
  //      fan-out at scale was the measured overload mechanism (115 daily
  //      severity-high events from one company, ~120 new cards/day), and it
  //      would flood any external channel the moment one is connected.
  const holdOn = process.env.HIVEMINDOS_APPROVAL_HOLD !== "0";
  try {
    const board = await readBoard(null, { vaultPath: options.vaultPath ?? undefined });
    const blocked = (board.tasks ?? []).filter(
      (task) => task.status === "needs-human" && !(holdOn && task.held),
    );
    const groups = new Map<string, { company: Company | null; tasks: KanbanTask[] }>();
    for (const task of blocked) {
      const company = companyForTask(task, companies);
      const groupKey = company?.id ?? "board";
      const group = groups.get(groupKey) ?? { company, tasks: [] };
      group.tasks.push(task);
      groups.set(groupKey, group);
    }
    const digestedTaskIds = new Set<string>();
    for (const [groupKey, group] of groups) {
      if (group.tasks.length <= digestThreshold()) {
        for (const task of group.tasks) {
          const ok = await notifyEscalation({
            key: `task-needs-human:${task.id}`,
            title: "Work is blocked on you",
            body: blockedTaskNotificationBody({ task, company: group.company, waitingTotal: blocked.length }),
            severity: "high",
            // task:<id> is structured routing data — the notification panel's
            // action buttons deep-link straight to this task on the Work Board.
            tags: ["kanban", "needs-human", `task:${task.id}`],
          }, options);
          if (ok) delivered += 1;
        }
        continue;
      }
      for (const task of group.tasks) digestedTaskIds.add(task.id);
      const ok = await notifyEscalation({
        key: `company-needs-human-digest:${groupKey}`,
        title: group.company ? `${group.company.name}: ${group.tasks.length} tasks are waiting on you` : `${group.tasks.length} tasks are waiting on you`,
        body: needsHumanDigestBody(group.tasks, group.company),
        severity: "high",
        tags: ["kanban", "needs-human-digest", ...(group.company ? [`company:${group.company.id}`] : [])],
      }, options);
      if (ok) delivered += 1;
    }

    // Digest keys resolve themselves when the pile drains below the threshold.
    {
      const state = await readState();
      for (const key of Object.keys(state.notes)) {
        if (!key.startsWith("company-needs-human-digest:")) continue;
        const groupKey = key.slice("company-needs-human-digest:".length);
        const group = groups.get(groupKey);
        if (!group || group.tasks.length <= digestThreshold()) {
          await resolveEscalationNotification(key, {
            status: "resolved",
            note: group ? "The waiting pile dropped back to a handful — individual cards resume." : "Nothing is waiting on you anymore.",
          }, { ...options, markReadWhenResolved: true });
        }
      }
    }

    // Lifecycle: needs-human cards auto-track their task. Re-dispatched →
    // "resolution in progress"; completed/archived/gone → "resolved"; bounced
    // back to needs-human → the stamp clears and the card reads live again.
    // Tasks folded into a digest resolve their per-task cards too — the digest
    // is now the one card carrying them.
    const state = await readState();
    const taskById = new Map((board.tasks ?? []).map((task) => [task.id, task]));
    for (const key of Object.keys({ ...state.notes, ...state.noteHistory })) {
      if (!key.startsWith("task-needs-human:")) continue;
      const taskId = key.slice("task-needs-human:".length);
      const task = taskById.get(taskId);
      if (task && digestedTaskIds.has(taskId)) {
        await resolveEscalationNotification(key, {
          status: "resolved",
          note: "Folded into the company's daily digest — the task itself is still waiting in Needs You.",
        }, { ...options, markReadWhenResolved: true });
        continue;
      }
      const resolution = needsHumanResolutionFor(task ? task.status : null);
      if (resolution?.status === "resolved") {
        await resolveEscalationNotification(key, resolution, { ...options, markReadWhenResolved: true });
        continue;
      }
      for (const noteId of cardIdsForKey(state, key)) {
        await setAgentNotificationResolution(
          noteId,
          resolution ? { ...resolution, by: "escalation-bridge" } : null,
          { vaultPath: options.vaultPath ?? undefined },
        ).catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn("[escalation-notify] board sweep failed:", error instanceof Error ? error.message : error);
  }

  // 2. Spend approvals: new pending ones, plus a louder ping when close to expiry.
  try {
    const pending = await listApprovals({ status: "pending" });
    const now = Date.now();
    for (const approval of pending) {
      const company = companies.find((item) => item.id === approval.companyId);
      const expiresInMs = approval.expiresAtMs - now;
      const expiresIn = expiresInMs > 0 ? `${Math.max(1, Math.round(expiresInMs / 3_600_000))}h` : "soon";
      const body = approvalNotificationBody({ approval, company, expiresIn });
      const nearExpiry = expiresInMs > 0 && expiresInMs < APPROVAL_EXPIRY_WARNING_MS;
      const ok = await notifyEscalation({
        key: nearExpiry ? `approval-expiring:${approval.id}` : `approval:${approval.id}`,
        title: nearExpiry ? "Spend approval about to expire" : "Spend approval needed",
        body,
        severity: nearExpiry ? "urgent" : "high",
        tags: ["wallet", "approval"],
      }, options);
      if (ok) delivered += 1;
    }
  } catch (error) {
    console.warn("[escalation-notify] approvals sweep failed:", error instanceof Error ? error.message : error);
  }

  // 3. Exhausted budgets on live companies: agents are spend-blocked until the
  //    window rolls or the cap is raised — the operator should know today.
  for (const company of companies) {
    if (!company.autonomy || company.frozen) continue;
    try {
      const rollup = await companySpendRollup(company, company.agentIds?.length ?? 0);
      const windows: Array<{ label: string; remaining: number | null; cap?: number; spent: number }> = [
        { label: "daily", remaining: rollup.dailyRemainingUsd, cap: company.dailyBudgetUsd, spent: rollup.dailySpentUsd },
        { label: "monthly", remaining: rollup.monthlyRemainingUsd, cap: company.monthlyBudgetUsd, spent: rollup.monthlySpentUsd },
        { label: "total", remaining: rollup.totalRemainingUsd, cap: company.totalBudgetUsd, spent: rollup.totalSpentUsd },
      ];
      for (const window of windows) {
        if (window.remaining === null || window.remaining > 0) {
          // Window rolled over or the cap was raised — the condition cleared,
          // so its card must stop reading as a live emergency.
          if (window.remaining !== null) {
            await resolveEscalationNotification(`company-budget:${company.id}:${window.label}`, {
              status: "resolved",
              note: `The ${window.label} budget window has headroom again ($${window.remaining.toFixed(2)} remaining).`,
            }, { ...options, markReadWhenResolved: true });
          }
          continue;
        }
        const ok = await notifyEscalation({
          key: `company-budget:${company.id}:${window.label}`,
          title: `${company.name}: ${window.label} budget exhausted`,
          body: [
            `Spent $${window.spent.toFixed(2)} of the $${(window.cap ?? 0).toFixed(2)} ${window.label} cap.`,
            "Member agents' spend is blocked until the window rolls or you raise the cap.",
          ].join("\n"),
          severity: "high",
          tags: ["company", "budget"],
        }, options);
        if (ok) delivered += 1;
      }
    } catch {
      // Rollup failure for one company must not stop the sweep.
    }
  }

  // 4. Daily janitor: the alert feed must not grow without bound. Any
  //    escalation-bridge card whose underlying task has left needs-human (or
  //    whose task id no longer exists) gets stamped resolved + read — including
  //    the historical duplicates minted before card-reuse existed (859 orphaned
  //    cards measured live 2026-07-16). At most one pass per day.
  try {
    const state = await readState();
    const now = Date.now();
    if (!state.lastJanitorAt || now - state.lastJanitorAt >= DAY_MS) {
      state.lastJanitorAt = now;
      await writeState(state);
      await janitorStaleTaskCards(companies, options);
    }
  } catch (error) {
    console.warn("[escalation-notify] janitor failed:", error instanceof Error ? error.message : error);
  }

  return delivered;
}

/**
 * Resolve + mark-read every escalation-bridge "Work is blocked on you" card that
 * no longer deserves a live slot in the feed: its task left needs-human, its
 * task id no longer exists, or its task is carried by a per-company digest now.
 * Runs regardless of the dedupe state, so it also clears the historical
 * duplicates minted before card-reuse existed. Bounded pagination keeps one
 * pass cheap even on a bloated feed.
 */
async function janitorStaleTaskCards(companies: Company[], options: EscalationOptions = {}): Promise<number> {
  const board = await readBoard(null, { vaultPath: options.vaultPath ?? undefined }).catch(() => null);
  if (!board) return 0;
  const holdOn = process.env.HIVEMINDOS_APPROVAL_HOLD !== "0";
  const taskById = new Map((board.tasks ?? []).map((task) => [task.id, task]));
  const blocked = (board.tasks ?? []).filter((task) => task.status === "needs-human" && !(holdOn && task.held));
  const blockedIds = new Set(blocked.map((task) => task.id));
  // Recompute which tasks the digest carries (same grouping as the sweep).
  const groupSizes = new Map<string, number>();
  for (const task of blocked) {
    const groupKey = companyForTask(task, companies)?.id ?? "board";
    groupSizes.set(groupKey, (groupSizes.get(groupKey) ?? 0) + 1);
  }
  const digestedIds = new Set(
    blocked
      .filter((task) => (groupSizes.get(companyForTask(task, companies)?.id ?? "board") ?? 0) > digestThreshold())
      .map((task) => task.id),
  );
  let cleaned = 0;
  let cursor: number | null = 0;
  for (let page = 0; page < 40 && cursor !== null; page += 1) {
    const result: Awaited<ReturnType<typeof listAgentNotifications>> | null = await listAgentNotifications({
      vaultPath: options.vaultPath ?? undefined,
      cursor,
      limit: 100,
    }).catch(() => null);
    if (!result) break;
    cursor = result.nextCursor;
    for (const notification of result.notifications) {
      if (notification.source !== "escalation-bridge") continue;
      if (notification.resolution?.status === "resolved") continue;
      const taskTag = (notification.tags ?? []).find((tag) => tag.startsWith("task:"));
      if (!taskTag) continue;
      const taskId = taskTag.slice("task:".length);
      const stillItsOwnCard = blockedIds.has(taskId) && !digestedIds.has(taskId);
      if (stillItsOwnCard) continue;
      // A re-dispatched (ready/working) task belongs to the lifecycle stamping
      // in the sweep ("resolution in progress"), not to the janitor: resolving
      // it here would lie — the ask may bounce right back.
      const liveStatus = taskById.get(taskId)?.status;
      if (!digestedIds.has(taskId) && (liveStatus === "ready" || liveStatus === "working")) continue;
      const note = digestedIds.has(taskId)
        ? "Folded into the company's daily digest — the task itself is still waiting in Needs You."
        : "The task is no longer waiting in Needs You.";
      await setAgentNotificationResolution(
        notification.id,
        { status: "resolved", note, by: "escalation-bridge" },
        { vaultPath: options.vaultPath ?? undefined },
      ).catch(() => undefined);
      await markAgentNotificationRead(notification.id, { vaultPath: options.vaultPath ?? undefined }).catch(() => undefined);
      cleaned += 1;
    }
  }
  if (cleaned > 0) console.log(`[escalation-notify] janitor resolved ${cleaned} stale blocked-task card(s)`);
  return cleaned;
}
