import { type DashboardStateSnapshot } from "@/lib/services/dashboard-state-client";
import { normalizeChatResponseBilling } from "@/lib/types/chat-billing";
import { normalizeEvaluationHumanFeedback } from "@/lib/types/evaluation";
import { normalizeApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";
import {
  findLastChatMessageIndex,
  findNextChatUserIndex,
  isCapabilityContinuationEcho,
  normalizedChatMessageContent,
  sameVisibleChatMessage,
  splitCombinedUserAssistantMessage,
  userMessagesLikelySameTurn,
} from "@/features/dashboard/chat-transcript-helpers";
import { runtimePromptFromSessionMessage } from "@/features/dashboard/hooks/status-chat-input-helpers";
import type { ChatMessage } from "@/features/dashboard/dashboard-types";

export const ACTIVE_CHAT_RUNS_STORAGE_KEY = "hivemindos.activeChatRuns.v1";
export const ACTIVE_CHAT_RUN_TTL_MS = 20 * 60 * 1000;

export type ActiveChatRunRecord = {
  storageKey: string;
  agentId: string;
  leafKey: string;
  startedAt: number;
  updatedAt: number;
  runId?: string;
  requestLabel?: string;
  sessionId?: string;
  status?: "active" | "stalled";
};

export function readActiveChatRuns(snapshot: DashboardStateSnapshot): Record<string, ActiveChatRunRecord> {
  try {
    const parsed = JSON.parse(snapshot[ACTIVE_CHAT_RUNS_STORAGE_KEY] || "{}") as Record<string, ActiveChatRunRecord>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed)
      .filter(([storageKey, run]) => (
        typeof storageKey === "string"
        && typeof run?.agentId === "string"
        && typeof run?.leafKey === "string"
        && typeof run?.startedAt === "number"
        && now - run.updatedAt < ACTIVE_CHAT_RUN_TTL_MS
      )));
  } catch {
    return {};
  }
}

export function compactActiveChatRuns(runs: Record<string, ActiveChatRunRecord>) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(runs)
    .filter(([, run]) => now - run.updatedAt < ACTIVE_CHAT_RUN_TTL_MS));
}

export function chatTranscriptHasAssistantReply(messages: ChatMessage[] | undefined) {
  const lastMeaningful = [...(messages ?? [])].reverse().find((message) => (
    message.role === "user"
    || message.role === "assistant"
    || Boolean(message.content?.trim())
    || Boolean(message.agentPrompt)
  ));
  return lastMeaningful?.role === "assistant" && Boolean(lastMeaningful.content?.trim() || lastMeaningful.agentPrompt);
}

export function activeChatRunHasAssistantReply(messages: ChatMessage[] | undefined, run: ActiveChatRunRecord) {
  return chatTranscriptHasAssistantReply(chatMessagesForActiveRun(messages ?? [], run));
}

export function chatMessagesForActiveRun(messages: ChatMessage[], run?: ActiveChatRunRecord) {
  if (!run?.startedAt) return messages;
  const cutoff = run.startedAt - 1_000;
  const recentMessages = messages.filter((message) => !message.createdAt || message.createdAt >= cutoff);
  const requestLabel = String(run.requestLabel ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (requestLabel) {
    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
      const message = recentMessages[index];
      if (message?.role !== "user") continue;
      const content = normalizedChatMessageContent(message);
      const matchesRequest = Boolean(content) && (content === requestLabel
        || content.startsWith(requestLabel)
        || requestLabel.startsWith(content));
      if (matchesRequest) return recentMessages.slice(index);
    }
  }
  // The timestamp cutoff alone can include the previous turn's assistant reply
  // when the next turn starts within the same second (e.g. a queued message
  // auto-sending the moment the prior turn finishes), which made the new run
  // look already answered and killed its thinking indicator. A run's
  // transcript always starts with its own user prompt, so drop anything
  // recorded before the first in-window user message.
  const firstUserIndex = recentMessages.findIndex((message) => message.role === "user");
  return firstUserIndex >= 0 ? recentMessages.slice(firstUserIndex) : [];
}

