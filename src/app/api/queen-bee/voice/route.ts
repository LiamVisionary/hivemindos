import { appendFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import {
  runQueenBeeVoiceTurn,
  submitQueenBeeVoiceTask,
  type QueenVoiceHistoryTurn,
} from "@/lib/services/queen-bee/voice-turn";
import {
  QUEEN_BEE_REALTIME_VOICES,
  readQueenBeeVoice,
  ttsVoiceFor,
  writeQueenBeeVoice,
} from "@/lib/services/queen-bee/voice-settings";
import {
  transcribeAudioWithWhisper,
  transcriptionApiKey,
} from "@/lib/services/phone/transcription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_TURN_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";

const QUEEN_REALTIME_INSTRUCTIONS = [
  "You are Queen Bee, the single coordinator voice of HivemindOS, on a live voice chat with the user.",
  "Speak naturally in one to three short sentences. No lists, no markdown, no reasoning preambles.",
  "When the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive), call the create_hive_task tool with a short imperative title and the full request as the message, then briefly confirm what you kicked off using the tool result.",
  "Greetings, questions, status chat, and thinking-out-loud are just conversation - never create tasks for them.",
].join(" ");

const QUEEN_REALTIME_TOOLS = [
  {
    type: "function",
    name: "create_hive_task",
    description:
      "Create and delegate a task on the HivemindOS work board. Use ONLY when the user clearly requests work (build, fix, research, automation, reminder, delegation).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short imperative summary of the work.",
        },
        message: {
          type: "string",
          description: "The full work request, in the user's words.",
        },
      },
      required: ["message"],
    },
  },
];

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
    if (body.action === "speak") {
      return await streamSpokenReply(body);
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
    if (body.action === "set-voice") {
      const voice = await writeQueenBeeVoice(String(body.voice ?? ""));
      return NextResponse.json({ ok: true, voice });
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

// Voice settings for the overlay's picker.
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      voice: await readQueenBeeVoice(),
      voices: QUEEN_BEE_REALTIME_VOICES,
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
          instructions: QUEEN_REALTIME_INSTRUCTIONS,
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
    instructions: QUEEN_REALTIME_INSTRUCTIONS,
    tools: QUEEN_REALTIME_TOOLS,
  });
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

async function streamSpokenReply(body: Record<string, unknown>) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No OpenAI voice key is configured; use on-device speech synthesis instead.",
      },
      { status: 503 },
    );
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL,
      voice: ttsVoiceFor(await readQueenBeeVoice()),
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
    return NextResponse.json(
      {
        ok: false,
        error: detail || `Queen Bee TTS returned HTTP ${response.status}.`,
      },
      { status: 502 },
    );
  }
  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
