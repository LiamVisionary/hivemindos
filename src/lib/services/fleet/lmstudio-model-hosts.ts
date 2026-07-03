import type { AgentProfile } from "@/lib/types/agent-runtime";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

/**
 * Fleet-wide LM Studio model resolution. Every HivemindOS machine's collector
 * reverse-proxies its local LM Studio at /lmstudio/*, so a model hosted
 * anywhere in the fleet is reachable without any manual LM Studio network
 * setup. When an lm-studio agent's model is not served by its own machine,
 * this resolver finds a fleet machine that hosts it and returns that
 * collector's proxy base URL for a per-run override (Hermes LM_BASE_URL).
 */

type FleetLmStudioHost = {
  collectorUrl: string;
  machineName: string;
  models: Array<{ key: string; loaded: boolean }>;
};

const HOSTS_CACHE_MS = 20_000;
const INVENTORY_TIMEOUT_MS = 3_000;
let hostsCache: { at: number; hosts: FleetLmStudioHost[] } | null = null;
let hostsInFlight: Promise<FleetLmStudioHost[]> | null = null;

function modelMatches(key: string, model: string) {
  return key === model || key.endsWith(`/${model}`) || model.endsWith(`/${key}`);
}

async function fetchHostInventory(collectorUrl: string, machineName: string): Promise<FleetLmStudioHost | null> {
  try {
    const response = await fetch(`${collectorUrl}/lmstudio/api/v1/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null) as {
      models?: Array<{ key?: string; type?: string; loaded_instances?: unknown[] }>;
    } | null;
    const models = (data?.models ?? [])
      .filter((model) => model?.key && model.type !== "embedding")
      .map((model) => ({
        key: String(model.key).trim(),
        loaded: Array.isArray(model.loaded_instances) && model.loaded_instances.length > 0,
      }))
      .filter((model) => model.key);
    return { collectorUrl, machineName, models };
  } catch {
    return null;
  }
}

async function fleetLmStudioHosts(requestUrl: string): Promise<FleetLmStudioHost[]> {
  if (hostsCache && Date.now() - hostsCache.at < HOSTS_CACHE_MS) return hostsCache.hosts;
  if (hostsInFlight) return hostsInFlight;
  hostsInFlight = (async () => {
    const fleetUrl = new URL("/api/fleet/discover", requestUrl);
    fleetUrl.searchParams.set("includeSnapshots", "0");
    const fleetResponse = await fetch(fleetUrl, { cache: "no-store", headers: internalApiAuthHeaders(), signal: AbortSignal.timeout(12_000) }).catch(() => null);
    const fleet = fleetResponse?.ok
      ? await fleetResponse.json().catch(() => null) as {
        machines?: Array<{ collector?: string; device?: { collectorUrl?: string; name?: string } }>;
      } | null
      : null;
    const targets: Array<{ url: string; name: string }> = [];
    const seen = new Set<string>();
    for (const machine of fleet?.machines ?? []) {
      const url = String(machine?.device?.collectorUrl ?? "").trim().replace(/\/+$/, "");
      if (!url || machine.collector !== "ready" || seen.has(url)) continue;
      seen.add(url);
      targets.push({ url, name: machine.device?.name || "remote machine" });
    }
    const hosts = (await Promise.all(targets.map((target) => fetchHostInventory(target.url, target.name))))
      .filter((host): host is FleetLmStudioHost => Boolean(host));
    hostsCache = { at: Date.now(), hosts };
    return hosts;
  })().finally(() => {
    hostsInFlight = null;
  });
  return hostsInFlight;
}

/**
 * Returns a per-run base URL override when the agent's model is hosted on a
 * different fleet machine, or null when the agent's own machine serves it
 * (or no host is found, in which case the local default applies and errors
 * surface normally).
 */
export async function resolveLmStudioFleetBaseUrl(
  profile: AgentProfile,
  agentCollectorUrl: string,
  requestUrl: string,
): Promise<{ baseUrl: string; machineName: string } | null> {
  const model = String(profile.model ?? "").trim();
  if (!model || String(profile.provider ?? "").trim() !== "lm-studio") return null;
  const ownUrl = agentCollectorUrl.trim().replace(/\/+$/, "");
  if (ownUrl) {
    const own = await fetchHostInventory(ownUrl, "this machine");
    // The agent's own machine hosts the model: keep the default local base so
    // load state and errors stay visible where the agent runs.
    if (own?.models.some((entry) => modelMatches(entry.key, model))) return null;
  }
  const hosts = await fleetLmStudioHosts(requestUrl).catch(() => []);
  const candidates = hosts
    .map((host) => ({
      host,
      match: host.models.find((entry) => modelMatches(entry.key, model)),
    }))
    .filter((entry) => entry.match && entry.host.collectorUrl !== ownUrl);
  const best = candidates.find((entry) => entry.match?.loaded) ?? candidates[0];
  if (!best) return null;
  return {
    baseUrl: `${best.host.collectorUrl}/lmstudio/v1`,
    machineName: best.host.machineName,
  };
}
