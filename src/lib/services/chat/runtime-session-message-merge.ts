type CapabilityApprovalMessage = {
  createdAt?: number;
  role?: string;
  capabilityApproval?: {
    id?: string;
  };
};

function capabilityApprovalId(message: CapabilityApprovalMessage) {
  return message.capabilityApproval?.id?.trim() ?? "";
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
  if (!localApprovalExchange.length) return [...hydratedMessages];

  return [...hydratedMessages, ...localApprovalExchange]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftCreatedAt = Number(left.message.createdAt || 0);
      const rightCreatedAt = Number(right.message.createdAt || 0);
      if (!leftCreatedAt || !rightCreatedAt) return left.index - right.index;
      return leftCreatedAt - rightCreatedAt || left.index - right.index;
    })
    .map((entry) => entry.message);
}
