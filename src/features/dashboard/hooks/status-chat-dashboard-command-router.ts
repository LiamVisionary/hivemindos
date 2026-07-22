import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { DashboardSlashCommandAction } from "@/features/chat/dashboard-slash-commands";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { handleDashboardHandoffTaskCommand } from "./dashboard-handoff-command";
import { handleDashboardNoteCommand } from "./dashboard-note-command";
import { handleDashboardSwarmCommand, handleDashboardSwarmSimCommand } from "./dashboard-swarm-command";
import { handleDashboardSwarmGoalCommand } from "./dashboard-swarm-goal-command";

type ChatMessage = { role: string; content: string; surface: string };

type ChatPreviewState = { agentId: string; leafKey: string; messages: ChatMessage[] } | null;

export type StatusChatDashboardCommandInput = {
  dashboardCommand: DashboardSlashCommandAction;
  prompt: string;
  selectedAgent: AgentProfile;
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  agents?: AgentProfile[];
  chatSetupIssue: (agent: AgentProfile) => string;
  sharedVault: SharedVaultConfig;
  selectedChatDirectoryPath?: string;
  walletsByAgent: Record<string, AgentWalletConfig>;
  createDefaultAgentWallet: (agentId: string) => AgentWalletConfig;
  honeyLedgerEnabled: boolean;
  chatTurn: { clearComposer?: boolean };
  appendMessage: (agentId: string, message: ChatMessage, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: ChatMessage[]) => void;
  setText: (value: string) => void;
  setAttachmentError: (value: string) => void;
  setAttachmentMenuOpen: (value: boolean) => void;
  setMessagesByAgent: (updater: (current: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) => void;
  setSelectedChatPreview: (updater: (current: ChatPreviewState) => ChatPreviewState) => void;
  setActiveView?: (view: DashboardView) => void;
  refreshMaintenanceReport?: () => unknown;
  searchAllRuntimeSessions?: (query: string) => unknown;
  refreshRuntimeUsage?: () => unknown;
  refreshNotifications?: () => unknown;
};

export async function handleStatusChatDashboardCommand(input: StatusChatDashboardCommandInput) {
  const { dashboardCommand, prompt, selectedAgent, selectedChatLeafKey, selectedStorageKey } = input;
  const base = {
    prompt,
    selectedAgent,
    selectedChatLeafKey,
    selectedStorageKey,
    appendMessage: input.appendMessage,
    appendPreviewMessages: input.appendPreviewMessages,
    setText: input.setText,
    setAttachmentError: input.setAttachmentError,
    setAttachmentMenuOpen: input.setAttachmentMenuOpen,
    setMessagesByAgent: input.setMessagesByAgent,
    setSelectedChatPreview: input.setSelectedChatPreview,
  };
  if (dashboardCommand.name === "handoff-task") {
    await handleDashboardHandoffTaskCommand(base);
    return true;
  }
  if (dashboardCommand.name === "note") {
    await handleDashboardNoteCommand({ ...base, sharedVault: input.sharedVault });
    return true;
  }
  if (dashboardCommand.name === "swarm") {
    await handleDashboardSwarmCommand({ ...base, ...swarmInput(input) });
    return true;
  }
  if (dashboardCommand.name === "swarm-goal") {
    await handleDashboardSwarmGoalCommand({ ...base, sharedVault: input.sharedVault });
    return true;
  }
  if (dashboardCommand.name === "swarm-sim") {
    await handleDashboardSwarmSimCommand({ ...base, appOrigin: globalThis.window?.location.origin, ...swarmInput(input) });
    return true;
  }

  const userMessage = { role: "user", content: prompt, surface: "chat" };
  const assistantMessage = { role: "assistant", content: dashboardCommand.reply, surface: "chat" };
  input.appendMessage(selectedAgent.id, userMessage, selectedStorageKey);
  input.appendMessage(selectedAgent.id, assistantMessage, selectedStorageKey);
  input.appendPreviewMessages(selectedAgent.id, selectedChatLeafKey, [userMessage, assistantMessage]);
  if (input.chatTurn.clearComposer !== false) input.setText("");
  input.setAttachmentError("");
  input.setAttachmentMenuOpen(false);
  input.setActiveView?.(dashboardCommand.view);
  if (dashboardCommand.refresh === "diagnostics") void input.refreshMaintenanceReport?.();
  if (dashboardCommand.refresh === "sessions") void input.searchAllRuntimeSessions?.("");
  if (dashboardCommand.refresh === "usage") void input.refreshRuntimeUsage?.();
  if (dashboardCommand.refresh === "notifications") void input.refreshNotifications?.();
  return true;
}

function swarmInput(input: StatusChatDashboardCommandInput) {
  return {
    agents: input.agents ?? [],
    chatSetupIssue: input.chatSetupIssue,
    sharedVault: input.sharedVault,
    workingDirectory: input.selectedChatDirectoryPath,
    walletsByAgent: input.walletsByAgent,
    createDefaultAgentWallet: input.createDefaultAgentWallet,
    honeyLedgerEnabled: input.honeyLedgerEnabled,
  };
}
