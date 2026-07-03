import {
  HIVE_STAKING_TIERS,
  isHiveEvmAddress,
  type HiveStakingTier,
  type HiveStakingTierId,
} from "@/lib/config/hive-staking";
import { hiveTierForStakedHive } from "@/lib/services/hive-staking";

export const HIVE_STAKING_REWARD_MIN_ACTIVE_SECONDS = 7 * 24 * 60 * 60;
export const HIVE_STAKING_REWARD_USD_PER_MILLION = 39_375;
export const HIVE_STAKING_REWARD_RATE_LABEL = "3.9375%";

export type HiveStakingRewardEventType = "stake" | "unstake-request";

export type HiveStakingRewardEvent = {
  account: string;
  type: HiveStakingRewardEventType;
  amountHive: number;
  timestamp: number;
  txHash?: string;
  logIndex?: number;
};

export type HiveStakingRewardSeason = {
  id: string;
  label: string;
  startAt: number;
  endAt: number;
  eligibleRevenueUsd: number;
  hivePriceUsd?: number;
  claimAt?: number;
  minimumActiveSeconds?: number;
};

export type HiveStakingRewardSegment = {
  account: string;
  tierId: HiveStakingTierId;
  activeStakeHive: number;
  startAt: number;
  endAt: number;
  durationSeconds: number;
  stakeSeconds: number;
};

export type HiveStakingRewardTierSummary = {
  tier: HiveStakingTier;
  eligibleStakeSeconds: number;
  eligibleWeightedStakeSeconds: number;
  eligibleAccountCount: number;
};

export type HiveStakingRewardAccountTierSummary = {
  tierId: HiveStakingTierId;
  stakeSeconds: number;
  weightedStakeSeconds: number;
  rewardUsd: number;
  rewardHive: number | null;
};

export type HiveStakingRewardAccountSummary = {
  account: string;
  activeSeconds: number;
  eligible: boolean;
  rewardUsd: number;
  rewardHive: number | null;
  tiers: HiveStakingRewardAccountTierSummary[];
};

export type HiveStakingSeasonRewardResult = {
  season: HiveStakingRewardSeason;
  minimumActiveSeconds: number;
  totalRewardUsd: number;
  totalRewardHive: number | null;
  segments: HiveStakingRewardSegment[];
  tiers: HiveStakingRewardTierSummary[];
  accounts: HiveStakingRewardAccountSummary[];
};

type AccountState = {
  activeHive: number;
  cursor: number;
};

type AccountAccumulator = {
  account: string;
  activeSeconds: number;
  eligible: boolean;
  rewardUsd: number;
  rewardHive: number;
  tiers: Map<HiveStakingTierId, HiveStakingRewardAccountTierSummary>;
};

