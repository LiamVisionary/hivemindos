import "server-only";

import {
  mutateDashboardStateValue,
  readDashboardState,
} from "@/lib/services/dashboard-state";
import {
  QUEEN_VOICE_PREFERENCES_KEY,
  appendVoicePreference,
  formatVoicePreferencePreamble,
  parseVoicePreferences,
  serializeVoicePreferences,
} from "./voice-preferences-core";

/**
 * Durable storage for Queen Bee's voice preferences, in the same shared
 * dashboard-state service the spoken-voice choice uses - so a preference the
 * user states out loud ("call me boss") survives closing the overlay and
 * applies across Tauri, dev, and browser surfaces.
 */

export async function readQueenBeeVoicePreferences(): Promise<string[]> {
  const state = await readDashboardState();
  return parseVoicePreferences(state.values[QUEEN_VOICE_PREFERENCES_KEY]);
}

/** Persist a new standing preference; returns the updated, normalized list. */
export async function addQueenBeeVoicePreference(
  note: string,
): Promise<string[]> {
  const cleaned = typeof note === "string" ? note.trim() : "";
  if (!cleaned) return readQueenBeeVoicePreferences();
  let updated: string[] = [];
  // Read-modify-write inside the dashboard-state write queue so two quick
  // preferences in one breath can't clobber each other.
  await mutateDashboardStateValue(QUEEN_VOICE_PREFERENCES_KEY, (current) => {
    updated = appendVoicePreference(parseVoicePreferences(current), cleaned);
    return serializeVoicePreferences(updated);
  });
  return updated;
}

/**
 * The stored preferences rendered as one instruction sentence, ready to splice
 * onto a system prompt or realtime instructions. Empty when none are set.
 */
export async function queenVoicePreferencePreamble(): Promise<string> {
  return formatVoicePreferencePreamble(await readQueenBeeVoicePreferences());
}
