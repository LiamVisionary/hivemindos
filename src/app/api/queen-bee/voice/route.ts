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
} from "@/lib/services/queen-bee/voice-turn";
import {
  QUEEN_BEE_REALTIME_VOICES,
  readQueenBeeCallPreferences,
  readQueenBeeVoice,
  ttsVoiceFor,
  writeQueenBeeVoice,
} from "@/lib/services/queen-bee/voice-settings";
import {
  LOCAL_TTS_RUNTIME,
  isLocalTtsProviderId,
  resolveLocalTtsCallConfig,
  streamLocalTtsPcm,
  synthesizeLocalTtsWav,
} from "@/lib/services/phone/local-tts";
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
  QUEEN_INSTRUCTIONS,
  QUEEN_VOICE_STYLE,
  queenChatTools,
  queenRealtimeTools,
} from "@/lib/services/queen-bee/queen-brain";
import {
  coerceDashboardScreenContext,
  formatDashboardScreenContextForPrompt,
} from "@/features/dashboard/screen-context";

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

// Voice modality = the one shared Queen brain + a spoken-style addendum.
const QUEEN_REALTIME_INSTRUCTIONS = `${QUEEN_INSTRUCTIONS}${QUEEN_VOICE_STYLE}`;
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
    if (body.action === "converse") {
      return await runConversationTurn(request, body);
    }
    if (body.action === "realtime-session") {
      return await mintRealtimeSession();
    }
    if (body.action === "submit-task") {
      return await submitRealtimeTask(request, body);
    }
    if (body.action === "agent-turn") {
      const result = await runQueenBeeAgentTurn(
        request.nextUrl.origin,
        String(body.message ?? ""),
        coerceActingWalletSource(body.actingWallet),
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
    if (body.action === "chat-turn") {
      return await runQueenChatTurn(body);
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

// Voice settings for the overlay's picker. `localTtsSelected` lets the overlay
// route to the non-realtime pipeline (which honors the chosen local TTS server)
// instead of OpenAI Realtime speech-to-speech, where local TTS cannot apply.
export async function GET() {
  try {
    const calls = await readQueenBeeCallPreferences().catch(() => null);
    return NextResponse.json({
      ok: true,
      voice: await readQueenBeeVoice(),
      voices: QUEEN_BEE_REALTIME_VOICES,
      callVoiceRuntime: calls?.voiceRuntime ?? null,
      localTtsSelected: Boolean(
        calls &&
          (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
            isLocalTtsProviderId(calls.voiceProviderId)),
      ),
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
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Realtime speech requires an OpenAI voice key in the shared env.",
      },
      { status: 503 },
    );
  }
  const voice = await readQueenBeeVoice();
  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  // Splice any standing user preferences ("call me boss") onto the base
  // instructions so every new session opens already knowing them.
  const preferencePreamble = await queenVoicePreferencePreamble();
  const instructions = preferencePreamble
    ? `${QUEEN_REALTIME_INSTRUCTIONS} ${preferencePreamble}`
    : QUEEN_REALTIME_INSTRUCTIONS;
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

// One step of the TYPED Queen chat brain: the SAME instructions + tools as the
// voice session, run through OpenAI chat completions. Returns the assistant
// message (text and/or tool calls) for the client to act on and loop. When no
// OpenAI key exists we flag `fallback` so the client uses the heuristic planner
// (the "runtime can't do tool calls" path).
const QUEEN_CHAT_MODEL_FALLBACK = "gpt-4o-mini";

async function runQueenChatTurn(body: Record<string, unknown>) {
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    return NextResponse.json({ ok: false, fallback: true, error: "no-openai-key" });
  }
  const incoming = Array.isArray(body.messages) ? body.messages : [];
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
  const system = [QUEEN_INSTRUCTIONS, preamble, screenContextPrompt].filter(Boolean).join(" ");
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VOICE_CHAT_MODEL || QUEEN_CHAT_MODEL_FALLBACK,
        messages: [{ role: "system", content: system }, ...incoming],
        tools: queenChatTools(),
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: 500,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
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
      return NextResponse.json({ ok: false, fallback: true, error: detail || `chat turn HTTP ${response.status}` });
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
    return NextResponse.json({
      ok: true,
      content: typeof message.content === "string" ? message.content : "",
      toolCalls,
      assistant: message,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      fallback: true,
      error: error instanceof Error ? error.message : "chat turn failed",
    });
  }
}

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
  }
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
  try {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(VOICE_TURN_TIMEOUT_MS),
    ]);
    const transcript = await transcribeAudioWithWhisper(audio, signal);
    await appendVoiceTurnTelemetry({
      ok: true,
      stage: "transcribe",
      audioBytes: audio.size,
      audioType: audio.type,
      transcribeMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, transcript });
  } catch (error) {
    await appendVoiceTurnTelemetry({
      ok: false,
      stage: "transcribe",
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
): Promise<
  | { ok: true; wav: ArrayBuffer; appName: string; appId: string; voice: string; model: string; bytes: number }
  | { ok: false; error: string }
> {
  const config = await resolveLocalTtsCallConfig({
    origin: request.nextUrl.origin,
    voiceProviderId: calls.voiceProviderId,
    voiceModelId: calls.voiceModelId,
    voiceId: calls.voiceId,
    openingLine: "",
  }).catch(() => null);
  if (!config) return { ok: false, error: "no validated local TTS server" };
  const result = await synthesizeLocalTtsWav({
    origin: request.nextUrl.origin,
    appId: config.appId,
    model: config.model,
    voice: config.voice,
    text: text.slice(0, 4_000),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
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

// Streaming sibling of `speak`: when the Queen uses local TTS, forward the live
// PCM frame stream so the overlay can play audio within ~a second instead of
// waiting for the whole clip. Returns 409 {fallback:true} for any non-local-TTS
// or unavailable case, signalling the client to use the buffered `speak` path
// (which still handles OpenAI + browser-synth fallback).
async function streamSpokenReplyPcm(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const startedAt = Date.now();
  const calls = await readQueenBeeCallPreferences().catch(() => null);
  if (
    calls &&
    (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
      isLocalTtsProviderId(calls.voiceProviderId))
  ) {
    const config = await resolveLocalTtsCallConfig({
      origin: request.nextUrl.origin,
      voiceProviderId: calls.voiceProviderId,
      voiceModelId: calls.voiceModelId,
      voiceId: calls.voiceId,
      openingLine: "",
    }).catch(() => null);
    if (config) {
      const stream = await streamLocalTtsPcm({
        origin: request.nextUrl.origin,
        appId: config.appId,
        model: config.model,
        voice: config.voice,
        text: text.slice(0, 4_000),
        signal: AbortSignal.timeout(STREAM_SPEAK_TIMEOUT_MS),
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
        ttsMs: Date.now() - startedAt,
      });
    }
  }
  return NextResponse.json({ ok: false, fallback: true }, { status: 409 });
}

async function streamSpokenReply(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const startedAt = Date.now();

  // Honor a Queen Calls "Local TTS" selection: voice the reply on the chosen
  // connected TTS server instead of OpenAI cloud TTS. Any miss (no validated
  // server, app unreachable, no audio) falls through to OpenAI below.
  const calls = await readQueenBeeCallPreferences().catch(() => null);
  let localFallbackReason = "";
  if (
    calls &&
    (calls.voiceRuntime === LOCAL_TTS_RUNTIME ||
      isLocalTtsProviderId(calls.voiceProviderId))
  ) {
    const local = await speakViaLocalTts(request, text, calls).catch(
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
