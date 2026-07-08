/**
 * Queen Bee TYPED chat lane (the chat FAB / bottom hive input) — extracted
 * from src/app/api/queen-bee/voice/route.ts when the route crossed the
 * 1500-line ratchet (2026-07-06). Regular typed chat follows the queen
 * agent's OWN selected provider/model; the Calls-settings chat-brain override
 * applies only to voice/calls (resolveVoiceChatBrainPlan in the route). OAuth-
 * held selections such as OpenAI Codex route through the Queen agent runtime,
 * because that is where the credential actually lives.
 * Serves both chat-turn (buffered) and chat-turn-stream (NDJSON) actions;
 * the client tool loop lives in src/features/queen-voice/queen-chat-store.tsx.
 */
import { NextResponse } from "next/server";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import {
  hivemindosWalletPaidModelAgentSlug,
  isHivemindosWalletPaidModelProfile,
  selectedHivemindosWalletPaidModel,
} from "@/lib/services/hivemindos-wallet-paid-models";
import { readStoredAgentProfilesStrict } from "@/lib/services/agent-profile-store";
import { readRuntimeResponseText } from "@/lib/services/phone/runtime-voice-turn";
import { transcriptionApiKey } from "@/lib/services/phone/transcription";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  coerceDashboardScreenContext,
  formatDashboardScreenContextForPrompt,
} from "@/features/dashboard/screen-context";
import {
  applyOpenAiChatChunk,
  createQueenChatStreamState,
  createSseJsonParser,
  finalizeQueenChatStream,
} from "./chat-stream";
import { queenChatTools, queenInstructionsForPersonality } from "./queen-brain";
import { queenModelTransparencyNote } from "./model-transparency";
import { resolveProviderChatEndpoint } from "./voice-turn";
import { readQueenBeeBrainDefaults } from "./voice-settings";
import { queenVoicePreferencePreamble } from "./voice-preferences";

const QUEEN_CHAT_MODEL_FALLBACK = "gpt-4o-mini";

/** One answering brain the typed lane can call directly. */
type QueenTypedChatBrain = {
  kind: "openai-compatible" | "agent-runtime";
  url: string;
  /** Bearer key; empty when the brain authenticates via custom headers. */
  key: string;
  /** Extra request headers (wallet-paid gateway auth, internal self-fetch auth). */
  headers?: Record<string, string>;
  /** Full persisted Queen profile for runtime-held credentials such as OpenAI Codex. */
  agent?: AgentProfile;
  model: string;
  providerSlug: string;
  /** Per-turn overlay tag, e.g. "gpt-5.5 · venice". */
  label: string;
  /** True when this is the queen agent's own selected model. */
  configured: boolean;
  /** False when the endpoint answers only buffered JSON (no SSE). */
  streaming?: boolean;
  /** Per-brain budget; the wallet-paid gateway can cold-start its host. */
  timeoutMs?: number;
};

const RUNTIME_COMMAND_GATE_FALLBACK =
  "The selected Queen runtime hit its command-safety timeout before it produced a chat answer. I did not run any command.";

function queenBrainProviderLabel(provider: string) {
  if (provider === "openai-oauth") return "ChatGPT";
  if (provider === "openai-codex") return "OpenAI Codex";
  if (!provider || provider === "openai" || provider === "openai-api") return "OpenAI";
  return provider;
}

function isRuntimeHeldQueenProvider(provider: string) {
  return provider === "openai-oauth" || provider === "openai-codex";
}

async function readQueenBeeAgentProfile(agentId?: string): Promise<AgentProfile | null> {
  const profiles = await readStoredAgentProfilesStrict();
  return (
    (agentId ? profiles.find((profile) => profile.id === agentId) : undefined) ??
    profiles.find((profile) => profile.beeRole === "queen") ??
    profiles.find((profile) => /queen/i.test(profile.name ?? "")) ??
    null
  );
}

