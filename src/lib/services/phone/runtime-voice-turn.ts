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
    const text =
      parsed.choices
        ?.map(
          (choice) => choice.delta?.content || choice.message?.content || "",
        )
        .join("") ||
      parsed.event?.delta ||
      parsed.event?.content ||
      parsed.delta ||
      parsed.content ||
      parsed.text ||
      "";
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
    if (onActivity) {
      const label = toolActivityLabel(data);
      if (label) onActivity(label);
    }
    text += sseTextFromPayload(data);
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
