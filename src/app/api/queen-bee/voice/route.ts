import { appendFile, mkdir } from "fs/promises";
import * as net from "net";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import {
  coerceActingWalletSource,
  runQueenBeeAgentTurn,
  runQueenBeeVoiceTurn,
  submitQueenBeeVoiceTask,
  type QueenVoiceHistoryTurn,
  type VoiceChatBrainPlan,
} from "@/lib/services/queen-bee/voice-turn";
import {
  QUEEN_BEE_REALTIME_VOICES,
  readQueenBeeBrainDefaults,
  readQueenBeeCallPreferences,
  readQueenBeeVoice,
  ttsVoiceFor,
  writeQueenBeeVoice,
} from "@/lib/services/queen-bee/voice-settings";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { openAiOAuthSupportsChatModel } from "@/lib/config/openai-provider-routing";
import { openAiOAuthConfigured, preferOpenAiApiKey } from "@/lib/services/openai-oauth";
import { isXaiOAuthProvider } from "@/lib/services/xai-oauth-inference-contract";
import {
  LOCAL_TTS_RUNTIME,
  isLocalTtsProviderId,
  resolveLocalTtsCallConfig,
  streamLocalTtsPcm,
  synthesizeLocalTtsWav,
} from "@/lib/services/phone/local-tts";
import { pcm16ToWav } from "@/lib/services/phone/pcm-wav";
import {
  localTtsBreakerState,
  prewarmLocalTts,
} from "@/lib/services/phone/local-tts-health";
import { warmHiveDailyReport } from "@/lib/services/company-daily-report";
import {
  beginVoiceTurnProgress,
  finishVoiceTurnProgress,
  markVoiceTurnStage,
  normalizeVoiceTurnId,
  readVoiceTurnProgress,
} from "@/lib/services/queen-bee/voice-turn-progress";
import type { AgentCallPreferences } from "@/lib/types/agent-runtime";
import {
  addQueenBeeVoicePreference,
  queenVoicePreferencePreamble,
} from "@/lib/services/queen-bee/voice-preferences";
import {
  transcribeAudioWithWhisper,
  transcriptionApiKey,
} from "@/lib/services/phone/transcription";
import {
  QUEEN_VOICE_STYLE,
  queenInstructionsForPersonality,
  queenRealtimeTools,
} from "@/lib/services/queen-bee/queen-brain";
import { runXAccountReadTool } from "@/lib/services/x-latest-post";
import { coerceXAccountReadToolInput } from "@/lib/services/x-account-tool-contract";
import { queenModelTransparencyNote } from "@/lib/services/queen-bee/model-transparency";
import {
  runQueenChatTurn,
  runQueenChatTurnStream,
} from "@/lib/services/queen-bee/typed-chat-turn";
import {
  mintGeminiLiveToken,
  normalizeGeminiLiveModel,
  synthesizeVoicePreview,
  transcribeElevenLabsAudio,
} from "@/lib/services/phone/cloud-voice-transports";
import {
  inputTranscriptionForVoiceRuntime,
  resolveVoiceRuntime,
} from "@/lib/config/voice-call-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Some networks' TCP handshake to OpenAI exceeds Node's default 250ms
// happy-eyeballs (autoSelectFamily) attempt window, so server-side fetches fail
// with ETIMEDOUT even though the host is reachable. Widen the attempt timeout.
try {
  (net as unknown as { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void })
    .setDefaultAutoSelectFamilyAttemptTimeout?.(3000);
} catch {
  // older Node without the helper — nothing to do
}

const VOICE_TURN_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 30_000;
// Streamed replies play as they arrive, so the request can outlive the buffered
// timeout — bound it generously to the longest spoken reply.
const STREAM_SPEAK_TIMEOUT_MS = 90_000;
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const GEMINI_LIVE_RUNTIME = "gemini-live";

// Voice modality = the one shared Queen brain + a spoken-style addendum.
function queenRealtimeInstructionsForPersonality(personality?: string | null) {
  return `${queenInstructionsForPersonality(personality)}${QUEEN_VOICE_STYLE}`;
}

const QUEEN_REALTIME_TOOLS = queenRealtimeTools();