/**
 * The typed lane's answering brains, in preference order. REGULAR typed chat
 * follows the QUEEN AGENT'S OWN selected provider/model — the Calls-settings
 * chat-brain override applies only to voice/calls (resolveVoiceChatBrainPlan).
 * Serving classes: the HivemindOS-models gateway (custom wallet headers, the
 * upstream does native tool calls), runtime-held OAuth selections via the
 * Queen agent's own runtime, then plain key-based OpenAI-compatible providers.
 * The built-in OpenAI lane remains only as the declared final fallback.
 */
async function resolveQueenTypedChatBrains(origin: string): Promise<QueenTypedChatBrain[]> {
  const brains: QueenTypedChatBrain[] = [];
  const defaults = await readQueenBeeBrainDefaults().catch(() => null);
  const provider = defaults?.provider?.trim() || "";
  if (defaults?.model && isHivemindosWalletPaidModelProfile({ provider })) {
    const model = selectedHivemindosWalletPaidModel({ model: defaults.model });
    brains.push({
      kind: "openai-compatible",
      url: `${origin.replace(/\/+$/, "")}/api/hivemindos/models/chat/completions`,
      key: "",
      headers: {
        "X-HivemindOS-Wallet-Agent-Id": defaults.agentId || "free-tier",
        "X-HivemindOS-Wallet-Model-Slug": hivemindosWalletPaidModelAgentSlug(),
        // Self-fetch through the proxy auth gate.
        ...internalApiAuthHeaders(),
      },
      model,
      providerSlug: provider,
      label: `${model} · HivemindOS models`,
      configured: true,
      // The gateway buffers upstream responses (stream:false) and its free
      // host can cold-start, so: no SSE, generous budget.
      streaming: false,
      timeoutMs: 120_000,
    });
  } else if (defaults?.model && isRuntimeHeldQueenProvider(provider)) {
    const agent = await readQueenBeeAgentProfile(defaults.agentId).catch(() => null);
    if (agent) {
      brains.push({
        kind: "agent-runtime",
        url: `${origin.replace(/\/+$/, "")}/api/chat/agent-runtime`,
        key: "",
        headers: internalApiAuthHeaders(),
        agent,
        model: defaults.model,
        providerSlug: provider,
        label: `${defaults.model} · ${queenBrainProviderLabel(provider)}`,
        configured: true,
        timeoutMs: 120_000,
      });
    }
  } else if (defaults?.model) {
    const endpoint = await resolveProviderChatEndpoint(provider).catch(() => null);
    if (endpoint) {
      brains.push({
        kind: "openai-compatible",
        url: endpoint.url,
        key: endpoint.key,
        model: defaults.model,
        providerSlug: provider,
        label: `${defaults.model} · ${queenBrainProviderLabel(provider)}`,
        configured: true,
      });
    }
  }
  const apiKey = await transcriptionApiKey();
  const builtinModel = process.env.OPENAI_VOICE_CHAT_MODEL || QUEEN_CHAT_MODEL_FALLBACK;
  const duplicate = brains.some(
    (brain) => brain.model === builtinModel && brain.url.startsWith("https://api.openai.com/"),
  );
  if (apiKey && !duplicate) {
    brains.push({
      kind: "openai-compatible",
      url: "https://api.openai.com/v1/chat/completions",
      key: apiKey,
      model: builtinModel,
      providerSlug: "openai",
      label: `${builtinModel} · OpenAI`,
      configured: false,
    });
  }
  return brains;
}

function queenBrainRequestHeaders(brain: QueenTypedChatBrain): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(brain.key ? { Authorization: `Bearer ${brain.key}` } : {}),
    ...(brain.headers ?? {}),
  };
}

