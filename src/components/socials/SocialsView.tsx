"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Share2 } from "lucide-react";

import "./socials.css";

import { ConnectAccountModal } from "@/components/socials/ConnectAccountModal";
import { SocialAnalyticsDashboard } from "@/components/socials/SocialAnalyticsDashboard";
import { SocialQueueWorkspace } from "@/components/socials/SocialQueueWorkspace";
import { SocialScheduleBoard } from "@/components/socials/SocialScheduleBoard";
import { SocialSettingsWorkspace } from "@/components/socials/SocialSettingsWorkspace";
import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsDeskSkeleton, SocialsSpinner } from "@/components/socials/skeletons";

type SocialsRouteTab = "review" | "scheduled" | "analytics" | "settings";

const ROUTE_TABS: Array<{ id: SocialsRouteTab; label: string }> = [
  { id: "review", label: "Review" },
  { id: "scheduled", label: "Scheduled" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];

function platformGlyph(account: SocialsAccountView): string {
  if (account.platform === "x") return "𝕏";
  if (account.platform === "telegram") return "TG";
  if (account.platform === "farcaster") return "FC";
  if (account.platform === "linkedin") return "in";
  if (account.platform === "reddit") return "r/";
  return "fb";
}

function workerAge(lastWakeAt?: string, lastTickAt?: string): string {
  const timestamp = Date.parse(lastWakeAt ?? lastTickAt ?? "");
  if (!Number.isFinite(timestamp)) return "starting";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `tick ${seconds}s`;
  if (seconds < 3_600) return `tick ${Math.floor(seconds / 60)}m`;
  return `tick ${Math.floor(seconds / 3_600)}h`;
}

/** The complete Socials command center, adapted from the supplied four-screen redesign. */
export function SocialsView() {
  const desk = useSocialsDesk();
  const [tab, setTab] = useState<SocialsRouteTab>("review");
  const [, setClock] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const reviewCount = useMemo(
    () => desk.queueItems.filter((item) => ["draft", "suggested", "failed"].includes(item.state)).length,
    [desk.queueItems],
  );
  const scheduledCount = useMemo(
    () => desk.queueItems.filter((item) => ["approved", "scheduled", "posting"].includes(item.state)).length,
    [desk.queueItems],
  );

  const routeCount = (route: SocialsRouteTab) => {
    if (route === "review") return reviewCount;
    if (route === "scheduled") return scheduledCount;
    return 0;
  };

  const workerTone = !desk.engine.enabled || desk.engine.disabled
    ? "off"
    : desk.engine.running || desk.engine.leaseHeld
      ? "live"
      : "warn";
  const workerLabel = workerTone === "live" ? "Worker live" : workerTone === "warn" ? "Worker waiting" : "Worker paused";

  return (
    <div className="fr-root sc-shell" data-fr-theme={desk.theme === "light" ? "light" : undefined}>
      {desk.loading ? (
        <div className="sc-route-scroll"><SocialsDeskSkeleton /></div>
      ) : desk.accounts.length === 0 ? (
        <SocialsEmptyState onConnect={() => desk.setConnectOpen(true)} />
      ) : (
        <>
          <header className="sc-route-header">
            <div className="sc-route-heading-row">
              <div className="sc-route-heading">
                <h1>Socials</h1>
                <p>Find conversations, draft, review, publish, measure — posting stays approval-gated.</p>
              </div>
              <div className="sc-route-actions">
                <div className="sc-worker-pill" data-tone={workerTone} data-testid="social-queue-engine-status">
                  <span className="sc-worker-dot" aria-hidden="true" />
                  <strong>{workerLabel}</strong>
                  <span>{workerAge(desk.engine.lastWakeAt, desk.engine.lastTickAt)}</span>
                </div>
                <button type="button" className="sc-btn sc-refresh-btn" onClick={() => void desk.refresh()} disabled={desk.refreshing}>
                  {desk.refreshing ? <SocialsSpinner /> : <RefreshCw aria-hidden="true" width={15} />} Refresh
                </button>
                <button type="button" className="sc-btn sc-connect-primary" onClick={() => desk.setConnectOpen(true)}>
                  <Plus aria-hidden="true" width={16} /> Connect account
                </button>
              </div>
            </div>

            <div className="sc-account-strip" role="list" aria-label="Social account scope">
              <button
                type="button"
                className="sc-account-chip sc-acct"
                data-active={desk.allAccountsSelected}
                onClick={desk.selectAllAccounts}
              >
                <span className="sc-account-glyph">All</span>
                <span>All accounts</span>
                <span className="sc-account-count">{Object.values(desk.queueCounts).reduce((total, count) => total + count, 0)}</span>
              </button>
              {desk.accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="sc-account-chip sc-acct"
                  data-active={!desk.allAccountsSelected && desk.activeAccountId === account.id}
                  onClick={() => desk.selectAccount(account.id)}
                >
                  <span className="sc-account-glyph">{platformGlyph(account)}</span>
                  <span>@{account.handle}</span>
                  <span className="sc-account-status" data-tone={account.probe.ok ? "live" : "warn"} aria-label={account.probe.ok ? "Connected" : "Needs attention"} />
                  <span className="sc-account-count">{desk.queueCounts[account.id] ?? 0}</span>
                </button>
              ))}
            </div>

            <nav className="sc-route-tabs" aria-label="Socials sections">
              {ROUTE_TABS.map((route) => {
                const count = routeCount(route.id);
                return (
                  <button
                    key={route.id}
                    type="button"
                    aria-current={tab === route.id ? "page" : undefined}
                    data-active={tab === route.id}
                    onClick={() => setTab(route.id)}
                  >
                    {route.label}{count > 0 ? <span>{count}</span> : null}
                  </button>
                );
              })}
            </nav>
          </header>

          <div className="sc-route-scroll">
            {desk.error ? <div className="sc-route-error" role="alert">{desk.error}</div> : null}
            {tab === "review" ? <SocialQueueWorkspace key={desk.allAccountsSelected ? "all" : desk.activeAccountId} onOpenSettings={() => setTab("settings")} /> : null}
            {tab === "scheduled" ? <SocialScheduleBoard /> : null}
            {tab === "analytics" ? <SocialAnalyticsDashboard /> : null}
            {tab === "settings" ? <SocialSettingsWorkspace /> : null}
          </div>
        </>
      )}
      <ConnectAccountModal />
    </div>
  );
}

function SocialsEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="sc-empty-route">
      <div className="sc-empty-glow" aria-hidden="true" />
      <div className="sc-empty-content">
        <div className="sc-empty-mark"><Share2 aria-hidden="true" width={52} /></div>
        <div>
          <h1>One desk for every account your agents write for</h1>
          <p>Connect X, Telegram, Farcaster, LinkedIn, Reddit, or Facebook. Each account keeps its own voice, awake hours, drafting context, review queue, and analytics — and nothing publishes until you approve it.</p>
        </div>
        <button type="button" className="sc-btn sc-connect-primary" onClick={onConnect}>
          <Plus aria-hidden="true" width={17} /> Connect your first account
        </button>
        <div className="sc-empty-steps">
          <EmptyStep number="01" title="Connect an account" copy="Use a browser profile, OAuth, API credentials, or the platform's available rail." />
          <EmptyStep number="02" title="Give it a voice and facts" copy="Bind a soul file and the repos, sites, or folders drafts may draw from." />
          <EmptyStep number="03" title="Review, then publish" copy="Drafts and reply suggestions land in one queue. You decide what goes live." />
        </div>
      </div>
    </section>
  );
}

function EmptyStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <article>
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{copy}</p>
    </article>
  );
}
