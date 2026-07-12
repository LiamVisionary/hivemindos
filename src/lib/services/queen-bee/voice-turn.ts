import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import {
  RUNTIME_CAPABILITIES,
  RUNTIME_DEFINITIONS,
  type AgentProfile,
  type AgentRuntime,
} from "@/lib/types/agent-runtime";
import { readStoredAgentProfilesStrict } from "@/lib/services/agent-profile-store";
import { isHivemindosWalletPaidModelProfile } from "@/lib/services/hivemindos-wallet-paid-models";
import { readVaultAgentProfiles } from "@/lib/services/obsidian/agent-profiles";
import {
  readRuntimeResponseText,
  voiceOptimizedAgent,
} from "@/lib/services/phone/runtime-voice-turn";
import {
  resolveOpenAiApiKeyChatEndpoint,
  resolvePreferredOpenAiChatRoute,
  runPreferredOpenAiTextTurn,
} from "@/lib/services/openai-preferred-chat";
import {
  submitQueenBeeMessage,
  type QueenBeeFleetMachine,
} from "@/lib/services/queen-bee/control-plane";
import { formatQueenBeePersonalityInstruction } from "@/lib/config/queen-bee-personality";
import { queenModelTransparencyNote } from "@/lib/services/queen-bee/model-transparency";
import { runConfiguredQueenProviderFallback } from "@/lib/services/queen-bee/provider-fallback";
import {
  addQueenBeeVoicePreference,
  queenVoicePreferencePreamble,
} from "@/lib/services/queen-bee/voice-preferences";
import { readQueenBeeBrainDefaults } from "@/lib/services/queen-bee/voice-settings";
import { runBuiltInQueenCapabilityTurnWithEvidence } from "@/lib/services/queen-bee/capability-fallback";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import {
  openAICompatibleInferenceCacheHints,
  openAICompatibleMessageCacheControlSupported,
} from "@/lib/services/chat/inference-cache-hints";
import { createVoiceSpeechEmitter } from "@/lib/services/queen-bee/voice-speech-stream";
import {
  noteQueenVoiceBrainFailure,
  noteQueenVoiceBrainSuccess,
} from "@/lib/services/queen-bee/voice-brain-status";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import {
  voiceTaskApprovalPrompt,
  voiceTaskSubmissionAuthorized,
} from "@/lib/services/queen-bee/voice-task-approval";
import { runXAccountReadTool } from "@/lib/services/x-latest-post";
import {
  coerceXAccountReadToolInput,
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  X_ACCOUNT_READ_TOOL_NAME,
} from "@/lib/services/x-account-tool-contract";
import { queenPipelineChatTools } from "@/lib/services/queen-bee/queen-brain";
import {
  applyOpenAiChatChunk,
  createQueenChatStreamState,
  finalizeQueenChatStream,
} from "@/lib/services/queen-bee/chat-stream";
import {
  isXaiOAuthProvider,
  xaiOAuthVoiceRequestOptions,
} from "@/lib/services/xai-oauth-inference-contract";

// The persisted session every Queen agent-turn shares; multi-step rail flows (a
// swap/send/Bankr DRAFT prepared on one turn, then a confirmation on the next)
// thread their draft through it because the agent-turn is otherwise stateless.
const QUEEN_VOICE_SESSION_ID = "queen-bee-voice";
const QUEEN_PIPELINE_CHAT_TOOLS = queenPipelineChatTools();

// A bare confirmation token ("CONFIRM_SWAP", "confirm", ...) carries no request of
// its own — it points at a draft prepared on the previous turn. Used to decide when
// to strip the FAB's screen-context wrapper + thread the prior draft.
const CONFIRMATION_REQUEST = /^(?:confirm|confirmed|yes|yes,?\s*confirm|go ahead|run it|execute|send it|(?:CONFIRM|SEND|APPROVE)_[A-Z]+)$/i;

// Spoken turns need tight budgets: a slow runtime attempt costs silence —
// but the budget must fit the brain it times. A hermes CLI turn on an OAuth
// provider (openai-codex) takes 8-13s warm end-to-end through
// /api/chat/agent-runtime, so a 10s agent budget aborted into the alerted
// OpenAI fallback right before the reply landed, on every turn.
const AGENT_TURN_TIMEOUT_MS = 20_000;
// OAuth-held runtime brains have to run through the full agent/runtime loop:
// provider OAuth resolution, model call, tool calls, and final JSON answer.
// They are still interactive, but a 20s voice budget cuts off successful xAI
// or ChatGPT-subscription turns before their tool-backed answer arrives.
const OAUTH_AGENT_TURN_TIMEOUT_MS = 75_000;
// The HivemindOS-models gateway buffers upstream responses (no deltas until
// done) and its free host can cold-start, so 20s aborts into the alerted
// OpenAI fallback + 5-minute cooldown on every cold turn. Mirrors the typed
// chat lane's 120s budget for the same brain class (resolveQueenTypedChatBrains).
const WALLET_PAID_AGENT_TURN_TIMEOUT_MS = 120_000;
const OPENAI_TURN_TIMEOUT_MS = 20_000;
const MAX_HISTORY_TURNS = 8;
// How many capable agents the delegation path tries (in fitness order) before
// falling back to OpenAI. A single down agent (bad provider key, etc.) must not
// dead-end the request.
const MAX_AGENT_FALLBACK_ATTEMPTS = 3;
const OPENAI_VOICE_CHAT_FALLBACK_MODEL = "gpt-4o-mini";

type ProviderConversationTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type ProviderConversationMessage = {
  role: "system" | "assistant" | "user";
  content: string | ProviderConversationTextBlock[];
};

type ConversationMessagesOptions = {
  systemPreamble?: string;
  stableSystemAddendum?: string;
  personality?: string | null;
  cacheControl?: { provider: string; model: string };
};

type ProviderInferenceEvidence = {
  model?: string;
  usage?: Record<string, unknown>;
};

type ProviderConversationToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type ProviderConversationTurn = {
  text: string;
  toolCalls: ProviderConversationToolCall[];
  evidence: ProviderInferenceEvidence;
};

function voiceInferenceUsageFields(usage: Record<string, unknown> | undefined) {
  const promptDetails = usage?.prompt_tokens_details;
  const completionDetails = usage?.completion_tokens_details;
  return {
    inputTokens: Number(usage?.prompt_tokens) || null,
    cachedPromptTokens:
      promptDetails && typeof promptDetails === "object"
        ? Number((promptDetails as { cached_tokens?: unknown }).cached_tokens) || 0
        : null,
    outputTokens: Number(usage?.completion_tokens) || null,
    reasoningTokens:
      completionDetails && typeof completionDetails === "object"
        ? Number((completionDetails as { reasoning_tokens?: unknown }).reasoning_tokens) || 0
        : null,
  };
}

function recordQueenVoiceInference(input: {
  provider: string;
  requestedModel: string;
  evidence?: ProviderInferenceEvidence;
  elapsedMs: number;
}) {
  void import("@/lib/services/telemetry/local-telemetry")
    .then(({ recordTelemetryBatch }) => recordTelemetryBatch([{
      source: "route",
      type: "queen_voice.inference",
      payload: {
        provider: input.provider,
        requestedModel: input.requestedModel,
        servedModel: input.evidence?.model ?? null,
        ...voiceInferenceUsageFields(input.evidence?.usage),
        elapsedMs: input.elapsedMs,
      },
    }]))
    .catch(() => undefined);
}

/** The model the OpenAI fallback lane actually answers with. */
export function voiceFallbackModelName() {
  return process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_VOICE_CHAT_FALLBACK_MODEL;
}

export function runtimeConversationTurnTimeoutMs(agent: Pick<AgentProfile, "provider">) {
  if (isHivemindosWalletPaidModelProfile(agent as AgentProfile)) {
    return WALLET_PAID_AGENT_TURN_TIMEOUT_MS;
  }
  const provider = agent.provider?.trim().toLowerCase() ?? "";
  if (
    provider.includes("oauth") ||
    provider === "openai-codex" ||
    provider === "copilot"
  ) {
    return OAUTH_AGENT_TURN_TIMEOUT_MS;
  }
  return AGENT_TURN_TIMEOUT_MS;
}

/**
 * Resolved plan for WHICH brain answers a pipeline voice turn. Built by the
 * route from the Queen's Calls prefs (`voiceChatBrain`): "direct" calls the
 * given provider/model straight over its OpenAI-compatible chat endpoint
 * (the agent's own selected model by default, or an explicit voice override);
 * "fleet-agent" is the legacy ranked-agent runtime lane. The OpenAI fallback
 * below remains the final safety net for both — and it is alerted loudly.
 */
export type VoiceChatBrainPlan =
  | { kind: "fleet-agent" }
  | {
      /** The agent's own runtime answers — REQUIRED for runtime-held providers
       *  (openai-codex, copilot): their credential lives inside
       *  the runtime, so this is the only lane that uses the user's actual
       *  credentials for that model. Slower than direct, honest by design. */
      kind: "agent-runtime";
      agentId: string;
      label: string;
    }
  | {
      kind: "direct";
      provider: string;
      model: string;
      label: string;
      /** Identity used for degradation status/alerts (the settings modal
       *  matches on agent id, so "agent"-sourced plans pass the queen's). */
      statusAgent: { id: string; name?: string; runtime?: string; provider?: string; model?: string };
    };

export type QueenVoiceHistoryTurn = { who: "you" | "queen"; text: string };

export type QueenVoiceTurnResult = {
  reply: string;
  brainLabel?: string;
  brainFallback?: { label: string; error: string };
  taskId?: string;
  taskTitle?: string;
  created?: boolean;
  route?: unknown;
};

