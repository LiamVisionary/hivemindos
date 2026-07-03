import {
  describeBeePilotActions,
  parseBeePilotPlan,
  type BeePilotContext,
  type BeePilotPlan,
} from "@/features/dashboard/bee-pilot/bee-pilot-actions";
import { formatDashboardScreenContextForPrompt } from "@/features/dashboard/screen-context";
import {
  readRuntimeResponseText,
  voiceOptimizedAgent,
} from "@/lib/services/phone/runtime-voice-turn";
import { transcriptionApiKey } from "@/lib/services/phone/transcription";
import { pickConversationAgent } from "@/lib/services/queen-bee/voice-turn";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

// Pilot turns gate a visible UI animation, so they get the same tight budget
// philosophy as spoken turns: a slow runtime attempt costs a frozen popup.
const AGENT_TURN_TIMEOUT_MS = 12_000;
const OPENAI_TURN_TIMEOUT_MS = 20_000;
const OPENAI_PILOT_FALLBACK_MODEL = "gpt-4o-mini";

function pilotSystemPrompt(context: BeePilotContext): string {
  const screenContext = formatDashboardScreenContextForPrompt(context.screenContext);
  return [
    "You are Queen Bee, the UI pilot of HivemindOS. Convert the user's command into dashboard UI actions.",
    'Reply with STRICT JSON only, no markdown fences, matching: {"reply": string, "steps": [{"action": string, "params": object}]}.',
    "reply: one short friendly sentence describing what you are doing (or why nothing can be done).",
    "steps: an ordered list of UI actions (usually one, at most six). Available actions:",
    describeBeePilotActions(),
    `Known agents: ${context.agentNames.join(", ") || "(none yet)"}.`,
    `Known machines: ${context.machineNames.join(", ") || "(none yet)"}.`,
    `Kanban columns: ${context.kanbanColumns.join(", ")}.`,
    context.activeView ? `The user is currently on the "${context.activeView}" view.` : "",
    screenContext ? `Current dashboard context:\n${screenContext}` : "",
    "Match agent/machine params to the known names above (use the exact known spelling).",
    "Use queen-task ONLY for real work requests (research, build, write, fix, automate) - not for opening or operating UI.",
    "If the command cannot be mapped to any action, return steps: [] with a short helpful reply.",
  ].filter(Boolean).join("\n");
}

/**
 * One Queen Bee pilot turn: maps a typed natural-language command to a UI
 * action plan. Mirrors the voice turn's brain order - the user's own
 * chat-capable fleet agent first, then the OpenAI key chain as fallback.
 */
export async function runQueenBeePilotTurn(options: {
  origin: string;
  command: string;
  context: BeePilotContext;
  vaultPath?: string;
}): Promise<BeePilotPlan> {
  const system = pilotSystemPrompt(options.context);
  const agent = await pickConversationAgent(options.vaultPath).catch(() => null);
  if (agent) {
    try {
      const response = await fetch(new URL("/api/chat/agent-runtime", options.origin), {
        method: "POST",
        headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
        body: JSON.stringify({
          agent: voiceOptimizedAgent(agent),
          messages: [
            { role: "system", content: system },
            { role: "user", content: options.command },
          ],
          runtimeSessionId: "queen-bee-pilot",
          agentMode: "act",
          latencyMode: "voice",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
      });
      const text = await readRuntimeResponseText(response);
      const plan = parseBeePilotPlan(text);
      if (plan) return plan;
    } catch (turnError) {
      console.warn(
        "[queen-bee-pilot] runtime pilot turn failed; falling back to OpenAI:",
        turnError instanceof Error ? turnError.message : turnError,
      );
    }
  }
  const plan = parseBeePilotPlan(await runOpenAiPilotTurn(system, options.command));
  if (plan) return plan;
  return {
    reply: "I couldn't map that to anything on the dashboard - try rephrasing, or name the screen, agent, or task.",
    steps: [],
  };
}

async function runOpenAiPilotTurn(system: string, command: string): Promise<string> {
  const apiKey = await transcriptionApiKey();
  if (!apiKey) return "";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_PILOT_FALLBACK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: command },
        ],
        max_tokens: 400,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(OPENAI_TURN_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    if (!response.ok) return "";
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}
