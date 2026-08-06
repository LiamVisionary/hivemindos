import "server-only";

import { createQueueItem, transitionQueueItem } from "@/lib/services/socials/social-queue-domain";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import {
  getSocialAccount,
  mutateSocialQueue,
  readSocialDraftingRuntime,
  readSocialMetricSnapshots,
  readSocialQueue,
  readSocialReadBudget,
} from "@/lib/services/socials/socials-store";
import { getXDiscoveryStatusForAccount } from "@/lib/services/socials/social-x-discovery";
import type { SocialEngagementTarget, SocialGeneratedDraftKind, SocialQueueItem } from "@/lib/services/socials/socials-types";

function requiredText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error("Post text is required.");
  return text;
}

function validInstant(value: unknown, field: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid date and time.`);
  return new Date(parsed).toISOString();
}

function validatePostInput(input: {
  platform: SocialQueueItem["platform"];
  text: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
}) {
  if (input.replyTo && input.quoteOf) throw new Error("A queue item cannot be both a reply and a quote post.");
  const max = socialPlatformRow(input.platform).drafting.maxCharacters;
  if (!max) throw new Error(`${input.platform} posting is not available.`);
  const reserve = 0;
  if (input.text.length > max - reserve) {
    throw new Error(`${input.platform} posts may use at most ${max - reserve} characters${reserve ? " when quoting" : ""}.`);
  }
  if (input.platform === "reddit" && !input.replyTo) {
    if (!input.title?.trim()) throw new Error("A title is required for a new Reddit post.");
    if (input.title.trim().length > 300) throw new Error("Reddit titles may use at most 300 characters.");
    if (!input.subreddit?.trim()) throw new Error("A subreddit is required for a new Reddit post.");
  }
}

function canonicalDraftText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export type GeneratedSocialDraft = {
  kind?: SocialGeneratedDraftKind;
  text: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
  suggestedFor?: string;
  rationale?: string;
  relevanceScore?: number;
  target?: SocialEngagementTarget;
};

/** Atomically add one model-produced pack, dropping exact repeats from prior queue history. */
export async function enqueueGeneratedSocialDrafts(input: {
  accountId: string;
  drafts: GeneratedSocialDraft[];
  model: string;
  contextSourceIds: string[];
  now?: Date;
}): Promise<SocialQueueItem[]> {
  const account = await getSocialAccount(input.accountId);
  if (!account) throw new Error(`Unknown social account: ${input.accountId}`);
  if (!socialPlatformRow(account.platform).drafting.supported) {
    throw new Error(`${account.platform} does not support social draft generation.`);
  }
  const now = input.now ?? new Date();
  const prior = await readSocialQueue();
  const seen = new Set(prior.filter((item) => item.accountId === account.id).map((item) => canonicalDraftText(item.text)));
  const seenEngagementTargets = new Set(prior
    .filter((item) => item.accountId === account.id)
    .flatMap((item) => [item.replyTo ? `reply:${item.replyTo}` : "", item.quoteOf ? `quote:${item.quoteOf}` : ""])
    .filter(Boolean));
  const created: SocialQueueItem[] = [];
  for (const draft of input.drafts.slice(0, 10)) {
    const text = requiredText(draft.text);
    const kind = draft.kind ?? (draft.replyTo ? "reply" : draft.quoteOf ? "quote" : "post");
    if (kind === "reply" && (!draft.target || draft.replyTo !== draft.target.externalId)) {
      throw new Error("Generated reply suggestions need a matching durable target snapshot.");
    }
    if (kind === "reply" && draft.quoteOf) throw new Error("Generated reply suggestions cannot also carry a quote target.");
    if (kind === "quote" && (!draft.target || draft.quoteOf !== draft.target.externalId)) {
      throw new Error("Generated quote suggestions need a matching durable target snapshot.");
    }
    if (kind === "quote" && draft.replyTo) throw new Error("Generated quote suggestions cannot also carry a reply target.");
    if (kind === "post" && (draft.target || draft.replyTo || draft.quoteOf)) {
      throw new Error("Standalone generated posts cannot carry an engagement target.");
    }
    const engagementKey = kind === "reply" ? `reply:${draft.replyTo}` : kind === "quote" ? `quote:${draft.quoteOf}` : "";
    if (engagementKey && seenEngagementTargets.has(engagementKey)) continue;
    const canonical = canonicalDraftText(text);
    if (seen.has(canonical)) continue;
    const subreddit = draft.subreddit?.trim() || account.binding?.defaultSubreddit;
    validatePostInput({ ...draft, platform: account.platform, text, subreddit });
    const reviewOnlyAccount = kind === "reply" || kind === "quote"
      ? { ...account, postingMode: "manual" as const, autoOptIn: undefined }
      : account;
    const item = createQueueItem({
      account: reviewOnlyAccount,
      text,
      title: draft.title,
      subreddit,
      replyTo: draft.replyTo,
      quoteOf: draft.quoteOf,
      suggestedFor: validInstant(draft.suggestedFor, "suggestedFor"),
      origin: "agent",
      now,
    });
    created.push({
      ...item,
      generation: {
        generatedAt: now.toISOString(),
        model: input.model.trim() || "unknown",
        contextSourceIds: [...new Set(input.contextSourceIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50),
        kind,
        ...(draft.rationale?.trim() ? { rationale: draft.rationale.trim().slice(0, 500) } : {}),
        ...(typeof draft.relevanceScore === "number" && Number.isFinite(draft.relevanceScore)
          ? { relevanceScore: Math.max(0, Math.min(100, draft.relevanceScore)) }
          : {}),
        ...(draft.target ? { target: draft.target } : {}),
      },
    });
    seen.add(canonical);
    if (engagementKey) seenEngagementTargets.add(engagementKey);
  }
  if (!created.length) throw new Error("The drafting model returned no new valid drafts; existing queue copy was left unchanged.");
  await mutateSocialQueue((queue) => [...created, ...queue]);
  return created;
}

export async function enqueueSocialPost(input: {
  accountId: string;
  text: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
  suggestedFor?: string;
  origin: "human" | "agent";
  /** Agent tools default to review even when the account has auto mode configured. */
  forceReview?: boolean;
}): Promise<SocialQueueItem> {
  const account = await getSocialAccount(input.accountId);
  if (!account) throw new Error(`Unknown social account: ${input.accountId}`);
  const text = requiredText(input.text);
  const subreddit = input.subreddit?.trim() || account.binding?.defaultSubreddit;
  validatePostInput({ ...input, platform: account.platform, text, subreddit });
  const item = createQueueItem({
    account: input.forceReview ? { ...account, postingMode: "manual", autoOptIn: undefined } : account,
    text,
    title: input.title,
    subreddit,
    replyTo: input.replyTo,
    quoteOf: input.quoteOf,
    suggestedFor: validInstant(input.suggestedFor, "suggestedFor"),
    origin: input.origin,
  });
  await mutateSocialQueue((queue) => [item, ...queue]);
  return item;
}

export async function updateSocialQueueDraft(input: {
  id: string;
  text: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
}): Promise<SocialQueueItem> {
  const text = requiredText(input.text);
  let updated: SocialQueueItem | null = null;
  await mutateSocialQueue((queue) => queue.map((item) => {
    if (item.id !== input.id) return item;
    if (!(["draft", "suggested", "failed"] as const).includes(item.state as "draft" | "suggested" | "failed")) {
      throw new Error(`Only drafts, suggestions, and failed items can be edited (this item is ${item.state}).`);
    }
    const replyTo = item.generation?.kind === "reply" ? item.generation.target?.externalId : input.replyTo?.trim() || undefined;
    const quoteOf = item.generation?.kind === "quote" ? item.generation.target?.externalId : input.quoteOf?.trim() || undefined;
    validatePostInput({ ...input, platform: item.platform, text, replyTo, quoteOf });
    updated = {
      ...item,
      text,
      title: input.title?.trim() || undefined,
      subreddit: input.subreddit?.trim().replace(/^r\//, "") || undefined,
      replyTo,
      quoteOf,
      updatedAt: new Date().toISOString(),
    };
    return updated;
  }));
  if (!updated) throw new Error(`Unknown social queue item: ${input.id}`);
  return updated;
}

async function transitionById(
  id: string,
  transform: (item: SocialQueueItem) => SocialQueueItem,
): Promise<SocialQueueItem> {
  let updated: SocialQueueItem | null = null;
  await mutateSocialQueue((queue) => queue.map((item) => {
    if (item.id !== id) return item;
    updated = transform(item);
    return updated;
  }));
  if (!updated) throw new Error(`Unknown social queue item: ${id}`);
  return updated;
}

export function approveSocialQueueItem(id: string): Promise<SocialQueueItem> {
  return transitionById(id, (item) => {
    if (item.state === "approved") return item;
    return transitionQueueItem(item, "approved", { by: "human" });
  });
}

export function scheduleSocialQueueItem(id: string, scheduledFor: string): Promise<SocialQueueItem> {
  const at = validInstant(scheduledFor, "scheduledFor");
  if (!at) throw new Error("scheduledFor is required.");
  return transitionById(id, (item) => item.state === "scheduled"
    ? {
        ...item,
        scheduledFor: at,
        approval: { at: new Date().toISOString(), by: "human" },
        automated: false,
        cancelWindowEndsAt: undefined,
        retryAt: undefined,
        updatedAt: new Date().toISOString(),
        stateHistory: [...item.stateHistory, { state: "scheduled", at: new Date().toISOString(), by: "human" }],
      }
    : transitionQueueItem(item, "scheduled", { by: "human", scheduledFor: at }));
}

export function sendSocialQueueItemNow(id: string): Promise<SocialQueueItem> {
  return transitionById(id, (item) => {
    if (item.state === "approved") return { ...item, scheduledFor: undefined, retryAt: undefined, updatedAt: new Date().toISOString() };
    return { ...transitionQueueItem(item, "approved", { by: "human" }), scheduledFor: undefined, retryAt: undefined };
  });
}

export function cancelSocialQueueItem(id: string): Promise<SocialQueueItem> {
  return transitionById(id, (item) => transitionQueueItem(item, "canceled", { by: "human" }));
}

export function retrySocialQueueItem(id: string, deliveryVerified: boolean): Promise<SocialQueueItem> {
  return transitionById(id, (item) => {
    if (item.state !== "failed") throw new Error(`Only failed posts can be retried (this item is ${item.state}).`);
    if (item.failure?.kind === "ambiguous" && !deliveryVerified) {
      throw new Error("Confirm that the post is not already visible on the social account before retrying this delivery-unknown item.");
    }
    return {
      ...transitionQueueItem(item, "approved", { by: "human" }),
      delivery: undefined,
      failure: undefined,
      retryAt: undefined,
      scheduledFor: undefined,
    };
  });
}

export async function deleteSocialQueueItem(id: string): Promise<void> {
  let found = false;
  await mutateSocialQueue((queue) => queue.filter((item) => {
    if (item.id !== id) return true;
    found = true;
    if (!(["posted", "canceled", "failed"] as const).includes(item.state as "posted" | "canceled" | "failed")) {
      throw new Error(`Only posted, canceled, or failed items can be removed (this item is ${item.state}).`);
    }
    return false;
  }));
  if (!found) throw new Error(`Unknown social queue item: ${id}`);
}

export async function socialQueueDashboard(accountId?: string) {
  const [queue, snapshots, account, drafting] = await Promise.all([
    readSocialQueue(),
    readSocialMetricSnapshots(accountId),
    accountId ? getSocialAccount(accountId) : Promise.resolve(null),
    accountId ? readSocialDraftingRuntime(accountId) : Promise.resolve(null),
  ]);
  const filtered = accountId ? queue.filter((item) => item.accountId === accountId) : queue;
  const history = filtered.filter((item) => item.state === "posted" || item.state === "failed" || item.state === "canceled");
  const posted = history.filter((item) => item.state === "posted");
  const metricTotals: Record<string, number> = {};
  for (const item of posted) {
    for (const [key, value] of Object.entries(item.result?.metrics ?? {})) metricTotals[key] = (metricTotals[key] ?? 0) + value;
  }
  const readBudget = account?.platform === "x" && account.method === "managed-oauth"
    ? await readSocialReadBudget(account.id, account.maxDailyReadOps, account.awakeHours.timezone)
    : undefined;
  const discovery = account?.platform === "x" ? await getXDiscoveryStatusForAccount(account) : undefined;
  return {
    queue: filtered,
    snapshots,
    ...(readBudget ? { readBudget } : {}),
    ...(drafting ? { drafting } : {}),
    ...(discovery ? { discovery } : {}),
    analytics: {
      posted: posted.length,
      failed: history.filter((item) => item.state === "failed").length,
      canceled: history.filter((item) => item.state === "canceled").length,
      automated: posted.filter((item) => item.automated).length,
      manual: posted.filter((item) => !item.automated).length,
      metricTotals,
    },
  };
}
