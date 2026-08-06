import {
  MARKETPLACE_REPORT_FENCE,
  MARKETPLACE_RESEARCH_FENCE,
  type MarketplaceAccount,
  type MarketplaceChatAutonomy,
  type MarketplaceDirective,
  type MarketplaceListing,
} from "@/lib/services/marketplace/marketplace-types";
import type { MarketplaceInboxWorkInput } from "@/lib/services/marketplace/adapters/types";

/**
 * Prompt builders for dispatched marketplace agent sessions. Every prompt
 * carries the same three load-bearing blocks:
 *
 * 1. The autonomy contract for this account (what the agent may do alone).
 * 2. "Standing directives from the human — follow these exactly" (the same
 *    convention companies-orchestration.ts uses), newest last.
 * 3. The MARKETPLACE_REPORT output contract: the session MUST end with one
 *    fenced ```json MARKETPLACE_REPORT block the driver can parse. A session
 *    without a parseable report is treated as a no-op, never guessed at.
 */

const AUTONOMY_CONTRACT: Record<MarketplaceChatAutonomy, string> = {
  autonomous: [
    "Autonomy mode: AUTONOMOUS. Reply to buyers yourself and negotiate within the bounds below.",
    "Escalate only what you genuinely cannot decide: offers below the minimum-offer floor, meetup or payment arrangements that need the seller in person, requests for personal information, or anything that smells like a scam.",
  ].join(" "),
  "escalate-decisions": [
    "Autonomy mode: ESCALATE DECISIONS. Answer routine questions (availability, condition, details already in the listing) yourself.",
    "Escalate every negotiation, every offer, and every decision to the human as an escalation — do not accept, decline, or counter an offer yourself.",
  ].join(" "),
  "review-all": [
    "Autonomy mode: REVIEW ALL. Do NOT send any message to any buyer.",
    "For every conversation that needs a reply, put your proposed reply in the escalation's draftReply field and let the human approve it.",
  ].join(" "),
};

function negotiationBlock(account: MarketplaceAccount, listings: MarketplaceListing[]): string {
  const lines: string[] = [];
  if (typeof account.negotiation.globalMinOfferPct === "number") {
    lines.push(`- Global floor: ignore/decline offers below ${account.negotiation.globalMinOfferPct}% of an item's asking price.`);
  }
  for (const listing of listings) {
    if (typeof listing.minOfferUsd === "number") {
      lines.push(`- "${listing.title}": minimum acceptable offer is $${listing.minOfferUsd} (asking $${listing.priceUsd}). Politely decline lower offers.`);
    }
  }
  if (!lines.length) return "Negotiation bounds: none set — use good judgment and escalate offers that feel low.";
  return `Negotiation bounds:\n${lines.join("\n")}`;
}

export function directivesBlock(directives: MarketplaceDirective[]): string {
  if (!directives.length) return "";
  const ordered = [...directives].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [
    "Standing directives from the human — follow these exactly (newest last):",
    ...ordered.map((directive) => `- ${directive.text}`),
  ].join("\n");
}

function reportContract(op: string): string {
  return [
    `Output contract: end your reply with exactly one fenced code block tagged \`\`\`json ${MARKETPLACE_REPORT_FENCE}`,
    "containing a JSON object with these fields:",
    '{ "conversations": [{ "id", "listingExternalId"?, "listingTitle", "buyerName", "messages": [{ "id"?, "at"?, "from": "buyer"|"agent", "text" }] }],',
    '  "replies": [{ "conversationId", "text", "at"? }],',
    '  "escalations": [{ "conversationId", "reason", "question", "offerUsd"?, "draftReply"? }],',
    '  "catalog"?: [{ "externalId", "url"?, "title", "priceUsd"?, "state": "active"|"sold"|"ended" }],',
    '  "postedListing"?: { "externalId", "url" },',
    '  "sessionHealth": "ok"|"logged-out"|"blocked"|"error",',
    '  "note"?: string }',
    `Report only what you actually observed or did during this ${op} session. If the browser session is signed out or Facebook blocks an action, stop and report sessionHealth accordingly — never guess or fabricate state.`,
  ].join("\n");
}

