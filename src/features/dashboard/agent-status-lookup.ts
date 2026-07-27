/* agent-status-lookup.ts — pure helpers to find and summarize LIVE fleet/agent
 * status for prompt contexts. Consumer: the Queen's chat-only `read_agent_status`
 * tool, which answers "is HermesMain online / why is it timing out?" from the
 * real /api/fleet/discover telemetry instead of deflecting or asserting an
 * unverified failure. Dependency-free so the hermetic suite drives them
 * directly; fetching stays in the caller (queen-chat-store), mirroring
 * work-board-lookup.ts.
 *
 * Shape source (confirmed 2026-07-04 against the discover + snapshot routes):
 * /api/fleet/discover?includeSnapshots=1 returns `{ machines: [...] }` where each
 * machine carries `device` (online), a `collector` status string, an optional
 * `reportedUnreachableBy` (reverse-reachability / asymmetric partition — the
 * signal behind most "timeouts"), `agents[]` (config) and `snapshots[]`
 * (AgentSnapshot: ok / runtimeReachable / processRunning / summary / error /
 * warning / tasks). A snapshot ties to an agent by `snapshot.agentId === agent.id`.
 */

export type FleetTaskLite = {
  title?: string;
  status?: string;
  lastMessage?: string;
  updatedAt?: number;
};

export type FleetSnapshotLite = {
  agentId?: string;
  ok?: boolean;
  runtimeReachable?: boolean;
  processRunning?: boolean;
  summary?: string;
  error?: string;
  warning?: string;
  tasks?: FleetTaskLite[];
};

export type FleetAgentLite = {
  id?: string;
  agentId?: string;
  name?: string;
  runtime?: string;
  workerClass?: string;
  beeRole?: string;
};

export type FleetMachineLite = {
  device?: { name?: string; os?: string; online?: boolean; self?: boolean };
  collector?: string;
  reportedUnreachableBy?: string[];
  agents?: FleetAgentLite[];
  snapshots?: FleetSnapshotLite[];
};

/** One agent resolved against its machine and (if probed) its live snapshot. */
export type ResolvedAgentStatus = {
  agent: FleetAgentLite;
  machine: FleetMachineLite;
  snapshot?: FleetSnapshotLite;
};

/**
 * Flatten the discover `machines` payload into one entry per agent, each joined
 * to its machine and its live snapshot (matched by `snapshot.agentId === agent.id`,
 * falling back to `agent.agentId`). Tolerates a missing/garbled payload by
 * degrading to fewer results rather than throwing.
 */
export function flattenFleetAgents(machines: unknown): ResolvedAgentStatus[] {
  if (!Array.isArray(machines)) return [];
  const out: ResolvedAgentStatus[] = [];
  for (const raw of machines) {
    if (!raw || typeof raw !== "object") continue;
    const machine = raw as FleetMachineLite;
    const agents = Array.isArray(machine.agents) ? machine.agents : [];
    const snapshots = Array.isArray(machine.snapshots) ? machine.snapshots : [];
    for (const agent of agents) {
      if (!agent || typeof agent !== "object") continue;
      const snapshot = snapshots.find(
        (snap) =>
          snap &&
          typeof snap === "object" &&
          typeof snap.agentId === "string" &&
          (snap.agentId === agent.id || snap.agentId === agent.agentId),
      );
      out.push({ agent, machine, snapshot });
    }
  }
  return out;
}

/** Exact name/id match (case-insensitive) first, then substring. */
export function findFleetAgents(
  entries: ResolvedAgentStatus[],
  lookup: { name?: string; query?: string },
): ResolvedAgentStatus[] {
  const needle = (lookup.name ?? lookup.query ?? "").trim().toLowerCase();
  if (!needle) return [];
  const nameOf = (entry: ResolvedAgentStatus) => (entry.agent.name ?? "").toLowerCase();
  const idOf = (entry: ResolvedAgentStatus) => (entry.agent.id ?? entry.agent.agentId ?? "").toLowerCase();
  const exact = entries.filter((entry) => nameOf(entry) === needle || idOf(entry) === needle);
  if (exact.length) return exact;
  return entries.filter((entry) => nameOf(entry).includes(needle) || idOf(entry).includes(needle));
}

const snippet = (value: string | null | undefined, max = 320) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** True when the agent's machine is reachable AND its collector is serving. */
export function isMachineOnline(machine: FleetMachineLite): boolean {
  return machine.device?.online === true && machine.collector === "ready";
}

