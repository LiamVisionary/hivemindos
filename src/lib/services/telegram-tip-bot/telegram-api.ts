import "server-only";

// Minimal fetch-based Telegram Bot API client. Long polling only — no
// webhook, no extra dependency. https://core.telegram.org/bots/api

export type TgUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
};

export type TgChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
};

export type TgMessageEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
};

export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
};

export type TgInlineKeyboardButton = { text: string; url: string };

export class TelegramApiError extends Error {
  constructor(
    method: string,
    description: string,
    public readonly retryAfterSec?: number,
  ) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = "TelegramApiError";
  }
}

export class TelegramBotApi {
  constructor(private readonly token: string) {}

  async call<T>(method: string, payload?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } }
        | null;
      if (!data?.ok) {
        throw new TelegramApiError(method, data?.description ?? `HTTP ${response.status}`, data?.parameters?.retry_after);
      }
      return data.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>("getMe");
  }

  getUpdates(offset: number | undefined, timeoutSec = 25): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSec, allowed_updates: ["message"] },
      (timeoutSec + 15) * 1000,
    );
  }

  async sendMessage(params: {
    chatId: number | string;
    text: string;
    replyToMessageId?: number;
    inlineKeyboard?: TgInlineKeyboardButton[][];
    forceReply?: boolean;
  }): Promise<TgMessage> {
    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      text: params.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    };
    if (params.replyToMessageId) {
      payload.reply_parameters = { message_id: params.replyToMessageId, allow_sending_without_reply: true };
    }
    if (params.inlineKeyboard) payload.reply_markup = { inline_keyboard: params.inlineKeyboard };
    // ForceReply opens the user's reply box aimed at this message — used by
    // the ask-for-missing-arguments flow. selective: only for the asked user.
    else if (params.forceReply) payload.reply_markup = { force_reply: true, selective: true };
    try {
      return await this.call<TgMessage>("sendMessage", payload);
    } catch (error) {
      if (error instanceof TelegramApiError && error.retryAfterSec) {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfterSec ?? 1) * 1000));
        return this.call<TgMessage>("sendMessage", payload);
      }
      throw error;
    }
  }

  async sendRichMessage(params: {
    chatId: number | string;
    html: string;
    fallbackText: string;
    replyToMessageId?: number;
  }): Promise<TgMessage> {
    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      rich_message: { html: params.html },
      link_preview_options: { is_disabled: true },
    };
    if (params.replyToMessageId) {
      payload.reply_parameters = { message_id: params.replyToMessageId, allow_sending_without_reply: true };
    }
    try {
      return await this.call<TgMessage>("sendRichMessage", payload);
    } catch (error) {
      if (error instanceof TelegramApiError && error.retryAfterSec) {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfterSec ?? 1) * 1000));
        try {
          return await this.call<TgMessage>("sendRichMessage", payload);
        } catch {
          // Fall through to the plain HTML fallback below.
        }
      }
      return this.sendMessage({
        chatId: params.chatId,
        text: params.fallbackText,
        replyToMessageId: params.replyToMessageId,
      });
    }
  }

  async sendPhoto(params: {
    chatId: number | string;
    png: ArrayBuffer;
    caption?: string;
    replyToMessageId?: number;
  }): Promise<TgMessage> {
    const form = new FormData();
    form.set("chat_id", String(params.chatId));
    form.set("photo", new Blob([params.png], { type: "image/png" }), "hive-table.png");
    if (params.caption) {
      form.set("caption", params.caption);
      form.set("parse_mode", "HTML");
    }
    if (params.replyToMessageId) {
      form.set("reply_parameters", JSON.stringify({ message_id: params.replyToMessageId, allow_sending_without_reply: true }));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; result?: TgMessage; description?: string; parameters?: { retry_after?: number } }
        | null;
      if (!data?.ok) {
        throw new TelegramApiError("sendPhoto", data?.description ?? `HTTP ${response.status}`, data?.parameters?.retry_after);
      }
      return data.result as TgMessage;
    } catch (error) {
      if (error instanceof TelegramApiError && error.retryAfterSec) {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfterSec ?? 1) * 1000));
        return this.sendPhoto(params);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<boolean> {
    return this.call<boolean>("setMyCommands", { commands });
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML mention that works for users with or without a public @username.
export function mentionHtml(user: { id: string; username?: string; firstName?: string }): string {
  if (user.username) return `@${escapeHtml(user.username)}`;
  return `<a href="tg://user?id=${user.id}">${escapeHtml(user.firstName || "user")}</a>`;
}
