import type { NextRequest } from "next/server";
import type { RemoteBrainSkillProviderInventory } from "@/lib/services/obsidian/brain-skills";

export async function remoteSkillProviders(
  request: NextRequest,
  options: { includeSourceFiles?: boolean; fleetTimeoutMs?: number; collectorTimeoutMs?: number } = {},
): Promise<RemoteBrainSkillProviderInventory[]> {
  const fleetUrl = new URL("/api/fleet/discover", request.url);
  fleetUrl.searchParams.set("includeSnapshots", "0");
  const fleetResponse = await fetch(fleetUrl, { cache: "no-store", signal: AbortSignal.timeout(options.fleetTimeoutMs ?? 12_000) }).catch(() => null);
  if (!fleetResponse?.ok) return [];
  const fleet = await fleetResponse.json().catch(() => null) as {
    machines?: Array<{
      collector?: string;
      device?: { collectorUrl?: string; name?: string };
      capabilities?: { skillInventory?: boolean };
    }>;
  } | null;
  const collectors = (fleet?.machines ?? [])
    .filter((machine) => machine.collector === "ready" && machine.device?.collectorUrl && machine.capabilities?.skillInventory)
    .map((machine) => ({ url: machine.device!.collectorUrl!, machineName: machine.device?.name || "remote machine" }));

  const responses = await Promise.all(collectors.map(async (collector) => {
    const url = new URL(`${collector.url.replace(/\/+$/, "")}/skills`);
    if (options.includeSourceFiles) url.searchParams.set("includeSourceFiles", "true");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(options.collectorTimeoutMs ?? (options.includeSourceFiles ? 60_000 : 12_000)),
    }).catch(() => null);
    if (!response?.ok) return [];
    const payload = await response.json().catch(() => null) as { providers?: RemoteBrainSkillProviderInventory[] } | null;
    return (payload?.providers ?? []).map((provider) => ({
      ...provider,
      skills: provider.skills.map((skill) => ({
        ...skill,
        sourceMachine: skill.sourceMachine ?? collector.machineName,
      })),
    }));
  }));

  return responses.flat();
}

export async function fleetSkillCollectors(request: NextRequest) {
  const fleetUrl = new URL("/api/fleet/discover", request.url);
  fleetUrl.searchParams.set("includeSnapshots", "0");
  const fleetResponse = await fetch(fleetUrl, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!fleetResponse?.ok) return [];
  const fleet = await fleetResponse.json().catch(() => null) as {
    machines?: Array<{
      collector?: string;
      device?: { collectorUrl?: string; name?: string };
      capabilities?: { skillInventory?: boolean };
    }>;
  } | null;
  return (fleet?.machines ?? [])
    .filter((machine) => machine.collector === "ready" && machine.device?.collectorUrl && machine.capabilities?.skillInventory)
    .map((machine) => ({
      url: machine.device!.collectorUrl!.replace(/\/+$/, ""),
      machineName: machine.device?.name || "remote machine",
    }));
}
