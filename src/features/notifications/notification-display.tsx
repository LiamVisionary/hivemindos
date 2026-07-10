import { Check, CircleAlert, MessageSquare, Settings2 } from "lucide-react";

import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentNotification } from "@/lib/types/agent-notifications";

export function notificationDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function groupNotifications(notifications: AgentNotification[]) {
  return notifications.reduce<Array<{ label: string; items: AgentNotification[] }>>((groups, notification) => {
    const label = notificationDayLabel(notification.createdAt);
    const group = groups.find((item) => item.label === label);
    if (group) group.items.push(notification);
    else groups.push({ label, items: [notification] });
    return groups;
  }, []);
}

// Look-alike consolidation lives in the pure ./notification-clustering module
// (no JSX) so the hermetic node suite can exercise it directly.

export function notificationIcon(kind: AgentNotification["kind"], priority: AgentNotification["priority"]) {
  if (priority === "urgent" || priority === "high") return <CircleAlert aria-hidden="true" />;
  if (kind === "task" || kind === "decision") return <Check aria-hidden="true" />;
  if (kind === "system") return <Settings2 aria-hidden="true" />;
  return <MessageSquare aria-hidden="true" />;
}

export function humanizeNotificationActor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Agent";
  if (/^queen[-_\s]*bee$/i.test(trimmed)) return "Queen Bee";
  if (/^worker[-_\s]*bee$/i.test(trimmed)) return "Worker Bee";
  if (/[-_]/.test(trimmed) && trimmed === trimmed.toLowerCase()) {
    return trimmed
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return trimmed;
}

export function isHermesAuthNotification(notification: AgentNotification) {
  const title = notification.title.toLowerCase();
  const body = notification.body.toLowerCase();
  return notification.tags.includes("auth")
    && notification.tags.includes("hermes")
    || title.includes("hermes auth")
    || body.includes("hermes/codex re-authentication");
}

export function notificationTaskTitle(notification: AgentNotification) {
  return /^Task "([^"]+)"/.exec(notification.body)?.[1]?.trim() ?? "";
}

/** The generic opener the escalation bridge writes for blocked ("needs-human")
 *  work — kept in sync with blockedTaskNotificationBody in escalation-notify.ts
 *  (that module is server-only, so the literal can't be shared across the boundary). */
const BLOCKED_WORK_LEAD = "This Work Board task is blocked and waiting for a human decision or missing input.";

export function isBlockedWorkNotification(notification: AgentNotification) {
  return notification.tags.includes("needs-human")
    || notification.body.startsWith(BLOCKED_WORK_LEAD);
}

/** The blocked task's title, parsed from the escalation bridge's "Task: <title>"
 *  line (distinct from notificationTaskTitle's quoted `Task "…"` form). */
export function blockedWorkTaskTitle(notification: AgentNotification) {
  return /^Task:\s*(.+)$/m.exec(notification.body)?.[1]?.trim() ?? "";
}

export function notificationMachineName(notification: AgentNotification) {
  return /(?:failed|sign-in) on (.+)$/i.exec(notification.title)?.[1]?.trim()
    || / on ([^.\n]+?) needs Hermes\/Codex re-authentication/i.exec(notification.body)?.[1]?.trim()
    || "";
}

export function notificationFailedWorkerName(notification: AgentNotification) {
  return /could not run because (.+?) on .+? needs Hermes\/Codex re-authentication/i.exec(notification.body)?.[1]?.trim()
    || /blocked because (.+?) needs Hermes\/Codex sign-in/i.exec(notification.body)?.[1]?.trim()
    || "";
}

export function summarizeHermesAuthError(message: string) {
  const reason = /Reason:\s*([^\n]+)/i.exec(message)?.[1]?.trim();
  if (reason) return reason;
  if (/refresh token was already consumed/i.test(message)) {
    return "The Codex refresh token was already used by another client, so Hermes needs a fresh sign-in.";
  }
  return message.trim().split("\n").find(Boolean)?.replace(/\s+/g, " ").slice(0, 220)
    || "Hermes asked for re-authentication before it could continue.";
}

export function notificationActorMeta(notification: AgentNotification) {
  const failedHermesWorker = notificationFailedWorkerName(notification);
  const rawActor = failedHermesWorker || notification.agentName || notification.agentId || "Agent";
  const normalized = rawActor.toLowerCase().replace(/[_\s]+/g, "-");
  const queen = normalized === "queen-bee" || normalized.includes("queen-bee");
  const worker = Boolean(failedHermesWorker) || normalized.includes("worker") || normalized.includes("hermes") || normalized.includes("agent");
  return {
    icon: queen ? beeRoleIconPath("queen") : worker ? beeRoleIconPath("worker") : "",
    label: humanizeNotificationActor(rawActor),
    role: queen ? "Orchestrator" : worker ? "Worker bee" : "Agent",
  };
}

export function notificationSourceLabel(notificationOrSource: AgentNotification | string | undefined) {
  const source = typeof notificationOrSource === "string" ? notificationOrSource : notificationOrSource?.source;
  const notification = typeof notificationOrSource === "string" ? undefined : notificationOrSource;
  const trimmed = source?.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("kanban:")) {
    const taskTitle = notification ? notificationTaskTitle(notification) : "";
    return taskTitle ? `Task: ${taskTitle}` : "Work board";
  }
  return trimmed;
}

export function notificationDisplayTitle(notification: AgentNotification) {
  if (!isHermesAuthNotification(notification)) return notification.title;
  const actor = notificationActorMeta(notification).label;
  return `${actor} is signed out`;
}

export function notificationDisplayBody(notification: AgentNotification) {
  if (isHermesAuthNotification(notification)) {
    const actor = notificationActorMeta(notification).label;
    const machine = notificationMachineName(notification);
    const where = machine || "that machine";
    const task = notificationTaskTitle(notification);
    return [
      `${actor} couldn’t start${task ? ` “${task}”` : " this task"} because Codex is signed out on ${where}.`,
      `Run this on ${where}:`,
      "```bash",
      "codex",
      "hermes auth",
      "```",
      `Reason: ${summarizeHermesAuthError(notification.body)}`,
      "If Hermes asks for model access afterward, run `hermes model` too.",
    ].join("\n\n");
  }
  // Blocked ("needs-human") work: lead with the task title so the clamped
  // one-line row preview names *which* work is blocked, instead of the generic
  // "This Work Board task is blocked…" opener (all the collapsed row can show).
  if (isBlockedWorkNotification(notification)) {
    const title = blockedWorkTaskTitle(notification);
    if (title) {
      const rest = notification.body
        .split("\n")
        .filter((line) => !line.startsWith(BLOCKED_WORK_LEAD) && !/^Task:\s*/.test(line));
      return [`“${title}” is blocked and waiting on your decision.`, ...rest].join("\n");
    }
  }
  return notification.body;
}

export function notificationPriorityLabel(priority: AgentNotification["priority"]) {
  if (priority === "urgent") return "Urgent";
  if (priority === "high") return "Needs attention";
  if (priority === "low") return "FYI";
  return "Notice";
}

export function notificationKindLabel(kind: AgentNotification["kind"]) {
  if (kind === "alert") return "Alert";
  if (kind === "task") return "Task";
  if (kind === "decision") return "Decision";
  if (kind === "system") return "System";
  return "Message";
}

export function notificationTagLabel(tag: string) {
  const labels: Record<string, string> = {
    auth: "Sign-in",
    hermes: "Hermes",
    kanban: "Work board",
    runtime: "Runtime",
  };
  return labels[tag] ?? humanizeNotificationActor(tag);
}
