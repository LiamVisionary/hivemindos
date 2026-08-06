import { z } from "zod";

import { defineHiveAction } from "./define";

const policySchema = z.record(z.string(), z.unknown()).optional().describe(
  "Partial local wallet x402 policy. The server still enforces the wallet network, Spend state, hard cap, auto-use, and governance rules.",
);

export const apifySearchActorsAction = defineHiveAction({
  id: "apify.search-actors",
  title: "Search Apify Actors",
  description: "Search Apify Store for pay-per-event Actors currently eligible for agentic prepaid payments, including compact pricing and input schemas.",
  schema: z.object({
    action: z.literal("search").default("search"),
    query: z.string().max(120).default("").optional(),
    limit: z.number().int().min(1).max(10).default(5).optional(),
    offset: z.number().int().min(0).max(10_000).default(0).optional(),
  }),
  readOnly: true,
  sideEffects: ["read", "network"],
  risk: "low",
  tags: ["apify", "actors", "web-data", "scraping", "automation", "search", "x402"],
  aliases: ["apify_search_actors", "find apify actor", "search actor store"],
  mcp: { expose: true, compact: true, toolName: "apify_search_actors" },
  contextIndex: {
    summary: "Read-only discovery of x402/prepaid-eligible Apify Actors with compact price and input-schema metadata.",
    retrievalText: "Use apify_search_actors to find an eligible Actor before an Apify run. Results are filtered to agentic-payment-compatible pay-per-event Actors and include pricing, popularity, and the input schema needed to construct a bounded call.",
    route: "/api/apify",
    methods: ["GET"],
  },
});

export const apifyX402StatusAction = defineHiveAction({
  id: "apify.x402-status",
  title: "Read Apify x402 balance",
  description: "Read non-secret status, remaining USD balance, and expiry for a wallet's encrypted Apify prepaid token.",
  schema: z.object({ action: z.literal("status").default("status"), agentId: z.string().min(1) }),
  readOnly: true,
  sideEffects: ["read", "network"],
  risk: "low",
  tags: ["apify", "actors", "balance", "prepaid", "x402", "wallet"],
  aliases: ["apify_x402_status", "apify balance", "apify token status"],
  mcp: { expose: true, compact: true, toolName: "apify_x402_status" },
  contextIndex: {
    summary: "Read the safe status, balance, and expiry of an encrypted Apify prepaid token without exposing it.",
    retrievalText: "Use apify_x402_status before funding or a large Actor run. It reads the current balance from Apify while the bearer token stays encrypted and server-side.",
    route: "/api/apify",
    methods: ["GET"],
  },
});

export const apifyFundAction = defineHiveAction({
  id: "apify.fund",
  title: "Fund Apify over x402",
  description: "Buy a non-refundable, 14-day Apify prepaid token with governed Base USDC over x402 and store the bearer token encrypted locally.",
  schema: z.object({
    action: z.literal("fund").default("fund"),
    agentId: z.string().min(1),
    amountUsd: z.number().min(1).max(100),
    policy: policySchema,
    confirmation: z.string().optional(),
    approvalToken: z.string().optional(),
    companyTaskId: z.string().optional(),
  }),
  sideEffects: ["wallet", "payment", "credential", "network"],
  risk: "critical",
  tags: ["apify", "actors", "wallet", "payment", "x402", "usdc", "base", "prepaid"],
  aliases: ["apify_fund", "buy apify credits", "fund apify token"],
  mcp: { expose: true, compact: true, toolName: "apify_fund" },
  confirmation: {
    token: "PAY_APIFY",
    reason: "Funding settles real USDC, may add the configured x402 platform fee, and buys non-refundable Apify credit that expires after 14 days. Personal wallets always require this exact confirmation.",
    when: "unless-auto-policy-allows",
  },
  contextIndex: {
    summary: "Governed Base-USDC x402 purchase of an encrypted Apify prepaid token; $1 minimum and 14-day non-refundable expiry.",
    retrievalText: "Use apify_fund only after apify_x402_status shows no usable balance. Review the amount, Base wallet, 14-day expiry, non-refundable balance, wallet cap, and any HivemindOS x402 platform fee. The route never returns the Apify bearer token.",
    route: "/api/apify",
    methods: ["POST"],
  },
});

export const apifyRunActorAction = defineHiveAction({
  id: "apify.run-actor",
  title: "Run Apify Actor",
  description: "Run one eligible Apify Actor from an encrypted prepaid token with a required dollar charge ceiling, timeout, and bounded dataset result count.",
  schema: z.object({
    action: z.literal("run").default("run"),
    agentId: z.string().min(1),
    actorId: z.string().describe('Exact Actor name in "username/name" format.'),
    input: z.record(z.string(), z.unknown()).default({}),
    maxChargeUsd: z.number().min(0.01).max(100).describe("Hard maximum Apify may debit from the prepaid token for this run."),
    resultLimit: z.number().int().min(1).max(100).default(20).optional(),
    timeoutSecs: z.number().int().min(10).max(150).default(120).optional(),
    confirmation: z.string().optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["apify", "actors", "web-data", "scraping", "automation", "payment", "prepaid"],
  aliases: ["apify_run_actor", "run apify actor", "call apify actor"],
  mcp: { expose: true, compact: true, toolName: "apify_run_actor" },
  confirmation: {
    token: "RUN_APIFY_ACTOR",
    reason: "An Actor run accesses external sites and may debit the encrypted prepaid Apify balance up to maxChargeUsd. Review the exact Actor, input, result limit, and dollar ceiling first.",
    when: "unless-auto-policy-allows",
  },
  contextIndex: {
    summary: "Execute an eligible Apify Actor with a server-side token, required maxTotalChargeUsd, bounded results, and spend confirmation.",
    retrievalText: "Use apify_run_actor after apify_search_actors supplies the exact actorId, pricing, and input schema. Always set the smallest practical maxChargeUsd, resultLimit, and timeoutSecs. The route verifies agentic eligibility and token balance before the Actor starts and never exposes the token.",
    route: "/api/apify",
    methods: ["POST"],
  },
});

export const APIFY_HIVE_ACTIONS = [
  apifySearchActorsAction,
  apifyX402StatusAction,
  apifyFundAction,
  apifyRunActorAction,
] as const;
