export type FleetMachineAccessDecision = "allow" | "ask" | "deny";

export type FleetMachineAccessCapability =
  | "sharedBrain"
  | "sharedEnv"
  | "chatHistory"
  | "connectedApps"
  | "messagingChannels"
  | "fileTransfers";

export const FLEET_MACHINE_ACCESS_CAPABILITIES: ReadonlyArray<{
  id: FleetMachineAccessCapability;
  label: string;
  description: string;
}> = [
  {
    id: "sharedBrain",
    label: "Shared Brain",
    description: "Read or search the synced vault, typed memory, and compiled knowledge.",
  },
  {
    id: "sharedEnv",
    label: "Shared env",
    description: "Use credentials and configuration replicated through the shared hive environment.",
  },
  {
    id: "chatHistory",
    label: "Chat history",
    description: "Read or resume fleet conversations beyond the agent's current task.",
  },
  {
    id: "connectedApps",
    label: "Other-machine apps",
    description: "Call apps and services advertised by another collector in the fleet.",
  },
  {
    id: "messagingChannels",
    label: "Messaging channels",
    description: "Send through connected hubs such as Telegram, Discord, Slack, or email.",
  },
  {
    id: "fileTransfers",
    label: "HiveDrop & files",
    description: "Receive or send fleet file transfers and targeted handoffs.",
  },
] as const;

export const FLEET_MACHINE_ACCESS_OPTIONS: ReadonlyArray<{
  value: FleetMachineAccessDecision;
  label: string;
}> = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
] as const;

export type FleetMachineAccessPolicy = Record<FleetMachineAccessCapability, FleetMachineAccessDecision>;

export type FleetMachineAccessRequestMarker =
  | { requested: false }
  | { requested: true; capability: FleetMachineAccessCapability | null; rawCapability: string };

export function parseFleetMachineAccessRequest(value: unknown): FleetMachineAccessRequestMarker {
  if (typeof value !== "string") return { requested: false };
  const match = value.match(/^FLEET ACCESS REQUEST:\s*([A-Za-z][A-Za-z0-9]*)\s*$/m);
  if (!match) return { requested: false };
  const rawCapability = match[1];
  const capability = FLEET_MACHINE_ACCESS_CAPABILITIES.some((item) => item.id === rawCapability)
    ? rawCapability as FleetMachineAccessCapability
    : null;
  return { requested: true, capability, rawCapability };
}

export type FleetMachinePerformancePolicy = {
  enabled: boolean;
  ignore: boolean;
  maxCpuPct: number;
  maxRamPct: number;
  maxDiskPct: number;
};

export type FleetMachinePolicyAuthority = {
  masterHubId: string;
  masterHubLabel: string;
  claimedAt: string;
};

export type FleetMachinePolicy = {
  version: 1;
  machineId: string;
  authority: FleetMachinePolicyAuthority | null;
  access: FleetMachineAccessPolicy;
  performance: FleetMachinePerformancePolicy;
  temporaryGrants: Partial<Record<FleetMachineAccessCapability, {
    grantedAt: number;
    expiresAt: number;
    grantedBy: string;
  }>>;
  updatedAt: string;
};

export type FleetMachinePolicySummary = Pick<FleetMachinePolicy, "version" | "authority" | "performance" | "updatedAt"> & {
  configured: boolean;
  valid?: boolean;
  error?: string;
};

export type FleetMachinePolicyResponse = {
  ok: boolean;
  policy: FleetMachinePolicy;
  effectiveAccess: FleetMachineAccessPolicy;
  configured: boolean;
  canManage: boolean;
  caller: { id: string; label: string };
  error?: string;
};

export const DEFAULT_FLEET_MACHINE_ACCESS_POLICY: FleetMachineAccessPolicy = {
  sharedBrain: "ask",
  sharedEnv: "ask",
  chatHistory: "ask",
  connectedApps: "ask",
  messagingChannels: "ask",
  fileTransfers: "ask",
};

export const DEFAULT_FLEET_MACHINE_PERFORMANCE_POLICY: FleetMachinePerformancePolicy = {
  enabled: true,
  ignore: false,
  maxCpuPct: 85,
  maxRamPct: 90,
  maxDiskPct: 95,
};

export function createDefaultFleetMachinePolicy(machineId = ""): FleetMachinePolicy {
  return {
    version: 1,
    machineId,
    authority: null,
    access: { ...DEFAULT_FLEET_MACHINE_ACCESS_POLICY },
    performance: { ...DEFAULT_FLEET_MACHINE_PERFORMANCE_POLICY },
    temporaryGrants: {},
    updatedAt: new Date(0).toISOString(),
  };
}
