import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
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
import { queenVoicePreferencePreamble } from "@/lib/services/queen-bee/voice-preferences";

// Spoken turns need tight budgets: a slow runtime attempt costs silence.
const AGENT_TURN_TIMEOUT_MS = 10_000;
const OPENAI_TURN_TIMEOUT_MS = 20_000;
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
  /** Lazy so pure-conversation turns never pay for fleet discovery. */
  fleetSnapshot: () => Promise<QueenBeeFleetMachine[]>;
  vaultPath?: string;
  brainServicesFolder?: string;
  kanbanFolder?: string;
  /** Optional per-stage timing sink for caller telemetry. */
  marks?: Record<string, number>;
}): Promise<QueenVoiceTurnResult> {
  const text = await conversationTurnText(options);
  if (text) {
    const parsed = parseVoiceTurnJson(text);
    if (parsed?.task) {
      const submitted = await submitQueenBeeVoiceTask(options, parsed.task);
      return {
        reply: joinSpeech(parsed.speech, submitted.summary),
        taskId: submitted.taskId,
        taskTitle: submitted.taskTitle,
        created: submitted.created,
        route: submitted.route,
      };
    }
    if (parsed?.speech) return { reply: parsed.speech };
    return { reply: text.trim().slice(0, 600) };
  }
  // Last resort: treat the utterance as a direct work request so voice keeps
  // working even when no conversational model is reachable.
  const submitted = await submitQueenBeeVoiceTask(options, {
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

// A failed runtime brain costs several spoken seconds per turn; skip it for a
// while instead of re-probing on every utterance. File-backed because dev
// servers recycle route workers, which resets module state between requests.
let runtimeTurnCooldownUntil = 0;
const RUNTIME_TURN_COOLDOWN_MS = 5 * 60_000;
const RUNTIME_COOLDOWN_PATH = join(
  homedir(),
  ".hivemindos",
  "cache",
  "queen-voice-runtime-cooldown.json",
);

async function runtimeTurnCoolingDown() {
  if (Date.now() < runtimeTurnCooldownUntil) return true;
  try {
    const data = JSON.parse(await readFile(RUNTIME_COOLDOWN_PATH, "utf8")) as {
      until?: unknown;
    };
    runtimeTurnCooldownUntil = Number(data.until) || 0;
  } catch {
    runtimeTurnCooldownUntil = 0;
  }
  return Date.now() < runtimeTurnCooldownUntil;
}

async function startRuntimeTurnCooldown() {
  runtimeTurnCooldownUntil = Date.now() + RUNTIME_TURN_COOLDOWN_MS;
  try {
    await mkdir(dirname(RUNTIME_COOLDOWN_PATH), { recursive: true });
    await writeFile(
      RUNTIME_COOLDOWN_PATH,
      JSON.stringify({ until: runtimeTurnCooldownUntil }),
      "utf8",
    );
  } catch {
    // In-memory cooldown still applies for this worker.
  }
}

// Preferred brain: the user's own chat-capable fleet agent. Fallback: direct
// OpenAI chat with the same key chain that powers Whisper STT and TTS, so the
// voice loop stays conversational even when local runtimes are down.
async function conversationTurnText(options: {
  origin: string;
  transcript: string;
  history: QueenVoiceHistoryTurn[];
  vaultPath?: string;
  marks?: Record<string, number>;
}) {
  // Standing preferences ("call me boss") splice onto the system prompt so
  // both the runtime brain and the OpenAI fallback honor them every turn. Note
  // this fallback path can only HONOR stored preferences, not capture new ones
  // (it has no tool to call); capture happens in the default realtime session.
  const systemPreamble = await queenVoicePreferencePreamble();
  const agent = (await runtimeTurnCoolingDown())
    ? null
    : await pickConversationAgent(options.vaultPath);
  if (agent) {
    const agentStartedAt = Date.now();
    try {
      const text = await runRuntimeConversationTurn(
        options.origin,
        agent,
        options.transcript,
        options.history,
        systemPreamble,
      );
      if (options.marks)
        options.marks.agentTurnMs = Date.now() - agentStartedAt;
      if (text.trim()) return text;
      await startRuntimeTurnCooldown();
    } catch (turnError) {
      if (options.marks)
        options.marks.agentTurnMs = Date.now() - agentStartedAt;
      await startRuntimeTurnCooldown();
      console.warn(
        `[queen-bee-voice] runtime conversation turn via ${agent.name || agent.id} failed; cooling down for 5 minutes:`,
        turnError instanceof Error ? turnError.message : turnError,
      );
    }
  }
  const openAiStartedAt = Date.now();
  try {
    return await runOpenAiConversationTurn(
      options.transcript,
      options.history,
      systemPreamble,
    );
  } catch (fallbackError) {
    console.warn(
      "[queen-bee-voice] OpenAI conversation fallback failed; submitting utterance to the control plane:",
      fallbackError instanceof Error ? fallbackError.message : fallbackError,
    );
    return "";
  } finally {
    if (options.marks)
      options.marks.openAiTurnMs = Date.now() - openAiStartedAt;
  }
}

function conversationMessages(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
) {
  const historyMessages = history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.who === "queen" ? "assistant" : "user",
    content: turn.text.slice(0, 600),
  }));
  const system = systemPreamble?.trim()
    ? `${QUEEN_VOICE_SYSTEM_PROMPT} ${systemPreamble.trim()}`
    : QUEEN_VOICE_SYSTEM_PROMPT;
  return [
    { role: "system", content: system },
    ...historyMessages,
    { role: "user", content: transcript },
  ];
}

