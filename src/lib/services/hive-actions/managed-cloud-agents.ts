import { z } from "zod";

import { MANAGED_CLOUD_FUND_CONFIRMATION } from "@/lib/services/managed-cloud-agents-contract";
import { defineHiveAction } from "./define";

export const managedCloudAgentsAction = defineHiveAction({
  id: "cloud.managed-agents",
  title: "Managed Cloud Agents",
  description:
    "Inspect, fund, deploy, operate, chat with, and explicitly connect always-on HivemindOS managed Hermes agents.",
  schema: z.object({
    action: z.enum([
      "top_up",
      "create",
      "status",
      "start",
      "stop",
      "delete",
      "chat",
      "recover_payment",
      "list_integrations",
      "connect_tailnet",
      "add_mcp",
      "pair_brain",
      "remove_integration",
    ]),
    instanceId: z.string().optional(),
    name: z.string().optional(),
    planId: z.enum(["small", "medium", "large"]).optional(),
    region: z.string().optional(),
    modelTier: z.enum(["fast", "balanced"]).optional(),
    walletAgentId: z.string().optional(),
    amountUsd: z.number().optional(),
    confirmation: z.string().optional(),
    messages: z.array(z.unknown()).optional(),
    authKey: z.string().optional(),
    advertiseTag: z.string().optional(),
    integrationName: z.string().optional(),
    integrationUrl: z.string().optional(),
    authorization: z.string().optional(),
    localTailnetDnsName: z.string().optional(),
    integrationId: z.string().optional(),
  }),
  sideEffects: ["read", "write", "network", "remote-machine", "wallet", "payment", "credential"],
  risk: "high",
  tags: ["managed-cloud", "cloud-agent", "hermes", "always-on", "pay-as-you-go", "tailnet", "shared-brain", "mcp"],
  aliases: ["managed cloud agent", "deploy always-on agent", "host hermes", "agent runs while computer is off"],
  confirmation: {
    token: MANAGED_CLOUD_FUND_CONFIRMATION,
    reason:
      "Funding sends Base USDC through the selected governed wallet. The route applies this confirmation only to top-ups; authenticated lifecycle and read operations do not move wallet funds.",
    when: "unless-auto-policy-allows",
  },
  mcp: { expose: false },
  contextIndex: {
    summary:
      "Operate dedicated always-on Hermes agents with persistent workspaces, server-metered billing, Tailnet, Shared Brain, and hosted MCP connections.",
    retrievalText:
      "Use /api/managed-cloud-agents to inspect plans and balances; fund managed credits with a governed Base wallet; deploy, start, stop, delete, or chat with a cloud Hermes agent; and explicitly connect Tailnet, Shared Brain, or HTTPS remote MCP capabilities. Funding requires FUND_MANAGED_AGENT. Official prices, recipients, settlement, infrastructure, inference keys, and entitlements remain server-authoritative.",
    route: "/api/managed-cloud-agents",
    methods: ["GET", "POST"],
  },
});
