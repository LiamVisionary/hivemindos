import { hostname } from "node:os";

import { runBrowserUse } from "@/lib/services/browser-use-runner";
import { extractCurrentUrl, looksLoggedOutUrl, probeBrowserProfileLogin, runBrowserUseOverCdp } from "@/lib/services/browser-profile-connect";
import { ensureMarketplaceBrowser } from "@/lib/services/marketplace/marketplace-browser-runtime";
import { acquireMarketplaceProfileLock } from "@/lib/services/marketplace/marketplace-profile-lock";
import { marketplaceProviderRow } from "@/lib/services/marketplace/marketplace-provider-matrix";
import {
  resolveIndependentTabReader,
  verifyMarketplaceOpClaim,
} from "@/lib/services/marketplace/marketplace-verification-matrix";
import type {
  MarketplaceAccount,
  MarketplaceAgentReport,
  MarketplaceCapability,
  MarketplaceCapabilitySupport,
  MarketplaceReportCatalogItem,
} from "@/lib/services/marketplace/marketplace-types";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import type {
  MarketplaceActivityProbe,
  MarketplaceAdapterContext,
  MarketplaceClaimDisposition,
  MarketplaceConnectProbe,
  MarketplaceInboxWorkInput,
  MarketplaceProviderAdapter,
} from "@/lib/services/marketplace/adapters/types";
import {
  buildCreateListingPrompt,
  buildEndListingPrompt,
  buildFullSweepPrompt,
  buildInboxWorkPrompt,
  buildSyncCatalogPrompt,
} from "@/lib/services/marketplace/marketplace-agent-context";

/**
 * Facebook Marketplace adapter — execution style "browser-agent".
 *
 * Cheap deterministic reads (logged-in probe, pending-activity peek) script
 * the account's dedicated persistent browser over CDP: they are single-page
 * reads with a robust URL-redirect failure signal and they run on the
 * ladder's hot rungs where an agent dispatch per poll would be untenable.
 *
 * Everything multi-step or mutating (inbox work, catalog sync, listing
 * create/end) delegates to a dispatched agent on the profile-owning machine —
 * marketplace.facebook.com is an obfuscated SPA whose DOM shifts weekly, and
 * an agent driving the page adapts and verifies outcomes where scripted
 * selectors would silently break.
 */

/** Best-effort unread-conversation count; any failure degrades to "unknown". */
const PENDING_COUNT_SCRIPT = [
  "(() => {",
  "  const badges = document.querySelectorAll('[aria-label*=\"unread\" i], [aria-label*=\"Marketplace\" i] [data-visualcompletion=\"ignore\"]');",
  "  const chips = document.querySelectorAll('[role=\"row\"] [dir=\"auto\"] strong');",
  "  const count = Math.max(badges.length, chips.length);",
  "  return JSON.stringify({ marketplacePending: Number.isFinite(count) ? count : null });",
  "})()",
].join("\n");

function browserProfileSpec(account: MarketplaceAccount) {
  const row = marketplaceProviderRow("facebook");
  const method = row.methods.find((candidate) => candidate.method === "browser-profile");
  if (!method?.browserProfile) throw new Error("Facebook marketplace row is missing its browser-profile method.");
  return { ...method.browserProfile, profileName: account.machine.profileName };
}

function requireDispatch(ctx: MarketplaceAdapterContext) {
  if (!ctx.dispatchAgentTaskImpl) {
    throw new Error("Marketplace agent dispatch is not wired into this call. Pass dispatchAgentTaskImpl (marketplace-dispatch) in the adapter context.");
  }
  return ctx.dispatchAgentTaskImpl;
}

async function withProfileBrowser<T>(
  account: MarketplaceAccount,
  ctx: MarketplaceAdapterContext,
  run: (browserUse: typeof runBrowserUse, cdpUrl: string) => Promise<T>,
): Promise<T> {
  const browserUse = ctx.runBrowserUseImpl ?? runBrowserUse;
  const ensureBrowser = ctx.ensureBrowserImpl ?? ensureMarketplaceBrowser;
  const profileName = account.machine.profileName;
  const release = await acquireMarketplaceProfileLock(profileName);
  try {
    const browser = await ensureBrowser(profileName, { headed: false });
    return await run(browserUse, browser.cdpUrl);
  } finally {
    await release();
  }
}

/**
 * CDP endpoint for agent sessions (mutating ops drive the same dedicated
 * browser). Only resolvable when THIS process runs on the profile-owning
 * machine — from anywhere else (e.g. an approval decided on another
 * machine's dashboard) the prompt carries the port-file fallback instead,
 * since the agent executes on the owning machine either way.
 */
async function agentSessionCdpUrl(account: MarketplaceAccount, ctx: MarketplaceAdapterContext): Promise<string | null> {
  if (!ctx.ensureBrowserImpl && !sameMachineIdentity(account.machine.machineKey, hostname())) return null;
  const ensureBrowser = ctx.ensureBrowserImpl ?? ensureMarketplaceBrowser;
  const browser = await ensureBrowser(account.machine.profileName, { headed: false });
  return browser.cdpUrl;
}

