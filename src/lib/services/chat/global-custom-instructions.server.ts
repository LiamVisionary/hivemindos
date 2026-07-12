import "server-only";

import { readDashboardState } from "@/lib/services/dashboard-state";
import {
  GLOBAL_CUSTOM_INSTRUCTIONS_KEY,
  applyGlobalCustomInstructions,
  isGlobalCustomInstructionsStale,
} from "./global-custom-instructions";

const REFRESH_TTL_MS = 5000;

/**
 * Refresh the in-memory global custom instructions cache from durable dashboard
 * state, at most once per REFRESH_TTL_MS. Called at the top of the agent-runtime
 * request so buildHivemindPromptEnvelope can read the value synchronously. A
 * fresh cache short-circuits without touching the filesystem, so the per-request
 * cost is a timestamp comparison in the common case. readDashboardState never
 * throws (missing file -> empty state), so a fresh install simply yields "".
 */
export async function refreshGlobalCustomInstructions(): Promise<void> {
  if (!isGlobalCustomInstructionsStale(REFRESH_TTL_MS)) return;
  const state = await readDashboardState();
  applyGlobalCustomInstructions(state.values[GLOBAL_CUSTOM_INSTRUCTIONS_KEY]);
}
