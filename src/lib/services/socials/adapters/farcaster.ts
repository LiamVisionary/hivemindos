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
 * Farcaster via Neynar: NEYNAR_API_KEY in the shared hive env, fid +
 * signerUuid as non-secret bindings. The probe verifies the key and resolves
 * the fid's profile before the queue considers the account connected.
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

  async post(input, ctx) {
    if (input.media?.length) throw new SocialPostError("Farcaster local media upload is not supported; use a URL embed in the post text.");
    const key = accountEnvValue(input.account, ctx, "NEYNAR_API_KEY");
    const signerUuid = (input.account.binding?.signerUuid ?? "").trim();
    if (!key || !signerUuid) throw new SocialPostError("Farcaster posting needs NEYNAR_API_KEY and a signerUuid binding.");
    const quote = parseCastRef(input.quoteOf);
    const body = {
      signer_uuid: signerUuid,
      text: input.text,
      idem: input.idempotencyKey.slice(0, 64),
      ...(input.replyTo ? { parent: input.replyTo } : {}),
      ...(quote ? { embeds: [{ cast_id: quote }] } : {}),
    };
    let response: Response;
    try {
      response = await probeFetch(ctx, "https://api.neynar.com/v2/farcaster/cast/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      }, 30_000);
    } catch (error) {
      // Neynar's idem key makes retrying this exact queue item safe.
      throw new SocialPostError(`Neynar request failed: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
    }
    if (!response.ok) {
      const error = await socialPostResponseError("farcaster", response);
      if (error.ambiguous) throw new SocialPostError(error.message, { status: error.status, retryable: true });
      throw error;
    }
    const parsed = (await response.json()) as { success?: boolean; cast?: { hash?: string; author?: { username?: string } } };
    const hash = parsed.cast?.hash;
    if (!parsed.success || !hash) throw new SocialPostError("Neynar accepted the request but returned no cast hash.");
    const username = parsed.cast?.author?.username ?? input.account.handle;
    return { externalId: hash, url: username ? `https://warpcast.com/${username.replace(/^@/, "")}/${hash.slice(0, 10)}` : undefined };
  },

  async fetchPostMetrics(account, externalIds, ctx) {
    const key = accountEnvValue(account, ctx, "NEYNAR_API_KEY");
    if (!key) return [];
    const rows = await Promise.all(externalIds.slice(0, 50).map(async (externalId) => {
      try {
        const response = await probeFetch(ctx, `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(externalId)}&type=hash`, { headers: { "x-api-key": key } });
        if (!response.ok) return null;
        const body = (await response.json()) as { cast?: { reactions?: { likes_count?: number; recasts_count?: number }; replies?: { count?: number } } };
        return {
          externalId,
          at: new Date().toISOString(),
          metrics: {
            likes: body.cast?.reactions?.likes_count ?? 0,
            recasts: body.cast?.reactions?.recasts_count ?? 0,
            replies: body.cast?.replies?.count ?? 0,
          },
        };
      } catch {
        return null;
      }
    }));
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  },

  async fetchAccountMetrics(account, ctx): Promise<Record<string, number>> {
    const key = accountEnvValue(account, ctx, "NEYNAR_API_KEY");
    const fid = (account.binding?.fid ?? "").trim();
    if (!key || !fid) return {};
    try {
      const response = await probeFetch(ctx, `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(fid)}`, { headers: { "x-api-key": key } });
      if (!response.ok) return {};
      const user = ((await response.json()) as { users?: Array<{ follower_count?: number; following_count?: number }> }).users?.[0];
      return user ? { followers: user.follower_count ?? 0, following: user.following_count ?? 0 } : {};
    } catch {
      return {};
    }
  },

  capabilities() {
    return { ...socialPlatformRow("farcaster").capabilities };
  },
};

function parseCastRef(value: string | undefined): { fid: number; hash: string } | null {
  if (!value) return null;
  const match = /^(\d+):(0x[0-9a-f]+)$/i.exec(value.trim());
  if (!match) throw new SocialPostError("Farcaster quote targets must use fid:castHash format.");
  return { fid: Number(match[1]), hash: match[2] };
}
