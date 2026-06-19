import type { TipBotState } from "./ledger";

export const TELEGRAM_MEMBER_TAG_MAX_LENGTH = 16;
export const DEFAULT_MEMBER_TAG_TOP_LIMIT = 5;
export const DEFAULT_MEMBER_TAG_WINDOW_DAYS = 7;

export type TipBotMemberTagsState = {
  chatIds: string[];
  lastSynced: Record<string, Record<string, string>>;
  lastSyncAt?: string;
};

export type MemberTagTier = {
  id: string;
  label: string;
};

export type MemberTagLeaderboardRow = {
  userId: string;
  totalRaw: string;
  count: number;
};

export type MemberTagSyncAction = {
  chatId: string;
  userId: string;
  tag: string;
  previousTag: string;
  reason: string;
};

export type MemberTagSyncResult = {
  chatId: string;
  userId: string;
  tag: string;
};

function memberTagsState(state: TipBotState): TipBotMemberTagsState {
  state.memberTags ??= { chatIds: [], lastSynced: {} };
  state.memberTags.chatIds ??= [];
  state.memberTags.lastSynced ??= {};
  return state.memberTags;
}

export function rememberMemberTagChat(state: TipBotState, chatId: string) {
  const value = chatId.trim();
  if (!value) return;
  const tags = memberTagsState(state);
  if (!tags.chatIds.includes(value)) tags.chatIds.push(value);
}

