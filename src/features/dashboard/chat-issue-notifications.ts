import type { DashboardCompletionNotification } from "@/features/dashboard/dashboard-completion-notifications";

const MAX_NOTIFICATION_MESSAGE_LENGTH = 260;

function plainMessage(value: string) {
  return value
    .replace(/^\s*Error:\s*/i, "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[^:]+ unavailable$/i.test(line))
    .filter((line) => !/^Fix this blocker, then ask again\.?$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chatAssistantIssue(content: string) {
  const value = content.trim();
  if (!value) return "";
  const isExplicitError = /^Error:/i.test(value);
  const isUnavailableCard = /^\*{0,2}[^\n*]+ unavailable\*{0,2}(?:\n|$)/i.test(value);
  if (!isExplicitError && !isUnavailableCard) return "";
  return plainMessage(value);
}

export function chatIssueCompletionNotification(input: {
  agentId: string;
  agentName: string;
  chatLeaf?: string;
  issue: string;
  runId: string;
}): DashboardCompletionNotification {
  const message = plainMessage(input.issue) || "The task needs attention.";
  return {
    id: `chat-issue-${input.runId}`,
    initials: "!",
    title: `${input.agentName || "Agent"} needs attention`,
    message: message.length > MAX_NOTIFICATION_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_NOTIFICATION_MESSAGE_LENGTH - 1).trimEnd()}…`
      : message,
    destination: {
      view: "chat",
      agentId: input.agentId,
      ...(input.chatLeaf ? { chatLeaf: input.chatLeaf } : {}),
    },
  };
}
