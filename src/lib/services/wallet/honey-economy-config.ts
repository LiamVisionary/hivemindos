// Official Honey economy configuration.
//
// The packaged desktop app has no shell env, so the official worker URLs are baked in
// as defaults (they are public, non-secret) with process.env overrides for dev/clones.
// Adoption of the official economy is gated behind a REMOTE kill-switch served by the
// gateway's GET /honey/config, so this ships dark: until the flag is flipped on, the
// app keeps using the local ledger and calls Bankr directly, exactly as before.
//
// Mirrors the established hosted-config pattern in wallet/platform-fees.ts.

const DEFAULT_HONEY_LEDGER_URL = "https://hivemindos-honey-ledger.hivemindos.workers.dev";
const DEFAULT_HONEY_COMPUTE_GATEWAY_URL = "https://hivemindos-compute-gateway.hivemindos.workers.dev";
const FLAG_CACHE_MS = 60_000;
const FLAG_TIMEOUT_MS = 5_000;
const TRUE_VALUES = ["1", "true", "yes", "on"];
const FALSE_VALUES = ["0", "false", "no", "off"];

export function honeyLedgerUrl(): string {
  return (process.env.HONEY_LEDGER_REMOTE_URL?.trim() || DEFAULT_HONEY_LEDGER_URL).replace(/\/+$/, "");
}

export function honeyComputeGatewayUrl(): string {
  return (process.env.HONEY_COMPUTE_GATEWAY_URL?.trim() || DEFAULT_HONEY_COMPUTE_GATEWAY_URL).replace(/\/+$/, "");
}

let flagCache = { enabled: false, expiresAt: 0 };
let refreshing = false;

function envOverride(): boolean | null {
  const override = process.env.HONEY_ECONOMY_ENABLED?.trim().toLowerCase();
  if (override && TRUE_VALUES.includes(override)) return true;
  if (override && FALSE_VALUES.includes(override)) return false;
  return null;
}

function refreshFlagInBackground(): void {
  if (refreshing || flagCache.expiresAt > Date.now()) return;
  refreshing = true;
  fetchHoneyEconomyFlag()
    .then((enabled) => { flagCache = { enabled, expiresAt: Date.now() + FLAG_CACHE_MS }; })
    .catch(() => { flagCache = { enabled: false, expiresAt: Date.now() + FLAG_CACHE_MS }; })
    .finally(() => { refreshing = false; });
}

// Blocking read for latency-tolerant flows (background polls, post-hoc accounting,
// explicit exchange/claim). Env override wins; otherwise the gateway's remote flag,
// cached and defaulting to FALSE on any error so an outage can never switch the app
// onto the live rail by accident.
export async function isHoneyEconomyEnabled(): Promise<boolean> {
  const override = envOverride();
  if (override !== null) return override;

  const now = Date.now();
  if (flagCache.expiresAt > now) return flagCache.enabled;
  const enabled = await fetchHoneyEconomyFlag().catch(() => false);
  flagCache = { enabled, expiresAt: now + FLAG_CACHE_MS };
  return enabled;
}

// Non-blocking read for the chat critical path: returns the cached value instantly
// (default FALSE) and refreshes in the background. The LLM call never waits on the
// flag fetch, so an off/slow economy adds zero latency to chat.
export function isHoneyEconomyEnabledCached(): boolean {
  const override = envOverride();
  if (override !== null) return override;
  refreshFlagInBackground();
  return flagCache.enabled;
}

async function fetchHoneyEconomyFlag(): Promise<boolean> {
  const response = await fetch(`${honeyComputeGatewayUrl()}/honey/config`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FLAG_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof data?.enabled === "boolean") return data.enabled;
  return TRUE_VALUES.includes(String(data?.enabled ?? "").trim().toLowerCase());
}
