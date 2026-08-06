"use client";

import { useMemo, useState } from "react";
import { ExternalLink, List, Rows3 } from "lucide-react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import type { SocialQueueItem } from "@/lib/services/socials/socials-types";

type ScheduleView = "week" | "list";

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(0, 0, 0, 0);
  return result;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function itemDate(item: SocialQueueItem): Date | null {
  const date = new Date(item.scheduledFor ?? item.retryAt ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function itemKind(item: SocialQueueItem): string {
  return item.generation?.kind ?? (item.replyTo ? "reply" : item.quoteOf ? "quote" : "post");
}

function accountForItem(accounts: SocialsAccountView[], item: SocialQueueItem): SocialsAccountView | null {
  return accounts.find((account) => account.id === item.accountId) ?? null;
}

function formatDate(value?: string): string {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "—";
}

export function SocialScheduleBoard() {
  const desk = useSocialsDesk();
  const [view, setView] = useState<ScheduleView>("week");
  const [draggedId, setDraggedId] = useState("");
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  }), [weekStart]);
  const scheduled = useMemo(
    () => desk.queueItems.filter((item) => ["approved", "scheduled", "posting"].includes(item.state)).sort((left, right) => Date.parse(left.scheduledFor ?? left.createdAt) - Date.parse(right.scheduledFor ?? right.createdAt)),
    [desk.queueItems],
  );
  const recent = useMemo(
    () => desk.queueItems.filter((item) => ["posted", "failed", "canceled"].includes(item.state)).sort((left, right) => Date.parse(right.updatedAt ?? right.result?.postedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.result?.postedAt ?? left.createdAt)).slice(0, 8),
    [desk.queueItems],
  );

  const moveToDay = async (targetDate: Date) => {
    const item = scheduled.find((candidate) => candidate.id === draggedId);
    const current = item ? itemDate(item) : null;
    if (!item || !current) return;
    const next = new Date(targetDate);
    next.setHours(current.getHours(), current.getMinutes(), 0, 0);
    setDraggedId("");
    await desk.queueAction({ action: "schedule", id: item.id, scheduledFor: next.toISOString() });
  };

  return (
    <section className="sc-scheduled-route">
      <div className="sc-section-heading">
        <div><h2>This week</h2><p>{scheduled.length} scheduled · drag a card to another day to reschedule it at the same local time</p></div>
        <div className="sc-view-toggle">
          <button type="button" data-active={view === "week"} onClick={() => setView("week")}><Rows3 width={14} /> Week</button>
          <button type="button" data-active={view === "list"} onClick={() => setView("list")}><List width={14} /> List</button>
        </div>
      </div>

      {desk.queueLoading ? <div className="sc-queue-loading"><SocialsSpinner /> Refreshing the schedule</div> : null}
      {view === "week" ? (
        <div className="sc-week-grid">
          {week.map((date) => {
            const items = scheduled.filter((item) => {
              const scheduledDate = itemDate(item);
              return scheduledDate ? dateKey(scheduledDate) === dateKey(date) : false;
            });
            const today = dateKey(date) === dateKey(new Date());
            return (
              <div
                key={dateKey(date)}
                className="sc-week-day"
                data-today={today}
                data-drag-over={Boolean(draggedId)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void moveToDay(date)}
              >
                <header><span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span><strong>{date.getDate()}</strong></header>
                <div>
                  {items.map((item) => <ScheduleCard key={item.id} item={item} account={accountForItem(desk.accounts, item)} onDragStart={() => setDraggedId(item.id)} />)}
                  {!items.length ? <span className="sc-week-empty">Open</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sc-schedule-list">
          {scheduled.map((item) => (
            <article key={item.id}>
              <span className="sc-kind-pill" data-kind={itemKind(item)}>{itemKind(item)}</span>
              <div><strong>{item.text}</strong><span>@{accountForItem(desk.accounts, item)?.handle ?? item.accountId} · {formatDate(item.scheduledFor)}</span></div>
              <button type="button" className="sc-btn" data-tone="danger" disabled={desk.queueBusy === item.id} onClick={() => void desk.queueAction({ action: "cancel", id: item.id })}>Cancel</button>
            </article>
          ))}
          {!scheduled.length ? <div className="sc-empty">No approved or scheduled posts in this account scope.</div> : null}
        </div>
      )}

      <section className="sc-recent-card">
        <div className="sc-side-card-head"><div><strong>Recently published</strong><span>Provider-confirmed history and delivery issues</span></div></div>
        <div className="sc-recent-list">
          {recent.map((item) => {
            const metrics = Object.entries(item.result?.metrics ?? {}).map(([key, value]) => `${new Intl.NumberFormat().format(value)} ${key}`).join(" · ");
            return (
              <div key={item.id} className="sc-recent-item">
                <span className="sc-history-state" data-state={item.state}>{item.state}</span>
                <div><strong>{item.text}</strong><span>@{accountForItem(desk.accounts, item)?.handle ?? item.accountId}</span></div>
                <span className="sc-mono">{metrics || (item.failure?.kind === "ambiguous" ? "delivery unknown" : item.failure?.error ?? "—")}</span>
                <span className="sc-mono">{formatDate(item.result?.postedAt ?? item.updatedAt ?? item.createdAt)}</span>
                {item.result?.url ? <a href={item.result.url} target="_blank" rel="noreferrer">Open <ExternalLink width={12} /></a> : null}
              </div>
            );
          })}
          {!recent.length ? <div className="sc-empty">Published, failed, and canceled posts will appear here.</div> : null}
        </div>
      </section>
    </section>
  );
}

function ScheduleCard({ item, account, onDragStart }: { item: SocialQueueItem; account: SocialsAccountView | null; onDragStart: () => void }) {
  const date = itemDate(item);
  return (
    <article className="sc-schedule-card" data-kind={itemKind(item)} draggable onDragStart={onDragStart}>
      <div><strong>{date ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date) : "Waiting"}</strong><i /></div>
      <p>{item.text}</p>
      <span>{itemKind(item)} · @{account?.handle ?? item.accountId}</span>
    </article>
  );
}
