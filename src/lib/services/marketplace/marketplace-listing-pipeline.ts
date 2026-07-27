import "server-only";

import { notifyEscalation } from "@/lib/services/messaging/escalation-notify";
import { marketplaceAdapter } from "@/lib/services/marketplace/adapters";
import { dispatchMarketplaceAgentTask } from "@/lib/services/marketplace/marketplace-dispatch";
import { decideMarketplaceDecision, enqueueMarketplaceDecision, getMarketplaceDecision } from "@/lib/services/marketplace/marketplace-decisions-store";
import {
  findDuplicateListing,
  getMarketplaceListing,
  readMarketplaceListings,
  setMarketplaceListingState,
  upsertSyncedListings,
} from "@/lib/services/marketplace/marketplace-listings-store";
import { MarketplaceProfileBusyError, acquireMarketplaceProfileLock } from "@/lib/services/marketplace/marketplace-profile-lock";
import {
  partitionCatalogClaims,
  resolveIndependentTabReader,
  verifyMarketplaceOpClaim,
} from "@/lib/services/marketplace/marketplace-verification-matrix";
import { getMarketplaceAccount } from "@/lib/services/marketplace/marketplace-store";
import { patchAccountRuntime } from "@/lib/services/marketplace/marketplace-runtime";
import type { MarketplaceAgentDispatch } from "@/lib/services/marketplace/adapters/types";
import type { ReadBrowserTab } from "@/lib/services/marketplace/marketplace-browser-runtime";
import type {
  MarketplaceAccount,
  MarketplaceDecision,
  MarketplaceListing,
  MarketplaceReportCatalogItem,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Listing lifecycle orchestration: draft → approval decision → (on approve)
 * agent posts on the profile-owning machine with read-back verification →
 * active. Posting is fail-closed twice: the decision must be approved at fire
 * time, and the adapter refuses to post without the approved decision id
 * (matrix gate listing-approval-required). A post whose claim could not be
 * independently observed from the approving process lands "posted-unverified";
 * the owning machine's monitor promotes it to active (or routes a refuted
 * claim to attention) via verifyUnverifiedPostedListings below.
 */

export class DuplicateListingError extends Error {
  readonly duplicate: MarketplaceListing;
  constructor(duplicate: MarketplaceListing) {
    super(
      `This looks like a duplicate of "${duplicate.title}" ($${duplicate.priceUsd}${duplicate.external?.url ? `, ${duplicate.external.url}` : ""}). ` +
        "Edit that listing instead, or resubmit with the duplicate override if it really is a different item.",
    );
    this.name = "DuplicateListingError";
    this.duplicate = duplicate;
  }
}

/**
 * Draft → approval decision. Who submits decides the shape:
 *
 * - `submittedBy: "human"` (the dashboard listing editor): the human just
 *   authored this exact title/price/photos and clicked submit — that IS the
 *   approval, so the decision is created pre-approved (provenance noted, the
 *   matrix gate + fire-time recheck stay intact) and posting starts
 *   immediately. Re-asking the same person the same question was pure friction
 *   (Liam, 2026-07-18).
 * - default ("agent"): a pending decision card the human reviews — the gate
 *   for anything the human did not author themselves.
 */
