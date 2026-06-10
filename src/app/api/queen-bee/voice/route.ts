import { NextRequest, NextResponse } from "next/server";
import { submitQueenBeeMessage } from "@/lib/services/queen-bee/control-plane";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import { transcribeAudioWithWhisper, transcriptionApiKey } from "@/lib/services/phone/transcription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_TURN_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "nova";

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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "speak") {
      return await streamSpokenReply(body);
    }
    throw new Error(`Unknown Queen Bee voice action: ${String(body.action ?? "")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queen Bee voice request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function runVoiceTurn(request: NextRequest) {
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new Error("An audio recording is required.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(VOICE_TURN_TIMEOUT_MS)]);
  const transcript = await transcribeAudioWithWhisper(audio, signal);

  const formText = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const result = await submitQueenBeeMessage({
    message: transcript,
    source: "queen-bee-voice",
    mode: "act",
    vaultPath: formText("vaultPath"),
    brainServicesFolder: formText("brainServicesFolder"),
    kanbanFolder: formText("kanbanFolder"),
    fleetSnapshot: await discoverQueenBeeFleetSnapshot(
      request.nextUrl.origin,
      request.headers.get("x-hivemindos-device-token"),
    ),
  });

  return NextResponse.json({
    ok: true,
    transcript,
    reply: spokenReplyFromReceipt(result.receipt?.summary, transcript),
    taskId: result.task?.id,
    taskTitle: result.task?.title,
    created: result.created,
    route: result.route,
  });
}

function spokenReplyFromReceipt(summary: unknown, transcript: string) {
  const text = typeof summary === "string" ? summary.trim() : "";
  if (text) return text;
  return `Queen Bee received your request: ${transcript}`;
}

async function streamSpokenReply(body: Record<string, unknown>) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("Speech text is required.");
  const apiKey = await transcriptionApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "No OpenAI voice key is configured; use on-device speech synthesis instead." },
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
      voice: process.env.OPENAI_TTS_VOICE || DEFAULT_TTS_VOICE,
      input: text.slice(0, 4_000),
      response_format: "mp3",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message;
    return NextResponse.json(
      { ok: false, error: detail || `Queen Bee TTS returned HTTP ${response.status}.` },
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
