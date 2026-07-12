export const FLEET_AGENT_PAGE_SIZE = 3;

export function fleetAgentsForDisplay<T>(agents: T[], limit = FLEET_AGENT_PAGE_SIZE): T[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(FLEET_AGENT_PAGE_SIZE, Math.floor(limit))
    : agents.length;
  return agents.slice(0, safeLimit);
}

export function nextFleetAgentLimit(currentLimit = FLEET_AGENT_PAGE_SIZE): number {
  return Math.max(FLEET_AGENT_PAGE_SIZE, currentLimit) + FLEET_AGENT_PAGE_SIZE;
}
