type CapabilityApprovalMessage = {
  createdAt?: number;
  role?: string;
  capabilityApproval?: {
    id?: string;
  };
  appArtifact?: unknown;
};

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
  const hydratedApprovalIds = new Set(hydratedMessages.map(capabilityApprovalId).filter(Boolean));
  const localApprovalIndexes = new Set<number>();
  existing.forEach((message, index) => {
    const approvalId = capabilityApprovalId(message);
    if (!approvalId || hydratedApprovalIds.has(approvalId)) return;
    localApprovalIndexes.add(index);
    if (index > 0 && existing[index - 1].role === "user") localApprovalIndexes.add(index - 1);
  });
  const localApprovalExchange = existing.filter((_message, index) => localApprovalIndexes.has(index));
  if (!localApprovalExchange.length) return withPreservedAppArtifact([...hydratedMessages], existing);

  const merged = [...hydratedMessages, ...localApprovalExchange]
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
