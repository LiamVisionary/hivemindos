#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-social-queue-service-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const store = await import("../src/lib/services/socials/socials-store.ts");
const service = await import("../src/lib/services/socials/social-queue-service.ts");

const xAccount = await store.createSocialAccount({ platform: "x", handle: "queue-service", method: "api-token" });
const draft = await service.enqueueSocialPost({ accountId: xAccount.id, text: "  Review me  ", origin: "human" });
assert.equal(draft.state, "draft");
assert.equal(draft.text, "Review me");

const edited = await service.updateSocialQueueDraft({ id: draft.id, text: "Edited copy" });
assert.equal(edited.text, "Edited copy");
const scheduled = await service.scheduleSocialQueueItem(draft.id, "2026-07-21T12:00:00.000Z");
assert.equal(scheduled.state, "scheduled");
assert.equal(scheduled.approval?.by, "human");
const rescheduled = await service.scheduleSocialQueueItem(draft.id, "2026-07-21T13:00:00.000Z");
assert.equal(rescheduled.scheduledFor, "2026-07-21T13:00:00.000Z");
assert.equal(rescheduled.automated, false);
const sendNow = await service.sendSocialQueueItemNow(draft.id);
assert.equal(sendNow.state, "approved");
assert.equal(sendNow.scheduledFor, undefined);

const canceledDraft = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Cancel me", origin: "human" });
const canceled = await service.cancelSocialQueueItem(canceledDraft.id);
assert.equal(canceled.state, "canceled");
await service.deleteSocialQueueItem(canceled.id);
assert.equal((await store.readSocialQueue()).some((item) => item.id === canceled.id), false);

const autoAccount = await store.updateSocialAccount(xAccount.id, (account) => ({
  ...account,
  postingMode: "auto",
  autoOptIn: { enabledAt: "2026-07-20T12:00:00.000Z", enabledBy: "human" },
}));
const automated = await service.enqueueSocialPost({ accountId: autoAccount.id, text: "Policy post", origin: "agent" });
assert.equal(automated.state, "scheduled");
assert.equal(automated.approval?.by, "auto-mode");
const forcedReview = await service.enqueueSocialPost({ accountId: autoAccount.id, text: "Review-only tool", origin: "agent", forceReview: true });
assert.equal(forcedReview.state, "suggested");
assert.equal(forcedReview.approval, undefined);

const target = {
  platform: "x",
  externalId: "1900000000000000001",
  url: "https://x.com/base/status/1900000000000000001",
  authorHandle: "base",
  authorName: "Base",
  text: "Agents need scoped sessions and explicit limits.",
  createdAt: "2026-07-20T16:00:00.000Z",
  discoveredAt: "2026-07-20T17:00:00.000Z",
  source: "timeline",
  metrics: { likes: 50, reposts: 4, replies: 7, quotes: 1, views: 1000 },
};
const [replySuggestion] = await service.enqueueGeneratedSocialDrafts({
  accountId: autoAccount.id,
  model: "gpt-5.6-luna",
  contextSourceIds: ["src-base"],
  now: new Date("2026-07-20T17:00:00.000Z"),
  drafts: [{
    kind: "reply",
    text: "the limits are what make scoped sessions useful",
    replyTo: target.externalId,
    target,
    relevanceScore: 92,
  }],
});
assert.equal(replySuggestion.state, "suggested", "engagement remains review-only even when standalone posts use auto mode");
assert.equal(replySuggestion.automated, false);
assert.equal(replySuggestion.approval, undefined);
assert.equal(replySuggestion.generation?.target?.url, target.url);
const retargetAttempt = await service.updateSocialQueueDraft({ id: replySuggestion.id, text: "edited reply", replyTo: "999" });
assert.equal(retargetAttempt.replyTo, target.externalId, "editing copy cannot silently detach it from its reviewed target snapshot");
await assert.rejects(
  () => service.updateSocialQueueDraft({ id: replySuggestion.id, text: "bad mixed target", quoteOf: "999" }),
  /both a reply and a quote/i,
);
await assert.rejects(
  () => service.enqueueGeneratedSocialDrafts({
    accountId: autoAccount.id,
    model: "gpt-5.6-luna",
    contextSourceIds: [],
    drafts: [{ kind: "reply", text: "mismatched target", replyTo: "999", target }],
  }),
  /matching durable target snapshot/i,
);
await assert.rejects(
  () => service.enqueueGeneratedSocialDrafts({
    accountId: autoAccount.id,
    model: "gpt-5.6-luna",
    contextSourceIds: [],
    drafts: [{ kind: "reply", text: "different copy, same source", replyTo: target.externalId, target }],
  }),
  /no new valid drafts/i,
  "the same reply target cannot be suggested twice across queue history",
);
await assert.rejects(
  () => service.enqueueSocialPost({ accountId: autoAccount.id, text: "invalid mixed post", replyTo: "1", quoteOf: "2", origin: "human" }),
  /both a reply and a quote/i,
);

const failed = {
  ...forcedReview,
  id: "social_ambiguous",
  state: "failed",
  failure: { at: new Date().toISOString(), error: "Delivery unknown", attempts: 1, kind: "ambiguous", retryable: false },
};
await store.mutateSocialQueue((queue) => [failed, ...queue]);
await assert.rejects(() => service.retrySocialQueueItem(failed.id, false), /Confirm that the post is not already visible/);
const retried = await service.retrySocialQueueItem(failed.id, true);
assert.equal(retried.state, "approved");
assert.equal(retried.failure, undefined);

const reddit = await store.createSocialAccount({ platform: "reddit", handle: "reddit-user", method: "api-token", binding: { defaultSubreddit: "hivemind" } });
await assert.rejects(
  () => service.enqueueSocialPost({ accountId: reddit.id, text: "Missing title", origin: "human" }),
  /title is required/i,
);
const redditDraft = await service.enqueueSocialPost({ accountId: reddit.id, title: "Launch", text: "Reddit copy", origin: "human" });
assert.equal(redditDraft.subreddit, "hivemind");

const dashboard = await service.socialQueueDashboard(xAccount.id);
assert.ok(dashboard.queue.length >= 4);
assert.equal(dashboard.analytics.posted, 0);

console.log("social queue service tests passed");
