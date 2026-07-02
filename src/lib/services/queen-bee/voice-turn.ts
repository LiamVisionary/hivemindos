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
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";

// The persisted session every Queen agent-turn shares; multi-step rail flows (a
// swap/send/Bankr DRAFT prepared on one turn, then a confirmation on the next)
// thread their draft through it because the agent-turn is otherwise stateless.
const QUEEN_VOICE_SESSION_ID = "queen-bee-voice";

// A bare confirmation token ("CONFIRM_SWAP", "confirm", ...) carries no request of
// its own — it points at a draft prepared on the previous turn. Used to decide when
// to strip the FAB's screen-context wrapper + thread the prior draft.
const CONFIRMATION_REQUEST = /^(?:confirm|confirmed|yes|yes,?\s*confirm|go ahead|run it|execute|send it|(?:CONFIRM|SEND|APPROVE)_[A-Z]+)$/i;

// Spoken turns need tight budgets: a slow runtime attempt costs silence.
const AGENT_TURN_TIMEOUT_MS = 10_000;
const OPENAI_TURN_TIMEOUT_MS = 20_000;
const MAX_HISTORY_TURNS = 8;
// How many capable agents the delegation path tries (in fitness order) before
// falling back to OpenAI. A single down agent (bad provider key, etc.) must not
// dead-end the request.
const MAX_AGENT_FALLBACK_ATTEMPTS = 3;
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
  "You are MID-conversation: never greet again, never reintroduce yourself, never restart the conversation - answer the latest message directly in context.",
  "Set task ONLY when the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive).",
  "Greetings, questions, status chat, and thinking-out-loud get task: null and a conversational speech reply.",
  "When you do create a task, make title a short imperative summary, message the full work request in the user's words, and have speech briefly confirm what you are kicking off.",
].join(" ");

/**
 * One self-contained prompt for runtime (CLI/gateway) agents. The agent-runtime
 * route reduces a messages[] array to the LATEST user message for most
 * runtimes, which silently dropped the system prompt and conversation history -
 * the runtime brain saw a bare "What do you think?" with no context and
 * re-greeted like a fresh session. Everything the turn needs rides in the one
 * user message instead.
 */
