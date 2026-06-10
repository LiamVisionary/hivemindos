export function startChatStreamState(input: {
  agentId: string;
  leafKey: string;
  recordActiveChatRun?: (run: any) => void;
  requestLabel?: string;
  runId?: string;
  setChatProcessByKey?: (updater: (current: any) => any) => void;
  setChatStreamingByKey: (updater: (current: any) => any) => void;
  startedAt: number;
  storageKey: string;
}) {
  input.setChatStreamingByKey((current) => ({
    ...current,
    [input.storageKey]: {
      agentId: input.agentId,
      leafKey: input.leafKey,
      hasChunk: false,
      startedAt: input.startedAt,
      runId: input.runId,
    },
  }));
  input.setChatProcessByKey?.((current) => ({ ...current, [input.storageKey]: [] }));
  input.recordActiveChatRun?.({
    storageKey: input.storageKey,
    agentId: input.agentId,
    leafKey: input.leafKey,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    requestLabel: input.requestLabel,
    runId: input.runId,
    status: "active",
  });
}

export function markChatStreamChunkState(setChatStreamingByKey: (updater: (current: any) => any) => void, storageKey: string) {
  setChatStreamingByKey((current) => (
    current[storageKey]?.hasChunk
      ? current
      : { ...current, [storageKey]: { ...current[storageKey], hasChunk: true } }
  ));
}

export function finishChatStreamState(setChatStreamingByKey: (updater: (current: any) => any) => void, storageKey: string) {
  setChatStreamingByKey((current) => {
    const next = { ...current };
    delete next[storageKey];
    return next;
  });
}

export function appendChatProcessState(input: {
  detail?: string;
  label: string;
  runId?: string;
  setChatProcessByKey?: (updater: (current: any) => any) => void;
  status?: string;
  storageKey: string;
}) {
  const cleanLabel = input.label.trim();
  if (!cleanLabel) return;
  input.setChatProcessByKey?.((current) => {
    const existing = current[input.storageKey] ?? [];
    const last = existing[existing.length - 1];
    if (last?.label === cleanLabel && last?.detail === input.detail && (!input.runId || !last.runId || last.runId === input.runId)) {
      return {
        ...current,
        [input.storageKey]: [...existing.slice(0, -1), { ...last, at: Date.now(), status: input.status, runId: input.runId ?? last.runId }],
      };
    }
    return {
      ...current,
      [input.storageKey]: [...existing, { at: Date.now(), label: cleanLabel, detail: input.detail, status: input.status, runId: input.runId }].slice(-80),
    };
  });
}
