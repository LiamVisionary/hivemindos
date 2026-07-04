/* agent-status-fetch.ts — client-side fetch wrapper that turns a `read_agent_status`
 * tool call into a ready-to-relay answer string. Shared by BOTH Queen surfaces so
 * they answer identically: the typed chat executor (queen-chat-store) and the
 * realtime voice executor (use-queen-bee-realtime). All matching/formatting lives
 * in agent-status-lookup.ts (dependency-free, hermetically tested); this only adds
 * the fetch + case branching, so there is nothing here the pure helpers don't cover.
 */
import {
  findFleetAgents,
  fixTaskSuggestion,
  flattenFleetAgents,
  formatAgentStatusForPrompt,
  summarizeFleetByStatus,
} from "./agent-status-lookup";

export async function fetchAgentStatusAnswer(agentName: string): Promise<string> {
  let res: Response;
  try {
    // Same discover payload the dashboard fleet view renders; fresh=1 bypasses
    // the 15s cache for an explicit status check, bounded by a client timeout.
    res = await fetch("/api/fleet/discover?includeSnapshots=1&fresh=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return "The fleet status isn't reachable right now.";
  }
  const data = (await res.json().catch(() => null)) as { machines?: unknown } | null;
  if (!res.ok || !data) return "The fleet status isn't reachable right now.";
  const agents = flattenFleetAgents(data.machines);
  const name = agentName.trim();
  if (!name) return summarizeFleetByStatus(agents);
  const hits = findFleetAgents(agents, { name });
  if (!hits.length) {
    return `No agent named "${name}" is in the fleet right now. ${summarizeFleetByStatus(agents)}`;
  }
  const top = hits.slice(0, 3);
  // Propose-and-confirm: an unhealthy match carries a create_hive_task nudge; the
  // Queen still waits for the user's yes before dispatching a fix.
  return [...top.map(formatAgentStatusForPrompt), fixTaskSuggestion(top)].filter(Boolean).join("\n\n");
}
