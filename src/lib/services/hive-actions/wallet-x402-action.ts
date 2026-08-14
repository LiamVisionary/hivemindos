import { z } from "zod";

import { defineHiveAction } from "./define";

export const walletX402FetchAction = defineHiveAction({
  id: "wallet.x402-fetch",
  title: "x402 paid fetch",
  description:
    "Execute a governed x402 paid HTTP request from a local agent wallet, settling the endpoint's USDC quote only after spend policy and confirmation checks.",
  schema: z.object({
    agentId: z.string().describe("Wallet vault id whose local wallet signs and pays."),
    actingAgentId: z.string().optional().describe("Agent requesting use of the wallet; required for per-agent autonomous permission."),
    url: z.string().describe("The x402-priced HTTP endpoint to call."),
    method: z.string().optional().describe("HTTP method, default GET."),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    policy: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Partial wallet spend-policy overrides (caps, auto-pay, provider)."),
    confirmation: z.string().optional(),
    companyTaskId: z.string().optional().describe("Active company task authorizing this spend, when applicable."),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "x402", "usdc", "paid-api", "execution"],
  aliases: ["x402_fetch", "paid fetch", "x402 request", "pay for an api call"],
  mcp: { expose: true, compact: true, toolName: "x402_fetch" },
  confirmation: {
    token: "PAY_X402",
    reason:
      "x402 fetches settle real USDC when the endpoint returns a payment quote. Personal user wallets never auto-pay and always need the explicit PAY_X402 confirmation; agent wallets must pass their governed spend policy first.",
    when: "unless-auto-policy-allows",
  },
  contextIndex: {
    summary:
      "Governed generic x402 paid HTTP request from a local wallet; spend policy plus PAY_X402 confirmation gate every payment.",
    retrievalText:
      "Use x402_fetch when an agent needs to call a paid x402 HTTP endpoint from its governed local wallet. The server resolves the wallet secret, enforces the wallet's spend-policy caps, and settles payment only when auto-pay policy allows it or the caller supplies the explicit PAY_X402 confirmation — personal user wallets never auto-pay. Prefer purpose-specific rails when they exist (Veil private x402, HivemindOS Models credits) and quote the pending approval context to the user before confirming.",
    route: "/api/wallet/x402",
    methods: ["POST"],
  },
});
