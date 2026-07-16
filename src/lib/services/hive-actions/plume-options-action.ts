import { z } from "zod";

import { defineHiveAction } from "./define";

export const plumeOptionsAction = defineHiveAction({
  id: "wallet.plume-options",
  title: "Plume options",
  description:
    "Discover, prepare, and execute the fully collateralized Plume option lifecycle on Robinhood Chain testnet from a governed local EVM wallet.",
  schema: z.object({
    mode: z.enum(["prepare", "execute"]).optional(),
    agentId: z.string().optional(),
    action: z.enum(["write", "buy", "cancel", "buy-to-close", "exercise", "settle", "settle-worthless", "redeem", "reclaim"]),
    symbol: z.enum(["TSLA", "AMD"]),
    kind: z.enum(["call", "put"]),
    strikePrice: z.string().optional(),
    expiry: z.number().optional(),
    amount: z.string().optional(),
    premiumPerOption: z.string().optional(),
    offerId: z.string().optional(),
    seriesId: z.string().optional(),
    roundId: z.string().optional(),
    confirmation: z.string().optional(),
    approvalToken: z.string().optional(),
    reviewFingerprint: z.string().optional(),
    jurisdictionAttestation: z.boolean().optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "stocks", "options", "plume", "robinhood-chain", "testnet", "execution"],
  aliases: ["plume_options", "write covered call", "write cash secured put", "buy option", "exercise option", "settle option"],
  mcp: { expose: true, compact: true, toolName: "plume_options" },
  confirmation: {
    tokens: [
      "CONFIRM_OPTION_WRITE",
      "CONFIRM_OPTION_BUY",
      "CONFIRM_OPTION_CANCEL",
      "CONFIRM_OPTION_CLOSE",
      "CONFIRM_OPTION_EXERCISE",
      "CONFIRM_OPTION_SETTLE",
      "CONFIRM_OPTION_SETTLE_WORTHLESS",
      "CONFIRM_OPTION_REDEEM",
      "CONFIRM_OPTION_RECLAIM",
    ],
    reason:
      "Option actions approve or move testnet assets and must pass a server-derived review, wallet governance, jurisdiction attestation, simulation, and exact action-specific confirmation.",
    when: "always",
  },
  contextIndex: {
    summary: "Governed Plume options lifecycle on Robinhood Chain testnet; mainnet remains fail-closed.",
    retrievalText:
      "Use plume_options to browse or manage Plume covered calls and cash-secured puts for TSLA and AMD. Call mode prepare first so the server reads the authoritative offer, series, oracle, collateral, and confirmation token from the pinned testnet contracts. Execute only after the user reviews that result, confirms they are outside Plume's restricted jurisdictions, and supplies the exact returned CONFIRM_OPTION_* token and review fingerprint. The server resolves the local signer, enforces wallet/company governance, simulates approvals and the action, and records the mined receipt. Never substitute testnet addresses for mainnet; chain 4663 remains disabled until the canonical registry and audit are public and reviewed.",
    route: "/api/trading/plume",
    methods: ["GET", "POST"],
  },
});
