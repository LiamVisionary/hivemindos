import { z } from "zod";

import { defineHiveAction } from "./define";

export const bankrCopyTradingAction = defineHiveAction({
  id: "trading.bankr-copy",
  title: "Bankr copy trading",
  description:
    "Manage Bankr-executed copy-trading subscriptions: verify a Bankr wallet connection, subscribe to mirror a target wallet (paper-first), tune limits, pause, resume, cancel, or fund the trading wallet.",
  schema: z.object({
    action: z.enum(["verify", "subscribe", "update", "pause", "resume", "cancel", "fund"]),
    apiKeyEnv: z
      .string()
      .optional()
      .describe("Shared Hive Env variable name holding the Bankr Wallet API key; never paste raw keys."),
    paymentWalletId: z.string().optional().describe("Local wallet that pays the x402 subscription price."),
    fundingWalletId: z.string().optional().describe("Local wallet that funds the Bankr trading wallet."),
    targetWallet: z.string().optional().describe("Wallet address whose trades get mirrored."),
    connectionKind: z.enum(["existing", "provisioned"]).optional(),
    subscriptionId: z.string().optional(),
    maxTradeUsd: z.number().optional(),
    maxDailyUsd: z.number().optional(),
    scalePercent: z.number().optional(),
    maxSlippageBps: z.number().optional(),
    mode: z.enum(["paper", "live"]).optional(),
    riskAcknowledgement: z.string().optional(),
    amountUsd: z.number().optional(),
    confirmation: z.string().optional(),
    approvalToken: z.string().optional(),
  }),
  sideEffects: ["wallet", "payment", "network", "credential"],
  risk: "critical",
  tags: ["trading", "copy-trade", "bankr", "mirror", "wallet", "subscription", "execution"],
  aliases: ["bankr copy trading", "copy a wallet with bankr", "mirror trades via bankr", "fund bankr copy wallet"],
  confirmation: {
    tokens: ["FUND_BANKR_COPY_WALLET"],
    reason:
      "Subscribing settles the subscription price over x402 from the payment wallet, and funding transfers real USDC into the Bankr trading wallet — funding requires the exact FUND_BANKR_COPY_WALLET confirmation, and switching to live mode requires an explicit risk acknowledgement.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Bankr-executed copy-trading management; subscriptions start in paper mode, funding and live mode stay behind explicit confirmations.",
    retrievalText:
      "Use /api/trading/bankr-copy to manage Bankr-executed copy trading. GET returns the dashboard (subscriptions, wallet, status). POST action verify checks a Bankr Wallet API key from the Shared Hive Env; subscribe creates a subscription that always starts in paper mode and pays its price over x402 from paymentWalletId; update tunes limits and is the only way to go live (requires riskAcknowledgement); pause, resume, and cancel manage the subscription; fund moves USDC from a local wallet into the Bankr trading wallet and requires the FUND_BANKR_COPY_WALLET confirmation. The HivemindOS-native mirror daemon remains the separate /api/trading/copy-trade surface.",
    route: "/api/trading/bankr-copy",
    methods: ["GET", "POST"],
  },
});