/**
 * Voice front door for the Queen Bee control plane.
 *
 * - multipart POST (action "voice-turn"): an audio utterance is transcribed
 *   with the shared Whisper STT helpers, submitted to Queen Bee, and answered
 *   with both the transcript and the spoken-ready receipt summary.
 * - JSON POST (action "speak"): streams TTS audio for the given text so the
 *   overlay can voice Queen Bee replies. Returns 503 when no OpenAI voice key
 *   is configured so the client can fall back to on-device speech synthesis.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return await runVoiceTurn(request);
    }
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (body.action === "speak-stream") {
      return await streamSpokenReplyPcm(request, body);
    }
    if (body.action === "speak") {
      return await streamSpokenReply(request, body);
    }
    if (body.action === "speak-prewarm") {
      return await prewarmSpokenReplyEngine(request);
    }
    if (body.action === "speak-metrics") {
      return await recordSpeakPlaybackMetrics(body);
    }
    if (body.action === "converse") {
      return await runConversationTurn(request, body);
    }
    if (body.action === "converse-stream") {
      return await runConversationTurnStream(request, body);
    }
    if (body.action === "turn-progress") {
      return NextResponse.json({
        ok: true,
        ...readVoiceTurnProgress(normalizeVoiceTurnId(body.turnId)),
      });
    }
    if (body.action === "realtime-session") {
      return await mintRealtimeSession();
    }
    if (body.action === "gemini-live-session") {
      return await mintQueenGeminiLiveSession();
    }
    if (body.action === "submit-task") {
      return await submitRealtimeTask(request, body);
    }
    if (body.action === "agent-turn") {
      const result = await runQueenBeeAgentTurn(
        request.nextUrl.origin,
        String(body.message ?? ""),
        coerceActingWalletSource(body.actingWallet),
        {
          suppressWalletIntents: body.suppressWalletIntents === true,
          preferBuiltInCapability: body.preferBuiltInCapability === true,
        },
      );
      return NextResponse.json({
        ok: true,
        text: result.speech,
        detail: result.detail,
      });
    }
    if (body.action === "set-voice") {
      const voice = await writeQueenBeeVoice(String(body.voice ?? ""));
      return NextResponse.json({ ok: true, voice });
    }
    if (body.action === "remember-preference") {
      const preference =
        typeof body.preference === "string" ? body.preference.trim() : "";
      if (!preference) throw new Error("A preference is required.");
      const preferences = await addQueenBeeVoicePreference(preference);
      return NextResponse.json({ ok: true, preferences });
    }
    if (body.action === "read-x-account") {
      const result = await runXAccountReadTool(coerceXAccountReadToolInput(body));
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === "chat-turn") {
      return await runQueenChatTurn(body, request.nextUrl.origin);
    }
    if (body.action === "chat-turn-stream") {
      return await runQueenChatTurnStream(body, request.nextUrl.origin);
    }
    throw new Error(
      `Unknown Queen Bee voice action: ${String(body.action ?? "")}`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Queen Bee voice request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// Which brain answers a pipeline voice turn, from the Queen's Calls prefs
// (`voiceChatBrain`): explicit voice override > the Queen agent's own
// selected provider/model (the default — voice speaks with the model you
// picked for the agent) > the legacy ranked fleet-agent lane. Older persisted
// `fleet-agent` rows did not record whether the user actually chose that lane,
// so only an explicit new fleet selection can override the Queen's model.
async function resolveVoiceChatBrainPlan(): Promise<VoiceChatBrainPlan> {
  const calls = await readQueenBeeCallPreferences().catch(() => null);
  const pref = calls?.voiceChatBrain;
  const explicitFleetAgent = pref?.source === "fleet-agent" && pref.explicit === true;
  if (explicitFleetAgent) return { kind: "fleet-agent" };
  if (pref?.source === "custom" && pref.model) {
    const provider = pref.provider || "openai-api";
    return {
      kind: "direct",
      provider,
      model: pref.model,
      label: `${provider} / ${pref.model} (voice override)`,
      statusAgent: {
        id: "queen-voice-custom-brain",
        name: `Voice override (${provider} / ${pref.model})`,
        provider,
        model: pref.model,
      },
    };
  }
  const defaults = await readQueenBeeBrainDefaults().catch(() => null);
  if (defaults?.model) {
    const provider = defaults.provider || "openai-api";
    // ChatGPT OAuth (the user's subscription credentials, connected in-app
    // and fleet-shared via the hive env) is PREFERRED wherever it can serve
    // the model: it IS the credential behind openai-codex agents, and for
    // key-based OpenAI selections it wins over OPENAI_API_KEY unless the
    // user set OPENAI_PREFER_API_KEY. The ChatGPT backend only serves the
    // codex-era model families (gpt-5*/o*/codex*), so others stay key-based.
    const oauthReady =
      (await openAiOAuthConfigured().catch(() => false)) &&
      !(await preferOpenAiApiKey().catch(() => false));
    const oauthServable = openAiOAuthSupportsChatModel(defaults.model);
    const openAiFamily =
      provider === "openai" || provider === "openai-api" || provider === "openai-codex";
    if (oauthReady && oauthServable && openAiFamily) {
      return {
        kind: "direct",
        provider: "openai-oauth",
        model: defaults.model,
        label: `${defaults.agentName || "the agent"}'s model (${defaults.model} via ChatGPT OAuth)`,
        statusAgent: {
          id: defaults.agentId,
          name: defaults.agentName,
          provider: "openai-oauth",
          model: defaults.model,
        },
      };
    }
    // Direct-callable = the server holds the SAME credential the agent uses
    // (a key-based catalog provider read from the shared hive env). OAuth-held
    // providers (openai-codex, copilot) keep the turn inside the
    // agent's own runtime — never a silent credential substitution.
    const directCallable =
      provider === "openai" ||
      provider === "openai-api" ||
      isXaiOAuthProvider(provider) ||
      (() => {
        const entry = providerCatalogEntry(provider);
        return Boolean(entry?.baseUrl && entry.keyEnv);
      })();
    if (!directCallable) {
      return {
        kind: "agent-runtime",
        agentId: defaults.agentId,
        label: `${defaults.agentName || "the agent"} (${provider} / ${defaults.model} via its runtime)`,
      };
    }
    return {
      kind: "direct",
      provider,
      model: defaults.model,
      label: `${defaults.agentName || "the agent"}'s model (${provider} / ${defaults.model})`,
      statusAgent: {
        id: defaults.agentId,
        name: defaults.agentName,
        provider,
        model: defaults.model,
      },
    };
  }
  return { kind: "fleet-agent" };
}

