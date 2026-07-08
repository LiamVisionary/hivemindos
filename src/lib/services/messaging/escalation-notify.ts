import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { listMessagingChannels, sendHiveMessage } from "@/lib/services/messaging/channels";
import {
  createAgentNotification,
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
};

type EscalationOptions = { vaultPath?: string | null; markReadWhenResolved?: boolean };

async function readState(): Promise<EscalationState> {
  try {
    const parsed = JSON.parse(await fs.readFile(ESCALATION_STATE_PATH, "utf8")) as Partial<EscalationState>;
    return {
      sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {},
      carded: parsed.carded && typeof parsed.carded === "object" ? parsed.carded : {},
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
    };
  } catch {
    return { sent: {}, carded: {}, notes: {} };
  }
}

async function writeState(state: EscalationState): Promise<void> {
  await fs.mkdir(path.dirname(ESCALATION_STATE_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(ESCALATION_STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

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
  return { sent, carded, notes };
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
    // the dashboard feed stays complete. Its own TTL gate (`carded`) — not
    // `sent` — governs card creation: external channel-outage retries must not
    // mint duplicate cards. Explicit id: the default (agentName+title slug)
    // made same-day escalations with the same title — e.g. two "Work is
    // blocked on you" for different tasks — silently overwrite each other's
    // card file. Key+timestamp keeps every send its own card and gives
    // resolvers an unambiguous target.
    const lastCardedAt = state.carded[event.key];
    if (!lastCardedAt || now - lastCardedAt >= ttl) {
      const created = await createAgentNotification({
        id: `${event.key}-${now.toString(36)}`,
        title: event.title,
        body: event.body,
        priority: event.severity,
        kind: "alert",
        agentId: "queen-bee",
        agentName: "Queen Bee",
        source: "escalation-bridge",
        tags: ["escalation", ...(event.tags ?? [])],
      }, { vaultPath: options.vaultPath ?? undefined }).catch(() => undefined);
      if (created?.id) {
        state.carded[event.key] = now;
        // Remember which card this key produced so a later recovery can stamp
        // resolution lifecycle on it (a re-notify after TTL re-points the key).
        state.notes[event.key] = created.id;
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
      console.warn(`[escalation-notify] no enabled messaging channel for: ${event.title}`);
      state.sent[event.key] = now;
      await writeState(state);
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
    const id = state.notes[key];
    if (!id) return false;
    const changed = await setAgentNotificationResolution(
      id,
      resolution ? { ...resolution, by: "escalation-bridge" } : null,
      { vaultPath: options.vaultPath ?? undefined },
    );
    let markedRead = false;
    if (resolution?.status === "resolved" && options.markReadWhenResolved) {
      markedRead = await markAgentNotificationRead(id, { vaultPath: options.vaultPath ?? undefined })
        .then(() => true)
        .catch(() => false);
    }
    return changed || markedRead;
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

/**
 * Sweep the board, approvals, and company budgets for escalation-worthy state.
 * Called from the autonomy driver's tick so it runs headless. Returns how many
 * events were delivered externally this pass.
 */
export async function runEscalationSweep(options: EscalationOptions = {}): Promise<number> {
  let delivered = 0;
  const companies = await readCompanies().catch(() => [] as Company[]);

  // 1. Blocked work: every "needs-human" task pings once per day until handled.
  //    A task the operator has parked (held) is intentionally deferred — it must
  //    not keep pinging. Kill switch HIVEMINDOS_APPROVAL_HOLD=0 restores pinging.
  const holdOn = process.env.HIVEMINDOS_APPROVAL_HOLD !== "0";
  try {
    const board = await readBoard(null, { vaultPath: options.vaultPath ?? undefined });
    const blocked = (board.tasks ?? []).filter(
      (task) => task.status === "needs-human" && !(holdOn && task.held),
    );
    for (const task of blocked) {
      const company = companyForTask(task, companies);
      const ok = await notifyEscalation({
        key: `task-needs-human:${task.id}`,
        title: "Work is blocked on you",
        body: blockedTaskNotificationBody({ task, company, waitingTotal: blocked.length }),
        severity: "high",
        // task:<id> is structured routing data — the notification panel's
        // action buttons deep-link straight to this task on the Work Board.
        tags: ["kanban", "needs-human", `task:${task.id}`],
      }, options);
      if (ok) delivered += 1;
    }

    // Lifecycle: needs-human cards auto-track their task. Re-dispatched →
    // "resolution in progress"; completed/archived/gone → "resolved"; bounced
    // back to needs-human → the stamp clears and the card reads live again.
    const state = await readState();
    const taskById = new Map((board.tasks ?? []).map((task) => [task.id, task]));
    for (const [key, noteId] of Object.entries(state.notes)) {
      if (!key.startsWith("task-needs-human:")) continue;
      const task = taskById.get(key.slice("task-needs-human:".length));
      const resolution = needsHumanResolutionFor(task ? task.status : null);
      await setAgentNotificationResolution(
        noteId,
        resolution ? { ...resolution, by: "escalation-bridge" } : null,
        { vaultPath: options.vaultPath ?? undefined },
      ).catch(() => undefined);
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
        if (window.remaining === null || window.remaining > 0) continue;
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

  return delivered;
}