export async function requestListingApproval(
  listingId: string,
  options?: { overrideDuplicate?: boolean; submittedBy?: "human" | "agent"; dispatchImpl?: MarketplaceAgentDispatch },
): Promise<{ listing: MarketplaceListing; decision: MarketplaceDecision }> {
  const listing = await getMarketplaceListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.state !== "draft" && listing.state !== "rejected" && listing.state !== "failed") {
    throw new Error(`Listing "${listing.title}" is ${listing.state} — only drafts can be submitted for approval.`);
  }
  if (!listing.title.trim() || listing.priceUsd <= 0) {
    throw new Error("A title and a price above $0 are required before requesting approval.");
  }
  const duplicate = await findDuplicateListing(listing.accountId, { id: listing.id, title: listing.title, priceUsd: listing.priceUsd });
  if (duplicate && !options?.overrideDuplicate) throw new DuplicateListingError(duplicate);

  const evidence: string[] = [
    `Asking price: $${listing.priceUsd}`,
    ...(listing.minOfferUsd ? [`Minimum acceptable offer: $${listing.minOfferUsd}`] : []),
    ...(listing.research
      ? [`Queen research suggested $${listing.research.suggestedPriceUsd} (${listing.research.confidence} confidence, ${listing.research.compsCount} comps)`]
      : ["No price research was run — the price is the human's own."]),
    ...(listing.photos.length ? [`${listing.photos.length} photo(s) attached`] : ["No photos attached"]),
    duplicate ? `Duplicate check: overridden — resembles "${duplicate.title}"` : "Duplicate check: no similar active listing found",
  ];

  const submittedBy = options?.submittedBy ?? "agent";
  const updated = await setMarketplaceListingState(listing.id, "pending-approval", submittedBy);
  const decision = await enqueueMarketplaceDecision({
    kind: "new-listing",
    accountId: listing.accountId,
    listingId: listing.id,
    title: `List "${listing.title}" for $${listing.priceUsd}?`,
    summary: `The agent will post this listing to the marketplace exactly as previewed once you approve.`,
    explanation: {
      headline: `Approve posting "${listing.title}" for $${listing.priceUsd}.`,
      summary: "A new marketplace listing is ready. Nothing posts until you approve it.",
      whyNow: "You created this draft and asked the agent to handle the listing.",
      impact: "Approve and the agent posts it on the connected account. Reject and it stays a draft.",
      requestedAction: "Approve the listing, or reject it with a note on what to change.",
      evidence,
      source: "marketplace",
    },
    preview: { title: listing.title, priceUsd: listing.priceUsd, photoPaths: listing.photos.map((photo) => photo.vaultPath) },
  });
  if (submittedBy === "human") {
    await decideMarketplaceDecision(decision.id, "approved", "Auto-approved: submitted by the human from the listing editor.", false);
    const posting = await postApprovedListing(decision.id, {
      detachDispatch: true,
      ...(options?.dispatchImpl ? { dispatchImpl: options.dispatchImpl } : {}),
    });
    const decided = await getMarketplaceDecision(decision.id);
    return { listing: posting, decision: decided ?? decision };
  }
  await notifyEscalation({
    key: `marketplace-listing-approval-${listing.id}`,
    title: `Listing ready to review: ${listing.title}`,
    body: `Approve to post "${listing.title}" for $${listing.priceUsd} on Facebook Marketplace. The agent posts it exactly as previewed.`,
    severity: "high",
    tags: ["marketplace", "decision", `listing:${listing.id}`, `marketplace-decision:${decision.id}`],
  }).catch(() => undefined);
  return { listing: updated ?? listing, decision };
}

/**
 * Fire an APPROVED new-listing decision: dispatch the posting agent pinned to
 * the profile-owning machine, verify the read-back, persist the external id.
 * Re-checks approval at fire time (fail closed).
 *
 * `detachDispatch` (the API routes): flip the listing to "posting"
 * synchronously and run the multi-minute agent dispatch detached, so the
 * response the UI refreshes on already shows POSTING — approving used to
 * respond before the state flip and the card kept reading NEEDS APPROVAL
 * until the next 30s poll.
 */
