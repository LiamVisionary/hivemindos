"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import type { SocialMetricSnapshot, SocialQueueItem } from "@/lib/services/socials/socials-types";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

function metricValue(metrics: Record<string, number>, keys: string[]): number {
  const entry = Object.entries(metrics).find(([key]) => keys.includes(key.toLowerCase()));
  return entry?.[1] ?? 0;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value?: string): string {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

function accountForItem(accounts: SocialsAccountView[], item: SocialQueueItem): SocialsAccountView | null {
  return accounts.find((account) => account.id === item.accountId) ?? null;
}

function snapshotMetric(snapshot: SocialMetricSnapshot): number {
  return metricValue(snapshot.metrics, ["impressions", "views", "view_count"]);
}

export function SocialAnalyticsDashboard() {
  const desk = useSocialsDesk();
  const analytics = desk.socialAnalytics;
  const totalImpressions = metricValue(analytics.metricTotals, ["impressions", "views", "view_count"]);
  const suggested = desk.queueItems.filter((item) => item.origin === "agent").length;
  const approved = desk.queueItems.filter((item) => Boolean(item.approval) || ["scheduled", "posting", "posted"].includes(item.state)).length;
  const published = desk.queueItems.filter((item) => item.state === "posted").length;
  const discarded = desk.queueItems.filter((item) => item.state === "canceled").length;
  const approvalRate = suggested ? Math.round((approved / suggested) * 100) : 0;
  const latestAccountSnapshot = [...desk.metricSnapshots].filter((snapshot) => !snapshot.externalId).sort((left, right) => right.at.localeCompare(left.at))[0];
  const posts = useMemo(() => desk.queueItems
    .filter((item) => item.state === "posted")
    .sort((left, right) => {
      const leftViews = metricValue(left.result?.metrics ?? {}, ["impressions", "views", "view_count"]);
      const rightViews = metricValue(right.result?.metrics ?? {}, ["impressions", "views", "view_count"]);
      return rightViews - leftViews;
    }).slice(0, 6), [desk.queueItems]);
  const chartSnapshots = useMemo(() => [...desk.metricSnapshots]
    .filter((snapshot) => snapshot.externalId && snapshotMetric(snapshot) > 0)
    .sort((left, right) => left.at.localeCompare(right.at)).slice(-14), [desk.metricSnapshots]);
  const maxChart = Math.max(1, ...chartSnapshots.map(snapshotMetric));

  const refresh = async () => {
    if (!desk.activeAccount || desk.allAccountsSelected) return;
    if (desk.activeAccount.method === "managed-oauth" && !await confirmUserAction("Refresh managed X analytics? This makes metered hosted X API reads and may debit HivemindOS credits under the server-owned rate policy.")) return;
    await desk.queueAction({ action: "refresh-analytics", accountId: desk.activeAccount.id });
  };

  return (
    <section className="sc-analytics-route">
      <div className="sc-analytics-metrics">
        <AnalyticsMetric label="Impressions" value={formatCompact(totalImpressions)} note="Stored provider metrics" />
        <AnalyticsMetric label="Published" value={String(analytics.posted)} note={`${analytics.manual} manual · ${analytics.automated} automated`} />
        <AnalyticsMetric label="Approval rate" value={`${approvalRate}%`} note={`${approved} approved of ${suggested} agent items`} />
        <AnalyticsMetric label="Failed sends" value={String(analytics.failed)} note={`${analytics.canceled} canceled`} tone={analytics.failed ? "danger" : "live"} />
      </div>

      <div className="sc-analytics-grid">
        <section className="sc-chart-card">
          <div className="sc-side-card-head"><div><strong>Stored post reach</strong><span>Latest provider metric snapshots</span></div></div>
          {chartSnapshots.length ? (
            <div className="sc-bar-chart">
              {chartSnapshots.map((snapshot, index) => {
                const value = snapshotMetric(snapshot);
                return <div key={`${snapshot.at}:${snapshot.externalId}:${index}`} title={`${formatDate(snapshot.at)} · ${new Intl.NumberFormat().format(value)}`}><span style={{ height: `${Math.max(6, (value / maxChart) * 100)}%` }} /><em>{new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(new Date(snapshot.at))}</em></div>;
              })}
            </div>
          ) : <div className="sc-empty">No per-post reach snapshots are stored yet. Refresh an account after posts have been published.</div>}
        </section>

        <div className="sc-analytics-side">
          <section className="sc-funnel-card">
            <div className="sc-side-card-head"><div><strong>Approval funnel</strong><span>Current durable queue scope</span></div></div>
            <FunnelRow label="Suggested by agents" value={suggested} total={Math.max(1, suggested)} tone="honey" />
            <FunnelRow label="Approved by you" value={approved} total={Math.max(1, suggested)} tone="honey" />
            <FunnelRow label="Published" value={published} total={Math.max(1, suggested)} tone="live" />
            <FunnelRow label="Discarded" value={discarded} total={Math.max(1, suggested)} tone="danger" />
          </section>

          <section className="sc-snapshot-card">
            <div className="sc-side-card-head"><div><strong>Account snapshot</strong><span>{latestAccountSnapshot ? formatDate(latestAccountSnapshot.at) : "No snapshot"}</span></div></div>
            {latestAccountSnapshot ? <div className="sc-snapshot-grid">{Object.entries(latestAccountSnapshot.metrics).map(([label, value]) => <div key={label}><span>{label.replaceAll("_", " ")}</span><strong>{formatCompact(value)}</strong></div>)}</div> : <div className="sc-empty">Account-level metrics appear after a provider analytics refresh.</div>}
            {desk.activeAccount?.method === "managed-oauth" ? <div className="sc-metered-note">Managed X analytics uses metered hosted reads.{desk.managedReadBudget ? ` ${desk.managedReadBudget.remaining} of ${desk.managedReadBudget.limit} daily operations remain.` : ""}</div> : null}
            <div className="sc-analytics-refresh-row">
              {desk.activeAccount?.method === "managed-oauth" ? <label>Daily read budget<select value={desk.activeAccount.maxDailyReadOps} disabled={Boolean(desk.queueBusy)} onChange={(event) => void desk.setMaxDailyReadOps(desk.activeAccountId, Number(event.target.value))}>{[0, 5, 10, 20, 50, 100].map((value) => <option key={value} value={value}>{value} operations</option>)}</select></label> : <span />}
              <button type="button" className="sc-btn" disabled={!desk.activeAccount || desk.allAccountsSelected || Boolean(desk.queueBusy)} onClick={() => void refresh()}><BarChart3 width={14} /> Refresh analytics</button>
            </div>
            {desk.allAccountsSelected ? <p className="sc-card-hint">Select one account to make a provider analytics read.</p> : null}
          </section>
        </div>
      </div>

      <section className="sc-top-posts-card">
        <div className="sc-side-card-head"><div><strong>Top posts</strong><span>Ranked by stored impressions or views</span></div></div>
        <div className="sc-top-posts-list">
          {posts.map((item, index) => {
            const metrics = item.result?.metrics ?? {};
            const impressions = metricValue(metrics, ["impressions", "views", "view_count"]);
            const engagements = metricValue(metrics, ["engagements", "likes", "like_count"]);
            const rate = impressions ? `${((engagements / impressions) * 100).toFixed(1)}%` : "—";
            return <div key={item.id}><span>{index + 1}</span><div><strong>{item.text}</strong><em>@{accountForItem(desk.accounts, item)?.handle ?? item.accountId}</em></div><i data-origin={item.origin}>{item.origin === "agent" ? "agent" : "you"}</i><code>{formatCompact(impressions)}</code><code>{rate}</code>{item.result?.url ? <a href={item.result.url} target="_blank" rel="noreferrer">Open</a> : null}</div>;
          })}
          {!posts.length ? <div className="sc-empty">Published posts with confirmed results will appear here.</div> : null}
        </div>
      </section>
    </section>
  );
}

function AnalyticsMetric({ label, value, note, tone = "live" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className="sc-analytics-metric" data-tone={tone}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function FunnelRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  return <div className="sc-funnel-row" data-tone={tone}><div><span>{label}</span><strong>{value}</strong></div><i><span style={{ width: `${Math.min(100, (value / total) * 100)}%` }} /></i></div>;
}
