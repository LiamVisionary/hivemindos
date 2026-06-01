import type { AgentProfile } from "@/lib/types/agent-runtime";

type FleetMachineIdentity = {
  self?: boolean;
  name?: string;
  dnsName?: string;
  os?: string;
  collectorUrl?: string;
  ip?: string;
};

type DiscoveredMachineIdentity = {
  device: FleetMachineIdentity;
  agents: unknown[];
  snapshots: unknown[];
};

export function collectorKey(url?: string) {
  if (!url?.trim()) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname}:${parsed.port || "80"}${path && path !== "/" ? path : ""}`;
  } catch {
    return url.trim();
  }
}

export function isLoopbackCollector(url?: string) {
  if (!url?.trim()) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function normalizeMachineName(value?: string) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

export function isHivemindMachineName(name?: string, dnsName?: string) {
  const dnsLabel = dnsName?.replace(/\.$/, "").split(".")[0] ?? "";
  return normalizeMachineName(name).startsWith("hivemindos")
    || normalizeMachineName(dnsLabel).startsWith("hivemindos");
}

export function isMobileMachineOs(os?: string) {
  return /^(ios|android)$/i.test(os ?? "");
}

export function isMacMachineOs(os?: string) {
  return /^(macos|darwin)$/i.test(os ?? "");
}

export function isVisibleFleetMachine(machine: Pick<FleetMachineIdentity, "name" | "dnsName" | "os">) {
  return isHivemindMachineName(machine.name, machine.dnsName) || isMacMachineOs(machine.os);
}

export function machineHivemindBase(name?: string, dnsName?: string, os?: string) {
  const rawDnsLabel = dnsName?.replace(/\.$/, "").split(".")[0]?.toLowerCase() ?? "";
  const rawName = name?.toLowerCase() ?? "";
  const rawValue = normalizeMachineName(rawName).startsWith("hivemindos") ? rawName : rawDnsLabel;
  const canonicalValue = isMacMachineOs(os) ? rawValue.replace(/-\d+$/, "") : rawValue;
  const value = normalizeMachineName(canonicalValue);
  if (!value.startsWith("hivemindos")) return "";
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "");
}

export function machinePhysicalBase(name?: string, dnsName?: string) {
  const dnsLabel = dnsName?.replace(/\.$/, "").split(".")[0] ?? "";
  const value = normalizeMachineName(dnsLabel) || normalizeMachineName(name);
  return value.replace(/^hivemindos/, "").replace(/local\d*$/, "").replace(/\d+$/, "");
}

function macNumberedHostnameBase(name?: string, dnsName?: string, os?: string) {
  if (!isMacMachineOs(os)) return "";
  const rawDnsLabel = dnsName?.replace(/\.$/, "").split(".")[0] ?? "";
  const rawValue = rawDnsLabel || name || "";
  const withoutTailnetSuffix = rawValue.toLowerCase().replace(/-\d+$/, "");
  const normalizedValue = normalizeMachineName(rawValue);
  const normalizedBase = normalizeMachineName(withoutTailnetSuffix);
  return normalizedBase && normalizedBase !== normalizedValue ? normalizedBase : "";
}

export function isLocalLinkDuplicateOfSelf(self: FleetMachineIdentity | undefined, device: FleetMachineIdentity) {
  if (!self || device.self) return false;
  const deviceBase = machineHivemindBase(device.name, device.dnsName, device.os);
  const selfBase = machineHivemindBase(self.name, self.dnsName, self.os);
  if (selfBase && deviceBase && selfBase === deviceBase) return true;
  const physicalSelfBase = machinePhysicalBase(self.name, self.dnsName);
  const physicalDeviceBase = machinePhysicalBase(device.name, device.dnsName);
  if (physicalSelfBase && physicalDeviceBase && physicalSelfBase === physicalDeviceBase) return true;
  if (physicalSelfBase && deviceBase && physicalSelfBase === deviceBase) return true;
  return Boolean(selfBase && physicalDeviceBase && selfBase === physicalDeviceBase);
}

export function displayMachineName(
  name: string,
  self?: boolean,
  options?: { os?: string; mobileViewer?: boolean },
) {
  if (self) {
    const os = options?.os?.toLowerCase() ?? "";
    const localLabel = os === "windows" || os === "win32"
      ? "This PC"
      : os === "linux"
        ? "This computer"
        : "This Mac";
    if (!options?.mobileViewer) return localLabel;
    if (localLabel === "This PC") return "Dashboard PC";
    if (localLabel === "This computer") return "Dashboard computer";
    return "Dashboard Mac";
  }
  return name.replace(/^hivemindos[-_]?/i, "") || name;
}

export function shouldPreserveMissingDiscoveredMachine(machine: DiscoveredMachineIdentity) {
  if (!isVisibleFleetMachine({
    name: machine.device.name,
    dnsName: machine.device.dnsName,
    os: machine.device.os,
  })) {
    return false;
  }
  return machine.agents.length > 0 || machine.snapshots.length > 0;
}

export function machineIdentityFromParts({
  self,
  name,
  dnsName,
  collectorUrl,
  ip,
  os,
}: FleetMachineIdentity) {
  const dnsLabel = dnsName?.replace(/\.$/, "").split(".")[0] ?? "";
  const normalizedDnsName = normalizeMachineName(dnsLabel);
  const normalizedName = normalizeMachineName(name) || normalizedDnsName;
  if (normalizedName.startsWith("hivemindos")) {
    return machineHivemindBase(name, dnsName, os) || normalizedDnsName || normalizedName;
  }
  if (self) return "self";
  const macBase = macNumberedHostnameBase(name, dnsName, os);
  if (macBase) return macBase;
  return normalizedName || collectorKey(collectorUrl) || ip || "";
}

export function normalizeAgentPath(path?: string) {
  return path
    ?.trim()
    .replace(/^~(?=$|\/)/, "$home")
    .replace(/\/+$/, "")
    .toLowerCase() ?? "";
}

function agentRoleScope(agent: AgentProfile) {
  return agent.beeRole === "queen" || /^queen-bee-/i.test(agent.id) ? ":queen" : "";
}

function normalizedAgentName(value?: string) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function relaxedAgentIdentity(agent: AgentProfile) {
  return [
    agent.runtime,
    agentRoleScope(agent),
    normalizeMachineName(agent.machineName),
    agent.aeonRepo?.trim().toLowerCase() || "",
    normalizeAgentPath(agent.localDataDir),
    agent.agentId?.trim().toLowerCase() || "",
    normalizedAgentName(agent.name),
  ].join("|");
}

function uniqueAgentMatch(
  agent: AgentProfile,
  autoDiscoveredAgents: AgentProfile[],
  matches: (candidate: AgentProfile) => boolean,
) {
  const candidates = autoDiscoveredAgents.filter((candidate) => candidate.id !== agent.id && matches(candidate));
  if (candidates.length === 1) return candidates[0];
  const identities = new Set(candidates.map(relaxedAgentIdentity));
  if (identities.size === 1) return candidates.find((candidate) => candidate.telemetryUrl?.trim()) ?? candidates[0];
  return undefined;
}

export function agentWorkspaceKey(agent: AgentProfile) {
  const roleScope = agentRoleScope(agent);
  const dataDir = normalizeAgentPath(agent.localDataDir);
  if (dataDir) {
    const collector = collectorKey(agent.telemetryUrl) || "unattached";
    const canonicalHermesHome = dataDir === "$home/.hermes" || dataDir.endsWith("/.hermes");
    return `${agent.runtime}:data:${collector}:${canonicalHermesHome ? "$home/.hermes" : dataDir}${roleScope}`;
  }
  const telemetry = collectorKey(agent.telemetryUrl);
  if (telemetry) return `${agent.runtime}:telemetry:${telemetry}:${agent.agentId || agent.name}${roleScope}`;
  return `${agent.runtime}:id:${agent.id}${roleScope}`;
}

export function collectorRuntimeKey(agent: AgentProfile) {
  const collector = collectorKey(agent.telemetryUrl);
  return collector ? `${agent.runtime}:collector:${collector}` : "";
}

export function renderAgentKey(agent: AgentProfile, index: number) {
  return [
    agent.id || "agent",
    agent.runtime,
    collectorKey(agent.telemetryUrl),
    agent.localDataDir?.trim() || agent.machineName || "",
    index,
  ].filter(Boolean).join(":");
}

export function agentAliasTarget(agent: AgentProfile, autoDiscoveredAgents: AgentProfile[]) {
  const sameId = agent.id ? autoDiscoveredAgents.find((candidate) => candidate.id === agent.id) : undefined;
  if (sameId) return sameId;

  const exactKey = agentWorkspaceKey(agent);
  const exact = autoDiscoveredAgents.find((candidate) => candidate.id !== agent.id && agentWorkspaceKey(candidate) === exactKey);
  if (exact) return exact;

  const roleScope = agentRoleScope(agent);
  const dataDir = normalizeAgentPath(agent.localDataDir);
  if (dataDir) {
    const dataDirMatch = uniqueAgentMatch(agent, autoDiscoveredAgents, (candidate) => (
      candidate.runtime === agent.runtime
      && agentRoleScope(candidate) === roleScope
      && normalizeAgentPath(candidate.localDataDir) === dataDir
    ));
    if (dataDirMatch) return dataDirMatch;
  }

  const aeonRepo = agent.aeonRepo?.trim().toLowerCase();
  if (agent.runtime === "aeon" && aeonRepo) {
    const repoMatch = uniqueAgentMatch(agent, autoDiscoveredAgents, (candidate) => (
      candidate.runtime === "aeon"
      && agentRoleScope(candidate) === roleScope
      && candidate.aeonRepo?.trim().toLowerCase() === aeonRepo
    ));
    if (repoMatch) return repoMatch;
  }

  const agentId = agent.agentId?.trim().toLowerCase();
  const name = normalizedAgentName(agent.name);
  if (agentId && name) {
    const idMatch = uniqueAgentMatch(agent, autoDiscoveredAgents, (candidate) => (
      candidate.runtime === agent.runtime
      && agentRoleScope(candidate) === roleScope
      && candidate.agentId?.trim().toLowerCase() === agentId
      && normalizedAgentName(candidate.name) === name
    ));
    if (idMatch) return idMatch;
  }

  if (name) {
    return uniqueAgentMatch(agent, autoDiscoveredAgents, (candidate) => (
      candidate.runtime === agent.runtime
      && agentRoleScope(candidate) === roleScope
      && normalizedAgentName(candidate.name) === name
    ));
  }

  return undefined;
}

export function agentAliasMap(configuredAgents: AgentProfile[], autoDiscoveredAgents: AgentProfile[]) {
  const entries: Array<readonly [string, string]> = [];
  configuredAgents.forEach((agent) => {
    const target = agentAliasTarget(agent, autoDiscoveredAgents);
    if (target && !entries.some(([aliasId]) => aliasId === target.id)) {
      entries.push([target.id, agent.id] as const);
    }
  });
  return new Map(entries);
}
