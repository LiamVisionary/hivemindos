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
// is not on PATH for LaunchAgents (and on Windows the scheduled-task PATH can
// miss the install dir); the app-bundle / Program Files binaries always exist
// when Tailscale is installed.
const TAILSCALE_CLI_CANDIDATES = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/opt/homebrew/opt/tailscale/bin/tailscale",
  "/usr/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ...(process.platform === "win32"
    ? [`${process.env.ProgramFiles || "C:\\Program Files"}\\Tailscale\\tailscale.exe`]
    : []),
];

let cache = { value: null, checkedAt: 0 };

export async function tailscaleStatusJson() {
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

let ownerCache = { value: "", checkedAt: 0 };

/**
 * The tailnet owner (LoginName) of this machine's system tailscaled node, used
 * to gate cross-machine mutations to the node owner's own fleet. Mirrors the
 * trust model of hivemind-linkd shell.go requireTailnetSelfUser. Cached; stale
 * values are better than none — an empty answer fails those gates closed.
 */
export async function tailnetSelfOwner({ ttlMs = 300_000 } = {}) {
  const now = Date.now();
  if (ownerCache.value && now - ownerCache.checkedAt < ttlMs) return ownerCache.value;
  try {
    const status = await tailscaleStatusJson();
    const selfUserId = status?.Self?.UserID;
    const login = String(status?.User?.[selfUserId]?.LoginName || "").trim();
    if (login) ownerCache = { value: login, checkedAt: now };
    return login || ownerCache.value;
  } catch {
    return ownerCache.value;
  }
}
