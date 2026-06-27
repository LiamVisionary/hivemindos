import type { Company } from "@/lib/types/company";
import { HIVE_STAKING_TIERS, type HiveStakingTier } from "@/lib/config/hive-staking";
import type {
  ProgressRewardCompanySummary,
  ProgressRewardContributor,
  ProgressRewardPeriodKind,
  ProgressRewardPeriodSummary,
  ProgressRewardStakingSummary,
  ProgressRewardStakingTierSummary,
  ProgressRewardsSnapshot,
} from "@/lib/types/progress-rewards";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LEADERBOARD_ITEMS = 5;

export type ProgressRewardTask = {
  id: string;
  title: string;
  status?: string;
  assignee?: string | null;
  completedAt?: number;
  updatedAt?: number;
  deliverables?: unknown[];
};

export type ProgressRewardHoneyEvent = {
  id: string;
  agentId: string;
  agentName?: string;
  kind: string;
  source?: string;
  tokensUsed?: number;
  honeyDelta?: number;
  hiveDelta?: number;
  createdAt: string;
};

export type ProgressRewardSpendRecord = {
  id: string;
  agentId: string;
  companyId?: string;
  kind: string;
  amountUsd: number;
  status: string;
  createdAtMs: number;
};

export type ProgressRewardInput = {
  now?: number;
  timezoneOffsetMinutes?: number;
  tasks: ProgressRewardTask[];
  honeyEvents: ProgressRewardHoneyEvent[];
  spendRecords: ProgressRewardSpendRecord[];
  companies: Company[];
  staking?: ProgressRewardStakingSummary;
};

export type ProgressRewardStakingInput = {
  walletCount?: number;
  checkedWalletCount?: number;
  totalStakedHive?: number;
  pendingUnstakeHive?: number;
  paused?: boolean;
  cooldownSeconds?: number;
};

type PeriodWindow = {
  id: string;
  kind: ProgressRewardPeriodKind;
  title: string;
  subtitle: string;
  startMs: number;
  endMs: number;
};

type ContributorDraft = ProgressRewardContributor;

export function buildProgressRewardsSnapshot(input: ProgressRewardInput): ProgressRewardsSnapshot {
  const now = input.now ?? Date.now();
  const timezoneOffsetMinutes = clampTimezoneOffset(input.timezoneOffsetMinutes ?? 0);
  const periods = rewardPeriods(now, timezoneOffsetMinutes);
  return {
    generatedAt: new Date(now).toISOString(),
    timezoneOffsetMinutes,
    daily: aggregatePeriod(periods.daily, input),
    weekly: aggregatePeriod(periods.weekly, input),
    staking: input.staking ?? buildProgressRewardStakingSummary(),
  };
}

export function buildProgressRewardStakingSummary(
  input: ProgressRewardStakingInput = {},
): ProgressRewardStakingSummary {
  const totalStakedHive = roundUnits(Math.max(0, Number(input.totalStakedHive) || 0));
  const pendingUnstakeHive = roundUnits(Math.max(0, Number(input.pendingUnstakeHive) || 0));
  const walletCount = Math.max(0, Math.floor(Number(input.walletCount) || 0));
  const checkedWalletCount = Math.min(walletCount, Math.max(0, Math.floor(Number(input.checkedWalletCount) || 0)));
  const currentTier = stakingTierForHive(totalStakedHive);
  const nextTier = HIVE_STAKING_TIERS.find((tier) => Number(tier.thresholdHive) > totalStakedHive) ?? null;
  const previousThreshold = currentTier ? Number(currentTier.thresholdHive) : 0;
  const nextThreshold = nextTier ? Number(nextTier.thresholdHive) : previousThreshold || 1;
  const span = Math.max(1, nextThreshold - previousThreshold);
  const progressToNextTier = nextTier
    ? clampRatio((totalStakedHive - previousThreshold) / span)
    : 1;

  return {
    walletCount,
    checkedWalletCount,
    totalStakedHive,
    pendingUnstakeHive,
    currentTier: currentTier ? stakingTierSummary(currentTier) : null,
    nextTier: nextTier ? stakingTierSummary(nextTier) : null,
    toNextTierHive: nextTier ? roundUnits(Math.max(0, Number(nextTier.thresholdHive) - totalStakedHive)) : 0,
    progressToNextTier,
    paused: Boolean(input.paused),
    cooldownSeconds: Number.isFinite(input.cooldownSeconds) ? Math.max(0, Math.floor(Number(input.cooldownSeconds))) : undefined,
  };
}

