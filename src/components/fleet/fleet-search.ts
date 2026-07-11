import type { AgentState, FleetAgent, FleetMachine } from "./fleet-data";

export type FleetSearchFilter = "all" | "working" | "attention" | "idle";

export type FleetSearchItem = {
  key: string;
  kind: "machine" | "agent";
  machineId: string;
  agentId?: string;
  label: string;
  detail: string;
  state: AgentState;
  attention: boolean;
  primaryText: string;
  searchText: string;
};

export type FleetFocus = {
  active: boolean;
  machineIds: string[];
  agentIds: string[];
};

export function normalizeFleetSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function fleetMachineNeedsAttention(machine: FleetMachine) {
  return machine.versionState !== "current"
    || machine.agents.some((agent) => agent.state === "failed" || agent.state === "setup");
}

export function fleetAgentMatchesFilter(agent: FleetAgent, filter: FleetSearchFilter) {
  if (filter === "all") return true;
  if (filter === "working") return agent.state === "working";
  if (filter === "attention") return agent.state === "failed" || agent.state === "setup";
  return agent.state === "ready" || agent.state === "scheduled";
}

export function fleetMachineSearchText(machine: FleetMachine) {
  return normalizeFleetSearch([
    machine.id,
    machine.name,
    machine.kind,
    machine.role,
    machine.os,
    machine.location,
    machine.city,
    machine.ip,
    machine.tailnet,
    machine.uptime,
  ].filter(Boolean).join(" "));
}

export function fleetAgentSearchText(agent: FleetAgent, machine?: FleetMachine) {
  return normalizeFleetSearch([
    agent.id,
    agent.name,
    agent.runtime,
    agent.role,
    agent.task,
    agent.provider,
    agent.model,
    agent.state,
    machine ? fleetMachineSearchText(machine) : "",
  ].filter(Boolean).join(" "));
}

function fleetMachineState(machine: FleetMachine): AgentState {
  if (machine.agents.some((agent) => agent.state === "failed")) return "failed";
  if (machine.versionState === "needs-setup" || machine.agents.some((agent) => agent.state === "setup")) return "setup";
  if (machine.agents.some((agent) => agent.state === "working")) return "working";
  if (machine.agents.some((agent) => agent.state === "scheduled")) return "scheduled";
  return "ready";
}

function machineDetail(machine: FleetMachine) {
  const agentLabel = `${machine.agents.length} agent${machine.agents.length === 1 ? "" : "s"}`;
  return [machine.kind, machine.location || machine.city, agentLabel].filter(Boolean).join(" · ");
}

function agentDetail(agent: FleetAgent, machine: FleetMachine) {
  return [agent.runtime, agent.role, `on ${machine.name}`].filter(Boolean).join(" · ");
}

export function buildFleetSearchIndex(machines: FleetMachine[]): FleetSearchItem[] {
  return machines.flatMap((machine) => {
    const machineItem: FleetSearchItem = {
      key: `machine:${machine.id}`,
      kind: "machine",
      machineId: machine.id,
      label: machine.name,
      detail: machineDetail(machine),
      state: fleetMachineState(machine),
      attention: fleetMachineNeedsAttention(machine),
      primaryText: normalizeFleetSearch(machine.name),
      searchText: fleetMachineSearchText(machine),
    };
    const agentItems = machine.agents.map((agent): FleetSearchItem => ({
      key: `agent:${agent.id}`,
      kind: "agent",
      machineId: machine.id,
      agentId: agent.id,
      label: agent.name,
      detail: agentDetail(agent, machine),
      state: agent.state,
      attention: agent.state === "failed" || agent.state === "setup",
      primaryText: normalizeFleetSearch(agent.name),
      searchText: fleetAgentSearchText(agent, machine),
    }));
    return [machineItem, ...agentItems];
  });
}

function matchScore(item: FleetSearchItem, query: string) {
  if (!query) return 0;
  const tokens = query.split(" ").filter(Boolean);
  if (!tokens.every((token) => item.searchText.includes(token))) return -1;

  let score = 400;
  if (item.primaryText === query) score = 1_000;
  else if (item.primaryText.startsWith(query)) score = 880;
  else if (item.primaryText.split(" ").some((word) => word.startsWith(query))) score = 760;
  else if (item.primaryText.includes(query)) score = 680;
  else if (tokens.every((token) => item.primaryText.includes(token))) score = 580;

  if (item.kind === "machine") score += 8;
  return score;
}

export function searchFleetIndex(index: FleetSearchItem[], query: string, limit = 30) {
  const normalized = normalizeFleetSearch(query);
  if (!normalized) return [];
  return index
    .map((item) => ({ item, score: matchScore(item, normalized) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}

export function buildFleetFocus(
  machines: FleetMachine[],
  index: FleetSearchItem[],
  query: string,
  filter: FleetSearchFilter,
): FleetFocus {
  const queryActive = Boolean(normalizeFleetSearch(query));
  const active = queryActive || filter !== "all";
  if (!active) return { active: false, machineIds: [], agentIds: [] };

  const searchMatches = queryActive ? searchFleetIndex(index, query, Number.MAX_SAFE_INTEGER) : index;
  const matchingMachines = new Set(searchMatches.filter((item) => item.kind === "machine").map((item) => item.machineId));
  const matchingAgents = new Set(searchMatches.filter((item) => item.kind === "agent").map((item) => item.agentId));
  const machineIds: string[] = [];
  const agentIds: string[] = [];

  for (const machine of machines) {
    const machineQueryMatch = !queryActive || matchingMachines.has(machine.id);
    const queryMatchingAgents = machine.agents.filter((agent) => (
      !queryActive || machineQueryMatch || matchingAgents.has(agent.id)
    ));
    const filteredAgents = queryMatchingAgents.filter((agent) => fleetAgentMatchesFilter(agent, filter));
    const machineFilterMatch = filter === "all"
      || (filter === "attention" ? fleetMachineNeedsAttention(machine) : filteredAgents.length > 0);
    const machineQueryContext = machineQueryMatch || queryMatchingAgents.length > 0;

    if (machineFilterMatch && machineQueryContext) machineIds.push(machine.id);
    agentIds.push(...filteredAgents.map((agent) => agent.id));
  }

  return { active, machineIds, agentIds };
}
