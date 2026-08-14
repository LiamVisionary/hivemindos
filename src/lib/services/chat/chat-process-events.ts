export type ChatProcessEvent = {
  at?: number;
  label?: string;
  detail?: string;
  status?: string;
  runId?: string;
};

export type LabeledChatProcessEvent = ChatProcessEvent & { label: string };

type ChatProcessTerminal = {
  at: number;
  detail?: string;
  status: "completed" | "failed";
  runId?: string;
};

function chatProcessLifecycle(event: ChatProcessEvent) {
  const label = String(event.label ?? "").trim();
  const starting = label.match(/^Starting (\S+)$/);
  if (starting) return { phase: "open" as const, tool: starting[1] };
  const running = label.match(/^(\S+) running$/);
  if (running) return { phase: "open" as const, tool: running[1] };
  const finished = label.match(/^(\S+) finished$/);
  if (finished) return { phase: "close" as const, tool: finished[1] };
  return null;
}

/** Close tool rows whose terminal lifecycle event was lost with the stream. */
export function settleUnfinishedChatProcessEvents(
  events: readonly LabeledChatProcessEvent[] = [],
  terminal?: ChatProcessTerminal | null,
): LabeledChatProcessEvent[] {
  if (!terminal) return [...events];
  const openByTool = new Map<string, { event: ChatProcessEvent; tool: string }>();
  for (const event of events) {
    if (terminal.runId && event.runId !== terminal.runId) continue;
    const lifecycle = chatProcessLifecycle(event);
    if (!lifecycle) continue;
    const key = `${event.runId ?? ""}\u001f${lifecycle.tool}`;
    if (lifecycle.phase === "close") openByTool.delete(key);
    else openByTool.set(key, { event, tool: lifecycle.tool });
  }
  if (!openByTool.size) return [...events];
  return [
    ...events,
    ...[...openByTool.values()].map(({ event, tool }) => ({
      at: Math.max(terminal.at, Number(event.at ?? 0)),
      label: `${tool} finished`,
      detail: terminal.detail,
      status: terminal.status,
      runId: event.runId,
    })),
  ];
}

function processEventBaseKey(event: ChatProcessEvent) {
  return [event.runId ?? "", event.label ?? "", event.detail ?? ""].join("\u001f");
}

/**
 * Merge two cumulative views of one process timeline without confusing a
 * repeated invocation with a duplicate delivery of the same invocation.
 *
 * Occurrence ordinals restart for each source list, so the first occurrence
 * in a newer snapshot updates the first occurrence already rendered, while a
 * second terminal call in that snapshot remains a second terminal call.
 */
export function mergeChatProcessEvents<T extends ChatProcessEvent>(
  first: readonly T[] = [],
  second: readonly T[] = [],
) {
  const output: T[] = [];
  const indexByOccurrence = new Map<string, number>();

  for (const source of [first, second]) {
    const occurrenceByBase = new Map<string, number>();
    for (const event of source) {
      if (!event) continue;
      const base = processEventBaseKey(event);
      const occurrence = occurrenceByBase.get(base) ?? 0;
      occurrenceByBase.set(base, occurrence + 1);
      const key = `${base}\u001f${occurrence}`;
      const existingIndex = indexByOccurrence.get(key);
      if (existingIndex === undefined) {
        indexByOccurrence.set(key, output.length);
        output.push(event);
      } else if (Number(event.at ?? 0) >= Number(output[existingIndex]?.at ?? 0)) {
        output[existingIndex] = event;
      }
    }
  }

  return output
    .sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0))
    .slice(-80);
}

/** Recover the named tool lifecycle that runtime-session storage keeps in raw. */
export function namedToolProcessEventFromRaw(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const type = String(source.type ?? "").trim();
  if (!/^tool\./i.test(type)) return null;

  const toolName = String(source.tool ?? source.toolName ?? source.name ?? source.command ?? "").trim();
  const message = String(source.message ?? source.label ?? source.title ?? source.name ?? source.content ?? source.delta ?? "").trim();
  const rawStatus = String(source.status ?? "").trim().toLowerCase();
  const status = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "running"
    ? rawStatus
    : undefined;

  if (/^tool\.(generating|start|started|pending)$/i.test(type)) {
    return {
      label: toolName ? `Starting ${toolName}` : "Starting tool",
      detail: message || undefined,
      status: status ?? "running",
    };
  }
  if (/^tool\.(progress|running)$/i.test(type)) {
    return {
      label: toolName ? `${toolName} running` : "Tool running",
      detail: message || undefined,
      status: status ?? "running",
    };
  }
  if (/^tool\.(done|completed|failed|error)$/i.test(type)) {
    return {
      label: toolName ? `${toolName} finished` : "Tool finished",
      detail: message || undefined,
      status: status ?? (/failed|error/i.test(type) ? "failed" : "completed"),
    };
  }
  return null;
}
