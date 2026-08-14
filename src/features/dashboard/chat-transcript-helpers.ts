import type { ChatMessage } from "@/features/dashboard/dashboard-types";
import { latestChatAppArtifact } from "@/lib/services/chat/chat-app-artifact";
import { mergeChatProcessEvents as mergeProcessEventLists } from "@/lib/services/chat/chat-process-events";
import { CAPABILITY_APPROVAL_CONTINUATION_MARKER } from "@/lib/types/capability-approval";

// Pure transcript helpers: message identity/equality, turn matching, and the
// split of a runtime message that arrived with the assistant's reply glued to
// the end of the user's own text. No React, no component state.
//
// NOTE: near-copies of some of these still live in dashboard-storage.ts and
// hooks/use-dashboard-derived-state.tsx, and they have already drifted —
// dashboard-storage's sameVisibleChatMessage carries an extra
// capabilityApproval branch this one does not. Collapsing the three is a real
// dedup but a behavior decision, so it is deliberately left as a follow-up
// rather than folded into this move.

export function runtimeSessionIdFromChatLeafKey(leafKey = "") {
  const marker = "-hermes-state:";
  const markerIndex = leafKey.indexOf(marker);
  if (markerIndex === -1) return "";
  const afterMarker = leafKey.slice(markerIndex + marker.length);
  return afterMarker.split("-hermes-state-")[0]?.trim() ?? "";
}

/** A capability-plan continuation is runtime plumbing: the person only typed
 * the original task, so that is all the thread may ever display. The full
 * continuation stays in the session for the runtime. */
export function compactCapabilityContinuation(text: string) {
  if (!text.startsWith(CAPABILITY_APPROVAL_CONTINUATION_MARKER)) return text;
  const originalTask = text.match(/^Original task:\s*(.+)$/m)?.[1]?.trim();
  return originalTask || "Approved capability plan. Continue with the task.";
}

export function isCapabilityContinuationEcho(message: Pick<ChatMessage, "role" | "content"> | undefined) {
  if (message?.role !== "user") return false;
  const content = message.content?.trim() ?? "";
  return content.startsWith(CAPABILITY_APPROVAL_CONTINUATION_MARKER)
    || /^Approved capability plan\. Continue with the task\.?$/i.test(content);
}

export function normalizedChatMessageContent(message: Pick<ChatMessage, "content">) {
  // Identity must match what the thread DISPLAYS: a runtime-session user turn
  // that carries the capability-continuation prompt is the same turn as the
  // local message holding the person's original words, or session merges
  // duplicate the whole exchange (observed 2026-07-25).
  return compactCapabilityContinuation(message.content).replace(/\s+/g, " ").trim().toLowerCase();
}

export function sameVisibleChatMessage(left: ChatMessage | undefined, right: ChatMessage | undefined) {
  if (!left || !right) return false;
  return left.role === right.role && normalizedChatMessageContent(left) === normalizedChatMessageContent(right);
}

function chatMessageCreatedAtMs(message: Pick<ChatMessage, "createdAt"> | undefined) {
  const raw = Number(message?.createdAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

export function userMessagesLikelySameTurn(localMessage: ChatMessage | undefined, sessionMessage: ChatMessage | undefined) {
  if (!localMessage || !sessionMessage || localMessage.role !== "user" || sessionMessage.role !== "user") return false;
  if (sameVisibleChatMessage(localMessage, sessionMessage)) return true;
  const localContent = normalizedChatMessageContent(localMessage);
  const sessionContent = normalizedChatMessageContent(sessionMessage);
  if (!localContent || !sessionContent) return false;
  const contentLooksRelated = localContent.startsWith(sessionContent)
    || sessionContent.startsWith(localContent)
    || (localContent.length <= 32 && sessionContent.includes(localContent))
    || (sessionContent.length <= 32 && localContent.includes(sessionContent));
  const localAt = chatMessageCreatedAtMs(localMessage);
  const sessionAt = chatMessageCreatedAtMs(sessionMessage);
  const closeInTime = Boolean(localAt && sessionAt && Math.abs(localAt - sessionAt) <= 30_000);
  const genericTurnText = /^(?:media message|\(sent attachments\)|linked \d+ director(?:y|ies))$/i;
  return contentLooksRelated || (closeInTime && (genericTurnText.test(localContent) || genericTurnText.test(sessionContent)));
}

function combinedUserAssistantSplitIndex(content: string) {
  const markers = [
    /\*\*(?=(?:Private x402|[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b))/i,
    /\n(?=(?:Private x402|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:))/i,
  ];
  return markers.reduce((best, pattern) => {
    const match = pattern.exec(content);
    if (!match || !match.index) return best;
    return best < 0 ? match.index : Math.min(best, match.index);
  }, -1);
}

function assistantTailLooksLikeResponse(content: string) {
  return /Private x402|Reply\s+`?confirm|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:|^\*\*[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b/i.test(content.trim());
}

export function splitCombinedUserAssistantMessage(message: ChatMessage): ChatMessage[] {
  if (message.role !== "user") return [message];
  const content = message.content ?? "";
  const splitIndex = combinedUserAssistantSplitIndex(content);
  if (splitIndex <= 0) return [message];
  const userContent = content.slice(0, splitIndex).trimEnd();
  const assistantContent = content.slice(splitIndex).trimStart();
  if (!userContent || !assistantTailLooksLikeResponse(assistantContent)) return [message];
  return [
    { ...message, content: userContent },
    {
      role: "assistant",
      content: assistantContent,
      createdAt: Number(message.createdAt || 0) ? Number(message.createdAt) + 1 : undefined,
      sourceSessionId: message.sourceSessionId,
      sourceIndex: typeof message.sourceIndex === "number" ? message.sourceIndex + 0.1 : undefined,
      surface: "chat",
    },
  ];
}

export function findLastChatMessageIndex(messages: ChatMessage[], predicate: (message: ChatMessage) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

export function findNextChatUserIndex(messages: ChatMessage[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function mergeChatProcessEvents(
  first: ChatMessage["processEvents"] = [],
  second: ChatMessage["processEvents"] = [],
) {
  return mergeProcessEventLists(first ?? [], second ?? []);
}

export function preserveLocalTurnProcessEvents(sessionTurn: ChatMessage[], localTurn: ChatMessage[]) {
  const localAssistantMessages = localTurn.filter((message) => message.role === "assistant");
  const localUserMessage = localTurn.find((message) => message.role === "user" && message.content.trim());
  const mapped = sessionTurn.map((message) => {
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
  // The app artifact is client-only state — the session store never carries
  // it. When content pairing found no carrier (segmentation drift between the
  // streamed and stored versions of the turn), the turn must not lose its app:
  // re-attach the local artifact to the turn's last assistant row.
  const localArtifact = latestChatAppArtifact(localAssistantMessages);
  if (localArtifact && !mapped.some((message) => message.role === "assistant" && message.appArtifact)) {
    const lastAssistantIndex = findLastChatMessageIndex(mapped, (message) => message.role === "assistant");
    if (lastAssistantIndex >= 0) mapped[lastAssistantIndex] = { ...mapped[lastAssistantIndex], appArtifact: localArtifact };
  }
  return mapped;
}
