import {
  dashboardStateValue,
  saveDashboardStateValue,
  type DashboardStateSnapshot,
} from "@/lib/services/dashboard-state-client";
import type { AgentRuntime } from "@/lib/types/agent-runtime";

/**
 * Most-recently-used agent runtime. Used to pre-select the runtime when the
 * user OPENS the add-agent modal (never when editing an existing agent), so the
 * modal opens on whatever the user reached for last instead of a fixed default.
 * Updated when the user picks a runtime in the create flow or creates an agent.
 */
const MRU_RUNTIME_KEY = "hivemindos.agentCreate.lastRuntime.v1";

let cache: AgentRuntime | null = null;

export function mruRuntime(): AgentRuntime | null {
  return cache;
}

export function rememberMruRuntime(runtime: AgentRuntime | undefined | null): void {
  if (!runtime) return;
  cache = runtime;
  void saveDashboardStateValue(MRU_RUNTIME_KEY, runtime);
}

/** Seed the in-memory cache from a loaded dashboard snapshot on first hydration. */
export function hydrateMruRuntime(snapshot: DashboardStateSnapshot): void {
  if (cache) return;
  const stored = dashboardStateValue(snapshot, MRU_RUNTIME_KEY);
  if (stored) cache = stored as AgentRuntime;
}
