import {
  RUNTIME_CAPABILITIES,
  RUNTIME_DEFINITIONS,
  type AgentProfile,
  type AgentRuntime,
} from "@/lib/types/agent-runtime";
import { readVaultAgentProfiles } from "@/lib/services/obsidian/agent-profiles";
import {
  readRuntimeResponseText,
  voiceOptimizedAgent,
} from "@/lib/services/phone/runtime-voice-turn";
import { transcriptionApiKey } from "@/lib/services/phone/transcription";
import {
  submitQueenBeeMessage,
  type QueenBeeFleetMachine,
} from "@/lib/services/queen-bee/control-plane";

const CONVERSATION_TURN_TIMEOUT_MS = 20_000;
const MAX_HISTORY_TURNS = 8;
const OPENAI_VOICE_CHAT_FALLBACK_MODEL = "gpt-4o-mini";

export type QueenVoiceHistoryTurn = { who: "you" | "queen"; text: string };

export type QueenVoiceTurnResult = {
  reply: string;
  taskId?: string;
  taskTitle?: string;
  created?: boolean;
  route?: unknown;
};

const QUEEN_VOICE_SYSTEM_PROMPT = [
  "You are Queen Bee, the single coordinator voice of HivemindOS, in a live spoken conversation with the user.",
  'Reply with STRICT JSON only, no markdown fences, matching: {"speech": string, "task": null | {"title": string, "message": string}}.',
  "speech: one or two short, natural spoken sentences. No markdown, no lists, no reasoning preambles.",
  "Set task ONLY when the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive).",
  "Greetings, questions, status chat, and thinking-out-loud get task: null and a conversational speech reply.",
  "When you do create a task, make title a short imperative summary, message the full work request in the user's words, and have speech briefly confirm what you are kicking off.",
].join(" ");

/**
 * One conversational Queen Bee voice turn: a chat-capable fleet agent (as the
 * Queen Bee persona) decides whether the utterance is conversation or a work
 * request. Work requests are submitted to the Queen Bee control plane and the
 * delegation receipt is appended to the spoken confirmation. Falls back to
 * direct control-plane submission when no runtime turn is possible.
 */
export async function runQueenBeeVoiceTurn(options: {
  origin: string;
  transcript: string;
  history: QueenVoiceHistoryTurn[];
  fleetSnapshot: QueenBeeFleetMachine[];
  vaultPath?: string;
  brainServicesFolder?: string;
  kanbanFolder?: string;
}): Promise<QueenVoiceTurnResult> {
  const agent = await pickConversationAgent(options.vaultPath);
  if (agent) {
    try {
      const text = await runRuntimeConversationTurn(
        options.origin,
        agent,
        options.transcript,
        options.history,
      );
      const parsed = parseVoiceTurnJson(text);
      if (parsed?.task) {
        const submitted = await submitTask(options, parsed.task);
        return {
          reply: joinSpeech(parsed.speech, submitted.summary),
          taskId: submitted.taskId,
          taskTitle: submitted.taskTitle,
          created: submitted.created,
          route: submitted.route,
        };
      }
      if (parsed?.speech) return { reply: parsed.speech };
      if (text.trim()) return { reply: text.trim().slice(0, 600) };
    } catch (turnError) {
      console.warn(
        "[queen-bee-voice] conversation turn failed; falling back to control-plane submission:",
        turnError instanceof Error ? turnError.message : turnError,
      );
    }
  }
  const submitted = await submitTask(options, {
    title: "",
    message: options.transcript,
  });
  return {
    reply: submitted.summary,
    taskId: submitted.taskId,
    taskTitle: submitted.taskTitle,
    created: submitted.created,
    route: submitted.route,
  };
}

