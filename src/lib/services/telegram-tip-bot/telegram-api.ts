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
  date?: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  chat_member?: TgChatMemberUpdated;
};

export type TgInlineKeyboardButton = { text: string; url: string };

export type TgChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TgUser;
  tag?: string;
  can_delete_messages?: boolean;
  can_restrict_members?: boolean;
  can_invite_users?: boolean;
};

export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
};

export type TgChatPermissions = {
  can_send_messages: boolean;
  can_send_audios: boolean;
  can_send_documents: boolean;
  can_send_photos: boolean;
  can_send_videos: boolean;
  can_send_video_notes: boolean;
  can_send_voice_notes: boolean;
  can_send_polls: boolean;
  can_send_other_messages: boolean;
  can_add_web_page_previews: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_pin_messages: boolean;
  can_manage_topics: boolean;
};

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
      { offset, timeout: timeoutSec, allowed_updates: ["message", "edited_message", "chat_member"] },
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

  getChatMember(params: { chatId: number | string; userId: number | string }): Promise<TgChatMember> {
    return this.call<TgChatMember>("getChatMember", { chat_id: params.chatId, user_id: params.userId });
  }

  deleteMessage(params: { chatId: number | string; messageId: number }): Promise<boolean> {
    return this.call<boolean>("deleteMessage", { chat_id: params.chatId, message_id: params.messageId });
  }

  copyMessage(params: {
    chatId: number | string;
    fromChatId: number | string;
    messageId: number;
  }): Promise<{ message_id: number }> {
    return this.call<{ message_id: number }>("copyMessage", {
      chat_id: params.chatId,
      from_chat_id: params.fromChatId,
      message_id: params.messageId,
    });
  }

  restrictChatMember(params: {
    chatId: number | string;
    userId: number | string;
    permissions: TgChatPermissions;
    untilDate?: number;
  }): Promise<boolean> {
    return this.call<boolean>("restrictChatMember", {
      chat_id: params.chatId,
      user_id: params.userId,
      permissions: params.permissions,
      use_independent_chat_permissions: true,
      until_date: params.untilDate,
    });
  }

  banChatMember(params: {
    chatId: number | string;
    userId: number | string;
    untilDate?: number;
    revokeMessages?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>("banChatMember", {
      chat_id: params.chatId,
      user_id: params.userId,
      until_date: params.untilDate,
      revoke_messages: params.revokeMessages ?? true,
    });
  }

  unbanChatMember(params: { chatId: number | string; userId: number | string; onlyIfBanned?: boolean }): Promise<boolean> {
    return this.call<boolean>("unbanChatMember", {
      chat_id: params.chatId,
      user_id: params.userId,
      only_if_banned: params.onlyIfBanned ?? true,
    });
  }

  setChatMemberTag(params: { chatId: number | string; userId: number | string; tag: string }): Promise<boolean> {
    return this.call<boolean>("setChatMemberTag", { chat_id: params.chatId, user_id: params.userId, tag: params.tag });
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