const QUEEN_VOICE_TURN_INSTRUCTIONS = [
  "You are Queen Bee, the single coordinator voice of HivemindOS, in a live spoken conversation with the user.",
  'Reply with STRICT JSON only, no markdown fences, matching: {"speech": string, "task": null | {"title": string, "message": string}}.',
  "speech: one or two short, natural spoken sentences. No markdown, no lists, no reasoning preambles.",
  "You are MID-conversation: never greet again, never reintroduce yourself, never restart the conversation - answer the latest message directly in context.",
  "Set task ONLY when the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive).",
  "When an offered tool can fulfill the user's request during this turn, call it and answer now with task null. Do not turn immediate read-only retrieval or capability use into Work Board work.",
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  "When no more-specific offered tool fully covers the request, call use_hive_capability with the user's complete goal and needed conversation context. It performs full capability search and governed execution across registered skills, MCP tools, connected app APIs, Hive Actions, runtime tools, and specialty agents. Never guess or claim a capability is unavailable merely because it is not named as a direct tool here.",
  "If you choose a next step after an open-ended prompt like 'you tell me', keep task null and ask for approval. Only set task after the user's latest message asks for specific work or confirms your immediately previous task proposal.",
  "Greetings, questions, status chat, and thinking-out-loud get task: null and a conversational speech reply.",
  "When you do create a task, make title a short imperative summary, message the full work request in the user's words, and have speech briefly confirm what you are kicking off.",
];

function queenVoiceSystemPrompt(personality?: string | null) {
  return [
    formatQueenBeePersonalityInstruction(personality),
    ...QUEEN_VOICE_TURN_INSTRUCTIONS,
  ].join(" ");
}