function sessionPreamble(account: MarketplaceAccount, cdpUrl?: string | null): string {
  const attach = cdpUrl
    ? `Attach to the account's dedicated signed-in browser via CDP at ${cdpUrl} (e.g. browser-use \`--session mkt-agent --cdp-url ${cdpUrl}\`; if the CLI says the session is already running with different config, run \`browser-use --session mkt-agent close\` and retry). Do NOT launch a fresh browser — the signed-in session lives only in that instance.`
    : `Attach to the account's dedicated signed-in browser via CDP: read the port from ~/.hivemindos/marketplace/profiles/${account.machine.profileName}/DevToolsActivePort on this machine (first line) and attach to http://127.0.0.1:<port> (e.g. browser-use \`--session mkt-agent --cdp-url http://127.0.0.1:<port>\`; on a "different config" error run \`browser-use --session mkt-agent close\` and retry). If that file is missing or the endpoint does not answer, the browser is not running — stop and report sessionHealth "error"; never launch a fresh browser or sign in yourself.`;
  return [
    `You are the HivemindOS marketplace agent working ${account.provider} for the account "${account.displayName ?? account.id}".`,
    attach,
    "Behave like a careful human seller: no rapid-fire clicking, no bulk actions, human-paced typing.",
  ].join(" ");
}

/**
 * Hard messaging scope for NON-inbox operations. A create-listing session
 * wandered into the Marketplace inbox and replied to a four-year-old buyer
 * thread (2026-07-19) — the shared browser had the inbox open one tab over and
 * nothing forbade it. Verbatim block in every non-inbox prompt.
 */
const NO_MESSAGING_GUARD = [
  "HARD RULE — messaging is OUT OF SCOPE for this operation:",
  "- NEVER open the Marketplace inbox, Messenger, or any conversation thread.",
  "- NEVER send, type into, or reply to any chat message, for any reason.",
  "- If a chat window or thread opens on its own, close it and continue.",
  "Stay strictly on the pages this task names.",
].join("\n");

function inboxListingsContext(input: MarketplaceInboxWorkInput): string {
  return input.listings.length
    ? [
        "Your live listings (answer buyer questions from these details; never invent specs):",
        ...input.listings.map((listing) => {
          const bits = [`- "${listing.title}" — asking $${listing.priceUsd}`];
          if (listing.condition) bits.push(`condition: ${listing.condition}`);
          if (listing.external?.url) bits.push(listing.external.url);
          bits.push(`description: ${listing.description}`);
          return bits.join("; ");
        }),
      ].join("\n")
    : "No listing context is on file — answer only from what the marketplace page itself shows.";
}

const INBOX_CONVERSATION_SCOPE = [
  "CONVERSATION SCOPE — reply ONLY in conversations about the live listings named below.",
  "Old threads about items you are not managing (sold long ago, other people's listings, personal chats, anything not in the list) are OUT OF SCOPE. Do not reply, summarize, quote, or record their contents. Never include them in conversations, replies, or escalations — skip them completely.",
].join("\n");

const BUYER_FACING_VOICE = [
  "BUYER-FACING VOICE — messages are sent from the seller's own account.",
  "Write every buyer-facing reply as the seller in first person (I/me/my). The buyer must never hear about a separate agent, seller, owner, operator, or human behind the account.",
  "Never say phrases such as \"I can check the seller's availability,\" \"I'll ask the seller,\" or \"the owner says.\" When you are authorized to answer an availability question, say \"I can check my availability\" or otherwise keep it in first person.",
  "If availability, a meetup, payment, or another choice requires the human account owner, escalate it and do not send a holding reply.",
].join("\n");

