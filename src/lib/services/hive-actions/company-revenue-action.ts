import { z } from "zod";

import { defineHiveAction } from "./define";

export const companyRevenueLedgerAction = defineHiveAction({
  id: "company.revenue-ledger",
  title: "Company revenue ledger",
  description:
    "Record externally received company revenue, quote the platform revenue-share fee, or sync settled x402 seller receipts into the revenue ledger.",
  schema: z.object({
    action: z
      .enum(["quote", "record", "sync-x402"])
      .optional()
      .describe("Ledger operation; default record."),
    companyId: z.string().optional().describe("Required for record; optional filter for sync-x402."),
    amountUsd: z.number().optional(),
    source: z.string().optional(),
    externalId: z.string().optional().describe("Idempotency key from the upstream payment (e.g. receipt id)."),
    customerLabel: z.string().optional(),
    description: z.string().optional(),
    receivedAt: z.string().optional(),
    network: z.string().optional(),
  }),
  sideEffects: ["write", "network"],
  risk: "medium",
  tags: ["company", "zero-human-company", "revenue", "ledger", "x402", "receipts"],
  aliases: ["record company revenue", "company revenue rollup", "sync x402 receipts", "revenue share quote"],
  contextIndex: {
    summary:
      "Company revenue-in ledger: record received revenue, quote the revenue-share fee, sync settled x402 receipts; never moves money.",
    retrievalText:
      "Use /api/company-revenue to keep a company's revenue ledger truthful. GET returns records plus a rollup (and opportunistically sweeps settled seller receipts). POST action record appends revenue that already settled elsewhere (externalId is the idempotency key), quote previews the platform revenue-share fee, and sync-x402 pulls settled x402 seller receipts into the ledger. No money moves through this route — fee collection is refused here and settles through the hosted transaction policy.",
    route: "/api/company-revenue",
    methods: ["GET", "POST"],
  },
});
