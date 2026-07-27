export const RUNTIME_STREAM_EVENT_TYPES = {
  THINKING: "chat.thinking",
  REASONING: "chat.reasoning",
  COLD_START: "chat.cold_start",
  MESSAGE_START: "chat.start",
  TEXT_DELTA: "chat.text",
  TEXT_RESET: "chat.text.reset",
  DONE: "chat.done",
  ERROR: "chat.error",
  TOOL_GENERATING: "chat.tool.generating",
  TOOL_START: "chat.tool.start",
  TOOL_PROGRESS: "chat.tool.progress",
  TOOL_DONE: "chat.tool.done",
  CLARIFY: "chat.clarify",
  APPROVAL: "chat.approval",
  SUDO: "chat.sudo",
  SECRET: "chat.secret",
  SESSION: "chat.session",
} as const;

export type RuntimeStreamEvent = {
  type: string;
  session_id?: string;
  delta?: string;
  content?: string;
  error?: string;
  [key: string]: unknown;
};

export function normalizeRuntimeStreamEvent(raw: RuntimeStreamEvent): RuntimeStreamEvent {
  const { type, ...rest } = raw;
  switch (type) {
    case "token":
    case "assistant.delta":
    case "text_delta":
      return { type: RUNTIME_STREAM_EVENT_TYPES.TEXT_DELTA, delta: String(rest.delta ?? rest.content ?? rest.text ?? "") };
    case "assistant.reset":
    case "text_reset":
      return { type: RUNTIME_STREAM_EVENT_TYPES.TEXT_RESET, content: String(rest.content ?? rest.text ?? "") };
    case "thinking":
      return { type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: String(rest.delta ?? rest.content ?? "") };
    case "reasoning":
      return { type: RUNTIME_STREAM_EVENT_TYPES.REASONING, delta: String(rest.delta ?? rest.content ?? "") };
    case "cold_start":
    case "cold-start":
    case "runtime.cold_start":
    case "runtime.cold-start":
      return { type: RUNTIME_STREAM_EVENT_TYPES.COLD_START, ...rest };
    case "message.started":
    case "run.started":
      return { type: RUNTIME_STREAM_EVENT_TYPES.MESSAGE_START, ...rest };
    case "assistant.completed":
    case "run.completed":
    case "done":
      return { type: RUNTIME_STREAM_EVENT_TYPES.DONE, ...rest };
    case "tool.pending":
    case "tool.started":
      return { type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START, ...rest };
    case "tool.running":
    case "tool.progress":
      return { type: RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, ...rest };
    case "tool.completed":
    case "tool.done":
    case "tool.failed":
    case "tool.error":
      return { type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, ...rest };
    case "clarify":
      return { type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY, ...rest };
    case "approval":
      return { type: RUNTIME_STREAM_EVENT_TYPES.APPROVAL, ...rest };
    default:
      return raw;
  }
}

export function runtimeStreamSsePayload(event: RuntimeStreamEvent) {
  return `data: ${JSON.stringify(normalizeRuntimeStreamEvent(event))}\n\n`;
}