export function spokenVoicePreferenceFromTranscript(transcript: string) {
  const trimmed = transcript.replace(/\s+/g, " ").trim();
  if (!trimmed || /\?\s*$/.test(trimmed)) return "";
  const addressMatch = trimmed.match(
    /^(?:please\s+)?(?:remember\s+(?:to|that\s+you\s+should)\s+)?(?:always\s+)?(?:call|address)\s+me\s+(?:as\s+)?["“”']?([a-z][a-z0-9 _.-]{0,40}?)(?:["“”']?\s*(?:from now on|going forward|please)?[.!]?)?$/i,
  );
  if (!addressMatch) return "";
  const name = addressMatch[1]?.trim().replace(/[.!?]+$/, "");
  if (!name || /\b(?:that|when|if|because|why|what|where|who|how)\b/i.test(name)) return "";
  return `Address the user as "${name}".`;
}

async function captureSpokenVoicePreference(transcript: string) {
  const preference = spokenVoicePreferenceFromTranscript(transcript);
  if (!preference) return "";
  await addQueenBeeVoicePreference(preference);
  return preference;
}

export function buildRuntimeVoiceSystemText(
  systemPreamble?: string,
  personality?: string | null,
) {
  return [
    "Queen Bee live voice override: for this voice turn, answer as Queen Bee. These instructions override the selected runtime profile's agent identity, soul, addressing, and speech format.",
    queenVoiceSystemPrompt(personality),
    systemPreamble?.trim() || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

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
  personality?: string | null,
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
    // Keep the full voice contract in the latest user message too: several
    // runtime adapters only read `message`/latest-user and ignore messages[].
    buildRuntimeVoiceSystemText(systemPreamble, personality),
    "",
    transcriptBlock,
    `User's latest spoken message: ${transcript}`,
    "",
    "Respond now as Queen Bee with the STRICT JSON object only.",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export function buildRuntimeVoiceMessages(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  personality?: string | null,
) {
  return [
    {
      role: "system" as const,
      content: buildRuntimeVoiceSystemText(undefined, personality),
    },
    {
      role: "user" as const,
      content: "Apply these standing Queen Bee voice instructions to the current turn and wait for the user's live message.",
    },
    {
      role: "assistant" as const,
      content: "Understood. I will apply the Queen Bee voice contract to the current turn.",
    },
    {
      role: "user" as const,
      content: buildRuntimeVoiceUserText(
        transcript,
        history,
        systemPreamble,
        personality,
      ),
    },
  ];
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
  /**
   * Live spoken-reply sink for the streaming converse action: emits speech
   * text incrementally while the model writes (the concatenation across a
   * turn equals the returned `reply`, minus any divergent tail).
   */
  onSpeechDelta?: (text: string) => void;
  /** A failed attempt's already-emitted speech must be discarded downstream. */
  onSpeechReset?: () => void;
  /** Which brain answers the conversation (resolved by the route from the
   *  Queen's Calls prefs). Defaults to the fleet-agent lane. */
  voiceBrain?: VoiceChatBrainPlan;
}): Promise<QueenVoiceTurnResult> {
  let brainMetadata: Pick<QueenVoiceTurnResult, "brainLabel" | "brainFallback"> = {};
  const emitter = options.onSpeechDelta
    ? createVoiceSpeechEmitter(options.onSpeechDelta)
    : null;
  // Whatever the live extraction did not cover (non-JSON replies, the
  // delegation receipt) is emitted before the result returns, so the client
  // always hears the same text the buffered turn would have spoken.
  const finish = (result: QueenVoiceTurnResult) => {
    const complete = { ...result, ...brainMetadata };
    emitter?.finalize(complete.reply);
    return complete;
  };
  const text = await conversationTurnText({
    ...options,
    onTextDelta: emitter ? (chunk) => emitter.onTextDelta(chunk) : undefined,
    onAttemptStart: emitter
      ? () => {
          if (emitter.attemptReset()) options.onSpeechReset?.();
        }
      : undefined,
    onBrainFallback: (metadata) => { brainMetadata = metadata; },
  });
  if (text) {
    const parsed = parseVoiceTurnJson(text);
    if (parsed?.task) {
      if (!voiceTaskSubmissionAuthorized(options.transcript, options.history)) {
        if (emitter?.attemptReset()) options.onSpeechReset?.();
        return finish({ reply: voiceTaskApprovalPrompt(parsed.task) });
      }
      options.progress?.(
        parsed.task.title ? `Delegating: ${parsed.task.title}` : "Delegating the task",
      );
      const submitted = await submitQueenBeeVoiceTask(options, parsed.task);
      return finish({
        reply: joinSpeech(parsed.speech, submitted.summary),
        taskId: submitted.taskId,
        taskTitle: submitted.taskTitle,
        created: submitted.created,
        route: submitted.route,
      });
    }
    if (parsed?.speech) return finish({ reply: parsed.speech });
    return finish({ reply: text.trim().slice(0, 600) });
  }
  // Last resort: stay conversational. Never turn a model outage or empty reply
  // into a Work Board mutation; the user must explicitly authorize queued work.
  if (emitter?.attemptReset()) options.onSpeechReset?.();
  return finish({
    reply:
      "I couldn't get a clean enough reply to act. Tell me exactly what to queue and I will ask before sending it to the Work Board.",
  });
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
  /** Live reply-text deltas from the CURRENT attempt only. */
  onTextDelta?: (chunk: string) => void;
  /** Called before every attempt so delta consumers can reset between them. */
  onAttemptStart?: () => void;
  voiceBrain?: VoiceChatBrainPlan;
  onBrainFallback?: (metadata: Pick<QueenVoiceTurnResult, "brainLabel" | "brainFallback">) => void;
}) {
  await captureSpokenVoicePreference(options.transcript).catch(() => "");
  // Standing preferences ("call me boss") splice onto the system prompt so
  // both the runtime brain and the OpenAI fallback honor them every turn. Note
  // the pipeline also captures simple spoken preference utterances itself,
  // because it does not run the realtime session's remember_preference tool.
  const preferencePreamble = await queenVoicePreferencePreamble();
  const queenDefaults = await readQueenBeeBrainDefaults().catch(() => null);
  const queenPersonality = queenDefaults?.soulPrompt;
  // Best-effort hive context (shared-brain recall + open work digest) rides
  // the system preamble so EVERY brain lane can answer "check my hive brain"
  // and "what's on our to-do list" in conversation mode. Lazy import keeps
  // the hermetic node suites' import graph clean; the module enforces a hard
  // time budget so a slow index never stalls a spoken turn.
  const brainContext = await (async () => {
    try {
      const { queenVoiceBrainContext } = await import(
        "@/lib/services/queen-bee/voice-brain-context"
      );
      return await queenVoiceBrainContext(options.transcript, {
        vaultPath: options.vaultPath,
      });
    } catch {
      return "";
    }
  })();
  const systemPreamble = [preferencePreamble, brainContext]
    .filter((part) => part && part.trim())
    .join("\n\n");
  const plan = options.voiceBrain ?? { kind: "fleet-agent" as const };
  if (plan.kind === "direct") {
    let directFailure = `${plan.label} did not answer.`;
    const directStartedAt = Date.now();
    // No "Thinking with X" progress chip: the overlay shows the resolved
    // brain as a static tag by her name; chips are for real work stages.
    try {
      options.onAttemptStart?.();
      const text = await runProviderConversationTurn(
        plan,
        options.transcript,
        options.history,
        systemPreamble,
        options.onTextDelta,
        queenPersonality,
        options.origin,
      );
      if (options.marks) options.marks.directTurnMs = Date.now() - directStartedAt;
      if (text.trim()) {
        void noteQueenVoiceBrainSuccess(plan.statusAgent);
        return text;
      }
      directFailure = `${plan.label} returned an empty reply.`;
      void noteQueenVoiceBrainFailure({
        agent: plan.statusAgent,
        error: `${plan.label} returned an empty reply.`,
        fallbackModel: voiceFallbackModelName(),
        vaultPath: options.vaultPath,
      });
    } catch (directError) {
      directFailure = directError instanceof Error ? directError.message : String(directError);
      if (options.marks) options.marks.directTurnMs = Date.now() - directStartedAt;
      void noteQueenVoiceBrainFailure({
        agent: plan.statusAgent,
        error: directFailure,
        fallbackModel: voiceFallbackModelName(),
        vaultPath: options.vaultPath,
      });
    }
    const fallbackStartedAt = Date.now();
    const recovered = await runConfiguredQueenProviderFallback(
      { excludeProvider: plan.provider, excludeModel: plan.model, limit: 2 },
      async (fallback) => {
        options.onAttemptStart?.();
        return runProviderConversationTurn(
          fallback,
          options.transcript,
          options.history,
          systemPreamble,
          options.onTextDelta,
          queenPersonality,
          options.origin,
        );
      },
      (fallback, error) => {
        console.warn(
          `[queen-bee-voice] configured fallback ${fallback.label} failed:`,
          error instanceof Error ? error.message : error,
        );
      },
    );
    if (options.marks) options.marks.providerFallbackMs = Date.now() - fallbackStartedAt;
    if (recovered) {
      options.onBrainFallback?.({ brainLabel: recovered.fallback.label, brainFallback: { label: `${plan.model} · ${plan.provider}`, error: directFailure } });
      return recovered.text;
    }
  }
  const agent = await (async () => {
    if (plan.kind === "direct" || (await runtimeTurnCoolingDown())) return null;
    if (plan.kind === "agent-runtime") {
      // Pinned to the configured agent so the turn runs on ITS credentials
      // (OAuth providers); missing/chat-incapable pins fall to the fallback.
      const stored = await readStoredConversationAgent(plan.agentId).catch(() => null);
      if (stored) return stored;
      const ranked = await rankConversationAgents(options.vaultPath);
      return ranked.find((profile) => profile.id === plan.agentId) ?? null;
    }
    return pickConversationAgent(options.vaultPath);
  })();
  if (agent) {
    const agentStartedAt = Date.now();
    try {
      options.onAttemptStart?.();
      const text = await runRuntimeConversationTurn(
        options.origin,
        agent,
        options.transcript,
        options.history,
        systemPreamble,
        options.progress,
        options.onTextDelta,
        queenPersonality,
      );
      if (options.marks)
        options.marks.agentTurnMs = Date.now() - agentStartedAt;
      if (text.trim()) {
        // The configured brain answered — clear any degradation status.
        void noteQueenVoiceBrainSuccess(agent);
        return text;
      }
      void noteQueenVoiceBrainFailure({
        agent,
        error: "The runtime turn returned an empty reply.",
        fallbackModel: voiceFallbackModelName(),
        vaultPath: options.vaultPath,
      });
      await startRuntimeTurnCooldown();
    } catch (turnError) {
      if (options.marks)
        options.marks.agentTurnMs = Date.now() - agentStartedAt;
      void noteQueenVoiceBrainFailure({
        agent,
        error: turnError instanceof Error ? turnError.message : String(turnError),
        fallbackModel: voiceFallbackModelName(),
        vaultPath: options.vaultPath,
      });
      await startRuntimeTurnCooldown();
      console.warn(
        `[queen-bee-voice] runtime conversation turn via ${agent.name || agent.id} failed; cooling down for 5 minutes:`,
        turnError instanceof Error ? turnError.message : turnError,
      );
    }
  }
  const openAiStartedAt = Date.now();
  try {
    options.onAttemptStart?.();
    return await runOpenAiConversationTurn(
      options.origin,
      options.transcript,
      options.history,
      systemPreamble,
      options.onTextDelta,
      queenPersonality,
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

function conversationSystemContent(options: ConversationMessagesOptions) {
  const stable = [
    queenVoiceSystemPrompt(options.personality),
    options.stableSystemAddendum?.trim() || "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const volatile = options.systemPreamble?.trim() || "";
  if (
    options.cacheControl &&
    openAICompatibleMessageCacheControlSupported(options.cacheControl)
  ) {
    return [
      stable
        ? { type: "text", text: stable, cache_control: { type: "ephemeral" } }
        : null,
      volatile ? { type: "text", text: volatile } : null,
    ].filter((block): block is ProviderConversationTextBlock => Boolean(block));
  }
  return [stable, volatile].filter(Boolean).join("\n\n");
}

function conversationMessages(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  options: ConversationMessagesOptions = {},
): ProviderConversationMessage[] {
  const historyMessages = history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.who === "queen" ? "assistant" as const : "user" as const,
    content: turn.text.slice(0, 600),
  }));
  return [
    { role: "system", content: conversationSystemContent(options) },
    ...historyMessages,
    { role: "user", content: transcript },
  ];
}

function conversationStringMessages(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  options: Omit<ConversationMessagesOptions, "cacheControl"> = {},
) {
  return conversationMessages(transcript, history, options).map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((block) => block.text).join("\n\n"),
  }));
}

