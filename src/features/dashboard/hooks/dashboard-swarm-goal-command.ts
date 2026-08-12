import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import { buildSwarmGoalPrompt, parseSwarmGoalCommand, swarmGoalTaskTitle } from "@/features/chat/swarm-goal-prompt";
import { appendCommandMessages, clearComposer, replacePendingReply } from "./dashboard-handoff-command";

type ChatMessage = { role: string; content: string; surface: string };

type SwarmGoalCommandInput = {
  prompt: string;
  selectedAgent: any;
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  sharedVault: SharedVaultConfig;
  appendMessage: (agentId: string, message: ChatMessage, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: ChatMessage[]) => void;
  setText: (value: string) => void;
  setAttachmentError: (value: string) => void;
  setAttachmentMenuOpen: (value: boolean) => void;
  setMessagesByAgent: (updater: (current: any) => any) => void;
  setSelectedChatPreview: (updater: (current: any) => any) => void;
};

export async function handleDashboardSwarmGoalCommand(input: SwarmGoalCommandInput) {
  const task = parseSwarmGoalCommand(input.prompt);
  const userMessage: ChatMessage = { role: "user", content: input.prompt, surface: "chat" };
  if (!task) {
    const assistantMessage: ChatMessage = { role: "assistant", content: "What should the swarm build?", surface: "chat" };
    appendCommandMessages(input, userMessage, assistantMessage);
    clearComposer(input);
    return;
  }

  const rewrittenPrompt = buildSwarmGoalPrompt(task);
  const pendingMessage: ChatMessage = { role: "assistant", content: "Rewriting the prompt and sending it to Queen Bee...", surface: "chat" };
  appendCommandMessages(input, userMessage, pendingMessage);
  clearComposer(input);

  try {
    const response = await fetch("/api/queen-bee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: rewrittenPrompt,
        source: "dashboard-swarm-goal",
        mode: "act",
        priority: "high",
        taskTitle: swarmGoalTaskTitle(task),
        skills: ["planner", "code", "qa"],
        loopTemplateId: "app-build-harness",
        vaultPath: input.sharedVault.vaultPath,
        brainServicesFolder: input.sharedVault.brainServicesFolder,
        kanbanFolder: input.sharedVault.kanbanFolder,
      }),
    });
    const data = await response.json().catch(() => null) as {
      ok?: boolean;
      task?: { id?: string; assignee?: string; targetMachine?: { name?: string } | null };
      route?: { autonomousPickupScheduled?: boolean; reason?: string };
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error ?? `Queen Bee returned HTTP ${response.status}`);
    }
    replacePendingReply(input, pendingMessage, formatSwarmGoalSubmission(rewrittenPrompt, data));
  } catch (error) {
    replacePendingReply(input, pendingMessage, `Swarm goal submission failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function formatSwarmGoalSubmission(rewrittenPrompt: string, data: {
  task?: { id?: string; assignee?: string; targetMachine?: { name?: string } | null };
  route?: { autonomousPickupScheduled?: boolean; reason?: string };
}) {
  const target = [
    data.task?.assignee ? `Assignee: ${data.task.assignee}` : "",
    data.task?.targetMachine?.name ? `Machine: ${data.task.targetMachine.name}` : "",
    data.route?.autonomousPickupScheduled ? "Autonomous pickup: scheduled" : "",
  ].filter(Boolean).join(" · ");
  return [
    "Submitted swarm goal to Queen Bee.",
    target,
    data.route?.reason ? `Route: ${data.route.reason}` : "",
    "",
    "Expanded prompt:",
    "",
    rewrittenPrompt,
  ].filter((line) => line !== "").join("\n");
}
