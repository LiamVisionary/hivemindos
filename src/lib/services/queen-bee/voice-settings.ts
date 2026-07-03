import "server-only";

import {
  readDashboardState,
  updateDashboardState,
} from "@/lib/services/dashboard-state";
import { readStoredAgentProfilesStrict } from "@/lib/services/agent-profile-store";
import {
  buildAgentCallPreferences,
  type AgentCallPreferences,
  type AgentProfile,
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
// The profile store lives inside the multi-megabyte dashboard-state file
// (~26MB observed), and one spoken turn reads these prefs 3-4 times
// (speak-stream, speak, prewarm). A short TTL keeps that parse off the
// audible path; Calls-settings edits land within the window.
const CALL_PREFS_CACHE_MS = 15_000;

/** The Queen agent's own selected chat model — the default PIPELINE voice
 *  brain ("your agent's model answers voice unless you override it"). */
export type QueenVoiceBrainDefaults = {
  agentId: string;
  agentName?: string;
  provider?: string;
  model?: string;
} | null;

let callPrefsCache: {
  expiresAt: number;
  value: AgentCallPreferences | null;
  brainDefaults: QueenVoiceBrainDefaults;
} | null = null;

/**
 * Thrown when the call prefs cannot be read AND no earlier successful read is
 * cached. Callers must treat this as an outage — never as "no local voice
 * selected" (voice continuity: substituting a cloud voice for a selected
 * local cloned voice is the bug this distinction prevents).
 */
export class QueenCallPreferencesUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Queen call preferences are unavailable (agent-profile store read failed).");
    this.name = "QueenCallPreferencesUnavailableError";
    this.cause = cause;
  }
}

/** Test hook: clear the prefs cache (mirrors resetLocalTtsHealth). */
export function resetQueenBeeCallPreferencesCache() {
  callPrefsCache = null;
}

async function readQueenPrefsBundle(now = Date.now()) {
  if (callPrefsCache && callPrefsCache.expiresAt > now) return callPrefsCache;
  let profiles: AgentProfile[];
  try {
    profiles = await readStoredAgentProfilesStrict();
  } catch (error) {
    // Store outage. Serve the last-known-good prefs when any earlier read
    // succeeded (a stale answer beats a substituted voice; the expired cache
    // entry is left as-is so every later call retries the store), otherwise
    // surface the outage instead of letting it read as "cloud voice selected".
    if (callPrefsCache) return callPrefsCache;
    throw new QueenCallPreferencesUnavailableError(error);
  }
  const queen =
    profiles.find((profile) => profile.beeRole === "queen") ??
    profiles.find((profile) => /queen/i.test(profile.name ?? ""));
  callPrefsCache = {
    expiresAt: now + CALL_PREFS_CACHE_MS,
    value: queen ? buildAgentCallPreferences(queen.calls) : null,
    brainDefaults: queen
      ? {
          agentId: queen.id,
          agentName: queen.name,
          provider: queen.provider?.trim() || undefined,
          model: queen.model?.trim() || undefined,
        }
      : null,
  };
  return callPrefsCache;
}

export async function readQueenBeeCallPreferences(
  now = Date.now(),
): Promise<AgentCallPreferences | null> {
  return (await readQueenPrefsBundle(now)).value;
}

export async function readQueenBeeBrainDefaults(
  now = Date.now(),
): Promise<QueenVoiceBrainDefaults> {
  return (await readQueenPrefsBundle(now)).brainDefaults;
}