export async function postApprovedListing(
  decisionId: string,
  options?: { detachDispatch?: boolean; dispatchImpl?: MarketplaceAgentDispatch },
): Promise<MarketplaceListing> {
  const decision = await getMarketplaceDecision(decisionId);
  if (!decision || decision.kind !== "new-listing" || !decision.listingId) {
    throw new Error(`Decision ${decisionId} is not a listing approval.`);
  }
  if (decision.status !== "approved") {
    throw new Error(`Refusing to post: decision ${decisionId} is ${decision.status}, not approved (listing-approval-required).`);
  }
  const listing = await getMarketplaceListing(decision.listingId);
  if (!listing) throw new Error(`Listing ${decision.listingId} no longer exists.`);
  const account = await getMarketplaceAccount(listing.accountId);
  if (!account) throw new Error(`Account ${listing.accountId} no longer exists.`);
  const posting = await setMarketplaceListingState(listing.id, "posting", "agent");
  const dispatchAndVerify = async (): Promise<MarketplaceListing> => {
    try {
      const adapter = marketplaceAdapter(account.provider);
      const posted = await adapter.createListing(account, listing, decision.id, { env: {}, dispatchAgentTaskImpl: options?.dispatchImpl ?? dispatchMarketplaceAgentTask });
      const now = new Date().toISOString();
      // "verified" = this process observed the claimed page itself → active.
      // "deferred" = observation impossible from here (approval decided off the
      // owning machine) → the claim is RECORDED, not trusted: posted-unverified
      // until the owning machine's monitor refutes or promotes it.
      const nextState = posted.verification === "verified" ? "active" : "posted-unverified";
      const updated = await setMarketplaceListingState(listing.id, nextState, "agent", {
        externalId: posted.externalId,
        url: posted.url,
        postedAt: now,
        lastSyncedAt: now,
      });
      await patchAccountRuntime(account.id, { lastActivityAt: now });
      return updated ?? listing;
    } catch (error) {
      await setMarketplaceListingState(listing.id, "failed", "agent");
      await notifyEscalation({
        key: `marketplace-listing-post-failed-${listing.id}`,
        title: `Posting failed: ${listing.title}`,
        body: `The agent could not verify the listing went live. ${error instanceof Error ? error.message : String(error)} The draft and photos are intact — approve again to retry.`,
        severity: "high",
        tags: ["marketplace", `listing:${listing.id}`],
      }).catch(() => undefined);
      throw error;
    }
  };
  if (options?.detachDispatch) {
    void dispatchAndVerify().catch(() => undefined);
    return posting ?? listing;
  }
  return dispatchAndVerify();
}

export type VerifiedCatalogSweepResult = { added: number; updated: number; refuted: number; deferred: number };

/**
 * Merge a claimed catalog with per-op refutation (matrix row "sync-catalog"):
 * new unknown items and no-flip rows merge as before (low-stakes), but any row
 * that would flip an EXISTING record's state is verified against its live page
 * first — a mis-scraped or fabricated catalog used to flip real records to
 * ended unchecked. Refuted rows escalate and never merge; unobservable rows
 * defer to the owning machine's next sweep.
 */
export async function applyVerifiedCatalogSweep(
  account: MarketplaceAccount,
  items: MarketplaceReportCatalogItem[],
  options?: { readBrowserTabImpl?: ReadBrowserTab },
): Promise<VerifiedCatalogSweepResult> {
  const existing = await readMarketplaceListings(account.id);
  const { safe, contested } = partitionCatalogClaims(existing, items);
  const accepted: MarketplaceReportCatalogItem[] = [...safe];
  let refuted = 0;
  let deferred = 0;
  const reader = resolveIndependentTabReader(account, options);
  for (const claim of contested) {
    const claimCheck = await verifyMarketplaceOpClaim(reader, account.machine.profileName, {
      op: "sync-catalog",
      url: claim.url,
      expectDead: claim.claimedState === "ended",
    });
    if (claimCheck.outcome === "verified") {
      accepted.push(claim.item);
      continue;
    }
    if (claimCheck.outcome === "refuted") {
      refuted++;
      await notifyEscalation({
        key: `marketplace-catalog-claim-${claim.existing.id}`,
        title: `Catalog claim rejected: ${claim.existing.title}`,
        body: `A catalog sweep claimed "${claim.existing.title}" is ${claim.claimedState}, but ${claimCheck.reason}. The record was left ${claim.existing.state}; check the listing on the marketplace.`,
        severity: "high",
        tags: ["marketplace", `listing:${claim.existing.id}`],
      }).catch(() => undefined);
      continue;
    }
    deferred++;
  }
  const merged = await upsertSyncedListings(account.id, accepted);
  return { ...merged, refuted, deferred };
}

