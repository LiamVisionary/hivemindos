import type { AgentProfile } from "@/lib/types/agent-runtime";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import {
  readRuntimeResponseText,
  voiceOptimizedAgent,
} from "@/lib/services/phone/runtime-voice-turn";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

const QUEEN_VOICE_SESSION_ID = "queen-bee-voice";

export function runtimeVoicePersistedReply(
  messages: Array<{ role: string; content: string }>,
  beforeCount: number,
) {
  return messages
    .slice(beforeCount)
    .filter((message) => message.role === "assistant" && message.content.trim())
    .at(-1)?.content.trim() ?? "";
}

export async function runPersistedRuntimeVoiceTurn(options: {
  origin: string;
  agent: AgentProfile;
  messages: Array<{ role: string; content: string }>;
  timeoutMs: number;
  statusSpeech: string;
  onActivity?: (label: string) => void;
  onTextDelta?: (chunk: string) => void;
  onStatusSpeech?: (text: string) => void;
}) {
  const beforeCount = (await readRuntimeChatSession({
    sessionId: QUEEN_VOICE_SESSION_ID,
  }).catch(() => null))?.messages.length ?? 0;
  const recoverPersistedReply = async () => {
    for (const delayMs of [0, 75, 225, 500]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const session = await readRuntimeChatSession({
        sessionId: QUEEN_VOICE_SESSION_ID,
      }).catch(() => null);
      const reply = session
        ? runtimeVoicePersistedReply(session.messages, beforeCount)
        : "";
      if (reply) return reply;
    }
    return "";
  };
  let acknowledgedTool = false;
  const noteActivity = (label: string) => {
    options.onActivity?.(label);
    if (!acknowledgedTool) {
      acknowledgedTool = true;
      options.onStatusSpeech?.(options.statusSpeech);
    }
  };
  try {
    const response = await fetch(new URL("/api/chat/agent-runtime", options.origin), {
      method: "POST",
      headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
      body: JSON.stringify({
        agent: voiceOptimizedAgent(options.agent),
        messages: options.messages,
        runtimeSessionId: QUEEN_VOICE_SESSION_ID,
        agentMode: "act",
        latencyMode: "voice",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const text = await readRuntimeResponseText(
      response,
      noteActivity,
      options.onTextDelta,
    );
    return text.trim() || await recoverPersistedReply();
  } catch (error) {
    const recovered = await recoverPersistedReply();
    if (recovered) return recovered;
    throw error;
  }
}
