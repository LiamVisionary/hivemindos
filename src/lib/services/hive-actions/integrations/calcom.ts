import { z } from "zod";

import { defineHiveAction } from "../define";

export const calcomReadAction = defineHiveAction({
  id: "integrations.calcom-read",
  title: "Read Cal.com scheduling data",
  description: "Read the connected Cal.com profile, event types, or a bounded booking list.",
  schema: z.object({
    action: z.enum(["me", "event-types", "bookings"]),
    limit: z.number().int().min(1).max(100).optional(),
  }).strict(),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["calcom", "cal.com", "calendar", "scheduling", "bookings", "availability", "event-types"],
  aliases: ["calcom_read", "read cal.com bookings", "list scheduling event types", "check cal.com profile"],
  requiresConnection: ["CALCOM_API_KEY"],
  mcp: { expose: true, compact: true, toolName: "calcom_read" },
  contextIndex: {
    summary: "Read connected Cal.com profile, event types, or bookings without exposing the API key.",
    retrievalText: "Use calcom_read after Cal.com is connected in the in-chat setup modal or Integrations. action=me reads account identity, action=event-types lists scheduling types, and action=bookings returns a bounded booking list. Creating, rescheduling, or cancelling bookings is not enabled by this read-only connector.",
    route: "/api/integrations/calcom",
    methods: ["POST"],
  },
});