/** Full catalog sweep on the owning machine; merges verified results into the listings store. */
export async function syncMarketplaceCatalog(accountId: string): Promise<{ added: number; updated: number; total: number }> {
  const account = await getMarketplaceAccount(accountId);
  if (!account) throw new Error(`Unknown marketplace account: ${accountId}`);
  const adapter = marketplaceAdapter(account.provider);
  const items = await adapter.syncCatalog(account, { env: {}, dispatchAgentTaskImpl: dispatchMarketplaceAgentTask });
  const merged = await applyVerifiedCatalogSweep(account, items);
  return { added: merged.added, updated: merged.updated, total: items.length };
}

/** A posted-unverified listing this old with no successful observation gets a human heads-up instead of waiting silently. */
const UNVERIFIED_POST_STALE_MS = 6 * 60 * 60_000;

export type UnverifiedPostSweepResult = { promoted: number; refuted: number; deferred: number };

/**
 * The owning machine's promotion pass for finding-of-record posts: each
 * "posted-unverified" listing's claimed URL is independently observed
 * (readBrowserTab, matrix row "create-listing") and the listing is promoted to
 * active on proof, routed to the failed + escalation attention path on
 * refutation, and left posted-unverified (retried next tick, escalated once
 * stale) when the page cannot be read right now. Holds the profile lock
 * briefly so the check never races a live agent session.
 */
export async function verifyUnverifiedPostedListings(
  account: MarketplaceAccount,
  options?: { readBrowserTabImpl?: ReadBrowserTab },
): Promise<UnverifiedPostSweepResult> {
  const listings = (await readMarketplaceListings(account.id)).filter((listing) => listing.state === "posted-unverified");
  const result: UnverifiedPostSweepResult = { promoted: 0, refuted: 0, deferred: 0 };
  if (!listings.length) return result;

  const escalateStale = async (listing: MarketplaceListing) => {
    const claimedMs = Date.parse(listing.external?.postedAt ?? listing.updatedAt);
    if (!Number.isFinite(claimedMs) || Date.now() - claimedMs < UNVERIFIED_POST_STALE_MS) return;
    await notifyEscalation({
      key: `marketplace-listing-unverified-stale-${listing.id}`,
      title: `Posted listing still unverified: ${listing.title}`,
      body: `The agent claimed "${listing.title}" was posted, but the claim has gone unverified for hours (the listing page could not be read). Check ${listing.external?.url || "the marketplace"} yourself.`,
      severity: "high",
      tags: ["marketplace", `listing:${listing.id}`],
    }).catch(() => undefined);
  };

  const reader = resolveIndependentTabReader(account, options);
  if (!reader) {
    result.deferred = listings.length;
    for (const listing of listings) await escalateStale(listing);
    return result;
  }
  let release: (() => Promise<void>) | null = null;
  try {
    // Short wait: a busy profile (live agent session) defers to the next tick.
    release = await acquireMarketplaceProfileLock(account.machine.profileName, 1_000);
  } catch (error) {
    if (!(error instanceof MarketplaceProfileBusyError)) throw error;
    result.deferred = listings.length;
    return result;
  }
  try {
    for (const listing of listings) {
      const url = listing.external?.url ?? "";
      const claimCheck = await verifyMarketplaceOpClaim(reader, account.machine.profileName, {
        op: "create-listing",
        url,
        title: listing.title,
      });
      if (claimCheck.outcome === "verified") {
        const now = new Date().toISOString();
        await setMarketplaceListingState(
          listing.id,
          "active",
          "tick",
          listing.external ? { ...listing.external, lastSyncedAt: now } : undefined,
        );
        await patchAccountRuntime(account.id, { lastActivityAt: now });
        result.promoted++;
        continue;
      }
      if (claimCheck.outcome === "refuted") {
        await setMarketplaceListingState(listing.id, "failed", "tick");
        await notifyEscalation({
          key: `marketplace-listing-post-failed-${listing.id}`,
          title: `Posting claim refuted: ${listing.title}`,
          body: `The agent claimed "${listing.title}" was posted, but the independent page check refuted it: ${claimCheck.reason}. The draft and photos are intact — approve again to retry.`,
          severity: "high",
          tags: ["marketplace", `listing:${listing.id}`],
        }).catch(() => undefined);
        result.refuted++;
        continue;
      }
      result.deferred++;
      await escalateStale(listing);
    }
  } finally {
    await release();
  }
  return result;
}
