// guard:allow-hive-action-route - dashboard-only Marketplace decision queue (the human
// approval rail); not an agent-invokable Hive action. Approving a new-listing decision here
// is the ONLY path that fires a marketplace post, and the pipeline re-checks the approval
// at fire time (listing-approval-required).
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import {
  decideMarketplaceDecision,
  ignoreMarketplaceDecision,
  listMarketplaceDecisions,
  marketplaceDecisionAnswer,
} from "@/lib/services/marketplace/marketplace-decisions-store";
import { setMarketplaceListingState } from "@/lib/services/marketplace/marketplace-listings-store";
import { postApprovedListing } from "@/lib/services/marketplace/marketplace-listing-pipeline";
import { setMarketplaceConversationState } from "@/lib/services/marketplace/marketplace-conversations-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status");
    const accountId = request.nextUrl.searchParams.get("accountId")?.trim() || undefined;
    const decisions = await listMarketplaceDecisions({
      ...(status === "pending" || status === "approved" || status === "denied" || status === "ignored" || status === "expired"
        ? { status }
        : {}),
      ...(accountId ? { accountId } : {}),
    });
    return okJson({ decisions });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const action = typeof body.action === "string" ? body.action : "decide";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (action === "ignore") {
    if (!id) return errorJson("id is required");
    try {
      const ignored = await ignoreMarketplaceDecision(id);
      if (!ignored) return errorJson(`Unknown decision: ${id}`, 404);
      if (ignored.kind === "new-listing" && ignored.listingId) {
        await setMarketplaceListingState(ignored.listingId, "draft", "human");
      }
      if (ignored.kind === "buyer-escalation" && ignored.conversationId) {
        await setMarketplaceConversationState(ignored.conversationId, "active").catch(() => null);
      }
      return okJson({ decision: ignored });
    } catch (error) {
      return errorJson(error instanceof Error ? error.message : String(error), 500);
    }
  }
  if (action !== "decide") return errorJson(`Unknown action: ${action}`);
  const verdict = body.decision === "approved" || body.decision === "denied" ? body.decision : null;
  if (!id || !verdict) return errorJson("id and decision (approved|denied) are required");
  const note = typeof body.note === "string" ? body.note : "";
  const makeDirective = body.makeDirective === true;
  try {
    const decided = await decideMarketplaceDecision(id, verdict, note, makeDirective);
    if (!decided) return errorJson(`Unknown decision: ${id}`, 404);
    const decision = decided.decision;

    // Follow-through per decision kind. The state flip to "posting" happens
    // BEFORE this response (so the card the UI refreshes on already reads
    // POSTING, not a stale NEEDS APPROVAL); only the minutes-long agent
    // dispatch runs detached.
    if (decision.kind === "new-listing" && decision.listingId) {
      if (verdict === "approved") {
        await postApprovedListing(decision.id, { detachDispatch: true }).catch((error) => {
          console.error(`[marketplace] posting approved listing ${decision.listingId} failed:`, error instanceof Error ? error.message : error);
        });
      } else {
        await setMarketplaceListingState(decision.listingId, "rejected", "human");
      }
    }
    // Buyer escalations: the conversation leaves needs-human; the monitor's
    // next inbox session carries the human answer (and any new directive).
    if (decision.kind === "buyer-escalation" && decision.conversationId) {
      await setMarketplaceConversationState(decision.conversationId, "active").catch(() => null);
    }

    return okJson({
      decision,
      ...(decided.directiveId ? { directiveId: decided.directiveId } : {}),
      answer: marketplaceDecisionAnswer(decision, verdict, note),
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
