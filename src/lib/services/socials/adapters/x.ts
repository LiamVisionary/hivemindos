import { getManagedXConnections, proxyManagedXServerCall } from "@/lib/services/managed-x-api-client";
import {
  managedXConnectionHandle,
  managedXConnectionId,
  managedXConnectionsFromPayload,
} from "@/lib/services/managed-x-connections";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import { resolveManagedXCredit } from "@/lib/services/socials/managed-x-credit-binding";
import { deliverXEngagement } from "@/lib/services/socials/social-x-engagement-delivery";
import { normalizeXProfileImageUrl } from "@/lib/services/socials/social-profile-image";
import type { SocialAccount, SocialCapability, SocialCapabilitySupport } from "@/lib/services/socials/socials-types";
import {
  accountEnvValue,
  probeFetch,
  SocialPostError,
  socialPostResponseError,
  type SocialAdapterContext,
  type SocialConnectProbe,
  type SocialPlatformAdapter,
} from "@/lib/services/socials/adapters/types";
import { xOAuth1Authorization } from "@/lib/services/socials/adapters/x-oauth1";

const X_BYO_ENV_KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"] as const;
const X_MCP_ENV_KEYS = ["X_MCP_CLIENT_ID", "X_MCP_CLIENT_SECRET"] as const;

/**
 * X adapter. Three connect methods have intentionally different probe depths:
 * managed-oauth verifies the bound OAuth identity; api-token
 * validates credential presence and verifies them with the first signed post;
 * MCP is agent-side only and is not presented as a dashboard posting rail.
 */
