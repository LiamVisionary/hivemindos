import { z } from "zod";

import { AZURE_REFRESH_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";
import { defineHiveAction } from "../define";

export const azureResourcesAction = defineHiveAction({
  id: "integrations.azure-resources",
  title: "Read Microsoft Azure resources",
  description:
    "Read subscriptions, resource groups, resource inventories, or one ARM resource configuration through the connected Microsoft account. Hosted access is read-only.",
  schema: z.object({
    action: z.enum(["subscriptions", "resource-groups", "resources", "resource"]).default("subscriptions"),
    subscriptionId: z.string().optional(),
    resourceGroup: z.string().optional(),
    resourceId: z.string().optional(),
    apiVersion: z.string().optional().describe("Required only for a single resource read, e.g. 2024-01-01."),
    top: z.number().int().min(1).max(200).optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["azure", "microsoft", "cloud", "subscriptions", "resources", "configuration", "oauth", "mcp"],
  aliases: ["azure_resources", "list azure subscriptions", "list azure resources", "read azure config"],
  requiresConnection: [AZURE_REFRESH_TOKEN_ENV],
  mcp: { expose: true, compact: true, toolName: "azure_resources" },
  contextIndex: {
    summary: "Read-only Microsoft Azure subscription and resource inventory through hosted OAuth.",
    retrievalText:
      "Use azure_resources for hosted read-only Azure Resource Manager access after Microsoft Azure is connected in Integrations. Actions: subscriptions; resource-groups (subscriptionId); resources (subscriptionId, optional resourceGroup); resource (subscriptionId, resourceId, apiVersion). It never creates, changes, or deletes Azure resources. For broad local Azure service tooling, install the official Azure MCP from the same integration card; it starts read-only and management mode requires explicit user confirmation.",
    route: "/api/integrations/azure/resources",
    methods: ["POST"],
  },
});