// Voice settings for the overlay's picker. `pipelineSelected` routes the
// overlay to the non-realtime pipeline (STT → chat model → TTS) for BOTH the
// local-TTS and cloud-TTS voice runtimes; `localTtsSelected` additionally
// marks that the spoken voice is a local one (voice-continuity semantics).
export async function GET() {
  try {
    // A prefs-store outage must never read as "no local voice selected": with
    // no stored prefs, "realtime" (a cloud voice) is the legitimate default,
    // but an UNREADABLE store means the user may have selected a local voice
    // we can't see. Route the outage to the pipeline, whose per-turn speak
    // paths re-check the store and report a voiceUnavailable outage instead
    // of substituting a different voice.
    let calls: AgentCallPreferences | null = null;
    let callPrefsUnavailable = false;
    try {
      calls = await readQueenBeeCallPreferences();
    } catch {
      callPrefsUnavailable = true;
    }
    const localTtsSelected = Boolean(
      calls &&
        (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
          isLocalTtsProviderId(calls.voiceProviderId)),
    );
    const resolvedCallVoice = calls ? resolveVoiceRuntime(calls.voiceRuntime) : null;
    const cloudTtsSelected = resolvedCallVoice?.kind === "cloud-tts";
    const inputTranscription = inputTranscriptionForVoiceRuntime(calls?.voiceRuntime);
    // Subtle overlay tag naming which brain answers spoken turns; the label
    // formats are authored by resolveVoiceChatBrainPlan above. Best-effort:
    // a resolver failure costs the tag, never the settings payload.
    const plan = await resolveVoiceChatBrainPlan().catch((planError) => {
      console.warn(
        "[queen-voice] brain plan resolution failed:",
        planError instanceof Error ? planError.message : planError,
      );
      return null;
    });
    const geminiLiveSelected = calls?.voiceRuntime === GEMINI_LIVE_RUNTIME;
    const brainLabel = geminiLiveSelected
      ? `Gemini Live · ${calls?.voiceId || "default"}`
      : !plan
      ? null
      : plan.kind === "direct"
        ? `${plan.model} · ${
            plan.provider === "openai-oauth"
              ? "ChatGPT"
              : plan.provider === "openai-api" || plan.provider === "openai"
                ? "OpenAI"
                : plan.provider
          }`
        : plan.kind === "agent-runtime"
          ? plan.label.split(" (")[0]
          : "auto";
    return NextResponse.json({
      ok: true,
      voice: await readQueenBeeVoice(),
      voices: QUEEN_BEE_REALTIME_VOICES,
      callVoiceRuntime: calls?.voiceRuntime ?? null,
      callVoiceProviderId: calls?.voiceProviderId ?? null,
      callVoiceModelId: calls?.voiceModelId ?? null,
      callVoiceId: calls?.voiceId ?? null,
      localTtsSelected,
      callPrefsUnavailable,
      voiceMode: callPrefsUnavailable
        ? "pipeline"
        : geminiLiveSelected
        ? "gemini-live"
        : localTtsSelected || cloudTtsSelected
          ? "pipeline"
          : "realtime",
      pipelineSelected: callPrefsUnavailable || localTtsSelected || cloudTtsSelected,
      inputTranscriptionMode: inputTranscription?.mode ?? "realtime",
      inputTranscriptionProvider: inputTranscription?.providerId ?? "openai",
      brainLabel,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Queen Bee voice settings failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// Mints a short-lived client secret for a Queen Bee speech-to-speech session
// (OpenAI Realtime). The overlay connects via WebRTC and applies the returned
// instructions/tools over the data channel.
async function mintRealtimeSession() {
  const calls = await readQueenBeeCallPreferences().catch(() => null);
  const voice = await readQueenBeeVoice();
  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const defaults = await readQueenBeeBrainDefaults().catch(() => null);
  // Splice any standing user preferences ("call me boss") onto the base
  // instructions so every new session opens already knowing them.
  const preferencePreamble = await queenVoicePreferencePreamble();
  const instructions = [
    queenRealtimeInstructionsForPersonality(defaults?.soulPrompt),
    queenModelTransparencyNote(model, "OpenAI Realtime (Queen Bee's voice brain)", {
      relayTool: true,
    }),
    preferencePreamble,
  ]
    .filter(Boolean)
    .join(" ");
  if (calls?.voiceAuthMode === "oauth") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ChatGPT OAuth powers Voice inside ChatGPT, but HivemindOS currently holds the Codex OAuth grant, which OpenAI rejects on ChatGPT's private Voice WebRTC route. Select API key or Local TTS for Queen Bee voice.",
      },
      { status: 409 },
    );
  }
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Realtime speech requires an OpenAI Platform voice key in the shared env. You can also choose Local TTS in Calls settings.",
      },
      { status: 503 },
    );
  }
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model,
          instructions,
          audio: { output: { voice } },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const data = (await response.json().catch(() => null)) as {
    value?: unknown;
    client_secret?: { value?: unknown };
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const detail =
      typeof data?.error === "string" ? data.error : data?.error?.message;
    return NextResponse.json(
      {
        ok: false,
        error:
          detail || `Realtime session mint returned HTTP ${response.status}.`,
      },
      { status: 502 },
    );
  }
  const clientSecret =
    typeof data?.value === "string"
      ? data.value
      : typeof data?.client_secret?.value === "string"
        ? data.client_secret.value
        : "";
  if (!clientSecret) {
    return NextResponse.json(
      { ok: false, error: "Realtime session mint returned no client secret." },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    clientSecret,
    model,
    voice,
    instructions,
    tools: QUEEN_REALTIME_TOOLS,
  });
}

