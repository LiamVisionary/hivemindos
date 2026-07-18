import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import type { SocialAccount } from "@/lib/services/socials/socials-types";
import {
  accountEnvValue,
  notYetWired,
  probeFetch,
  type SocialAdapterContext,
  type SocialConnectProbe,
  type SocialPlatformAdapter,
} from "@/lib/services/socials/adapters/types";

/**
 * LinkedIn member posting. Token comes from the LinkedIn OAuth flow
 * (LINKEDIN_ACCESS_TOKEN in the shared hive env, ~60-day expiry — the live
 * probe is what surfaces "needs-attention" before posts start failing).
 * Posting stays connect-only until the developer app's w_member_social
 * product is approved (matrix row documents this).
 */
export const linkedinAdapter: SocialPlatformAdapter = {
  platform: "linkedin",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    const token = accountEnvValue(account, ctx, "LINKEDIN_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "Not signed in — run the LinkedIn OAuth flow to mint LINKEDIN_ACCESS_TOKEN." };
    try {
      const res = await probeFetch(ctx, "https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return { ok: false, detail: "LinkedIn token expired or revoked — sign in again (tokens last ~60 days)." };
      if (!res.ok) return { ok: false, detail: `LinkedIn userinfo failed (HTTP ${res.status}).` };
      const body = (await res.json()) as { name?: string; email?: string; sub?: string };
      return {
        ok: true,
        detail: `Signed in as ${body.name ?? body.email ?? body.sub ?? "LinkedIn member"}.`,
        displayName: body.name,
      };
    } catch (error) {
      return { ok: false, detail: `LinkedIn probe failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  },

  async post() {
    notYetWired("linkedin", "posting");
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities() {
    return { ...socialPlatformRow("linkedin").capabilities };
  },
};