/**
 * True when the agent shows a POSITIVE trouble signal — machine down, reported
 * unreachable by a peer (asymmetric partition), or a live snapshot that is not
 * OK / unreachable / carrying an error. A configured agent on an online machine
 * that simply wasn't probed (no snapshot) is NOT flagged, to avoid nagging.
 */
export function isAgentUnhealthy(entry: ResolvedAgentStatus): boolean {
  if (!isMachineOnline(entry.machine)) return true;
  const reportedUnreachableBy = entry.machine.reportedUnreachableBy;
  if (Array.isArray(reportedUnreachableBy) && reportedUnreachableBy.length) return true;
  const snap = entry.snapshot;
  if (!snap) return false;
  return snap.ok === false || snap.runtimeReachable === false || Boolean(snap.error);
}

/** One agent as a compact fact block a model can reason over. */
export function formatAgentStatusForPrompt(entry: ResolvedAgentStatus): string {
  const { agent, machine, snapshot } = entry;
  const online = isMachineOnline(machine);
  const machineState = online
    ? "online"
    : machine.device?.online
      ? `reachable, collector ${machine.collector ?? "unknown"}`
      : "offline";
  const lines: (string | null)[] = [
    `Agent ${agent.name ?? agent.id ?? "?"}${agent.runtime ? ` (${agent.runtime})` : ""}`,
    `Machine: ${machine.device?.name ?? "?"}${machine.device?.os ? ` · ${machine.device.os}` : ""} — ${machineState}`,
  ];
  if (Array.isArray(machine.reportedUnreachableBy) && machine.reportedUnreachableBy.length) {
    lines.push(
      `Reported unreachable by: ${machine.reportedUnreachableBy.join(", ")} (asymmetric tailnet partition — a likely timeout source)`,
    );
  }
  if (snapshot) {
    const health = snapshot.ok
      ? "healthy"
      : snapshot.runtimeReachable
        ? "reachable but not OK"
        : snapshot.processRunning
          ? "process up, runtime unreachable"
          : "unreachable";
    lines.push(
      `Health: ${health} (runtime ${snapshot.runtimeReachable ? "reachable" : "unreachable"}, process ${snapshot.processRunning ? "running" : "not running"})`,
    );
    if (snapshot.summary) lines.push(`Summary: ${snippet(snapshot.summary)}`);
    if (snapshot.error) lines.push(`Error: ${snippet(snapshot.error)}`);
    if (snapshot.warning) lines.push(`Warning: ${snippet(snapshot.warning)}`);
    const failed = (Array.isArray(snapshot.tasks) ? snapshot.tasks : [])
      .filter((task) => task?.status === "failed")
      .slice(0, 3);
    for (const task of failed) {
      lines.push(`Recent failure — ${task.title ?? "(untitled)"}: ${snippet(task.lastMessage) || "no detail"}`);
    }
  } else {
    lines.push("No live snapshot returned (agent is configured, but no runtime probe answered — it may be offline).");
  }
  return lines.filter(Boolean).join("\n");
}

/** Fleet totals — the no-arguments answer for `read_agent_status`. */
export function summarizeFleetByStatus(entries: ResolvedAgentStatus[]): string {
  if (!entries.length) return "No agents found in the fleet right now.";
  let online = 0;
  let unreachable = 0;
  let erroring = 0;
  for (const entry of entries) {
    const snap = entry.snapshot;
    if (snap?.error || snap?.ok === false) erroring += 1;
    if (isMachineOnline(entry.machine) && (!snap || snap.ok !== false)) online += 1;
    else unreachable += 1;
  }
  return `Fleet status — ${entries.length} agent${entries.length === 1 ? "" : "s"}: ${online} online, ${unreachable} offline or unreachable, ${erroring} reporting errors.`;
}

/**
 * A model-facing "next step" nudge appended to a NAMED status read when any of
 * the matched agents show trouble: tells the Queen to OFFER a diagnosis-and-fix
 * job (via create_hive_task) and create it only on the user's confirmation —
 * propose-and-confirm, never silent dispatch. Returns null when all healthy.
 */
export function fixTaskSuggestion(entries: ResolvedAgentStatus[]): string | null {
  const unhealthy = entries.filter(isAgentUnhealthy);
  if (!unhealthy.length) return null;
  const names = unhealthy.map((entry) => entry.agent.name ?? entry.agent.id ?? "the agent");
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const plural = names.length === 1 ? "s" : "";
  return (
    `Suggested next step: ${list} look${plural} unhealthy. Offer to queue a ` +
    `"Diagnose & fix ${names[0]}" job with create_hive_task (put the status details in the message), ` +
    `and create it only once the user agrees.`
  );
}