export const xAdapter: SocialPlatformAdapter = {
  platform: "x",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    if (account.method === "managed-oauth") {
      try {
        const slug = (account.binding?.connectionSlug ?? "").trim();
        if (!slug) return { ok: false, detail: "Gateway reachable, but no connection slug bound — finish the managed X sign-in." };
        const managed = await resolveManagedXCredit(account);
        const credentials = managed.credentials;
        if (!credentials) return { ok: false, detail: managed.error };
        const response = await getManagedXConnections(credentials.creditToken, credentials.creditSlug);
        if (!response.ok) {
          return { ok: false, detail: `Managed X connection check failed (HTTP ${response.status}) — reconnect the OAuth account.` };
        }
        const connections = managedXConnectionsFromPayload(await response.json().catch(() => ({})));
        const connection = connections.find((candidate) => managedXConnectionId(candidate) === credentials.connectionId);
        if (!connection) return { ok: false, detail: "The saved managed X connection no longer exists — reconnect the OAuth account." };
        const handle = managedXConnectionHandle(connection);
        if (!handle) return { ok: false, detail: "Managed X OAuth returned no account handle — reconnect the account." };
        if (handle.toLowerCase() !== account.handle.replace(/^@/, "").toLowerCase()) {
          return {
            ok: false,
            detail: `Managed X OAuth is connected as @${handle}, but this Socials account is @${account.handle.replace(/^@/, "")} — reconnect the correct account.`,
            handle,
          };
        }
        const identityResponse = await proxyManagedXServerCall({
          creditToken: credentials.creditToken,
          slug: credentials.creditSlug,
          connectionId: credentials.connectionId,
          method: "GET",
          path: "/2/users/me",
          query: { "user.fields": "name,username,profile_image_url" },
        });
        if (!identityResponse.ok) {
          const failure = await identityResponse.json().catch(() => null);
          const invalidCredential = /(?:token[^a-z]+(?:was[^a-z]+)?invalid|invalid[^a-z]+token|expired)/i.test(JSON.stringify(failure));
          return {
            ok: false,
            detail: invalidCredential
              ? `Managed X OAuth for @${handle} is invalid or expired — reconnect the account.`
              : `Managed X OAuth identity check failed (HTTP ${identityResponse.status}) — reconnect @${handle}.`,
            handle,
          };
        }
        const user = ((await identityResponse.json()) as {
          data?: { name?: string; username?: string; profile_image_url?: string };
        }).data;
        const verifiedHandle = user?.username?.trim().replace(/^@/, "");
        if (!verifiedHandle || verifiedHandle.toLowerCase() !== handle.toLowerCase()) {
          return {
            ok: false,
            detail: `Managed X OAuth returned ${verifiedHandle ? `@${verifiedHandle}` : "no account handle"} for the saved @${handle} connection — reconnect the correct account.`,
            ...(verifiedHandle ? { handle: verifiedHandle } : { handle }),
          };
        }
        return {
          ok: true,
          detail: `Managed X OAuth verified as @${verifiedHandle}.`,
          handle: verifiedHandle,
          displayName: user?.name?.trim() || undefined,
          avatarUrl: normalizeXProfileImageUrl(user?.profile_image_url),
        };
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

  async post(input, ctx) {
    if (input.media?.length) throw new SocialPostError("X media upload is not supported by this text queue yet.");
    if (input.account.method === "mcp") {
      throw new SocialPostError("X MCP is an agent-side tool connection and cannot be driven by the durable dashboard queue. Connect managed X or BYO OAuth1 for queued posting.");
    }
    if (input.replyTo || input.quoteOf) {
      return deliverXEngagement({
        account: input.account,
        text: input.text,
        replyTo: input.replyTo,
        quoteOf: input.quoteOf,
        runTwitterImpl: ctx.xAgentReachRun,
      });
    }
    const json = xPostBody(input.text);
    if (input.account.method === "managed-oauth") {
      const managed = await resolveManagedXCredit(input.account);
      if (!managed.credentials) throw new SocialPostError(managed.error, { status: managed.status, retryable: managed.retryable });
      const response = await proxyManagedXServerCall({
        creditToken: managed.credentials.creditToken,
        slug: managed.credentials.creditSlug,
        connectionId: managed.credentials.connectionId,
        method: "POST",
        path: "/2/tweets",
        json,
        idempotencyKey: input.idempotencyKey,
      });
      if (!response.ok) {
        const error = await socialPostResponseError("x", response);
        throw error;
      }
      const parsed = (await response.json()) as { data?: { id?: string }; duplicate?: boolean; event?: { externalId?: string } };
      const id = parsed.data?.id ?? parsed.event?.externalId;
      if (!id) {
        if (parsed.duplicate) throw new SocialPostError("Managed X recognized this request as already billed, but its receipt has no post id. Verify the account before retrying.", { ambiguous: true });
        throw new SocialPostError("X accepted the managed request but returned no post id.", { ambiguous: true });
      }
      return { externalId: id, url: `https://x.com/${input.account.handle.replace(/^@/, "")}/status/${id}` };
    }
    const consumerKey = accountEnvValue(input.account, ctx, "X_API_KEY");
    const consumerSecret = accountEnvValue(input.account, ctx, "X_API_SECRET");
    const accessToken = accountEnvValue(input.account, ctx, "X_ACCESS_TOKEN");
    const accessTokenSecret = accountEnvValue(input.account, ctx, "X_ACCESS_TOKEN_SECRET");
    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      throw new SocialPostError(`BYO X posting needs all of: ${X_BYO_ENV_KEYS.join(", ")}.`);
    }
    const url = "https://api.x.com/2/tweets";
    let response: Response;
    try {
      response = await probeFetch(ctx, url, {
        method: "POST",
        headers: {
          Authorization: xOAuth1Authorization({ method: "POST", url, consumerKey, consumerSecret, accessToken, accessTokenSecret }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(json),
      }, 30_000);
    } catch (error) {
      throw new SocialPostError(`X delivery status is unknown: ${error instanceof Error ? error.message : String(error)}`, { ambiguous: true });
    }
    if (!response.ok) throw await socialPostResponseError("x", response);
    const parsed = (await response.json()) as { data?: { id?: string } };
    const id = parsed.data?.id;
    if (!id) throw new SocialPostError("X accepted the request but returned no post id.", { ambiguous: true });
    return { externalId: id, url: `https://x.com/${input.account.handle.replace(/^@/, "")}/status/${id}` };
  },

  async fetchPostMetrics(account, externalIds, ctx) {
    if (!externalIds.length || account.method === "mcp") return [];
    try {
      const response = await xRead(account, ctx, "/2/tweets", {
        ids: externalIds.slice(0, 100).join(","),
        "tweet.fields": "public_metrics",
      });
      if (!response?.ok) return [];
      const data = ((await response.json()) as { data?: Array<{ id?: string; public_metrics?: Record<string, number> }> }).data ?? [];
      const at = new Date().toISOString();
      return data.flatMap((post) => post.id ? [{
        externalId: post.id,
        at,
        metrics: {
          likes: post.public_metrics?.like_count ?? 0,
          reposts: post.public_metrics?.retweet_count ?? 0,
          replies: post.public_metrics?.reply_count ?? 0,
          quotes: post.public_metrics?.quote_count ?? 0,
          bookmarks: post.public_metrics?.bookmark_count ?? 0,
          impressions: post.public_metrics?.impression_count ?? 0,
        },
      }] : []);
    } catch {
      return [];
    }
  },

  async fetchAccountMetrics(account, ctx): Promise<Record<string, number>> {
    if (account.method === "mcp") return {};
    try {
      const handle = account.handle.replace(/^@/, "");
      const response = await xRead(account, ctx, `/2/users/by/username/${encodeURIComponent(handle)}`, { "user.fields": "public_metrics" });
      if (!response?.ok) return {};
      const metrics = ((await response.json()) as { data?: { public_metrics?: Record<string, number> } }).data?.public_metrics;
      return metrics ? { followers: metrics.followers_count ?? 0, following: metrics.following_count ?? 0, posts: metrics.tweet_count ?? 0 } : {};
    } catch {
      return {};
    }
  },

  capabilities(account: SocialAccount): Record<SocialCapability, SocialCapabilitySupport> {
    const base = { ...socialPlatformRow("x").capabilities };
    // MCP is an agent-side rail: the dashboard itself doesn't search through it.
    if (account.method === "mcp") return { ...base, search: "limited", post: "unsupported", reply: "unsupported", quote: "unsupported" };
    return base;
  },
};

function xPostBody(text: string): Record<string, unknown> {
  return { text };
}

async function xRead(account: SocialAccount, ctx: SocialAdapterContext, path: string, query: Record<string, unknown>): Promise<Response | null> {
  if (account.method === "managed-oauth") {
    const managed = await resolveManagedXCredit(account);
    if (!managed.credentials) return null;
    return proxyManagedXServerCall({
      creditToken: managed.credentials.creditToken,
      slug: managed.credentials.creditSlug,
      connectionId: managed.credentials.connectionId,
      method: "GET",
      path,
      query,
    });
  }
  const consumerKey = accountEnvValue(account, ctx, "X_API_KEY");
  const consumerSecret = accountEnvValue(account, ctx, "X_API_SECRET");
  const accessToken = accountEnvValue(account, ctx, "X_ACCESS_TOKEN");
  const accessTokenSecret = accountEnvValue(account, ctx, "X_ACCESS_TOKEN_SECRET");
  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) return null;
  const url = new URL(path, "https://api.x.com");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return probeFetch(ctx, url.toString(), {
    headers: { Authorization: xOAuth1Authorization({ method: "GET", url: url.toString(), consumerKey, consumerSecret, accessToken, accessTokenSecret }) },
  }, 30_000);
}
