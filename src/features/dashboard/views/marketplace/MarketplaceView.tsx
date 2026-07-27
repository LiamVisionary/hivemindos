"use client";

import { Plus, RefreshCcw, Store } from "lucide-react";

import { CatalogGrid } from "./CatalogGrid";
import { ConnectFacebookModal } from "./ConnectFacebookModal";
import { DecisionsPanel, DecisionsStrip } from "./DecisionsPanel";
import { ListingModal } from "./ListingModal";
import { MonitoringSettingsCard } from "./MonitoringSettingsCard";
import { useMarketplaceDesk, type MarketplaceTab } from "./marketplace-context";
import { LoadingBar, Panel, Skeleton, SkeletonText, Spinner, ghostButtonStyle, primaryButtonStyle } from "./primitives";

const TABS: Array<{ id: MarketplaceTab; label: string }> = [
  { id: "catalog", label: "Catalog" },
  { id: "decisions", label: "Decisions" },
  { id: "settings", label: "Settings" },
];

function LoadingState() {
  return (
    <div role="status" aria-label="Loading marketplace" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <LoadingBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Panel key={i} pad={16}>
            <Skeleton height={120} radius={10} />
            <div style={{ height: 12 }} />
            <SkeletonText lines={2} />
          </Panel>
        ))}
      </div>
    </div>
  );
}

function ConnectHero() {
  const desk = useMarketplaceDesk();
  const facebook = desk.providers.find((provider) => provider.provider === "facebook");
  return (
    <Panel pad="46px 40px" style={{ maxWidth: 620, margin: "48px auto", textAlign: "center" }}>
      <div style={{ display: "grid", placeItems: "center", marginBottom: 18 }}>
        <span style={{ display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: 16, background: "var(--honey-soft)", border: "1px solid var(--honey-line)", color: "var(--honey)" }}>
          <Store aria-hidden width={26} height={26} strokeWidth={1.6} />
        </span>
      </div>
      <h2 style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, margin: "0 0 10px" }}>Sell with an agent on your side</h2>
      <p style={{ color: "var(--fg-2)", fontSize: 13.5, lineHeight: 1.6, margin: "0 auto 22px", maxWidth: 460 }}>
        Connect {facebook?.label ?? "Facebook Marketplace"}, describe what you are selling, and the hive lists it, researches the right
        price, watches your messages, and only interrupts you for decisions that matter.
      </p>
      <button type="button" style={primaryButtonStyle()} onClick={() => desk.setConnectOpen(true)}>
        <Plus aria-hidden width={15} height={15} />
        Connect {facebook?.label ?? "Facebook Marketplace"}
      </button>
      {facebook?.methods[0]?.notes ? (
        <p style={{ color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.55, margin: "18px auto 0", maxWidth: 460 }}>{facebook.methods[0].notes}</p>
      ) : null}
    </Panel>
  );
}

function ErrorState({ message }: { message: string }) {
  const desk = useMarketplaceDesk();
  return (
    <Panel pad="26px 28px" style={{ maxWidth: 560, margin: "42px auto", textAlign: "center", borderColor: "color-mix(in srgb, var(--danger) 34%, transparent)" }}>
      <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 6px", fontWeight: 600 }}>Marketplace is unavailable</p>
      <p style={{ color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.6, margin: "0 0 18px" }}>{message}</p>
      <button type="button" style={ghostButtonStyle()} onClick={() => void desk.refresh()}>
        <RefreshCcw aria-hidden width={13} height={13} />
        Try again
      </button>
    </Panel>
  );
}

export function MarketplaceView() {
  const desk = useMarketplaceDesk();
  const pendingDecisions = desk.decisions.filter((decision) => decision.status === "pending");

  return (
    <div className="mkt-root" data-theme={desk.theme} style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 26px 60px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
          <h1 style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>Marketplace</h1>
          {desk.refreshing ? <Spinner size={13} style={{ color: "var(--fg-3)" }} /> : null}
          <span style={{ flex: 1 }} />
          {desk.accounts.length > 0 ? (
            <>
              {desk.accounts.length > 1 ? (
                <div style={{ display: "flex", gap: 6 }}>
                  {desk.accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => desk.selectAccount(account.id)}
                      style={{
                        ...ghostButtonStyle(),
                        ...(account.id === desk.activeAccountId
                          ? { borderColor: "var(--honey-line)", background: "var(--honey-soft)", color: "var(--honey)" }
                          : {}),
                      }}
                    >
                      {account.displayName ?? account.id}
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" style={primaryButtonStyle()} onClick={() => desk.openListingModal()}>
                <Plus aria-hidden width={15} height={15} />
                New listing
              </button>
            </>
          ) : null}
        </div>

        {desk.loading ? (
          <LoadingState />
        ) : desk.error && desk.accounts.length === 0 ? (
          <ErrorState message={desk.error} />
        ) : desk.accounts.length === 0 ? (
          <ConnectHero />
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 22 }}>
              {TABS.map((tab) => {
                const active = desk.activeTab === tab.id;
                const badge = tab.id === "decisions" && pendingDecisions.length > 0 ? pendingDecisions.length : null;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => desk.selectTab(tab.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "10px 14px", background: "transparent", border: "none",
                      borderBottom: active ? "2px solid var(--honey)" : "2px solid transparent",
                      color: active ? "var(--fg)" : "var(--fg-3)",
                      fontSize: 13.5, fontWeight: active ? 600 : 500, fontFamily: "var(--f-body)", cursor: "pointer",
                    }}
                  >
                    {tab.label}
                    {badge ? (
                      <span style={{
                        minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
                        display: "inline-grid", placeItems: "center",
                        background: "var(--honey)", color: "var(--btn-fg)",
                        fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700,
                      }}>{badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <DecisionsStrip />
            {desk.activeTab === "catalog" ? <CatalogSection /> : null}
            {desk.activeTab === "decisions" ? <DecisionsPanel /> : null}
            {desk.activeTab === "settings" ? <SettingsSection /> : null}
          </>
        )}
      </div>
      <ConnectFacebookModal />
      <ListingModal />
    </div>
  );
}

function CatalogSection() {
  return <CatalogGrid />;
}

function SettingsSection() {
  return <MonitoringSettingsCard />;
}