export function calculateHiveStakingSeasonRewards(params: {
  season: HiveStakingRewardSeason;
  events: HiveStakingRewardEvent[];
}): HiveStakingSeasonRewardResult {
  const season = normalizeSeason(params.season);
  const minimumActiveSeconds = season.minimumActiveSeconds ?? HIVE_STAKING_REWARD_MIN_ACTIVE_SECONDS;
  const segments = buildHiveStakingRewardSegments({ season, events: params.events });
  const accounts = buildAccountAccumulators(segments, minimumActiveSeconds);
  const eligibleSegments = segments.filter((segment) => accounts.get(segment.account)?.eligible);
  const tierSummaries = buildTierSummaries(season, eligibleSegments);
  const totalRewardUsd = roundUsd(season.eligibleRevenueUsd * (HIVE_STAKING_REWARD_USD_PER_MILLION / 1_000_000));
  const totalWeightedStakeSeconds = Array.from(tierSummaries.values()).reduce(
    (total, summary) => total + summary.eligibleWeightedStakeSeconds,
    0,
  );

  for (const segment of eligibleSegments) {
    const account = accounts.get(segment.account);
    const tier = tierSummaries.get(segment.tierId);
    if (!account || !tier || totalWeightedStakeSeconds <= 0) continue;
    const weightedStakeSeconds = segment.stakeSeconds * tier.tier.rewardWeight;
    const rewardUsd = totalRewardUsd * (weightedStakeSeconds / totalWeightedStakeSeconds);
    const rewardHive = usdToHive(rewardUsd, season);
    account.rewardUsd += rewardUsd;
    account.rewardHive += rewardHive ?? 0;
    const accountTier = account.tiers.get(segment.tierId) ?? {
      tierId: segment.tierId,
      stakeSeconds: 0,
      weightedStakeSeconds: 0,
      rewardUsd: 0,
      rewardHive: null,
    };
    accountTier.rewardUsd += rewardUsd;
    accountTier.rewardHive = (accountTier.rewardHive ?? 0) + (rewardHive ?? 0);
    accountTier.weightedStakeSeconds += weightedStakeSeconds;
    account.tiers.set(segment.tierId, accountTier);
  }

  return {
    season,
    minimumActiveSeconds,
    totalRewardUsd,
    totalRewardHive: usdToHive(totalRewardUsd, season),
    segments,
    tiers: HIVE_STAKING_TIERS.map((tier) => {
      const summary = tierSummaries.get(tier.id);
      return {
        tier,
        eligibleStakeSeconds: summary?.eligibleStakeSeconds ?? 0,
        eligibleWeightedStakeSeconds: summary?.eligibleWeightedStakeSeconds ?? 0,
        eligibleAccountCount: summary?.eligibleAccountCount ?? 0,
      };
    }),
    accounts: Array.from(accounts.values())
      .map((account) => ({
        account: account.account,
        activeSeconds: account.activeSeconds,
        eligible: account.eligible,
        rewardUsd: roundUsd(account.rewardUsd),
        rewardHive: season.hivePriceUsd ? roundHive(account.rewardHive) : null,
        tiers: Array.from(account.tiers.values())
          .map((tier) => ({
            tierId: tier.tierId,
            stakeSeconds: tier.stakeSeconds,
            weightedStakeSeconds: roundHive(tier.weightedStakeSeconds),
            rewardUsd: roundUsd(tier.rewardUsd),
            rewardHive: tier.rewardHive == null || !season.hivePriceUsd ? null : roundHive(tier.rewardHive),
          }))
          .sort((a, b) => tierOrder(a.tierId) - tierOrder(b.tierId)),
      }))
      .sort((a, b) => b.rewardUsd - a.rewardUsd || a.account.localeCompare(b.account)),
  };
}

export function buildHiveStakingRewardSegments(params: {
  season: HiveStakingRewardSeason;
  events: HiveStakingRewardEvent[];
}): HiveStakingRewardSegment[] {
  const season = normalizeSeason(params.season);
  const states = new Map<string, AccountState>();
  const segments: HiveStakingRewardSegment[] = [];
  const events = params.events
    .map((event, index) => ({ event: normalizeEvent(event), index }))
    .sort((a, b) => a.event.timestamp - b.event.timestamp || (a.event.logIndex ?? a.index) - (b.event.logIndex ?? b.index));

  for (const { event } of events) {
    const state = getAccountState(states, event.account, season);
    flushAccountSegment({ account: event.account, state, season, timestamp: event.timestamp, segments });
    if (event.timestamp > season.endAt) continue;
    if (event.type === "stake") {
      state.activeHive += event.amountHive;
    } else {
      state.activeHive = Math.max(0, state.activeHive - event.amountHive);
    }
  }

  for (const [account, state] of states) {
    flushAccountSegment({ account, state, season, timestamp: season.endAt, segments });
  }

  return segments;
}

function buildAccountAccumulators(segments: HiveStakingRewardSegment[], minimumActiveSeconds: number) {
  const accounts = new Map<string, AccountAccumulator>();
  for (const segment of segments) {
    const account = accounts.get(segment.account) ?? {
      account: segment.account,
      activeSeconds: 0,
      eligible: false,
      rewardUsd: 0,
      rewardHive: 0,
      tiers: new Map<HiveStakingTierId, HiveStakingRewardAccountTierSummary>(),
    };
    account.activeSeconds += segment.durationSeconds;
    const accountTier = account.tiers.get(segment.tierId) ?? {
      tierId: segment.tierId,
      stakeSeconds: 0,
      weightedStakeSeconds: 0,
      rewardUsd: 0,
      rewardHive: null,
    };
    accountTier.stakeSeconds += segment.stakeSeconds;
    account.tiers.set(segment.tierId, accountTier);
    accounts.set(segment.account, account);
  }
  for (const account of accounts.values()) {
    account.eligible = account.activeSeconds >= minimumActiveSeconds;
  }
  return accounts;
}

