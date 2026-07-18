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

const REDDIT_USER_AGENT = "hivemindos-socials/1.0";

/**
 * Reddit script-app rail: password-grant tokens are minted per call (their
 * TTL is ~10 minutes, so nothing is cached or persisted). All four
 * credentials live in the shared hive env.
 */
async function mintRedditToken(account: SocialAccount, ctx: SocialAdapterContext): Promise<{ token?: string; error?: string }> {
  const clientId = accountEnvValue(account, ctx, "REDDIT_CLIENT_ID");
  const clientSecret = accountEnvValue(account, ctx, "REDDIT_CLIENT_SECRET");
  const username = accountEnvValue(account, ctx, "REDDIT_USERNAME");
  const password = accountEnvValue(account, ctx, "REDDIT_PASSWORD");
  if (!clientId || !clientSecret || !username || !password) {
    return { error: "Reddit needs REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD in the shared hive env." };
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "password", username, password });
  const res = await probeFetch(ctx, "https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    },
    body: body.toString(),
  });
  if (!res.ok) return { error: `Reddit token mint failed (HTTP ${res.status}).` };
  const parsed = (await res.json()) as { access_token?: string; error?: string };
  if (!parsed.access_token) return { error: `Reddit token mint rejected: ${parsed.error ?? "no access_token"}.` };
  return { token: parsed.access_token };
}

export const redditAdapter: SocialPlatformAdapter = {
  platform: "reddit",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    try {
      const mint = await mintRedditToken(account, ctx);
      if (!mint.token) return { ok: false, detail: mint.error ?? "Reddit token mint failed." };
      const res = await probeFetch(ctx, "https://oauth.reddit.com/api/v1/me", {
        headers: { Authorization: `Bearer ${mint.token}`, "User-Agent": REDDIT_USER_AGENT },
      });
      if (!res.ok) return { ok: false, detail: `Reddit identity check failed (HTTP ${res.status}).` };
      const body = (await res.json()) as { name?: string };
      return { ok: true, detail: `Authenticated as u/${body.name ?? "unknown"}.`, handle: body.name };
    } catch (error) {
      return { ok: false, detail: `Reddit probe failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  },

  async post() {
    notYetWired("reddit", "posting");
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities() {
    return { ...socialPlatformRow("reddit").capabilities };
  },
};