function runtimeMessagesFor(system: string, incoming: unknown[]) {
  const messages = incoming
    .filter((message): message is { role?: unknown; content?: unknown } => (
      Boolean(message) && typeof message === "object"
    ))
    .map((message) => ({
      role: typeof message.role === "string" && message.role.trim() ? message.role : "user",
      content: typeof message.content === "string" || Array.isArray(message.content)
        ? message.content
        : String(message.content ?? ""),
    }))
    .filter((message) => (
      typeof message.content === "string"
        ? Boolean(message.content.trim())
        : message.content.length > 0
    ));
  return [{ role: "system", content: system }, ...messages];
}

async function queenChatRuntimeRequest(
  brain: QueenTypedChatBrain,
  system: string,
  incoming: unknown[],
) {
  if (!brain.agent) throw new Error(`${brain.label} has no Queen runtime profile.`);
  const response = await fetchQueenChatRuntimeResponse(brain, system, incoming);
  const content = normalizeQueenRuntimeChatContent(await readRuntimeResponseText(response));
  if (!content.trim()) throw new Error(`${brain.label} returned an empty reply.`);
  return {
    content,
    toolCalls: [],
    assistant: { role: "assistant", content },
    brainLabel: brain.label,
  };
}

function queenChatRuntimeRequestBody(
  brain: QueenTypedChatBrain,
  system: string,
  incoming: unknown[],
) {
  if (!brain.agent) throw new Error(`${brain.label} has no Queen runtime profile.`);
  return {
    agent: brain.agent,
    messages: runtimeMessagesFor(system, incoming),
    runtimeSessionId: `queen-fab-${brain.agent.id || "runtime"}`,
    chatStorageKey: `queen-fab-${brain.agent.id || "runtime"}`,
    // Queen's typed client owns the allowed tool loop. Runtime-held OAuth
    // brains should answer/read, not enter command execution or money rails.
    agentMode: "plan",
    suppressWalletIntents: true,
  };
}

async function fetchQueenChatRuntimeResponse(
  brain: QueenTypedChatBrain,
  system: string,
  incoming: unknown[],
) {
  return fetch(brain.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(brain.headers ?? {}),
    },
    body: JSON.stringify(queenChatRuntimeRequestBody(brain, system, incoming)),
    cache: "no-store",
    signal: AbortSignal.timeout(brain.timeoutMs ?? 120_000),
  });
}

/** Scout (llama.cpp) leaks its chat-template tool-call tokens into plain
 *  content when it emits a call the serving grammar can't parse — the simple
 *  `<|tool_call>call:read_agent_status` + `{}` form on the forced-prose round,
 *  and a worse variant with a MULTI-LINE args block, `<|"|>` quote tokens, and
 *  a reversed `<tool_call|>` closer (both seen live 2026-07-06). Everything
 *  from the first tool-call marker onward is machine markup, never prose —
 *  cut it, then sweep stray template specials out of what remains. Callers
 *  fall back to previously-shown text / "Done." when nothing survives. */
/** Cheap gate: does this content contain a leaked tool-call marker at all? */
function contentHasLeakMarker(content: string): boolean {
  return content.includes("<|") || /<tool[_\s-]?call/i.test(content);
}

function stripLeakedToolCallMarkup(content: string): string {
  if (!contentHasLeakMarker(content)) return content;
  const marker = content.search(/<\|?tool[_\s-]?call/i);
  const kept = marker >= 0 ? content.slice(0, marker) : content;
  return kept
    .replace(/<\|[^<>]*\|?>/g, "\n") // leading-form specials: <|im_end|>, <|"|>, unbalanced <|foo>
    .replace(/<[^<>|]*\|>/g, "\n") // reversed/trailing-form specials: <foo|>
    .replace(/^\s*call:[\w.-]+\s*$/gim, "") // bare `call:tool_name` lines
    .replace(/^\s*\{.*\}\s*$/gm, "") // orphaned lone-line JSON args (only reached when a leak was detected)
    .trim();
}

function isRuntimeCommandGateReply(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim();
  return /\btimeout\b.{0,48}\bdenying command\b/i.test(normalized);
}

