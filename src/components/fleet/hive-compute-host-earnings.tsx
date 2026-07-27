"use client";

import * as React from "react";
import { CreditCard, Gauge, Pause, TrendingUp, Wallet } from "lucide-react";

import type {
  HiveComputeHostModel,
  HiveComputeMarketplaceStatus,
  HiveComputeModelBenchmark,
  HiveComputeModelPrice,
} from "@/lib/types/hive-compute-marketplace";
import { estimateHiveComputeModelGrossHourlyUsd } from "@/lib/services/hive-compute-pricing";
import styles from "./hive-compute-host-modal.module.css";

export function money(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return "$" + (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(2));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function moneyMicroUsd(usdMicro: number): string {
  const dollars = usdMicro / 1_000_000;
  if (dollars <= 0) return "$0";
  return "$" + (dollars < 0.01 ? dollars.toFixed(4) : dollars < 10 ? dollars.toFixed(2) : Math.round(dollars).toLocaleString());
}

export type HiveComputePricedModel = {
  model: HiveComputeHostModel;
  price: HiveComputeModelPrice;
  benchmark?: HiveComputeModelBenchmark;
};

/**
 * Earnings step of the shared Hive Compute host console: actual earnings from
 * the worker's local summary first, then live gateway stats and pricing-based
 * projections. Extracted from the console to keep it under the file-size cap.
 */
export function HiveComputeHostEarningsView({
  status,
  running,
  nowTick,
  pricingReady,
  pricedAdvertisedModels,
  concurrency,
  earn,
  enabledCount,
  busy,
  stopBusy,
  onAdjustSettings,
  onStopHosting,
  workerOutput,
}: {
  status: HiveComputeMarketplaceStatus;
  running: boolean;
  nowTick: number;
  pricingReady: boolean;
  pricedAdvertisedModels: HiveComputePricedModel[];
  concurrency: number;
  earn: { monthMid: number; dayStr: string; monthStr: string; activeHourStr: string };
  enabledCount: number;
  busy: boolean;
  stopBusy: boolean;
  onAdjustSettings: () => void;
  onStopHosting: () => void;
  workerOutput: React.ReactNode;
}) {
  const capacity = status.gateway.capacity;
  const perf = capacity?.modelPerformance ?? [];
  const measured = perf.filter((p) => p.samples > 0);
  const avgTps = measured.length
    ? measured.reduce((acc, p) => acc + p.tokensPerSecond, 0) / measured.length
    : null;
  const avgTtft = measured.length
    ? measured.reduce((acc, p) => acc + p.timeToFirstTokenMs, 0) / measured.length
    : null;
  const liveWorkers = capacity?.liveWorkers ?? 0;
  const pendingJobs = capacity?.pendingJobs ?? 0;
  const availableSlots = capacity?.availableSlots;
  const startedAt = status.host.run?.startedAt;
  const uptime = running && startedAt ? formatDuration(nowTick - startedAt) : "—";
  const earnings = status.host.earnings;
  const hasActualEarnings = Boolean(earnings && (earnings.totalJobs > 0 || earnings.totalUsdMicro > 0));

  // Projected earnings only exist once every advertised model has measured throughput.
  const projectionModels = pricingReady
    ? pricedAdvertisedModels
      .map((entry) => ({ entry, weight: estimateHiveComputeModelGrossHourlyUsd(entry) ?? 0 }))
      .sort((left, right) => right.weight - left.weight)
      .slice(0, concurrency)
    : [];
  const weights = projectionModels.map(({ weight }) => weight);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const perModel = projectionModels
    .map(({ entry }, i) => ({
      name: entry.model.name || entry.model.id,
      month: sumW > 0 ? (weights[i] / sumW) * earn.monthMid : 0,
    }))
    .sort((a, b) => a.month - b.month);
  const barMax = perModel.reduce((max, m) => Math.max(max, m.month), 0);
  const topModels = [...perModel].sort((a, b) => b.month - a.month).slice(0, 4);
  const topMax = topModels.reduce((max, m) => Math.max(max, m.month), 0);
  const earnedModels = (earnings?.byModel ?? []).slice(0, 4);
  const earnedMax = earnedModels.reduce((max, m) => Math.max(max, m.usdMicro), 0);

  const statCards = [
    { kicker: "Session", value: uptime, sub: running ? "hosting now" : "idle", honey: false },
    {
      kicker: "Earned today",
      value: earnings ? moneyMicroUsd(earnings.todayUsdMicro) : "$0",
      sub: earnings ? `${earnings.todayJobs} job${earnings.todayJobs === 1 ? "" : "s"} today` : "no jobs yet",
      honey: hasActualEarnings,
    },
    {
      kicker: "Earned all-time",
      value: earnings ? moneyMicroUsd(earnings.totalUsdMicro) : "$0",
      sub: earnings ? `${earnings.totalJobs} job${earnings.totalJobs === 1 ? "" : "s"} served` : "no jobs yet",
      honey: false,
    },
    {
      kicker: "Projected net / mo",
      value: pricingReady ? earn.monthStr : "Not estimated",
      sub: pricingReady ? `≈ ${earn.dayStr} / day` : "Benchmark models first",
      honey: !hasActualEarnings,
    },
  ];

  const perfStats = [
    { label: "Live workers", value: String(liveWorkers) },
    { label: "Pending jobs", value: String(pendingJobs) },
    ...(availableSlots != null ? [{ label: "Slots free", value: String(availableSlots) }] : []),
    { label: "Avg speed", value: avgTps != null ? `${avgTps.toFixed(0)} tok/s` : "—" },
    { label: "Avg first token", value: avgTtft != null ? `${avgTtft.toFixed(0)} ms` : "—" },
  ];

  return (
    <>
      <div className={styles.statGrid}>
        {statCards.map((card) => (
          <div key={card.kicker} className={`${styles.statCard} ${card.honey ? styles.statCardHoney : ""}`}>
            <span className={styles.statKicker}>{card.kicker}</span>
            <b className={styles.statVal}>{card.value}</b>
            <span className={styles.statSub}>{card.sub}</span>
          </div>
        ))}
      </div>

      {hasActualEarnings && earnings ? (
        <section className={styles.card}>
          <span className={styles.cardKicker}>
            <Wallet size={13} aria-hidden="true" /> Actual earnings · from the gateway
          </span>
          <div className={styles.perfRows}>
            <div className={styles.perfRow}>
              <span className={styles.perfLabel}>Last 7 days</span>
              <b className={styles.perfVal}>{moneyMicroUsd(earnings.last7dUsdMicro)}</b>
            </div>
            <div className={styles.perfRow}>
              <span className={styles.perfLabel}>Last 30 days</span>
              <b className={styles.perfVal}>{moneyMicroUsd(earnings.last30dUsdMicro)}</b>
            </div>
          </div>
          {earnedModels.length ? (
            <div className={styles.topList}>
              {earnedModels.map((entry) => (
                <div key={entry.model} className={styles.topItem}>
                  <div className={styles.topRow}>
                    <span className={styles.topName}>{entry.model}</span>
                    <b className={styles.topAmount}>
                      {moneyMicroUsd(entry.usdMicro)} · {entry.jobs} job{entry.jobs === 1 ? "" : "s"}
                    </b>
                  </div>
                  <div className={styles.topBarTrack}>
                    <div
                      className={styles.topBar}
                      style={{ width: `${earnedMax > 0 ? Math.round((entry.usdMicro / earnedMax) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className={styles.chartCard}>
        <div className={styles.chartHead}>
          <span className={styles.cardKicker}>
            <TrendingUp size={13} aria-hidden="true" /> Projected net earnings by active model slot
          </span>
          <span className={styles.chartTotal}>{pricingReady ? `${earn.monthStr} / mo net projected` : "Benchmark required"}</span>
        </div>
        {perModel.length ? (
          <>
            <div className={styles.chartBars}>
              {perModel.map((m, i) => (
                <div key={`${m.name}-${i}`} className={styles.chartBarSlot} title={`${m.name}: ${money(m.month)} / mo`}>
                  <div
                    className={styles.chartBar}
                    data-peak={i === perModel.length - 1}
                    style={{ height: `${barMax > 0 ? Math.max(6, Math.round((m.month / barMax) * 100)) : 6}%` }}
                  />
                </div>
              ))}
            </div>
            <div className={styles.chartAxis}>
              <span>Lowest priced</span>
              <span>Highest priced</span>
            </div>
          </>
        ) : (
          <p className={styles.chartEmpty}>
            {enabledCount > 0 ? "Benchmark selected models to calculate earnings." : "Advertise at least one model to project earnings."}
          </p>
        )}
      </div>

      <div className={styles.earnCols}>
        <section className={styles.card}>
          <span className={styles.cardKicker}>
            <Gauge size={13} aria-hidden="true" /> Live performance
          </span>
          <div className={styles.perfRows}>
            {perfStats.map((stat) => (
              <div key={stat.label} className={styles.perfRow}>
                <span className={styles.perfLabel}>{stat.label}</span>
                <b className={styles.perfVal}>{stat.value}</b>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.card}>
          <span className={styles.cardKicker}>
            <CreditCard size={13} aria-hidden="true" /> Top advertised · projected / mo
          </span>
          {topModels.length ? (
            <div className={styles.topList}>
              {topModels.map((m, i) => (
                <div key={`${m.name}-${i}`} className={styles.topItem}>
                  <div className={styles.topRow}>
                    <span className={styles.topName}>{m.name}</span>
                    <b className={styles.topAmount}>{money(m.month)}</b>
                  </div>
                  <div className={styles.topBarTrack}>
                    <div className={styles.topBar} style={{ width: `${topMax > 0 ? Math.round((m.month / topMax) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.modelsEmpty}>
              {enabledCount > 0 ? "Benchmark selected models to rank projected earnings." : "No advertised models yet."}
            </p>
          )}
        </section>
      </div>

      {workerOutput}

      <div className={`${styles.footer} ${styles.footerSpread}`}>
        <span className={styles.footerNote}>
          {running ? `Hosting for ${uptime} · guardrails saved on go-live` : "Not currently hosting · projections shown"}
        </span>
        <div className={styles.footerBtns}>
          <button type="button" className={styles.btnSecondary} onClick={onAdjustSettings}>
            <Gauge size={13} aria-hidden="true" /> Adjust settings
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={onStopHosting}
            disabled={busy || !running}
          >
            {stopBusy ? <span className={styles.spinner} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            Stop hosting
          </button>
        </div>
      </div>
    </>
  );
}
