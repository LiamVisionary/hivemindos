import "server-only";

import { numberEnv } from "@/lib/config/env";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import { SocialPostError, type SocialConnectProbe, type SocialPostResult } from "@/lib/services/socials/adapters/types";
import {
  MAX_SOCIAL_POST_ATTEMPTS,
  queueItemReadyToPost,
  retryDelayMs,
  transitionQueueItem,
} from "@/lib/services/socials/social-queue-domain";
import {
  acquireOrRenewSocialQueueDriverLease,
  releaseSocialQueueDriverLease,
  socialQueueDriverLeaseDisabled,
  type SocialQueueDriverLeaseState,
} from "@/lib/services/socials/social-queue-driver-lease";
import { runSocialDraftingCycle, type SocialDraftingCycleResult } from "@/lib/services/socials/social-drafting-engine";
import {
  getSocialAccount,
  mutateSocialQueue,
  readSocialAccounts,
  readSocialQueue,
  readSocialQueueMeta,
  updateSocialQueueEngineMeta,
} from "@/lib/services/socials/socials-store";
import type { SocialAccount, SocialQueueItem } from "@/lib/services/socials/socials-types";

const POSTING_STALE_MS = 15 * 60_000;
const SOCIAL_QUEUE_RUNNER_SCHEMA = 6;

type TickDependencies = {
  now?: Date;
  env?: Record<string, string>;
  connectionProbeImpl?: (account: SocialAccount, env: Record<string, string>) => Promise<SocialConnectProbe>;
  postImpl?: (item: SocialQueueItem, account: SocialAccount, env: Record<string, string>) => Promise<SocialPostResult>;
  draftingImpl?: (now: Date) => Promise<SocialDraftingCycleResult>;
};

type Runner = {
  schemaVersion?: number;
  stopRequested: boolean;
  loop: Promise<void> | null;
  startedAt: string;
  lastWakeAt?: string;
  lastError?: string;
  lease?: SocialQueueDriverLeaseState;
  tickInFlight: boolean;
};

type GlobalState = typeof globalThis & { __hivemindSocialQueueRunner?: Runner };
const globalState = globalThis as GlobalState;

const wakeMs = () => numberEnv("HIVEMINDOS_SOCIAL_QUEUE_TICK_MS", 5_000);

export function socialQueueEngineDisabled(): boolean {
  return (process.env.HIVEMINDOS_SOCIAL_QUEUE_ENGINE || "").trim() === "0";
}

async function defaultConnectionProbe(account: SocialAccount, env: Record<string, string>): Promise<SocialConnectProbe> {
  return socialAdapter(account.platform).connectStatus(account, { env });
}

async function defaultPost(item: SocialQueueItem, account: SocialAccount, env: Record<string, string>): Promise<SocialPostResult> {
  return socialAdapter(account.platform).post({
    account,
    text: item.text,
    title: item.title,
    subreddit: item.subreddit,
    media: item.media,
    replyTo: item.replyTo,
    quoteOf: item.quoteOf,
    idempotencyKey: item.id,
  }, { env });
}

async function recoverStaleDeliveries(now: Date): Promise<string[]> {
  const snapshot = await readSocialQueue();
  const staleIds = new Set(snapshot.filter((item) => {
    if (item.state !== "posting" || !item.delivery) return false;
    const startedAt = Date.parse(item.delivery.startedAt);
    return !Number.isFinite(startedAt) || now.getTime() - startedAt >= POSTING_STALE_MS;
  }).map((item) => item.id));
  if (!staleIds.size) return [];
  const recovered: string[] = [];
  await mutateSocialQueue((queue) => queue.map((item) => {
    if (!staleIds.has(item.id) || item.state !== "posting" || !item.delivery) return item;
    recovered.push(item.id);
    return transitionQueueItem(item, "failed", {
      by: "tick",
      now,
      failure: {
        at: now.toISOString(),
        error: "HivemindOS restarted or lost the worker while this post was being delivered. The provider may have accepted it; verify the account before a human-triggered retry.",
        attempts: item.delivery.attempt,
        kind: "ambiguous",
        retryable: false,
      },
    });
  }));
  return recovered;
}

