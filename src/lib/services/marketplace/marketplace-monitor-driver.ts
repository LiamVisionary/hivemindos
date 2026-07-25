import "server-only";

import { hostname } from "node:os";

import { numberEnv } from "@/lib/config/env";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { notifyEscalation } from "@/lib/services/messaging/escalation-notify";
import { marketplaceAdapter } from "@/lib/services/marketplace/adapters";
import { attachConversationEscalation, ingestConversationSnapshot, readMarketplaceConversations } from "@/lib/services/marketplace/marketplace-conversations-store";
import { enqueueMarketplaceDecision, listMarketplaceDecisions } from "@/lib/services/marketplace/marketplace-decisions-store";
import { dispatchMarketplaceAgentTask } from "@/lib/services/marketplace/marketplace-dispatch";
import {
  acquireOrRenewMarketplaceDriverLease,
  marketplaceDriverLeaseDisabled,
  releaseMarketplaceDriverLease,
  type MarketplaceDriverLeaseState,
} from "@/lib/services/marketplace/marketplace-driver-lease";
import { applyVerifiedCatalogSweep, verifyUnverifiedPostedListings } from "@/lib/services/marketplace/marketplace-listing-pipeline";
import { recoverLateMarketplaceResearch } from "@/lib/services/marketplace/marketplace-research";
import { readMarketplaceListings } from "@/lib/services/marketplace/marketplace-listings-store";
import { resolveIndependentTabReader, verifyClaimedReplies } from "@/lib/services/marketplace/marketplace-verification-matrix";
import { listMarketplaceDirectives, readMarketplaceAccounts, updateMarketplaceAccount } from "@/lib/services/marketplace/marketplace-store";
import { mutateMarketplaceRuntime, patchAccountRuntime, readMarketplaceRuntime } from "@/lib/services/marketplace/marketplace-runtime";
import {
  computeMarketplacePollIntervalMs,
  computeMarketplaceTickGate,
  type MarketplaceAccount,
  type MarketplaceAgentReport,
  type MarketplaceReportEscalation,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * The marketplace monitor: a lease-elected per-machine loop that wakes every
 * few seconds, and per connected LOCALLY-HOMED account decides whether work is
 * due from the backoff ladder — cheap scripted activity probes on the hot
 * rungs, ONE combined agent sweep (catalog + inbox in a single dispatched
 * session) at the base cadence, and an immediate inbox session whenever
 * pending buyer messages show up. As the process that runs ON the profile-
 * owning machine, each wake also settles deferred agent claims: it promotes
 * (or refutes) posted-unverified listings via the independent page check, and
 * it defers all probing while a vault-replicated "posting" state says an agent
 * session may be driving this profile's browser. Escalations become decision
 * cards; the ladder accelerates after activity and relaxes back to the hourly
 * base (cadence + gate math is pure, tested in the hermetic marketplace
 * suites).
 */

type Runner = {
  stopRequested: boolean;
  loop: Promise<void> | null;
  startedAt: string;
  lastWakeAt?: string;
  lastError?: string;
  lease?: MarketplaceDriverLeaseState;
  tickInFlight: boolean;
};

type GlobalState = typeof globalThis & { __hivemindMarketplaceMonitorRunner?: Runner };
const globalState = globalThis as GlobalState;

const wakeMs = () => numberEnv("HIVEMINDOS_MARKETPLACE_DRIVER_TICK_MS", 5_000);
/** An op stuck in-flight this long is presumed dead (server restart mid-session). */
const IN_FLIGHT_STALE_MS = 45 * 60_000;
/** A "posting" listing older than this is a crashed session, not a live one — stop deferring on it (create cap 60 min + slack). */
const POSTING_SESSION_STALE_MS = 75 * 60_000;

export function marketplaceMonitorDisabled(): boolean {
  return (process.env.HIVEMINDOS_MARKETPLACE_MONITOR || "").trim() === "0";
}

function sleepUnlessStopped(runner: Runner, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (runner.stopRequested || Date.now() - started >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

/** Apply one agent inbox report: conversations, catalog, escalations → decisions. */
async function applyInboxReport(account: MarketplaceAccount, report: MarketplaceAgentReport): Promise<void> {
  const now = new Date().toISOString();
  if (report.sessionHealth === "logged-out") {
    await updateMarketplaceAccount(account.id, { status: "needs-attention" });
    await notifyEscalation({
      key: `marketplace-session-dead-${account.id}`,
      title: "Facebook session signed out",
      body: `The marketplace agent found the browser session for ${account.displayName ?? account.id} signed out. Open Marketplace → Connect to sign in again; monitoring is paused until then.`,
      severity: "high",
      tags: ["marketplace", "connection"],
    }).catch(() => undefined);
    return;
  }
  const ingest = await ingestConversationSnapshot(account.id, report.conversations, report.replies);
  if (report.catalog?.length) await upsertSyncedListings(account.id, report.catalog);

  // Escalations → decision cards (deduped per conversation: one pending card at a time).
  const pending = await listMarketplaceDecisions({ status: "pending", accountId: account.id });
  for (const escalation of report.escalations) {
    const conversationId = `${account.id}:${escalation.conversationId}`;
    if (pending.some((decision) => decision.conversationId === conversationId)) continue;
    const conversation = (await readMarketplaceConversations(account.id)).find((candidate) => candidate.id === conversationId);
    const decision = await enqueueMarketplaceDecision({
      kind: "buyer-escalation",
      accountId: account.id,
      conversationId,
      title: escalation.question,
      summary: escalation.reason,
      explanation: {
        headline: escalation.question,
        summary: escalation.reason,
        whyNow: "A buyer conversation crossed the agent's autonomy bounds.",
        requestedAction: "Approve to let the agent proceed as asked, or reject with a note telling it what to do.",
        evidence: [
          ...(escalation.offerUsd !== undefined ? [`Offer: $${escalation.offerUsd}`] : []),
          ...(conversation ? [`Buyer: ${conversation.buyerName} on "${conversation.listingRef.title}"`] : []),
          ...(escalation.draftReply ? [`Agent's draft reply: ${escalation.draftReply}`] : []),
        ],
        source: "marketplace",
      },
    });
    await attachConversationEscalation(conversationId, decision.id, escalation.reason);
    await notifyEscalation({
      key: `marketplace-escalation-${conversationId}`,
      title: `Buyer needs a decision: ${conversation?.listingRef.title ?? account.displayName ?? account.id}`,
      body: `${escalation.reason} ${escalation.question}`,
      severity: "high",
      ttlMs: 60 * 60_000,
      tags: ["marketplace", "decision", `marketplace-decision:${decision.id}`],
    }).catch(() => undefined);
  }

  if (ingest.newBuyerMessages > 0 || report.replies.length > 0) {
    await patchAccountRuntime(account.id, { lastActivityAt: now });
  }
}

/** Backstop: an active listing the last two catalog sweeps never saw is flagged, not assumed fine. */
async function flagUnsyncedActiveListings(account: MarketplaceAccount): Promise<void> {
  const listings = await readMarketplaceListings(account.id);
  const staleMs = 2 * Math.max(account.monitor.baseIntervalMs, 60_000);
  for (const listing of listings) {
    if (listing.state !== "active" || listing.origin !== "drafted" || !listing.external) continue;
    const lastSeen = Date.parse(listing.external.lastSyncedAt);
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen > staleMs) {
      await notifyEscalation({
        key: `marketplace-listing-unseen-${listing.id}`,
        title: `Listing not visible in your catalog: ${listing.title}`,
        body: `"${listing.title}" was posted but the last ${Math.round(staleMs / 3_600_000)}h of catalog sweeps have not seen it on your account. Facebook may have removed or hidden it — check it on the marketplace.`,
        severity: "high",
        tags: ["marketplace", `listing:${listing.id}`],
      }).catch(() => undefined);
    }
  }
}

async function tickAccount(account: MarketplaceAccount, nowMs: number): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  await patchAccountRuntime(account.id, { inFlightOp: "probe", inFlightSince: nowIso, lastPollAt: nowIso, lastError: undefined });
  let fullSweepRan = false;
  try {
    const adapter = marketplaceAdapter(account.provider);
    const runtime = (await readMarketplaceRuntime()).perAccount[account.id] ?? {};
    const lastSweepMs = runtime.lastSweepAt ? Date.parse(runtime.lastSweepAt) : Number.NaN;
    const fullSweepDue = !Number.isFinite(lastSweepMs) || nowMs - lastSweepMs >= account.monitor.baseIntervalMs;

    let pending: number | "unknown" = "unknown";
    if (!fullSweepDue) {
      // Hot-rung path: a cheap scripted probe. A failed probe degrades to
      // "wait for the base-cadence sweep", never to a guessed dispatch.
      const probe = await adapter.checkActivity(account, { env: {} });
      pending = probe.pendingConversations;
    }

    if (fullSweepDue) {
      fullSweepRan = true;
      await patchAccountRuntime(account.id, { inFlightOp: "sync-catalog" });
      await syncMarketplaceCatalog(account.id);
      await flagUnsyncedActiveListings(account);
    }

    if (fullSweepDue || (typeof pending === "number" && pending > 0)) {
      await patchAccountRuntime(account.id, { inFlightOp: "work-inbox" });
      const [directives, listings] = await Promise.all([
        listMarketplaceDirectives(account.id),
        readMarketplaceListings(account.id),
      ]);
      const report = await adapter.workInbox(
        account,
        { directives, listings: listings.filter((listing) => listing.state === "active") },
        { env: {}, dispatchAgentTaskImpl: dispatchMarketplaceAgentTask },
      );
      await applyInboxReport(account, report);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchAccountRuntime(account.id, { lastError: message });
    await notifyEscalation({
      key: `marketplace-monitor-error-${account.id}`,
      title: `Marketplace monitoring hit an error (${account.displayName ?? account.id})`,
      body: `${message} The monitor keeps its cadence and will retry; nothing was changed on your account.`,
      severity: "normal",
      ttlMs: 6 * 60 * 60_000,
      tags: ["marketplace"],
    }).catch(() => undefined);
  } finally {
    const runtime = (await readMarketplaceRuntime()).perAccount[account.id] ?? {};
    const lastActivityMs = runtime.lastActivityAt ? Date.parse(runtime.lastActivityAt) : undefined;
    const interval = computeMarketplacePollIntervalMs(
      account.monitor,
      Number.isFinite(lastActivityMs ?? Number.NaN) ? lastActivityMs : undefined,
      Date.now(),
    );
    await patchAccountRuntime(account.id, {
      inFlightOp: undefined,
      inFlightSince: undefined,
      nextPollAt: new Date(Date.now() + interval).toISOString(),
      ...(fullSweepRan ? { lastSweepAt: new Date().toISOString() } : {}),
    });
  }
}

async function tickOnce(): Promise<{ ticked: string[] }> {
  const ticked: string[] = [];
  const accounts = await readMarketplaceAccounts();
  const localKey = hostname();
  const overlay = await readMarketplaceRuntime();
  const nowMs = Date.now();
  for (const account of accounts) {
    if (account.status !== "connected") continue;
    if (!sameMachineIdentity(account.machine.machineKey, localKey)) continue;
    const runtime = overlay.perAccount[account.id] ?? {};
    if (runtime.inFlightOp) {
      const sinceMs = runtime.inFlightSince ? Date.parse(runtime.inFlightSince) : Number.NaN;
      if (Number.isFinite(sinceMs) && nowMs - sinceMs < IN_FLIGHT_STALE_MS) continue;
      // Stale in-flight marker (crash mid-session) — clear and resume.
      await patchAccountRuntime(account.id, { inFlightOp: undefined, inFlightSince: undefined });
    }
    const nextMs = runtime.nextPollAt ? Date.parse(runtime.nextPollAt) : Number.NaN;
    if (Number.isFinite(nextMs) && nowMs < nextMs) continue;
    ticked.push(account.id);
    await tickAccount(account, nowMs);
  }
  // Second-chance pass: apply research results that landed after their job
  // timed out (cheap runtime read; board read only when candidates exist).
  await recoverLateMarketplaceResearch().catch(() => 0);
  await mutateMarketplaceRuntime((state) => {
    state.lastTickAt = new Date().toISOString();
  });
  return { ticked };
}

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    runner.lastWakeAt = new Date().toISOString();
    try {
      runner.lease = await acquireOrRenewMarketplaceDriverLease();
      if ((runner.lease.held || marketplaceDriverLeaseDisabled()) && !runner.tickInFlight) {
        runner.tickInFlight = true;
        try {
          await tickOnce();
          runner.lastError = undefined;
        } finally {
          runner.tickInFlight = false;
        }
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    await sleepUnlessStopped(runner, wakeMs());
  }
  await releaseMarketplaceDriverLease();
}

export function startMarketplaceMonitorDriver(): { running: boolean; startedAt?: string } {
  if (marketplaceMonitorDisabled()) return { running: false };
  const existing = globalState.__hivemindMarketplaceMonitorRunner;
  if (existing && !existing.stopRequested) return { running: true, startedAt: existing.startedAt };
  const runner: Runner = { stopRequested: false, loop: null, startedAt: new Date().toISOString(), tickInFlight: false };
  globalState.__hivemindMarketplaceMonitorRunner = runner;
  runner.loop = loop(runner).catch((error) => {
    runner.lastError = error instanceof Error ? error.message : String(error);
  });
  return { running: true, startedAt: runner.startedAt };
}

export async function stopMarketplaceMonitorDriver(): Promise<{ running: boolean }> {
  const runner = globalState.__hivemindMarketplaceMonitorRunner;
  if (!runner) return { running: false };
  runner.stopRequested = true;
  await runner.loop?.catch(() => undefined);
  globalState.__hivemindMarketplaceMonitorRunner = undefined;
  return { running: false };
}

/** One lease-gated tick through the caller's freshly-compiled code. */
export async function runMarketplaceMonitorTickNow(): Promise<{ ticked: string[]; held: boolean }> {
  const lease = await acquireOrRenewMarketplaceDriverLease();
  if (!lease.held && !marketplaceDriverLeaseDisabled()) return { ticked: [], held: false };
  const result = await tickOnce();
  return { ...result, held: true };
}

export async function getMarketplaceMonitorDriverStatus() {
  const runner = globalState.__hivemindMarketplaceMonitorRunner;
  const overlay = await readMarketplaceRuntime();
  return {
    running: Boolean(runner && !runner.stopRequested),
    disabled: marketplaceMonitorDisabled(),
    startedAt: runner?.startedAt,
    lastWakeAt: runner?.lastWakeAt,
    lastTickAt: overlay.lastTickAt,
    lastError: runner?.lastError,
    leaseHeld: runner?.lease?.held ?? false,
    perAccount: overlay.perAccount,
  };
}
