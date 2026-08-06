import type { ReasoningTrail } from "@/lib/types/reasoning-trail";

/**
 * Marketplace — shared types for the marketplace selling agent.
 *
 * Pure types + pure functions only (importable from server, client, and
 * hermetic .mjs tests via the ts loader). The policy invariant that shapes
 * these types: a listing never posts to a marketplace without an approved
 * decision record — adapters re-check the approval at fire time, fail-closed.
 * Buyer-chat autonomy is configurable per account and defaults to
 * "autonomous" by explicit product decision (2026-07-18).
 */

export const MARKETPLACE_PROVIDERS = ["facebook"] as const;
export type MarketplaceProvider = (typeof MARKETPLACE_PROVIDERS)[number];

export const MARKETPLACE_CONNECT_METHODS = ["browser-profile", "oauth", "api-token"] as const;
export type MarketplaceConnectMethod = (typeof MARKETPLACE_CONNECT_METHODS)[number];

export const MARKETPLACE_CAPABILITIES = [
  "listListings",
  "createListing",
  "updateListing",
  "endListing",
  "readConversations",
  "sendMessage",
  "syncCatalog",
] as const;
export type MarketplaceCapability = (typeof MARKETPLACE_CAPABILITIES)[number];
export type MarketplaceCapabilitySupport = "supported" | "limited" | "unsupported";

/**
 * How a provider's operations execute: "browser-agent" providers drive a
 * logged-in browser session (probes scripted, mutations via a dispatched
 * agent on the profile-owning machine); "api" providers call REST endpoints
 * in-process (eBay-style).
 */
export type MarketplaceExecutionStyle = "browser-agent" | "api";

/**
 * Buyer-chat autonomy. "autonomous" replies and negotiates within bounds and
 * escalates only what it cannot decide; "escalate-decisions" answers routine
 * questions but escalates every negotiation/decision; "review-all" drafts
 * every reply as a decision card and sends nothing on its own.
 */
export const MARKETPLACE_CHAT_AUTONOMY_MODES = ["autonomous", "escalate-decisions", "review-all"] as const;
export type MarketplaceChatAutonomy = (typeof MARKETPLACE_CHAT_AUTONOMY_MODES)[number];

// ---------------------------------------------------------------------------
// Monitoring cadence: base interval + exponential-backoff ladder
// ---------------------------------------------------------------------------

/**
 * One rung of the poll ladder: once the conversation has been quiet for
 * `afterQuietMs`, poll every `intervalMs`. Rungs are kept sorted ascending by
 * afterQuietMs; past the last rung (or past ladderResetMs) cadence returns to
 * the base interval.
 */
export type MarketplaceBackoffRung = { afterQuietMs: number; intervalMs: number };

export const DEFAULT_MARKETPLACE_BACKOFF_LADDER: MarketplaceBackoffRung[] = [
  { afterQuietMs: 0, intervalMs: 10_000 }, // just replied: watch closely
  { afterQuietMs: 300_000, intervalMs: 60_000 }, // 5 min quiet: every minute
  { afterQuietMs: 1_800_000, intervalMs: 600_000 }, // 30 min quiet: every 10 minutes
];

export type MarketplaceMonitorConfig = {
  /** Steady-state check interval with no recent activity. Default hourly. */
  baseIntervalMs: number;
  ladder: MarketplaceBackoffRung[];
  /** Quiet duration after which cadence returns to baseIntervalMs. */
  ladderResetMs: number;
};

export const DEFAULT_MARKETPLACE_MONITOR_CONFIG: MarketplaceMonitorConfig = {
  baseIntervalMs: 3_600_000,
  ladder: DEFAULT_MARKETPLACE_BACKOFF_LADDER,
  ladderResetMs: 7_200_000,
};

/** Floor for any configured poll interval — never hammer a marketplace sub-5s. */
export const MARKETPLACE_MIN_POLL_INTERVAL_MS = 5_000;