export const facebookMarketplaceAdapter: MarketplaceProviderAdapter = {
  provider: "facebook",

  async connectStatus(account, ctx): Promise<MarketplaceConnectProbe> {
    const spec = browserProfileSpec(account);
    return probeBrowserProfileLogin({
      profileName: spec.profileName,
      probeUrl: spec.probeUrl,
      ...(ctx.runBrowserUseImpl ? { runBrowserUseImpl: ctx.runBrowserUseImpl } : {}),
      ...(ctx.ensureBrowserImpl ? { ensureBrowserImpl: ctx.ensureBrowserImpl } : {}),
      signedOutDetail: "Signed out of Facebook — run Connect to sign in again.",
    });
  },

  async checkActivity(account, ctx): Promise<MarketplaceActivityProbe> {
    try {
      return await withProfileBrowser(account, ctx, async (browserUse, cdpUrl) => {
        const profileName = account.machine.profileName;
        await runBrowserUseOverCdp(browserUse, profileName, cdpUrl, { action: "open", url: "https://www.facebook.com/marketplace/inbox" });
        const result = await runBrowserUseOverCdp(browserUse, profileName, cdpUrl, { action: "eval", script: PENDING_COUNT_SCRIPT });
        const match = result.stdout.match(/\{\s*"marketplacePending"\s*:\s*(\d+|null)\s*\}/);
        if (!match || match[1] === "null") return { pendingConversations: "unknown" };
        return { pendingConversations: Number(match[1]) };
      });
    } catch {
      return { pendingConversations: "unknown" };
    }
  },

  async syncCatalog(account, ctx): Promise<MarketplaceReportCatalogItem[]> {
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    const report = await dispatch({ account, op: "sync-catalog", prompt: buildSyncCatalogPrompt(account, cdpUrl) });
    return report.catalog ?? [];
  },

  async createListing(account, listing, approvedDecisionId, ctx): Promise<{ externalId: string; url: string; verification: MarketplaceClaimDisposition }> {
    if (!approvedDecisionId.trim()) {
      throw new Error("Refusing to post a marketplace listing without an approved decision (listing-approval-required).");
    }
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    // 60 min: a real create session (photo uploads + the SPA form, one CLI call
    // per step) measured past the 30-min default without being stuck.
    const report = await dispatch({ account, op: "create-listing", prompt: buildCreateListingPrompt(account, listing, cdpUrl), maxRuntimeMs: 60 * 60_000 });
    if (!report.postedListing?.externalId || !report.postedListing.url) {
      throw new Error(
        report.sessionHealth === "logged-out"
          ? "The Facebook session is signed out — reconnect the account and try again."
          : `Listing post could not be verified: the agent reported no posted listing (session ${report.sessionHealth}).`,
      );
    }
    const posted = { externalId: report.postedListing.externalId, url: report.postedListing.url };
    // Independent proof the claimed post is real: read-back inside the agent
    // session is the AGENT'S OWN claim — a session fabricated externalId
    // "1234567890" plus a matching URL and the pipeline marked the listing
    // live (2026-07-18, VeniceAgent). Refuted ⇒ throw; unobservable from here
    // (foreign machine / no WebSocket) ⇒ "deferred" so the caller records the
    // claim posted-unverified and the OWNING machine's monitor promotes it —
    // the claim never goes active on trust.
    const reader = resolveIndependentTabReader(account, ctx);
    const claimCheck = await verifyMarketplaceOpClaim(reader, account.machine.profileName, {
      op: "create-listing",
      url: posted.url,
      title: listing.title,
    });
    if (claimCheck.outcome === "refuted") {
      throw new Error(
        `Listing post FAILED independent verification: ${claimCheck.reason}. The agent's claim was rejected and nothing was marked live.`,
      );
    }
    return { ...posted, verification: claimCheck.outcome === "verified" ? "verified" : "deferred" };
  },

  async endListing(account, externalId, ctx): Promise<{ verification: MarketplaceClaimDisposition }> {
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    const report = await dispatch({ account, op: "end-listing", prompt: buildEndListingPrompt(account, externalId, cdpUrl) });
    if (report.sessionHealth !== "ok") {
      throw new Error(`Ending listing ${externalId} did not complete cleanly (session ${report.sessionHealth}).`);
    }
    // A fabricated end-listing "ok" used to be accepted as-is — require the
    // listing URL to hit the dead-page detection before treating it as ended.
    const reader = resolveIndependentTabReader(account, ctx);
    const claimCheck = await verifyMarketplaceOpClaim(reader, account.machine.profileName, {
      op: "end-listing",
      url: `https://www.facebook.com/marketplace/item/${externalId}`,
    });
    if (claimCheck.outcome === "refuted") {
      throw new Error(`Ending listing ${externalId} FAILED independent verification: ${claimCheck.reason}.`);
    }
    return { verification: claimCheck.outcome === "verified" ? "verified" : "deferred" };
  },

  async workInbox(account, input: MarketplaceInboxWorkInput, ctx): Promise<MarketplaceAgentReport> {
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    const prompt = input.fullSweep ? buildFullSweepPrompt(account, input, cdpUrl) : buildInboxWorkPrompt(account, input, cdpUrl);
    return dispatch({ account, op: "work-inbox", prompt });
  },

  capabilities(): Record<MarketplaceCapability, MarketplaceCapabilitySupport> {
    return { ...marketplaceProviderRow("facebook").capabilities };
  },
};

export type FacebookMarketplaceAdapter = typeof facebookMarketplaceAdapter;

// Exported for the hermetic suite: probe parsing must be testable without a browser.
export const __facebookAdapterInternals = { extractCurrentUrl, looksLoggedOut: looksLoggedOutUrl, PENDING_COUNT_SCRIPT };
