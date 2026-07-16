import { z } from "zod";

import { defineHiveAction } from "../define";

export const shopifyReadAction = defineHiveAction({
  id: "integrations.shopify-read",
  title: "Read Shopify store and products",
  description: "Read store identity or a bounded product catalog from the connected Shopify Admin GraphQL API.",
  schema: z.object({
    action: z.enum(["store", "products"]),
    limit: z.number().int().min(1).max(100).optional(),
  }).strict(),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["shopify", "commerce", "store", "products", "catalog", "admin-api", "graphql"],
  aliases: ["shopify_read", "read shopify store", "list shopify products", "inspect product catalog"],
  requiresConnection: ["SHOPIFY_ADMIN_ACCESS_TOKEN"],
  mcp: { expose: true, compact: true, toolName: "shopify_read" },
  contextIndex: {
    summary: "Read connected Shopify store identity or a bounded product catalog without exposing the Admin API token.",
    retrievalText: "Use shopify_read after Shopify is connected in the in-chat setup modal or Integrations. action=store reads store identity and plan context. action=products returns up to 100 recently updated products. This action is read-only; product, order, inventory, and storefront mutations require a separate governed action that is not enabled by this connector.",
    route: "/api/integrations/shopify",
    methods: ["POST"],
  },
});
