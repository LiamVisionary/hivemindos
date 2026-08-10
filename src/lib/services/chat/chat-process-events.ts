export type ChatProcessEvent = {
  at?: number;
  label?: string;
  detail?: string;
  status?: string;
  runId?: string;
};

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
