"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  Check,
  Clock3,
  ExternalLink,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Quote,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { useSocialsDesk } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import type { SocialQueueItem } from "@/lib/services/socials/socials-types";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

type QueueTab = "queue" | "history" | "analytics";

function localInputToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : value;
}

function itemStatusCopy(item: SocialQueueItem, now: number): string {
  if (item.state === "scheduled") {
    const cancelEnds = Date.parse(item.cancelWindowEndsAt ?? "");
    if (item.automated && Number.isFinite(cancelEnds) && cancelEnds > now) {
      return `Auto-mode cancellation window · ${Math.ceil((cancelEnds - now) / 1000)}s remaining`;
    }
    if (item.retryAt) return `Retry scheduled ${formatDate(item.retryAt)}`;
    return `Scheduled ${formatDate(item.scheduledFor)}`;
  }
  if (item.state === "posted") return `Posted ${formatDate(item.result?.postedAt)}`;
  if (item.state === "failed") return item.failure?.kind === "ambiguous" ? "Delivery unknown · verify before retry" : "Delivery failed";
  if (item.state === "suggested") return "Needs your review";
  if (item.state === "approved") return "Approved · waiting for the engine";
  if (item.state === "posting") return "Sending now";
  return item.state;
}

function generatedKindLabel(item: SocialQueueItem): string {
  if (item.generation?.kind === "reply") return item.state === "suggested" ? "Reply suggestion" : `${item.state} reply`;
  if (item.generation?.kind === "quote") return item.state === "suggested" ? "Standalone quote post suggestion" : `${item.state} standalone quote post`;
  return item.state;
}

function sendConfirmation(item: SocialQueueItem, handle: string): string {
  const targetHandle = item.generation?.target?.authorHandle;
  if (item.generation?.kind === "reply") {
    return `Publish this reply${targetHandle ? ` to @${targetHandle}` : ""} as @${handle} now?`;
  }
  if (item.generation?.kind === "quote") {
    return `This is not a reply or comment. Publish this standalone quote post${targetHandle ? ` of @${targetHandle}` : ""} on @${handle}'s profile now?`;
  }
  return `Publish this ${item.platform} post as @${handle} now?`;
}

function sendActionLabel(item: SocialQueueItem): string {
  if (item.generation?.kind === "reply") return "Post reply";
  if (item.generation?.kind === "quote") return "Post standalone quote";
  return "Send now";
}

