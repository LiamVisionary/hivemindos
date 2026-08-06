import "server-only";

import { marketplaceListingTitlesMatch } from "@/lib/services/marketplace/marketplace-listings-store";
import type {
  MarketplaceAgentReport,
  MarketplaceDecision,
  MarketplaceListing,
  MarketplaceReportConversation,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * A Marketplace inbox row is in scope only when it names one of the listings
 * the monitor is actively managing. External ids are authoritative when the
 * report supplies one; title matching is the fallback for Facebook rows that
 * do not expose an id.
 */
export function marketplaceReportConversationIsManaged(
  conversation: MarketplaceReportConversation,
  listings: MarketplaceListing[],
): boolean {
  const externalId = conversation.listingExternalId?.trim();
  if (externalId) {
    return listings.some((listing) => listing.external?.externalId === externalId);
  }
  const title = conversation.listingTitle.trim();
  if (!title) return false;
  return listings.some((listing) => marketplaceListingTitlesMatch(listing.title, title));
}

/**
 * Treat the agent report as untrusted input: personal and unrelated threads
 * never reach reply verification, the conversation store, or the decision
 * queue even if the agent mistakenly includes them.
 */
export function scopeMarketplaceAgentReport(
  report: MarketplaceAgentReport,
  listings: MarketplaceListing[],
): MarketplaceAgentReport {
  const conversations = report.conversations.filter((conversation) =>
    marketplaceReportConversationIsManaged(conversation, listings),
  );
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  return {
    ...report,
    conversations,
    replies: report.replies.filter((reply) => conversationIds.has(reply.conversationId)),
    escalations: report.escalations.filter((escalation) => conversationIds.has(escalation.conversationId)),
  };
}

/** An ignored buyer decision is a durable "do not ask again" tombstone. */
export function marketplaceDecisionSuppressesConversation(
  decision: MarketplaceDecision,
  conversationId: string,
): boolean {
  return decision.kind === "buyer-escalation"
    && decision.status === "ignored"
    && decision.conversationId === conversationId;
}
