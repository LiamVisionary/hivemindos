import { mergeChatProcessEvents } from "@/lib/services/chat/chat-process-events";

export function findChatRunAssistantIndex(
  messages: Array<{ role?: string; sourceSessionId?: string }>,
  runId: string,
) {
  if (!runId) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.sourceSessionId === runId) return index;
  }
  return -1;
}

export function startChatStreamState(input: {
  agentId: string;
  leafKey: string;
  recordActiveChatRun?: (run: any) => void;
  requestLabel?: string;
  runId?: string;
  sessionId?: string;
  setChatProcessByKey?: (updater: (current: any) => any) => void;
  setChatStreamingByKey: (updater: (current: any) => any) => void;
  startedAt: number;
  storageKey: string;
}) {
  const runId = input.runId || `${input.storageKey}:${input.startedAt}`;
  input.setChatStreamingByKey((current) => {
    const existing = current[input.storageKey];
    const existingRuns = existing?.runs ?? (existing?.runId ? {
      [existing.runId]: {
        agentId: existing.agentId,
        leafKey: existing.leafKey,
        hasChunk: existing.hasChunk === true,
        startedAt: existing.startedAt,
      },
    } : {});
    return {
      ...current,
      [input.storageKey]: {
        agentId: input.agentId,
        leafKey: input.leafKey,
        hasChunk: false,
        startedAt: input.startedAt,
        runId,
        runs: {
          ...existingRuns,
          [runId]: {
            agentId: input.agentId,
            leafKey: input.leafKey,
            hasChunk: false,
            startedAt: input.startedAt,
            // Marks a run whose SSE lives in THIS tab. While one exists, the
            // 5s session poll must keep its hands off the thread — the stream
            // is the single source of truth and merging the laggier session
            // snapshot replaced messages and panels under the reader.
            local: true,
          },
        },
      },
    };
  });
  input.setChatProcessByKey?.((current) => ({
    ...current,
    [input.storageKey]: (current[input.storageKey] ?? []).filter((event: any) => event.runId && event.runId !== runId),
  }));
  input.recordActiveChatRun?.({
    storageKey: input.storageKey,
    agentId: input.agentId,
    leafKey: input.leafKey,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    requestLabel: input.requestLabel,
    runId,
    sessionId: input.sessionId,
    status: "active",
  });
}

export function markChatStreamChunkState(
  setChatStreamingByKey: (updater: (current: any) => any) => void,
  storageKey: string,
  runId?: string,
) {
  setChatStreamingByKey((current) => {
    const existing = current[storageKey];
    if (!existing) return current;
    const targetRunId = runId || existing.runId;
    if (!targetRunId) return current;
    const targetRun = existing.runs?.[targetRunId];
    if (targetRun?.hasChunk && (existing.runId !== targetRunId || existing.hasChunk)) return current;
    return {
      ...current,
      [storageKey]: {
        ...existing,
        hasChunk: existing.runId === targetRunId ? true : existing.hasChunk,
        runs: {
          ...(existing.runs ?? {}),
          [targetRunId]: { ...(targetRun ?? {}), hasChunk: true },
        },
      },
    };
  });
}

function entryRuns(existing: any) {
  return existing?.runs ?? (existing?.runId ? {
    [existing.runId]: {
      agentId: existing.agentId,
      leafKey: existing.leafKey,
      hasChunk: existing.hasChunk === true,
      startedAt: existing.startedAt,
    },
  } : {});
}

/** True when this tab currently owns a live SSE run for the thread entry. */
export function chatStreamHasLocalRun(entry: any) {
  return Object.values(entryRuns(entry)).some((run: any) => run?.local === true);
}

function latestChatStreamRun(runs: Record<string, any>) {
  return Object.entries(runs)
    .sort(([, left]: any, [, right]: any) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0];
}