// A live voice turn needs a runtime that answers chat requests directly;
// background runtimes (e.g. AEON workflows) cannot hold a spoken conversation.
function supportsLiveChatTurn(profile: AgentProfile) {
  const runtime = profile.runtime as AgentRuntime;
  const chat =
    RUNTIME_DEFINITIONS[runtime as keyof typeof RUNTIME_DEFINITIONS]?.chat;
  return (
    chat?.kind === "interactive" ||
    chat?.kind === "gateway" ||
    RUNTIME_CAPABILITIES[runtime]?.chat === true
  );
}

function isLocalMachineProfile(profile: AgentProfile) {
  const machine = profile.machineName?.trim().toLowerCase();
  return !machine || machine === "this mac" || machine === "local";
}

async function pickConversationAgent(vaultPath?: string) {
  const profiles = await readVaultAgentProfiles(vaultPath).catch(
    () => [] as AgentProfile[],
  );
  const candidates = profiles.filter(
    (profile) => profile.id && profile.runtime && supportsLiveChatTurn(profile),
  );
  const general = candidates.filter(
    (profile) => profile.workerClass === "general" || !profile.workerClass,
  );
  return (
    general.find(isLocalMachineProfile) ??
    general[0] ??
    candidates.find(isLocalMachineProfile) ??
    candidates[0] ??
    null
  );
}

async function runRuntimeConversationTurn(
  origin: string,
  agent: AgentProfile,
  transcript: string,
  history: QueenVoiceHistoryTurn[],
) {
  const historyMessages = history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.who === "queen" ? "assistant" : "user",
    content: turn.text.slice(0, 600),
  }));
  const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: voiceOptimizedAgent(agent),
      messages: [
        { role: "system", content: QUEEN_VOICE_SYSTEM_PROMPT },
        ...historyMessages,
        { role: "user", content: transcript },
      ],
      runtimeSessionId: "queen-bee-voice",
      agentMode: "act",
      latencyMode: "voice",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(CONVERSATION_TURN_TIMEOUT_MS),
  });
  return readRuntimeResponseText(response);
}

function parseVoiceTurnJson(
  text: string,
): { speech: string; task: { title: string; message: string } | null } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      speech?: unknown;
      task?: unknown;
    };
    const speech =
      typeof parsed.speech === "string" ? parsed.speech.trim() : "";
    if (!speech) return null;
    const rawTask =
      parsed.task && typeof parsed.task === "object"
        ? (parsed.task as Record<string, unknown>)
        : null;
    const message =
      typeof rawTask?.message === "string" ? rawTask.message.trim() : "";
    return {
      speech: speech.slice(0, 600),
      task: message
        ? {
            title:
              typeof rawTask?.title === "string" ? rawTask.title.trim() : "",
            message,
          }
        : null,
    };
  } catch {
    return null;
  }
}

async function submitTask(
  options: {
    vaultPath?: string;
    brainServicesFolder?: string;
    kanbanFolder?: string;
    fleetSnapshot: QueenBeeFleetMachine[];
  },
  task: { title: string; message: string },
) {
  const result = await submitQueenBeeMessage({
    message: task.message,
    taskTitle: task.title || undefined,
    source: "queen-bee-voice",
    mode: "act",
    vaultPath: options.vaultPath,
    brainServicesFolder: options.brainServicesFolder,
    kanbanFolder: options.kanbanFolder,
    fleetSnapshot: options.fleetSnapshot,
  });
  const summary =
    typeof result.receipt?.summary === "string" && result.receipt.summary.trim()
      ? result.receipt.summary.trim()
      : `Queen Bee received your request: ${task.message}`;
  return {
    summary,
    taskId: result.task?.id,
    taskTitle: result.task?.title,
    created: result.created,
    route: result.route,
  };
}

function joinSpeech(speech: string, summary: string) {
  const lead = speech.trim();
  if (!lead) return summary;
  // The model already confirmed the kickoff; add only the routing detail.
  const detail = summary.replace(
    /^Queen Bee accepted the request and\s*/i,
    "It was ",
  );
  return `${lead} ${detail}`.trim();
}