export function buildInboxWorkPrompt(account: MarketplaceAccount, input: MarketplaceInboxWorkInput, cdpUrl?: string | null): string {
  return [
    sessionPreamble(account, cdpUrl),
    "Task: open Marketplace inbox conversations with pending buyer messages and work through ALL of them.",
    INBOX_CONVERSATION_SCOPE,
    BUYER_FACING_VOICE,
    AUTONOMY_CONTRACT[account.autonomy],
    negotiationBlock(account, input.listings),
    directivesBlock(input.directives),
    inboxListingsContext(input),
    reportContract("inbox"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Base-cadence combined sweep: catalog + inbox in ONE session and ONE
 * MARKETPLACE_REPORT. The report contract already carries both, so the sweep
 * used to burn two full queen round-trips against the same profile for no
 * reason. The standalone sync-catalog prompt stays for the on-demand
 * listings-route action.
 */
export function buildFullSweepPrompt(account: MarketplaceAccount, input: MarketplaceInboxWorkInput, cdpUrl?: string | null): string {
  return [
    sessionPreamble(account, cdpUrl),
    [
      "Task, in order, in this ONE session:",
      "1. Open the Marketplace selling page and catalogue EVERY listing on this account — active, sold, and ended. For each capture externalId (numeric id from its URL), url, title, price when shown, and state. Report them all in the catalog array. Do not modify any listing.",
      "2. Then open the Marketplace inbox and work through ALL conversations with pending buyer messages, per the rules below.",
      "End with exactly ONE report covering both the catalog and the conversations.",
    ].join("\n"),
    INBOX_CONVERSATION_SCOPE,
    BUYER_FACING_VOICE,
    AUTONOMY_CONTRACT[account.autonomy],
    negotiationBlock(account, input.listings),
    directivesBlock(input.directives),
    inboxListingsContext(input),
    reportContract("full-sweep"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildCreateListingPrompt(account: MarketplaceAccount, listing: MarketplaceListing, cdpUrl?: string | null): string {
  const photoLines = listing.photos.length
    ? [
        "Photos to upload, in order (vault-relative paths — resolve them under this machine's shared Obsidian vault root):",
        ...listing.photos.map((photo) => `- ${photo.vaultPath}`),
      ].join("\n")
    : "This listing has no photos. Create it text-only.";
  return [
    sessionPreamble(account, cdpUrl),
    NO_MESSAGING_GUARD,
    "Task: create ONE new Marketplace listing with exactly these details (the human already approved them — do not change title, price, or description):",
    [
      `Title: ${listing.title}`,
      `Price: $${listing.priceUsd}`,
      ...(listing.category ? [`Category: ${listing.category}`] : []),
      ...(listing.condition ? [`Condition: ${listing.condition}`] : []),
      `Description:\n${listing.description}`,
    ].join("\n"),
    photoLines,
    "Before creating: check the account's existing listings for this same item. If an active duplicate already exists, do NOT create another — report it in the note and set no postedListing.",
    "The human's approval above COVERS the final Publish click — complete the publish yourself; do not stop to ask for permission to publish (a session that parked at the Publish button cost the whole run, 2026-07-19).",
    "After publishing: open your listing from the selling page and copy its final URL. Report it as postedListing { externalId, url } — the numeric id from the URL is the externalId. If you cannot verify the listing went live, report sessionHealth accordingly instead of guessing.",
    reportContract("listing-creation"),
  ].join("\n\n");
}

export function buildSyncCatalogPrompt(account: MarketplaceAccount, cdpUrl?: string | null): string {
  return [
    sessionPreamble(account, cdpUrl),
    NO_MESSAGING_GUARD,
    "Task: open the Marketplace selling page and catalogue EVERY listing on this account — active, sold, and ended.",
    "For each listing capture externalId (numeric id from its URL), url, title, price when shown, and state.",
    "Report them all in the catalog array. Do not modify anything.",
    reportContract("catalog-sync"),
  ].join("\n\n");
}

export function buildPriceResearchPrompt(
  account: MarketplaceAccount,
  listing: Pick<MarketplaceListing, "title" | "description" | "condition" | "category" | "photos">,
  globalComparison: boolean,
): string {
  const locale = account.locale.description.trim();
  const scope = globalComparison
    ? "Compare against GLOBAL asking prices (nationwide/online marketplaces), not just one region."
    : locale
      ? `Focus on the seller's local market: ${locale}. Prefer comparable listings in or near that city/region; widen the radius only when local comps are thin.`
      : "Focus on the seller's local market (infer the region from the marketplace account when you open it; otherwise use country-level comps).";
  return [
    "You are the HivemindOS pricing researcher. Research what this item should be listed for by finding CURRENT comparable listings online (marketplace sites, classifieds, dealer/retail sites as appropriate).",
    [
      `Item: ${listing.title}`,
      ...(listing.condition ? [`Condition: ${listing.condition}`] : []),
      ...(listing.category ? [`Category: ${listing.category}`] : []),
      `Seller's description:\n${listing.description}`,
      ...(listing.photos.length ? [`Photos (vault-relative paths on this machine's shared vault): ${listing.photos.map((photo) => photo.vaultPath).join(", ")}`] : []),
    ].join("\n"),
    scope,
    "Find and compare at least 5 comparable current listings when possible. Weigh condition, mileage/age/specs when relevant, and note asking-vs-sold price dynamics.",
    [
      `Output contract: end your reply with exactly one fenced code block tagged \`\`\`json ${MARKETPLACE_RESEARCH_FENCE}`,
      'containing: { "suggestedPriceUsd": number, "priceRangeUsd": [low, high], "comps": [{ "title", "priceUsd", "url"?, "source" }],',
      '  "confidence": "high"|"medium"|"low", "rationale": string }',
      "suggestedPriceUsd is the price you would actually list at to sell in a reasonable time. Base every number on listings you actually found — never invent comps.",
    ].join("\n"),
  ].join("\n\n");
}

export function buildEndListingPrompt(account: MarketplaceAccount, externalId: string, cdpUrl?: string | null): string {
  return [
    sessionPreamble(account, cdpUrl),
    NO_MESSAGING_GUARD,
    `Task: end (mark unavailable / delete per the page's flow) the Marketplace listing with external id ${externalId}. The human already approved this.`,
    "Verify the listing no longer shows as active on the selling page before reporting sessionHealth ok.",
    reportContract("end-listing"),
  ].join("\n\n");
}
