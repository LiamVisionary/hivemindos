import type { TgMessage, TgMessageReactionUpdated, TgUser } from "./telegram-api";

export const HONEY_PEER_TIP_AMOUNT = 1;
export const HONEY_PEER_DAILY_GIVER_LIMIT = 3;
export const HONEY_PEER_DAILY_RECIPIENT_LIMIT = 5;
export const HONEY_LEGACY_HIVE_PER_HONEY = 1_000_000;
export const HONEY_LEGACY_TIP_SEED_VERSION = "hive-tip-receivers-v1";
export const HONEY_MICRO_PER_HONEY = 1_000_000n;
export const HONEY_RECOGNITION_REACTION_EMOJI = "🏆";
export const HONEY_REACTION_REASON = "Recognized a useful Telegram contribution.";

const DEFAULT_REACTION_TARGET_TTL_MS = 48 * 60 * 60_000;
const DEFAULT_REACTION_TARGET_LIMIT = 10_000;

type HoneyReactionTarget = {
  user: TgUser;
  observedAt: number;
};

export class HoneyReactionMessageIndex {
  private readonly entries = new Map<string, HoneyReactionTarget>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_REACTION_TARGET_TTL_MS);
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_REACTION_TARGET_LIMIT));
  }

  remember(message: TgMessage, now = Date.now()) {
    if (
      (message.chat.type !== "group" && message.chat.type !== "supergroup")
      || !message.from
      || message.from.is_bot
    ) {
      return;
    }
    const key = reactionMessageKey(message.chat.id, message.message_id);
    this.entries.delete(key);
    this.entries.set(key, { user: message.from, observedAt: now });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.entries.delete(oldestKey);
    }
  }

  resolve(chatId: number, messageId: number, now = Date.now()): TgUser | null {
    const key = reactionMessageKey(chatId, messageId);
    const target = this.entries.get(key);
    if (!target) return null;
    if (now - target.observedAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return target.user;
  }
}

export function honeyRecognitionReactionWasAdded(
  update: Pick<TgMessageReactionUpdated, "old_reaction" | "new_reaction">,
): boolean {
  return !hasRecognitionReaction(update.old_reaction) && hasRecognitionReaction(update.new_reaction);
}

export type HoneyReactionRejectionReport = {
  reactionRemoved: boolean;
  publicReplySent: boolean;
  giverDmSent: boolean;
  reported: boolean;
};

export async function reportRejectedHoneyReaction(input: {
  deleteReaction: () => Promise<boolean>;
  sendGroupReply: (reactionRemoved: boolean) => Promise<void>;
  notifyGiver: (reactionRemoved: boolean) => Promise<boolean>;
}): Promise<HoneyReactionRejectionReport> {
  const reactionRemoved = await input.deleteReaction().catch(() => false);
  const publicReplySent = await input.sendGroupReply(reactionRemoved)
    .then(() => true)
    .catch(() => false);
  const giverDmSent = publicReplySent
    ? false
    : await input.notifyGiver(reactionRemoved).catch(() => false);
  return {
    reactionRemoved,
    publicReplySent,
    giverDmSent,
    reported: publicReplySent || giverDmSent,
  };
}

function hasRecognitionReaction(reactions: TgMessageReactionUpdated["new_reaction"]): boolean {
  return reactions.some(
    (reaction) => reaction.type === "emoji" && reaction.emoji === HONEY_RECOGNITION_REACTION_EMOJI,
  );
}

function reactionMessageKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export type HoneyCommandAction =
  | { kind: "profile" }
  | { kind: "give"; reason: string };

const MIN_REASON_LENGTH = 8;
const MAX_REASON_LENGTH = 160;

export function parseHoneyCommandArgs(args: string): HoneyCommandAction {
  const normalized = args.replace(/\s+/g, " ").trim();
  if (!normalized || /^(balance|profile)$/i.test(normalized)) return { kind: "profile" };
  if (/^\d+(?:\.\d+)?(?:\s|$)/.test(normalized)) {
    throw new Error("Peer recognition is fixed at 1 HONEY; include only the recipient and reason.");
  }
  const reason = normalized.replace(/^@[A-Za-z0-9_]{1,64}(?:\s+|$)/, "").trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new Error(`Explain the contribution in at least ${MIN_REASON_LENGTH} characters.`);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`Keep the recognition reason to ${MAX_REASON_LENGTH} characters or fewer.`);
  }
  return { kind: "give", reason };
}

export function legacyHoneyMicroFromHiveRaw(amountRaw: string, hiveDecimals: number): bigint {
  if (!/^\d+$/.test(amountRaw)) throw new Error("Historical HIVE amount must be a non-negative integer.");
  if (!Number.isInteger(hiveDecimals) || hiveDecimals < 0 || hiveDecimals > 36) {
    throw new Error("HIVE decimals must be an integer between 0 and 36.");
  }
  const raw = BigInt(amountRaw);
  const hiveUnit = 10n ** BigInt(hiveDecimals);
  return (raw * HONEY_MICRO_PER_HONEY) / (BigInt(HONEY_LEGACY_HIVE_PER_HONEY) * hiveUnit);
}
