import { z } from "zod";

import { defineHiveAction } from "../define";

export const medusaReadAction = defineHiveAction({
  id: "integrations.medusa-read",
  title: "Read Medusa store data",
  description: "Read a bounded product or region list from the connected Medusa Store API.",
  schema: z.object({
    action: z.enum(["products", "regions"]),
    limit: z.number().int().min(1).max(100).optional(),
  }).strict(),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["medusa", "commerce", "store", "products", "catalog", "regions", "self-hosted"],
  aliases: ["medusa_read", "read medusa products", "list medusa regions", "inspect medusa store"],
  requiresConnection: ["MEDUSA_PUBLISHABLE_API_KEY"],
  mcp: { expose: true, compact: true, toolName: "medusa_read" },
  contextIndex: {
    summary: "Read connected Medusa products or regions without exposing the publishable API key.",
    retrievalText: "Use medusa_read after a hosted or self-hosted Medusa backend is connected in chat or Integrations. action=products returns a bounded Store API product list and action=regions returns configured commerce regions. Admin mutations are not enabled by this storefront-scoped connector.",
    route: "/api/integrations/medusa",
    methods: ["POST"],
  },
});