async function effectiveAccounts(
  queue: SocialQueueItem[],
  env: Record<string, string>,
  probe: TickDependencies["connectionProbeImpl"],
  now: Date,
): Promise<Map<string, SocialAccount>> {
  const wanted = new Set(queue.filter((item) => item.state === "approved" || item.state === "scheduled").map((item) => item.accountId));
  const accounts = (await readSocialAccounts()).filter((account) => wanted.has(account.id) && queue.some((item) =>
    item.accountId === account.id && queueItemReadyToPost(item, { ...account, status: "connected" }, now, { includeNextAwakeAt: false }).ready));
  const pairs = await Promise.all(accounts.map(async (account) => {
    try {
      const status = await (probe ?? defaultConnectionProbe)(account, env);
      return [account.id, { ...account, status: status.ok ? "connected" : "needs-attention" }] as const;
    } catch {
      return [account.id, { ...account, status: "needs-attention" }] as const;
    }
  }));
  return new Map(pairs);
}

async function claimForPosting(itemId: string, account: SocialAccount, now: Date): Promise<SocialQueueItem | null> {
  let claimed: SocialQueueItem | null = null;
  await mutateSocialQueue((queue) => queue.map((item) => {
    if (item.id !== itemId) return item;
    if (!queueItemReadyToPost(item, account, now, { includeNextAwakeAt: false }).ready) return item;
    const attempt = (item.delivery?.attempt ?? item.failure?.attempts ?? 0) + 1;
    claimed = transitionQueueItem(item, "posting", {
      by: "tick",
      now,
      delivery: { idempotencyKey: item.id, attempt, startedAt: now.toISOString() },
    });
    return claimed;
  }));
  return claimed;
}

async function settleSuccess(itemId: string, result: SocialPostResult, now: Date): Promise<void> {
  await mutateSocialQueue((queue) => queue.map((item) => item.id === itemId && item.state === "posting"
    ? transitionQueueItem(item, "posted", {
        by: "tick",
        now,
        result: { ...result, postedAt: now.toISOString() },
      })
    : item));
}

async function settleFailure(itemId: string, error: unknown, now: Date): Promise<{ retrying: boolean; message: string }> {
  const message = error instanceof Error ? error.message : String(error);
  let retrying = false;
  await mutateSocialQueue((queue) => queue.map((item) => {
    if (item.id !== itemId || item.state !== "posting") return item;
    const attempts = item.delivery?.attempt ?? 1;
    const known = error instanceof SocialPostError ? error : null;
    const ambiguous = known?.ambiguous ?? true;
    if (known?.retryable && !ambiguous && attempts < MAX_SOCIAL_POST_ATTEMPTS) {
      retrying = true;
      const retryAt = new Date(now.getTime() + retryDelayMs(attempts)).toISOString();
      return {
        ...transitionQueueItem(item, "scheduled", {
          by: "tick",
          now,
          scheduledFor: retryAt,
          failure: { at: now.toISOString(), error: message, attempts, kind: "definite", retryable: true },
        }),
        retryAt,
      };
    }
    return transitionQueueItem(item, "failed", {
      by: "tick",
      now,
      failure: {
        at: now.toISOString(),
        error: message,
        attempts,
        kind: ambiguous ? "ambiguous" : "definite",
        retryable: false,
      },
    });
  }));
  return { retrying, message };
}