async function runOpenAiConversationTurn(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
) {
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    throw new Error(
      "No OpenAI key is configured for the Queen Bee voice conversation fallback.",
    );
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_VOICE_CHAT_FALLBACK_MODEL,
      messages: conversationMessages(transcript, history, systemPreamble),
      max_tokens: 300,
      temperature: 0.6,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(OPENAI_TURN_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const detail =
      typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(detail || `OpenAI chat returned HTTP ${response.status}.`);
  }
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

export type QueenAgentTurnResult = {
  /** One to three short sentences, read aloud by Queen Bee. */
  speech: string;
  /** Fuller findings (markdown) to show on screen; empty when there's none. */
  detail: string;
};

/**
 * Routes a spoken request through the full agent runtime harness (system
 * prompt, capabilities, vault/brain context). Used by the realtime session's
 * ask_hivemind_agent tool, so Queen Bee can reach the user's computer, notes,
 * and shared memory mid-call. Returns a short spoken summary plus an optional
 * richer `detail` payload the overlay can surface in a "what she found" modal -
 * the actual notes/values/files that the spoken reply only summarizes.
 */
export async function runQueenBeeAgentTurn(
  origin: string,
  message: string,
): Promise<QueenAgentTurnResult> {
  const request = message.trim();
  if (!request) return { speech: "The request was empty, so nothing was done.", detail: "" };
  const agent = await pickConversationAgent();
  if (!agent) {
    return {
      speech:
        "No chat-capable HivemindOS agent is configured yet, so the request could not be run.",
      detail: "",
    };
  }
  const preferencePreamble = await queenVoicePreferencePreamble();
  try {
    const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: voiceOptimizedAgent(agent),
        messages: [
          {
            role: "system",
            content:
              "You are handling a request relayed from Queen Bee's live voice chat. Do the work with your available capabilities, then respond with STRICT JSON only, no markdown fences, matching: " +
              '{"speech": string, "detail": string}. ' +
              "speech: one to three short spoken sentences describing the outcome, no markdown, no preambles - this is read aloud. " +
              "detail: the full content the user would want to SEE on screen (the actual notes, list, values, file names, or findings), as readable markdown; use an empty string when there is nothing substantial to show beyond the spoken reply." +
              (preferencePreamble ? ` ${preferencePreamble}` : ""),
          },
          { role: "user", content: request },
        ],
        runtimeSessionId: "queen-bee-voice",
        agentMode: "act",
        latencyMode: "voice",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const text = await readRuntimeResponseText(response);
    if (text.trim()) return parseAgentTurnResult(text);
    return {
      speech:
        "The agent finished without a spoken result. The local runtime may be down - check the Hermes daemon.",
      detail: "",
    };
  } catch (turnError) {
    const detail =
      turnError instanceof Error ? turnError.message : "request failed";
    return {
      speech: `The HivemindOS agent could not be reached (${detail}). The local runtime may need a restart.`,
      detail: "",
    };
  }
}

// The agent is asked for {speech, detail} JSON, but runtimes vary; parse
// leniently and fall back to treating the whole reply as spoken text.
function parseAgentTurnResult(text: string): QueenAgentTurnResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
        speech?: unknown;
        detail?: unknown;
      };
      const speech =
        typeof parsed.speech === "string" ? parsed.speech.trim() : "";
      const detail =
        typeof parsed.detail === "string" ? parsed.detail.trim() : "";
      if (speech) return { speech: speech.slice(0, 600), detail: detail.slice(0, 8_000) };
    } catch {
      // Not JSON - fall through to plain-text handling.
    }
  }
  return { speech: trimmed.slice(0, 600), detail: "" };
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

export async function pickConversationAgent(vaultPath?: string) {
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
  systemPreamble?: string,
) {
  const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: voiceOptimizedAgent(agent),
      messages: conversationMessages(transcript, history, systemPreamble),
      runtimeSessionId: "queen-bee-voice",
      agentMode: "act",
      latencyMode: "voice",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
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

export async function submitQueenBeeVoiceTask(
  options: {
    vaultPath?: string;
    brainServicesFolder?: string;
    kanbanFolder?: string;
    fleetSnapshot: () => Promise<QueenBeeFleetMachine[]>;
    marks?: Record<string, number>;
  },
  task: { title: string; message: string },
) {
  const fleetStartedAt = Date.now();
  const fleetSnapshot = await options.fleetSnapshot();
  if (options.marks) options.marks.fleetMs = Date.now() - fleetStartedAt;
  const result = await submitQueenBeeMessage({
    message: task.message,
    taskTitle: task.title || undefined,
    source: "queen-bee-voice",
    mode: "act",
    vaultPath: options.vaultPath,
    brainServicesFolder: options.brainServicesFolder,
    kanbanFolder: options.kanbanFolder,
    fleetSnapshot,
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
  const detail = summary
    .replace(
      /^Queen Bee accepted the request and\s*delegated it to/i,
      "It was delegated to",
    )
    .replace(/^Queen Bee accepted the request and\s*/i, "It was ");
  return `${lead} ${detail}`.trim();
}
