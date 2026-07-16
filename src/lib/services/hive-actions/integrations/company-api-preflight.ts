import { z } from "zod";

import { defineHiveAction } from "../define";

export const companyApiPreflightAction = defineHiveAction({
  id: "companies.api-preflight",
  title: "Reserve a company API or integration call",
  description:
    "Check a Zero Human Company's provider and operation limits, then atomically reserve request volume and estimated spend before making the external call.",
  schema: z.object({
    companyId: z.string().min(1).describe("The Zero Human Company id from the dispatched company context."),
    providerKey: z.string().min(1).describe("Connected-provider key, such as google-cloud, google, slack, github, or monid."),
    operationId: z.string().min(1).optional().describe("Connector-manifest operation id when the call targets a specific operation."),
    requestCount: z.number().int().nonnegative().default(1).describe("Number of calls to reserve."),
    amountUsd: z.number().nonnegative().default(0).describe("Conservative estimated USD cost to reserve."),
    source: z.string().min(1).optional().describe("Short caller/workflow label for the ZHC usage timeline."),
    idempotencyKey: z.string().min(1).optional().describe("Stable retry key so the same intended call is counted once."),
  }),
  sideEffects: ["write"],
  risk: "low",
  tags: ["company", "api", "integration", "limits", "quota", "budget", "preflight", "usage", "zhc", "mcp"],
  aliases: ["company_api_preflight", "check company api limit", "reserve integration usage", "api budget preflight"],
  mcp: { expose: true, compact: true, toolName: "company_api_preflight" },
  contextIndex: {
    summary: "Atomically enforce and reserve against a Zero Human Company's API/integration limits before an external call.",
    retrievalText:
      "Use company_api_preflight immediately before every external API or integration call performed for a Zero Human Company. Pass the companyId from its task context, the connector providerKey and operationId, one or more requests, a conservative amountUsd estimate, and a stable idempotencyKey. A blocked response means do not call the provider. The reservation feeds the company's Limits charts and provider saturation view.",
    route: "/api/companies",
    methods: ["POST"],
  },
});