function isRuntimeCommandGatePrefix(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  const plain = normalized.replace(/^⏱\s*/, "");
  if (!normalized.startsWith("⏱") && plain.length < 4) return false;
  return "timeout - denying command".startsWith(plain.replace(/[—–]/g, "-"));
}

function normalizeQueenRuntimeChatContent(content: string): string {
  const scrubbed = stripLeakedToolCallMarkup(content);
  return isRuntimeCommandGateReply(scrubbed) ? RUNTIME_COMMAND_GATE_FALLBACK : scrubbed;
}

/** One buffered chat-completions call against one brain. Returns the terminal
 *  payload shape both chat-turn actions hand to the client, or throws. */
async function queenChatBlockingRequest(
  brain: QueenTypedChatBrain,
  system: string,
  incoming: unknown[],
  options?: { noTools?: boolean; suppressWalletIntents?: boolean },
) {
  if (brain.kind === "agent-runtime") return queenChatRuntimeRequest(brain, system, incoming);
  const response = await fetch(brain.url, {
    method: "POST",
    headers: queenBrainRequestHeaders(brain),
    body: JSON.stringify(queenChatRequestBody(brain, system, incoming, undefined, options)),
    cache: "no-store",
    signal: AbortSignal.timeout(brain.timeoutMs ?? 20_000),
  });
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(detail || `chat turn HTTP ${response.status}`);
  }
  const message = data?.choices?.[0]?.message ?? {};
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((tc) => tc?.function?.name)
        .map((tc) => ({
          id: String(tc.id ?? ""),
          name: String(tc.function?.name ?? ""),
          arguments: String(tc.function?.arguments ?? "{}"),
        }))
    : [];
  const content = stripLeakedToolCallMarkup(typeof message.content === "string" ? message.content : "");
  return {
    content,
    toolCalls,
    // The assistant message is fed back into the conversation history by the
    // client tool loop — scrub its content too, or leaked markup teaches the
    // model to emit more of it on every following round.
    assistant: { ...message, content },
    brainLabel: brain.label,
  };
}

