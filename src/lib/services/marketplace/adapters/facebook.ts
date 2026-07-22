import { hostname } from "node:os";

import { runBrowserUse } from "@/lib/services/browser-use-runner";
import { extractCurrentUrl, looksLoggedOutUrl, probeBrowserProfileLogin, runBrowserUseOverCdp } from "@/lib/services/browser-profile-connect";
import { ensureMarketplaceBrowser, readBrowserTab } from "@/lib/services/marketplace/marketplace-browser-runtime";
import { acquireMarketplaceProfileLock } from "@/lib/services/marketplace/marketplace-profile-lock";
import { marketplaceProviderRow } from "@/lib/services/marketplace/marketplace-provider-matrix";
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
  MarketplaceConnectProbe,
  MarketplaceInboxWorkInput,
  MarketplaceProviderAdapter,
} from "@/lib/services/marketplace/adapters/types";
import {
  buildCreateListingPrompt,
  buildEndListingPrompt,
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

  async createListing(account, listing, approvedDecisionId, ctx): Promise<{ externalId: string; url: string }> {
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
    await verifyPostedListingIndependently(account, ctx, posted, listing.title);
    return posted;
  },

  async endListing(account, externalId, ctx): Promise<void> {
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    const report = await dispatch({ account, op: "end-listing", prompt: buildEndListingPrompt(account, externalId, cdpUrl) });
    if (report.sessionHealth !== "ok") {
      throw new Error(`Ending listing ${externalId} did not complete cleanly (session ${report.sessionHealth}).`);
    }
  },

  async workInbox(account, input: MarketplaceInboxWorkInput, ctx): Promise<MarketplaceAgentReport> {
    const dispatch = requireDispatch(ctx);
    const cdpUrl = await agentSessionCdpUrl(account, ctx);
    return dispatch({ account, op: "work-inbox", prompt: buildInboxWorkPrompt(account, input, cdpUrl) });
  },

  capabilities(): Record<MarketplaceCapability, MarketplaceCapabilitySupport> {
    return { ...marketplaceProviderRow("facebook").capabilities };
  },
};

/**
 * Independent proof that a claimed post is real: the dispatcher loads the
 * reported listing URL in a NEW tab of the account's own browser and requires
 * a real listing page carrying the item title. Read-back inside the agent
 * session is the AGENT'S OWN claim — a session fabricated externalId
 * "1234567890" plus a matching URL and the pipeline marked the listing live
 * (2026-07-18, VeniceAgent). Fail-closed: only "cannot observe from here"
 * (foreign machine / no WebSocket runtime) falls back to trusting read-back.
 */
async function verifyPostedListingIndependently(
  account: MarketplaceAccount,
  ctx: MarketplaceAdapterContext,
  posted: { externalId: string; url: string },
  listingTitle: string,
): Promise<void> {
  if (!/facebook\.com\/marketplace\/item\/\d+/i.test(posted.url)) {
    throw new Error(`Listing post rejected: the agent reported "${posted.url}", which is not a Marketplace item URL.`);
  }
  const canObserveHere = typeof WebSocket !== "undefined" && sameMachineIdentity(account.machine.machineKey, hostname());
  const reader = ctx.readBrowserTabImpl ?? (canObserveHere ? readBrowserTab : null);
  if (!reader) return; // cannot observe the page from this machine — the agent's read-back stands
  let page: { url: string; text: string };
  try {
    page = await reader(account.machine.profileName, posted.url);
  } catch (error) {
    throw new Error(
      `Listing post could not be independently verified (browser check failed: ${error instanceof Error ? error.message : String(error)}). Not marking it live.`,
    );
  }
  const text = page.text ?? "";
  if (!text.trim() || /isn'?t available|content isn'?t available|page not found|something went wrong/i.test(text)) {
    throw new Error(
      "Listing post FAILED independent verification: the reported listing URL does not load a real listing page. The agent's claim was rejected and nothing was marked live.",
    );
  }
  const titleTokens = listingTitle.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  if (titleTokens.length && !titleTokens.some((token) => text.toLowerCase().includes(token))) {
    throw new Error(
      "Listing post FAILED independent verification: the reported listing page does not mention the item. The agent's claim was rejected and nothing was marked live.",
    );
  }
}

export type FacebookMarketplaceAdapter = typeof facebookMarketplaceAdapter;

// Exported for the hermetic suite: probe parsing must be testable without a browser.
export const __facebookAdapterInternals = { extractCurrentUrl, looksLoggedOut: looksLoggedOutUrl, PENDING_COUNT_SCRIPT };