async function tickOnce(dependencies: TickDependencies = {}) {
  const now = dependencies.now ?? new Date();
  const meta = await readSocialQueueMeta();
  if (!meta.settings.enabled) return { posted: [], recovered: [], skipped: "paused" as const };
  const drafting = await (dependencies.draftingImpl ?? ((at) => runSocialDraftingCycle({ now: at })))(now);
  const recovered = await recoverStaleDeliveries(now);
  const queue = await readSocialQueue();
  const env = dependencies.env ?? await readSharedAgentEnv();
  const accounts = await effectiveAccounts(queue, env, dependencies.connectionProbeImpl, now);
  const posted: string[] = [];
  let lastError: string | undefined;
  for (const snapshot of queue) {
    if (snapshot.state !== "approved" && snapshot.state !== "scheduled") continue;
    const account = accounts.get(snapshot.accountId);
    if (!account || !queueItemReadyToPost(snapshot, account, now).ready) continue;
    const currentAccount = await getSocialAccount(account.id);
    if (!currentAccount) continue;
    const effective = { ...currentAccount, status: account.status };
    const claimed = await claimForPosting(snapshot.id, effective, now);
    if (!claimed) continue;
    try {
      const result = await (dependencies.postImpl ?? defaultPost)(claimed, effective, env);
      await settleSuccess(claimed.id, result, now);
      posted.push(claimed.id);
    } catch (error) {
      const settled = await settleFailure(claimed.id, error, now);
      if (!settled.retrying) lastError = settled.message;
    }
  }
  const priorTick = Date.parse(meta.lastTickAt ?? "");
  const heartbeatDue = !Number.isFinite(priorTick) || now.getTime() - priorTick >= 60_000;
  if (heartbeatDue || posted.length || recovered.length || lastError !== meta.lastError) {
    await updateSocialQueueEngineMeta((current) => ({
      ...current,
      lastTickAt: now.toISOString(),
      ...(posted.length ? { lastPostedAt: now.toISOString() } : {}),
      lastError,
    }));
  }
  return { posted, recovered, drafting };
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

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    runner.lastWakeAt = new Date().toISOString();
    try {
      runner.lease = await acquireOrRenewSocialQueueDriverLease();
      if ((runner.lease.held || socialQueueDriverLeaseDisabled()) && !runner.tickInFlight) {
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
  await releaseSocialQueueDriverLease();
}

export function startSocialQueueEngine(): { running: boolean; startedAt?: string } {
  if (socialQueueEngineDisabled()) return { running: false };
  const existing = globalState.__hivemindSocialQueueRunner;
  if (existing && !existing.stopRequested && existing.schemaVersion === SOCIAL_QUEUE_RUNNER_SCHEMA) {
    return { running: true, startedAt: existing.startedAt };
  }
  // Next dev HMR keeps globalThis alive. Retire the old loop when its module
  // schema differs so it cannot keep writing an older runtime-overlay shape.
  if (existing && !existing.stopRequested) existing.stopRequested = true;
  const runner: Runner = {
    schemaVersion: SOCIAL_QUEUE_RUNNER_SCHEMA,
    stopRequested: false,
    loop: null,
    startedAt: new Date().toISOString(),
    tickInFlight: false,
  };
  globalState.__hivemindSocialQueueRunner = runner;
  runner.loop = loop(runner).catch((error) => { runner.lastError = error instanceof Error ? error.message : String(error); });
  return { running: true, startedAt: runner.startedAt };
}

export async function stopSocialQueueEngine(): Promise<{ running: boolean }> {
  const runner = globalState.__hivemindSocialQueueRunner;
  if (!runner) return { running: false };
  runner.stopRequested = true;
  await runner.loop?.catch(() => undefined);
  globalState.__hivemindSocialQueueRunner = undefined;
  return { running: false };
}

export async function runSocialQueueTickNow(dependencies: TickDependencies = {}) {
  const lease = await acquireOrRenewSocialQueueDriverLease();
  if (!lease.held && !socialQueueDriverLeaseDisabled()) return { held: false, posted: [], recovered: [] };
  const result = await tickOnce(dependencies);
  return { ...result, held: true };
}

export async function getSocialQueueEngineStatus() {
  const runner = globalState.__hivemindSocialQueueRunner;
  const meta = await readSocialQueueMeta();
  return {
    running: Boolean(runner && !runner.stopRequested),
    disabled: socialQueueEngineDisabled(),
    startedAt: runner?.startedAt,
    lastWakeAt: runner?.lastWakeAt,
    lastError: runner?.lastError ?? meta.lastError,
    lastTickAt: meta.lastTickAt,
    lastPostedAt: meta.lastPostedAt,
    enabled: meta.settings.enabled,
    leaseHeld: runner?.lease?.held ?? false,
    leaseHolder: runner?.lease?.holder,
  };
}