function sessionMessageCreatedAtMs(message: { createdAt?: unknown; timestamp?: unknown }) {
  const raw = Number(message.createdAt ?? message.timestamp ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

export function chatProcessEventsFromSessionMessages(messages: unknown[], run?: Pick<ActiveChatRunRecord, "startedAt" | "runId">) {
  const cutoff = run?.startedAt ? run.startedAt - 2_000 : 0;
  return messages
    .map((message: any) => {
      const createdAt = sessionMessageCreatedAtMs(message);
      if (cutoff && (!createdAt || createdAt < cutoff)) return null;
      const entry = chatProcessFromSessionMessage(message);
      return entry ? { at: createdAt || Date.now(), runId: run?.runId, ...entry } : null;
    })
    .filter(Boolean) as Array<{ at: number; label: string; detail?: string; status?: string; runId?: string }>;
}

function chatProcessFromSessionMessage(message: { role?: string; content?: string; type?: string }) {
  const role = String(message?.role ?? "").trim().toLowerCase();
  const content = String(message?.content ?? "").trim();
  if (!content || role === "user" || role === "assistant") return null;
  if (role === "tool" && /^Runtime event$/i.test(content)) return null;
  const detail = content.replace(/\s+/g, " ").slice(0, 180);
  if (role === "tool") {
    if (message?.type === "process") {
      const [labelLine, ...detailLines] = content.split("\n");
      const label = labelLine?.trim() || "Runtime event";
      const processDetail = detailLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 180);
      const failed = /\b(error|failed|failure|timed out|http\s+5\d\d)\b/i.test(`${label} ${processDetail}`);
      return { label, detail: processDetail || undefined, status: failed ? "failed" : undefined };
    }
    if (/\[Command interrupted\]/i.test(content)) return { label: "Command interrupted" };
    if (/Tool execution skipped/i.test(content)) return { label: "Tool execution skipped", detail };
    if (/\bexit\s+\d+\b/i.test(content)) return { label: "Command finished", detail };
    if (/Image loaded into your context/i.test(content)) return { label: "Image inspected", detail };
    if (/^\s*\d+\|/m.test(content)) return { label: "File content read", detail };
    if (/^---\s*\nname:/i.test(content)) return { label: "Skill context loaded", detail: content.match(/^name:\s*(.+)$/mi)?.[1] ?? detail };
    return { label: "Tool output", detail };
  }
  return { label: `${role || "Session"} message`, detail };
}

export function runtimeSessionMessages(session: unknown): ChatMessage[] {
  const rawMessages = Array.isArray((session as { messages?: unknown[] } | null)?.messages)
    ? (session as { messages: unknown[] }).messages
    : [];
  const sessionId = String((session as { sessionId?: string; id?: string } | null)?.sessionId ?? (session as { id?: string } | null)?.id ?? "");
  const output: ChatMessage[] = [];
  let pendingProcessEvents: Array<{ at: number; label: string; detail?: string; status?: string }> = [];
  for (const message of rawMessages.filter((item): item is { role?: string; content?: string; createdAt?: number; index?: number; billing?: unknown; feedback?: unknown; type?: string; applicationGeneration?: unknown; raw?: unknown } => (
      typeof item === "object"
      && item !== null
      && typeof (item as { content?: unknown }).content === "string"
    ))) {
    const processEvent = chatProcessFromSessionMessage(message);
    if (processEvent) {
      pendingProcessEvents.push({ at: Number(message.createdAt || Date.now()), ...processEvent });
      continue;
    }
    const role = message.role === "assistant" || message.role === "system" || message.role === "user" ? message.role : "system";
    const normalizedMessage: ChatMessage = {
      role,
      content: message.content ?? "",
      createdAt: typeof message.createdAt === "number" ? message.createdAt : undefined,
      sourceSessionId: sessionId || undefined,
      sourceIndex: typeof message.index === "number" ? message.index : undefined,
      feedback: normalizeEvaluationHumanFeedback(message.feedback),
      surface: role === "assistant" || role === "user" ? "chat" : undefined,
      processEvents: role === "assistant" && pendingProcessEvents.length ? pendingProcessEvents : undefined,
      billing: role === "assistant" ? normalizeChatResponseBilling(message.billing) : undefined,
      applicationGeneration: normalizeApplicationGenerationCard(message.applicationGeneration),
      // runtimePromptFromSessionMessage is untyped (any-in/any-out); the stored
      // shape matches agentPrompt at runtime but tsc cannot see it.
      agentPrompt: (runtimePromptFromSessionMessage(message) ?? undefined) as ChatMessage["agentPrompt"],
    };
    output.push(...splitCombinedUserAssistantMessage(normalizedMessage));
    if (role === "assistant" && pendingProcessEvents.length) pendingProcessEvents = [];
  }
  if (pendingProcessEvents.length) {
    output.push({
      role: "assistant",
      content: "",
      createdAt: pendingProcessEvents.at(-1)?.at,
      sourceSessionId: sessionId || undefined,
      surface: "chat",
      processEvents: pendingProcessEvents,
    });
  }
  return output;
}

function withPreservedProcessEvents(nextMessage: ChatMessage, previousMessage?: ChatMessage) {
  let next = nextMessage;
  const mergedProcessEvents = mergeChatProcessEvents(previousMessage?.processEvents, next.processEvents);
  if (mergedProcessEvents.length) {
    next = { ...next, processEvents: mergedProcessEvents };
  }
  if (previousMessage?.applicationGeneration && !next.applicationGeneration) {
    next = { ...next, applicationGeneration: previousMessage.applicationGeneration };
  }
  if (previousMessage?.imageGeneration && !next.imageGeneration) {
    next = { ...next, imageGeneration: previousMessage.imageGeneration };
  }
  if (previousMessage?.appArtifact && !next.appArtifact) {
    next = { ...next, appArtifact: previousMessage.appArtifact };
  }
  if (previousMessage?.billing && !next.billing) {
    next = { ...next, billing: previousMessage.billing };
  }
  return next;
}

function mergeChatProcessEvents(
  first: ChatMessage["processEvents"] = [],
  second: ChatMessage["processEvents"] = [],
) {
  const output: NonNullable<ChatMessage["processEvents"]> = [];
  const indexByKey = new Map<string, number>();
  for (const event of [...(first ?? []), ...(second ?? [])]) {
    if (!event) continue;
    // Status is deliberately NOT part of the identity: the same step arriving
    // again as running→completed must update the existing row, not add a twin.
    const key = [event.runId ?? "", event.label ?? "", event.detail ?? ""].join("\u001f");
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, output.length);
      output.push(event);
    } else if (Number(event.at ?? 0) >= Number(output[existingIndex]?.at ?? 0)) {
      output[existingIndex] = event;
    }
  }
  return output.sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0)).slice(-80);
}