export function reconcilePolledChatStreamState(current: any, input: {
  active: boolean;
  agentId: string;
  hasChunk: boolean;
  leafKey: string;
  runId?: string;
  startedAt: number;
  storageKey: string;
}) {
  const existing = current[input.storageKey];
  const runId = input.runId || existing?.runId || `${input.storageKey}:${input.startedAt}`;
  const runs = entryRuns(existing);
  if (!input.active) {
    if (!existing || (input.runId && !runs[runId] && existing.runId !== runId)) return current;
    const remainingRuns = { ...runs };
    delete remainingRuns[runId];
    const remaining = latestChatStreamRun(remainingRuns);
    if (!remaining) {
      const next = { ...current };
      delete next[input.storageKey];
      return next;
    }
    const [nextRunId, nextRun] = remaining;
    return { ...current, [input.storageKey]: { ...existing, ...nextRun, runId: nextRunId, runs: remainingRuns } };
  }
  const previousRun = runs[runId];
  const nextRuns = {
    ...runs,
    [runId]: {
      agentId: input.agentId,
      leafKey: input.leafKey,
      hasChunk: input.hasChunk || previousRun?.hasChunk === true || (existing?.runId === runId && existing.hasChunk === true),
      startedAt: previousRun?.startedAt ?? input.startedAt,
      ...(previousRun?.local === true ? { local: true } : {}),
    },
  };
  const [nextRunId, nextRun] = latestChatStreamRun(nextRuns);
  const nextEntry = { ...existing, ...nextRun, runId: nextRunId, runs: nextRuns };
  if (JSON.stringify(existing) === JSON.stringify(nextEntry)) return current;
  return { ...current, [input.storageKey]: nextEntry };
}

type PolledProcessEvent = { at: number; label: string; detail?: string; status?: string; runId?: string };

export function reconcilePolledChatProcessState(
  current: Record<string, PolledProcessEvent[]>,
  input: { active: boolean; entries: PolledProcessEvent[]; runId?: string; startedAt: number; storageKey: string },
) {
  const previous = current[input.storageKey] ?? [];
  if (!input.active) {
    if (!previous.length) return current;
    const remaining = input.runId ? previous.filter((entry) => entry.runId !== input.runId) : [];
    if (remaining.length === previous.length) return current;
    if (remaining.length) return { ...current, [input.storageKey]: remaining };
    const next = { ...current };
    delete next[input.storageKey];
    return next;
  }
  const cutoff = input.startedAt ? input.startedAt - 2_000 : 0;
  const otherRuns = input.runId ? previous.filter((entry) => entry.runId && entry.runId !== input.runId) : [];
  const existingTarget = previous.filter((entry) => (
    (!input.runId || !entry.runId || entry.runId === input.runId)
    && (!cutoff || entry.at >= cutoff)
    && entry.label !== "Runtime session active"
  ));
  const incomingTarget = input.entries.filter((entry) => (
    (!input.runId || entry.runId === input.runId)
    && (!cutoff || entry.at >= cutoff)
  ));
  const target = mergeChatProcessEvents(existingTarget, incomingTarget);
  const nextEntries = [...otherRuns, ...target].sort((left, right) => left.at - right.at).slice(-80);
  const unchanged = previous.length === nextEntries.length && previous.every((entry, index) => {
    const other = nextEntries[index];
    return other && entry.at === other.at && entry.label === other.label && (entry.detail ?? "") === (other.detail ?? "")
      && (entry.status ?? "") === (other.status ?? "") && (entry.runId ?? "") === (other.runId ?? "");
  });
  return unchanged ? current : { ...current, [input.storageKey]: nextEntries };
}

export function finishChatStreamState(
  setChatStreamingByKey: (updater: (current: any) => any) => void,
  storageKey: string,
  runId?: string,
) {
  setChatStreamingByKey((current) => reconcilePolledChatStreamState(current, {
    active: false,
    agentId: current[storageKey]?.agentId ?? "",
    hasChunk: false,
    leafKey: current[storageKey]?.leafKey ?? "",
    runId,
    startedAt: current[storageKey]?.startedAt ?? 0,
    storageKey,
  }));
}

export function appendChatProcessState(input: {
  browserPreview?: { url?: string; source?: string };
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
        [input.storageKey]: [...existing.slice(0, -1), {
          ...last,
          at: Date.now(),
          status: input.status,
          runId: input.runId ?? last.runId,
          ...(input.browserPreview ? { browserPreview: input.browserPreview } : {}),
        }],
      };
    }
    return {
      ...current,
      [input.storageKey]: [...existing, {
        at: Date.now(),
        label: cleanLabel,
        detail: input.detail,
        status: input.status,
        runId: input.runId,
        ...(input.browserPreview ? { browserPreview: input.browserPreview } : {}),
      }].slice(-80),
    };
  });
}