function buildTierSummaries(season: HiveStakingRewardSeason, segments: HiveStakingRewardSegment[]) {
  const summaries = new Map<HiveStakingTierId, HiveStakingRewardTierSummary>();
  const accountsByTier = new Map<HiveStakingTierId, Set<string>>();
  for (const tier of HIVE_STAKING_TIERS) {
    summaries.set(tier.id, {
      tier,
      eligibleStakeSeconds: 0,
      eligibleWeightedStakeSeconds: 0,
      eligibleAccountCount: 0,
    });
    accountsByTier.set(tier.id, new Set());
  }
  for (const segment of segments) {
    const summary = summaries.get(segment.tierId);
    if (!summary) continue;
    summary.eligibleStakeSeconds += segment.stakeSeconds;
    summary.eligibleWeightedStakeSeconds += segment.stakeSeconds * summary.tier.rewardWeight;
    accountsByTier.get(segment.tierId)?.add(segment.account);
  }
  for (const [tierId, accounts] of accountsByTier) {
    const summary = summaries.get(tierId);
    if (summary) summary.eligibleAccountCount = accounts.size;
  }
  return summaries;
}

function flushAccountSegment(params: {
  account: string;
  state: AccountState;
  season: HiveStakingRewardSeason;
  timestamp: number;
  segments: HiveStakingRewardSegment[];
}) {
  const endAt = clamp(params.timestamp, params.season.startAt, params.season.endAt);
  const startAt = params.state.cursor;
  if (endAt <= startAt) return;
  const activeStakeHive = params.state.activeHive;
  const tier = tierForActiveHive(activeStakeHive);
  if (tier) {
    const durationSeconds = endAt - startAt;
    params.segments.push({
      account: params.account,
      tierId: tier.id,
      activeStakeHive,
      startAt,
      endAt,
      durationSeconds,
      stakeSeconds: activeStakeHive * durationSeconds,
    });
  }
  params.state.cursor = endAt;
}

function tierForActiveHive(activeStakeHive: number) {
  if (!Number.isFinite(activeStakeHive) || activeStakeHive <= 0) return null;
  return hiveTierForStakedHive(BigInt(Math.floor(activeStakeHive)));
}

function getAccountState(states: Map<string, AccountState>, account: string, season: HiveStakingRewardSeason) {
  const existing = states.get(account);
  if (existing) return existing;
  const next = { activeHive: 0, cursor: season.startAt };
  states.set(account, next);
  return next;
}

function normalizeSeason(season: HiveStakingRewardSeason): HiveStakingRewardSeason {
  const id = season.id.trim();
  const label = season.label.trim();
  const startAt = finiteTimestamp(season.startAt, "season.startAt");
  const endAt = finiteTimestamp(season.endAt, "season.endAt");
  const claimAt = season.claimAt == null ? undefined : finiteTimestamp(season.claimAt, "season.claimAt");
  const eligibleRevenueUsd = finiteNonNegative(season.eligibleRevenueUsd, "season.eligibleRevenueUsd");
  const hivePriceUsd = season.hivePriceUsd == null ? undefined : finitePositive(season.hivePriceUsd, "season.hivePriceUsd");
  const minimumActiveSeconds = season.minimumActiveSeconds == null
    ? undefined
    : finiteNonNegative(season.minimumActiveSeconds, "season.minimumActiveSeconds");
  if (!id) throw new Error("Reward season id is required.");
  if (!label) throw new Error("Reward season label is required.");
  if (endAt <= startAt) throw new Error("Reward season endAt must be after startAt.");
  return { id, label, startAt, endAt, eligibleRevenueUsd, hivePriceUsd, claimAt, minimumActiveSeconds };
}

function normalizeEvent(event: HiveStakingRewardEvent): HiveStakingRewardEvent {
  const account = event.account.trim().toLowerCase();
  if (!isHiveEvmAddress(account)) throw new Error(`Invalid reward event account: ${event.account}`);
  if (event.type !== "stake" && event.type !== "unstake-request") {
    throw new Error(`Unsupported reward event type: ${String(event.type)}`);
  }
  return {
    ...event,
    account,
    amountHive: finitePositive(event.amountHive, "event.amountHive"),
    timestamp: finiteTimestamp(event.timestamp, "event.timestamp"),
    logIndex: event.logIndex == null ? undefined : Math.trunc(finiteNonNegative(event.logIndex, "event.logIndex")),
  };
}

function usdToHive(valueUsd: number, season: HiveStakingRewardSeason) {
  return season.hivePriceUsd ? roundHive(valueUsd / season.hivePriceUsd) : null;
}

function tierOrder(tierId: HiveStakingTierId) {
  return HIVE_STAKING_TIERS.findIndex((tier) => tier.id === tierId);
}

function finiteTimestamp(value: number, label: string) {
  const parsed = finiteNonNegative(value, label);
  return Math.trunc(parsed);
}

function finitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

function finiteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
  return value;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundHive(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
