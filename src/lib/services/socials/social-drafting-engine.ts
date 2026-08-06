import "server-only";

import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import type { SocialConnectProbe } from "@/lib/services/socials/adapters/types";
import {
  generateSocialDraftPack,
  type SocialDraftGeneration,
  type SocialDraftGenerationMode,
} from "@/lib/services/socials/social-draft-generator";
import { socialAccountHasStandaloneGroundingSource } from "@/lib/services/socials/social-drafting-readiness";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import { enqueueGeneratedSocialDrafts } from "@/lib/services/socials/social-queue-service";
import {
  getSocialAccount,
  mutateSocialDraftingRuntime,
  readAllSocialDraftingRuntime,
  readSocialAccounts,
  readSocialQueue,
} from "@/lib/services/socials/socials-store";
import type { SocialAccount, SocialDraftingRuntime, SocialQueueItem } from "@/lib/services/socials/socials-types";

const STALE_DRAFTING_CLAIM_MS = 15 * 60_000;
const FIRST_FAILURE_RETRY_MS = 15 * 60_000;
const MAX_FAILURE_RETRY_MS = 6 * 60 * 60_000;
const MAX_ACTIVE_GENERATED_DRAFTS = 20;

type DraftingDependencies = {
  now?: Date;
  accountId?: string;
  force?: boolean;
  mode?: SocialDraftGenerationMode;
  env?: Record<string, string>;
  connectionProbeImpl?: (account: SocialAccount, env: Record<string, string>) => Promise<SocialConnectProbe>;
  generateImpl?: (input: {
    account: SocialAccount;
    queue: SocialQueueItem[];
    count: number;
    now: Date;
    mode: SocialDraftGenerationMode;
  }) => Promise<SocialDraftGeneration>;
};

export type SocialDraftingCycleResult = {
  generated: string[];
  failed: Array<{ accountId: string; error: string }>;
  skipped: Array<{ accountId: string; reason: string }>;
};

function due(runtime: SocialDraftingRuntime, now: Date): boolean {
  const next = Date.parse(runtime.nextRunAt ?? "");
  return !Number.isFinite(next) || next <= now.getTime();
}

function engagementProducerEnabled(account: SocialAccount): boolean {
  return account.drafting.engagementEnabled && socialPlatformRow(account.platform).drafting.engagement.supported;
}

function automaticGenerationMode(account: SocialAccount): SocialDraftGenerationMode | null {
  const posts = account.drafting.enabled && socialAccountHasStandaloneGroundingSource(account);
  const engagement = engagementProducerEnabled(account);
  if (posts && engagement) return "all";
  if (posts) return "posts";
  if (engagement) return "engagement";
  return null;
}

function generationModeStillEnabled(account: SocialAccount, mode: SocialDraftGenerationMode): boolean {
  const posts = account.drafting.enabled && socialAccountHasStandaloneGroundingSource(account);
  if (mode === "posts") return posts;
  if (mode === "engagement") return engagementProducerEnabled(account);
  return posts && engagementProducerEnabled(account);
}

function runtimeRecoveredFromQueue(account: SocialAccount, queue: SocialQueueItem[]): SocialDraftingRuntime | null {
  const generated = queue
    .filter((item) => item.accountId === account.id && item.generation)
    .sort((left, right) => Date.parse(right.generation!.generatedAt) - Date.parse(left.generation!.generatedAt));
  const latest = generated[0]?.generation;
  if (!latest) return null;
  const latestPack = generated.filter((item) => item.generation?.generatedAt === latest.generatedAt);
  const latestPostAt = generated.find((item) => item.generation?.kind === "post")?.generation?.generatedAt;
  const latestEngagementAt = generated.find((item) => item.generation?.kind === "reply" || item.generation?.kind === "quote")?.generation?.generatedAt;
  const latestPostPack = latestPostAt ? generated.filter((item) => item.generation?.generatedAt === latestPostAt) : [];
  const latestEngagementPack = latestEngagementAt ? generated.filter((item) => item.generation?.generatedAt === latestEngagementAt) : [];
  return {
    lastAttemptAt: latest.generatedAt,
    lastSuccessAt: latest.generatedAt,
    nextRunAt: new Date(Date.parse(latest.generatedAt) + account.drafting.cadenceHours * 60 * 60_000).toISOString(),
    lastModel: latest.model,
    lastGeneratedCount: latestPack.length,
    ...(latestPostAt
      ? {
          lastPostGeneratedAt: latestPostAt,
          lastPostGeneratedCount: latestPostPack.filter((item) => item.generation?.kind === "post").length,
        }
      : {}),
    ...(latestEngagementAt
      ? {
          lastEngagementGeneratedAt: latestEngagementAt,
          lastReplyGeneratedCount: latestEngagementPack.filter((item) => item.generation?.kind === "reply").length,
          lastQuoteGeneratedCount: latestEngagementPack.filter((item) => item.generation?.kind === "quote").length,
          lastDiscoveryAt: latestEngagementAt,
          lastDiscoveryBackend: "agent-reach-twitter-cli" as const,
          lastDiscoveredCount: new Set(latestEngagementPack.flatMap((item) => item.generation?.target?.externalId ?? [])).size,
        }
      : {}),
    totalGenerated: generated.length,
    consecutiveFailures: 0,
  };
}

