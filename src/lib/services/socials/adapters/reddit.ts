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

const REDDIT_USER_AGENT = "hivemindos-socials/1.0";

/**
 * Reddit script-app rail: password-grant tokens are minted per call, so no
 * access token is cached or persisted. All four credentials live in the
 * shared hive env.
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

  async post(input, ctx) {
    if (input.quoteOf) throw new SocialPostError("Reddit quote posts are not supported; create a normal post containing the source URL instead.");
    if (input.media?.length) throw new SocialPostError("Reddit media upload is not supported by this text queue.");
    const mint = await mintRedditToken(input.account, ctx);
    if (!mint.token) throw new SocialPostError(mint.error ?? "Reddit token mint failed.");
    const headers = {
      Authorization: `Bearer ${mint.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    };
    const isReply = Boolean(input.replyTo);
    const subreddit = (input.subreddit ?? input.account.binding?.defaultSubreddit ?? "").trim().replace(/^r\//, "");
    if (!isReply && !subreddit) throw new SocialPostError("A subreddit is required for a new Reddit post.");
    if (!isReply && !input.title?.trim()) throw new SocialPostError("A title is required for a new Reddit post.");
    const form = isReply
      ? new URLSearchParams({ api_type: "json", thing_id: input.replyTo!, text: input.text, raw_json: "1" })
      : new URLSearchParams({ api_type: "json", kind: "self", sr: subreddit, title: input.title!.trim(), text: input.text, resubmit: "true", send_replies: "true", raw_json: "1" });
    let response: Response;
    try {
      response = await probeFetch(ctx, `https://oauth.reddit.com/api/${isReply ? "comment" : "submit"}`, {
        method: "POST",
        headers,
        body: form.toString(),
      }, 30_000);
    } catch (error) {
      throw new SocialPostError(`Reddit delivery status is unknown: ${error instanceof Error ? error.message : String(error)}`, { ambiguous: true });
    }
    if (!response.ok) throw await socialPostResponseError("reddit", response);
    const parsed = (await response.json()) as {
      json?: { errors?: unknown[]; data?: { name?: string; url?: string; things?: Array<{ data?: { name?: string; id?: string } }> } };
    };
    if (parsed.json?.errors?.length) throw new SocialPostError(`Reddit rejected the post: ${JSON.stringify(parsed.json.errors).slice(0, 500)}`);
    const externalId = isReply
      ? parsed.json?.data?.things?.[0]?.data?.name ?? parsed.json?.data?.things?.[0]?.data?.id
      : parsed.json?.data?.name;
    if (!externalId) throw new SocialPostError("Reddit accepted the request but returned no post id.", { ambiguous: true });
    return { externalId, url: parsed.json?.data?.url };
  },

  async fetchPostMetrics(account, externalIds, ctx) {
    const mint = await mintRedditToken(account, ctx).catch(() => ({ token: undefined }));
    if (!mint.token || !externalIds.length) return [];
    try {
      const response = await probeFetch(ctx, `https://oauth.reddit.com/api/info?id=${encodeURIComponent(externalIds.slice(0, 100).join(","))}&raw_json=1`, {
        headers: { Authorization: `Bearer ${mint.token}`, "User-Agent": REDDIT_USER_AGENT },
      });
      if (!response.ok) return [];
      const children = ((await response.json()) as { data?: { children?: Array<{ data?: { name?: string; score?: number; upvote_ratio?: number; num_comments?: number } }> } }).data?.children ?? [];
      const at = new Date().toISOString();
      return children.flatMap((child) => child.data?.name ? [{
        externalId: child.data.name,
        at,
        metrics: { score: child.data.score ?? 0, upvoteRatio: child.data.upvote_ratio ?? 0, comments: child.data.num_comments ?? 0 },
      }] : []);
    } catch {
      return [];
    }
  },

  async fetchAccountMetrics(account, ctx): Promise<Record<string, number>> {
    const mint = await mintRedditToken(account, ctx).catch(() => ({ token: undefined }));
    if (!mint.token) return {};
    try {
      const response = await probeFetch(ctx, "https://oauth.reddit.com/api/v1/me", {
        headers: { Authorization: `Bearer ${mint.token}`, "User-Agent": REDDIT_USER_AGENT },
      });
      if (!response.ok) return {};
      const body = (await response.json()) as { link_karma?: number; comment_karma?: number };
      return { linkKarma: body.link_karma ?? 0, commentKarma: body.comment_karma ?? 0 };
    } catch {
      return {};
    }
  },

  capabilities() {
    return { ...socialPlatformRow("reddit").capabilities };
  },
};
