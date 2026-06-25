"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Coins, Hexagon, ListChecks, Sparkles, Trophy, WalletCards, X } from "lucide-react";

import { loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import type {
  ProgressRewardContributor,
  ProgressRewardPeriodSummary,
  ProgressRewardStakingSummary,
  ProgressRewardsSnapshot,
} from "@/lib/types/progress-rewards";
import styles from "./ProgressRewardPopup.module.css";

const DAILY_REWARD_STATE_KEY = "hivemindos.progressRewards.dailyShown.v1";
const WEEKLY_REWARD_STATE_KEY = "hivemindos.progressRewards.weeklyShown.v1";

type ProgressRewardPopupProps = {
  enabled?: boolean;
};

type RewardQueueItem = {
  period: ProgressRewardPeriodSummary;
  staking: ProgressRewardStakingSummary;
  stateKey: string;
};

export function ProgressRewardPopup({
  enabled = true,
}: ProgressRewardPopupProps) {
  const [queue, setQueue] = useState<RewardQueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function loadRewards() {
      setLoading(true);
      const [state, snapshot] = await Promise.all([
        loadDashboardStateSnapshot().catch(() => null),
        fetchProgressRewards().catch(() => null),
      ]);
      if (cancelled) return;
      if (!snapshot) {
        setLoading(false);
        return;
      }

      const next: RewardQueueItem[] = [];
      if (state?.[DAILY_REWARD_STATE_KEY] !== snapshot.daily.id) {
        next.push({ period: snapshot.daily, staking: snapshot.staking, stateKey: DAILY_REWARD_STATE_KEY });
      }
      if (snapshot.weekly.hasActivity && state?.[WEEKLY_REWARD_STATE_KEY] !== snapshot.weekly.id) {
        next.push({ period: snapshot.weekly, staking: snapshot.staking, stateKey: WEEKLY_REWARD_STATE_KEY });
      }
      setQueue(next);
      setLoading(false);
    }

    const timer = window.setTimeout(() => void loadRewards(), 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const current = queue[0]?.period;
  const staking = queue[0]?.staking;
  const currentStateKey = queue[0]?.stateKey;
  const copy = useMemo(() => current ? rewardCopy(current) : null, [current]);

  const dismiss = useCallback(() => {
    if (!current || !currentStateKey) return;
    void saveDashboardStateValue(currentStateKey, current.id);
    setQueue((items) => items.slice(1));
  }, [current, currentStateKey]);

  if (!current || !copy) return null;

  const primaryMetric = current.metrics.completedTasks > 0
    ? `${current.metrics.completedTasks}`
    : current.metrics.honeyEarned > 0
      ? formatHoney(current.metrics.honeyEarned)
      : "Ready";
  const primaryLabel = current.metrics.completedTasks > 0
    ? `work ${current.metrics.completedTasks === 1 ? "item" : "items"} shipped`
    : current.metrics.honeyEarned > 0
      ? "HONEY earned"
      : "for the next run";

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.popup}
        role="dialog"
        aria-modal="false"
        aria-labelledby="progress-reward-title"
        aria-describedby="progress-reward-body"
      >
        <button className={styles.closeButton} type="button" aria-label="Close progress reward" onClick={dismiss}>
          <X size={16} aria-hidden="true" />
        </button>

        <div className={styles.hero}>
          <div className={styles.heroIcon} aria-hidden="true">
            {current.kind === "weekly" ? <Trophy size={24} /> : <Sparkles size={24} />}
          </div>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{current.title} · {current.subtitle}</p>
            <h2 id="progress-reward-title">{copy.title}</h2>
            <p id="progress-reward-body">{copy.body}</p>
          </div>
        </div>

        <div className={styles.scoreRow}>
          <div className={styles.scoreDial}>
            <span>{primaryMetric}</span>
            <small>{primaryLabel}</small>
          </div>
          <div className={styles.metricGrid}>
            <Metric icon={<ListChecks size={15} />} label="Tasks" value={String(current.metrics.completedTasks)} />
            <Metric icon={<Coins size={15} />} label="HONEY" value={formatHoney(current.metrics.honeyEarned)} />
            <Metric icon={<WalletCards size={15} />} label="Revenue" value={formatMoney(current.metrics.trackedRevenueUsd)} />
            <Metric icon={<CheckCircle2 size={15} />} label="Artifacts" value={String(current.metrics.deliverables)} />
          </div>
        </div>

        {staking ? <StakingStatus staking={staking} /> : null}

        {current.highlights.length ? (
          <div className={styles.highlights} aria-label="Progress highlights">
            {current.highlights.map((highlight) => <span key={highlight}>{highlight}</span>)}
          </div>
        ) : null}

        {current.kind === "weekly" && current.topContributors.length ? (
          <Leaderboard contributors={current.topContributors} />
        ) : null}

        <div className={styles.actions}>
          <button className={styles.secondaryAction} type="button" onClick={dismiss}>
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{loading ? "Done" : "Let's get buzzing."}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function StakingStatus({ staking }: { staking: ProgressRewardStakingSummary }) {
  const unavailable = staking.walletCount > 0 && staking.checkedWalletCount === 0;
  const tierLabel = unavailable ? "Tier unavailable" : staking.currentTier?.label ?? "No tier yet";
  const progressPercent = Math.round(Math.max(0, Math.min(1, staking.progressToNextTier)) * 100);
  const nextLabel = unavailable
    ? "Staking contract read did not complete"
    : staking.nextTier
      ? `${formatHive(staking.toNextTierHive)} to ${staking.nextTier.label}`
      : "Highest tier reached";
  const walletLabel = staking.walletCount
    ? `${staking.checkedWalletCount}/${staking.walletCount} Base ${staking.walletCount === 1 ? "wallet" : "wallets"} checked`
    : "No Base HIVE wallet connected";

  return (
    <div className={styles.stakingPanel} aria-label="HIVE staking tier">
      <div className={styles.stakingHeader}>
        <span className={styles.stakingBadge}>
          <Hexagon size={14} aria-hidden="true" />
          <span>HIVE stake</span>
        </span>
        <strong>{tierLabel}</strong>
      </div>
      <div className={styles.stakingBody}>
        <div>
          <span className={styles.stakingAmount}>{formatHive(staking.totalStakedHive)}</span>
          <span className={styles.stakingLabel}>active staked</span>
        </div>
        <div>
          <span className={styles.stakingAmount}>{formatHive(staking.pendingUnstakeHive)}</span>
          <span className={styles.stakingLabel}>unstaking</span>
        </div>
      </div>
      <div className={styles.stakingBar} aria-hidden="true">
        <span style={{ width: `${unavailable ? 0 : progressPercent}%` }} />
      </div>
      <div className={styles.stakingFooter}>
        <span>{nextLabel}</span>
        <span>{walletLabel}</span>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricIcon} aria-hidden="true">{icon}</span>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}

function Leaderboard({ contributors }: { contributors: ProgressRewardContributor[] }) {
  const maxScore = Math.max(1, ...contributors.map((item) => item.score));
  return (
    <div className={styles.leaderboard} aria-label="Weekly leaderboard">
      <div className={styles.leaderboardTitle}>
        <Trophy size={15} aria-hidden="true" />
        <span>Weekly leaderboard</span>
      </div>
      <div className={styles.leaderboardRows}>
        {contributors.map((item, index) => (
          <div className={styles.leaderboardRow} key={item.id}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.contributorName}>{item.name}</span>
            <span className={styles.contributorStats}>{item.completedTasks} tasks · {formatHoney(item.honeyEarned)} HONEY</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span style={{ width: `${Math.max(8, Math.round((item.score / maxScore) * 100))}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

async function fetchProgressRewards(): Promise<ProgressRewardsSnapshot | null> {
  const params = new URLSearchParams({
    timezoneOffsetMinutes: String(new Date().getTimezoneOffset()),
  });
  const response = await fetch(`/api/progress-rewards?${params}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as { ok?: boolean; snapshot?: ProgressRewardsSnapshot } | null;
  return data?.ok && data.snapshot ? data.snapshot : null;
}

function rewardCopy(period: ProgressRewardPeriodSummary) {
  const { metrics } = period;
  const activityParts = rewardActivityParts(metrics);
  if (period.kind === "weekly") {
    return {
      title: "Your hive is compounding.",
      body: activityParts.length
        ? `${joinHuman(activityParts)}.`
        : "No weekly wins recorded yet, but the board is ready for the next push.",
    };
  }
  if (!period.hasActivity) {
    return {
      title: "Welcome back.",
      body: "Yesterday was quiet in the ledgers. Fresh board, fresh run, plenty of room to make today count.",
    };
  }
  return {
    title: "Well done.",
    body: `${joinHuman(activityParts)}.`,
  };
}

function rewardActivityParts(metrics: ProgressRewardPeriodSummary["metrics"]) {
  return [
    metrics.completedTasks ? `${metrics.completedTasks} work ${metrics.completedTasks === 1 ? "item" : "items"} completed` : "",
    metrics.honeyEarned ? `${formatHoney(metrics.honeyEarned)} HONEY earned` : "",
    metrics.trackedRevenueUsd ? `${formatMoney(metrics.trackedRevenueUsd)} tracked revenue` : "",
    metrics.managedHoneyCredits ? `${formatHoney(metrics.managedHoneyCredits)} managed HONEY credited` : "",
    metrics.managedHoneySpent ? `${formatHoney(metrics.managedHoneySpent)} managed HONEY used` : "",
  ].filter(Boolean);
}

function joinHuman(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function formatHoney(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatHive(value: number) {
  if (!value) return "0 HIVE";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 })} HIVE`;
}

function formatMoney(value: number) {
  if (!value) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 0,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}
