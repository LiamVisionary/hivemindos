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

  async post() {
    notYetWired("telegram", "posting");
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
