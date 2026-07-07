import "server-only";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";

/**
 * Server-side transport helpers for the non-OpenAI voice providers surfaced in
 * the Calls panel: Gemini Live (realtime), ElevenLabs + Cartesia (cloud TTS).
 *
 * The provider API keys live in the shared hive env (never sent to the browser).
 * All three output 24 kHz mono signed-16-bit little-endian PCM so they feed the
 * same realtime PCM player the local-TTS call path already uses.
 *
 * STATUS: these paths are code-complete against the official API specs (July
 * 2026) but NOT yet live-verified — they need a real provider key and a device
 * call. The matrix keeps them `status: "preview"`. The single least-certain
 * piece is the Gemini ephemeral-token REST shape (see mintGeminiLiveToken).
 */

const PCM_SAMPLE_RATE = 24_000;

// ---- Gemini Live -----------------------------------------------------------

// Live model default (current as of 2026-07). The browser connects to the
// v1alpha "Constrained" bidi endpoint with the token.
export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const RETIRED_GEMINI_LIVE_MODELS = new Set([
  "gemini-2.0-flash-live-001",
  "gemini-2.0-flash-live-preview-04-09",
  "gemini-2.0-flash-exp",
]);

// Hive-env vars that may hold a Gemini/Google-AI-Studio key, in preference
// order. GOOGLE_API_KEY is last — it is often a generic Google key (Maps, etc.),
// so it is the least-likely-to-be-Gemini fallback. The Calls UI lets the user
// pick when more than one is present.
export const GEMINI_KEY_ENV_CANDIDATES = ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_API_KEY"] as const;
const GEMINI_INPUT_SAMPLE_RATE = 16_000; // Gemini Live wants 16 kHz mono PCM in
const GEMINI_OUTPUT_SAMPLE_RATE = 24_000; // and returns 24 kHz mono PCM out

export function normalizeGeminiLiveModel(model?: string): string {
  const normalized = model?.trim().replace(/^models\//, "") || "";
  if (!normalized || RETIRED_GEMINI_LIVE_MODELS.has(normalized)) {
    return GEMINI_LIVE_MODEL;
  }
  return normalized;
}

/** Resolve a Gemini key value from the shared hive env: honour the user's
 *  chosen env var when it holds a value, else the first present candidate. */
async function geminiApiKey(keyEnv?: string): Promise<string> {
  if (keyEnv && GEMINI_KEY_ENV_CANDIDATES.includes(keyEnv as (typeof GEMINI_KEY_ENV_CANDIDATES)[number])) {
    const chosen = await hiveEnvValue(keyEnv).catch(() => "");
    if (chosen) return chosen;
  }
  for (const candidate of GEMINI_KEY_ENV_CANDIDATES) {
    const value = await hiveEnvValue(candidate).catch(() => "");
    if (value) return value;
  }
  throw new Error(`No Gemini key in the shared hive env (${GEMINI_KEY_ENV_CANDIDATES.join(" / ")}). Add one in Calls settings.`);
}

/**
 * Mint a short-lived Gemini Live ephemeral token from the user's API key so the
 * browser never holds the key. Returns the token plus the WS url, model, voice,
 * instructions and audio rates the client needs to open the bidi session.
 *
 * VERIFIED LIVE (2026-07-06) against a real GOOGLE_AI_STUDIO_API_KEY: the token
 * body must be MINIMAL — `POST /v1alpha/auth_tokens` rejects `liveConnectConstraints`
 * ("Unknown name ... Cannot find field"), so the model/voice/systemInstruction
 * are sent by the client in the WS `setup` message instead. The client then
 * connects to BidiGenerateContentConstrained with `?access_token=<token>`.
 */
export async function mintGeminiLiveToken(options: {
  model?: string;
  instructions?: string;
  voice?: string;
  keyEnv?: string;
} = {}): Promise<{
  token: string;
  wsUrl: string;
  model: string;
  voice?: string;
  instructions?: string;
  inputSampleRate: number;
  outputSampleRate: number;
  expiresAt: number;
}> {
  const apiKey = await geminiApiKey(options.keyEnv);
  const model = normalizeGeminiLiveModel(options.model);
  const now = Date.now();
  const expireMs = now + 30 * 60_000; // 30 min to keep sending
  const startMs = now + 60_000; // 1 min to open the session
  const response = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(expireMs).toISOString(),
      newSessionExpireTime: new Date(startMs).toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => null)) as { name?: string; error?: { message?: string } } | null;
  if (!response.ok || !data?.name) {
    throw new Error(data?.error?.message || `Gemini Live token mint returned HTTP ${response.status}.`);
  }
  return {
    token: data.name,
    wsUrl: GEMINI_LIVE_WS_URL,
    model,
    voice: options.voice?.trim() || undefined,
    instructions: options.instructions?.trim() || undefined,
    inputSampleRate: GEMINI_INPUT_SAMPLE_RATE,
    outputSampleRate: GEMINI_OUTPUT_SAMPLE_RATE,
    expiresAt: expireMs,
  };
}

// ---- Cloud TTS (ElevenLabs / Cartesia) ------------------------------------

export type CloudTtsProvider = "elevenlabs" | "cartesia";

const ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // "George" — from the official quickstart
const ELEVENLABS_DEFAULT_MODEL = "eleven_flash_v2_5"; // lowest-latency model
const CARTESIA_DEFAULT_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"; // from Cartesia's official WS example
const CARTESIA_DEFAULT_MODEL = "sonic-2";
const CARTESIA_VERSION = "2026-03-01";

async function providerKey(provider: CloudTtsProvider): Promise<string> {
  const env = provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "CARTESIA_API_KEY";
  const key = await hiveEnvValue(env).catch(() => "");
  if (!key) throw new Error(`No ${env} in the shared hive env. Add one in Calls settings.`);
  return key;
}

/**
 * Stream raw 24 kHz PCM for one utterance from a cloud TTS provider. Returns the
 * upstream Response whose body is the PCM byte stream (the caller pipes it to
 * the realtime PCM player, exactly like the local-TTS path). Throws with the
 * provider's error text on a non-2xx.
 */
export async function streamCloudTts(
  provider: CloudTtsProvider,
  text: string,
  options: { voice?: string; model?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const input = text.trim();
  if (!input) throw new Error("Empty TTS text.");
  const apiKey = await providerKey(provider);

  if (provider === "elevenlabs") {
    const voice = options.voice?.trim() || ELEVENLABS_DEFAULT_VOICE;
    const model = options.model?.trim() || ELEVENLABS_DEFAULT_MODEL;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_${PCM_SAMPLE_RATE}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: input,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
      }),
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error((await response.text().catch(() => "")) || `ElevenLabs TTS returned HTTP ${response.status}.`);
    }
    return response;
  }

  // Cartesia Sonic — POST /tts/bytes, raw PCM body.
  const voice = options.voice?.trim() || CARTESIA_DEFAULT_VOICE;
  const model = options.model?.trim() || CARTESIA_DEFAULT_MODEL;
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Cartesia-Version": CARTESIA_VERSION, "content-type": "application/json" },
    body: JSON.stringify({
      model_id: model,
      transcript: input,
      voice: { mode: "id", id: voice },
      language: "en",
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: PCM_SAMPLE_RATE },
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error((await response.text().catch(() => "")) || `Cartesia TTS returned HTTP ${response.status}.`);
  }
  return response;
}

// ---- Voice preview (short sample for the Calls panel Preview button) -------

async function openaiApiKey(): Promise<string> {
  const key = (await hiveEnvValue("OPENAI_API_KEY").catch(() => "")) || (await hiveEnvValue("OPENAI_REALTIME_KEY").catch(() => ""));
  if (!key) throw new Error("No OPENAI_API_KEY in the shared hive env. Add one in Calls settings.");
  return key;
}

// Models the TTS-only /v1/audio/speech endpoint accepts. A realtime model id
// (e.g. "gpt-realtime", which the OpenAI realtime-hybrid transport uses as its
// default) is rejected here with a misleading "Invalid URL (POST /v1/audio/speech)"
// error, so the preview coerces anything outside this set to the default TTS model.
const OPENAI_SPEECH_MODELS = new Set(["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]);
const DEFAULT_OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts";

/**
 * Synthesize a short spoken preview of a provider's voice for the Calls panel.
 * Returns a raw-PCM Response (mono, 24 kHz s16le) the client plays through the
 * realtime PCM player, plus the sample rate. Covers the cloud providers; local
 * TTS previews go through the existing /api/phone local-tts-speech-stream path.
 */
export async function synthesizeVoicePreview(
  providerId: string,
  options: { voice?: string; model?: string; keyEnv?: string; text?: string } = {},
): Promise<{ response: Response; sampleRate: number }> {
  const text = options.text?.trim() || "Hi, this is a quick preview of how I sound on your HivemindOS calls.";

  if (providerId === "elevenlabs" || providerId === "cartesia") {
    return { response: await streamCloudTts(providerId, text, { voice: options.voice, model: options.model }), sampleRate: PCM_SAMPLE_RATE };
  }

  if (providerId === "openai") {
    const key = await openaiApiKey();
    const requestedModel = options.model?.trim() || "";
    const model = OPENAI_SPEECH_MODELS.has(requestedModel) ? requestedModel : DEFAULT_OPENAI_SPEECH_MODEL;
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        voice: options.voice?.trim() || "alloy",
        input: text,
        response_format: "pcm", // 24 kHz mono s16le
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body) {
      throw new Error((await response.text().catch(() => "")) || `OpenAI TTS preview returned HTTP ${response.status}.`);
    }
    return { response, sampleRate: 24_000 };
  }

  if (providerId === "gemini") {
    const key = await geminiApiKey(options.keyEnv);
    const model = "gemini-2.5-flash-preview-tts";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice?.trim() || "Kore" } } },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
      error?: { message?: string };
    } | null;
    const base64 = data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
    if (!response.ok || !base64) {
      throw new Error(data?.error?.message || `Gemini TTS preview returned HTTP ${response.status}.`);
    }
    return { response: new Response(new Uint8Array(Buffer.from(base64, "base64"))), sampleRate: GEMINI_OUTPUT_SAMPLE_RATE };
  }

  throw new Error(`Voice preview is not available for ${providerId}.`);
}

export const CLOUD_VOICE_PCM_SAMPLE_RATE = PCM_SAMPLE_RATE;
