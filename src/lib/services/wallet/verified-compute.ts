// Verified compute: opt-in reroute of BYOK cloud provider calls through the
// HivemindOS compute gateway so ANY cloud usage earns official Honey.
//
// Privacy contract: this is OFF by default. When enabled, prompts for the
// rerouted providers transit HivemindOS infrastructure (the gateway calls the
// provider with the user's own key and reads provider-returned usage — that is
// what makes the Honey verifiable). Local models are NEVER rerouted: their
// usage stays on the machine and accrues potential Honey instead
// (honey-ledger route `potential` block), claimable officially only via cloud
// verified compute or a TEE-attested runtime.
//
// The toggle lives in dashboard state (established server-read pattern, see
// chat.customInstructions) with an env override for operators.

import { booleanEnv } from "@/lib/config/env";
import { readDashboardState } from "@/lib/services/dashboard-state";
import { honeyComputeGatewayUrl } from "@/lib/services/wallet/honey-economy-config";
import { getHoneyWorkspaceId } from "@/lib/services/wallet/honey-ledger";

export const VERIFIED_COMPUTE_STATE_KEY = "honey.verifiedCompute";
const STATE_CACHE_MS = 10_000;
const TRUE_VALUES = ["1", "true", "yes", "on"];

// App provider slug -> compute-gateway HONEY_COMPUTE_PROVIDERS id. A fixed
// allowlist: local runtimes (lm-studio, ollama, ...) and providers the gateway
// does not speak (gemini, venice, usepod, hive-compute) are never rerouted.
// Bankr already earns through its own gateway path.
export const VERIFIED_COMPUTE_PROVIDERS: Record<string, string> = {
  "openai": "openai",
  "anthropic": "anthropic",
  "openrouter": "openrouter",
  "groq": "groq",
  "xai": "xai",
  "mistral": "mistral",
  "deepseek": "deepseek",
};

export type VerifiedComputeRoute = {
  url: string;
  providerId: string;
  headers: Record<string, string>;
};

let toggleCache: { enabled: boolean; expiresAt: number } | null = null;

export async function isVerifiedComputeEnabled(): Promise<boolean> {
  const override = process.env.HIVEMINDOS_VERIFIED_COMPUTE?.trim();
  if (override) return booleanEnv("HIVEMINDOS_VERIFIED_COMPUTE");
  const now = Date.now();
  if (toggleCache && toggleCache.expiresAt > now) return toggleCache.enabled;
  const enabled = await readDashboardState()
    .then((state) => TRUE_VALUES.includes((state.values[VERIFIED_COMPUTE_STATE_KEY] ?? "").trim().toLowerCase()))
    .catch(() => false);
  toggleCache = { enabled, expiresAt: now + STATE_CACHE_MS };
  return enabled;
}

// Returns the gateway reroute for a chat attempt, or null when the attempt
// must go direct (toggle off, unmapped/local provider, no key to bring, or the
// call already targets the gateway). The caller keeps its Authorization header
// (the user's own provider key) — the gateway consumes it as the BYOK funding
// key; these headers only add routing identity.
export async function resolveVerifiedComputeRoute(input: {
  provider?: string;
  token?: string;
  gatewayUrl?: string;
  agentId?: string;
  agentName?: string;
}): Promise<VerifiedComputeRoute | null> {
  const providerId = VERIFIED_COMPUTE_PROVIDERS[(input.provider ?? "").trim().toLowerCase()];
  if (!providerId) return null;
  if (!input.token?.trim()) return null;
  const gateway = honeyComputeGatewayUrl();
  if ((input.gatewayUrl ?? "").replace(/\/+$/, "").startsWith(gateway)) return null;
  if (!(await isVerifiedComputeEnabled())) return null;

  const workspaceId = await getHoneyWorkspaceId().catch(() => "");
  if (!workspaceId) return null;
  return {
    url: `${gateway}/v1/chat/completions`,
    providerId,
    headers: {
      "X-Hivemind-Provider": providerId,
      "X-Hivemind-Workspace-Id": workspaceId,
      ...(input.agentId ? { "X-Hivemind-Agent-Id": input.agentId } : {}),
      ...(input.agentName ? { "X-Hivemind-Agent-Name": input.agentName } : {}),
    },
  };
}

// Test-only: reset the toggle cache so hermetic tests can swap state files.
export function resetVerifiedComputeCacheForTests(): void {
  toggleCache = null;
}