export function rewardPeriods(now: number, timezoneOffsetMinutes: number): {
  daily: PeriodWindow;
  weekly: PeriodWindow;
} {
  const offset = clampTimezoneOffset(timezoneOffsetMinutes);
  const today = localDateParts(now, offset);
  const todayStart = localDateStartUtcMs(today, offset);
  const yesterdayStart = todayStart - DAY_MS;
  const yesterdayKey = localDateKey(yesterdayStart, offset);
  const weekStart = todayStart - localMondayIndex(today.weekday) * DAY_MS;
  const weekKey = localDateKey(weekStart, offset);

  return {
    daily: {
      id: `daily:${yesterdayKey}`,
      kind: "daily",
      title: "Yesterday's progress",
      subtitle: formatLocalDate(yesterdayStart, offset),
      startMs: yesterdayStart,
      endMs: todayStart,
    },
    weekly: {
      id: `weekly:${weekKey}`,
      kind: "weekly",
      title: "Week so far",
      subtitle: `${formatLocalDate(weekStart, offset)} to ${formatLocalDate(now, offset)}`,
      startMs: weekStart,
      endMs: now,
    },
  };
}

function aggregatePeriod(period: PeriodWindow, input: ProgressRewardInput): ProgressRewardPeriodSummary {
  const completedTasks = input.tasks.filter((task) => (
    task.status === "done" &&
    inRange(task.completedAt ?? task.updatedAt, period.startMs, period.endMs)
  ));
  const honeyEvents = input.honeyEvents.filter((event) => inRange(Date.parse(event.createdAt), period.startMs, period.endMs));
  const spendRecords = input.spendRecords.filter((record) => (
    record.status === "executed" &&
    inRange(record.createdAtMs, period.startMs, period.endMs)
  ));

  const contributorMap = new Map<string, ContributorDraft>();
  const activeAgents = new Set<string>();

  for (const task of completedTasks) {
    const id = cleanId(task.assignee) || "unassigned";
    activeAgents.add(id);
    const contributor = contributorFor(contributorMap, id, labelFromId(id));
    contributor.completedTasks += 1;
    contributor.deliverables += Array.isArray(task.deliverables) ? task.deliverables.length : 0;
  }

  let honeyEarned = 0;
  let managedHoneyCredits = 0;
  let managedHoneySpent = 0;
  for (const event of honeyEvents) {
    const honeyDelta = roundUnits(event.honeyDelta);
    const id = cleanId(event.agentId) || "honey-ledger";
    activeAgents.add(id);
    const contributor = contributorFor(contributorMap, id, event.agentName || labelFromId(id));
    if (event.kind === "usage" && honeyDelta > 0) {
      honeyEarned += honeyDelta;
      contributor.honeyEarned += honeyDelta;
    } else if (event.kind === "managed-credit" && honeyDelta > 0) {
      managedHoneyCredits += honeyDelta;
    } else if (event.kind === "managed-spend" && honeyDelta < 0) {
      managedHoneySpent += Math.abs(honeyDelta);
    }
  }

  let trackedRevenueUsd = 0;
  let spendUsd = 0;
  for (const record of spendRecords) {
    const amountUsd = roundMoney(record.amountUsd);
    const id = cleanId(record.agentId) || "wallet";
    activeAgents.add(id);
    const contributor = contributorFor(contributorMap, id, labelFromId(id));
    if (record.kind === "platform-fee") {
      trackedRevenueUsd += amountUsd;
      contributor.trackedRevenueUsd += amountUsd;
    } else {
      spendUsd += amountUsd;
      contributor.spendUsd += amountUsd;
    }
  }

  const topCompanies = companySummaries(input.companies, input.tasks, period);
  const activeCompanies = topCompanies.filter((company) => company.completedTasks > 0).length;
  const deliverables = completedTasks.reduce((total, task) => total + (Array.isArray(task.deliverables) ? task.deliverables.length : 0), 0);
  const metrics = {
    completedTasks: completedTasks.length,
    deliverables,
    honeyEarned: roundUnits(honeyEarned),
    managedHoneyCredits: roundUnits(managedHoneyCredits),
    managedHoneySpent: roundUnits(managedHoneySpent),
    trackedRevenueUsd: roundMoney(trackedRevenueUsd),
    spendUsd: roundMoney(spendUsd),
    activeAgents: activeAgents.size,
    activeCompanies,
  };

  const topContributors = [...contributorMap.values()]
    .map((item) => ({ ...item, score: contributorScore(item) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, MAX_LEADERBOARD_ITEMS);

  return {
    id: period.id,
    kind: period.kind,
    title: period.title,
    subtitle: period.subtitle,
    startAt: new Date(period.startMs).toISOString(),
    endAt: new Date(period.endMs).toISOString(),
    metrics,
    topContributors,
    topCompanies: topCompanies.slice(0, MAX_LEADERBOARD_ITEMS),
    highlights: buildHighlights(metrics, topContributors, topCompanies),
    hasActivity: Boolean(
      metrics.completedTasks ||
        metrics.honeyEarned ||
        metrics.trackedRevenueUsd ||
        metrics.managedHoneyCredits ||
        metrics.managedHoneySpent,
    ),
  };
}

function companySummaries(
  companies: Company[],
  tasks: ProgressRewardTask[],
  period: PeriodWindow,
): ProgressRewardCompanySummary[] {
  return companies
    .map((company) => {
      const memberIds = new Set((company.agentIds ?? []).filter(Boolean));
      const companyTasks = tasks.filter((task) => task.assignee && memberIds.has(task.assignee));
      const activeTasks = companyTasks.filter((task) => task.status !== "archived");
      const doneTasks = activeTasks.filter((task) => task.status === "done");
      const periodDone = doneTasks.filter((task) => inRange(task.completedAt ?? task.updatedAt, period.startMs, period.endMs));
      const derivedProgress = activeTasks.length ? Math.round((doneTasks.length / activeTasks.length) * 100) : 0;
      const progress = clampPercent(company.apexGoal?.progress ?? derivedProgress);
      return {
        id: company.id,
        name: company.name || company.id,
        ticker: company.ticker,
        apexTitle: company.apexGoal?.title,
        completedTasks: periodDone.length,
        totalTasks: activeTasks.length,
        progress,
        revenueLabel: company.revenue?.label,
        revenueValue: company.revenue?.value,
      };
    })
    .filter((company) => company.completedTasks > 0 || company.apexTitle || company.revenueValue)
    .sort((left, right) => (
      right.completedTasks - left.completedTasks ||
      right.progress - left.progress ||
      left.name.localeCompare(right.name)
    ));
}

function buildHighlights(
  metrics: ProgressRewardPeriodSummary["metrics"],
  topContributors: ProgressRewardContributor[],
  topCompanies: ProgressRewardCompanySummary[],
): string[] {
  const highlights: string[] = [];
  if (metrics.completedTasks > 0) {
    highlights.push(`${metrics.completedTasks} work ${metrics.completedTasks === 1 ? "item" : "items"} completed`);
  }
  if (metrics.honeyEarned > 0) highlights.push(`${formatNumber(metrics.honeyEarned)} HONEY earned`);
  if (metrics.trackedRevenueUsd > 0) highlights.push(`${formatMoney(metrics.trackedRevenueUsd)} tracked revenue`);
  if (metrics.deliverables > 0) highlights.push(`${metrics.deliverables} deliverable${metrics.deliverables === 1 ? "" : "s"} produced`);
  const top = topContributors[0];
  if (top) highlights.push(`${top.name} led the board`);
  const company = topCompanies.find((item) => item.completedTasks > 0);
  if (company?.apexTitle) highlights.push(`${company.name} moved toward ${company.apexTitle}`);
  return highlights.slice(0, 4);
}

function contributorFor(map: Map<string, ContributorDraft>, id: string, name: string): ContributorDraft {
  const existing = map.get(id);
  if (existing) {
    if ((!existing.name || existing.name === labelFromId(existing.id)) && name) existing.name = name;
    return existing;
  }
  const next: ContributorDraft = {
    id,
    name,
    completedTasks: 0,
    deliverables: 0,
    honeyEarned: 0,
    trackedRevenueUsd: 0,
    spendUsd: 0,
    score: 0,
  };
  map.set(id, next);
  return next;
}

function contributorScore(item: ContributorDraft): number {
  return (
    item.completedTasks * 100 +
    item.deliverables * 35 +
    item.honeyEarned * 12 +
    item.trackedRevenueUsd * 20 +
    Math.min(item.spendUsd, 100) * 0.5
  );
}

function localDateParts(ms: number, timezoneOffsetMinutes: number) {
  const date = new Date(ms - timezoneOffsetMinutes * 60_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function localDateStartUtcMs(parts: ReturnType<typeof localDateParts>, timezoneOffsetMinutes: number) {
  return Date.UTC(parts.year, parts.month, parts.date) + timezoneOffsetMinutes * 60_000;
}

function localDateKey(ms: number, timezoneOffsetMinutes: number) {
  const date = new Date(ms - timezoneOffsetMinutes * 60_000);
  return date.toISOString().slice(0, 10);
}

function formatLocalDate(ms: number, timezoneOffsetMinutes: number) {
  const parts = localDateParts(ms, timezoneOffsetMinutes);
  const month = new Date(Date.UTC(parts.year, parts.month, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} ${parts.date}, ${parts.year}`;
}

function localMondayIndex(weekday: number) {
  return (weekday + 6) % 7;
}

function inRange(value: number | undefined, startMs: number, endMs: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= startMs && value < endMs;
}

function cleanId(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function labelFromId(id: string) {
  if (id === "unassigned") return "Unassigned";
  return id
    .split(/[-_:.\s]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

function clampTimezoneOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-14 * 60, Math.min(14 * 60, Math.round(value)));
}

function clampPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundUnits(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1_000_000) / 1_000_000;
}

function roundMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 });
}

function stakingTierForHive(stakedHive: number): HiveStakingTier | null {
  let match: HiveStakingTier | null = null;
  for (const tier of HIVE_STAKING_TIERS) {
    if (stakedHive >= Number(tier.thresholdHive)) match = tier;
  }
  return match;
}

function stakingTierSummary(tier: HiveStakingTier): ProgressRewardStakingTierSummary {
  return {
    id: tier.id,
    label: tier.label,
    thresholdHive: Number(tier.thresholdHive),
    role: tier.role,
  };
}