function queenChatRuntimeStreamResponse(input: {
  response: Response;
  brain: QueenTypedChatBrain;
  brainFallback?: { label: string; error: string };
  incoming: unknown[];
  startedAt: number;
  line: (value: unknown) => string;
  ndjson: HeadersInit;
}) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let liveContent = "";
      let sawRuntimeCommandGate = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(input.line(value)));
      };
      const sendRuntimeCommandGateFallback = () => {
        recordQueenChatTelemetry({
          action: "chat-turn-stream",
          ok: true,
          buffered: false,
          runtimeStream: true,
          runtimeCommandGate: true,
          brainLabel: input.brain.label,
          configuredBrain: input.brain.configured,
          toolCallCount: 0,
          contentChars: RUNTIME_COMMAND_GATE_FALLBACK.length,
          skippedBrain: input.brainFallback?.label ?? null,
          skippedError: input.brainFallback?.error ?? null,
          messageCount: input.incoming.length,
          elapsedMs: Date.now() - input.startedAt,
        });
        send({
          done: true,
          ok: true,
          content: RUNTIME_COMMAND_GATE_FALLBACK,
          toolCalls: [],
          assistant: { role: "assistant", content: RUNTIME_COMMAND_GATE_FALLBACK },
          brainLabel: input.brain.label,
          ...(input.brainFallback ? { brainFallback: input.brainFallback } : {}),
        });
      };
      try {
        send({
          status: "runtime-stream-started",
          brainLabel: input.brain.label,
        });
        heartbeat = setInterval(() => {
          try {
            send({ status: "runtime-stream-heartbeat", brainLabel: input.brain.label });
          } catch {
            if (heartbeat) clearInterval(heartbeat);
          }
        }, 15_000);
        const rawContent = await readRuntimeResponseText(
          input.response,
          undefined,
          (delta) => {
            if (!delta) return;
            liveContent += delta;
            if (isRuntimeCommandGateReply(liveContent)) {
              sawRuntimeCommandGate = true;
              return;
            }
            if (isRuntimeCommandGatePrefix(liveContent)) return;
            if (!contentHasLeakMarker(liveContent)) {
              send({ delta });
            }
          },
        );
        if (isRuntimeCommandGateReply(rawContent)) {
          sendRuntimeCommandGateFallback();
          return;
        }
        const content = normalizeQueenRuntimeChatContent(rawContent);
        if (!content.trim()) throw new Error(`${input.brain.label} returned an empty reply.`);
        recordQueenChatTelemetry({
          action: "chat-turn-stream",
          ok: true,
          buffered: false,
          runtimeStream: true,
          brainLabel: input.brain.label,
          configuredBrain: input.brain.configured,
          toolCallCount: 0,
          contentChars: content.length,
          skippedBrain: input.brainFallback?.label ?? null,
          skippedError: input.brainFallback?.error ?? null,
          messageCount: input.incoming.length,
          elapsedMs: Date.now() - input.startedAt,
        });
        send({
          done: true,
          ok: true,
          content,
          toolCalls: [],
          assistant: { role: "assistant", content },
          brainLabel: input.brain.label,
          ...(input.brainFallback ? { brainFallback: input.brainFallback } : {}),
        });
      } catch (error) {
        if (sawRuntimeCommandGate) {
          sendRuntimeCommandGateFallback();
          return;
        }
        recordQueenChatTelemetry({
          action: "chat-turn-stream",
          ok: false,
          runtimeStream: true,
          error: error instanceof Error ? error.message : "chat stream failed",
          brainLabel: input.brain.label,
          messageCount: input.incoming.length,
          elapsedMs: Date.now() - input.startedAt,
        });
        send({
          ok: false,
          fallback: true,
          error: error instanceof Error ? error.message : "chat stream failed",
        });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: input.ndjson });
}

/** Typed-lane telemetry (~/.hivemindos/telemetry/events.jsonl). The typed chat
 *  loop previously recorded NOTHING — tool-loop misbehavior (2026-07-06 Scout
 *  replace/blank reports) was invisible to "check the telemetry". */
function recordQueenChatTelemetry(payload: Record<string, unknown>) {
  void recordTelemetryBatch([
    { source: "route", type: "queen_chat.turn", payload },
  ]).catch(() => undefined);
}

/** Chat-completions body for one brain. Reasoning-era OpenAI models reject
 *  max_tokens/temperature (see runProviderConversationTurn in voice-turn.ts). */
function queenChatRequestBody(
  brain: QueenTypedChatBrain,
  system: string,
  incoming: unknown[],
  extra?: Record<string, unknown>,
  options?: { noTools?: boolean },
) {
  const reasoningModel = /^(o\d|gpt-5|codex)/i.test(brain.model.trim());
  return {
    model: brain.model,
    messages: [
      { role: "system", content: system },
      ...incoming,
      // Omitting the tools is not enough on its own: Scout still tries to
      // call one and its template tokens leak into the text. Say it outright.
      ...(options?.noTools
        ? [{
            role: "system",
            // Neutral wording so it reads correctly BOTH when the tool budget
            // was spent (summarize findings) AND on a bare greeting where
            // nothing was done yet (just reply). "summarizing what you did"
            // made greetings fabricate work.
            content:
              "Tool calling is disabled for this reply. Answer the user directly in plain language, using only what you already know from this conversation. Do not emit any tool-call syntax.",
          }]
        : []),
    ],
    // noTools = the client tool loop spent its budget and needs a FINAL text
    // answer: omit the tools entirely so tool-happy brains (Scout looped
    // read_work_board four rounds straight on 2026-07-06) must reply in prose.
    ...(options?.noTools ? {} : { tools: queenChatTools(), tool_choice: "auto" }),
    ...(reasoningModel
      ? { max_completion_tokens: 700, reasoning_effort: "low" }
      : { temperature: 0.4, max_tokens: 500 }),
    ...extra,
  };
}