export function SocialQueueWorkspace() {
  const desk = useSocialsDesk();
  const account = desk.activeAccount;
  const [tab, setTab] = useState<QueueTab>("queue");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [subreddit, setSubreddit] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [quoteOf, setQuoteOf] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scheduleById, setScheduleById] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SocialQueueItem | null>(null);
  const [now, setNow] = useState(0);

  const hasCountdown = desk.queueItems.some((item) => item.state === "scheduled" && item.automated && Date.parse(item.cancelWindowEndsAt ?? "") > now);
  useEffect(() => {
    if (!hasCountdown) return undefined;
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [hasCountdown]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setText("");
      setTitle("");
      setSubreddit(account?.binding?.defaultSubreddit ?? "");
      setReplyTo("");
      setQuoteOf("");
      setScheduleAt("");
      setEditing(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account?.id, account?.binding?.defaultSubreddit]);

  const active = useMemo(
    () => desk.queueItems.filter((item) => !["posted", "failed", "canceled"].includes(item.state)),
    [desk.queueItems],
  );
  const history = useMemo(
    () => desk.queueItems.filter((item) => ["posted", "failed", "canceled"].includes(item.state)),
    [desk.queueItems],
  );
  const canPost = Boolean(account && account.capabilities.post !== "unsupported");
  const busy = Boolean(desk.queueBusy);

  const resetComposer = () => {
    setText("");
    setTitle("");
    setReplyTo("");
    setQuoteOf("");
    setScheduleAt("");
  };

  const create = async (intent: "draft" | "send" | "schedule") => {
    if (!account) return;
    if (intent === "send") {
      const confirmed = await confirmUserAction(`Publish this ${account.platform} post as @${account.handle} now?`);
      if (!confirmed) return;
    }
    const scheduledFor = intent === "schedule" ? localInputToIso(scheduleAt) : null;
    if (intent === "schedule" && !scheduledFor) return;
    const created = await desk.queueAction({
      action: "create",
      accountId: account.id,
      text,
      ...(title ? { title } : {}),
      ...(subreddit ? { subreddit } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(quoteOf ? { quoteOf } : {}),
    });
    if (!created.ok || !created.item) return;
    if (intent === "send") await desk.queueAction({ action: "send-now", id: created.item.id });
    if (intent === "schedule") await desk.queueAction({ action: "schedule", id: created.item.id, scheduledFor });
    resetComposer();
  };

  const sendNow = async (item: SocialQueueItem) => {
    if (!account) return;
    const confirmed = await confirmUserAction(sendConfirmation(item, account.handle));
    if (confirmed) await desk.queueAction({ action: "send-now", id: item.id });
  };

  const schedule = async (item: SocialQueueItem) => {
    const iso = localInputToIso(scheduleById[item.id] ?? "");
    if (!iso) return;
    await desk.queueAction({ action: "schedule", id: item.id, scheduledFor: iso });
  };

  const retry = async (item: SocialQueueItem) => {
    const ambiguous = item.failure?.kind === "ambiguous";
    const verified = !ambiguous || await confirmUserAction(
      "This send was interrupted after delivery began. Confirm you checked the social account and the post is not already live before retrying.",
    );
    if (verified) await desk.queueAction({ action: "retry", id: item.id, deliveryVerified: ambiguous });
  };

  if (!account) return null;

  return (
    <section className="sc-card sc-queue-workspace" data-testid="social-queue-workspace">
      <div className="sc-card-head sc-queue-head">
        <div>
          <span className="sc-card-title">Posting queue</span>
          <div className="sc-card-hint" style={{ marginTop: 3 }} data-testid="social-queue-engine-status">
            {desk.engine.enabled
              ? desk.engine.lastTickAt ? `Delivery worker active · last tick ${formatDate(desk.engine.lastTickAt)}` : "Delivery worker starting"
              : "Delivery worker paused · drafting and scheduled posts will wait"}
          </div>
        </div>
        <div className="sc-actions">
          <button
            type="button"
            className="sc-btn"
            disabled={busy || desk.engine.disabled}
            onClick={() => void desk.queueAction({ action: desk.engine.enabled ? "pause-engine" : "resume-engine" })}
          >
            {desk.engine.enabled ? <Pause aria-hidden="true" width={13} /> : <Play aria-hidden="true" width={13} />}
            {desk.engine.enabled ? "Pause" : "Resume"}
          </button>
          <button type="button" className="sc-btn" disabled={busy || !desk.engine.enabled} onClick={() => void desk.queueAction({ action: "tick" })}>
            {desk.queueBusy === "tick" ? <SocialsSpinner /> : <RefreshCw aria-hidden="true" width={13} />} Process queue
          </button>
        </div>
      </div>

      {desk.engine.lastError ? <div className="sc-error">Delivery worker: {desk.engine.lastError}</div> : null}

      <div className="sc-composer" data-testid="social-queue-composer">
        <div className="sc-composer-head">
          <span className="sc-label">New post for @{account.handle}</span>
          <span className="sc-card-hint">{text.length} characters</span>
        </div>
        {account.platform === "reddit" && !replyTo ? (
          <div className="sc-inline-fields">
            <input className="sc-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reddit post title" maxLength={300} />
            <input className="sc-input" value={subreddit} onChange={(event) => setSubreddit(event.target.value)} placeholder="Subreddit" />
          </div>
        ) : null}
        <textarea
          className="sc-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={canPost ? "Write a post, or let an agent add a suggestion here for review." : "Posting is unavailable for this connection method."}
          rows={5}
          disabled={!canPost}
        />
        {account.capabilities.reply !== "unsupported" || account.capabilities.quote !== "unsupported" ? (
          <button type="button" className="sc-link-btn" onClick={() => setAdvancedOpen((open) => !open)}>
            {advancedOpen ? "Hide reply and quote options" : "Reply or quote an existing post"}
          </button>
        ) : null}
        {advancedOpen && (account.capabilities.reply !== "unsupported" || account.capabilities.quote !== "unsupported") ? (
          <div className="sc-inline-fields">
            {account.capabilities.reply !== "unsupported" ? <input className="sc-input" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Reply-to post/message ID" /> : null}
            {account.capabilities.quote !== "unsupported" ? <input className="sc-input" value={quoteOf} onChange={(event) => setQuoteOf(event.target.value)} placeholder={account.platform === "farcaster" ? "Quote target: fid:castHash" : "Standalone quote target post ID (not a reply)"} /> : null}
          </div>
        ) : null}
        <div className="sc-composer-actions">
          <button type="button" className="sc-btn" disabled={!canPost || !text.trim() || busy} onClick={() => void create("draft")}>Save draft</button>
          <div className="sc-schedule-control">
            <input className="sc-input" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} aria-label="Schedule date and time" />
            <button type="button" className="sc-btn" disabled={!canPost || !text.trim() || !scheduleAt || busy} onClick={() => void create("schedule")}>
              <CalendarClock aria-hidden="true" width={13} /> Schedule
            </button>
          </div>
          <button type="button" className="sc-btn" data-tone="primary" disabled={!canPost || !text.trim() || busy} onClick={() => void create("send")}>
            <Send aria-hidden="true" width={13} /> Send now
          </button>
        </div>
        {account.postingMode === "auto" ? (
          <div className="sc-auto-note">Auto mode is opted in for this account. Agent automations get a visible five-minute cancellation window; agent tool suggestions still enter review.</div>
        ) : null}
      </div>

      <div className="sc-tabs" role="tablist" aria-label="Social posting queue sections">
        <button type="button" role="tab" aria-selected={tab === "queue"} data-active={tab === "queue"} onClick={() => setTab("queue")}>
          Queue <span>{active.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} data-active={tab === "history"} onClick={() => setTab("history")}>
          History <span>{history.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "analytics"} data-active={tab === "analytics"} onClick={() => setTab("analytics")}>
          Analytics
        </button>
      </div>

      {desk.queueLoading ? <div className="sc-queue-loading"><SocialsSpinner /> Refreshing the queue</div> : null}
      {tab === "queue" ? (
        <div className="sc-queue-list">
          {!active.length && !desk.queueLoading ? <div className="sc-empty">No pending posts or reply suggestions. The drafting schedule will add the next review pack, or use Generate full pack or Find replies now above.</div> : null}
          {active.map((item) => (
            <QueueItemCard
              key={item.id}
              item={item}
              now={now}
              busy={desk.queueBusy === item.id}
              editing={editing?.id === item.id ? editing : null}
              scheduleValue={scheduleById[item.id] ?? ""}
              onScheduleValue={(value) => setScheduleById((current) => ({ ...current, [item.id]: value }))}
              onEdit={() => setEditing({ ...item })}
              onEditChange={setEditing}
              onSaveEdit={async () => {
                if (!editing) return;
                const result = await desk.queueAction({ action: "update", id: editing.id, text: editing.text, title: editing.title, subreddit: editing.subreddit, replyTo: editing.replyTo, quoteOf: editing.quoteOf });
                if (result.ok) setEditing(null);
              }}
              onCancelEdit={() => setEditing(null)}
              onSend={() => void sendNow(item)}
              onSchedule={() => void schedule(item)}
              onCancel={() => void desk.queueAction({ action: "cancel", id: item.id })}
            />
          ))}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="sc-queue-list">
          {!history.length ? <div className="sc-empty">Published, failed, and canceled posts will appear here.</div> : null}
          {history.map((item) => (
            <article key={item.id} className="sc-queue-item" data-state={item.state}>
              <div className="sc-queue-item-head">
                <span className="sc-state">{generatedKindLabel(item)}</span>
                <span className="sc-card-hint">{itemStatusCopy(item, now)}</span>
              </div>
              <EngagementTargetPreview item={item} />
              {item.title ? <div className="sc-queue-title">{item.title}</div> : null}
              <div className="sc-queue-text">{item.text}</div>
              {item.failure ? <div className="sc-error">{item.failure.error}</div> : null}
              <div className="sc-actions">
                {item.result?.url ? <a className="sc-btn" href={item.result.url} target="_blank" rel="noreferrer">Open post</a> : null}
                {item.state === "failed" ? (
                  <button type="button" className="sc-btn" disabled={busy} onClick={() => void retry(item)}><RotateCcw aria-hidden="true" width={13} /> Retry</button>
                ) : null}
                <button type="button" className="sc-btn" data-tone="danger" disabled={busy} onClick={() => void desk.queueAction({ action: "delete", id: item.id })}>
                  <Trash2 aria-hidden="true" width={13} /> Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "analytics" ? <SocialAnalyticsPanel /> : null}
    </section>
  );
}

function QueueItemCard(props: {
  item: SocialQueueItem;
  now: number;
  busy: boolean;
  editing: SocialQueueItem | null;
  scheduleValue: string;
  onScheduleValue: (value: string) => void;
  onEdit: () => void;
  onEditChange: (item: SocialQueueItem) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSend: () => void;
  onSchedule: () => void;
  onCancel: () => void;
}) {
  const { item } = props;
  return (
    <article className="sc-queue-item" data-state={item.state}>
      <div className="sc-queue-item-head">
        <span className="sc-state">{generatedKindLabel(item)}</span>
        <span className="sc-card-hint">{itemStatusCopy(item, props.now)}</span>
      </div>
      {props.editing ? (
        <div className="sc-edit-stack">
          {item.platform === "reddit" && !props.editing.replyTo ? (
            <div className="sc-inline-fields">
              <input className="sc-input" value={props.editing.title ?? ""} onChange={(event) => props.onEditChange({ ...props.editing!, title: event.target.value })} placeholder="Reddit title" />
              <input className="sc-input" value={props.editing.subreddit ?? ""} onChange={(event) => props.onEditChange({ ...props.editing!, subreddit: event.target.value })} placeholder="Subreddit" />
            </div>
          ) : null}
          <textarea className="sc-textarea" rows={4} value={props.editing.text} onChange={(event) => props.onEditChange({ ...props.editing!, text: event.target.value })} />
          <div className="sc-actions">
            <button type="button" className="sc-btn" onClick={props.onSaveEdit}><Check aria-hidden="true" width={13} /> Save</button>
            <button type="button" className="sc-btn" onClick={props.onCancelEdit}><X aria-hidden="true" width={13} /> Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <EngagementTargetPreview item={item} />
          {item.title ? <div className="sc-queue-title">{item.title}</div> : null}
          {item.generation?.kind === "reply" ? <div className="sc-queue-draft-label"><MessageCircle aria-hidden="true" width={13} /> Suggested reply</div> : null}
          {item.generation?.kind === "quote" ? <div className="sc-queue-draft-label"><Quote aria-hidden="true" width={13} /> Suggested standalone quote post · not a reply/comment</div> : null}
          <div className="sc-queue-text">{item.text}</div>
          {item.generation ? (
            <div className="sc-card-hint">
              Agent {item.generation.kind} draft · {formatDate(item.generation.generatedAt)}
              {item.generation.rationale ? ` · ${item.generation.rationale}` : ""}
              {typeof item.generation.relevanceScore === "number" ? ` · ${Math.round(item.generation.relevanceScore)}% relevance` : ""}
            </div>
          ) : null}
          {item.replyTo && !item.generation?.target ? <div className="sc-card-hint">Reply to {item.replyTo}</div> : null}
          {item.quoteOf && !item.generation?.target ? <div className="sc-card-hint">Quote {item.quoteOf}</div> : null}
        </>
      )}
      <div className="sc-queue-item-footer">
        <div className="sc-schedule-control">
          <input className="sc-input" type="datetime-local" value={props.scheduleValue} onChange={(event) => props.onScheduleValue(event.target.value)} aria-label={`Schedule ${item.id}`} />
          <button type="button" className="sc-btn" disabled={!props.scheduleValue || props.busy || item.state === "posting"} onClick={props.onSchedule}>
            <Clock3 aria-hidden="true" width={13} /> Set time
          </button>
        </div>
        <div className="sc-actions">
          {(["draft", "suggested", "failed"] as string[]).includes(item.state) && !props.editing ? (
            <button type="button" className="sc-btn" disabled={props.busy} onClick={props.onEdit}><Pencil aria-hidden="true" width={13} /> Edit</button>
          ) : null}
          {item.state !== "posting" ? (
            <button type="button" className="sc-btn" data-tone="primary" disabled={props.busy} onClick={props.onSend}><Send aria-hidden="true" width={13} /> {sendActionLabel(item)}</button>
          ) : <SocialsSpinner />}
          {item.state !== "posting" ? <button type="button" className="sc-btn" disabled={props.busy} onClick={props.onCancel}>Cancel</button> : null}
        </div>
      </div>
    </article>
  );
}

function EngagementTargetPreview({ item }: { item: SocialQueueItem }) {
  const target = item.generation?.target;
  if (!target) return null;
  const metrics = [
    `${new Intl.NumberFormat().format(target.metrics.likes)} likes`,
    `${new Intl.NumberFormat().format(target.metrics.reposts)} reposts`,
    `${new Intl.NumberFormat().format(target.metrics.replies)} replies`,
    ...(typeof target.metrics.views === "number" ? [`${new Intl.NumberFormat().format(target.metrics.views)} views`] : []),
  ];
  return (
    <div className="sc-engagement-target" data-testid="social-engagement-target">
      <div className="sc-engagement-target-head">
        <div>
          <strong>@{target.authorHandle}</strong>
          {target.authorName ? <span>{target.authorName}</span> : null}
          <span>· {formatDate(target.createdAt)}</span>
        </div>
        <a className="sc-link-btn" href={target.url} target="_blank" rel="noreferrer">
          Open target <ExternalLink aria-hidden="true" width={12} />
        </a>
      </div>
      <div className="sc-engagement-target-text">{target.text}</div>
      <div className="sc-engagement-target-meta">
        <span>{metrics.join(" · ")}</span>
        <span>Found via {target.source === "timeline" ? "followed account" : `search${target.sourceQuery ? `: ${target.sourceQuery}` : ""}`}</span>
      </div>
    </div>
  );
}

function SocialAnalyticsPanel() {
  const desk = useSocialsDesk();
  const analytics = desk.socialAnalytics;
  const configuredReadBudget = desk.activeAccount?.maxDailyReadOps ?? 0;
  const readBudgetOptions = [0, 5, 10, 20, 50, 100].includes(configuredReadBudget)
    ? [0, 5, 10, 20, 50, 100]
    : [configuredReadBudget, 0, 5, 10, 20, 50, 100].sort((left, right) => left - right);
  const latestAccountMetrics = [...desk.metricSnapshots].filter((snapshot) => !snapshot.externalId).sort((left, right) => right.at.localeCompare(left.at))[0];
  const refresh = async () => {
    if (desk.activeAccount?.method === "managed-oauth") {
      const confirmed = await confirmUserAction("Refresh managed X analytics? This makes metered hosted X API reads and may debit HivemindOS credits under the server-owned rate policy.");
      if (!confirmed) return;
    }
    await desk.queueAction({ action: "refresh-analytics", accountId: desk.activeAccountId });
  };
  return (
    <div className="sc-analytics">
      <div className="sc-metric-grid">
        <Metric label="Published" value={analytics.posted} />
        <Metric label="Manual" value={analytics.manual} />
        <Metric label="Automated" value={analytics.automated} />
        <Metric label="Failed" value={analytics.failed} />
      </div>
      {Object.keys(analytics.metricTotals).length ? (
        <div>
          <div className="sc-label" style={{ marginBottom: 8 }}>Post performance</div>
          <div className="sc-metric-grid">
            {Object.entries(analytics.metricTotals).map(([label, value]) => <Metric key={label} label={label} value={value} />)}
          </div>
        </div>
      ) : <div className="sc-empty">Engagement metrics appear after published posts are refreshed through the connected platform API.</div>}
      {desk.activeAccount?.method === "managed-oauth" ? (
        <div className="sc-auto-note">
          <span>Managed X analytics uses metered hosted API reads. You will be asked before refreshing.</span>
          {desk.managedReadBudget ? (
            <span className="sc-card-hint">{desk.managedReadBudget.remaining} remaining today · {desk.managedReadBudget.used}/{desk.managedReadBudget.limit} used</span>
          ) : null}
          <label className="sc-read-budget">
            Daily read budget
            <select
              className="sc-select"
              value={desk.activeAccount.maxDailyReadOps}
              disabled={Boolean(desk.queueBusy)}
              onChange={(event) => void desk.setMaxDailyReadOps(desk.activeAccountId, Number(event.target.value))}
            >
              {readBudgetOptions.map((value) => <option key={value} value={value}>{value} operations</option>)}
            </select>
          </label>
        </div>
      ) : null}
      {latestAccountMetrics ? (
        <div>
          <div className="sc-label" style={{ marginBottom: 8 }}>Latest account snapshot · {formatDate(latestAccountMetrics.at)}</div>
          <div className="sc-metric-grid">
            {Object.entries(latestAccountMetrics.metrics).map(([label, value]) => <Metric key={label} label={label} value={value} />)}
          </div>
        </div>
      ) : null}
      <div className="sc-actions">
        <button type="button" className="sc-btn" disabled={Boolean(desk.queueBusy)} onClick={() => void refresh()}>
          <BarChart3 aria-hidden="true" width={13} /> Refresh analytics
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="sc-metric"><span>{label}</span><strong>{new Intl.NumberFormat().format(value)}</strong></div>;
}
