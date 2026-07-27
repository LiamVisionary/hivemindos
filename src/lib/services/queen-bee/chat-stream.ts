/* chat-stream.ts — accumulate an OpenAI Chat Completions stream into the
 * shapes the typed Queen chat loop needs. The route pipes SSE chunks through
 * `applyOpenAiChatChunk` and forwards `delta` text to the client as NDJSON as
 * it arrives; `finalizeQueenChatStream` yields the same {content, toolCalls,
 * assistant} contract the non-streaming chat-turn action returns, so the
 * client's tool loop is identical either way.
 *
 * Tool calls stream as index-keyed fragments (id/name first, then argument
 * string pieces) — they must be concatenated per index, never per array
 * position of the chunk. Dependency-free so the hermetic suite drives it with
 * synthetic chunks.
 */

export type QueenChatToolCall = { id: string; name: string; arguments: string };

export type QueenChatStreamState = {
  content: string;
  toolCalls: Map<number, QueenChatToolCall>;
  servedModel?: string;
  usage?: QueenChatUsage;
};

export type QueenChatUsage = Record<string, unknown> & {
  prompt_tokens_details?: { cached_tokens?: number };
};

type OpenAiStreamChunk = {
  model?: string;
  usage?: QueenChatUsage;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

export function createQueenChatStreamState(): QueenChatStreamState {
  return { content: "", toolCalls: new Map() };
}

/** Fold one parsed stream chunk in; returns the text delta (if any) to forward. */
export function applyOpenAiChatChunk(state: QueenChatStreamState, chunk: OpenAiStreamChunk): string {
  if (typeof chunk.model === "string" && chunk.model.trim()) state.servedModel = chunk.model.trim();
  if (chunk.usage && typeof chunk.usage === "object") state.usage = chunk.usage;
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return "";
  for (const fragment of delta.tool_calls ?? []) {
    const index = fragment.index ?? 0;
    const call = state.toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
    if (fragment.id) call.id = fragment.id;
    if (fragment.function?.name) call.name += fragment.function.name;
    if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
    state.toolCalls.set(index, call);
  }
  if (typeof delta.content === "string" && delta.content) {
    state.content += delta.content;
    return delta.content;
  }
  return "";
}

/** The finished turn in the exact shape the non-streaming chat-turn returns. */
export function finalizeQueenChatStream(state: QueenChatStreamState): {
  content: string;
  toolCalls: QueenChatToolCall[];
  assistant: Record<string, unknown>;
  servedModel?: string;
  usage?: QueenChatUsage;
} {
  const toolCalls = [...state.toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => call.name);
  const assistant: Record<string, unknown> = { role: "assistant", content: state.content || null };
  if (toolCalls.length) {
    assistant.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments || "{}" },
    }));
  }
  return {
    content: state.content,
    toolCalls,
    assistant,
    ...(state.servedModel ? { servedModel: state.servedModel } : {}),
    ...(state.usage ? { usage: state.usage } : {}),
  };
}

/**
 * Split an SSE byte-stream into `data:` JSON payloads. Stateful across calls —
 * a chunk boundary can fall mid-line. Returns parsed chunks; "[DONE]" yields
 * a `done` marker instead of a payload.
 */
export function createSseJsonParser() {
  let buffer = "";
  return function feed(text: string): { done: boolean; chunks: OpenAiStreamChunk[] } {
    buffer += text;
    const chunks: OpenAiStreamChunk[] = [];
    let done = false;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!payload) continue;
      if (payload === "[DONE]") {
        done = true;
        continue;
      }
      try {
        chunks.push(JSON.parse(payload) as OpenAiStreamChunk);
      } catch {
        // partial/garbled frame — skip; the accumulator tolerates gaps
      }
    }
    return { done, chunks };
  };
}
