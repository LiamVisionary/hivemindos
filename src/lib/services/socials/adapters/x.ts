import { getManagedXGatewayStatus } from "@/lib/services/managed-x-api-client";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import type { SocialAccount, SocialCapability, SocialCapabilitySupport } from "@/lib/services/socials/socials-types";
import {
  accountEnvValue,
  notYetWired,
  type SocialAdapterContext,
  type SocialConnectProbe,
  type SocialPlatformAdapter,
} from "@/lib/services/socials/adapters/types";

const X_BYO_ENV_KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"] as const;
const X_MCP_ENV_KEYS = ["X_MCP_CLIENT_ID", "X_MCP_CLIENT_SECRET"] as const;

/**
 * X adapter. Three connect methods with very different probe depths:
 * managed-oauth checks the x-api-gateway is reachable/configured and a
 * connection slug is bound; api-token (BYO OAuth1 keys) and mcp are
 * presence-based in Phase 1 — a real signed call is what Phase 2's post()
 * exercises, and lying about a live check here would be worse than saying
 * "credentials saved, verified at post time".
 */
export const xAdapter: SocialPlatformAdapter = {
  platform: "x",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    if (account.method === "managed-oauth") {
      try {
        const status = await getManagedXGatewayStatus();
        const slug = (account.binding?.connectionSlug ?? "").trim();
        if (!status.configured) return { ok: false, detail: "Managed X gateway is not configured." };
        if (!slug) return { ok: false, detail: "Gateway reachable, but no connection slug bound — finish the managed X sign-in." };
        return { ok: true, detail: `Managed X connection bound (${slug}).`, handle: account.handle };
      } catch (error) {
        return { ok: false, detail: `Managed X gateway unreachable: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    const keys = account.method === "mcp" ? X_MCP_ENV_KEYS : X_BYO_ENV_KEYS;
    const missing = keys.filter((key) => !accountEnvValue(account, ctx, key));
    if (missing.length) return { ok: false, detail: `Missing shared env keys: ${missing.join(", ")}.` };
    return {
      ok: true,
      detail:
        account.method === "mcp"
          ? "X MCP client credentials saved; runtime registration governs agent access."
          : "BYO X API keys saved (live-verified at post time — OAuth1 calls are signed per request).",
      handle: account.handle,
    };
  },

  async post() {
    notYetWired("x", "posting");
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities(account: SocialAccount): Record<SocialCapability, SocialCapabilitySupport> {
    const base = { ...socialPlatformRow("x").capabilities };
    // MCP is an agent-side rail: the dashboard itself doesn't search through it.
    if (account.method === "mcp") return { ...base, search: "limited" };
    return base;
  },
};
