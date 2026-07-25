import type { runBrowserUse } from "@/lib/services/browser-use-runner";
import type { EnsureMarketplaceBrowser, ReadBrowserTab } from "@/lib/services/marketplace/marketplace-browser-runtime";
import type {
  MarketplaceAccount,
  MarketplaceAgentReport,
  MarketplaceCapability,
  MarketplaceCapabilitySupport,
  MarketplaceDirective,
  MarketplaceListing,
  MarketplaceProvider,
  MarketplaceReportCatalogItem,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace adapter contract. One adapter per provider; behavior differences
 * live in the matrix row, execution differences live here.
 *
 * "browser-agent" providers (Facebook) implement cheap deterministic reads by
 * scripting the managed browser profile directly and delegate every multi-step
 * or mutating flow to a dispatched agent on the profile-owning machine.
 * "api" providers (future eBay-style rows) call REST endpoints in-process.
 *
 * Both external effects are injectable so hermetic suites can run adapters
 * with fakes — no real browser, CLI, or queen dispatch.
 */

export type MarketplaceConnectProbe = {
  status: "connected" | "needs-attention" | "disconnected";
  detail?: string;
  displayName?: string;
};

export type MarketplaceActivityProbe = {
  /** "unknown" when the scripted read failed — the driver degrades to base cadence, never to wrong behavior. */
  pendingConversations: number | "unknown";
};

/** One dispatched agent operation on the profile-owning machine. */
export const MARKETPLACE_AGENT_OPS = ["work-inbox", "create-listing", "end-listing", "sync-catalog"] as const;
export type MarketplaceAgentOp = (typeof MARKETPLACE_AGENT_OPS)[number];

/**
 * How an agent's claim about a mutating op stands after the dispatcher's
 * independent check: "verified" = this process observed the claimed page state
 * itself; "deferred" = observation is impossible from here (foreign machine /
 * no page text) — the state flip waits for the profile-owning machine's
 * monitor instead of going through on trust. Refuted claims never return —
 * they throw into the caller's failure path.
 */
export type MarketplaceClaimDisposition = "verified" | "deferred";

export type MarketplaceAgentTaskInput = {
  account: MarketplaceAccount;
  op: MarketplaceAgentOp;
  /** Full prompt built by marketplace-agent-context.ts (autonomy, bounds, directives, report contract). */
  prompt: string;
  /** Optional cap on the agent session; defaults to the queen pickup default. */
  maxRuntimeMs?: number;
};

/** Submit an agent task pinned to the account's machine and await its parsed report. */
export type MarketplaceAgentDispatch = (input: MarketplaceAgentTaskInput) => Promise<MarketplaceAgentReport>;

export type MarketplaceAdapterContext = {
  env: Record<string, string | undefined>;
  /** Injectable browser-use bridge — hermetic suites pass a fake. */
  runBrowserUseImpl?: typeof runBrowserUse;
  /** Injectable dedicated-browser bootstrap (CDP) — hermetic suites pass a fake. */
  ensureBrowserImpl?: EnsureMarketplaceBrowser;
  /** Injectable agent dispatch — hermetic suites pass a fake. */
  dispatchAgentTaskImpl?: MarketplaceAgentDispatch;
  /** Injectable new-tab page reader — the dispatcher's INDEPENDENT check of agent claims. */
  readBrowserTabImpl?: ReadBrowserTab;
  fetchImpl?: typeof fetch;
};

export type MarketplaceInboxWorkInput = {
  /** Standing directives injected into the prompt, newest last. */
  directives: MarketplaceDirective[];
  /** Listings context the agent may answer questions from. */
  listings: MarketplaceListing[];
  /**
   * Base-cadence combined sweep: the ONE dispatched session catalogues the
   * selling page first, then works the inbox, returning both in a single
   * MARKETPLACE_REPORT — two separate queen round-trips against the same
   * profile were pure overhead (the report contract already carries catalog).
   */
  fullSweep?: boolean;
};

export interface MarketplaceProviderAdapter {
  provider: MarketplaceProvider;
  /** Cheap logged-in probe. Never throws for a signed-out session — reports needs-attention. */
  connectStatus(account: MarketplaceAccount, ctx: MarketplaceAdapterContext): Promise<MarketplaceConnectProbe>;
  /** Cheap pending-activity probe used by the monitor ladder's hot rungs. */
  checkActivity(account: MarketplaceAccount, ctx: MarketplaceAdapterContext): Promise<MarketplaceActivityProbe>;
  /** Full catalog sweep of the user's listings on the provider (agent-driven for browser providers). */
  syncCatalog(account: MarketplaceAccount, ctx: MarketplaceAdapterContext): Promise<MarketplaceReportCatalogItem[]>;
  /**
   * Post an approved listing. Fail-closed: throws unless `approvedDecisionId`
   * references a decision the caller re-verified as approved (the matrix gates
   * createListing on listing-approval-required). `verification: "deferred"`
   * means the claim could not be observed from this process — the caller
   * records it posted-unverified and the owning machine's monitor promotes it.
   */
  createListing(
    account: MarketplaceAccount,
    listing: MarketplaceListing,
    approvedDecisionId: string,
    ctx: MarketplaceAdapterContext,
  ): Promise<{ externalId: string; url: string; verification: MarketplaceClaimDisposition }>;
  /** End a live listing. Throws when the claimed end is refuted by the page still being live. */
  endListing(
    account: MarketplaceAccount,
    externalId: string,
    ctx: MarketplaceAdapterContext,
  ): Promise<{ verification: MarketplaceClaimDisposition }>;
  /** Work pending buyer messages per the account's autonomy mode; returns the full session report. */
  workInbox(account: MarketplaceAccount, input: MarketplaceInboxWorkInput, ctx: MarketplaceAdapterContext): Promise<MarketplaceAgentReport>;
  capabilities(account: MarketplaceAccount): Record<MarketplaceCapability, MarketplaceCapabilitySupport>;
}
