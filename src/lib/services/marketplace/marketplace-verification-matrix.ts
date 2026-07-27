import { hostname } from "node:os";

import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { readBrowserTab, type ReadBrowserTab } from "@/lib/services/marketplace/marketplace-browser-runtime";
import { MARKETPLACE_AGENT_OPS, type MarketplaceAgentOp } from "@/lib/services/marketplace/adapters/types";
import type {
  MarketplaceAccount,
  MarketplaceAgentReport,
  MarketplaceListing,
  MarketplaceListingState,
  MarketplaceReportCatalogItem,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * MARKETPLACE_OP_VERIFICATION_SPEC — the single source of truth for how each
 * dispatched agent op's claims get independently refuted before any record
 * state flips on them.
 *
 * Follows the MARKETPLACE_PROVIDER_MATRIX convention: behavior that varies by
 * op lives in a row here, not in scattered conditionals. Every check reuses
 * readBrowserTab — the dispatcher loads the claimed page in a NEW tab of the
 * account's own browser and grounds the flip in what THIS process saw. Agent
 * read-back alone is the agent's own claim: a live session fabricated a
 * Marketplace listing id AND its own "read-back" (2026-07-18, VeniceAgent),
 * and a fabricated end-listing "ok" / catalog row / "reply sent" is the same
 * failure through a different op. Verdicts:
 *
 * - "verified": the page matched the claim — the flip may proceed.
 * - "refuted": the page CONTRADICTED the claim — callers route to the
 *   attention path (failed state + escalation / needs-human), never accept.
 * - "unobservable": the page cannot be read from here (foreign machine, no
 *   WebSocket runtime, tab read failed) — callers DEFER the flip to the
 *   profile-owning machine's monitor instead of trusting the claim.
 */

/** Facebook's dead/removed-page tells — a claimed URL matching this is not a live listing. */
export const MARKETPLACE_DEAD_PAGE_PATTERN = /isn'?t available|content isn'?t available|page not found|something went wrong/i;

const MARKETPLACE_ITEM_URL_PATTERN = /facebook\.com\/marketplace\/item\/\d+/i;

export type MarketplaceClaimOutcome = "verified" | "refuted" | "unobservable";
export type MarketplaceClaimVerdict = { outcome: MarketplaceClaimOutcome; reason: string };

export type MarketplaceOpClaim =
  | { op: "create-listing"; url: string; title: string }
  | { op: "end-listing"; url: string }
  | { op: "sync-catalog"; url: string; expectDead: boolean }
  | { op: "work-inbox"; conversationExternalId: string; replyText: string };

type ClaimFor<K extends MarketplaceAgentOp> = Extract<MarketplaceOpClaim, { op: K }>;

export type MarketplaceOpVerificationRow<K extends MarketplaceAgentOp = MarketplaceAgentOp> = {
  op: K;
  /** What agent claim this op's refutation check refutes. */
  refutes: string;
  verify: (reader: ReadBrowserTab, profileName: string, claim: ClaimFor<K>) => Promise<MarketplaceClaimVerdict>;
};

function verdict(outcome: MarketplaceClaimOutcome, reason: string): MarketplaceClaimVerdict {
  return { outcome, reason };
}

async function readPageText(reader: ReadBrowserTab, profileName: string, url: string): Promise<{ text: string } | { error: string }> {
  try {
    const page = await reader(profileName, url);
    return { text: page.text ?? "" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Case/whitespace-insensitive containment for "does the thread show this reply". */
function pageContainsText(pageText: string, needle: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const haystack = normalize(pageText);
  const target = normalize(needle).slice(0, 80);
  return target.length > 0 && haystack.includes(target);
}

export const MARKETPLACE_OP_VERIFICATION_SPEC: { [K in MarketplaceAgentOp]: MarketplaceOpVerificationRow<K> } = {
  "create-listing": {
    op: "create-listing",
    refutes: "postedListing { externalId, url } — the claimed URL must load a real listing page carrying the item title",
    async verify(reader, profileName, claim) {
      // Shape check needs no observation: a non-Marketplace URL is a fabricated claim wherever we run.
      if (!MARKETPLACE_ITEM_URL_PATTERN.test(claim.url)) {
        return verdict("refuted", `the agent reported "${claim.url}", which is not a Marketplace item URL`);
      }
      const page = await readPageText(reader, profileName, claim.url);
      if ("error" in page) return verdict("unobservable", `browser check failed: ${page.error}`);
      if (!page.text.trim() || MARKETPLACE_DEAD_PAGE_PATTERN.test(page.text)) {
        return verdict("refuted", "the reported listing URL does not load a real listing page");
      }
      const titleTokens = claim.title.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
      if (titleTokens.length && !titleTokens.some((token) => page.text.toLowerCase().includes(token))) {
        return verdict("refuted", "the reported listing page does not mention the item");
      }
      return verdict("verified", "the claimed listing URL loads a live page mentioning the item");
    },
  },
  "end-listing": {
    op: "end-listing",
    refutes: 'sessionHealth "ok" after an end — the listing URL must now hit the dead-page detection',
    async verify(reader, profileName, claim) {
      const page = await readPageText(reader, profileName, claim.url);
      if ("error" in page) return verdict("unobservable", `browser check failed: ${page.error}`);
      if (!page.text.trim()) return verdict("unobservable", "the listing page returned no readable text");
      if (MARKETPLACE_DEAD_PAGE_PATTERN.test(page.text)) return verdict("verified", "the listing page is gone as claimed");
      return verdict("refuted", "the listing page still loads live content — the claimed end did not happen");
    },
  },
  "sync-catalog": {
    op: "sync-catalog",
    refutes: "a catalog row that would flip an EXISTING record's state — its URL must match the claimed live/dead state",
    async verify(reader, profileName, claim) {
      const page = await readPageText(reader, profileName, claim.url);
      if ("error" in page) return verdict("unobservable", `browser check failed: ${page.error}`);
      if (!page.text.trim()) return verdict("unobservable", "the listing page returned no readable text");
      const looksDead = MARKETPLACE_DEAD_PAGE_PATTERN.test(page.text);
      if (claim.expectDead === looksDead) {
        return verdict("verified", looksDead ? "the listing page is gone as claimed" : "the listing page is live as claimed");
      }
      return verdict(
        "refuted",
        claim.expectDead
          ? "the catalog claimed this listing ended, but its page still loads live content"
          : "the catalog claimed this listing is active, but its page is gone",
      );
    },
  },
  "work-inbox": {
    op: "work-inbox",
    refutes: "a claimed sent reply — the conversation thread must actually show it where the thread is observable",
    async verify(reader, profileName, claim) {
      if (!/^\d+$/.test(claim.conversationExternalId)) {
        return verdict("unobservable", "the conversation has no external thread id to load");
      }
      const page = await readPageText(reader, profileName, `https://www.facebook.com/messages/t/${claim.conversationExternalId}`);
      if ("error" in page) return verdict("unobservable", `browser check failed: ${page.error}`);
      if (!page.text.trim()) return verdict("unobservable", "the conversation thread returned no readable text");
      if (pageContainsText(page.text, claim.replyText)) return verdict("verified", "the thread shows the claimed reply");
      return verdict("refuted", "the conversation thread does not show the reply the agent claimed it sent");
    },
  },
};

// Load-time invariant (mirrors the provider matrix): every dispatched op
// declares its refutation check — a new op cannot ship with silent acceptance.
for (const op of MARKETPLACE_AGENT_OPS) {
  const row = MARKETPLACE_OP_VERIFICATION_SPEC[op];
  if (!row || row.op !== op || typeof row.verify !== "function" || !row.refutes) {
    throw new Error(`MARKETPLACE_OP_VERIFICATION_SPEC missing or incomplete row: ${op}`);
  }
}

/** True when THIS process can open tabs in the account's dedicated browser. */
export function canObserveMarketplaceProfileHere(account: MarketplaceAccount): boolean {
  return typeof WebSocket !== "undefined" && sameMachineIdentity(account.machine.machineKey, hostname());
}

/**
 * The independent page reader for this account, or null when observation is
 * impossible from here. Callers must treat null as "defer the flip", never as
 * a verification pass.
 */
export function resolveIndependentTabReader(
  account: MarketplaceAccount,
  options?: { readBrowserTabImpl?: ReadBrowserTab },
): ReadBrowserTab | null {
  return options?.readBrowserTabImpl ?? (canObserveMarketplaceProfileHere(account) ? readBrowserTab : null);
}

/** Run one claim through its op's spec row; a null reader is "unobservable" for every op. */
export async function verifyMarketplaceOpClaim(
  reader: ReadBrowserTab | null,
  profileName: string,
  claim: MarketplaceOpClaim,
): Promise<MarketplaceClaimVerdict> {
  if (claim.op === "create-listing" && !MARKETPLACE_ITEM_URL_PATTERN.test(claim.url)) {
    // Shape refutation is observation-free — run it even without a reader.
    return verdict("refuted", `the agent reported "${claim.url}", which is not a Marketplace item URL`);
  }
  if (!reader) return verdict("unobservable", "cannot observe the profile's browser from this machine");
  switch (claim.op) {
    case "create-listing":
      return MARKETPLACE_OP_VERIFICATION_SPEC["create-listing"].verify(reader, profileName, claim);
    case "end-listing":
      return MARKETPLACE_OP_VERIFICATION_SPEC["end-listing"].verify(reader, profileName, claim);
    case "sync-catalog":
      return MARKETPLACE_OP_VERIFICATION_SPEC["sync-catalog"].verify(reader, profileName, claim);
    case "work-inbox":
      return MARKETPLACE_OP_VERIFICATION_SPEC["work-inbox"].verify(reader, profileName, claim);
  }
}

// ---------------------------------------------------------------------------
// Catalog claims: which rows need verification before they may merge
// ---------------------------------------------------------------------------

export type ContestedCatalogClaim = {
  item: MarketplaceReportCatalogItem;
  existing: MarketplaceListing;
  /** The state the claim would flip the existing record to. */
  claimedState: Extract<MarketplaceListingState, "active" | "ended">;
  /** URL to verify — the claimed URL, else the record's own, else the canonical item URL. */
  url: string;
};

export type CatalogClaimPartition = {
  /** New unknown items + rows that do not change an existing record's state — merge without observation (low-stakes). */
  safe: MarketplaceReportCatalogItem[];
  /** Rows that would flip an EXISTING record's state — verify before merging. */
  contested: ContestedCatalogClaim[];
};

/**
 * Split a claimed catalog: only rows that would flip an EXISTING record's
 * state need independent verification. "posting"/"posted-unverified" records
 * are excluded — their flips belong to the posting pipeline and the owning
 * machine's promotion pass, and the listings-store merge preserves them.
 */
export function partitionCatalogClaims(existing: MarketplaceListing[], items: MarketplaceReportCatalogItem[]): CatalogClaimPartition {
  const safe: MarketplaceReportCatalogItem[] = [];
  const contested: ContestedCatalogClaim[] = [];
  for (const item of items) {
    const externalId = item.externalId?.trim();
    if (!externalId || !item.title?.trim()) continue;
    const record = existing.find((listing) => listing.external?.externalId === externalId);
    const claimedState = item.state === "sold" || item.state === "ended" ? "ended" : "active";
    const flipsExisting = Boolean(record && (record.state === "active" || record.state === "ended") && record.state !== claimedState);
    if (!record || !flipsExisting) {
      safe.push(item);
      continue;
    }
    const url = item.url?.trim() || record.external?.url || `https://www.facebook.com/marketplace/item/${externalId}`;
    contested.push({ item, existing: record, claimedState, url });
  }
  return { safe, contested };
}

// ---------------------------------------------------------------------------
// Reply claims: which "replies sent" may mark a conversation awaiting-buyer
// ---------------------------------------------------------------------------

export type RefutedReplyClaim = { conversationId: string; reason: string };

export type ReplyClaimCheck = {
  /** Replies whose claims were verified (or genuinely unobservable off any thread) — safe to ingest. */
  accepted: MarketplaceAgentReport["replies"];
  /** Claims the thread contradicted — route to the attention path, never ingest. */
  refuted: RefutedReplyClaim[];
  /** Claims that could not be observed — the state flip defers to the next owning-machine sweep. */
  deferred: RefutedReplyClaim[];
};

/**
 * Check the report's claimed sent replies against the real conversation
 * threads where observable. A fabricated "reply sent" used to mark the
 * conversation awaiting-buyer and ghost the real buyer; now only verified
 * claims ingest, refuted claims escalate, and unobservable claims defer (the
 * next sweep's thread snapshot carries the reply if it was really sent).
 */
export async function verifyClaimedReplies(
  reader: ReadBrowserTab | null,
  profileName: string,
  report: Pick<MarketplaceAgentReport, "conversations" | "replies">,
): Promise<ReplyClaimCheck> {
  const accepted: MarketplaceAgentReport["replies"] = [];
  const refuted: RefutedReplyClaim[] = [];
  const deferred: RefutedReplyClaim[] = [];
  for (const reply of report.replies) {
    const snapshot = report.conversations.find((conversation) => conversation.id === reply.conversationId);
    if (!snapshot) {
      // Ingestion drops replies without a conversation snapshot anyway — pass through unchanged.
      accepted.push(reply);
      continue;
    }
    const result = await verifyMarketplaceOpClaim(reader, profileName, {
      op: "work-inbox",
      conversationExternalId: snapshot.id,
      replyText: reply.text,
    });
    if (result.outcome === "verified") accepted.push(reply);
    else if (result.outcome === "refuted") refuted.push({ conversationId: reply.conversationId, reason: result.reason });
    else deferred.push({ conversationId: reply.conversationId, reason: result.reason });
  }
  return { accepted, refuted, deferred };
}
