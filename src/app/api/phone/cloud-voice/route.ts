// guard:allow-hive-action-route - dashboard-only voice transport surface: mints
// a short-lived Gemini Live token from the user's own hive-env key and streams
// cloud TTS audio for a call. Not an agent-invokable Hive action.
import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import {
  mintGeminiLiveToken,
  streamCloudTts,
  synthesizeVoicePreview,
  CLOUD_VOICE_PCM_SAMPLE_RATE,
  type CloudTtsProvider,
} from "@/lib/services/phone/cloud-voice-transports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cloud voice transports for the Calls panel's non-OpenAI providers.
 *
 *  - action "gemini-live-token": mint a Gemini Live ephemeral token (the browser
 *    connects the bidi WebSocket with it; the API key never leaves the server).
 *  - action "cloud-tts-speech": stream one utterance of raw 24 kHz PCM from
 *    ElevenLabs or Cartesia (piped into the same realtime PCM player the
 *    local-TTS call path uses).
 *
 * STATUS: code-complete against the provider specs, NOT live-verified — needs a
 * real provider key + a device call. Fails loudly with the provider's own error.
 */

const CLOUD_TTS_PROVIDERS = new Set<CloudTtsProvider>(["elevenlabs", "cartesia"]);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    provider?: string;
    text?: string;
    voice?: string;
    model?: string;
    instructions?: string;
    keyEnv?: string;
  };
  try {
    if (body.action === "voice-preview") {
      const preview = await synthesizeVoicePreview(String(body.provider ?? ""), {
        voice: body.voice,
        model: body.model,
        keyEnv: body.keyEnv,
        text: body.text,
      });
      return new Response(preview.response.body, {
        status: 200,
        headers: {
          "content-type": "audio/pcm",
          "x-pcm-sample-rate": String(preview.sampleRate),
          "cache-control": "no-store",
        },
      });
    }
    if (body.action === "gemini-live-token") {
      const minted = await mintGeminiLiveToken({
        model: body.model,
        instructions: body.instructions,
        voice: body.voice,
        keyEnv: body.keyEnv,
      });
      return okJson({ ...minted });
    }

    if (body.action === "cloud-tts-speech") {
      const provider = body.provider as CloudTtsProvider;
      if (!CLOUD_TTS_PROVIDERS.has(provider)) return errorJson(`Unknown cloud TTS provider: ${body.provider ?? ""}`);
      const text = String(body.text ?? "").trim();
      if (!text) return errorJson("Nothing to speak.");
      const upstream = await streamCloudTts(provider, text, { voice: body.voice, model: body.model });
      // Forward the raw PCM stream straight to the client's audio player.
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "audio/pcm",
          "x-pcm-sample-rate": String(CLOUD_VOICE_PCM_SAMPLE_RATE),
          "cache-control": "no-store",
        },
      });
    }

    return errorJson(`Unknown action: ${body.action ?? ""}`);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Cloud voice transport failed.", 502);
  }
}