/** Shared setup for the typed chat turn (blocking and streaming variants). */
async function prepareQueenChatTurn(body: Record<string, unknown>, origin: string) {
  const brains = await resolveQueenTypedChatBrains(origin);
  if (!brains.length) return null;
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const suppressWalletIntents = body.suppressWalletIntents === true;
  const defaults = await readQueenBeeBrainDefaults().catch(() => null);
  const preamble = await queenVoicePreferencePreamble();
  const screenContext = formatDashboardScreenContextForPrompt(
    coerceDashboardScreenContext(body.screenContext),
  );
  const screenContextPrompt = screenContext
    ? [
        "The user typed this from the global bottom-of-screen hive input.",
        "Use the current dashboard context below to resolve references like this screen, this view, this section, current modal, selected task, selected agent, or selected wallet. Do not mention this context unless it helps answer or act.",
        "If an acting wallet is listed below, treat it as the default wallet for any wallet, payment, trading, or fee request (send, swap, trade, buy/sell stock, collect fees, check balance) unless the user names a different one. For those actions, call ask_hivemind_agent so the capable HivemindOS agent runs them against that acting wallet.",
        screenContext,
      ].join("\n")
    : "";
  // Each brain gets its OWN transparency note naming the model this request is
  // about to invoke — this is what lets her answer "which LLM?" honestly.
  const systemFor = (brain: QueenTypedChatBrain) =>
    [
      queenInstructionsForPersonality(defaults?.soulPrompt),
      queenModelTransparencyNote(
        brain.model,
        `${queenBrainProviderLabel(brain.providerSlug)} (Queen Bee's typed chat brain)`,
        { relayTool: true },
      ),
      preamble,
      screenContextPrompt,
    ]
      .filter(Boolean)
      .join(" ");
  return { brains, incoming, systemFor, suppressWalletIntents };
}