/**
 * Sort, de-dupe, and clamp a ladder so downstream math can trust it: rungs
 * ascend by afterQuietMs, intervals never shrink as quiet grows, and no
 * interval dips below the poll floor. Invalid input degrades to the default
 * ladder rather than a throw (config is user-editable data).
 */
export function normalizeMarketplaceBackoffLadder(raw: unknown): MarketplaceBackoffRung[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MARKETPLACE_BACKOFF_LADDER];
  const rungs: MarketplaceBackoffRung[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rung = item as Record<string, unknown>;
    const afterQuietMs = typeof rung.afterQuietMs === "number" && Number.isFinite(rung.afterQuietMs) ? Math.max(0, Math.floor(rung.afterQuietMs)) : null;
    const intervalMs = typeof rung.intervalMs === "number" && Number.isFinite(rung.intervalMs) ? Math.floor(rung.intervalMs) : null;
    if (afterQuietMs === null || intervalMs === null) continue;
    rungs.push({ afterQuietMs, intervalMs: Math.max(MARKETPLACE_MIN_POLL_INTERVAL_MS, intervalMs) });
  }
  if (!rungs.length) return [...DEFAULT_MARKETPLACE_BACKOFF_LADDER];
  rungs.sort((a, b) => a.afterQuietMs - b.afterQuietMs);
  const deduped: MarketplaceBackoffRung[] = [];
  for (const rung of rungs) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.afterQuietMs === rung.afterQuietMs) continue;
    // Intervals must widen (or hold) as quiet grows — a narrower late rung is a config mistake.
    if (previous && rung.intervalMs < previous.intervalMs) rung.intervalMs = previous.intervalMs;
    deduped.push(rung);
  }
  return deduped;
}

export function normalizeMarketplaceMonitorConfig(raw: unknown): MarketplaceMonitorConfig {
  const fallback = DEFAULT_MARKETPLACE_MONITOR_CONFIG;
  if (!raw || typeof raw !== "object") return { ...fallback, ladder: [...fallback.ladder] };
  const record = raw as Record<string, unknown>;
  const baseIntervalMs =
    typeof record.baseIntervalMs === "number" && Number.isFinite(record.baseIntervalMs) && record.baseIntervalMs > 0
      ? Math.max(60_000, Math.floor(record.baseIntervalMs))
      : fallback.baseIntervalMs;
  const ladderResetMs =
    typeof record.ladderResetMs === "number" && Number.isFinite(record.ladderResetMs) && record.ladderResetMs > 0
      ? Math.floor(record.ladderResetMs)
      : fallback.ladderResetMs;
  return { baseIntervalMs, ladder: normalizeMarketplaceBackoffLadder(record.ladder), ladderResetMs };
}

/**
 * The core cadence function: given the monitor config and the last time
 * anything happened on the account (agent replied, buyer messaged), return
 * how long to wait before the next poll. Pure so the hermetic suite can walk
 * the whole ladder.
 */
export function computeMarketplacePollIntervalMs(config: MarketplaceMonitorConfig, lastActivityAt: number | undefined, now: number): number {
  const base = Math.max(MARKETPLACE_MIN_POLL_INTERVAL_MS, config.baseIntervalMs);
  if (lastActivityAt === undefined || !Number.isFinite(lastActivityAt)) return base;
  const quietMs = Math.max(0, now - lastActivityAt);
  if (quietMs >= config.ladderResetMs) return base;
  let interval = base;
  for (const rung of config.ladder) {
    if (quietMs >= rung.afterQuietMs) interval = rung.intervalMs;
    else break;
  }
  // The ladder accelerates checks after activity; it never slows below base cadence.
  return Math.min(Math.max(MARKETPLACE_MIN_POLL_INTERVAL_MS, interval), base);
}

// ---------------------------------------------------------------------------
// Monitor tick gate (pure — what the per-account wake may do right now)
// ---------------------------------------------------------------------------