export function knownMemberTagChatIds(state: TipBotState, configuredChatIds: readonly string[] = []): string[] {
  const ids = new Set<string>();
  for (const chatId of configuredChatIds) {
    const value = chatId.trim();
    if (value) ids.add(value);
  }
  for (const chatId of state.memberTags?.chatIds ?? []) {
    const value = chatId.trim();
    if (value) ids.add(value);
  }
  for (const entry of state.ledger) {
    if (entry.chatId) ids.add(entry.chatId);
  }
  for (const bounty of Object.values(state.bounties ?? {})) {
    if (bounty.chatId) ids.add(bounty.chatId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function bountyPayoutLeaderboard(
  state: TipBotState,
  params: { chatId?: string; sinceIso?: string } = {},
): MemberTagLeaderboardRow[] {
  const rows = new Map<string, { total: bigint; count: number }>();
  for (const entry of state.ledger) {
    if (entry.kind !== "bounty-payout" || !entry.toUserId) continue;
    if (params.chatId && entry.chatId !== params.chatId) continue;
    if (params.sinceIso && entry.createdAt < params.sinceIso) continue;
    const row = rows.get(entry.toUserId) ?? { total: 0n, count: 0 };
    row.total += BigInt(entry.amountRaw);
    row.count += 1;
    rows.set(entry.toUserId, row);
  }
  return [...rows.entries()]
    .map(([userId, row]) => ({ userId, totalRaw: row.total.toString(), count: row.count }))
    .sort((left, right) => compareLeaderboardRows(left, right));
}

export function resolveMemberTag(params: {
  tier?: MemberTagTier | null;
  honeyRank?: number;
  bountyRank?: number;
}): { tag: string; reason: string } {
  const tier = params.tier ?? null;
  const rank = bestRank(params);
  if (tier && rank) {
    const tag = `${tier.label} ${rank.kind === "bounty" ? "B" : "H"}#${rank.value}`;
    return fitTag(tag, tier.label, rank);
  }
  if (rank) {
    return { tag: `${rank.kind === "bounty" ? "Bounty" : "Honey"} #${rank.value}`, reason: `${rank.kind}-rank` };
  }
  if (tier) return { tag: `Hive ${tier.label}`, reason: "staking-tier" };
  return { tag: "", reason: "none" };
}

export function desiredMemberTagsForChat(
  state: TipBotState,
  params: {
    chatId: string;
    topLimit?: number;
    sinceIso?: string;
    tiersByUserId?: ReadonlyMap<string, MemberTagTier>;
  },
): Map<string, { tag: string; reason: string }> {
  const topLimit = positiveLimit(params.topLimit);
  const honeyRanks = rankMap(honeyReceiverLeaderboard(state, { chatId: params.chatId, sinceIso: params.sinceIso }), topLimit);
  const bountyRanks = rankMap(bountyPayoutLeaderboard(state, { chatId: params.chatId, sinceIso: params.sinceIso }), topLimit);
  const desired = new Map<string, { tag: string; reason: string }>();
  for (const userId of Object.keys(state.users)) {
    const resolved = resolveMemberTag({
      tier: params.tiersByUserId?.get(userId),
      honeyRank: honeyRanks.get(userId),
      bountyRank: bountyRanks.get(userId),
    });
    if (resolved.tag) desired.set(userId, resolved);
  }
  return desired;
}

export function planMemberTagSync(
  state: TipBotState,
  params: {
    chatIds: readonly string[];
    topLimit?: number;
    sinceIso?: string;
    tiersByUserId?: ReadonlyMap<string, MemberTagTier>;
  },
): MemberTagSyncAction[] {
  const actions: MemberTagSyncAction[] = [];
  const tags = memberTagsState(state);
  for (const chatId of params.chatIds) {
    const desired = desiredMemberTagsForChat(state, {
      chatId,
      topLimit: params.topLimit,
      sinceIso: params.sinceIso,
      tiersByUserId: params.tiersByUserId,
    });
    const previous = tags.lastSynced[chatId] ?? {};
    const userIds = new Set([...desired.keys(), ...Object.keys(previous)]);
    for (const userId of userIds) {
      const current = desired.get(userId);
      const tag = current?.tag ?? "";
      const previousTag = previous[userId] ?? "";
      if (tag === previousTag) continue;
      actions.push({
        chatId,
        userId,
        tag,
        previousTag,
        reason: current?.reason ?? "clear-stale-tag",
      });
    }
  }
  return actions;
}

export function recordMemberTagSync(state: TipBotState, results: readonly MemberTagSyncResult[], now: string) {
  const tags = memberTagsState(state);
  for (const result of results) {
    rememberMemberTagChat(state, result.chatId);
    tags.lastSynced[result.chatId] ??= {};
    if (result.tag) tags.lastSynced[result.chatId][result.userId] = result.tag;
    else delete tags.lastSynced[result.chatId][result.userId];
  }
  for (const chatId of Object.keys(tags.lastSynced)) {
    if (!Object.keys(tags.lastSynced[chatId]).length) delete tags.lastSynced[chatId];
  }
  tags.lastSyncAt = now;
}

export function memberTagSinceIso(windowDays: number, nowMs = Date.now()): string | undefined {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return undefined;
  return new Date(nowMs - windowDays * 24 * 3_600_000).toISOString();
}

function compareLeaderboardRows(left: MemberTagLeaderboardRow, right: MemberTagLeaderboardRow): number {
  const leftTotal = BigInt(left.totalRaw);
  const rightTotal = BigInt(right.totalRaw);
  if (rightTotal > leftTotal) return 1;
  if (rightTotal < leftTotal) return -1;
  if (right.count !== left.count) return right.count - left.count;
  return left.userId.localeCompare(right.userId);
}

function honeyReceiverLeaderboard(
  state: TipBotState,
  params: { chatId?: string; sinceIso?: string } = {},
): MemberTagLeaderboardRow[] {
  const rows = new Map<string, { total: bigint; count: number }>();
  for (const entry of state.ledger) {
    if (params.chatId && entry.chatId !== params.chatId) continue;
    if (params.sinceIso && entry.createdAt < params.sinceIso) continue;
    if ((entry.kind !== "tip" && entry.kind !== "claim-credit") || !entry.toUserId) continue;
    const row = rows.get(entry.toUserId) ?? { total: 0n, count: 0 };
    row.total += BigInt(entry.amountRaw);
    row.count += 1;
    rows.set(entry.toUserId, row);
  }
  return [...rows.entries()]
    .map(([userId, row]) => ({ userId, totalRaw: row.total.toString(), count: row.count }))
    .sort((left, right) => compareLeaderboardRows(left, right));
}

function rankMap(rows: readonly MemberTagLeaderboardRow[], topLimit: number): Map<string, number> {
  return new Map(rows.slice(0, topLimit).map((row, index) => [row.userId, index + 1]));
}

function positiveLimit(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : DEFAULT_MEMBER_TAG_TOP_LIMIT;
}

function bestRank(params: { honeyRank?: number; bountyRank?: number }): { kind: "honey" | "bounty"; value: number } | null {
  const ranks = [
    params.honeyRank ? { kind: "honey" as const, value: params.honeyRank } : null,
    params.bountyRank ? { kind: "bounty" as const, value: params.bountyRank } : null,
  ].filter((rank): rank is { kind: "honey" | "bounty"; value: number } => Boolean(rank));
  if (!ranks.length) return null;
  return ranks.sort((left, right) => left.value - right.value || (left.kind === "bounty" ? -1 : 1))[0];
}

function fitTag(
  preferred: string,
  tierLabel: string,
  rank: { kind: "honey" | "bounty"; value: number },
): { tag: string; reason: string } {
  if (preferred.length <= TELEGRAM_MEMBER_TAG_MAX_LENGTH) return { tag: preferred, reason: `${rank.kind}-rank+staking-tier` };
  const compact = `${tierLabel[0]} ${rank.kind === "bounty" ? "B" : "H"}#${rank.value}`;
  return { tag: compact.slice(0, TELEGRAM_MEMBER_TAG_MAX_LENGTH), reason: `${rank.kind}-rank+staking-tier` };
}