export async function runQueenChatTurn(body: Record<string, unknown>, origin: string) {
  const prepared = await prepareQueenChatTurn(body, origin);
  if (!prepared) {
    return NextResponse.json({ ok: false, fallback: true, error: "no-openai-key" });
  }
  const { brains, incoming, systemFor, suppressWalletIntents } = prepared;
  // toolChoice:"none" = the client tool loop's budget is spent; force prose.
  const noTools = body.toolChoice === "none";
  // The agent's own brain first, built-in OpenAI lane last — a failing
  // configured brain degrades to the built-in lane instead of dead-ending the
  // turn, `brainLabel` always names the brain that actually answered, and any
  // skipped configured brain is DECLARED via brainFallback (never silent).
  let lastError = "";
  const startedAt = Date.now();
  const skipped: Array<{ label: string; error: string }> = [];
  for (const brain of brains) {
    try {
      const result = await queenChatBlockingRequest(brain, systemFor(brain), incoming, { noTools, suppressWalletIntents });
      recordQueenChatTelemetry({
        action: "chat-turn",
        ok: true,
        brainLabel: brain.label,
        configuredBrain: brain.configured,
        toolCallCount: result.toolCalls.length,
        contentChars: result.content.length,
        skippedBrain: skipped[0]?.label ?? null,
        skippedError: skipped[0]?.error ?? null,
        messageCount: incoming.length,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        ok: true,
        ...result,
        ...(skipped.length ? { brainFallback: skipped[0] } : {}),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "chat turn failed";
      skipped.push({ label: brain.label, error: lastError });
    }
  }
  recordQueenChatTelemetry({
    action: "chat-turn",
    ok: false,
    error: lastError || "chat turn failed",
    skippedBrains: skipped.map((entry) => entry.label),
    messageCount: incoming.length,
    elapsedMs: Date.now() - startedAt,
  });
  return NextResponse.json({ ok: false, fallback: true, error: lastError || "chat turn failed" });
}

/**
 * Streaming variant of chat-turn: NDJSON lines — `{delta}` per content token
 * so the reply renders as it is written, then one terminal `{done, content,
 * toolCalls, assistant}` in the exact non-streaming shape (the client tool
 * loop is identical either way). Errors emit `{ok:false, fallback:true}` so
 * the client can retry via the blocking action.
 */
export async function runQueenChatTurnStream(body: Record<string, unknown>, origin: string) {
  const prepared = await prepareQueenChatTurn(body, origin);
  const ndjson = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;
  if (!prepared) {
    return new Response(line({ ok: false, fallback: true, error: "no-openai-key" }), { headers: ndjson });
  }
  const { brains, incoming, systemFor, suppressWalletIntents } = prepared;
  // Try brains in order for the INITIAL connection (the agent's own brain,
  // then the built-in OpenAI lane). Buffered-only brains (the HivemindOS
  // models gateway) answer as one terminal frame — the client tool loop is
  // identical, the reply just lands at once instead of token-by-token. Once
  // an SSE stream has started, mid-stream failures keep the existing
  // partial-result + fallback signaling.
  // toolChoice:"none" = the client tool loop's budget is spent; force prose.
  const noTools = body.toolChoice === "none";
  let upstream: Response | Error = new Error("no chat brain available");
  let answeringBrain = brains[0];
  let lastError = "";
  const startedAt = Date.now();
  const skipped: Array<{ label: string; error: string }> = [];
  for (const brain of brains) {
    if (brain.kind === "agent-runtime") {
      const runtimeResponse = await fetchQueenChatRuntimeResponse(
        brain,
        systemFor(brain),
        incoming,
      ).catch((error: unknown) => error as Error);
      if (!(runtimeResponse instanceof Error) && runtimeResponse.ok && runtimeResponse.body) {
        return queenChatRuntimeStreamResponse({
          response: runtimeResponse,
          brain,
          brainFallback: skipped[0],
          incoming,
          startedAt,
          line,
          ndjson,
        });
      }
      if (runtimeResponse instanceof Error) {
        lastError = runtimeResponse.message;
      } else {
        try {
          const text = await readRuntimeResponseText(runtimeResponse);
          lastError = text.trim() || `chat turn HTTP ${runtimeResponse.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : `chat turn HTTP ${runtimeResponse.status}`;
        }
      }
      skipped.push({ label: brain.label, error: lastError || "chat turn failed" });
      continue;
    }
    if (brain.streaming === false) {
      try {
        const result = await queenChatBlockingRequest(brain, systemFor(brain), incoming, { noTools, suppressWalletIntents });
        recordQueenChatTelemetry({
          action: "chat-turn-stream",
          ok: true,
          buffered: true,
          brainLabel: brain.label,
          configuredBrain: brain.configured,
          toolCallCount: result.toolCalls.length,
          contentChars: result.content.length,
          skippedBrain: skipped[0]?.label ?? null,
          skippedError: skipped[0]?.error ?? null,
          messageCount: incoming.length,
          elapsedMs: Date.now() - startedAt,
        });
        return new Response(
          line({
            done: true,
            ok: true,
            ...result,
            ...(skipped.length ? { brainFallback: skipped[0] } : {}),
          }),
          { headers: ndjson },
        );
      } catch (error) {
        lastError = error instanceof Error ? error.message : "chat turn failed";
        skipped.push({ label: brain.label, error: lastError });
        continue;
      }
    }
    answeringBrain = brain;
    upstream = await fetch(brain.url, {
      method: "POST",
      headers: queenBrainRequestHeaders(brain),
      body: JSON.stringify(
        queenChatRequestBody(brain, systemFor(brain), incoming, { stream: true }, { noTools }),
      ),
      cache: "no-store",
      // Generous vs the blocking action's 20s: this bounds the WHOLE stream, and
      // first tokens arrive within seconds so the user is never staring at it.
      signal: AbortSignal.timeout(Math.max(90_000, brain.timeoutMs ?? 0)),
    }).catch((error: unknown) => error as Error);
    if (!(upstream instanceof Error) && upstream.ok && upstream.body) break;
    skipped.push({
      label: brain.label,
      error: upstream instanceof Error ? upstream.message : `chat turn HTTP ${upstream.status}`,
    });
  }
  if (upstream instanceof Error || !upstream.ok || !upstream.body) {
    const detail = upstream instanceof Error
      ? upstream.message
      : lastError || `chat turn HTTP ${(upstream as Response | undefined)?.status ?? "?"}`;
    recordQueenChatTelemetry({
      action: "chat-turn-stream",
      ok: false,
      error: detail,
      skippedBrains: skipped.map((entry) => entry.label),
      messageCount: incoming.length,
      elapsedMs: Date.now() - startedAt,
    });
    return new Response(line({ ok: false, fallback: true, error: detail }), { headers: ndjson });
  }
  const brainLabel = answeringBrain?.label ?? "";
  const brainFallback = skipped.length ? skipped[0] : undefined;
  const configuredBrain = answeringBrain?.configured ?? false;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const state = createQueenChatStreamState();
      const feed = createSseJsonParser();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { done: sseDone, chunks } = feed(decoder.decode(value, { stream: true }));
          for (const chunk of chunks) {
            const delta = applyOpenAiChatChunk(state, chunk);
            // Stop forwarding live deltas the moment leaked tool-call markup
            // appears in the accumulated content — the clean prose before it is
            // already on screen, and the scrubbed final frame (below) replaces
            // it. Without this, a streaming brain that leaks would flash raw
            // <|tool_call|> tokens in the bubble mid-stream. (Scout uses the
            // buffered/blocking path, but catalog/OpenAI lanes stream.)
            if (delta && !contentHasLeakMarker(state.content)) {
              controller.enqueue(encoder.encode(line({ delta })));
            }
          }
          if (sseDone) break;
        }
        const finalized = finalizeQueenChatStream(state);
        // The streaming finalize returns RAW state.content — mirror the
        // blocking path's scrub so a leaked marker never reaches the client.
        const scrubbedContent = stripLeakedToolCallMarkup(
          typeof finalized.content === "string" ? finalized.content : "",
        );
        finalized.content = scrubbedContent;
        if (finalized.assistant && typeof finalized.assistant === "object") {
          finalized.assistant.content = scrubbedContent || null;
        }
        recordQueenChatTelemetry({
          action: "chat-turn-stream",
          ok: true,
          buffered: false,
          brainLabel,
          configuredBrain,
          toolCallCount: Array.isArray(finalized.toolCalls) ? finalized.toolCalls.length : 0,
          contentChars: typeof finalized.content === "string" ? finalized.content.length : 0,
          skippedBrain: brainFallback?.label ?? null,
          skippedError: brainFallback?.error ?? null,
          messageCount: incoming.length,
          elapsedMs: Date.now() - startedAt,
        });
        controller.enqueue(encoder.encode(line({
          done: true,
          ok: true,
          brainLabel,
          ...(brainFallback ? { brainFallback } : {}),
          ...finalized,
        })));
      } catch (error) {
        // Mid-stream failure: surface whatever already streamed so the client
        // can keep it, but flag the turn incomplete for the fallback path.
        controller.enqueue(encoder.encode(line({
          ok: false,
          fallback: true,
          error: error instanceof Error ? error.message : "chat stream failed",
        })));
      } finally {
        controller.close();
        reader.cancel().catch(() => undefined);
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });
  return new Response(stream, { headers: ndjson });
}