async function runOpenAiConversationTurn(
  origin: string,
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  onTextDelta?: (chunk: string) => void,
  personality?: string | null,
) {
  const route = await resolvePreferredOpenAiChatRoute(voiceFallbackModelName());
  return runProviderConversationTurn(
    {
      provider: route.auth === "oauth" ? "openai-oauth" : "openai-api",
      model: route.model,
      label: route.auth === "oauth" ? "ChatGPT" : "OpenAI",
    },
    transcript,
    history,
    systemPreamble,
    onTextDelta,
    personality,
    origin,
  );
}

/** Resolve a provider slug to an OpenAI-compatible chat-completions endpoint
 *  + key. OpenAI rides the existing voice key chain; everything else resolves
 *  through the provider catalog + shared hive env (lazy imports keep those
 *  out of the hermetic node suites' import graph). Providers without an
 *  OpenAI-compatible base fail the turn — visibly, via the degradation alert. */
export async function resolveProviderChatEndpoint(
  provider: string,
): Promise<{ url: string; key: string } | null> {
  if (isXaiOAuthProvider(provider)) {
    const { resolveXaiOAuthChatEndpoint } = await import(
      "@/lib/services/xai-oauth-inference"
    );
    return resolveXaiOAuthChatEndpoint();
  }
  // Other OAuth-held providers (openai-codex, copilot) remain runtime-owned.
  if (!provider || provider === "openai" || provider === "openai-api") {
    return resolveOpenAiApiKeyChatEndpoint();
  }
  const { providerCatalogEntry } = await import("@/lib/config/provider-catalog");
  const entry = providerCatalogEntry(provider);
  if (!entry?.baseUrl || !entry.keyEnv) return null;
  const { hiveEnvValue } = await import("@/lib/services/shared-hive-env");
  const key = await hiveEnvValue(entry.keyEnv).catch(() => "");
  if (!key) return null;
  return { url: `${entry.baseUrl.replace(/\/+$/, "")}/chat/completions`, key };
}

