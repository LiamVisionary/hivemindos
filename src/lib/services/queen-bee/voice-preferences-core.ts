/**
 * Pure helpers for Queen Bee's durable voice preferences - the standing
 * facts the user tells her in a voice chat that must outlive a single session
 * ("call me boss", "keep replies short", "speak Spanish"). Kept free of any
 * `server-only` or `@/` imports so the .mjs unit suite can exercise the
 * normalize/dedupe/cap/format logic directly. The dashboard-state-backed
 * persistence wrapper lives in ./voice-preferences.
 */

// Stored as a JSON array of strings under this key in the shared dashboard
// state, alongside `queenBeeVoice` (the spoken-voice choice).
export const QUEEN_VOICE_PREFERENCES_KEY = "queenBeeVoicePreferences";

// Keep the list small and bounded; old preferences age out FIFO so a long
// history of tweaks can never bloat the instruction prompt.
export const MAX_VOICE_PREFERENCES = 12;
const MAX_PREFERENCE_LENGTH = 240;

/** Collapse whitespace, trim, and clamp a single preference note. */
function cleanPreference(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, MAX_PREFERENCE_LENGTH);
}

/** Dedupe (case-insensitive), drop blanks, and cap to the most recent N. */
export function normalizeVoicePreferences(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const note = cleanPreference(item);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out.slice(-MAX_VOICE_PREFERENCES);
}

/** Parse the stored JSON array; tolerant of missing/garbage values. */
export function parseVoicePreferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? normalizeVoicePreferences(value as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append a new preference, moving an exact (case-insensitive) repeat to the
 * end so the most recently stated wording wins on ordering.
 */
export function appendVoicePreference(
  list: readonly string[],
  note: string,
): string[] {
  const cleaned = cleanPreference(note);
  if (!cleaned) return normalizeVoicePreferences(list);
  const withoutRepeat = normalizeVoicePreferences(list).filter(
    (item) => item.toLowerCase() !== cleaned.toLowerCase(),
  );
  return normalizeVoicePreferences([...withoutRepeat, cleaned]);
}

/** Serialize for storage in the dashboard-state string map. */
export function serializeVoicePreferences(list: readonly string[]): string {
  return JSON.stringify(normalizeVoicePreferences(list));
}

/**
 * Render the stored preferences as one instruction sentence to splice into the
 * Queen Bee system prompt / realtime instructions. Empty string when there are
 * none, so callers can append unconditionally.
 */
export function formatVoicePreferencePreamble(list: readonly string[]): string {
  const prefs = normalizeVoicePreferences(list);
  if (!prefs.length) return "";
  const sentences = prefs
    .map((pref) => (/[.!?]$/.test(pref) ? pref : `${pref}.`))
    .join(" ");
  return `Standing preferences the user has set for how you talk to and treat them - always honor these, and if two ever conflict the most recently stated one wins: ${sentences}`;
}