export function buildRuntimeVoiceUserText(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
) {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const transcriptBlock = recent.length
    ? [
        "Conversation so far (most recent last):",
        ...recent.map(
          (turn) => `${turn.who === "queen" ? "Queen Bee" : "User"}: ${turn.text.slice(0, 600)}`,
        ),
        "",
      ].join("\n")
    : "";
  return [
    QUEEN_VOICE_SYSTEM_PROMPT,
    systemPreamble?.trim() || "",
    "",
    transcriptBlock,
    `User's latest spoken message: ${transcript}`,
    "",
    "Respond now as Queen Bee with the STRICT JSON object only.",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

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
  /** Optional live stage sink (overlay progress chips). */
  progress?: (label: string) => void;
}): Promise<QueenVoiceTurnResult> {
  const text = await conversationTurnText(options);
  if (text) {
    const parsed = parseVoiceTurnJson(text);
    if (parsed?.task) {
      options.progress?.(
        parsed.task.title ? `Delegating: ${parsed.task.title}` : "Delegating the task",
      );
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
  progress?: (label: string) => void;
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
    options.progress?.(`Thinking with ${agent.name || agent.id}`);
    try {
      const text = await runRuntimeConversationTurn(
        options.origin,
        agent,
        options.transcript,
        options.history,
        systemPreamble,
        options.progress,
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
  options.progress?.("Thinking with OpenAI");
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

/** The user's selected acting wallet, relayed so the executing agent defaults
 *  wallet/trade actions to it. `agentId` is its resolution id (agentId, a
 *  `user:` personal id, or "bankr"); `kind` lets the local rails bow out for
 *  Bankr-managed wallets so Bankr handles the action. */
export type ActingWalletSource = {
  agentId: string;
  address: string;
  network: string;
  kind: string;
};

export function coerceActingWalletSource(value: unknown): ActingWalletSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  if (!agentId) return undefined;
  return {
    agentId,
    address: typeof record.address === "string" ? record.address.trim() : "",
    network: typeof record.network === "string" ? record.network.trim() : "",
    kind: typeof record.kind === "string" ? record.kind.trim() : "",
  };
}

// The recent rail DRAFTS from the shared Queen voice session. Every rail draft ends
// with a "Reply `confirm`/`CONFIRM_…`" instruction, so we thread the most recent few
// of THOSE (not arbitrary assistant text) — robust to interleaved errors/chatter —
// letting a confirmation turn's route handler locate the exact draft to execute.
async function recentQueenVoiceSessionMessages(): Promise<Array<{ role: "assistant"; content: string }>> {
  const session = await readRuntimeChatSession({ sessionId: QUEEN_VOICE_SESSION_ID }).catch(() => null);
  if (!session) return [];
  return session.messages
    .filter((m) => m.role === "assistant" && typeof m.content === "string"
      && /reply\s+`?(?:confirm|CONFIRM_|SEND_|APPROVE_)/i.test(m.content))
    .slice(-2)
    .map((m) => ({ role: "assistant" as const, content: m.content }));
}

// Pull the EXACT confirmation token a prepared draft asked for - the route writes
// drafts as "...Reply `CONFIRM_SWAP`...", "...Reply `confirm`...", "...Reply `SEND_USDC`...".
// The confirm must hit the same rail that prepared it (DEX wants CONFIRM_SWAP, Bankr
// wants confirm, sends want SEND_USDC); echoing the draft's own token back makes the
// route's exact-match executors fire regardless of which token the user/brain typed.
function extractDraftConfirmToken(draft: string): string {
  const match = draft.match(/\breply\s+`?([A-Za-z0-9_]+)`?/i);
  return match ? match[1] : "";
}

// Last-resort fallback for a relayed request when every capable agent is down:
// answer directly via OpenAI. It has no computer tools, so it can only help with
// requests answerable from its own knowledge; anything strictly needing the user's
// machine/files/wallet it should say it couldn't reach an agent for.
async function runOpenAiAgentTurn(request: string, systemPreamble?: string): Promise<string> {
  const apiKey = await transcriptionApiKey();
  if (!apiKey) throw new Error("No OpenAI key for the agent-turn fallback.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_VOICE_CHAT_FALLBACK_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are Queen Bee's fallback brain. The user's HivemindOS agents are unavailable, so answer the request directly and briefly from your own knowledge. If it strictly needs their computer, files, or wallet, say plainly that you couldn't reach an agent to do it." +
            (systemPreamble ? ` ${systemPreamble}` : ""),
        },
        { role: "user", content: request },
      ],
      max_tokens: 300,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(OPENAI_TURN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI agent-turn fallback HTTP ${response.status}.`);
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

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
  actingWallet?: ActingWalletSource,
): Promise<QueenAgentTurnResult> {
  const request = message.trim();
  if (!request) return { speech: "The request was empty, so nothing was done.", detail: "" };
  // The FAB wraps relayed requests as "<screen context>\n\nUser request: <text>".
  // When this turn is a bare confirmation, (1) strip the wrapper so the route's
  // exact-match confirm handlers (which compare against "CONFIRM_SWAP" etc.) fire,
  // and (2) thread the recent persisted session — the prior draft is stored there
  // as an assistant message, and the stateless agent-turn would otherwise lose it,
  // so the confirm handlers that scan message history for the draft can find it.
  const bareRequest = request.replace(/^[\s\S]*?\n\nUser request:\s*/i, "").trim() || request;
  const isConfirmation = CONFIRMATION_REQUEST.test(bareRequest);
  const priorDraftMessages = isConfirmation ? await recentQueenVoiceSessionMessages() : [];
  let userContent = isConfirmation ? bareRequest : request;
  // A confirmation only executes if it reaches the exact-match executor for the rail
  // that prepared the draft. The brain (or user) may type the other rail's token or a
  // synonym - e.g. "CONFIRM_SWAP" against a Bankr draft that wants "confirm", which
  // matches NEITHER executor and re-prompts forever. Replace it with the pending
  // draft's own required token so the correct executor fires deterministically.
  if (isConfirmation && priorDraftMessages.length) {
    const draftToken = extractDraftConfirmToken(priorDraftMessages[priorDraftMessages.length - 1].content);
    if (draftToken) userContent = draftToken;
  }
  const agents = await rankConversationAgents();
  if (agents.length === 0) {
    return {
      speech:
        "No chat-capable HivemindOS agent is configured yet, so the request could not be run.",
      detail: "",
    };
  }
  const preferencePreamble = await queenVoicePreferencePreamble();
  const relayMessages = [
    {
      role: "system",
      content:
        "You are handling a request relayed from Queen Bee's live voice chat. Do the work with your available capabilities, then respond with STRICT JSON only, no markdown fences, matching: " +
        '{"speech": string, "detail": string}. ' +
        "speech: one to three short spoken sentences describing the outcome, no markdown, no preambles - this is read aloud. " +
        "detail: the full content the user would want to SEE on screen (the actual notes, list, values, file names, or findings), as readable markdown; use an empty string when there is nothing substantial to show beyond the spoken reply." +
        (preferencePreamble ? ` ${preferencePreamble}` : ""),
    },
    ...priorDraftMessages,
    { role: "user", content: userContent },
  ];
  // Try capable agents in fitness order. A single failing agent (bad provider key,
  // empty result, unreachable) must NOT dead-end the request - fall through to the
  // next best, then to OpenAI. Money actions are intercepted by the route's rails
  // BEFORE the agent runs, so the first agent's call returns the rail draft for
  // those regardless of agent health.
  let lastError = "";
  for (const agent of agents.slice(0, MAX_AGENT_FALLBACK_ATTEMPTS)) {
    try {
      const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: voiceOptimizedAgent(agent),
          messages: relayMessages,
          runtimeSessionId: QUEEN_VOICE_SESSION_ID,
          agentMode: "act",
          latencyMode: "voice",
          actingWalletSource: actingWallet,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      const text = await readRuntimeResponseText(response);
      if (text.trim()) return parseAgentTurnResult(text);
      // 200 but no usable text (e.g. the agent's provider rejected its key) - next agent.
    } catch (turnError) {
      lastError = turnError instanceof Error ? turnError.message : "request failed";
      console.warn(
        `[queen-bee-voice] relayed agent turn via ${agent.name || agent.id} failed; trying next:`,
        lastError,
      );
    }
  }
  // Every capable agent came up empty/unreachable - last resort is OpenAI. No computer
  // tools, but answering from its own knowledge beats dead-ending (any money action was
  // already handled by the rails before reaching here).
  try {
    const text = await runOpenAiAgentTurn(userContent, preferencePreamble);
    if (text.trim()) return parseAgentTurnResult(text);
  } catch (fallbackError) {
    lastError = fallbackError instanceof Error ? fallbackError.message : lastError;
  }
  return {
    speech:
      "I tried your agents and the OpenAI fallback, but none could complete that just now - your agent runtime may need attention.",
    detail: "",
  };
}

// The route's money-action rails (swap/send/Bankr/x402) return a rich markdown
// CARD - bold headers, the full wallet address, a base64 Bankr payload, a tx hash,
// a "Reply `confirm`" line. That belongs on SCREEN, not read aloud word-for-word.
// Turn such a card into a short spoken line + the full card as on-screen detail.
function spokenLineForCard(card: string): string {
  if (/\breply\s+`?(?:confirm|CONFIRM_|SEND_|APPROVE_)/i.test(card)) {
    return "Here's the transaction. Say confirm to continue.";
  }
  const header = card.match(/\*\*([^*]+)\*\*/);
  if (header) return `${header[1].trim().replace(/[.:]+$/, "")}. The details are on screen.`;
  return "The details are on screen.";
}

function looksLikeRichCard(text: string): boolean {
  // A prepared/confirmed money action: a confirm line, a base64 Bankr payload,
  // an on-chain tx hash, or a long bold-headed markdown block - none of it spoken.
  return (
    /\breply\s+`?(?:confirm|CONFIRM_|SEND_|APPROVE_)/i.test(text)
    || /\b0x[a-fA-F0-9]{16,}\b/.test(text)
    || /payload\s+`?[A-Za-z0-9_+/-]{24,}/i.test(text)
    || (/\*\*[^*]+\*\*/.test(text) && text.length > 180)
  );
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
  // A bare markdown card from the money rails: speak a short line, show the rest.
  if (looksLikeRichCard(trimmed)) {
    return { speech: spokenLineForCard(trimmed), detail: trimmed.slice(0, 8_000) };
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

// All chat-capable agents in fitness order (general+local, then general, then
// local, then the rest), deduped by id. The delegation path tries them in turn so
// one failing agent falls through to the next best instead of dead-ending.
export async function rankConversationAgents(vaultPath?: string): Promise<AgentProfile[]> {
  const profiles = await readVaultAgentProfiles(vaultPath).catch(
    () => [] as AgentProfile[],
  );
  const candidates = profiles.filter(
    (profile) => profile.id && profile.runtime && supportsLiveChatTurn(profile),
  );
  const isGeneral = (p: AgentProfile) => p.workerClass === "general" || !p.workerClass;
  const ordered = [
    ...candidates.filter((p) => isGeneral(p) && isLocalMachineProfile(p)),
    ...candidates.filter((p) => isGeneral(p) && !isLocalMachineProfile(p)),
    ...candidates.filter((p) => !isGeneral(p) && isLocalMachineProfile(p)),
    ...candidates.filter((p) => !isGeneral(p) && !isLocalMachineProfile(p)),
  ];
  const seen = new Set<string>();
  return ordered.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

export async function pickConversationAgent(vaultPath?: string) {
  return (await rankConversationAgents(vaultPath))[0] ?? null;
}

async function runRuntimeConversationTurn(
  origin: string,
  agent: AgentProfile,
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  onActivity?: (label: string) => void,
) {
  // One flattened user message (persona + history + latest): most runtime
  // adapters only see the latest user message, so a messages[] history array
  // never reached them - see buildRuntimeVoiceUserText.
  const userText = buildRuntimeVoiceUserText(transcript, history, systemPreamble);
  const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: voiceOptimizedAgent(agent),
      messages: [{ role: "user", content: userText }],
      runtimeSessionId: "queen-bee-voice",
      agentMode: "act",
      latencyMode: "voice",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
  });
  return readRuntimeResponseText(response, onActivity);
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
    progress?: (label: string) => void;
  },
  task: { title: string; message: string },
) {
  const fleetStartedAt = Date.now();
  options.progress?.("Scanning the fleet for the right agent");
  const fleetSnapshot = await options.fleetSnapshot();
  if (options.marks) options.marks.fleetMs = Date.now() - fleetStartedAt;
  options.progress?.("Routing the task");
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
