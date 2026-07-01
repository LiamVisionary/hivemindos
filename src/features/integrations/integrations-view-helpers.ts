import type {
  NangoHostConfig,
  NangoHostSetupResult,
  NangoIntegrationPayload,
} from "@/lib/types/integrations";

export type FleetMachine = {
  device?: {
    self?: boolean;
    name?: string;
    dnsName?: string;
    os?: string;
    online?: boolean;
    ip?: string;
    collectorUrl?: string;
  };
  collector?: string;
  envSync?: { ready?: boolean };
};

export type MachineChoice = {
  id: string;
  name: string;
  os: string;
  online: boolean;
  collectorReady: boolean;
  envReady: boolean;
  self: boolean;
  baseUrl: string;
  collectorUrl: string;
  rank: number;
  note: string;
};

export function setupStepForPayload(payload: NangoIntegrationPayload): "welcome" | "apps" {
  if (payload.health.ok) return "apps";
  if (payload.config.hostMachineId && payload.config.baseUrl) return "apps";
  return "welcome";
}

export function setupMethodLabel(method?: NangoHostSetupResult["method"]) {
  if (method === "collector-api") return "agent bridge";
  if (method === "local-shell") return "local setup";
  if (method === "tailscale-ssh") return "Tailscale";
  if (method === "plain-ssh") return "SSH";
  return method || "setup";
}

export function summarizeRegistrarOutput(output?: string) {
  if (!output) return "";
  const changedMatch = output.match(/Done\.\s+([^\n]+)/);
  if (changedMatch) return changedMatch[1].trim();
  const lines = output.split(/\r?\n/).filter(Boolean);
  return lines.at(-1) ?? "";
}

export function tabFromLocation<T extends string>(fallback: T, validTabs: Array<{ id: T }>): T {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  return validTabs.some((item) => item.id === raw) ? raw as T : fallback;
}

export function managedXStatusUrl(creditAccountId?: string, slug?: string) {
  const params = new URLSearchParams();
  const urlParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const accountId = creditAccountId?.trim() || urlParams.get("x_credit_account_id")?.trim() || "";
  const cleanSlug = slug?.trim() || urlParams.get("x_slug")?.trim() || "";
  if (accountId) params.set("creditAccountId", accountId);
  if (cleanSlug) params.set("slug", cleanSlug);
  const search = params.toString();
  return search ? `/api/integrations/x-managed?${search}` : "/api/integrations/x-managed";
}

export function managedXReturnUrl(creditAccountId: string, slug: string) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("view", "integrations");
  url.searchParams.set("tab", "mcp");
  url.searchParams.set("x_credit_account_id", creditAccountId);
  url.searchParams.set("x_slug", slug);
  return url.toString();
}

export function showManagedXReturnMessage(setMessage: (message: string) => void) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const status = params.get("x_status");
  if (status === "connected") {
    const username = params.get("username")?.trim();
    setMessage(username ? `Managed X account @${username} connected.` : "Managed X account connected.");
  } else if (status === "error") {
    setMessage(params.get("error") || "Managed X sign-in failed.");
  }
}

export function machineChoices(machines: FleetMachine[], config: NangoHostConfig): MachineChoice[] {
  const choices = machines.map((machine) => {
    const device = machine.device ?? {};
    const name = device.self ? "This Mac" : device.name || dnsLabel(device.dnsName) || device.ip || "Unknown machine";
    const id = device.self ? "self" : normalizeId(device.dnsName || device.name || device.ip || name);
    const online = device.self || device.online === true;
    const collectorReady = machine.collector === "ready";
    const envReady = machine.envSync?.ready === true;
    const serverLike = /linux|ubuntu|debian|server|cloud|hetzner/i.test(`${device.os} ${name} ${device.dnsName}`);
    const baseHost = device.self ? "127.0.0.1" : (device.dnsName || device.ip || name).replace(/\.$/, "");
    const rank = (online ? 32 : 0) + (collectorReady ? 18 : 0) + (envReady ? 14 : 0) + (serverLike ? 28 : 0) + (device.self ? 4 : 0);
    return {
      id,
      name,
      os: device.os || "unknown OS",
      online,
      collectorReady,
      envReady,
      self: device.self === true,
      baseUrl: `http://${baseHost}:3003`,
      collectorUrl: device.collectorUrl || "",
      rank,
      note: device.self ? "current machine" : serverLike ? "always-on candidate" : "tailnet machine",
    };
  });

  if (!choices.some((choice) => choice.id === "self")) {
    choices.push({
      id: "self",
      name: "This Mac",
      os: "local",
      online: true,
      collectorReady: false,
      envReady: false,
      self: true,
      baseUrl: "http://127.0.0.1:3003",
      collectorUrl: "",
      rank: 18,
      note: "current machine",
    });
  }

  if (config.hostMachineId && !choices.some((choice) => choice.id === config.hostMachineId)) {
    choices.push({
      id: config.hostMachineId,
      name: config.hostMachineName || config.hostMachineId,
      os: "saved host",
      online: false,
      collectorReady: false,
      envReady: false,
      self: false,
      baseUrl: config.baseUrl,
      collectorUrl: "",
      rank: 10,
      note: "saved host",
    });
  }

  return choices.sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
}

export function setupTargetFromBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split(":")[0] || "integration-host";
  }
}

export function friendlySetupError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/fetch failed|failed to fetch|network/i.test(message)) return "Could not reach that machine. Make sure it is online, then try again.";
  return message || "Could not start Nango. Try again in a moment.";
}

export function splitArgs(value: string) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")).filter(Boolean) ?? [];
}

export async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

export function timeAgo(ts: number) {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function dnsLabel(value?: string) {
  return value?.replace(/\.$/, "").split(".")[0] ?? "";
}

function normalizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "machine";
}
