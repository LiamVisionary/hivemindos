import { mergeChatProcessEvents, type ChatProcessEvent } from "./chat-process-events";

type CapabilityApprovalMessage = {
  createdAt?: number;
  role?: string;
  content?: string;
  sourceSessionId?: string;
  sourceIndex?: number;
  processEvents?: ChatProcessEvent[];
  capabilityApproval?: {
    id?: string;
  };
  appArtifact?: unknown;
};

function normalizedMessageContent(message: CapabilityApprovalMessage) {
  return String(message.content ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sourceMessageKey(message: CapabilityApprovalMessage) {
  const sessionId = message.sourceSessionId?.trim() ?? "";
  return sessionId && Number.isFinite(message.sourceIndex)
    ? `${sessionId}:${message.sourceIndex}:${message.role ?? "message"}`
    : "";
}

function withPreservedProcessTimelines<T extends CapabilityApprovalMessage>(
  hydrated: readonly T[],
  existing: readonly T[],
): T[] {
  const usedExistingIndexes = new Set<number>();
  return hydrated.map((message) => {
    if (message.role !== "assistant") return message;
    const sourceKey = sourceMessageKey(message);
    let existingIndex = sourceKey
      ? existing.findIndex((candidate, index) => !usedExistingIndexes.has(index) && sourceMessageKey(candidate) === sourceKey)
      : -1;
    if (existingIndex < 0) {
      const content = normalizedMessageContent(message);
      existingIndex = existing.findIndex((candidate, index) => (
        !usedExistingIndexes.has(index)
        && candidate.role === "assistant"
        && normalizedMessageContent(candidate) === content
      ));
    }
    if (existingIndex < 0) return message;
    usedExistingIndexes.add(existingIndex);
    const processEvents = mergeChatProcessEvents(existing[existingIndex].processEvents ?? [], message.processEvents ?? []);
    return processEvents.length ? { ...message, processEvents } : message;
  });
}

function capabilityApprovalId(message: CapabilityApprovalMessage) {
  return message.capabilityApproval?.id?.trim() ?? "";
}

// Runtime transcripts also do not carry the dashboard-only appArtifact that
// binds a thread to its App Builder project (and thereby to Chat Preview).
// When hydration would otherwise wipe it, restamp the latest local artifact
// onto the newest hydrated assistant message so latestChatAppArtifact still
// resolves. Hydrated artifacts, when present, stay authoritative.
function withPreservedAppArtifact<T extends CapabilityApprovalMessage>(
  merged: T[],
  existing: readonly T[],
): T[] {
  if (merged.some((message) => message.appArtifact)) return merged;
  const artifact = [...existing].reverse().find((message) => message.appArtifact)?.appArtifact;
  if (!artifact) return merged;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    if (merged[index].role !== "assistant") continue;
    const next = [...merged];
    next[index] = { ...next[index], appArtifact: artifact };
    return next;
  }
  return merged;
}

/**
 * Runtime transcripts do not contain dashboard-only approval exchanges.
 * Preserve each local card and its immediately preceding user request when
 * refreshing, while the runtime stays authoritative for ordinary messages.
 */
export function mergeRuntimeHydratedChatMessages<T extends CapabilityApprovalMessage>(
  existing: readonly T[],
  hydratedMessages: readonly T[],
): T[] {
  const hydratedWithProcesses = withPreservedProcessTimelines(hydratedMessages, existing);
  const hydratedApprovalIds = new Set(hydratedMessages.map(capabilityApprovalId).filter(Boolean));
  const localApprovalIndexes = new Set<number>();
  existing.forEach((message, index) => {
    const approvalId = capabilityApprovalId(message);
    if (!approvalId || hydratedApprovalIds.has(approvalId)) return;
    localApprovalIndexes.add(index);
    if (index > 0 && existing[index - 1].role === "user") localApprovalIndexes.add(index - 1);
  });
  const localApprovalExchange = existing.filter((_message, index) => localApprovalIndexes.has(index));
  if (!localApprovalExchange.length) return withPreservedAppArtifact(hydratedWithProcesses, existing);

  const merged = [...hydratedWithProcesses, ...localApprovalExchange]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftCreatedAt = Number(left.message.createdAt || 0);
      const rightCreatedAt = Number(right.message.createdAt || 0);
      if (!leftCreatedAt || !rightCreatedAt) return left.index - right.index;
      return leftCreatedAt - rightCreatedAt || left.index - right.index;
    })
    .map((entry) => entry.message);
  return withPreservedAppArtifact(merged, existing);
}
