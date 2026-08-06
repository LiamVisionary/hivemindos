"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import { socialAccountHasStandaloneGroundingSource } from "@/lib/services/socials/social-drafting-readiness";
import type { SocialQueueItem } from "@/lib/services/socials/socials-types";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

type ReviewFilter = "all" | "post" | "reply" | "quote";
type ComposerIntent = "draft" | "send" | "schedule";

const REVIEW_STATES = new Set<SocialQueueItem["state"]>(["draft", "suggested", "failed"]);
const SCHEDULED_STATES = new Set<SocialQueueItem["state"]>(["approved", "scheduled", "posting"]);
const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All",
  post: "Posts",
  reply: "Replies",
  quote: "Quotes",
};

function localInputToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isoToLocalInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : value;
}

function formatRelative(value?: string): string {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return "drafted recently";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return "drafted just now";
  if (minutes < 60) return `drafted ${minutes}m ago`;
  if (minutes < 1_440) return `drafted ${Math.floor(minutes / 60)}h ago`;
  return `drafted ${Math.floor(minutes / 1_440)}d ago`;
}

function itemKind(item: SocialQueueItem): "post" | "reply" | "quote" {
  return item.generation?.kind ?? (item.replyTo ? "reply" : item.quoteOf ? "quote" : "post");
}

function itemKindLabel(item: SocialQueueItem): string {
  const kind = itemKind(item);
  if (kind === "reply") return "Reply suggestion";
  if (kind === "quote") return "Quote post";
  return "Standalone post";
}

function accountForItem(accounts: SocialsAccountView[], item: SocialQueueItem): SocialsAccountView | null {
  return accounts.find((account) => account.id === item.accountId) ?? null;
}

function platformGlyph(platform: SocialQueueItem["platform"]): string {
  if (platform === "x") return "𝕏";
  if (platform === "telegram") return "TG";
  if (platform === "farcaster") return "FC";
  if (platform === "linkedin") return "in";
  if (platform === "reddit") return "r/";
  return "fb";
}

function nextSuggestedTime(item: SocialQueueItem): string {
  const suggestion = Date.parse(item.suggestedFor ?? "");
  if (Number.isFinite(suggestion) && suggestion > Date.now()) return new Date(suggestion).toISOString();
  return new Date(Date.now() + 2 * 60 * 60_000).toISOString();
}

