/* Global user custom instructions (ChatGPT "custom instructions" style).
 *
 * A single user-authored tone/identity string that is prepended to every
 * HivemindOS dashboard chat turn, across all agents and providers. Because it
 * is a GLOBAL setting — the same value for every request and agent, not
 * per-request data — it is cached in module memory and read synchronously by
 * buildHivemindPromptEnvelope, rather than threaded through each transport's
 * prompt input. The agent-runtime route warms/refreshes the cache from durable
 * dashboard state (see refreshGlobalCustomInstructions), and the settings save
 * path updates it immediately via applyGlobalCustomInstructions.
 *
 * Default is empty. When unset, NOTHING is added to the prompt — custom
 * instructions are opt-in, not applied by default.
 *
 * This module holds no filesystem/server imports so it is safe to import from
 * both the server prompt builder and client settings UI; the durable read lives
 * in the caller (server-only dashboard-state service). */

export const GLOBAL_CUSTOM_INSTRUCTIONS_KEY = "chat.customInstructions";
export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4000;

let cached = "";
let cachedAtMs = 0;

export function normalizeCustomInstructions(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
}

/** Synchronous read used inside the prompt builder. Returns "" when unset. */
export function getGlobalCustomInstructionsSync(): string {
  return cached;
}

/** Update the in-memory cache immediately (e.g. right after a settings save). */
export function applyGlobalCustomInstructions(value: unknown): string {
  cached = normalizeCustomInstructions(value);
  cachedAtMs = Date.now();
  return cached;
}

/** True when the cache has never been warmed or is older than ttlMs. */
export function isGlobalCustomInstructionsStale(ttlMs: number): boolean {
  return cachedAtMs === 0 || Date.now() - cachedAtMs > ttlMs;
}