function chatMessageHasActiveSurface(message?: ChatMessage) {
  return Boolean(
    message
    && (
      message.content.trim()
      || message.agentPrompt
      || (message.processEvents?.length ?? 0) > 0
      || message.applicationGeneration
      || message.imageGeneration
      || message.appArtifact
    ),
  );
}

function chatMessageHasGenerationSurface(message?: ChatMessage) {
  return Boolean(message?.applicationGeneration || message?.imageGeneration);
}

export function dedupeChatTranscript(messages: ChatMessage[]) {
  const output: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (sameVisibleChatMessage(output.at(-1), message)) {
      const previous = output.at(-1);
      if ((message.processEvents?.length ?? 0) > 0 && !(previous?.processEvents?.length ?? 0)) {
        output[output.length - 1] = { ...previous, processEvents: message.processEvents, billing: message.billing ?? previous?.billing, feedback: message.feedback ?? previous?.feedback } as ChatMessage;
      }
      if ((message.billing && !previous?.billing) || message.feedback || message.appArtifact) {
        output[output.length - 1] = { ...previous, billing: message.billing ?? previous?.billing, feedback: message.feedback ?? previous?.feedback, appArtifact: message.appArtifact ?? previous?.appArtifact } as ChatMessage;
      }
      continue;
    }
    if (message.role === "user") {
      const previousUserIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      // A runtime-session echo of the capability continuation is never a new
      // human turn: the person typed the original words exactly once. Drop the
      // echo row and let the run's assistant messages join the original turn
      // (also repairs transcripts persisted before this fix).
      if (previousUserIndex >= 0 && isCapabilityContinuationEcho(message)) continue;
      if (previousUserIndex >= 0) {
        const between = output.slice(previousUserIndex + 1);
        const duplicateActiveTurn = between.length > 0 && between.every((item) => (
          item.role === "assistant"
          && !chatMessageHasActiveSurface(item)
        ));
        if (duplicateActiveTurn) continue;
        const nextAssistant = messages[index + 1];
        const previousAssistant = [...between].reverse().find((item) => item.role === "assistant" && chatMessageHasActiveSurface(item));
        if (
          nextAssistant?.role === "assistant"
          && previousAssistant
          && sameVisibleChatMessage(previousAssistant, nextAssistant)
        ) {
          const previousAssistantIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, previousAssistant));
          if (previousAssistantIndex >= 0) {
            output[previousAssistantIndex] = withPreservedProcessEvents(output[previousAssistantIndex], nextAssistant);
          }
          index += 1;
          continue;
        }
      }
    }
    if (message.role === "assistant" && chatMessageHasActiveSurface(message)) {
      const currentUser = [...output].reverse().find((item) => item.role === "user");
      const previousCardAssistantIndex = findLastChatMessageIndex(output, (item) => (
        item.role === "assistant"
        && chatMessageHasGenerationSurface(item)
      ));
      const previousCardUser = [...output.slice(0, previousCardAssistantIndex)].reverse().find((item) => item.role === "user");
      if (
        previousCardAssistantIndex >= 0
        && sameVisibleChatMessage(previousCardUser, currentUser)
        && !sameVisibleChatMessage(output[previousCardAssistantIndex], message)
      ) {
        output[previousCardAssistantIndex] = withPreservedProcessEvents(message, output[previousCardAssistantIndex]);
        continue;
      }
      const previousAssistantIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      const previousUser = [...output.slice(0, previousAssistantIndex)].reverse().find((item) => item.role === "user");
      if (previousAssistantIndex >= 0 && sameVisibleChatMessage(previousUser, currentUser)) {
        output[previousAssistantIndex] = withPreservedProcessEvents(message, output[previousAssistantIndex]);
        continue;
      }
    }
    output.push(message);
  }
  return output;
}