// Gemini Live sibling of `mintRealtimeSession`: when Calls settings select
// Gemini/Puck, the overlay must use the Gemini Live token + bidi WebSocket path
// instead of silently starting the OpenAI Realtime WebRTC path.
async function mintQueenGeminiLiveSession() {
  const calls = await readQueenBeeCallPreferences();
  if (calls?.voiceRuntime !== GEMINI_LIVE_RUNTIME) {
    return NextResponse.json(
      {
        ok: false,
        error: "Queen Bee is not configured for Gemini Live.",
      },
      { status: 409 },
    );
  }
  const model = normalizeGeminiLiveModel(calls.voiceModelId);
  const voice = calls.voiceId?.trim() || undefined;
  const defaults = await readQueenBeeBrainDefaults().catch(() => null);
  const preferencePreamble = await queenVoicePreferencePreamble();
  const instructions = [
    queenRealtimeInstructionsForPersonality(defaults?.soulPrompt),
    queenModelTransparencyNote(model, "Gemini Live (Queen Bee's voice brain)", {
      relayTool: true,
    }),
    preferencePreamble,
  ]
    .filter(Boolean)
    .join(" ");
  const minted = await mintGeminiLiveToken({
    model,
    voice,
    instructions,
    keyEnv: calls.voiceKeyEnv,
  });
  await appendVoiceTurnTelemetry({
    ok: true,
    stage: "gemini-live-session",
    engine: "gemini-live",
    model: minted.model,
    voice: minted.voice ?? voice ?? null,
  });
  return NextResponse.json({
    ok: true,
    ...minted,
    instructions,
    tools: QUEEN_REALTIME_TOOLS,
  });
}

// The TYPED chat lane (chat-turn / chat-turn-stream) lives in
// @/lib/services/queen-bee/typed-chat-turn — extracted at the 1500-line ratchet.

// Tool endpoint for the realtime session's create_hive_task function call.
async function submitRealtimeTask(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("A task message is required.");
  const submitted = await submitQueenBeeVoiceTask(
    {
      fleetSnapshot: () =>
        discoverQueenBeeFleetSnapshot(
          request.nextUrl.origin,
          request.headers.get("x-hivemindos-device-token"),
        ),
    },
    {
      title: typeof body.title === "string" ? body.title.trim() : "",
      message,
    },
  );
  await appendVoiceTurnTelemetry({
    ok: true,
    stage: "realtime-task",
    createdTask: Boolean(submitted.taskId && submitted.created),
  });
  return NextResponse.json({
    ok: true,
    summary: submitted.summary,
    taskId: submitted.taskId,
    taskTitle: submitted.taskTitle,
    created: submitted.created,
  });
}

