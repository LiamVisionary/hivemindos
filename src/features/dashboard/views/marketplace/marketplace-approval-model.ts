import type { SpendApprovalView } from "@/features/approvals/spend-approval-model";
import type { MarketplaceDecision } from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace decision → SpendApprovalView mapping, so marketplace approvals
 * render through the shared ApprovalReviewCard (the ZHC work-approval
 * precedent) — records never touch the wallet spend-approvals backend.
 */

const KIND_LABEL: Record<MarketplaceDecision["kind"], string> = {
  "new-listing": "new listing",
  "buyer-escalation": "buyer decision",
  "price-change": "price change",
  "end-listing": "end listing",
};

export function marketplaceDecisionToView(decision: MarketplaceDecision): SpendApprovalView {
  return {
    id: decision.id,
    title: decision.title,
    agent: "Marketplace agent",
    kind: KIND_LABEL[decision.kind],
    // Every marketplace decision is an outward action on the user's real
    // account (post a listing / answer a buyer) — always worth full attention.
    risk: "high",
    ...(decision.preview?.priceUsd ? { amountUsd: decision.preview.priceUsd, asset: "USD" } : {}),
    reason: decision.summary,
    explanation: decision.explanation,
    createdAtMs: Date.parse(decision.createdAt) || 0,
  };
}

export const MARKETPLACE_NOTE_MODE = {
  standingLabel: "Save as standing rule",
  standingHint: "The agent applies this note to every future situation like this one (e.g. \"ignore low offers like this from now on\").",
};
