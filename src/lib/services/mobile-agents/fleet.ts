import "server-only";

import { listMobileAgents } from "@/lib/services/mobile-agents/store";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  mobileAgentMachineKey,
  mobileAgentProfileFromRecord,
} from "@/lib/types/mobile-agents";

/**
 * Hub-stored mobile agents for one fleet phone, in the same AgentProfile
 * shape collector machines return from discovery. Matches the stored
 * machineKey against the device's tailnet name and dns label; for
 * single-phone fleets the single stored machineKey wins even when the iOS
 * device name differs from the tailnet hostname.
 */
export async function mobileAgentProfilesForMachine(input: {
  machineName: string;
  dnsName?: string;
  telemetryUrl?: string;
  onlyMobileDeviceInFleet?: boolean;
}): Promise<AgentProfile[]> {
  const agents = await listMobileAgents();
  if (agents.length === 0) return [];
  const deviceKeys = [
    mobileAgentMachineKey(input.machineName),
    mobileAgentMachineKey(input.dnsName),
  ].filter(Boolean);
  let matched = agents.filter((agent) => deviceKeys.includes(agent.machineKey));
  if (matched.length === 0 && input.onlyMobileDeviceInFleet) {
    const storedKeys = new Set(agents.map((agent) => agent.machineKey));
    if (storedKeys.size === 1) matched = agents;
  }
  return matched.map((agent) =>
    mobileAgentProfileFromRecord(agent, {
      machineName: input.machineName,
      telemetryUrl: input.telemetryUrl,
    }),
  );
}
