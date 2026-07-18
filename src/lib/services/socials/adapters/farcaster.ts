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
 * Farcaster via Neynar: NEYNAR_API_KEY in the shared hive env, fid +
 * signerUuid as non-secret bindings. Casting lands in a later phase; the
 * probe verifies the key and resolves the fid's profile.
 */
export const farcasterAdapter: SocialPlatformAdapter = {
  platform: "farcaster",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    const key = accountEnvValue(account, ctx, "NEYNAR_API_KEY");
    if (!key) return { ok: false, detail: "NEYNAR_API_KEY is not set in the shared hive env." };
    const fid = (account.binding?.fid ?? "").trim();
    if (!fid) return { ok: false, detail: "No fid binding on this account." };
    try {
      const res = await probeFetch(ctx, `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(fid)}`, {
        headers: { "x-api-key": key },
      });
      if (!res.ok) return { ok: false, detail: `Neynar rejected the key or fid (HTTP ${res.status}).` };
      const body = (await res.json()) as { users?: Array<{ username?: string; display_name?: string }> };
      const user = body.users?.[0];
      if (!user) return { ok: false, detail: `No Farcaster user found for fid ${fid}.` };
      const signer = (account.binding?.signerUuid ?? "").trim();
      return {
        ok: Boolean(signer),
        detail: signer
          ? `Neynar key valid for @${user.username ?? fid}; signer bound.`
          : `Key valid for @${user.username ?? fid}, but no signerUuid binding — casting needs a signer.`,
        handle: user.username,
        displayName: user.display_name,
      };
    } catch (error) {
      return { ok: false, detail: `Neynar probe failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  },

  async post() {
    notYetWired("farcaster", "casting");
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities() {
    return { ...socialPlatformRow("farcaster").capabilities };
  },
};