function preserveLocalTurnProcessEvents(sessionTurn: ChatMessage[], localTurn: ChatMessage[]) {
  const localAssistantMessages = localTurn.filter((message) => message.role === "assistant");
  const localUserMessage = localTurn.find((message) => message.role === "user" && message.content.trim());
  return sessionTurn.map((message) => {
    if (message.role === "user" && userMessagesLikelySameTurn(localUserMessage, message)) {
      return {
        ...message,
        content: localUserMessage?.content ?? message.content,
        attachments: localUserMessage?.attachments,
        surface: localUserMessage?.surface ?? message.surface,
        createdAt: localUserMessage?.createdAt ?? message.createdAt,
        // Keep the local bubble's identity so its React key survives the merge.
        sourceSessionId: localUserMessage?.sourceSessionId,
        sourceIndex: localUserMessage?.sourceIndex,
      };
    }
    if (message.role !== "assistant") return message;
    // Local state transfers ONLY between content-confirmed pairs. The old
    // positional fallback paired segments by index — under the segment model
    // it re-distributed one message's steps onto a DIFFERENT segment (preflight
    // rows resurfacing next to a later phase's retries) and its identity
    // stamping gave distinct segments the same sourceIndex, which made the
    // visible-message dedupe silently DROP finished responses. No pairing, no
    // transfer: an unmatched session segment keeps exactly its own state.
    const processSource = localAssistantMessages.find((localMessage) => (
      sameVisibleChatMessage(localMessage, message)
    ));
    if (!processSource) return message;
    return {
      ...message,
      processEvents: mergeChatProcessEvents(processSource.processEvents, message.processEvents),
      applicationGeneration: message.applicationGeneration ?? processSource.applicationGeneration,
      imageGeneration: message.imageGeneration ?? processSource.imageGeneration,
      appArtifact: message.appArtifact ?? processSource.appArtifact,
      feedback: message.feedback ?? processSource.feedback,
      sourceSessionId: processSource.sourceSessionId ?? message.sourceSessionId,
      sourceIndex: processSource.sourceIndex ?? message.sourceIndex,
      // Keep the locally streamed message's identity: React keys include
      // createdAt, so re-stamping it from the session store remounted the
      // whole article (visible flicker).
      createdAt: processSource.createdAt ?? message.createdAt,
    };
  });
}

