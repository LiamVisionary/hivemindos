import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import type { SocialAccount } from "@/lib/services/socials/socials-types";
import {
  accountEnvValue,
  probeFetch,
  SocialPostError,
  socialPostResponseError,
  type SocialAdapterContext,
  type SocialConnectProbe,
  type SocialPlatformAdapter,
} from "@/lib/services/socials/adapters/types";

/**
 * LinkedIn member posting. Token comes from the LinkedIn OAuth flow
 * (LINKEDIN_ACCESS_TOKEN in the shared hive env, ~60-day expiry — the live
 * probe is what surfaces "needs-attention" before posts start failing).
 * Text publishing requires LinkedIn's w_member_social product on the user's
 * developer application; missing approval is surfaced as an actionable error.
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

  async post(input, ctx) {
    if (input.replyTo || input.quoteOf) throw new SocialPostError("LinkedIn replies and quote posts are not available through the connected member-post rail.");
    if (input.media?.length) throw new SocialPostError("LinkedIn media needs the separate asset-upload flow and is not accepted by this text queue.");
    const token = accountEnvValue(input.account, ctx, "LINKEDIN_ACCESS_TOKEN");
    if (!token) throw new SocialPostError("LinkedIn posting needs LINKEDIN_ACCESS_TOKEN.");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" };
    const identity = await probeFetch(ctx, "https://api.linkedin.com/v2/userinfo", { headers }, 15_000).catch((error) => {
      throw new SocialPostError(`LinkedIn identity lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!identity.ok) throw await socialPostResponseError("linkedin", identity);
    const member = (await identity.json()) as { sub?: string };
    if (!member.sub) throw new SocialPostError("LinkedIn userinfo returned no member id.");
    let response: Response;
    try {
      response = await probeFetch(ctx, "https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          author: `urn:li:person:${member.sub}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: input.text },
              shareMediaCategory: "NONE",
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      }, 30_000);
    } catch (error) {
      throw new SocialPostError(`LinkedIn delivery status is unknown: ${error instanceof Error ? error.message : String(error)}`, { ambiguous: true });
    }
    if (!response.ok) throw await socialPostResponseError("linkedin", response);
    const id = response.headers.get("x-restli-id")?.trim();
    if (!id) throw new SocialPostError("LinkedIn created the post but returned no X-RestLi-Id.", { ambiguous: true });
    return { externalId: id };
  },

  async fetchPostMetrics(account, externalIds, ctx) {
    const token = accountEnvValue(account, ctx, "LINKEDIN_ACCESS_TOKEN");
    if (!token) return [];
    const rows = await Promise.all(externalIds.slice(0, 50).map(async (externalId) => {
      try {
        const response = await probeFetch(ctx, `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(externalId)}`, {
          headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { likesSummary?: { totalLikes?: number }; commentsSummary?: { totalFirstLevelComments?: number } };
        return { externalId, at: new Date().toISOString(), metrics: { likes: body.likesSummary?.totalLikes ?? 0, comments: body.commentsSummary?.totalFirstLevelComments ?? 0 } };
      } catch {
        return null;
      }
    }));
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities() {
    return { ...socialPlatformRow("linkedin").capabilities };
  },
};
