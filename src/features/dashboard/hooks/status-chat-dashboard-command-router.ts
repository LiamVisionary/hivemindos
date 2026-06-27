// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { handleDashboardHandoffTaskCommand } from "./dashboard-handoff-command";
import { handleDashboardSwarmCommand, handleDashboardSwarmSimCommand } from "./dashboard-swarm-command";
import { handleDashboardSwarmGoalCommand } from "./dashboard-swarm-goal-command";

export async function handleStatusChatDashboardCommand(input: any) {
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
  if (input.queuedMessage.clearComposer !== false) input.setText("");
  input.setAttachmentError("");
  input.setAttachmentMenuOpen(false);
  input.setActiveView?.(dashboardCommand.view);
  if (dashboardCommand.refresh === "diagnostics") void input.refreshMaintenanceReport?.();
  if (dashboardCommand.refresh === "sessions") void input.searchAllRuntimeSessions?.("");
  if (dashboardCommand.refresh === "usage") void input.refreshRuntimeUsage?.();
  if (dashboardCommand.refresh === "notifications") void input.refreshNotifications?.();
  return true;
}

function swarmInput(input: any) {
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