export type MarketplaceTickGate = {
  /** Non-null: skip this account entirely this wake. */
  skip: "in-flight" | "posting-session" | null;
  /** A stale in-flight marker (crash mid-session) should be cleared before proceeding. */
  clearStaleInFlight: boolean;
  /** posted-unverified listings await this machine's independent page check. */
  verifyPostedUnverified: boolean;
  /** The account's poll cadence is due. */
  pollDue: boolean;
};

/**
 * Decide what a monitor wake may do for one account. Two mutual-exclusion
 * rules live here (pure, tested in the hermetic marketplace suites):
 *
 * - An in-flight op suppresses overlapping work until it goes stale.
 * - A listing in "posting" means a dispatched agent session is (or may be)
 *   driving this profile's browser RIGHT NOW — possibly dispatched from
 *   another machine, which the local profile lock cannot see. The listing
 *   state is vault-replicated, so deferring on it works cross-machine.
 *   A "posting" older than `postingStaleMs` is a crashed session, not a live
 *   one — it stops deferring so a wedged flip can never mute monitoring
 *   forever (the base sweep flags it instead).
 */
export function computeMarketplaceTickGate(input: {
  runtime: { inFlightOp?: string; inFlightSince?: string; nextPollAt?: string };
  listings: ReadonlyArray<{ state: MarketplaceListingState; updatedAt: string }>;
  nowMs: number;
  inFlightStaleMs: number;
  postingStaleMs: number;
}): MarketplaceTickGate {
  const { runtime, listings, nowMs, inFlightStaleMs, postingStaleMs } = input;
  let clearStaleInFlight = false;
  if (runtime.inFlightOp) {
    const sinceMs = runtime.inFlightSince ? Date.parse(runtime.inFlightSince) : Number.NaN;
    if (Number.isFinite(sinceMs) && nowMs - sinceMs < inFlightStaleMs) {
      return { skip: "in-flight", clearStaleInFlight: false, verifyPostedUnverified: false, pollDue: false };
    }
    clearStaleInFlight = true;
  }
  const postingInFlight = listings.some((listing) => {
    if (listing.state !== "posting") return false;
    const flippedMs = Date.parse(listing.updatedAt);
    return !Number.isFinite(flippedMs) || nowMs - flippedMs < postingStaleMs;
  });
  if (postingInFlight) {
    return { skip: "posting-session", clearStaleInFlight, verifyPostedUnverified: false, pollDue: false };
  }
  const verifyPostedUnverified = listings.some((listing) => listing.state === "posted-unverified");
  const nextMs = runtime.nextPollAt ? Date.parse(runtime.nextPollAt) : Number.NaN;
  const pollDue = !Number.isFinite(nextMs) || nowMs >= nextMs;
  return { skip: null, clearStaleInFlight, verifyPostedUnverified, pollDue };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type MarketplaceAccountStatus = "connected" | "needs-attention" | "disconnected";

/**
 * Where the provider's browser session lives. Ops that need the session are
 * dispatched to this machine; probes only run when the local machine matches.
 */
export type MarketplaceMachineBinding = {
  machineKey: string;
  machineName: string;
  collectorUrl: string;
  /** Persistent browser-use profile name, e.g. "marketplace-facebook". */
  profileName: string;
};

export type MarketplaceNegotiationBounds = {
  /** Global floor as a percent of asking price (e.g. 70 = ignore offers under 70%). Unset = no floor. */
  globalMinOfferPct?: number;
};

export type MarketplaceLocalePreference = {
  /** Human description of the selling locale, e.g. "Sarasota, FL, United States". */
  description: string;
  /** Research against global prices instead of the local market. Default false. */
  globalComparison: boolean;
};

/**
 * A connected marketplace account. Definitions replicate through the shared
 * vault; secrets never live here — browser sessions live in the managed
 * browser profile on the bound machine, API credentials in the shared hive env.
 */
export type MarketplaceAccount = {
  /** Provider-encoded id, e.g. "facebook:liam". */
  id: string;
  provider: MarketplaceProvider;
  method: MarketplaceConnectMethod;
  status: MarketplaceAccountStatus;
  displayName?: string;
  /** The Socials-tab account this connection is shared with, when one exists. */
  socialAccountId?: string;
  /** Pin every dispatched marketplace session to this named fleet agent; unset = queen routing picks. */
  preferredAgentName?: string;
  machine: MarketplaceMachineBinding;
  /** DEFAULT "autonomous" (explicit product decision; normalizer degrades unknown values to "review-all"). */
  autonomy: MarketplaceChatAutonomy;
  negotiation: MarketplaceNegotiationBounds;
  monitor: MarketplaceMonitorConfig;
  locale: MarketplaceLocalePreference;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export const MARKETPLACE_LISTING_STATES = [
  "draft",
  "pending-approval",
  "approved",
  "posting",
  /**
   * The agent CLAIMED the post succeeded but no independent observation has
   * confirmed it yet (approval decided off the profile-owning machine, or the
   * page read failed). The owning machine's monitor performs the readBrowserTab
   * refutation and promotes to "active" or routes to attention — the claim
   * alone never goes live on trust.
   */
  "posted-unverified",
  "active",
  "ended",
  "rejected",
  "failed",
] as const;
export type MarketplaceListingState = (typeof MARKETPLACE_LISTING_STATES)[number];

export type MarketplaceListingPhoto = {
  /** Vault-relative path under Operations/Marketplace/Photos/<listingId>/. */
  vaultPath: string;
  alt?: string;
};

export type MarketplaceListingResearch = {
  jobId: string;
  suggestedPriceUsd: number;
  priceRangeUsd: [number, number];
  compsCount: number;
  confidence: "high" | "medium" | "low";
  completedAt: string;
};

export type MarketplaceListing = {
  id: string;
  accountId: string;
  /** "drafted" = created in HivemindOS; "synced" = imported from the user's existing catalog. */
  origin: "drafted" | "synced";
  state: MarketplaceListingState;
  title: string;
  description: string;
  priceUsd: number;
  /** Offers below this are auto-declined/ignored by the agent. Unset by default. */
  minOfferUsd?: number;
  category?: string;
  condition?: string;
  photos: MarketplaceListingPhoto[];
  research?: MarketplaceListingResearch;
  external?: { externalId: string; url: string; postedAt?: string; lastSyncedAt: string };
  stateHistory: Array<{ state: MarketplaceListingState; at: string; by: "human" | "agent" | "tick" }>;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type MarketplaceMessage = {
  /** External message id when known; otherwise a stable synthesized id. */
  id: string;
  at: string;
  from: "buyer" | "agent" | "human";
  text: string;
};

export type MarketplaceConversationState = "active" | "awaiting-buyer" | "needs-human" | "closed";

export type MarketplaceConversation = {
  id: string;
  accountId: string;
  listingRef: { listingId?: string; externalId?: string; title: string };
  buyerName: string;
  state: MarketplaceConversationState;
  /** Bounded history — the store prunes to the newest MARKETPLACE_CONVERSATION_MESSAGE_CAP. */
  messages: MarketplaceMessage[];
  lastBuyerMessageAt?: string;
  lastAgentReplyAt?: string;
  escalation?: { decisionId: string; reason: string };
  createdAt: string;
  updatedAt: string;
};

export const MARKETPLACE_CONVERSATION_MESSAGE_CAP = 200;

// ---------------------------------------------------------------------------
// Decisions (human approvals) + standing directives
// ---------------------------------------------------------------------------

export const MARKETPLACE_DECISION_KINDS = ["new-listing", "buyer-escalation", "price-change", "end-listing"] as const;
export type MarketplaceDecisionKind = (typeof MARKETPLACE_DECISION_KINDS)[number];

export type MarketplaceDecisionStatus = "pending" | "approved" | "denied" | "ignored" | "expired";

export type MarketplaceDecision = {
  id: string;
  kind: MarketplaceDecisionKind;
  accountId: string;
  listingId?: string;
  conversationId?: string;
  status: MarketplaceDecisionStatus;
  title: string;
  summary: string;
  explanation: ReasoningTrail;
  /** Approval-card body for new-listing decisions. */
  preview?: { title: string; priceUsd: number; photoPaths: string[] };
  createdAt: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Set when the decision note was captured as a standing directive. */
  capturedDirectiveId?: string;
};

export type MarketplaceDirective = {
  id: string;
  /** The instruction in the human's words, injected into every agent dispatch. */
  text: string;
  scope: "account" | "global";
  /** Required when scope === "account". */
  accountId?: string;
  source: "decision-note" | "inject";
  decisionRef?: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Research jobs (price research via the Queen)
// ---------------------------------------------------------------------------

export type MarketplaceResearchStage = { label: string; at: string; done: boolean };

export type MarketplaceResearchJobStatus = "dispatching" | "running" | "succeeded" | "failed";

export type MarketplaceResearchResult = {
  suggestedPriceUsd: number;
  priceRangeUsd: [number, number];
  comps: Array<{ title: string; priceUsd: number; url?: string; source: string }>;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type MarketplaceResearchJob = {
  id: string;
  listingId: string;
  accountId: string;
  status: MarketplaceResearchJobStatus;
  /** The queen-bee task id backing this job, once dispatched. */
  queenTaskId?: string;
  stages: MarketplaceResearchStage[];
  result?: MarketplaceResearchResult;
  failure?: string;
  /** Set when a timed-out job's task terminally cannot yield a late result — stops the recovery sweep from rechecking it. */
  lateResultUnavailable?: boolean;
  globalComparison: boolean;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Agent report contract (fenced JSON block in agent task results)
// ---------------------------------------------------------------------------

/** Fence tag the marketplace agent must use for its structured report. */
export const MARKETPLACE_REPORT_FENCE = "MARKETPLACE_REPORT";
/** Fence tag the research agent must use for its structured result. */
export const MARKETPLACE_RESEARCH_FENCE = "RESEARCH_RESULT";

export type MarketplaceReportConversation = {
  /** External conversation id or a stable buyer+listing key. */
  id: string;
  listingExternalId?: string;
  listingTitle: string;
  buyerName: string;
  messages: Array<{ id?: string; at?: string; from: "buyer" | "agent"; text: string }>;
};

export type MarketplaceReportEscalation = {
  conversationId: string;
  reason: string;
  question: string;
  /** e.g. the offer amount that triggered the escalation. */
  offerUsd?: number;
  draftReply?: string;
};

export type MarketplaceReportCatalogItem = {
  externalId: string;
  url?: string;
  title: string;
  priceUsd?: number;
  state: "active" | "sold" | "ended";
};

export type MarketplaceAgentReport = {
  conversations: MarketplaceReportConversation[];
  /** Replies the agent actually sent this session. */
  replies: Array<{ conversationId: string; text: string; at?: string }>;
  escalations: MarketplaceReportEscalation[];
  catalog?: MarketplaceReportCatalogItem[];
  postedListing?: { externalId: string; url: string };
  sessionHealth: "ok" | "logged-out" | "blocked" | "error";
  note?: string;
};

/** Client-facing projection of one provider's matrix row. */
export type MarketplaceProviderCapabilityDto = {
  provider: MarketplaceProvider;
  label: string;
  methods: Array<{
    method: MarketplaceConnectMethod;
    label: string;
    envKeys: string[];
    oauthStartPath?: string;
    browserProfile?: { namePrefix: string; loginUrl: string; probeUrl: string; signedInCookie?: string };
    notes?: string;
  }>;
  capabilities: Record<MarketplaceCapability, MarketplaceCapabilitySupport>;
  execution: MarketplaceExecutionStyle;
  limits: string[];
};