async function runProviderConversationTurn(
  target: { provider: string; model: string; label: string },
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  onTextDelta?: (chunk: string) => void,
  personality?: string | null,
  origin = "",
) {
  const providerStartedAt = Date.now();
  // Every provider-direct lane invokes target.model itself, so the injected
  // identity is exact — "which model are you?" gets a real answer per lane.
  const stableSystemAddendum = queenModelTransparencyNote(target.model, target.provider);
  if (target.provider === "openai-oauth") {
    // The user's ChatGPT subscription credentials (shared hive env), via the
    // Responses backend. Lazy import: server-only module, and the hermetic
    // node suites import this file directly.
    const { runOpenAiOAuthChatTurn } = await import("@/lib/services/openai-oauth");
    return runOpenAiOAuthChatTurn(
      target.model,
      conversationStringMessages(transcript, history, {
        systemPreamble,
        stableSystemAddendum,
        personality,
      }),
      { onTextDelta, timeoutMs: OPENAI_TURN_TIMEOUT_MS },
    );
  }
  const endpoint = await resolveProviderChatEndpoint(target.provider);
  if (!endpoint) {
    throw new Error(
      `No key or OpenAI-compatible endpoint for provider "${target.provider || "openai"}" (${target.label}).`,
    );
  }
  const cacheHints = openAICompatibleInferenceCacheHints({
    provider: target.provider,
    model: target.model,
    cacheScope: `queen-voice:${target.provider}:${target.model}`,
  });
  const initialMessages = conversationMessages(transcript, history, {
    systemPreamble,
    stableSystemAddendum,
    personality,
    cacheControl: { provider: target.provider, model: target.model },
  });
  const post = (
    params: Record<string, unknown>,
    messages: Array<Record<string, unknown>> = initialMessages as Array<Record<string, unknown>>,
    offerTools = true,
  ) =>
    fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.key}`,
        "content-type": "application/json",
        ...cacheHints.headers,
      },
      body: JSON.stringify({
        model: target.model,
        messages,
        // Streamed turns feed the fused converse+speak pipeline; the buffered
        // legacy action keeps the plain JSON response.
        ...(onTextDelta ? { stream: true } : {}),
        ...(onTextDelta && isXaiOAuthProvider(target.provider)
          ? { stream_options: { include_usage: true } }
          : {}),
        ...(offerTools ? { tools: QUEEN_PIPELINE_CHAT_TOOLS, tool_choice: "auto" } : {}),
        ...cacheHints.body,
        ...params,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(OPENAI_TURN_TIMEOUT_MS),
    });
  // Reasoning-era OpenAI models (gpt-5*, o*) reject max_tokens/temperature and
  // burn completion budget on thinking — they get max_completion_tokens plus
  // low reasoning effort (the voice-latency lever: default effort adds ~1s+ to
  // first token). Everything else gets the classic body. A 400 naming an
  // unsupported parameter retries once with the legacy-safe body so older
  // OpenAI-compatible servers (and misclassified models) still work.
  const reasoningModel = /^(o\d|gpt-5)/i.test(target.model.trim());
  const requestOptions = isXaiOAuthProvider(target.provider)
    ? xaiOAuthVoiceRequestOptions(target.model)
    : reasoningModel
      ? { max_completion_tokens: 700, reasoning_effort: "low" }
      : { max_tokens: 300, temperature: 0.6 };
  let response = await post(requestOptions);
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string } | string;
    } | null;
    const detail =
      typeof data?.error === "string" ? data.error : data?.error?.message;
    const toolError =
      response.status === 400 &&
      /tool|function.?call/i.test(detail ?? "");
    const parameterError =
      response.status === 400 &&
      /unsupported|unrecognized|unknown|max_tokens|max_completion_tokens|reasoning_effort|temperature/i.test(detail ?? "");
    if (toolError) {
      response = await post(requestOptions, initialMessages as Array<Record<string, unknown>>, false);
    } else if (!parameterError) {
      throw new Error(detail || `${target.label} chat returned HTTP ${response.status}.`);
    } else {
      response = await post(
        reasoningModel
          ? { max_completion_tokens: 700 }
          : { max_completion_tokens: 300 },
      );
    }
    if (!response.ok) {
      const retryData = (await response.json().catch(() => null)) as {
        error?: { message?: string } | string;
      } | null;
      const retryDetail =
        typeof retryData?.error === "string" ? retryData.error : retryData?.error?.message;
      throw new Error(retryDetail || `${target.label} chat returned HTTP ${response.status}.`);
    }
  }
  const readTurn = async (turnResponse: Response): Promise<ProviderConversationTurn> => {
    if (onTextDelta) {
      return readOpenAiSseTurn(turnResponse, onTextDelta);
    }
    const data = (await turnResponse.json().catch(() => null)) as {
      model?: string;
      usage?: Record<string, unknown>;
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    } | null;
    const message = data?.choices?.[0]?.message;
    return {
      text: message?.content?.trim() || "",
      toolCalls: (message?.tool_calls ?? []).map((call, index) => ({
        id: call.id || `x_account_${index}`,
        name: call.function?.name || "",
        arguments: call.function?.arguments || "{}",
      })).filter((call) => call.name),
      evidence: { model: data?.model, usage: data?.usage },
    };
  };
  let turn = await readTurn(response);
  if (turn.toolCalls.length) {
    const assistantToolCalls = turn.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    const toolMessages = await Promise.all(turn.toolCalls.map(async (call) => {
      let content: string;
      try {
        const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        if (call.name === X_ACCOUNT_READ_TOOL_NAME) {
          content = await runXAccountReadTool(coerceXAccountReadToolInput(args));
        } else if (call.name === "use_hive_capability") {
          const message = typeof args.message === "string" ? args.message.trim() : "";
          if (!message) throw new Error("A capability goal is required.");
          content = JSON.stringify({
            ok: true,
            ...(await runQueenBeeAgentTurn(origin, message, undefined, { preferBuiltInCapability: true })),
          });
        } else {
          throw new Error(`Unknown Queen voice tool: ${call.name}.`);
        }
      } catch (error) {
        content = JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Queen capability tool failed.",
        });
      }
      return { role: "tool", tool_call_id: call.id, content };
    }));
    const continuationMessages: Array<Record<string, unknown>> = [
      ...(initialMessages as Array<Record<string, unknown>>),
      { role: "assistant", content: turn.text || null, tool_calls: assistantToolCalls },
      ...toolMessages,
    ];
    const continuation = await post(requestOptions, continuationMessages, false);
    if (continuation.ok) {
      turn = await readTurn(continuation);
    } else {
      turn = {
        text: toolMessages.map((message) => message.content).join("\n\n"),
        toolCalls: [],
        evidence: turn.evidence,
      };
    }
  }
  recordQueenVoiceInference({
    provider: target.provider,
    requestedModel: target.model,
    evidence: turn.evidence,
    elapsedMs: Date.now() - providerStartedAt,
  });
  return turn.text;
}

// Minimal OpenAI chat-completions SSE reader. readRuntimeResponseText would
// also work now that its reasoning-preamble filter skips delta fragments, but
// this path only ever sees OpenAI's delta shape, so the smaller reader stays.
// Exported for the hermetic gate (this path only runs live when the runtime
// brain is cooling down).
async function readOpenAiSseTurn(
  response: Response,
  onTextDelta: (chunk: string) => void,
  onEvidence?: (evidence: ProviderInferenceEvidence) => void,
): Promise<ProviderConversationTurn> {
  if (!response.body) return { text: "", toolCalls: [], evidence: {} };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = createQueenChatStreamState();
  const evidence: ProviderInferenceEvidence = {};
  const consume = (raw: string) => {
    if (!raw || raw === "[DONE]") return;
    try {
      const parsed = JSON.parse(raw) as {
          model?: string;
          usage?: Record<string, unknown>;
          choices?: Array<{ delta?: { content?: string } }>;
        };
      if (parsed.model) evidence.model = parsed.model;
      if (parsed.usage) evidence.usage = parsed.usage;
      if (parsed.model || parsed.usage) onEvidence?.({ model: parsed.model, usage: parsed.usage });
      const delta = applyOpenAiChatChunk(state, parsed);
      if (delta) {
        onTextDelta(delta);
      }
    } catch {
      // Keep-alives and malformed frames are skipped.
    }
  };
  const consumeFrame = (frame: string) =>
    consume(
      frame
        .split(/\n/)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n"),
    );
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) consumeFrame(frame);
  }
  if (buffer) consumeFrame(buffer);
  const finalized = finalizeQueenChatStream(state);
  return {
    text: finalized.content.trim(),
    toolCalls: finalized.toolCalls,
    evidence,
  };
}

export async function readOpenAiSseText(
  response: Response,
  onTextDelta: (chunk: string) => void,
  onEvidence?: (evidence: ProviderInferenceEvidence) => void,
) {
  return (await readOpenAiSseTurn(response, onTextDelta, onEvidence)).text;
}

export type QueenAgentTurnResult = {
  /** One to three short sentences, read aloud by Queen Bee. */
  speech: string;
  /** Fuller findings (markdown) to show on screen; empty when there's none. */
  detail: string;
};

type QueenAgentTurnOptions = {
  suppressWalletIntents?: boolean;
  preferBuiltInCapability?: boolean;
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
  const requestedModel = process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_VOICE_CHAT_FALLBACK_MODEL;
  const route = await resolvePreferredOpenAiChatRoute(requestedModel);
  const stableSystem = [
    "You are Queen Bee's fallback brain. The user's HivemindOS agents are unavailable, so answer the request directly and briefly from your own knowledge. If it strictly needs their computer, files, or wallet, say plainly that you couldn't reach an agent to do it.",
    queenModelTransparencyNote(
      route.model,
      route.auth === "oauth" ? "ChatGPT OAuth (fallback lane)" : "OpenAI API (fallback lane)",
    ),
  ].join("\n\n");
  const volatileSystem = systemPreamble?.trim() || "";
  const result = await runPreferredOpenAiTextTurn({
    model: route.model,
    messages: [
      {
        role: "system",
        content: [stableSystem, volatileSystem].filter(Boolean).join("\n\n"),
      },
      { role: "user", content: request },
    ],
    cacheScope: "queen-agent-turn-fallback",
    timeoutMs: OPENAI_TURN_TIMEOUT_MS,
    maxTokens: 300,
    temperature: 0.5,
    errorContext: "Queen agent-turn fallback",
  });
  return result.text;
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
  options?: QueenAgentTurnOptions,
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
  let nonExecutingBuiltInResult: QueenAgentTurnResult | null = null;
  const runBuiltInFallback = async () => {
    try {
      const evidence = await runBuiltInQueenCapabilityTurnWithEvidence({
        origin,
        messages: relayMessages,
        model: voiceFallbackModelName(),
        sessionId: `${QUEEN_VOICE_SESSION_ID}-capability`,
        actingWalletSource: actingWallet,
        suppressWalletIntents: options?.suppressWalletIntents === true,
      });
      if (!evidence.text.trim()) return null;
      return {
        result: parseAgentTurnResult(evidence.text),
        authoritative: evidence.capabilityExecuted || evidence.approvalRequired || looksLikeRichCard(evidence.text),
      };
    } catch (fallbackError) {
      lastError = fallbackError instanceof Error ? fallbackError.message : lastError;
      return null;
    }
  };
  if (options?.preferBuiltInCapability) {
    const builtInResult = await runBuiltInFallback();
    if (builtInResult?.authoritative) return builtInResult.result;
    nonExecutingBuiltInResult = builtInResult?.result ?? null;
  }
  for (const agent of agents.slice(0, MAX_AGENT_FALLBACK_ATTEMPTS)) {
    try {
      const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
        method: "POST",
        headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
        body: JSON.stringify({
          agent: voiceOptimizedAgent(agent),
          messages: relayMessages,
          runtimeSessionId: QUEEN_VOICE_SESSION_ID,
          agentMode: "act",
          latencyMode: "capability",
          actingWalletSource: actingWallet,
          suppressWalletIntents: options?.suppressWalletIntents === true,
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
  // Configured runtimes can all be down at once. Keep the final execution
  // fallback tool-capable and inside the normal runtime authorization gates.
  if (!options?.preferBuiltInCapability) {
    const builtInResult = await runBuiltInFallback();
    if (builtInResult) return builtInResult.result;
  }
  if (nonExecutingBuiltInResult) return nonExecutingBuiltInResult;
  // Plain OpenAI remains the conversational last resort when even the native
  // capability runtime cannot run; it must not claim any external action.
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

async function readStoredConversationAgent(agentId: string) {
  const profiles = await readStoredAgentProfilesStrict();
  const profile = profiles.find((candidate) => candidate.id === agentId) ?? null;
  return profile && supportsLiveChatTurn(profile) ? profile : null;
}

async function runRuntimeConversationTurn(
  origin: string,
  agent: AgentProfile,
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  onActivity?: (label: string) => void,
  onTextDelta?: (chunk: string) => void,
  personality?: string | null,
) {
  // One flattened user message (persona + history + latest): most runtime
  // adapters only see the latest user message, so a messages[] history array
  // never reached them - see buildRuntimeVoiceUserText. Also send the same
  // Queen contract as an actual system message for adapters that do honor
  // messages[], so the runtime profile's own soul does not outrank Queen.
  const messages = buildRuntimeVoiceMessages(transcript, history, systemPreamble, personality);
  const response = await fetch(new URL("/api/chat/agent-runtime", origin), {
    method: "POST",
    headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({
      agent: voiceOptimizedAgent(agent),
      messages,
      runtimeSessionId: "queen-bee-voice",
      agentMode: "act",
      latencyMode: "voice",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(runtimeConversationTurnTimeoutMs(agent)),
  });
  return readRuntimeResponseText(response, onActivity, onTextDelta);
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
