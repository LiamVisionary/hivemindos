import type { AgentProfile } from "@/lib/types/agent-runtime";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

/**
 * Fleet-wide local model resolution. Every HivemindOS machine's collector
 * reverse-proxies its local LM Studio at /lmstudio/* and arbitrary local app
 * ports at /app-proxy/<port>/*, so a model hosted anywhere in the fleet is
 * reachable without manual Tailnet URL setup. When an lm-studio/Local agent's
 * model is served by another local OpenAI-compatible process (LM Studio,
 * llama-server, vLLM, etc.), this resolver returns that collector proxy base
 * URL for a per-run override (Hermes LM_BASE_URL).
 */

type FleetLmStudioHost = {
  collectorUrl: string;
  machineName: string;
  models: Array<{ key: string; loaded: boolean; baseUrl: string; source: string; port?: number }>;
};

const HOSTS_CACHE_MS = 20_000;
const INVENTORY_TIMEOUT_MS = 3_000;
const OPENAI_COMPATIBLE_PORTS = [1234, 1244, 8000, 8080, 11434];
let hostsCache: { at: number; hosts: FleetLmStudioHost[] } | null = null;
let hostsInFlight: Promise<FleetLmStudioHost[]> | null = null;

function modelMatches(key: string, model: string) {
  return key === model || key.endsWith(`/${model}`) || model.endsWith(`/${key}`);
}

function openAIServerLabel(port: number) {
  if (port === 1234) return "LM Studio OpenAI server";
  if (port === 1244) return "llama.cpp server";
  if (port === 11434) return "Ollama server";
  if (port === 8000 || port === 8080) return "vLLM/OpenAI server";
  return `OpenAI server :${port}`;
}

async function fetchLmStudioInventory(collectorUrl: string) {
  try {
    const response = await fetch(`${collectorUrl}/lmstudio/api/v1/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => null) as {
      models?: Array<{ key?: string; type?: string; loaded_instances?: unknown[] }>;
    } | null;
    return (data?.models ?? [])
      .filter((model) => model?.key && model.type !== "embedding")
      .map((model) => ({
        key: String(model.key).trim(),
        loaded: Array.isArray(model.loaded_instances) && model.loaded_instances.length > 0,
        baseUrl: `${collectorUrl}/lmstudio/v1`,
        source: "LM Studio",
      }))
      .filter((model) => model.key);
  } catch {
    return [];
  }
}

async function fetchOpenAICompatibleInventory(collectorUrl: string, port: number) {
  const baseUrl = `${collectorUrl}/app-proxy/${port}/v1`;
  try {
    const response = await fetch(`${baseUrl}/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => null) as {
      data?: Array<{ id?: string }>;
    } | null;
    return (data?.data ?? [])
      .map((model) => String(model?.id ?? "").trim())
      .filter((key) => key && !/embed/i.test(key))
      .map((key) => ({
        key,
        loaded: true,
        baseUrl,
        source: openAIServerLabel(port),
        port,
      }));
  } catch {
    return [];
  }
}

async function fetchHostInventory(collectorUrl: string, machineName: string): Promise<FleetLmStudioHost | null> {
  const groups = await Promise.all([
    fetchLmStudioInventory(collectorUrl),
    ...OPENAI_COMPATIBLE_PORTS.map((port) => fetchOpenAICompatibleInventory(collectorUrl, port)),
  ]);
  const byBaseAndKey = new Map<string, FleetLmStudioHost["models"][number]>();
  for (const model of groups.flat()) {
    byBaseAndKey.set(`${model.baseUrl}::${model.key}`, model);
  }
  const models = [...byBaseAndKey.values()];
  return models.length ? { collectorUrl, machineName, models } : null;
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
    const ownMatch = own?.models.find((entry) => modelMatches(entry.key, model));
    if (ownMatch) {
      return ownMatch.baseUrl.endsWith("/lmstudio/v1") || ownMatch.port === 1234
        ? null
        : { baseUrl: ownMatch.baseUrl, machineName: own?.machineName || "this machine" };
    }
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
    baseUrl: best.match?.baseUrl || `${best.host.collectorUrl}/lmstudio/v1`,
    machineName: best.host.machineName,
  };
}
