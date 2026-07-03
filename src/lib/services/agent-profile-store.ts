import "server-only";

import {
  mutateDashboardStateValue,
  readDashboardState,
  readDashboardStateStrict,
} from "@/lib/services/dashboard-state";
import type { AgentProfile } from "@/lib/types/agent-runtime";

/**
 * Server-side access to the dashboard's persisted agent profiles
 * (`hivemindos.agentProfiles.v1` in dashboard state). The dashboard hydrates
 * its in-memory agent list from this key and persists edits back to it; remote
 * clients (the phone app's agent editor) upsert through here so their edits
 * land in the same store the dashboard reads.
 */
const AGENT_PROFILES_KEY = "hivemindos.agentProfiles.v1";
const AGENT_PROFILES_SUFFIX = ".agentProfiles.v1";

function filterProfiles(parsed: unknown): AgentProfile[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is AgentProfile => (
    Boolean(item) && typeof item === "object" && typeof (item as AgentProfile).id === "string"
  ));
}

function parseProfiles(raw: string | null): AgentProfile[] {
  if (!raw) return [];
  try {
    return filterProfiles(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function resolveProfilesKey(values: Record<string, string>): string {
  if (values[AGENT_PROFILES_KEY] !== undefined) return AGENT_PROFILES_KEY;
  const migrated = Object.keys(values).find((key) => key !== AGENT_PROFILES_KEY && key.endsWith(AGENT_PROFILES_SUFFIX));
  return migrated ?? AGENT_PROFILES_KEY;
}

export async function readStoredAgentProfiles(): Promise<AgentProfile[]> {
  const state = await readDashboardState();
  return parseProfiles(state.values[resolveProfilesKey(state.values)] ?? null);
}

/**
 * Strict variant: a state-file read/parse failure or a corrupt stored
 * profiles value throws instead of reading as "no profiles". For callers that
 * must not mistake a store outage for an empty profile list (voice continuity:
 * "no queen profile" implies "cloud voice selected", which must never be
 * inferred from a failed read of the ~26MB dashboard-state file).
 */
export async function readStoredAgentProfilesStrict(): Promise<AgentProfile[]> {
  const state = await readDashboardStateStrict();
  const raw = state.values[resolveProfilesKey(state.values)] ?? null;
  if (!raw) return [];
  return filterProfiles(JSON.parse(raw) as unknown);
}

export async function upsertStoredAgentProfile(agent: AgentProfile): Promise<AgentProfile> {
  const state = await readDashboardState();
  const key = resolveProfilesKey(state.values);
  await mutateDashboardStateValue(key, (current) => {
    const profiles = parseProfiles(current);
    return JSON.stringify([...profiles.filter((item) => item.id !== agent.id), agent]);
  });
  return agent;
}
