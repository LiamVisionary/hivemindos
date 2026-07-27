import { captureObsidianNoteFromDashboard } from "@/lib/native/obsidian";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import { appendCommandMessages, clearComposer, replacePendingReply } from "./dashboard-handoff-command";

type ChatMessage = { role: string; content: string; surface: string };

type NoteCommandInput = {
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

export function parseDashboardNoteCommand(prompt: string) {
  return prompt.match(/^\/note(?:\s+([\s\S]*))?$/i)?.[1]?.trim() ?? "";
}

export async function handleDashboardNoteCommand(input: NoteCommandInput) {
  const content = parseDashboardNoteCommand(input.prompt);
  const userMessage: ChatMessage = { role: "user", content: input.prompt, surface: "chat" };
  if (!content) {
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "Add note text after `/note` and I will save it to the shared brain.",
      surface: "chat",
    };
    appendCommandMessages(input, userMessage, assistantMessage);
    clearComposer(input);
    return;
  }

  const pendingMessage: ChatMessage = {
    role: "assistant",
    content: "Saving this note to the shared brain...",
    surface: "chat",
  };
  appendCommandMessages(input, userMessage, pendingMessage);
  clearComposer(input);

  try {
    const data = await captureObsidianNoteFromDashboard({
      vaultPath: input.sharedVault.vaultPath,
      inboxFolder: input.sharedVault.inboxFolder,
      content,
    });
    if (!data?.ok || !data.note) {
      throw new Error(data?.error ?? "The note writer did not return a saved note.");
    }
    replacePendingReply(input, pendingMessage, [
      "Saved to the shared brain.",
      "",
      `Title: ${data.note.title}`,
      `Path: \`${data.note.notePath}\``,
    ].join("\n"));
  } catch (error) {
    replacePendingReply(input, pendingMessage, `Could not save the note: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
