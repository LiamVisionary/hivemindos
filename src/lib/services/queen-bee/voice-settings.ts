import "server-only";

import {
  readDashboardState,
  updateDashboardState,
} from "@/lib/services/dashboard-state";

/**
 * Queen Bee's spoken voice. Stored in the shared dashboard state service so
 * the choice survives restarts and applies across Tauri, dev, and browser
 * surfaces (no browser-only storage).
 */

const QUEEN_VOICE_STATE_KEY = "queenBeeVoice";

export const QUEEN_BEE_REALTIME_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
] as const;

export const DEFAULT_QUEEN_BEE_VOICE = "marin";

// Voices the /v1/audio/speech TTS endpoint also supports; realtime-only
// voices fall back to a close TTS equivalent for the non-realtime pipeline.
const TTS_SUPPORTED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
]);
const TTS_FALLBACK_VOICE = "nova";

export function isQueenBeeVoice(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (QUEEN_BEE_REALTIME_VOICES as readonly string[]).includes(value)
  );
}

export async function readQueenBeeVoice(): Promise<string> {
  const state = await readDashboardState();
  const stored = state.values[QUEEN_VOICE_STATE_KEY];
  if (isQueenBeeVoice(stored)) return stored;
  const envVoice = process.env.OPENAI_TTS_VOICE?.trim();
  if (isQueenBeeVoice(envVoice)) return envVoice;
  return DEFAULT_QUEEN_BEE_VOICE;
}

export async function writeQueenBeeVoice(voice: string) {
  if (!isQueenBeeVoice(voice)) {
    throw new Error(
      `Unknown Queen Bee voice "${voice}". Valid voices: ${QUEEN_BEE_REALTIME_VOICES.join(", ")}.`,
    );
  }
  await updateDashboardState({ values: { [QUEEN_VOICE_STATE_KEY]: voice } });
  return voice;
}

export function ttsVoiceFor(voice: string) {
  return TTS_SUPPORTED_VOICES.has(voice) ? voice : TTS_FALLBACK_VOICE;
}