// JSON step two of a voice turn: the client already has the transcript on
// screen; this resolves the conversational reply (and any delegated task).
async function runConversationTurn(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const startedAt = Date.now();
  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) throw new Error("A transcript is required.");
  const bodyText = (key: string) => {
    const value = body[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const marks: Record<string, number> = {};
  // Optional live progress (overlay working chips): the client polls
  // `turn-progress` with the same id while this request runs.
  const turnId = normalizeVoiceTurnId(body.turnId);
  if (turnId) beginVoiceTurnProgress(turnId);
  try {
    const result = await runQueenBeeVoiceTurn({
      origin: request.nextUrl.origin,
      transcript,
      history: historyFromForm(
        typeof body.history === "string"
          ? body.history
          : JSON.stringify(body.history ?? []),
      ),
      vaultPath: bodyText("vaultPath"),
      brainServicesFolder: bodyText("brainServicesFolder"),
      kanbanFolder: bodyText("kanbanFolder"),
      // Lazy: only task-creating turns pay for fleet discovery.
      fleetSnapshot: () =>
        discoverQueenBeeFleetSnapshot(
          request.nextUrl.origin,
          request.headers.get("x-hivemindos-device-token"),
        ),
      marks,
      progress: turnId ? (label) => markVoiceTurnStage(turnId, label) : undefined,
      voiceBrain: await resolveVoiceChatBrainPlan(),
    });
    await appendVoiceTurnTelemetry({
      ok: true,
      stage: "converse",
      ...marks,
      totalMs: Date.now() - startedAt,
      createdTask: Boolean(result.taskId && result.created),
    });
    return NextResponse.json({ ok: true, transcript, ...result });
  } catch (error) {
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "converse",
      ...marks,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (turnId) finishVoiceTurnProgress(turnId);
  }
}

// Streaming sibling of `converse`: NDJSON events (one JSON object per line)
// let the overlay start TTS on the first spoken sentence while the model is
// still writing, instead of waiting for the full reply.
//   {type:"speech", text}   incremental spoken-reply text — the concatenation
//                           (since the last reset) is exactly what to speak
//   {type:"reset"}          a failed model attempt's speech must be discarded
//   {type:"done", ok:true, transcript, reply, taskId?, taskTitle?, created?, route?}
//   {type:"error", error}
// The turn runs to completion even when the client disconnects mid-stream: a
// barge-in must not cancel a task delegation the model already confirmed out
// loud, so cancel/enqueue failures only stop emission, never the turn.
async function runConversationTurnStream(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const startedAt = Date.now();
  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) throw new Error("A transcript is required.");
  const bodyText = (key: string) => {
    const value = body[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const marks: Record<string, number> = {};
  // The polled `turn-progress` side channel stays authoritative for the
  // overlay's working chips (see voice-turn-progress.ts for the rationale).
  const turnId = normalizeVoiceTurnId(body.turnId);
  if (turnId) beginVoiceTurnProgress(turnId);
  const encoder = new TextEncoder();
  let closed = false;
  let speechChars = 0;
  let resets = 0;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // client went away; the turn keeps running
        }
      };
      void (async () => {
        try {
          const result = await runQueenBeeVoiceTurn({
            origin: request.nextUrl.origin,
            transcript,
            history: historyFromForm(
              typeof body.history === "string"
                ? body.history
                : JSON.stringify(body.history ?? []),
            ),
            vaultPath: bodyText("vaultPath"),
            brainServicesFolder: bodyText("brainServicesFolder"),
            kanbanFolder: bodyText("kanbanFolder"),
            fleetSnapshot: () =>
              discoverQueenBeeFleetSnapshot(
                request.nextUrl.origin,
                request.headers.get("x-hivemindos-device-token"),
              ),
            marks,
            progress: turnId
              ? (label) => markVoiceTurnStage(turnId, label)
              : undefined,
            onSpeechDelta: (text) => {
              if (!speechChars) marks.firstSpeechMs = Date.now() - startedAt;
              speechChars += text.length;
              emit({ type: "speech", text });
            },
            onSpeechReset: () => {
              resets += 1;
              speechChars = 0;
              emit({ type: "reset" });
            },
            voiceBrain: await resolveVoiceChatBrainPlan(),
          });
          emit({ type: "done", ok: true, transcript, ...result });
          await appendVoiceTurnTelemetry({
            ok: true,
            stage: "converse-stream",
            ...marks,
            speechChars,
            ...(resets ? { resets } : {}),
            totalMs: Date.now() - startedAt,
            createdTask: Boolean(result.taskId && result.created),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          emit({ type: "error", error: message });
          await appendVoiceTurnTelemetry({
            ok: false,
            stage: "converse-stream",
            ...marks,
            totalMs: Date.now() - startedAt,
            error: message,
          });
        } finally {
          if (turnId) finishVoiceTurnProgress(turnId);
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed/cancelled.
          }
        }
      })();
    },
    cancel: () => {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// Multipart step one of a voice turn: transcription only, so the user's
// words reach the screen fast while the conversational reply resolves in a
// follow-up "converse" call.
async function runVoiceTurn(request: NextRequest) {
  const startedAt = Date.now();
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob))
    throw new Error("An audio recording is required.");
  const calls = await readQueenBeeCallPreferences().catch(() => null);
  const inputTranscription = inputTranscriptionForVoiceRuntime(calls?.voiceRuntime);
  const transcriptionEngine = inputTranscription?.providerId ?? "openai";
  try {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(VOICE_TURN_TIMEOUT_MS),
    ]);
    const transcript = inputTranscription?.providerId === "elevenlabs"
      ? await transcribeElevenLabsAudio(audio, {
          model: inputTranscription.model,
          languageCode: calls?.voiceLanguage,
          signal,
        })
      : await transcribeAudioWithWhisper(audio, signal);
    await appendVoiceTurnTelemetry({
      ok: true,
      stage: "transcribe",
      engine: transcriptionEngine,
      noSpeech: !transcript,
      audioBytes: audio.size,
      audioType: audio.type,
      transcribeMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, transcript, noSpeech: !transcript });
  } catch (error) {
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "transcribe",
      engine: transcriptionEngine,
      audioBytes: audio.size,
      audioType: audio.type,
      transcribeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Lightweight per-turn timings under ~/.hivemindos/ so slow or stuck voice
// turns can be diagnosed without a visible server console.
async function appendVoiceTurnTelemetry(record: Record<string, unknown>) {
  try {
    const dir = join(homedir(), ".hivemindos");
    await mkdir(dir, { recursive: true });
    await appendFile(
      join(dir, "queen-voice-telemetry.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      "utf8",
    );
  } catch {
    // Telemetry must never break the voice turn.
  }
}

function historyFromForm(
  raw: FormDataEntryValue | null,
): QueenVoiceHistoryTurn[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (turn): turn is { who: unknown; text: unknown } =>
          Boolean(turn) && typeof turn === "object",
      )
      .map((turn) => ({
        who: turn.who === "queen" ? ("queen" as const) : ("you" as const),
        text: typeof turn.text === "string" ? turn.text : "",
      }))
      .filter((turn) => turn.text.trim().length > 0)
      .slice(-12);
  } catch {
    return [];
  }
}

