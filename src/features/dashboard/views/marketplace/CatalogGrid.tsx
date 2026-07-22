"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOff, Plus, RefreshCcw } from "lucide-react";

import type { MarketplaceConversation, MarketplaceListing } from "@/lib/services/marketplace/marketplace-types";

import { useMarketplaceDesk } from "./marketplace-context";
import { ListingStatusPill, Panel, Spinner, ghostButtonStyle, primaryButtonStyle } from "./primitives";

/**
 * All catalogued items — agent-created and synced from the user's marketplace
 * account — with status, message activity, and the monitor's next-check
 * countdown. One shared 30s ticker drives every countdown (no per-card timers).
 */

type StatusFilter = "all" | "draft" | "pending-approval" | "active" | "messages" | "ended";

function matchesFilter(listing: MarketplaceListing, unread: number, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return listing.state === "draft" || listing.state === "rejected" || listing.state === "failed";
    case "pending-approval":
      return listing.state === "pending-approval" || listing.state === "approved" || listing.state === "posting";
    case "active":
      return listing.state === "active";
    case "messages":
      return unread > 0;
    case "ended":
      return listing.state === "ended";
  }
}

function unreadCountFor(listing: MarketplaceListing, conversations: MarketplaceConversation[]): number {
  return conversations.filter(
    (conversation) =>
      conversation.state !== "closed" &&
      (conversation.listingRef.listingId === listing.id ||
        (listing.external?.externalId && conversation.listingRef.externalId === listing.external.externalId)) &&
      conversation.lastBuyerMessageAt &&
      (!conversation.lastAgentReplyAt || conversation.lastBuyerMessageAt > conversation.lastAgentReplyAt),
  ).length;
}

function CountdownLabel({ nextPollAt, now }: { nextPollAt?: string; now: number }) {
  if (!nextPollAt) return <span style={{ color: "var(--fg-4)" }}>monitor idle</span>;
  const ms = Date.parse(nextPollAt) - now;
  if (!Number.isFinite(ms)) return <span style={{ color: "var(--fg-4)" }}>monitor idle</span>;
  if (ms <= 0) return <span style={{ color: "var(--live)" }}>checking now</span>;
  const minutes = Math.floor(ms / 60_000);
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : minutes >= 1 ? `${minutes}m` : `${Math.max(1, Math.round(ms / 1000))}s`;
  return <span>next check in {label}</span>;
}

function ListingCard({ listing, unread, now }: { listing: MarketplaceListing; unread: number; now: number }) {
  const desk = useMarketplaceDesk();
  const monitor = desk.monitorStatus[listing.accountId];
  const firstPhoto = listing.photos[0];
  return (
    <button
      type="button"
      onClick={() => desk.openListingModal(listing.id)}
      style={{
        textAlign: "left", display: "flex", flexDirection: "column", gap: 0, padding: 0, cursor: "pointer",
        borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow)",
        overflow: "hidden", color: "var(--fg)", fontFamily: "var(--f-body)",
      }}
    >
      <div style={{ height: 128, background: "var(--panel-2)", display: "grid", placeItems: "center", overflow: "hidden" }}>
        {firstPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo bytes come from the pinned marketplace photo route.
          <img
            src={`/api/marketplace/photo?path=${encodeURIComponent(firstPhoto.vaultPath)}`}
            alt={firstPhoto.alt ?? listing.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
          />
        ) : (
          <ImageOff aria-hidden width={22} height={22} style={{ color: "var(--fg-4)" }} />
        )}
      </div>
      <div style={{ padding: "12px 14px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{listing.title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {listing.priceUsd > 0 ? `$${listing.priceUsd}` : "—"}
          </span>
          <ListingStatusPill state={listing.state} unread={unread} />
          <span style={{
            fontSize: 9.5, fontFamily: "var(--f-mono)", fontWeight: 600, letterSpacing: 0.05, textTransform: "uppercase",
            color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 5px",
          }}>
            {listing.origin === "synced" ? "Synced" : "Agent-created"}
          </span>
        </div>
        {listing.state === "active" ? (
          <span style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {monitor?.accelerated ? <span className="mkt-dot live" style={{ color: "var(--honey)" }} /> : null}
            {monitor?.accelerated ? "watching closely · " : ""}
            <CountdownLabel nextPollAt={monitor?.nextPollAt} now={now} />
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function CatalogGrid() {
  const desk = useMarketplaceDesk();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [syncBusy, setSyncBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const accountListings = useMemo(
    () => desk.listings.filter((listing) => !desk.activeAccountId || listing.accountId === desk.activeAccountId),
    [desk.listings, desk.activeAccountId],
  );
  const unreadByListing = useMemo(() => {
    const map = new Map<string, number>();
    for (const listing of accountListings) map.set(listing.id, unreadCountFor(listing, desk.conversations));
    return map;
  }, [accountListings, desk.conversations]);

  const filters: Array<{ id: StatusFilter; label: string }> = useMemo(() => {
    const count = (id: StatusFilter) => accountListings.filter((listing) => matchesFilter(listing, unreadByListing.get(listing.id) ?? 0, id)).length;
    return [
      { id: "all", label: `All ${accountListings.length}` },
      { id: "draft", label: `Drafts ${count("draft")}` },
      { id: "pending-approval", label: `In review ${count("pending-approval")}` },
      { id: "active", label: `Listed ${count("active")}` },
      { id: "messages", label: `Messages ${count("messages")}` },
      { id: "ended", label: `Ended ${count("ended")}` },
    ];
  }, [accountListings, unreadByListing]);

  const visible = accountListings.filter((listing) => matchesFilter(listing, unreadByListing.get(listing.id) ?? 0, filter));

  const syncNow = async () => {
    if (!desk.activeAccountId) return;
    setSyncBusy(true);
    try {
      await desk.runListingsAction({ action: "sync-catalog", accountId: desk.activeAccountId });
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {filters.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            style={{
              padding: "6px 12px", borderRadius: 999, fontSize: 11.5, fontFamily: "var(--f-mono)", cursor: "pointer",
              border: `1px solid ${filter === entry.id ? "var(--honey-line)" : "var(--line-2)"}`,
              background: filter === entry.id ? "var(--honey-soft)" : "transparent",
              color: filter === entry.id ? "var(--honey)" : "var(--fg-3)",
            }}
          >
            {entry.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" style={ghostButtonStyle()} disabled={syncBusy} onClick={() => void syncNow()}>
          {syncBusy ? <Spinner size={12} /> : <RefreshCcw aria-hidden width={13} height={13} />}
          {syncBusy ? "Syncing your account listings" : "Sync from account"}
        </button>
      </div>

      {syncBusy ? (
        <p role="status" aria-label="Catalog sync running" style={{ margin: 0, fontSize: 12, color: "var(--fg-3)" }}>
          An agent is opening your selling page and cataloguing every listing — this can take a couple of minutes.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <Panel pad="38px 30px" style={{ textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", color: "var(--fg-2)", fontSize: 13.5 }}>
            {accountListings.length === 0
              ? "Nothing catalogued yet. Create your first listing, or sync what's already on your account."
              : "Nothing matches this filter."}
          </p>
          {accountListings.length === 0 ? (
            <button type="button" style={primaryButtonStyle()} onClick={() => desk.openListingModal()}>
              <Plus aria-hidden width={15} height={15} />
              Create your first listing
            </button>
          ) : null}
        </Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 14 }}>
          {visible.map((listing) => (
            <ListingCard key={listing.id} listing={listing} unread={unreadByListing.get(listing.id) ?? 0} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
