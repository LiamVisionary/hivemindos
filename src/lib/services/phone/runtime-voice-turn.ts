import type { AgentProfile } from "@/lib/types/agent-runtime";

/**
 * Shared helpers for low-latency spoken runtime turns: SSE payload parsing and
 * full-response text assembly for /api/chat/agent-runtime streams, plus the
 * voice-optimized agent transform. Used by the phone call routes and the
 * Queen Bee voice chat.
 */

export function sseTextFromPayload(raw: string) {
  if (!raw || raw === "[DONE]") return "";
  try {
    const parsed = JSON.parse(raw) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
      event?: { delta?: string; content?: string; error?: string };
      delta?: string;
      content?: string;
      text?: string;
      error?: string;
    };
    const error =
      typeof parsed.error === "string"
        ? parsed.error
        : parsed.event?.error || "";
    if (error.trim()) throw new Error(error.trim());
    // Incremental delta fragments pass through unfiltered: a streaming runtime
    // hits this per token, and the reasoning filter below would silently eat
    // innocent mid-sentence fragments like "First," or "Let's" from both the
    // collected reply and the streamed TTS deltas.
    const deltaText =
      parsed.choices
        ?.map((choice) => choice.delta?.content || "")
        .join("") ||
      parsed.event?.delta ||
      parsed.delta ||
      "";
    if (deltaText) return deltaText;
    const text =
      parsed.choices
        ?.map((choice) => choice.message?.content || "")
        .join("") ||
      parsed.event?.content ||
      parsed.content ||
      parsed.text ||
      "";
    // Whole-message frames only: some runtimes emit their reasoning preamble
    // as a full content frame before the real reply.
    if (
      /^\s*(?:we need|we are asked|the user asked|i need to|let's|first,)/i.test(
        text,
      )
    )
      return "";
    return text;
  } catch {
    return "";
  }
}

export function sseErrorFromPayload(raw: string) {
  if (!raw || raw === "[DONE]") return "";
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      error?: string | { message?: string };
      event?: { error?: string };
    };
    if (parsed.type === "chat.error") {
      return typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message ||
            parsed.event?.error ||
            "Runtime returned an error.";
    }
    return typeof parsed.error === "string"
      ? parsed.error
      : parsed.error?.message || parsed.event?.error || "";
  } catch {
    return "";
  }
}

// Best-effort human label for a runtime tool event ("chat.tool.start" etc.);
// payload field names vary per runtime adapter. Tool completions return "" —
// the next stage (or the finish) marks the previous one done.
export function toolActivityLabel(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> & { type?: string };
    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (!type.startsWith("chat.tool") || type === "chat.tool.done") return "";
    const name = [parsed.name, parsed.tool, parsed.tool_name, parsed.label, parsed.title]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);
    return name ? `Using ${name.slice(0, 60)}` : "Using a tool";
  } catch {
    return "";
  }
}

export async function readRuntimeResponseText(
  response: Response,
  /** Optional live sink for non-text SSE activity (tool starts etc.). */
  onActivity?: (label: string) => void,
  /** Optional live sink for reply-text deltas as they stream. */
  onTextDelta?: (delta: string) => void,
) {
  if (!response.body) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    if (!response.ok)
      throw new Error(
        data?.error ||
          data?.message ||
          `Runtime returned HTTP ${response.status}.`,
      );
    return data?.message || "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const consume = (data: string) => {
    // Runtime error frames must fail the attempt (cooldown + fallback), not
    // silently truncate the reply: sseTextFromPayload's own error throw is
    // self-caught (dead code), so gate here the way the phone route does.
    const error = sseErrorFromPayload(data);
    if (error) throw new Error(error);
    if (onActivity) {
      const label = toolActivityLabel(data);
      if (label) onActivity(label);
    }
    const delta = sseTextFromPayload(data);
    if (delta && onTextDelta) onTextDelta(delta);
    text += delta;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split(/\n/)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      consume(data);
    }
  }
  if (buffer) {
    const data = buffer
      .split(/\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    consume(data);
  }
  if (!response.ok && !text.trim())
    throw new Error(`Runtime returned HTTP ${response.status}.`);
  return text.trim();
}

/**
 * Adaptive OpenRouter agents resolve "adaptive" lazily, which is too slow for
 * spoken turns; pin them to their configured fallback model instead.
 */
export function voiceOptimizedAgent(agent: AgentProfile): AgentProfile {
  const fallback =
    agent.adaptiveOpenRouter?.fallbackModel?.trim() ||
    agent.adaptiveRouting?.fallbackModel?.trim();
  const provider = agent.provider?.trim().toLowerCase();
  const model = agent.model?.trim().toLowerCase();
  if (provider === "openrouter" && model === "adaptive" && fallback) {
    return { ...agent, model: fallback };
  }
  return agent;
}