export function SocialQueueWorkspace({ onOpenSettings }: { onOpenSettings: () => void }) {
  const desk = useSocialsDesk();
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [skippedIds, setSkippedIds] = useState<string[]>([]);

  const reviewItems = useMemo(() => desk.queueItems.filter((item) => REVIEW_STATES.has(item.state)), [desk.queueItems]);
  const orderedItems = useMemo(() => [...reviewItems].sort((left, right) => {
    const leftSkipped = skippedIds.indexOf(left.id);
    const rightSkipped = skippedIds.indexOf(right.id);
    if (leftSkipped < 0 && rightSkipped < 0) return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (leftSkipped < 0) return -1;
    if (rightSkipped < 0) return 1;
    return leftSkipped - rightSkipped;
  }), [reviewItems, skippedIds]);
  const filteredItems = useMemo(
    () => orderedItems.filter((item) => filter === "all" || itemKind(item) === filter),
    [filter, orderedItems],
  );
  const focus = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;
  const focusIndex = focus ? filteredItems.findIndex((item) => item.id === focus.id) : -1;

  const selectOffset = (offset: number) => {
    if (!filteredItems.length) return;
    const current = Math.max(0, focusIndex);
    setSelectedId(filteredItems[(current + offset + filteredItems.length) % filteredItems.length].id);
  };

  const skipFocus = () => {
    if (!focus || filteredItems.length < 2) return;
    setSkippedIds((current) => [...current.filter((id) => id !== focus.id), focus.id]);
    const next = filteredItems[(focusIndex + 1) % filteredItems.length];
    setSelectedId(next.id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        selectOffset(1);
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        selectOffset(-1);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        skipFocus();
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>("[data-social-focus-editor]")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const scheduled = desk.queueItems.filter((item) => SCHEDULED_STATES.has(item.state)).length;
  const publishedToday = desk.queueItems.filter((item) => {
    if (item.state !== "posted") return false;
    const posted = new Date(item.result?.postedAt ?? item.updatedAt ?? item.createdAt);
    const today = new Date();
    return posted.toDateString() === today.toDateString();
  }).length;
  const issues = desk.queueItems.filter((item) => item.state === "failed").length
    + desk.accounts.filter((account) => !account.probe.ok).length;

  return (
    <section className="sc-review-route" data-testid="social-queue-workspace">
      <div className="sc-review-stats">
        <ReviewStat label="Needs review" value={reviewItems.length} tone="honey" note="Agent and saved drafts" />
        <ReviewStat label="Scheduled" value={scheduled} tone="live" note="Approved and waiting" />
        <ReviewStat label="Published today" value={publishedToday} tone="live" note="Confirmed provider sends" />
        <ReviewStat label="Needs attention" value={issues} tone={issues ? "danger" : "muted"} note="Failed sends or connections" />
      </div>

      <div className="sc-review-grid">
        <div className="sc-review-main">
          <div className="sc-review-toolbar">
            <div className="sc-filter-tabs" role="tablist" aria-label="Review queue filters">
              {(["all", "post", "reply", "quote"] as const).map((candidate) => {
                const count = orderedItems.filter((item) => candidate === "all" || itemKind(item) === candidate).length;
                return (
                  <button key={candidate} type="button" role="tab" aria-selected={filter === candidate} data-active={filter === candidate} onClick={() => setFilter(candidate)}>
                    {REVIEW_FILTER_LABELS[candidate]} <span>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="sc-key-hints"><span>↑↓</span> move <span>E</span> edit <span>X</span> skip</div>
          </div>

          {desk.queueLoading ? <div className="sc-queue-loading"><SocialsSpinner /> Refreshing the queue</div> : null}
          {!focus && !desk.queueLoading ? <QueueClearState /> : null}
          {focus ? (
            <ReviewFocusCard
              key={focus.id}
              item={focus}
              account={accountForItem(desk.accounts, focus)}
              position={focusIndex + 1}
              total={filteredItems.length}
              onSkip={skipFocus}
            />
          ) : null}

          {filteredItems.length > 0 ? (
            <div className="sc-review-order">
              <div className="sc-review-order-head">
                <span>Review queue</span>
                <div>
                  <button type="button" aria-label="Previous draft" onClick={() => selectOffset(-1)}><ChevronLeft width={15} /></button>
                  <strong>{focusIndex + 1} of {filteredItems.length}</strong>
                  <button type="button" aria-label="Next draft" onClick={() => selectOffset(1)}><ChevronRight width={15} /></button>
                </div>
              </div>
              <div className="sc-review-order-list">
                {filteredItems.map((item, index) => {
                  const account = accountForItem(desk.accounts, item);
                  return (
                    <button key={item.id} type="button" data-active={focus?.id === item.id} onClick={() => setSelectedId(item.id)}>
                      <span className="sc-review-order-number">{index + 1}</span>
                      <span className="sc-kind-pill" data-kind={itemKind(item)}>{itemKind(item)}</span>
                      <span className="sc-review-order-handle">@{account?.handle ?? item.accountId}</span>
                      <span className="sc-review-order-copy">{item.text}</span>
                      {focus?.id === item.id ? <span className="sc-reviewing-pill">Reviewing</span> : <ChevronRight width={15} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="sc-review-side">
          <SocialComposer />
          <AutomationPanel onOpenSettings={onOpenSettings} />
          <ActivityPanel />
        </aside>
      </div>
    </section>
  );
}

function ReviewStat({ label, value, tone, note }: { label: string; value: number; tone: string; note: string }) {
  return (
    <article className="sc-review-stat" data-tone={tone}>
      <div><span>{label}</span><i aria-hidden="true" /></div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function QueueClearState() {
  const desk = useSocialsDesk();
  const account = desk.activeAccount;
  return (
    <div className="sc-review-clear">
      <span><Check width={22} /></span>
      <div><strong>Review queue clear</strong><p>Everything drafted has been approved, published, or discarded.</p></div>
      <div>
        <button type="button" className="sc-btn sc-connect-primary" disabled={!account || Boolean(desk.queueBusy)} onClick={() => account && void desk.queueAction({ action: "generate-drafts", accountId: account.id })}>
          <Sparkles width={14} /> Generate full pack
        </button>
        <button type="button" className="sc-btn" disabled={!account || Boolean(desk.queueBusy)} onClick={() => account && void desk.queueAction({ action: "generate-engagement", accountId: account.id })}>
          Find replies now
        </button>
      </div>
    </div>
  );
}

function ReviewFocusCard({ item, account, position, total, onSkip }: {
  item: SocialQueueItem;
  account: SocialsAccountView | null;
  position: number;
  total: number;
  onSkip: () => void;
}) {
  const desk = useSocialsDesk();
  const [text, setText] = useState(item.text);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(isoToLocalInput(nextSuggestedTime(item)));
  const dirty = text.trim() !== item.text;
  const busy = desk.queueBusy === item.id;
  const score = Math.round(item.generation?.relevanceScore ?? 0);
  const kind = itemKind(item);
  const target = item.generation?.target;
  const deliveryReady = Boolean(account?.probe.ok);
  const deliveryBlocker = account && !account.probe.ok
    ? account.probe.detail || `Reconnect @${account.handle} before approving delivery.`
    : "";
  const contextLabels = (item.generation?.contextSourceIds ?? []).map((id) => account?.contextSources.find((source) => source.id === id)?.ref ?? id);

  const save = async () => {
    const result = await desk.queueAction({ action: "update", id: item.id, text, title: item.title, subreddit: item.subreddit, replyTo: item.replyTo, quoteOf: item.quoteOf });
    if (result.ok && result.item) setText(result.item.text);
  };
  const schedule = async (at: string) => {
    if (!deliveryReady) return;
    if (dirty) {
      const saved = await desk.queueAction({ action: "update", id: item.id, text, title: item.title, subreddit: item.subreddit, replyTo: item.replyTo, quoteOf: item.quoteOf });
      if (!saved.ok) return;
    }
    await desk.queueAction({ action: "schedule", id: item.id, scheduledFor: at });
  };
  const sendNow = async () => {
    if (!account || !account.probe.ok) return;
    const description = kind === "reply"
      ? `Publish this reply${target ? ` to @${target.authorHandle}` : ""} as @${account.handle} now?`
      : kind === "quote"
        ? `This is not a reply or comment. Publish this standalone quote post on @${account.handle}'s profile now?`
        : `Publish this ${item.platform} post as @${account.handle} now?`;
    if (!await confirmUserAction(description)) return;
    if (dirty) {
      const saved = await desk.queueAction({ action: "update", id: item.id, text, title: item.title, subreddit: item.subreddit, replyTo: item.replyTo, quoteOf: item.quoteOf });
      if (!saved.ok) return;
    }
    await desk.queueAction({ action: "send-now", id: item.id });
  };

  return (
    <article className="sc-focus-card" data-kind={kind}>
      <div className="sc-focus-sheen" aria-hidden="true" />
      <header>
        <div>
          <span className="sc-focus-position">{String(position).padStart(2, "0")}</span>
          <span className="sc-kind-pill" data-kind={kind}>{itemKindLabel(item)}</span>
          <span>for <strong>@{account?.handle ?? item.accountId}</strong></span>
          <span className="sc-mono">{formatRelative(item.generation?.generatedAt ?? item.createdAt)}</span>
        </div>
        {score > 0 ? (
          <div className="sc-relevance">
            <span style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><i>{score}</i></span>
            <em>relevance to this account</em>
          </div>
        ) : <span className="sc-mono">{position} / {total}</span>}
      </header>

      <div className="sc-focus-platform-row">
        <span><i>{platformGlyph(item.platform)}</i>{item.platform === "x" ? "X" : item.platform[0].toUpperCase() + item.platform.slice(1)}</span>
        <span className="sc-mono">{text.length} characters</span>
      </div>

      <div className="sc-platform-preview">
        {target ? <EngagementTargetPreview item={item} /> : (
          <div className="sc-account-preview">
            <span>{platformGlyph(item.platform)}</span>
            <strong>@{account?.handle ?? item.accountId}</strong>
            {account?.displayName ? <em>{account.displayName}</em> : null}
          </div>
        )}
        {item.title ? <strong className="sc-focus-title">{item.title}</strong> : null}
        <label className="sc-focus-editor">
          <span>Draft</span>
          <textarea data-social-focus-editor value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      </div>

      <div className="sc-provenance-pills">
        {account?.soulPath ? <span>voice · {account.soulPath}</span> : <span>generic account voice</span>}
        {contextLabels.map((label) => <span key={label}>grounded in · {label}</span>)}
        {item.generation?.rationale ? <span>{item.generation.rationale}</span> : null}
      </div>

      {item.failure ? <div className="sc-route-error">{item.failure.error}</div> : null}
      {deliveryBlocker ? <div className="sc-route-error" role="status">Connection needs attention: {deliveryBlocker}</div> : null}
      <footer>
        <div className="sc-focus-primary-actions">
          {dirty ? <button type="button" className="sc-btn" disabled={!text.trim() || busy} onClick={() => void save()}><Check width={14} /> Save changes</button> : null}
          <button type="button" className="sc-btn sc-connect-primary" disabled={!deliveryReady || !text.trim() || busy} onClick={() => void schedule(nextSuggestedTime(item))}>
            {busy ? <SocialsSpinner /> : <Check width={15} />} Approve &amp; schedule
          </button>
          <button type="button" className="sc-btn" disabled={!deliveryReady || !text.trim() || busy} onClick={() => void sendNow()}><Send width={15} /> Post now</button>
          <div className="sc-schedule-popover-wrap">
            <button type="button" className="sc-btn" disabled={!deliveryReady || busy} onClick={() => setScheduleOpen((open) => !open)}><Clock3 width={15} /> Pick a time</button>
            {scheduleOpen ? (
              <div className="sc-schedule-popover">
                <label>Schedule date and time<input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></label>
                <button type="button" className="sc-btn sc-connect-primary" disabled={!localInputToIso(scheduleAt)} onClick={() => {
                  const iso = localInputToIso(scheduleAt);
                  if (iso) void schedule(iso);
                }}>Schedule</button>
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <button type="button" className="sc-btn" disabled={total < 2} onClick={onSkip}>Skip</button>
          <button type="button" className="sc-btn" data-tone="danger" disabled={busy} onClick={() => void confirmUserAction("Discard this draft from the review queue?").then((confirmed) => {
            if (confirmed) void desk.queueAction({ action: "cancel", id: item.id });
          })}>
            <Trash2 width={14} /> Discard
          </button>
        </div>
      </footer>
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
        <div><strong>@{target.authorHandle}</strong>{target.authorName ? <span>{target.authorName}</span> : null}<span>· {formatDate(target.createdAt)}</span></div>
        <a className="sc-link-btn" href={target.url} target="_blank" rel="noreferrer">Open target <ExternalLink width={12} /></a>
      </div>
      <div className="sc-engagement-target-text">{target.text}</div>
      <div className="sc-engagement-target-meta"><span>{metrics.join(" · ")}</span><span>Found via {target.source === "timeline" ? "followed account" : `search${target.sourceQuery ? `: ${target.sourceQuery}` : ""}`}</span></div>
    </div>
  );
}

function SocialComposer() {
  const desk = useSocialsDesk();
  const account = desk.activeAccount;
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [subreddit, setSubreddit] = useState(account?.binding?.defaultSubreddit ?? "");
  const [replyTo, setReplyTo] = useState("");
  const [quoteOf, setQuoteOf] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const canCompose = Boolean(account && account.capabilities.post !== "unsupported");
  const canDeliver = Boolean(canCompose && account?.probe.ok);

  const reset = () => {
    setText(""); setTitle(""); setReplyTo(""); setQuoteOf(""); setScheduleAt("");
  };
  const create = async (intent: ComposerIntent) => {
    if (!account) return;
    if (intent !== "draft" && !account.probe.ok) return;
    if (intent === "send" && !await confirmUserAction(`Publish this ${account.platform} post as @${account.handle} now?`)) return;
    const scheduledFor = intent === "schedule" ? localInputToIso(scheduleAt) : null;
    if (intent === "schedule" && !scheduledFor) return;
    const created = await desk.queueAction({ action: "create", accountId: account.id, text, ...(title ? { title } : {}), ...(subreddit ? { subreddit } : {}), ...(replyTo ? { replyTo } : {}), ...(quoteOf ? { quoteOf } : {}) });
    if (!created.ok || !created.item) return;
    const action = intent === "send"
      ? await desk.queueAction({ action: "send-now", id: created.item.id })
      : intent === "schedule"
        ? await desk.queueAction({ action: "schedule", id: created.item.id, scheduledFor })
        : { ok: true };
    if (!action.ok) return;
    reset();
  };

  return (
    <section className="sc-side-card sc-composer-card" data-testid="social-queue-composer">
      <div className="sc-side-card-head"><div><strong>Write</strong><span>{account ? `New post for @${account.handle}` : "Select an account"}</span></div><span className="sc-mono">{text.length}</span></div>
      {account?.platform === "reddit" && !replyTo ? <div className="sc-inline-fields"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reddit post title" /><input value={subreddit} onChange={(event) => setSubreddit(event.target.value)} placeholder="Subreddit" /></div> : null}
      <textarea value={text} onChange={(event) => setText(event.target.value)} disabled={!canCompose} placeholder={canCompose ? "Write a post or save an idea for review." : "Posting is unavailable for this account."} />
      {account && !account.probe.ok ? <div className="sc-route-error" role="status">Reconnect @{account.handle} before scheduling or publishing. You can still save a draft. {account.probe.detail}</div> : null}
      {(account?.capabilities.reply !== "unsupported" || account?.capabilities.quote !== "unsupported") ? <button type="button" className="sc-link-btn" onClick={() => setAdvanced((open) => !open)}>{advanced ? "Hide reply and quote options" : "+ Reply or quote a post"}</button> : null}
      {advanced ? <div className="sc-inline-fields"><input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Reply-to post ID" /><input value={quoteOf} onChange={(event) => setQuoteOf(event.target.value)} placeholder="Quote target post ID" /></div> : null}
      <div className="sc-composer-card-actions">
        <button type="button" className="sc-btn" disabled={!canCompose || !text.trim() || Boolean(desk.queueBusy)} onClick={() => void create("draft")}>Save draft</button>
        <button type="button" className="sc-btn" disabled={!canDeliver || !text.trim() || Boolean(desk.queueBusy)} onClick={() => setScheduleAt((current) => current || isoToLocalInput(new Date(Date.now() + 2 * 60 * 60_000).toISOString()))}><CalendarClock width={14} /> Schedule</button>
        <button type="button" className="sc-btn sc-connect-primary" disabled={!canDeliver || !text.trim() || Boolean(desk.queueBusy)} onClick={() => void create("send")}><Send width={14} /> Post now</button>
      </div>
      {scheduleAt ? <div className="sc-composer-schedule"><input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /><button type="button" className="sc-btn sc-connect-primary" disabled={!localInputToIso(scheduleAt)} onClick={() => void create("schedule")}>Confirm schedule</button><button type="button" className="sc-btn" aria-label="Close schedule" onClick={() => setScheduleAt("")}><X width={14} /></button></div> : null}
    </section>
  );
}

function AutomationPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const desk = useSocialsDesk();
  const account = desk.activeAccount;
  const standaloneReady = account ? socialAccountHasStandaloneGroundingSource(account) : false;
  const findingReady = account?.platform === "x" && desk.xDiscovery?.authenticated === true;
  const busy = Boolean(desk.queueBusy);
  return (
    <section className="sc-side-card" data-testid="social-drafting-automation">
      <div className="sc-side-card-head"><div><strong>Agent work</strong><span>Review-only drafting</span></div><button type="button" className="sc-icon-btn" aria-label="Open automation settings" onClick={onOpenSettings}><Settings2 width={14} /></button></div>
      <div className="sc-agent-toggle-row">
        <div><Sparkles width={14} /><span><strong>Agent drafting</strong><em>{account?.drafting.enabled ? "On" : "Paused"}</em></span></div>
        <button type="button" className="sc-switch" role="switch" aria-checked={account?.drafting.enabled ?? false} disabled={!account || busy} onClick={() => account && void desk.setDraftingPolicy(account.id, { enabled: !account.drafting.enabled })}><span /></button>
      </div>
      <div className="sc-agent-toggle-row" data-testid="social-engagement-discovery">
        <div><MessageCircle width={14} /><span><strong>Comment finder</strong><em>{account?.drafting.engagementEnabled ? "On" : "Paused"}</em></span></div>
        <button type="button" className="sc-switch" data-tone="live" role="switch" aria-checked={account?.drafting.engagementEnabled ?? false} disabled={!account || account.platform !== "x" || busy} onClick={() => account && void desk.setDraftingPolicy(account.id, { engagementEnabled: !account.drafting.engagementEnabled })}><span /></button>
      </div>
      <div className="sc-agent-actions">
        <button type="button" className="sc-btn" disabled={!account || !standaloneReady || busy} onClick={() => account && void desk.queueAction({ action: "generate-drafts", accountId: account.id })}>{desk.queueBusy === "generate-drafts" ? <SocialsSpinner /> : <Sparkles width={13} />} Generate full pack</button>
        <button type="button" className="sc-btn" disabled={!account || !findingReady || !account.drafting.engagementEnabled || busy} onClick={() => account && void desk.queueAction({ action: "generate-engagement", accountId: account.id })}>{desk.queueBusy === "generate-engagement" ? <SocialsSpinner /> : <RefreshCw width={13} />} Find replies now</button>
      </div>
      {!standaloneReady && account ? <p>Add context first to ground standalone posts in account-specific facts.</p> : null}
      {account?.platform === "x" && desk.xDiscovery ? <p>{desk.xDiscovery.detail}</p> : null}
    </section>
  );
}

function ActivityPanel() {
  const desk = useSocialsDesk();
  const activity = [...desk.queueItems]
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt))
    .slice(0, 5);
  return (
    <section className="sc-side-card">
      <div className="sc-side-card-head"><div><strong>Activity</strong><span>Latest durable queue events</span></div></div>
      <div className="sc-activity-list">
        {activity.length ? activity.map((item) => {
          const account = accountForItem(desk.accounts, item);
          return <div key={item.id}><i data-tone={item.state === "failed" ? "danger" : item.state === "posted" ? "live" : "honey"} /><span><strong>{itemKindLabel(item)} · @{account?.handle ?? item.accountId}</strong><em>{item.state} · {formatRelative(item.updatedAt ?? item.createdAt)}</em></span></div>;
        }) : <p>No queue activity yet.</p>}
      </div>
      <div className="sc-worker-controls">
        <button type="button" className="sc-btn" disabled={Boolean(desk.queueBusy) || desk.engine.disabled} onClick={() => void desk.queueAction({ action: desk.engine.enabled ? "pause-engine" : "resume-engine" })}>{desk.engine.enabled ? <Pause width={13} /> : <Play width={13} />}{desk.engine.enabled ? "Pause" : "Resume"}</button>
        <button type="button" className="sc-btn" disabled={Boolean(desk.queueBusy) || !desk.engine.enabled} onClick={() => void desk.queueAction({ action: "tick" })}>{desk.queueBusy === "tick" ? <SocialsSpinner /> : <RefreshCw width={13} />} Process queue</button>
      </div>
    </section>
  );
}
