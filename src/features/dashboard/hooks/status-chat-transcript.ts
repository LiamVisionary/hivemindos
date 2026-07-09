import { buildTranscriptCardContent, extractTranscriptCard, type ChatTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import { looksLikeXPost } from "@/lib/services/x-transcript/x-url";
import type { XTranscriptResult } from "@/lib/services/x-transcript/x-transcript-service";

/** Parse `/transcript <url>` → the url argument (empty string when none given). Null when not the command. */
export function transcriptCommandUrl(input: string): string | null {
  const match = input.trim().match(/^\/transcript(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

type RunTranscriptInput = {
  url: string;
  rawPrompt: string;
  selectedAgent: { id: string };
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  chatAutoScrollRef: { current: boolean };
  clearChatComposerDraft: () => void;
  appendMessage: (agentId: string, message: Record<string, unknown>, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: Array<Record<string, unknown>>) => void;
  setMessagesByAgent: (updater: (current: Record<string, Array<Record<string, unknown>>>) => Record<string, Array<Record<string, unknown>>>) => void;
  setSelectedChatPreview: (updater: (current: { agentId: string; leafKey: string; messages: Array<Record<string, unknown>> } | null) => { agentId: string; leafKey: string; messages: Array<Record<string, unknown>> } | null) => void;
};

function replaceTranscriptMessage(input: RunTranscriptInput, cardId: string, content: string) {
  const updateMessages = (items: Array<Record<string, unknown>> = []) => items.map((message) => {
    const raw = typeof message.content === "string" ? message.content : "";
    const parsed = extractTranscriptCard(raw);
    if (!parsed || parsed.card.id !== cardId) return message;
    return { ...message, content };
  });
  input.setMessagesByAgent((current) => ({
    ...current,
    [input.selectedStorageKey]: updateMessages(current[input.selectedStorageKey] ?? []),
  }));
  input.setSelectedChatPreview((current) => {
    if (!current || current.agentId !== input.selectedAgent.id || current.leafKey !== input.selectedChatLeafKey) return current;
    return { ...current, messages: updateMessages(current.messages) };
  });
}

async function requestTranscript(url: string): Promise<XTranscriptResult> {
  const response = await fetch("/api/integrations/x-transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, summarize: true }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; result?: XTranscriptResult } | null;
  if (!response.ok || !data?.ok || !data.result) {
    throw new Error(data?.error || `Transcript request failed with HTTP ${response.status}.`);
  }
  return data.result;
}

async function runTranscript(input: RunTranscriptInput) {
  const cardId = `transcript-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();
  const runningCard: ChatTranscriptCard = { id: cardId, status: "running", url: input.url };
  const userMessage = { role: "user", content: input.rawPrompt, surface: "chat", createdAt };
  const assistantMessage = {
    role: "assistant",
    content: buildTranscriptCardContent(runningCard),
    surface: "chat",
    createdAt: createdAt + 1,
  };
  input.chatAutoScrollRef.current = true;
  input.clearChatComposerDraft();
  input.appendMessage(input.selectedAgent.id, userMessage, input.selectedStorageKey);
  input.appendMessage(input.selectedAgent.id, assistantMessage, input.selectedStorageKey);
  input.appendPreviewMessages(input.selectedAgent.id, input.selectedChatLeafKey, [userMessage, assistantMessage]);
  try {
    const result = await requestTranscript(input.url);
    const readyCard: ChatTranscriptCard = {
      id: cardId,
      status: "ready",
      url: input.url,
      canonicalUrl: result.canonicalUrl,
      kind: result.kind,
      author: result.author,
      title: result.title,
      transcript: result.transcript,
      durationSec: result.durationSec,
      postCount: result.postCount,
      source: result.source,
      warnings: result.warnings?.length ? result.warnings : undefined,
    };
    const trailing = [result.summary, result.followUpQuestion].filter(Boolean).join("\n\n");
    replaceTranscriptMessage(input, cardId, buildTranscriptCardContent(readyCard, trailing));
  } catch (error) {
    const errorCard: ChatTranscriptCard = {
      id: cardId,
      status: "error",
      url: input.url,
      error: error instanceof Error ? error.message : "Could not pull the transcript.",
    };
    replaceTranscriptMessage(input, cardId, buildTranscriptCardContent(errorCard));
  }
}

/** Intercept `/transcript <x-link>`. Returns true when handled (caller returns early). */
export async function handleTranscriptCommand(input: Omit<RunTranscriptInput, "url"> & { rawPrompt: string }): Promise<boolean> {
  const url = transcriptCommandUrl(input.rawPrompt);
  if (url === null) return false;
  if (!url || !looksLikeXPost(url)) {
    const userMessage = { role: "user", content: input.rawPrompt, surface: "chat" };
    const assistantMessage = {
      role: "assistant",
      content: "Add an X link after `/transcript`, for example `/transcript https://x.com/user/status/1780000000000000001`.",
      surface: "chat",
    };
    input.appendMessage(input.selectedAgent.id, userMessage, input.selectedStorageKey);
    input.appendMessage(input.selectedAgent.id, assistantMessage, input.selectedStorageKey);
    input.appendPreviewMessages(input.selectedAgent.id, input.selectedChatLeafKey, [userMessage, assistantMessage]);
    input.clearChatComposerDraft();
    return true;
  }
  await runTranscript({ ...input, url });
  return true;
}
