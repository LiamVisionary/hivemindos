"use client";

import { RefreshCw, Trash2 } from "lucide-react";

import "./socials.css";

import { AccountRail } from "@/components/socials/AccountRail";
import { AwakeHoursCard } from "@/components/socials/AwakeHoursCard";
import { ConnectAccountModal } from "@/components/socials/ConnectAccountModal";
import { ContextSourcesCard } from "@/components/socials/ContextSourcesCard";
import { useSocialsDesk } from "@/components/socials/socials-context";
import { SocialsDeskSkeleton, SocialsSpinner } from "@/components/socials/skeletons";
import { VoiceCard } from "@/components/socials/VoiceCard";
import { SOCIAL_CAPABILITIES } from "@/lib/services/socials/socials-types";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

/** Pure presentational Socials desk (Trade triad pattern; data via useSocialsDesk). */
export function SocialsView() {
  const desk = useSocialsDesk();

  return (
    <div className="fr-root" data-fr-theme={desk.theme === "light" ? "light" : undefined} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="fr-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {desk.loading ? (
          <SocialsDeskSkeleton />
        ) : (
          <div className="sc-wrap">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--fg)" }}>Socials</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                  Accounts, posting voice, awake hours, and drafting context. Posting queue, history, and analytics arrive in the next phases — nothing posts without your say-so, ever.
                </div>
              </div>
              <button type="button" className="sc-btn" onClick={() => void desk.refresh()} disabled={desk.refreshing}>
                {desk.refreshing ? <SocialsSpinner /> : <RefreshCw aria-hidden="true" width={14} height={14} />} Refresh
              </button>
            </div>

            {desk.error ? <div className="sc-error">{desk.error}</div> : null}

            <div className="sc-body">
              <AccountRail />
              <div className="sc-col">
                {desk.activeAccount ? (
                  <>
                    <section className="sc-card">
                      <div className="sc-card-head">
                        <span className="sc-card-title">
                          @{desk.activeAccount.handle}
                          {desk.activeAccount.displayName ? ` · ${desk.activeAccount.displayName}` : ""}
                        </span>
                        <span className="sc-mode-badge">
                          {desk.activeAccount.postingMode === "auto" ? "auto posting (opted in)" : "manual posting"}
                        </span>
                      </div>
                      <div className="sc-probe">
                        <span className="sc-dot" data-tone={desk.activeAccount.probe.ok ? "live" : "warn"} style={{ marginLeft: 0, marginTop: 5 }} aria-hidden="true" />
                        <span>{desk.activeAccount.probe.detail}</span>
                      </div>
                      <div className="sc-pills" style={{ marginTop: 10 }}>
                        {SOCIAL_CAPABILITIES.map((capability) => (
                          <span key={capability} className="sc-pill" data-support={desk.activeAccount!.capabilities[capability]}>
                            {capability}: {desk.activeAccount!.capabilities[capability]}
                          </span>
                        ))}
                      </div>
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="sc-btn"
                          data-tone="danger"
                          onClick={() => {
                            // In the Tauri shell window.confirm is a Promise — raw truthiness
                            // would fire the delete unconditionally; confirmUserAction awaits it.
                            const account = desk.activeAccount!;
                            void confirmUserAction(`Remove @${account.handle}? Credentials in the shared env are untouched.`).then((confirmed) => {
                              if (confirmed) void desk.deleteAccount(account.id);
                            });
                          }}
                        >
                          <Trash2 aria-hidden="true" width={13} height={13} /> Remove account
                        </button>
                      </div>
                    </section>

                    <VoiceCard account={desk.activeAccount} />
                    <AwakeHoursCard account={desk.activeAccount} />
                    <ContextSourcesCard account={desk.activeAccount} />

                    <section className="sc-card">
                      <div className="sc-card-head">
                        <span className="sc-card-title">Posting queue</span>
                        <span className="sc-card-hint">
                          {desk.queueMeta.lastTickAt ? `Last tick ${desk.queueMeta.lastTickAt}` : "No queue engine running yet"}
                        </span>
                      </div>
                      <div className="sc-note">
                        The queued-post timeline (suggested times, send now, auto-mode with a visible cancel window) lands in Phase 2. Until then all posting stays exactly where it is today: drafts you explicitly approve.
                      </div>
                    </section>
                  </>
                ) : (
                  <section className="sc-card">
                    <div className="sc-card-title" style={{ marginBottom: 6 }}>No accounts connected yet</div>
                    <div className="sc-note">
                      Connect X, Telegram, Farcaster, LinkedIn, or Reddit. Each account gets its own posting voice, awake hours, drafting context, and (soon) queue and analytics.
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <ConnectAccountModal />
    </div>
  );
}
