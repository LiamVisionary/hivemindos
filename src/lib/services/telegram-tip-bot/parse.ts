// Pure parsing for the tip bot: turning a raw Telegram message into a command
// and resolving who a /tip is aimed at. Type-only imports and zero I/O, so
// scripts/test-telegram-tip-bot.mjs can import it directly under node --test
// (raw Node ESM won't resolve extensionless relative *value* imports, and the
// transitive server-only import would throw — type imports sidestep both).
import type { TipBotState, TipBotUser } from "./ledger";
import type { TgMessage, TgUser } from "./telegram-api";

// Inlined from ledger.findUserByUsername to keep this module import-free at
// runtime; the username index is the source of truth either way.
function findStoredUserByUsername(state: TipBotState, username: string): TipBotUser | null {
  const id = state.usernameIndex[username.replace(/^@/, "").toLowerCase()];
  return id ? state.users[id] ?? null : null;
}

export type ParsedCommand = { command: string; args: string; targetUserId?: string };

export function parseCommand(text: string, botUsername: string): ParsedCommand | null {
  const normalizedText = text.trim();
  const match = normalizedText.match(/^\/([a-zA-Z0-9_]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/);
  if (match) {
    if (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
    return { command: match[1].toLowerCase(), args: (match[3] ?? "").trim() };
  }
  // Mid-message tips: "thanks a lot, /tip 1000" should work — that's how
  // people naturally tip in replies. Only /tip gets this leniency; firing
  // /balance off a mid-sentence slash would be noisy.
  const tip = normalizedText.match(/(?:^|\s)\/tip(?:@(\S+))?(?:\s+([\s\S]*))?$/i);
  if (tip) {
    if (tip[1] && tip[1].toLowerCase() !== botUsername.toLowerCase()) return null;
    return { command: "tip", args: (tip[2] ?? "").trim() };
  }
  return null;
}

export type TipRecipient =
  | { kind: "user"; user: TgUser }
  | { kind: "stored"; user: TipBotUser }
  | { kind: "claim"; username: string };

export function resolveTipRecipient(state: TipBotState, message: TgMessage, botUsername: string): TipRecipient | null {
  // text_mention entities carry the user object directly — that's how Telegram
  // delivers a tap-to-mention of someone who has no public @username.
  const textMention = message.entities?.find((entity) => entity.type === "text_mention" && entity.user);
  if (textMention?.user && !textMention.user.is_bot) return { kind: "user", user: textMention.user };
  // A public @username can appear ANYWHERE in the sentence — before or after
  // the /tip token ("...so @alice /tip 5m"), so scan the whole message text,
  // not just the args after /tip. Strip trailing sentence punctuation and skip
  // a mention of the bot itself (e.g. /tip@thebot).
  const usernameToken = (message.text ?? "")
    .split(/\s+/)
    .map((token) => token.replace(/[.,!?;:]+$/, ""))
    .find(
      (token) =>
        token.startsWith("@") &&
        token.length > 1 &&
        token.slice(1).toLowerCase() !== botUsername.toLowerCase(),
    );
  if (usernameToken) {
    const stored = findStoredUserByUsername(state, usernameToken);
    return stored ? { kind: "stored", user: stored } : { kind: "claim", username: usernameToken.slice(1) };
  }
  if (message.reply_to_message?.from && !message.reply_to_message.from.is_bot) {
    return { kind: "user", user: message.reply_to_message.from };
  }
  return null;
}
