"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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

export function ProgressRewardPopup({ enabled = true }: ProgressRewardPopupProps) {
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
  const copy = useMemo(() => (current ? rewardCopy(current) : null), [current]);

  const dismiss = useCallback(() => {
    if (!current || !currentStateKey) return;
    void saveDashboardStateValue(currentStateKey, current.id);
    setQueue((items) => items.slice(1));
  }, [current, currentStateKey]);

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  if (!current || !copy) return null;

  const isWeekly = current.kind === "weekly";
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
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        className={styles.popup}
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-reward-title"
        aria-describedby="progress-reward-body"
      >
        <button className={styles.closeButton} type="button" aria-label="Close progress reward" onClick={dismiss}>
          <CloseIcon />
        </button>

        <div className={styles.hero}>
          <div className={styles.heroIcon} aria-hidden="true">
            {isWeekly ? <TrophyIcon size={26} /> : <SunriseIcon size={26} />}
          </div>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{current.title} · {current.subtitle}</p>
            <h2 id="progress-reward-title">{copy.title}</h2>
            <p id="progress-reward-body">{copy.body}</p>
          </div>
        </div>

        <div className={styles.scoreRow}>
          <div className={styles.scoreDial}>
            <span className={styles.scoreMark} aria-hidden="true"><HiveHex size={30} strokeWidth={1.3} dot /></span>
            <span className={styles.scoreValue}>{primaryMetric}</span>
            <small>{primaryLabel}</small>
          </div>
          <div className={styles.metricGrid}>
            <Metric icon={<TasksIcon />} label="Tasks" value={String(current.metrics.completedTasks)} tone="live" />
            <Metric icon={<HoneyIcon />} label="HONEY" value={formatHoney(current.metrics.honeyEarned)} tone="honey" />
            <Metric icon={<WalletIcon />} label="Revenue" value={formatMoney(current.metrics.trackedRevenueUsd)} />
            <Metric icon={<ArtifactIcon />} label="Artifacts" value={String(current.metrics.deliverables)} />
          </div>
        </div>

        {staking ? <StakingStatus staking={staking} /> : null}

        {current.highlights.length ? (
          <div className={styles.highlights} aria-label="Progress highlights">
            {current.highlights.map((highlight) => <span key={highlight}>{highlight}</span>)}
          </div>
        ) : null}

        {isWeekly && current.topContributors.length ? (
          <Leaderboard contributors={current.topContributors} />
        ) : null}

        <div className={styles.actions}>
          <button className={styles.secondaryAction} type="button" onClick={dismiss}>
            Maybe later
          </button>
          <button className={styles.primaryAction} type="button" onClick={dismiss}>
            <CheckIcon />
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
  const showUnstaking = staking.pendingUnstakeHive > 0;
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
          <span className={styles.stakingMark} aria-hidden="true"><HiveHex size={22} strokeWidth={0} fill />
          </span>
          <span>HIVE stake</span>
        </span>
        <strong>{tierLabel}</strong>
      </div>
      <div className={styles.stakingBody} data-single={showUnstaking ? undefined : "true"}>
        <div>
          <span className={styles.stakingAmount}>{formatHive(staking.totalStakedHive)}</span>
          <span className={styles.stakingLabel}>active staked</span>
        </div>
        {showUnstaking ? (
          <div>
            <span className={styles.stakingAmount}>{formatHive(staking.pendingUnstakeHive)}</span>
            <span className={styles.stakingLabel}>unstaking</span>
          </div>
        ) : null}
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

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: "honey" | "live" }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricIcon} data-tone={tone} aria-hidden="true">{icon}</span>
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
        <TrophyIcon size={14} />
        <span>Weekly leaderboard</span>
      </div>
      <div className={styles.leaderboardRows}>
        {contributors.map((item, index) => (
          <div className={styles.leaderboardRow} data-lead={index === 0 ? "true" : undefined} key={item.id}>
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

// Inline icons.
type IconProps = { size?: number };
const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SunriseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3v3M5.6 8.6 7 10M3 14.5h2M19 14.5h2M17 10l1.4-1.4M2 19.5h20M8.5 14.5a3.5 3.5 0 0 1 7 0" />
    </svg>
  );
}

function TrophyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5v1.5A3 3 0 0 0 7 9.4M17 5h2.5v1.5A3 3 0 0 1 17 9.4M9.5 13.5h5M12 13v2.5M8.5 20h7M9.5 20l.5-4.5h4l.5 4.5" />
    </svg>
  );
}

function TasksIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 6.5l1.6 1.6L8.5 5M4 17.5l1.6 1.6L8.5 16M12 7h8M12 17h8" />
    </svg>
  );
}

function HoneyIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3.2l7.5 4.4v8.8L12 20.8 4.5 16.4V7.6z" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WalletIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="6" width="18" height="13" rx="2.2" />
      <path d="M3 9.5h18" />
      <circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArtifactIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M9.5 14l1.6 1.6L14.5 12" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.1}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={1.9}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// The hive mark is the brand hexagon. Outline by default, optional inner dot,
// or a filled token chip when `fill` is set (used in the staking header).
function HiveHex({ size = 24, strokeWidth = 1.4, dot = false, fill = false }: { size?: number; strokeWidth?: number; dot?: boolean; fill?: boolean }) {
  const pts = "12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7";
  if (fill) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
        <polygon points={pts} fill="currentColor" />
        <circle cx="12" cy="12" r="3" fill="#1a1305" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <polygon points={pts} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      {dot ? <circle cx="12" cy="12" r="2.1" fill="currentColor" /> : null}
    </svg>
  );
}
