import "server-only";

import { notifyEscalation } from "@/lib/services/messaging/escalation-notify";
import { marketplaceAdapter } from "@/lib/services/marketplace/adapters";
import { dispatchMarketplaceAgentTask } from "@/lib/services/marketplace/marketplace-dispatch";
import { decideMarketplaceDecision, enqueueMarketplaceDecision, getMarketplaceDecision } from "@/lib/services/marketplace/marketplace-decisions-store";
import {
  findDuplicateListing,
  getMarketplaceListing,
  setMarketplaceListingState,
  upsertSyncedListings,
} from "@/lib/services/marketplace/marketplace-listings-store";
import { getMarketplaceAccount } from "@/lib/services/marketplace/marketplace-store";
import { patchAccountRuntime } from "@/lib/services/marketplace/marketplace-runtime";
import type { MarketplaceAgentDispatch } from "@/lib/services/marketplace/adapters/types";
import type { MarketplaceDecision, MarketplaceListing } from "@/lib/services/marketplace/marketplace-types";

/**
 * Listing lifecycle orchestration: draft → approval decision → (on approve)
 * agent posts on the profile-owning machine with read-back verification →
 * active. Posting is fail-closed twice: the decision must be approved at fire
 * time, and the adapter refuses to post without the approved decision id
 * (matrix gate listing-approval-required).
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
      const updated = await setMarketplaceListingState(listing.id, "active", "agent", {
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

/** Full catalog sweep on the owning machine; merges results into the listings store. */
export async function syncMarketplaceCatalog(accountId: string): Promise<{ added: number; updated: number; total: number }> {
  const account = await getMarketplaceAccount(accountId);
  if (!account) throw new Error(`Unknown marketplace account: ${accountId}`);
  const adapter = marketplaceAdapter(account.provider);
  const items = await adapter.syncCatalog(account, { env: {}, dispatchAgentTaskImpl: dispatchMarketplaceAgentTask });
  const merged = await upsertSyncedListings(accountId, items);
  return { ...merged, total: items.length };
}
