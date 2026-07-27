import type { AgentTask } from "@/features/dashboard/dashboard-types";

const INTERNAL_CHAT_TRANSPORT_PREFIXES = [
  "queen bee live voice override: for this voice turn",
  "inspect the local machine and retrieve the installed xurl cli version",
  "inspect the machine and retrieve the installed xurl cli version",
] as const;

/**
 * Chat history is a navigation index, not a transcript renderer. Build a short
 * deterministic caption without depending on CSS ellipsis, so malformed or
 * runtime-owned titles cannot turn one sidebar row into an entire prompt.
 */
export function compactChatSidebarText(value: unknown, maxWords: number) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.slice(0, Math.max(1, maxWords)).join(" ");
}

export function isInternalChatSidebarTask(task: AgentTask) {
  if (task.source !== "hermes-state") return false;
  if (task.sourceDetail?.trim().toLowerCase() === "subagent") return true;
  const transcript = [
    task.title,
    task.lastMessage,
    ...(task.messages ?? []).slice(0, 3).map((message) => message.content),
  ].join("\n").toLowerCase();
  return INTERNAL_CHAT_TRANSPORT_PREFIXES.some((prefix) => transcript.includes(prefix));
}
