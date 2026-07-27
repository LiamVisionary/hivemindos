import { z } from "zod";

import { defineHiveAction } from "@/lib/services/hive-actions/define";
import { enqueueSocialPost } from "@/lib/services/socials/social-queue-service";

const suggestionFields = {
  accountId: z.string().min(1).describe("Connected Socials account id, such as x:brand."),
  text: z.string().min(1).describe("Complete proposed post text."),
  title: z.string().optional().describe("Required for a new Reddit post."),
  subreddit: z.string().optional().describe("Required for a new Reddit post unless the account has a default subreddit."),
  replyTo: z.string().optional().describe("External post/message id to reply to."),
  quoteOf: z.string().optional().describe("External post id to quote; Farcaster uses fid:castHash."),
  suggestedFor: z.string().datetime().optional().describe("Advisory ISO time shown to the reviewer."),
};

export const socialQueueSuggestionAction = defineHiveAction({
  id: "socials.queue-suggestion",
  title: "Create a social post suggestion",
  description:
    "Create an approval-gated draft in the HivemindOS Socials queue for a connected account. This action never publishes; a human must review, approve, and send or schedule it in Socials.",
  schema: z.object(suggestionFields),
  sideEffects: ["write", "filesystem"],
  risk: "low",
  tags: ["social", "socials", "post", "draft", "queue", "x", "telegram", "farcaster", "linkedin", "reddit"],
  aliases: ["draft social post", "queue social suggestion", "create x draft", "social_queue_suggestion"],
  mcp: { expose: true, compact: true, toolName: "social_queue_suggestion" },
  contextIndex: {
    summary: "Create an approval-gated social post suggestion; never publishes directly.",
    retrievalText:
      "Use social_queue_suggestion when asked to draft or prepare a post for a connected Socials account. It writes a suggestion to the durable local queue and always forces human review, even if the account has auto mode configured. Publishing happens only through the Socials approval controls.",
    route: "/api/socials/queue",
    methods: ["GET", "POST"],
  },
  async run(input) {
    const item = await enqueueSocialPost({ ...input, origin: "agent", forceReview: true });
    return { ok: true, item, message: `Draft queued for review as ${item.id}. Nothing was published.` };
  },
});

export const socialQueueAccountPolicyAction = defineHiveAction({
  id: "socials.queue-by-account-policy",
  title: "Queue a social post under account auto policy",
  description:
    "Queue an agent-authored post under the connected account's explicit auto-mode policy. The account must already be opted in; the post receives a visible cancellation window and awake-hours enforcement before publishing.",
  schema: z.object({
    ...suggestionFields,
    confirmation: z.literal("CONFIRM_SOCIAL_AUTO_QUEUE"),
  }),
  sideEffects: ["write", "filesystem", "network", "public-message", "payment"],
  risk: "high",
  tags: ["social", "socials", "post", "auto mode", "queue", "x", "telegram", "farcaster", "linkedin", "reddit"],
  aliases: ["auto queue social post", "social_queue_by_account_policy"],
  mcp: { expose: true, compact: true, toolName: "social_queue_by_account_policy" },
  confirmation: {
    token: "CONFIRM_SOCIAL_AUTO_QUEUE",
    reason:
      "This can publish publicly after the account's cancellation window and may debit managed X credits. The account's durable auto-mode opt-in is rechecked again at send time.",
    when: "always",
  },
  contextIndex: {
    summary: "Queue a post under an explicitly opted-in account auto policy, with cancellation and awake-hours gates.",
    retrievalText:
      "Use social_queue_by_account_policy only when the human explicitly asks to use an account's configured auto mode and supplies CONFIRM_SOCIAL_AUTO_QUEUE. It schedules through the durable queue, never bypasses its cancellation window, rechecks the account opt-in at fire time, and may spend managed X credits.",
    route: "/api/socials/queue",
    methods: ["GET", "POST"],
  },
  async run({ confirmation, ...input }) {
    if (confirmation !== "CONFIRM_SOCIAL_AUTO_QUEUE") throw new Error("Auto queue confirmation is required.");
    const item = await enqueueSocialPost({ ...input, origin: "agent" });
    return {
      ok: true,
      item,
      message: item.state === "scheduled"
        ? `Queued under account auto policy as ${item.id}; it remains cancelable until ${item.cancelWindowEndsAt}.`
        : `Account auto mode is not active, so ${item.id} was safely downgraded to a review suggestion.`,
    };
  },
});
