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
 * Telegram channel posting via the Bot API. The bot token lives in the shared
 * hive env (TELEGRAM_BOT_TOKEN); the target channel id is the non-secret
 * `binding.chatId`. Bot API exposes no per-post view counts — analytics are
 * member-count only by design (see the matrix row).
 */
export const telegramSocialAdapter: SocialPlatformAdapter = {
  platform: "telegram",

  async connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe> {
    const token = accountEnvValue(account, ctx, "TELEGRAM_BOT_TOKEN");
    if (!token) return { ok: false, detail: "TELEGRAM_BOT_TOKEN is not set in the shared hive env." };
    const chatId = (account.binding?.chatId ?? "").trim();
    if (!chatId) return { ok: false, detail: "No channel chatId binding on this account." };
    try {
      const me = await probeFetch(ctx, `https://api.telegram.org/bot${token}/getMe`);
      const meBody = (await me.json()) as { ok?: boolean; result?: { username?: string } };
      if (!me.ok || !meBody.ok) return { ok: false, detail: "Bot token rejected by Telegram (getMe failed)." };
      const chat = await probeFetch(ctx, `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
      const chatBody = (await chat.json()) as { ok?: boolean; result?: { title?: string } };
      if (!chat.ok || !chatBody.ok) {
        return { ok: false, detail: `Bot cannot see chat ${chatId} — add it to the channel as an admin with post rights.` };
      }
      return {
        ok: true,
        detail: `Bot @${meBody.result?.username ?? "unknown"} can post to ${chatBody.result?.title ?? chatId}.`,
        handle: meBody.result?.username,
        displayName: chatBody.result?.title,
      };
    } catch (error) {
      return { ok: false, detail: `Telegram probe failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  },

  async post(input, ctx) {
    if (input.media?.length) throw new SocialPostError("Telegram media publishing is not supported by this text queue yet.");
    const token = accountEnvValue(input.account, ctx, "TELEGRAM_BOT_TOKEN");
    const chatId = (input.account.binding?.chatId ?? "").trim();
    if (!token || !chatId) throw new SocialPostError("Telegram posting needs TELEGRAM_BOT_TOKEN and an account chatId binding.");
    const replyMessageId = input.replyTo ? Number(input.replyTo) : Number.NaN;
    let response: Response;
    try {
      response = await probeFetch(ctx, `https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: input.text,
          ...(Number.isInteger(replyMessageId) && replyMessageId > 0
            ? { reply_parameters: { message_id: replyMessageId, allow_sending_without_reply: false } }
            : {}),
        }),
      }, 30_000);
    } catch (error) {
      throw new SocialPostError(`Telegram delivery status is unknown: ${error instanceof Error ? error.message : String(error)}`, { ambiguous: true });
    }
    if (!response.ok) throw await socialPostResponseError("telegram", response);
    const body = (await response.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!body.ok || !Number.isInteger(body.result?.message_id)) throw new SocialPostError(body.description ?? "Telegram did not return a message id.");
    return { externalId: String(body.result!.message_id), url: telegramMessageUrl(input.account, body.result!.message_id!) };
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics(account: SocialAccount, ctx: SocialAdapterContext) {
    const out: Record<string, number> = {};
    const token = accountEnvValue(account, ctx, "TELEGRAM_BOT_TOKEN");
    const chatId = (account.binding?.chatId ?? "").trim();
    if (!token || !chatId) return out;
    try {
      const res = await probeFetch(ctx, `https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`);
      const body = (await res.json()) as { ok?: boolean; result?: number };
      if (res.ok && body.ok && typeof body.result === "number") out.members = body.result;
    } catch {
      // metrics are best-effort; the UI renders absence, not zeros
    }
    return out;
  },

  capabilities() {
    return { ...socialPlatformRow("telegram").capabilities };
  },
};

function telegramMessageUrl(account: SocialAccount, messageId: number): string | undefined {
  const handle = account.handle.replace(/^@/, "").trim();
  if (handle && !/^-?\d+$/.test(handle)) return `https://t.me/${handle}/${messageId}`;
  const chatId = (account.binding?.chatId ?? "").replace(/^-100/, "");
  return chatId ? `https://t.me/c/${chatId}/${messageId}` : undefined;
}