// Synthesize the spoken reply on the Queen's selected connected TTS server,
// buffered to a decodable WAV clip. Returns null on any miss so the caller
// falls back to OpenAI cloud TTS.
async function speakViaLocalTts(
  request: NextRequest,
  text: string,
  calls: AgentCallPreferences,
  timings?: Record<string, number>,
): Promise<
  | { ok: true; wav: ArrayBuffer; appName: string; appId: string; voice: string; model: string; bytes: number }
  | { ok: false; error: string }
> {
  const configStartedAt = Date.now();
  const config = await resolveLocalTtsCallConfig({
    origin: request.nextUrl.origin,
    voiceProviderId: calls.voiceProviderId,
    voiceModelId: calls.voiceModelId,
    voiceId: calls.voiceId,
    openingLine: "",
  }).catch(() => null);
  if (timings) timings.configMs = Date.now() - configStartedAt;
  if (!config) return { ok: false, error: "no validated local TTS server" };
  // A server that failed seconds ago (often right before this buffered
  // fallback) will fail again; skip straight to the cloud voice instead of
  // sitting in silence for another timeout.
  const breaker = localTtsBreakerState(config.appId);
  if (breaker.open) {
    return {
      ok: false,
      error: `local TTS breaker open (${breaker.lastError || "recent failure"}; retry in ${Math.ceil(breaker.retryInMs / 1000)}s)`,
    };
  }
  const result = await synthesizeLocalTtsWav({
    origin: request.nextUrl.origin,
    appId: config.appId,
    model: config.model,
    voice: config.voice,
    text: text.slice(0, 4_000),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    timings,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    wav: result.wav,
    appName: result.appName,
    appId: config.appId,
    voice: config.voice,
    model: config.model,
    bytes: result.bytes,
  };
}

// Fire-and-forget warmer the overlay calls when it opens and while the LLM is
// composing each reply. Cold Universal TTS model loads measured 5-30s at speak
// time; warming during the think phase keeps that off the audible path. A
// prewarm success also re-closes the failure breaker (recovery probe).
async function prewarmSpokenReplyEngine(request: NextRequest) {
  const startedAt = Date.now();
  // Voice-session start: warm the business report (email + integration counts,
  // both network hops) so the spoken digest can include them from cache without
  // ever blocking a turn. Fire-and-forget — the warmer owns its own errors and
  // nothing audible depends on it here.
  void warmHiveDailyReport();
  let calls: AgentCallPreferences | null = null;
  try {
    calls = await readQueenBeeCallPreferences();
  } catch {
    // Store outage with no known-good prefs: nothing audible is at stake in a
    // warmer, so just skip; the speak paths own the continuity decision.
    return NextResponse.json({ ok: true, warmed: false, skipped: "call-prefs-unavailable" });
  }
  if (
    !calls ||
    (calls.voiceRuntime !== LOCAL_TTS_RUNTIME &&
      !isLocalTtsProviderId(calls.voiceProviderId))
  ) {
    return NextResponse.json({ ok: true, warmed: false, skipped: "local-tts-not-selected" });
  }
  const result = await prewarmLocalTts({
    origin: request.nextUrl.origin,
    voiceProviderId: calls.voiceProviderId,
    voiceModelId: calls.voiceModelId,
    voiceId: calls.voiceId,
  }).catch((error) => ({
    ok: false as const,
    warmed: false as const,
    ms: Date.now() - startedAt,
    error: error instanceof Error ? error.message : "prewarm failed",
  }));
  // Skipped-as-warm is routine; only real warm runs and failures are worth a
  // telemetry line.
  if (result.warmed || !result.ok) {
    await appendVoiceTurnTelemetry({
      ok: result.ok,
      stage: "speak-prewarm",
      engine: "local-tts",
      ...("appId" in result && result.appId ? { appId: result.appId } : {}),
      ...("model" in result && result.model ? { model: result.model } : {}),
      ...("voice" in result && result.voice ? { voice: result.voice } : {}),
      warmed: result.warmed,
      ...(result.error ? { error: result.error } : {}),
      ttsMs: result.ms,
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

// Streaming sibling of `speak`: cloud TTS returns provider PCM and local TTS
// forwards its live PCM frame stream, so the overlay uses the selected pipeline
// voice instead of substituting system speech. Non-pipeline runtimes return a
// JSON fallback envelope and continue through the buffered path.
async function streamSpokenReplyPcm(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  let calls: AgentCallPreferences | null = null;
  try {
    calls = await readQueenBeeCallPreferences();
  } catch {
    // Store outage with no known-good prefs: hand the turn to the buffered
    // `speak` path (the client falls back on any JSON reply), which owns the
    // voice-continuity decision — it retries the store and reports the
    // voiceUnavailable outage envelope rather than guessing a cloud voice.
    return NextResponse.json(
      { ok: false, fallback: true, reason: "call-prefs-unavailable" },
      { status: 409 },
    );
  }
  timings.prefsMs = Date.now() - startedAt;
  const resolvedVoice = resolveVoiceRuntime(calls?.voiceRuntime);
  if (calls && resolvedVoice.kind === "cloud-tts" && resolvedVoice.provider) {
    try {
      const cloudSpeech = await synthesizeVoicePreview(resolvedVoice.provider.id, {
        text,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        keyEnv: calls.voiceKeyEnv,
        languageCode: calls.voiceLanguage,
      });
      await appendVoiceTurnTelemetry({
        ok: true,
        stage: "speak-stream",
        engine: resolvedVoice.provider.id,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        sampleRate: cloudSpeech.sampleRate,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
      return new Response(cloudSpeech.response.body, {
        headers: {
          "Content-Type": "audio/pcm",
          "x-audio-sample-rate": String(cloudSpeech.sampleRate),
          "x-audio-channels": "1",
          "Cache-Control": "no-store, no-transform",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "cloud TTS failed";
      await appendVoiceTurnTelemetry({
        ok: false,
        stage: "speak-stream",
        engine: resolvedVoice.provider.id,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        error: message,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { ok: false, fallback: true, voiceUnavailable: true, error: message },
        { status: 502 },
      );
    }
  }
  if (
    calls &&
    (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
      isLocalTtsProviderId(calls.voiceProviderId))
  ) {
    const configStartedAt = Date.now();
    const config = await resolveLocalTtsCallConfig({
      origin: request.nextUrl.origin,
      voiceProviderId: calls.voiceProviderId,
      voiceModelId: calls.voiceModelId,
      voiceId: calls.voiceId,
      openingLine: "",
    }).catch(() => null);
    timings.configMs = Date.now() - configStartedAt;
    const breaker = config ? localTtsBreakerState(config.appId) : null;
    if (config && breaker?.open) {
      await appendVoiceTurnTelemetry({
        ok: false,
        stage: "speak-stream",
        engine: "local-tts",
        appId: config.appId,
        model: config.model,
        skipped: "breaker-open",
        breakerError: breaker.lastError,
        breakerRetryInMs: breaker.retryInMs,
      });
      return NextResponse.json(
        { ok: false, fallback: true, reason: "local-tts-breaker-open" },
        { status: 409 },
      );
    }
    if (config) {
      const stream = await streamLocalTtsPcm({
        origin: request.nextUrl.origin,
        appId: config.appId,
        model: config.model,
        voice: config.voice,
        text: text.slice(0, 4_000),
        signal: AbortSignal.timeout(STREAM_SPEAK_TIMEOUT_MS),
        timings,
      }).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "stream failed",
      }));
      if (stream.ok) {
        await appendVoiceTurnTelemetry({
          ok: true,
          stage: "speak-stream",
          engine: "local-tts",
          appId: config.appId,
          voice: config.voice,
          model: config.model,
          sampleRate: stream.sampleRate,
          ...timings,
          ttsMs: Date.now() - startedAt, // time to first byte (stream open)
        });
        return new Response(stream.body, {
          headers: {
            "Content-Type": "audio/pcm",
            "x-audio-sample-rate": String(stream.sampleRate),
            "x-audio-channels": String(stream.channels),
            "Cache-Control": "no-store, no-transform",
          },
        });
      }
      await appendVoiceTurnTelemetry({
        ok: false,
        stage: "speak-stream",
        engine: "local-tts",
        model: config.model,
        error: stream.error,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
    }
  }
  return NextResponse.json({ ok: false, fallback: true }, { status: 409 });
}

// Fire-and-forget client beacon: playback-side timings for a streamed reply
// (first byte, first audible audio, underruns), appended to the same telemetry
// file as the server-side stage timings so one log answers "where did the
// latency go" end to end.
async function recordSpeakPlaybackMetrics(body: Record<string, unknown>) {
  const numeric = (key: string) => {
    const parsed = Number(body[key]);
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
  };
  await appendVoiceTurnTelemetry({
    ok: body.ok !== false,
    stage: "speak-playback",
    engine: "local-tts",
    streamOpenMs: numeric("streamOpenMs"),
    firstByteMs: numeric("firstByteMs"),
    firstAudioMs: numeric("firstAudioMs"),
    playedMs: numeric("playedMs"),
    underruns: numeric("underruns"),
    underrunMs: numeric("underrunMs"),
    ...(body.aborted === true ? { aborted: true } : {}),
    ...(body.partial === true ? { partial: true } : {}),
  });
  return NextResponse.json({ ok: true });
}

async function streamSpokenReply(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const startedAt = Date.now();
  const timings: Record<string, number> = {};

  // Honor a Queen Calls "Local TTS" selection: voice the reply on the chosen
  // connected TTS server instead of OpenAI cloud TTS. Any miss (no validated
  // server, app unreachable, no audio) falls through to OpenAI below.
  let calls: AgentCallPreferences | null = null;
  let callPrefsUnavailable = false;
  try {
    calls = await readQueenBeeCallPreferences();
  } catch {
    callPrefsUnavailable = true;
  }
  timings.prefsMs = Date.now() - startedAt;
  if (callPrefsUnavailable) {
    // Voice continuity: with the prefs store unreadable (and no known-good
    // read to fall back on) we cannot know whether a local cloned voice is
    // selected, so never guess cloud — report the outage; the overlay shows
    // the reply as muted text with a notice, same as a local-TTS outage.
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "speak",
      engine: "none",
      skipped: "voice-continuity",
      localFallbackReason: "call-prefs-unavailable",
      ...timings,
      ttsMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        voiceUnavailable: true,
        error:
          "Queen call preferences are unreadable; holding the reply as text instead of speaking in a substitute voice.",
      },
      { status: 503 },
    );
  }
  let localFallbackReason = "";
  if (
    calls &&
    (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
      isLocalTtsProviderId(calls.voiceProviderId))
  ) {
    const local = await speakViaLocalTts(request, text, calls, timings).catch(
      (error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "local TTS failed",
      }),
    );
    if (local.ok) {
      await appendVoiceTurnTelemetry({
        ok: true,
        stage: "speak",
        engine: "local-tts",
        appName: local.appName,
        appId: local.appId,
        voice: local.voice,
        model: local.model,
        audioBytes: local.bytes,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
      return new Response(local.wav, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store, no-transform",
        },
      });
    }
    localFallbackReason = local.error;
    // Voice continuity: the user explicitly selected a local cloned voice, so
    // substituting a different cloud voice mid-conversation reads as a bug
    // (reported 2026-07-02: replies alternated voice01/nova across TTS-server
    // flaps). Report the outage instead; the overlay shows the reply as text
    // and the prewarm probes restore the voice when the server recovers.
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "speak",
      engine: "none",
      skipped: "voice-continuity",
      localFallbackReason,
      ttsMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        voiceUnavailable: true,
        error: `The selected local TTS voice is unreachable (${localFallbackReason}).`,
      },
      { status: 503 },
    );
  }

  const resolvedVoice = calls ? resolveVoiceRuntime(calls.voiceRuntime) : null;
  if (calls && resolvedVoice && resolvedVoice.kind === "cloud-tts" && resolvedVoice.provider) {
    try {
      const cloudSpeech = await synthesizeVoicePreview(resolvedVoice.provider.id, {
        text,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        keyEnv: calls.voiceKeyEnv,
        languageCode: calls.voiceLanguage,
      });
      const pcm = new Uint8Array(await cloudSpeech.response.arrayBuffer());
      if (!pcm.byteLength) throw new Error("The selected cloud voice returned no audio.");
      const wav = pcm16ToWav(pcm, cloudSpeech.sampleRate, 1);
      await appendVoiceTurnTelemetry({
        ok: true,
        stage: "speak",
        engine: resolvedVoice.provider.id,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        audioBytes: pcm.byteLength,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
      return new Response(wav, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store, no-transform",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "cloud TTS failed";
      await appendVoiceTurnTelemetry({
        ok: false,
        stage: "speak",
        engine: resolvedVoice.provider.id,
        voice: calls.voiceId,
        model: calls.voiceModelId,
        error: message,
        ...timings,
        ttsMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          ok: false,
          voiceUnavailable: true,
          error: `The selected ${resolvedVoice.provider.name || "cloud TTS"} voice is unavailable (${message}).`,
        },
        { status: 503 },
      );
    }
  }

  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "speak",
      engine: "none",
      error: "no-openai-key",
      ...(localFallbackReason ? { localFallbackReason } : {}),
      ttsMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          "No OpenAI voice key is configured; use on-device speech synthesis instead.",
      },
      { status: 503 },
    );
  }
  const voice = ttsVoiceFor(await readQueenBeeVoice());
  const model = process.env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text.slice(0, 4_000),
      response_format: "mp3",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string } | string;
    } | null;
    const detail =
      typeof data?.error === "string" ? data.error : data?.error?.message;
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "speak",
      engine: "openai",
      voice,
      model,
      error: detail || `HTTP ${response.status}`,
      ...(localFallbackReason ? { localFallbackReason } : {}),
      ttsMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        error: detail || `Queen Bee TTS returned HTTP ${response.status}.`,
      },
      { status: 502 },
    );
  }
  await appendVoiceTurnTelemetry({
    ok: true,
    stage: "speak",
    engine: "openai",
    voice,
    model,
    ...(localFallbackReason ? { localFallbackReason } : {}),
    ttsMs: Date.now() - startedAt,
  });
  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