function nextSuccessAt(account: SocialAccount, now: Date): string {
  return new Date(now.getTime() + account.drafting.cadenceHours * 60 * 60_000).toISOString();
}

function nextFailureAt(runtime: SocialDraftingRuntime, now: Date): string {
  const failures = Math.max(1, runtime.consecutiveFailures + 1);
  const delay = Math.min(MAX_FAILURE_RETRY_MS, FIRST_FAILURE_RETRY_MS * 2 ** (failures - 1));
  return new Date(now.getTime() + delay).toISOString();
}

async function claim(account: SocialAccount, now: Date, force: boolean): Promise<boolean> {
  let claimed = false;
  await mutateSocialDraftingRuntime(account.id, (runtime) => {
    const inFlightAt = Date.parse(runtime.inFlightSince ?? "");
    const liveClaim = Number.isFinite(inFlightAt) && now.getTime() - inFlightAt < STALE_DRAFTING_CLAIM_MS;
    if (liveClaim || (!force && !due(runtime, now))) return runtime;
    claimed = true;
    return { ...runtime, lastAttemptAt: now.toISOString(), inFlightSince: now.toISOString() };
  });
  return claimed;
}

async function settleSuccess(account: SocialAccount, generation: SocialDraftGeneration, items: SocialQueueItem[], now: Date): Promise<void> {
  const postCount = items.filter((item) => item.generation?.kind === "post").length;
  const replyCount = items.filter((item) => item.generation?.kind === "reply").length;
  const quoteCount = items.filter((item) => item.generation?.kind === "quote").length;
  const engagementCount = replyCount + quoteCount;
  await mutateSocialDraftingRuntime(account.id, (runtime) => ({
    ...runtime,
    lastAttemptAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
    nextRunAt: nextSuccessAt(account, now),
    inFlightSince: undefined,
    lastError: postCount ? undefined : runtime.lastError,
    lastModel: generation.model,
    lastGeneratedCount: items.length,
    ...(postCount ? { lastPostGeneratedAt: now.toISOString(), lastPostGeneratedCount: postCount } : {}),
    ...(engagementCount
      ? {
          lastEngagementGeneratedAt: now.toISOString(),
          lastReplyGeneratedCount: replyCount,
          lastQuoteGeneratedCount: quoteCount,
        }
      : {}),
    ...(generation.engagement
      ? {
          lastDiscoveryAt: now.toISOString(),
          lastDiscoveryBackend: generation.engagement.backend,
          lastDiscoveredCount: generation.engagement.candidateCount,
        }
      : {}),
    lastEngagementError: generation.engagementError ?? (engagementCount ? undefined : runtime.lastEngagementError),
    totalGenerated: runtime.totalGenerated + items.length,
    consecutiveFailures: 0,
  }));
}

async function settleFailure(account: SocialAccount, error: unknown, now: Date, mode: SocialDraftGenerationMode): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  await mutateSocialDraftingRuntime(account.id, (runtime) => ({
    ...runtime,
    lastAttemptAt: now.toISOString(),
    nextRunAt: nextFailureAt(runtime, now),
    inFlightSince: undefined,
    ...(mode === "engagement"
      ? { lastEngagementError: message.slice(0, 1_000) }
      : { lastError: message.slice(0, 1_000) }),
    lastGeneratedCount: 0,
    consecutiveFailures: runtime.consecutiveFailures + 1,
  }));
  return message;
}

async function defaultProbe(account: SocialAccount, env: Record<string, string>): Promise<SocialConnectProbe> {
  return socialAdapter(account.platform).connectStatus(account, { env });
}

async function defaultGenerate(input: Parameters<NonNullable<DraftingDependencies["generateImpl"]>>[0]): Promise<SocialDraftGeneration> {
  return generateSocialDraftPack(input);
}

