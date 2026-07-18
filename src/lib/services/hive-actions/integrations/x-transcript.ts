import { z } from "zod";

import { defineHiveAction } from "../define";

export const xTranscriptAction = defineHiveAction({
  id: "integrations.x-transcript",
  title: "X post transcript",
  description:
    "Pull and transcribe the video or audio from a public X post, optionally summarized; long media runs as a pollable background job.",
  schema: z.object({
    url: z.string().optional().describe("The X post link, e.g. https://x.com/user/status/123 — required for POST."),
    action: z
      .enum(["inspect", "start"])
      .optional()
      .describe("inspect previews the media; start launches a pollable job; omit for a one-shot transcript."),
    summarize: z.boolean().optional(),
    jobId: z.string().optional().describe("Poll a started job via GET ?jobId=."),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["integrations", "x", "twitter", "transcript", "video", "speech-to-text", "media"],
  aliases: ["x transcript", "transcribe x post", "transcribe tweet video", "twitter video transcript"],
  contextIndex: {
    summary:
      "Read-only transcript retrieval for X post videos; long media runs as a pollable detached job.",
    retrievalText:
      "Use /api/integrations/x-transcript when a user shares an X post link and wants the video or audio transcribed or summarized. POST action inspect previews the media first; action start launches a detached job whose id is polled with GET ?jobId= so long downloads never hang one request; omitting action resolves a one-shot transcript inline. Nothing durable is written and no posting or payment happens through this route.",
    route: "/api/integrations/x-transcript",
    methods: ["GET", "POST"],
  },
});
