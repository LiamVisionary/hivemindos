import "server-only";

import {
  readDashboardState,
  updateDashboardState,
} from "@/lib/services/dashboard-state";
import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import {
  buildAgentCallPreferences,
  type AgentCallPreferences,
} from "@/lib/types/agent-runtime";

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

/**
 * The Queen agent's saved Calls preferences (voice runtime + provider/voice
 * ids), read from the same persisted profile store the dashboard's Calls
 * settings write to. Used by the voice "speak" front door to honor a selected
 * local-TTS server for spoken replies, and by the overlay to route to the
 * non-realtime pipeline. Returns null when no Queen profile has been persisted
 * yet, so callers fall back to the default cloud voice.
 *
 * Mirrors how the dashboard resolves "the Queen" for both the chat FAB and the
 * Queen settings panel (DashboardApp: `agents.find(beeRole === "queen")`, then
 * a name match) so the prefs we read here are the exact same profile the user
 * edits — there is a single Queen for the voice chat, not a fleet of them.
 */
export async function readQueenBeeCallPreferences(): Promise<AgentCallPreferences | null> {
  const profiles = await readStoredAgentProfiles().catch(() => []);
  const queen =
    profiles.find((profile) => profile.beeRole === "queen") ??
    profiles.find((profile) => /queen/i.test(profile.name ?? ""));
  if (!queen) return null;
  return buildAgentCallPreferences(queen.calls);
}