/**
 * Produce due draft packs. This is deliberately separate from delivery: model
 * standalone output enters the existing account policy. Engagement output is
 * always review-only, even when standalone posting has an explicit auto opt-in.
 */
export async function runSocialDraftingCycle(dependencies: DraftingDependencies = {}): Promise<SocialDraftingCycleResult> {
  const now = dependencies.now ?? new Date();
  const force = dependencies.force === true;
  const mode = dependencies.mode ?? "all";
  const [allAccounts, runtimeByAccount] = await Promise.all([readSocialAccounts(), readAllSocialDraftingRuntime()]);
  let queue: SocialQueueItem[] | null = null;
  const recoverableAccounts = allAccounts.filter((account) => socialPlatformRow(account.platform).drafting.supported);
  if (recoverableAccounts.some((account) => !runtimeByAccount[account.id]?.lastSuccessAt)) {
    queue = await readSocialQueue();
    for (const account of recoverableAccounts) {
      const runtime = runtimeByAccount[account.id];
      if (runtime?.lastSuccessAt) continue;
      const recovered = runtimeRecoveredFromQueue(account, queue);
      if (!recovered) continue;
      runtimeByAccount[account.id] = recovered;
      await mutateSocialDraftingRuntime(account.id, () => recovered);
    }
  }
  const accounts = allAccounts.filter((account) => {
    if (dependencies.accountId && account.id !== dependencies.accountId) return false;
    if (!socialPlatformRow(account.platform).drafting.supported) return false;
    if (socialAdapter(account.platform).capabilities(account).post === "unsupported") return false;
    if (!force) {
      const enabled = mode === "all" ? automaticGenerationMode(account) !== null : generationModeStillEnabled(account, mode);
      if (!enabled) return false;
    }
    return force || due(runtimeByAccount[account.id] ?? { totalGenerated: 0, consecutiveFailures: 0 }, now);
  });
  const result: SocialDraftingCycleResult = { generated: [], failed: [], skipped: [] };
  if (!accounts.length) return result;
  queue ??= await readSocialQueue();
  let env = dependencies.env;
  for (const account of accounts) {
    const effectiveMode = !force && mode === "all" ? automaticGenerationMode(account)! : mode;
    const activeGenerated = queue.filter((item) => item.accountId === account.id
      && item.generation
      && !["posted", "failed", "canceled"].includes(item.state)).length;
    const expectedPackSize = effectiveMode === "engagement"
      ? account.drafting.replyDraftsPerRun + account.drafting.quoteDraftsPerRun
      : account.drafting.draftsPerRun
        + (effectiveMode === "all" && account.drafting.engagementEnabled
          ? account.drafting.replyDraftsPerRun + account.drafting.quoteDraftsPerRun
          : 0);
    if (!force && activeGenerated + expectedPackSize > MAX_ACTIVE_GENERATED_DRAFTS) {
      result.skipped.push({ accountId: account.id, reason: `Review the ${activeGenerated} pending generated drafts before another pack is created.` });
      await mutateSocialDraftingRuntime(account.id, (runtime) => ({
        ...runtime,
        nextRunAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      }));
      continue;
    }
    if (!await claim(account, now, force)) {
      result.skipped.push({ accountId: account.id, reason: "Drafting is not due or another drafting run is active." });
      continue;
    }
    try {
      env ??= await readSharedAgentEnv();
      const probe = await (dependencies.connectionProbeImpl ?? defaultProbe)(account, env);
      if (!probe.ok) throw new Error(`Account connection is not ready: ${probe.detail}`);
      const generation = await (dependencies.generateImpl ?? defaultGenerate)({
        account,
        queue: await readSocialQueue(),
        count: account.drafting.draftsPerRun,
        now,
        mode: effectiveMode,
      });
      const currentAccount = await getSocialAccount(account.id);
      if (!currentAccount || (!force && !generationModeStillEnabled(currentAccount, effectiveMode))) {
        throw new Error("Drafting was disabled while this generation was running; no suggestions were saved.");
      }
      const items = await enqueueGeneratedSocialDrafts({
        accountId: account.id,
        drafts: generation.drafts,
        model: generation.model,
        contextSourceIds: generation.contextSourceIds,
        now,
      });
      result.generated.push(...items.map((item) => item.id));
      await settleSuccess(account, generation, items, now);
    } catch (error) {
      result.failed.push({ accountId: account.id, error: await settleFailure(account, error, now, effectiveMode) });
    }
  }
  return result;
}
