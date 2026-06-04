const DEFAULT_STRING_LIMIT = 40_000;
const DEFAULT_ARRAY_LIMIT = 200;
const DEFAULT_DEPTH_LIMIT = 5;

function compactString(value: string, limit = DEFAULT_STRING_LIMIT) {
  return value.length > limit ? `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]` : value;
}

export function chatTelemetryValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return compactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= DEFAULT_DEPTH_LIMIT) return "[depth limit]";
  if (Array.isArray(value)) {
    return value.slice(0, DEFAULT_ARRAY_LIMIT).map((item) => chatTelemetryValue(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, DEFAULT_ARRAY_LIMIT)) {
    output[key] = chatTelemetryValue(entry, depth + 1);
  }
  return output;
}

export function chatTelemetryMessages(messages: unknown[] = [], limit = DEFAULT_ARRAY_LIMIT) {
  return messages.slice(-limit).map((message, fallbackIndex) => {
    const entry = message && typeof message === "object" ? message as Record<string, unknown> : {};
    const content = typeof entry.content === "string" ? entry.content : "";
    return {
      index: Number.isFinite(Number(entry.index)) ? Number(entry.index) : fallbackIndex,
      role: String(entry.role ?? ""),
      type: typeof entry.type === "string" ? entry.type : null,
      content: compactString(content),
      contentLength: content.length,
      createdAt: Number(entry.createdAt || 0) || null,
      sourceSessionId: typeof entry.sourceSessionId === "string" ? entry.sourceSessionId : null,
      sourceIndex: Number.isFinite(Number(entry.sourceIndex)) ? Number(entry.sourceIndex) : null,
      surface: typeof entry.surface === "string" ? entry.surface : null,
      attachmentCount: Array.isArray(entry.attachments) ? entry.attachments.length : 0,
      hasAgentPrompt: Boolean(entry.agentPrompt),
      raw: entry.raw === undefined ? undefined : chatTelemetryValue(entry.raw),
    };
  });
}

export function chatTelemetrySession(session: unknown) {
  if (!session || typeof session !== "object") return null;
  const entry = session as Record<string, unknown>;
  const messages = Array.isArray(entry.messages) ? entry.messages : [];
  return {
    id: String(entry.id ?? entry.sessionId ?? ""),
    sessionId: String(entry.sessionId ?? entry.id ?? ""),
    runtime: String(entry.runtime ?? ""),
    source: String(entry.source ?? ""),
    agentId: String(entry.agentId ?? ""),
    agentName: String(entry.agentName ?? ""),
    chatStorageKey: typeof entry.chatStorageKey === "string" ? entry.chatStorageKey : null,
    startedAt: Number(entry.startedAt || 0) || null,
    updatedAt: Number(entry.updatedAt || 0) || null,
    endedAt: Number(entry.endedAt || 0) || null,
    endReason: typeof entry.endReason === "string" ? entry.endReason : null,
    messageCount: Number(entry.messageCount || messages.length) || messages.length,
    messages: chatTelemetryMessages(messages),
    raw: chatTelemetryValue(entry),
  };
}
