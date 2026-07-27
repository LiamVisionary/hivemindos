import { z } from "zod";

import { defineHiveAction } from "./define";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const hostedMediaCatalogAction = defineHiveAction({
  id: "hosted-media.catalog",
  title: "Hosted media model catalog",
  description:
    "List image, video, audio, music, speech, lip-sync, editing, and enhancement models available through HivemindOS hosted media generation, including live retail quotes where pricing is fixed.",
  schema: z.object({}),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["hosted-media", "image-generation", "video-generation", "audio-generation", "credits", "agents"],
  aliases: ["hosted media models", "zero-config media generation", "image video audio model catalog"],
  mcp: { expose: true, compact: true, toolName: "hosted_media_catalog" },
  contextIndex: {
    summary: "Discover zero-config generative-media models available through HivemindOS hosted credits.",
    retrievalText:
      "Use hosted_media_catalog or GET /api/hivemindos/media before choosing a hosted image, video, audio, music, speech, lip-sync, edit, upscale, or enhancement model. The route needs no provider key and returns the official live catalog with HivemindOS retail pricing. For dynamic models, call hosted_media_read with action quote and the exact provider input before requesting generation.",
    route: "/api/hivemindos/media",
    methods: ["GET"],
  },
});

export const hostedMediaGenerationAction = defineHiveAction({
  id: "hosted-media.generate",
  title: "Generate hosted media with HivemindOS credits",
  description:
    "Submit a zero-configuration image, video, audio, music, speech, lip-sync, editing, or enhancement job billed to hosted HivemindOS credits at a previously quoted maximum debit.",
  schema: z.object({
    action: z.literal("generate"),
    model: z.string().optional(),
    input: jsonObjectSchema.optional(),
    agentId: z.string().optional(),
    maximumDebitUsd: z.number().positive().max(25).optional(),
    idempotencyKey: z.string().optional(),
    approvalToken: z.string().optional(),
    confirmation: z.string().optional(),
    companyTaskId: z.string().optional().describe("Active Work Board company task id; omit outside company work."),
  }),
  sideEffects: ["network", "payment"],
  risk: "high",
  tags: ["hosted-media", "image-generation", "video-generation", "audio-generation", "credits", "paid-api", "agents"],
  aliases: ["generate image with credits", "generate video with credits", "generate audio with credits", "hosted media generation"],
  confirmation: {
    token: "CONFIRM_HOSTED_MEDIA_GENERATION",
    reason:
      "A generate action reserves and may debit hosted HivemindOS credits. The separate hosted_media_read tool handles quotes and job-status reads without a spend confirmation.",
    when: "unless-auto-policy-allows",
  },
  mcp: { expose: true, compact: true, toolName: "hosted_media_generate" },
  contextIndex: {
    summary: "Generate hosted media with the shared HivemindOS credit balance.",
    retrievalText:
      "Use hosted_media_generate via POST /api/hivemindos/media only after hosted_media_read returned the exact quote. Send action generate with the same model/input, a local agentId, maximumDebitUsd at least equal to the quote, and a stable idempotencyKey. Ordinary calls use wallet policy only; an active company Work Board task must pass companyTaskId to add company freeze and budget policy. HivemindOS credits are the hard balance cap; provider credentials, provider billing, exact 25% markup, reservations, refunds, job ownership, and receipts stay server-side.",
    route: "/api/hivemindos/media",
    methods: ["POST"],
  },
});

export const hostedMediaReadAction = defineHiveAction({
  id: "hosted-media.read",
  title: "Quote or poll hosted media",
  description:
    "Read an exact hosted-media quote for a model payload or poll an existing owned generation job without submitting new provider spend.",
  schema: z.object({
    action: z.enum(["quote", "job"]),
    model: z.string().optional(),
    input: jsonObjectSchema.optional(),
    jobId: z.string().optional(),
    agentId: z.string().optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["hosted-media", "quote", "job-status", "credits", "agents"],
  aliases: ["hosted media quote", "poll media job", "check generation job"],
  mcp: { expose: true, compact: true, toolName: "hosted_media_read" },
  contextIndex: {
    summary: "Get an exact hosted-media retail quote or poll an owned async job without creating provider spend.",
    retrievalText:
      "Use hosted_media_read with action quote plus model/input before any hosted generation; the result includes the exact provider quote with HivemindOS's 25% markup. Use action job with jobId and agentId to poll after submission. Both operations are read-only with respect to new provider spend. Only hosted_media_generate crosses the paid generation boundary.",
    route: "/api/hivemindos/media",
    methods: ["POST"],
  },
});