export function mergeRuntimeSessionMessages(existing: ChatMessage[], sessionMessages: ChatMessage[]) {
  const visibleSessionMessages = sessionMessages.filter((message) => message.role === "user" || message.role === "assistant");
  if (!visibleSessionMessages.length) return existing;
  const sessionUser = visibleSessionMessages.find((message) => message.role === "user" && message.content.trim());
  if (sessionUser) {
    const localUserIndex = findLastChatMessageIndex(existing, (message) => userMessagesLikelySameTurn(message, sessionUser));
    if (localUserIndex >= 0) {
      const nextLocalUserIndex = findNextChatUserIndex(existing, localUserIndex);
      const localTurn = existing.slice(localUserIndex, nextLocalUserIndex >= 0 ? nextLocalUserIndex : existing.length);
      const sessionTurn = preserveLocalTurnProcessEvents(visibleSessionMessages, localTurn);
      return dedupeChatTranscript([
        ...existing.slice(0, localUserIndex),
        ...sessionTurn,
        ...(nextLocalUserIndex >= 0 ? existing.slice(nextLocalUserIndex) : []),
      ]).slice(-120);
    }
  }
  let enrichedExisting = existing;
  for (const sessionMessage of visibleSessionMessages) {
    if (sessionMessage.role !== "assistant" || (!sessionMessage.processEvents?.length && !sessionMessage.billing && !sessionMessage.feedback)) continue;
    const existingIndex = findLastChatMessageIndex(enrichedExisting, (message) => sameVisibleChatMessage(message, sessionMessage));
    if (existingIndex < 0) continue;
    const existingMessage = enrichedExisting[existingIndex];
    if ((existingMessage.processEvents?.length ?? 0) >= (sessionMessage.processEvents?.length ?? 0) && (!sessionMessage.billing || existingMessage.billing) && (!sessionMessage.feedback || existingMessage.feedback?.providedAt === sessionMessage.feedback.providedAt)) continue;
    enrichedExisting = [
      ...enrichedExisting.slice(0, existingIndex),
      { ...existingMessage, processEvents: sessionMessage.processEvents ?? existingMessage.processEvents, billing: sessionMessage.billing ?? existingMessage.billing, feedback: sessionMessage.feedback ?? existingMessage.feedback },
      ...enrichedExisting.slice(existingIndex + 1),
    ];
  }
  const seen = new Set(enrichedExisting.map((message) => `${message.role}:${normalizedChatMessageContent(message)}`));
  const additions = visibleSessionMessages.filter((message) => {
    const key = `${message.role}:${normalizedChatMessageContent(message)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!additions.length) return enrichedExisting === existing ? dedupeChatTranscript(existing).slice(-120) : dedupeChatTranscript(enrichedExisting).slice(-120);
  return dedupeChatTranscript([...enrichedExisting, ...additions]).slice(-120);
}
