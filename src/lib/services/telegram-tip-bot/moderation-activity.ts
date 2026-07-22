export type ModerationActivityPolicy = {
  duplicateMinCharacters: number;
  duplicateMinOccurrences: number;
  duplicateWindowMs: number;
  floodMaxMessages: number;
  floodWindowMs: number;
};

export type ModerationActivityResult = {
  duplicate: boolean;
  duplicateOccurrences: number;
  flood: boolean;
  floodMessageCount: number;
  matchedMessageIds: number[];
  normalizedTextLength: number;
  replayedMessage: boolean;
};

type SeenMessage = {
  fingerprint: string;
  messageId: number;
  seenAt: number;
};

type MemberActivity = {
  lastSeenAt: number;
  messages: Map<number, SeenMessage>;
};

const DEFAULT_MAX_ACTIVITY_KEYS = 10_000;

export function normalizeDuplicateText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 2_000);
}

export class ModerationActivityTracker {
  private readonly recentActivity = new Map<string, MemberActivity>();
  private readonly maxActivityKeys: number;

  constructor(maxActivityKeys = DEFAULT_MAX_ACTIVITY_KEYS) {
    this.maxActivityKeys = maxActivityKeys;
  }

  record(
    params: { chatId: string; messageId: number; now?: number; text: string; userId: string },
    policy: ModerationActivityPolicy,
  ): ModerationActivityResult {
    const now = params.now ?? Date.now();
    const key = `${params.chatId}:${params.userId}`;
    const activity = this.recentActivity.get(key) ?? { lastSeenAt: now, messages: new Map<number, SeenMessage>() };
    activity.lastSeenAt = now;

    const retentionMs = Math.max(policy.duplicateWindowMs, policy.floodWindowMs);
    for (const [messageId, message] of activity.messages) {
      if (now - message.seenAt > retentionMs) activity.messages.delete(messageId);
    }

    const fingerprint = normalizeDuplicateText(params.text);
    const normalizedTextLength = fingerprint.length;
    const replayedMessage = activity.messages.has(params.messageId);
    if (!replayedMessage) {
      activity.messages.set(params.messageId, {
        fingerprint,
        messageId: params.messageId,
        seenAt: now,
      });
    }

    const matchingMessages = replayedMessage
      ? []
      : [...activity.messages.values()].filter(
          (message) =>
            message.messageId !== params.messageId &&
            message.fingerprint === fingerprint &&
            now - message.seenAt <= policy.duplicateWindowMs,
        );
    const duplicateOccurrences = replayedMessage ? 1 : matchingMessages.length + 1;
    const floodMessageCount = [...activity.messages.values()].filter(
      (message) => now - message.seenAt <= policy.floodWindowMs,
    ).length;
    const duplicate =
      !replayedMessage &&
      normalizedTextLength >= policy.duplicateMinCharacters &&
      duplicateOccurrences >= policy.duplicateMinOccurrences;

    this.recentActivity.set(key, activity);
    this.trimOldestActivity();

    return {
      duplicate,
      duplicateOccurrences,
      flood: !replayedMessage && floodMessageCount > policy.floodMaxMessages,
      floodMessageCount,
      matchedMessageIds: matchingMessages.map((message) => message.messageId).slice(-5),
      normalizedTextLength,
      replayedMessage,
    };
  }

  private trimOldestActivity() {
    if (this.recentActivity.size <= this.maxActivityKeys) return;
    const oldest = [...this.recentActivity.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, Math.ceil(this.maxActivityKeys / 10));
    for (const [oldestKey] of oldest) this.recentActivity.delete(oldestKey);
  }
}
