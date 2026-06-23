export type ProgressRewardPeriodKind = "daily" | "weekly";

export type ProgressRewardMetricSummary = {
  completedTasks: number;
  deliverables: number;
  honeyEarned: number;
  managedHoneyCredits: number;
  managedHoneySpent: number;
  trackedRevenueUsd: number;
  spendUsd: number;
  activeAgents: number;
  activeCompanies: number;
};

export type ProgressRewardContributor = {
  id: string;
  name: string;
  completedTasks: number;
  deliverables: number;
  honeyEarned: number;
  trackedRevenueUsd: number;
  spendUsd: number;
  score: number;
};

export type ProgressRewardCompanySummary = {
  id: string;
  name: string;
  ticker?: string;
  apexTitle?: string;
  completedTasks: number;
  totalTasks: number;
  progress: number;
  revenueLabel?: string;
  revenueValue?: string;
};

export type ProgressRewardStakingTierSummary = {
  id: string;
  label: string;
  thresholdHive: number;
  role: string;
};

export type ProgressRewardStakingSummary = {
  walletCount: number;
  checkedWalletCount: number;
  totalStakedHive: number;
  pendingUnstakeHive: number;
  currentTier: ProgressRewardStakingTierSummary | null;
  nextTier: ProgressRewardStakingTierSummary | null;
  toNextTierHive: number;
  progressToNextTier: number;
  paused: boolean;
  cooldownSeconds?: number;
};

export type ProgressRewardPeriodSummary = {
  id: string;
  kind: ProgressRewardPeriodKind;
  title: string;
  subtitle: string;
  startAt: string;
  endAt: string;
  metrics: ProgressRewardMetricSummary;
  topContributors: ProgressRewardContributor[];
  topCompanies: ProgressRewardCompanySummary[];
  highlights: string[];
  hasActivity: boolean;
};

export type ProgressRewardsSnapshot = {
  generatedAt: string;
  timezoneOffsetMinutes: number;
  daily: ProgressRewardPeriodSummary;
  weekly: ProgressRewardPeriodSummary;
  staking: ProgressRewardStakingSummary;
};
