/* notification-actions.ts — turn a notification into concrete next steps.
 *
 * Every notification card gets a row of action buttons derived from what the
 * notification is ABOUT (tags, kind, source, referenced task id), so "needs
 * attention" always comes with a way to act: deep-link to the thing that's
 * blocked, spin the notification into a Work Board task, or hand it to the
 * Queen chat to investigate. Pure and dependency-free at runtime (type-only
 * imports) so the hermetic node suite can exercise the derivation directly.
 *
 * Producers can make the derivation precise by stamping structured tags —
 * `task:<kanban id>` deep-links straight to the task (the escalation bridge's
 * needs-human sweep does this). Everything else falls back to keyword signals
 * so pre-existing notifications get useful buttons too.
 */

import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import type { AgentNotification } from "@/lib/types/agent-notifications";

export type NotificationActionDescriptor =
  | { type: "navigate"; label: string; target: DashboardRouteTarget }
  | { type: "work-board"; label: string }
  | { type: "discuss"; label: string; prompt: string };

export type NotificationActionSource = Pick<
  AgentNotification,
  "id" | "title" | "body" | "kind" | "priority" | "source" | "tags" | "agentName" | "createdAt" | "resolution"
>;

const TASK_ID_PATTERN = /\bt_[a-z0-9]{4,}_[a-z0-9]{3,}\b/i;
const MAX_ACTIONS = 5;

/** The kanban task a notification is about: `task:<id>` tag first, then any id in the text. */
export function notificationTaskId(notification: NotificationActionSource): string | null {
  for (const tag of notification.tags ?? []) {
    if (!tag.toLowerCase().startsWith("task:")) continue;
    const match = tag.slice("task:".length).match(TASK_ID_PATTERN);
    if (match) return match[0];
  }
  const text = `${notification.source ?? ""}\n${notification.title}\n${notification.body}`;
  return text.match(TASK_ID_PATTERN)?.[0] ?? null;
}

function haystack(notification: NotificationActionSource): string {
  return `${notification.title}\n${notification.body}\n${(notification.tags ?? []).join("\n")}\n${notification.source ?? ""}`.toLowerCase();
}

function hasTag(notification: NotificationActionSource, ...names: string[]): boolean {
  const tags = (notification.tags ?? []).map((tag) => tag.toLowerCase());
  return names.some((name) => tags.includes(name));
}

function isApprovalNotification(notification: NotificationActionSource, text = haystack(notification)): boolean {
  return hasTag(notification, "approval") || /approval|approve or deny/.test(text);
}

/** The message the "Discuss" button sends into the shared Queen chat. */
export function notificationDiscussPrompt(notification: NotificationActionSource): string {
  const body = notification.body.length > 900 ? `${notification.body.slice(0, 900)}\n[trimmed]` : notification.body;
  return [
    `I received this dashboard notification and want to deal with it now:`,
    ``,
    `Title: ${notification.title}`,
    `From: ${notification.agentName}${notification.source ? ` (${notification.source})` : ""} at ${notification.createdAt}`,
    body ? `Details:\n${body}` : null,
    ``,
    `Tell me: what caused this, whether it is already resolved, and the single next concrete action to take. If work is blocked on me, list exactly what needs my decision.`,
    `If you need the underlying Work Board task's current state, call the read_work_board tool${notificationTaskId(notification) ? ` with taskId ${notificationTaskId(notification)}` : ""} — do not ask me where the task lives.`,
  ].filter((line) => line !== null).join("\n");
}

/**
 * Ordered action buttons for one notification. Most specific first; capped so
 * the card never becomes a toolbar. Rules, in order:
 *   1. references a task        → open that task on the Work Board
 *   2. needs-human / kanban     → open the Work Board (Needs You lives there)
 *   3. company / driver signals → open Zero Human Companies
 *   4. approval / wallet        → open the Wallet (approvals surface)
 *   5. fleet / machine / TTS    → open the Fleet
 *   6. env / credential signals → open the shared Env setup panel
 *   always: send to Work Board (unless it IS a task already) + discuss with the Queen
 */
export function deriveNotificationActions(notification: NotificationActionSource): NotificationActionDescriptor[] {
  const actions: NotificationActionDescriptor[] = [];
  const text = haystack(notification);
  const taskId = notificationTaskId(notification);

  if (taskId) {
    // openTask deep-links all the way: scroll the board to the card and open
    // its conversation (bee-piloted), not just switch to the kanban view.
    actions.push({ type: "navigate", label: "Open task", target: { view: "kanban", taskId, openTask: true } });
  } else if (hasTag(notification, "needs-human", "kanban", "needs human", "work board") || /needs (you|human)|blocked on you|work board/.test(text)) {
    actions.push({ type: "navigate", label: "Open Work Board", target: { view: "kanban" } });
  }

  if (hasTag(notification, "company", "driver", "dispatch", "progress", "budget") || /\bcompany\b|autonomy driver/.test(text)) {
    actions.push({ type: "navigate", label: "Open Companies", target: { view: "governance" } });
  }

  if (hasTag(notification, "approval", "wallet") || isApprovalNotification(notification, text)) {
    actions.push({ type: "navigate", label: "Open Wallet", target: { view: "wallet" } });
  }

  if (hasTag(notification, "fleet-health", "machine", "tts", "collector", "linkd") || /collector|linkd|\btts\b|fleet/.test(text)) {
    actions.push({ type: "navigate", label: "Open Fleet", target: { view: "agents" } });
  }

  if (hasTag(notification, "env", "credential", "credentials", "setup") || /env var|credential|api key|token missing|\.env\b/.test(text)) {
    actions.push({ type: "navigate", label: "Open Env setup", target: { view: "vault", vaultPanel: "env" } });
  }

  // A notification that already points at a board task doesn't need a second
  // copy of itself on the board — and a RESOLVED condition doesn't need a
  // follow-up task at all.
  if (!taskId && !isApprovalNotification(notification, text) && notification.resolution?.status !== "resolved") {
    actions.push({ type: "work-board", label: "Send to board" });
  }

  actions.push({ type: "discuss", label: "Discuss", prompt: notificationDiscussPrompt(notification) });

  // De-dupe navigate targets (a notification can trip several keyword rules).
  const seen = new Set<string>();
  return actions
    .filter((action) => {
      if (action.type !== "navigate") return true;
      const key = JSON.stringify(action.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ACTIONS);
}
