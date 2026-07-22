"use client";

import { MessageCircle, Pause, Play, Quote, Radar } from "lucide-react";
import Link from "next/link";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import {
  SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN,
  SOCIAL_ENGAGEMENT_LOOKBACK_HOURS,
  SOCIAL_QUOTE_DRAFTS_PER_RUN,
} from "@/lib/services/socials/socials-types";

function formatDate(value?: string): string {
  if (!value) return "Not yet";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Unknown";
}

function lookbackLabel(hours: number): string {
  if (hours === 168) return "Past week";
  if (hours === 72) return "Past 3 days";
  if (hours === 48) return "Past 2 days";
  if (hours === 24) return "Past day";
  return `Past ${hours} hours`;
}

export function EngagementDiscoveryCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const policy = account.drafting;
  const runtime = desk.draftingRuntime;
  const supported = account.platform === "x"
    && account.capabilities.search !== "unsupported"
    && account.capabilities.reply !== "unsupported";
  const finding = desk.queueBusy === "generate-engagement";
  const save = (drafting: Parameters<typeof desk.setDraftingPolicy>[1]) => desk.setDraftingPolicy(account.id, drafting);

  if (!supported) return null;

  return (
    <section className="sc-card" data-testid="social-engagement-discovery">
      <div className="sc-card-head">
        <div>
          <span className="sc-card-title">Comment finder</span>
          <div className="sc-card-hint" style={{ marginTop: 3 }}>
            {policy.engagementEnabled
              ? policy.quoteDraftsPerRun > 0
                ? `${policy.replyDraftsPerRun} replies + ${policy.quoteDraftsPerRun} standalone quote posts per pack`
                : `${policy.replyDraftsPerRun} reply suggestions per pack · standalone quotes off`
              : "Paused · no relevant-post scans will run"}
          </div>
        </div>
        <button
          type="button"
          className="sc-btn"
          disabled={Boolean(desk.queueBusy)}
          onClick={() => void save({ engagementEnabled: !policy.engagementEnabled })}
        >
          {policy.engagementEnabled ? <Pause aria-hidden="true" width={13} /> : <Play aria-hidden="true" width={13} />}
          {policy.engagementEnabled ? "Pause comments" : "Enable comments"}
        </button>
      </div>

      <div className="sc-drafting-grid sc-engagement-grid">
        <label className="sc-field">
          <span className="sc-label"><MessageCircle aria-hidden="true" width={13} /> Replies per pack</span>
          <select
            className="sc-select"
            value={policy.replyDraftsPerRun}
            disabled={Boolean(desk.queueBusy)}
            onChange={(event) => void save({ replyDraftsPerRun: Number(event.target.value) as typeof policy.replyDraftsPerRun })}
          >
            {SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN.map((count) => <option key={count} value={count}>{count} repl{count === 1 ? "y" : "ies"}</option>)}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-label"><Quote aria-hidden="true" width={13} /> Standalone quote posts per pack (optional)</span>
          <select
            className="sc-select"
            value={policy.quoteDraftsPerRun}
            disabled={Boolean(desk.queueBusy)}
            onChange={(event) => void save({ quoteDraftsPerRun: Number(event.target.value) as typeof policy.quoteDraftsPerRun })}
          >
            {SOCIAL_QUOTE_DRAFTS_PER_RUN.map((count) => <option key={count} value={count}>{count} quote{count === 1 ? "" : "s"}</option>)}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-label">Target freshness</span>
          <select
            className="sc-select"
            value={policy.engagementLookbackHours}
            disabled={Boolean(desk.queueBusy)}
            onChange={(event) => void save({ engagementLookbackHours: Number(event.target.value) as typeof policy.engagementLookbackHours })}
          >
            {SOCIAL_ENGAGEMENT_LOOKBACK_HOURS.map((hours) => <option key={hours} value={hours}>{lookbackLabel(hours)}</option>)}
          </select>
        </label>
        <div className="sc-drafting-status">
          <span><strong>Last scan</strong>{formatDate(runtime?.lastDiscoveryAt)}</span>
          <span><strong>Last results</strong>{runtime?.lastEngagementGeneratedAt ? `${runtime.lastDiscoveredCount ?? 0} candidates · ${runtime.lastReplyGeneratedCount ?? 0} replies · ${runtime.lastQuoteGeneratedCount ?? 0} quotes` : "No completed scan yet"}</span>
        </div>
      </div>

      <div className="sc-note">
        Replies publish inside the target conversation. Standalone quote posts publish on your profile with the source attached; they are not replies or comments and are off by default.
      </div>

      <div className="sc-discovery-status" data-ready={desk.xDiscovery?.authenticated === true}>
        <Radar aria-hidden="true" width={14} />
        <span>{desk.xDiscovery?.detail ?? "Checking the local read-only X discovery backend…"}</span>
        {desk.xDiscovery && !desk.xDiscovery.authenticated ? <Link className="sc-link-btn" href="/?view=my-apps">Open Agent Reach setup</Link> : null}
      </div>

      {runtime?.lastEngagementError ? <div className="sc-error">Comment finder: {runtime.lastEngagementError}</div> : null}
      <div className="sc-drafting-footer">
        <div className="sc-note">
          Reads fresh public posts through the local Agent Reach X session, ranks unused targets, and queues source-linked suggestions for review. It never likes, replies, quotes, or publishes by itself.
        </div>
        <button
          type="button"
          className="sc-btn"
          data-tone="primary"
          disabled={Boolean(desk.queueBusy) || !policy.engagementEnabled || desk.xDiscovery?.authenticated !== true}
          onClick={() => void desk.queueAction({ action: "generate-engagement", accountId: account.id })}
        >
          {finding ? <SocialsSpinner /> : <Radar aria-hidden="true" width={13} />}
          {finding ? "Finding posts" : "Find replies now"}
        </button>
      </div>
    </section>
  );
}
