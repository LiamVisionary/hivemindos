// This machine's system tailscaled node (HostName + sticky MagicDNS name),
// reported in the collector's /health as `tailnetSelf`. Why: an OS hostname
// rename (macOS mDNS-conflict renames append random digits) makes the
// embedded linkd tsnet node re-register under the NEW name while the system
// node keeps its old MagicDNS name — dashboards matching by name alone then
// split one physical machine into a collector machine plus an empty ghost.
// Self-declaring the system node lets fleet discovery fold them back together.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mirrors TAILSCALE_CLI_CANDIDATES in the dashboard: on macOS the CLI often
// is not on PATH for LaunchAgents; the app-bundle binary always exists when
// Tailscale.app is installed.
const TAILSCALE_CLI_CANDIDATES = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

let cache = { value: null, checkedAt: 0 };

async function tailscaleStatusJson() {
  let lastError = null;
  for (const cli of TAILSCALE_CLI_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(cli, ["status", "--json"], {
        timeout: 5000,
        maxBuffer: 1_500_000,
      });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("tailscale CLI unavailable");
}

/**
 * Returns `{ name, dnsName }` for this machine's system tailscaled node, or
 * null when tailscale is absent/down and nothing was ever resolved. Cached;
 * stale values are better than none (the sticky MagicDNS name is the point).
 */
export async function tailnetSelfNode({ ttlMs = 300_000 } = {}) {
  const now = Date.now();
  if (cache.value && now - cache.checkedAt < ttlMs) return cache.value;
  try {
    const status = await tailscaleStatusJson();
    const dnsName = String(status?.Self?.DNSName || "").replace(/\.$/, "");
    const name = String(status?.Self?.HostName || "").trim();
    const value = dnsName || name ? { name, dnsName } : null;
    if (value) cache = { value, checkedAt: now };
    return value;
  } catch {
    return cache.value;
  }
}
