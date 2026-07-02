import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { listMessagingChannels, sendHiveMessage } from "@/lib/services/messaging/channels";
import { createAgentNotification, readAgentNotificationSettings } from "@/lib/services/obsidian/agent-notifications";
import { listApprovals } from "@/lib/services/wallet/spend-approvals";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";
import { companySpendRollup, readCompanies } from "@/lib/services/companies-store";
import type { Company } from "@/lib/types/company";
import type { KanbanTask } from "@/lib/types/kanban";

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
  severity: "high" | "urgent";
  /** Re-notify interval. Defaults to 24h. */
  ttlMs?: number;
  tags?: string[];
};

type EscalationState = { sent: Record<string, number> };

type EscalationOptions = { vaultPath?: string | null };

async function readState(): Promise<EscalationState> {
  try {
    const parsed = JSON.parse(await fs.readFile(ESCALATION_STATE_PATH, "utf8")) as Partial<EscalationState>;
    return { sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {} };
  } catch {
    return { sent: {} };
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
  return { sent };
}

/** Channels escalations go to: the queen-bee defaults first, else every enabled channel. */
async function escalationChannels(options: EscalationOptions) {
  const { channels } = await listMessagingChannels({ vaultPath: options.vaultPath });
  const enabled = channels.filter((channel) => channel.enabled);
  const defaults = enabled.filter((channel) => channel.defaultForAgent);
  return defaults.length > 0 ? defaults : enabled;
}

function formatMessage(event: EscalationEvent): string {
  const icon = event.severity === "urgent" ? "🚨" : "⚠️";
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

    // The in-app notification is created regardless of external messaging so the
    // dashboard feed stays complete; the dedupe key gates BOTH surfaces.
    await createAgentNotification({
      title: event.title,
      body: event.body,
      priority: event.severity,
      kind: "alert",
      agentId: "queen-bee",
      agentName: "Queen Bee",
      source: "escalation-bridge",
      tags: ["escalation", ...(event.tags ?? [])],
    }, { vaultPath: options.vaultPath ?? undefined }).catch(() => undefined);

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
    // Only mark delivered events so a transient channel outage retries next sweep.
    if (delivered) {
      state.sent[event.key] = now;
      await writeState(state);
    }
    return delivered;
  } catch (error) {
    console.warn("[escalation-notify] escalation failed:", error instanceof Error ? error.message : error);
    return false;
  }
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

/**
 * Sweep the board, approvals, and company budgets for escalation-worthy state.
 * Called from the autonomy driver's tick so it runs headless. Returns how many
 * events were delivered externally this pass.
 */
export async function runEscalationSweep(options: EscalationOptions = {}): Promise<number> {
  let delivered = 0;
  const companies = await readCompanies().catch(() => [] as Company[]);

  // 1. Blocked work: every "needs-human" task pings once per day until handled.
  try {
    const board = await readBoard(null, { vaultPath: options.vaultPath ?? undefined });
    const blocked = (board.tasks ?? []).filter((task) => task.status === "needs-human");
    for (const task of blocked) {
      const company = companyForTask(task, companies);
      const lines = [
        `Task: ${task.title}`,
        company ? `Company: ${company.name}` : null,
        task.assignee ? `Agent: ${task.assignee}` : null,
        task.lastFailureReason ? `Failure: ${task.lastFailureReason}` : null,
        snippet(task.result) ? `Latest: ${snippet(task.result)}` : null,
        `Open the Work Board → "Needs You" to unblock (${blocked.length} waiting total).`,
      ].filter(Boolean);
      const ok = await notifyEscalation({
        key: `task-needs-human:${task.id}`,
        title: "Work is blocked on you",
        body: lines.join("\n"),
        severity: "high",
        tags: ["kanban", "needs-human"],
      }, options);
      if (ok) delivered += 1;
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
      const body = [
        `${approval.agentName || approval.agentId} wants to ${approval.kind} ~$${approval.amountUsd.toFixed(2)}${approval.target ? ` → ${approval.target}` : ""}.`,
        company ? `Company: ${company.name}` : null,
        `Reason: ${approval.reason}`,
        `Expires in ${expiresIn}. Approve or deny in the dashboard (Companies → approvals, or Wallet).`,
      ].filter(Boolean).join("\n");
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
