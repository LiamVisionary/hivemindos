export type ModerationMode = "off" | "audit" | "enforce";

export type ModerationMemberState = {
  firstSeenAt: string;
  lastSeenAt: string;
  messagesSeen: number;
  strikes: number;
  warnings: number;
  mutedUntil?: string;
  bannedAt?: string;
};

export type ModerationChatState = {
  mode?: ModerationMode;
  trustedUserIds: string[];
  members: Record<string, ModerationMemberState>;
};

export type ModerationAuditEntry = {
  id: string;
  chatId: string;
  userId: string;
  messageId?: number;
  updateId?: number;
  updateKind?: "message" | "edited_message";
  reason: string;
  action: string;
  mode: ModerationMode;
  createdAt: string;
  evidence?: {
    duplicateOccurrences?: number;
    floodMessageCount?: number;
    matchedMessageIds?: number[];
    normalizedTextLength?: number;
  };
};

export type TipBotModerationState = {
  version: 1;
  chats: Record<string, ModerationChatState>;
  audit: ModerationAuditEntry[];
  updatedAt: string;
};

const MAX_AUDIT_ENTRIES = 2_000;

export function emptyModerationState(): TipBotModerationState {
  return { version: 1, chats: {}, audit: [], updatedAt: new Date(0).toISOString() };
}

export function ensureModerationChat(state: TipBotModerationState, chatId: string): ModerationChatState {
  state.chats[chatId] ??= { trustedUserIds: [], members: {} };
  state.chats[chatId].trustedUserIds ??= [];
  state.chats[chatId].members ??= {};
  return state.chats[chatId];
}

export function recordModerationMemberMessage(
  state: TipBotModerationState,
  params: { chatId: string; userId: string; at: string },
): ModerationMemberState {
  const chat = ensureModerationChat(state, params.chatId);
  const member = (chat.members[params.userId] ??= {
    firstSeenAt: params.at,
    lastSeenAt: params.at,
    messagesSeen: 0,
    strikes: 0,
    warnings: 0,
  });
  member.lastSeenAt = params.at;
  member.messagesSeen += 1;
  return member;
}

export function recordModerationJoin(
  state: TipBotModerationState,
  params: { chatId: string; userId: string; at: string },
): ModerationMemberState {
  const chat = ensureModerationChat(state, params.chatId);
  const existing = chat.members[params.userId];
  if (existing) {
    existing.firstSeenAt = params.at;
    existing.lastSeenAt = params.at;
    existing.messagesSeen = 0;
    return existing;
  }
  const member: ModerationMemberState = {
    firstSeenAt: params.at,
    lastSeenAt: params.at,
    messagesSeen: 0,
    strikes: 0,
    warnings: 0,
  };
  chat.members[params.userId] = member;
  return member;
}

export function addModerationStrike(
  state: TipBotModerationState,
  params: { chatId: string; userId: string; at: string; warning?: boolean; mutedUntil?: string; banned?: boolean },
): ModerationMemberState {
  const member = recordModerationMemberMessage(state, {
    chatId: params.chatId,
    userId: params.userId,
    at: params.at,
  });
  member.messagesSeen = Math.max(0, member.messagesSeen - 1);
  member.strikes += 1;
  if (params.warning) member.warnings += 1;
  if (params.mutedUntil) member.mutedUntil = params.mutedUntil;
  if (params.banned) member.bannedAt = params.at;
  return member;
}

export function setModerationTrust(state: TipBotModerationState, chatId: string, userId: string, trusted: boolean) {
  const chat = ensureModerationChat(state, chatId);
  const ids = new Set(chat.trustedUserIds);
  if (trusted) ids.add(userId);
  else ids.delete(userId);
  chat.trustedUserIds = [...ids].sort((left, right) => left.localeCompare(right));
}

export function isModerationTrusted(state: TipBotModerationState, chatId: string, userId: string): boolean {
  return ensureModerationChat(state, chatId).trustedUserIds.includes(userId);
}

export function setModerationMode(state: TipBotModerationState, chatId: string, mode: ModerationMode) {
  ensureModerationChat(state, chatId).mode = mode;
}

export function resolveModerationMode(
  state: TipBotModerationState,
  chatId: string,
  fallback: Exclude<ModerationMode, "off">,
): ModerationMode {
  return ensureModerationChat(state, chatId).mode ?? fallback;
}

export function appendModerationAudit(state: TipBotModerationState, entry: ModerationAuditEntry) {
  state.audit.push(entry);
  if (state.audit.length > MAX_AUDIT_ENTRIES) state.audit.splice(0, state.audit.length - MAX_AUDIT_ENTRIES);
}

export function moderationStats(state: TipBotModerationState, chatId: string) {
  const chat = ensureModerationChat(state, chatId);
  const members = Object.values(chat.members);
  const audit = state.audit.filter((entry) => entry.chatId === chatId);
  return {
    membersSeen: members.length,
    trustedUsers: chat.trustedUserIds.length,
    strikes: members.reduce((total, member) => total + member.strikes, 0),
    warnings: members.reduce((total, member) => total + member.warnings, 0),
    actions: audit.length,
    salesRedirects: audit.filter(
      (entry) =>
        entry.reason === "sales-solicitation" &&
        entry.action.includes("redirect") &&
        !entry.action.includes("delivery-failed"),
    ).length,
  };
}
