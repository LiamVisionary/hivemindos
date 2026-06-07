type ChatMessage = { role: string; content: string; surface: string };

type HandoffCommandInput = {
  prompt: string;
  selectedAgent: any;
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  appendMessage: (agentId: string, message: ChatMessage, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: ChatMessage[]) => void;
  setText: (value: string) => void;
  setAttachmentError: (value: string) => void;
  setAttachmentMenuOpen: (value: boolean) => void;
  setMessagesByAgent: (updater: (current: any) => any) => void;
  setSelectedChatPreview: (updater: (current: any) => any) => void;
};

export async function handleDashboardHandoffTaskCommand(input: HandoffCommandInput) {
  const {
    prompt,
    selectedAgent,
    selectedChatLeafKey,
    selectedStorageKey,
    appendMessage,
    appendPreviewMessages,
    setText,
    setAttachmentError,
    setAttachmentMenuOpen,
    setMessagesByAgent,
    setSelectedChatPreview,
  } = input;
  const userMessage = { role: "user", content: prompt, surface: "chat" };
  const args = prompt.replace(/^\/handoff-task\b/i, "").trim();
  const [target, ...taskParts] = args.split(/\s+/).filter(Boolean);
  const task = taskParts.join(" ").trim();
  const missingMessage = !target ? "Which machine should receive the handoff?" : !task ? `What should the agent on ${target} do?` : "";
  if (missingMessage) {
    const assistantMessage = { role: "assistant", content: missingMessage, surface: "chat" };
    appendCommandMessages({ selectedAgent, selectedChatLeafKey, selectedStorageKey, appendMessage, appendPreviewMessages }, userMessage, assistantMessage);
    clearComposer({ setText, setAttachmentError, setAttachmentMenuOpen });
    return;
  }

  const pendingMessage = { role: "assistant", content: `Handing this task to ${target}...`, surface: "chat" };
  appendCommandMessages({ selectedAgent, selectedChatLeafKey, selectedStorageKey, appendMessage, appendPreviewMessages }, userMessage, pendingMessage);
  clearComposer({ setText, setAttachmentError, setAttachmentMenuOpen });
  try {
    const response = await fetch("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send-task",
        target,
        task,
        sourceAgent: { runtime: selectedAgent.runtime, agentId: selectedAgent.agentId || selectedAgent.id },
      }),
    });
    const data = await response.json().catch(() => null);
    const reply = response.ok && data?.ok
      ? `Handed off to ${data.selectedAgent?.name ?? "the selected agent"} on ${data.machine?.name ?? target}.`
      : data?.needsUserInput && Array.isArray(data.candidates)
        ? `${data.error}\n\n${data.candidates.map((candidate: any) => `- ${candidate.name}`).join("\n")}`
        : `Handoff failed: ${data?.error ?? response.status}`;
    replacePendingReply({ selectedAgent, selectedChatLeafKey, selectedStorageKey, setMessagesByAgent, setSelectedChatPreview }, pendingMessage, reply);
  } catch (error) {
    appendMessage(selectedAgent.id, {
      role: "assistant",
      content: `Handoff failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      surface: "chat",
    }, selectedStorageKey);
  }
}

export function appendCommandMessages(
  context: Pick<HandoffCommandInput, "selectedAgent" | "selectedChatLeafKey" | "selectedStorageKey" | "appendMessage" | "appendPreviewMessages">,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
) {
  context.appendMessage(context.selectedAgent.id, userMessage, context.selectedStorageKey);
  context.appendMessage(context.selectedAgent.id, assistantMessage, context.selectedStorageKey);
  context.appendPreviewMessages(context.selectedAgent.id, context.selectedChatLeafKey, [userMessage, assistantMessage]);
}

export function clearComposer(input: Pick<HandoffCommandInput, "setText" | "setAttachmentError" | "setAttachmentMenuOpen">) {
  input.setText("");
  input.setAttachmentError("");
  input.setAttachmentMenuOpen(false);
}

export function replacePendingReply(
  context: Pick<HandoffCommandInput, "selectedAgent" | "selectedChatLeafKey" | "selectedStorageKey" | "setMessagesByAgent" | "setSelectedChatPreview">,
  pendingMessage: ChatMessage,
  reply: string,
) {
  context.setMessagesByAgent((current: any) => {
    const existing = current[context.selectedStorageKey] ?? [];
    const next = replacePending(existing, pendingMessage, reply);
    return { ...current, [context.selectedStorageKey]: next };
  });
  context.setSelectedChatPreview((current: any) => {
    if (!current || current.agentId !== context.selectedAgent.id || current.leafKey !== context.selectedChatLeafKey) return current;
    return { ...current, messages: replacePending(current.messages, pendingMessage, reply) };
  });
}

function replacePending(messages: ChatMessage[], pendingMessage: ChatMessage, reply: string) {
  const next = [...messages];
  let assistantIndex = -1;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "assistant" && next[index].content === pendingMessage.content) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex >= 0) next[assistantIndex] = { ...pendingMessage, content: reply };
  else next.push({ ...pendingMessage, content: reply });
  return next;
}
