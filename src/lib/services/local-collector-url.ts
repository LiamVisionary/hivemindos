import { readFile } from "fs/promises";
import { hostname, networkInterfaces } from "os";
import { homedir } from "@/lib/home-dir";
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

// Tailscale reserves the 100.64.0.0/10 CGNAT block for node IPv4 addresses.
function isTailscaleIpv4Host(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((value) => value > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

// Tailscale reserves the fd7a:115c:a1e0::/48 ULA prefix for node IPv6 addresses.
function isTailscaleIpv6Host(host: string) {
  return host.replace(/^\[|\]$/g, "").startsWith("fd7a:115c:a1e0:");
}

/**
 * Defense-in-depth SSRF guard for client-supplied collector/telemetry URLs.
 * Returns true only when `url` targets a host on the trusted fleet surface —
 * loopback, one of THIS machine's own interfaces, a Tailscale node (a
 * `100.64.0.0/10` IPv4, a `fd7a:115c:a1e0::/48` IPv6, or a `*.ts.net` MagicDNS
 * name), or an mDNS `*.local` LAN host. Those are the ONLY host shapes a real
 * fleet collector is ever reached by (peer collector URLs are built from
 * Tailscale IPs in fleet/connected-apps.ts, and the local/self path resolves to
 * loopback via canonicalLocalCollectorUrl). Every other host — public IPs,
 * RFC-1918 LAN addresses, 169.254 link-local/metadata endpoints, or arbitrary
 * DNS names — is rejected before any server-side fetch treats the URL as
 * remote-fetchable. Empty or unparseable URLs are NOT fleet URLs.
 *
 * This is belt-and-suspenders: these routes are already dashboard-auth-gated,
 * and Hivemind Link peer hops (`/peer/<host>` against the loopback control) are
 * additionally gated by linkd's owner/tailnet ACL — this guard just refuses to
 * let an authenticated caller aim a raw server-side fetch at an arbitrary host.
 */
export function isFleetCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return false;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (localInterfaceHosts().has(host)) return true;
  if (host.endsWith(".ts.net")) return true;
  if (host.endsWith(".local")) return true;
  if (isTailscaleIpv4Host(host)) return true;
  if (isTailscaleIpv6Host(host)) return true;
  return false;
}

/**
 * Throwing companion to {@link isFleetCollectorUrl} for call sites that already
 * surface errors via try/catch. Returns the normalized URL when it is a
 * fleet-fetchable collector target, otherwise throws.
 */
export function assertFleetCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!isFleetCollectorUrl(normalized)) {
    let host = "";
    try {
      host = new URL(normalized).hostname;
    } catch {
      host = normalized || "(empty)";
    }
    throw new Error(`Refusing to fetch a collector URL outside the fleet host set: ${host}`);
  }
  return normalized;
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
