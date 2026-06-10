import { readFile } from "fs/promises";
import { homedir, hostname, networkInterfaces } from "os";
import { join } from "path";

const LOCAL_COLLECTOR_ENV_FILE = join(homedir(), ".hivemindos", "collector.env");
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type LocalCollectorProfile = {
  telemetryUrl?: string | null;
  machineName?: string | null;
};

type LocalServiceProfile = LocalCollectorProfile & {
  gatewayUrl?: string | null;
};

function unquoteShellValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\\(.)/g, "$1");
}

async function collectorEnvValue(key: string) {
  const envText = await readFile(LOCAL_COLLECTOR_ENV_FILE, "utf8").catch(() => "");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || match[1] !== key) continue;
    return unquoteShellValue(match[2] ?? "");
  }
  return "";
}

export async function localCollectorPort() {
  const port = await collectorEnvValue("AGENT_TELEMETRY_PORT") || process.env.AGENT_TELEMETRY_PORT || "";
  return /^\d+$/.test(port) ? port : "";
}

export function localInterfaceHosts() {
  const hosts = new Set(LOOPBACK_HOSTS);
  hosts.add(hostname().toLowerCase());
  hosts.add(`${hostname().toLowerCase()}.local`);
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.address) hosts.add(item.address.toLowerCase());
    }
  }
  return hosts;
}

export function normalizeCollectorUrl(url?: string | null) {
  return url?.trim().replace(/\/+$/, "") ?? "";
}

export function isLocalCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return true;
  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith("/peer/")) return false;
    const host = parsed.hostname.toLowerCase();
    return localInterfaceHosts().has(host);
  } catch {
    return false;
  }
}

export function isLoopbackServiceUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function remoteCollectorLocalServiceUrl(profile: LocalServiceProfile, targetUrl: string) {
  const collectorUrl = normalizeCollectorUrl(profile.telemetryUrl);
  if (!collectorUrl || isLocalCollectorUrl(collectorUrl) || !isLoopbackServiceUrl(targetUrl)) return targetUrl;
  try {
    const target = new URL(targetUrl);
    const port = target.port || (target.protocol === "https:" ? "443" : "80");
    if (!/^\d+$/.test(port)) return targetUrl;
    return `${collectorUrl}/app-proxy/${port}${target.pathname}${target.search}`;
  } catch {
    return targetUrl;
  }
}

export async function canonicalLocalCollectorUrl(profileOrUrl?: LocalCollectorProfile | string | null) {
  const rawUrl = typeof profileOrUrl === "string"
    ? profileOrUrl
    : profileOrUrl?.telemetryUrl ?? "";
  const normalized = normalizeCollectorUrl(rawUrl);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith("/peer/")) return normalized;
    if (!isLocalCollectorUrl(normalized)) return normalized;
    parsed.hostname = "127.0.0.1";
    const port = await localCollectorPort();
    if (port) parsed.port = port;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}
