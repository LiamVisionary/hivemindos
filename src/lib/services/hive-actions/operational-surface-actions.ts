import { z } from "zod";

import { defineHiveAction } from "./define";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const companyApiBudgetAction = defineHiveAction({
  id: "company.api-budget",
  title: "Company API budgets",
  description:
    "Read and apply authenticated company API limits, cost guardrails, and allowlisted Google Cloud service prerequisites.",
  schema: z.object({
    companyId: z.string(),
    action: z.enum(["read", "apply", "enable-gcp-service"]),
    budget: jsonObjectSchema.optional(),
    projectRef: z.string().optional(),
    service: z.string().optional(),
    confirmRaise: z.boolean().optional(),
  }),
  sideEffects: ["read", "write", "network"],
  risk: "high",
  tags: ["company", "api", "budget", "gcp", "limits", "governance"],
  aliases: ["company API budget", "GCP API limits", "company cost guardrails"],
  contextIndex: {
    summary: "Authenticated company API budget and provider-limit governance.",
    retrievalText:
      "Use /api/companies/[id]/api-budget to inspect or apply one company's API limits. Raising a cost guardrail requires the route's explicit confirmRaise gate; Google Cloud service enablement is restricted to the server allowlist.",
    route: "/api/companies/[id]/api-budget",
    methods: ["GET", "POST"],
  },
});

export const xCommandControlAction = defineHiveAction({
  id: "integration.x-command-control",
  title: "X command bot controls",
  description:
    "Inspect and manage the authenticated X command bot driver, paired device, hosted connection, and owner-approved wallet policy.",
  schema: z.object({
    action: z.enum([
      "status",
      "start-driver",
      "stop-driver",
      "pulse",
      "save-wallet-policy",
      "disable-wallet-policy",
      "configure",
      "pair-device",
      "revoke-device",
    ]),
    input: jsonObjectSchema.optional(),
  }),
  sideEffects: ["read", "write", "filesystem", "network", "credential"],
  risk: "high",
  tags: ["x", "command", "bot", "driver", "device", "wallet-policy"],
  aliases: ["X command bot", "X bot driver", "X bot wallet policy"],
  contextIndex: {
    summary: "Authenticated X command bot connection, device, driver, and wallet-policy controls.",
    retrievalText:
      "Use /api/integrations/x-command to read X command bot health or manage its local driver, paired device, hosted connection, and explicitly bounded wallet policy. This is a privileged control surface, not a general-purpose X posting action.",
    route: "/api/integrations/x-command",
    methods: ["GET", "POST"],
  },
});

export const tradingControlPlaneAction = defineHiveAction({
  id: "trading.control-plane",
  title: "Trading control plane",
  description:
    "Read and manage governed trade plans, paper simulations, portfolio snapshots, theses, broker probes, and position reconciliation.",
  schema: z.object({
    action: z.enum([
      "read",
      "config.update",
      "account-policy.update",
      "plan.create",
      "plan.approve",
      "plan.reject",
      "plan.simulate",
      "plan.record-external",
      "plan.assert-live",
      "snapshot.capture",
      "thesis.create",
      "thesis.update",
      "broker.upsert",
      "broker.probe",
      "position.reconcile",
    ]),
    input: jsonObjectSchema.optional(),
  }),
  sideEffects: ["read", "write", "filesystem", "network"],
  risk: "high",
  tags: ["trading", "plans", "paper", "portfolio", "thesis", "broker", "governance"],
  aliases: ["trade plans", "trading controls", "portfolio snapshots", "broker probe"],
  contextIndex: {
    summary: "Persistent governed trading plans, policies, simulations, and reconciliation.",
    retrievalText:
      "Use /api/trading/control to read the trading-control overview or manage plans, policy, paper simulation, snapshots, theses, broker health, and reconciliation. This route stages and validates work; live execution remains on the separately governed broker and wallet rails.",
    route: "/api/trading/control",
    methods: ["GET", "POST"],
  },
});

export const liquidityRangeManagerAction = defineHiveAction({
  id: "trading.liquidity-range-manager",
  title: "Liquidity range manager",
  description:
    "Inspect Base Uniswap v3 positions and manage shadow-only liquidity range monitors without signing transactions.",
  schema: z.object({
    action: z.enum(["read", "inspect", "upsert", "start", "stop", "delete", "run-once"]),
    id: z.string().optional(),
    tokenId: z.string().optional(),
    config: jsonObjectSchema.optional(),
  }),
  sideEffects: ["read", "write", "filesystem", "network"],
  risk: "medium",
  tags: ["trading", "liquidity", "uniswap", "base", "range", "shadow"],
  aliases: ["liquidity monitor", "Uniswap range manager", "LP shadow monitor"],
  contextIndex: {
    summary: "Shadow-only Base Uniswap v3 position inspection and range monitoring.",
    retrievalText:
      "Use /api/trading/liquidity-range to inspect a Base Uniswap v3 position or manage shadow-only monitoring configs. The route explicitly cannot sign transactions or execute live rebalances.",
    route: "/api/trading/liquidity-range",
    methods: ["GET", "POST"],
  },
});

export const predictionMarketsResearchAction = defineHiveAction({
  id: "trading.prediction-markets-research",
  title: "Prediction-market research",
  description:
    "Read public prediction-market data and run paper-only order, calibration, weather, and complement-arbitrage calculations.",
  schema: z.object({
    action: z.enum([
      "events",
      "book",
      "history",
      "trader",
      "paper-order",
      "calibration",
      "weather-probability",
      "btc-complement-arbitrage",
    ]),
    input: jsonObjectSchema.optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["trading", "prediction-markets", "polymarket", "paper", "calibration", "research"],
  aliases: ["prediction markets", "Polymarket research", "paper prediction order"],
  contextIndex: {
    summary: "Public prediction-market reads and paper-only research calculations.",
    retrievalText:
      "Use /api/trading/prediction for public event, book, history, and trader reads or paper-only order, calibration, weather-probability, and complement-arbitrage calculations. This surface never moves live funds.",
    route: "/api/trading/prediction",
    methods: ["GET", "POST"],
  },
});

export const OPERATIONAL_SURFACE_HIVE_ACTIONS = [
  companyApiBudgetAction,
  xCommandControlAction,
  tradingControlPlaneAction,
  liquidityRangeManagerAction,
  predictionMarketsResearchAction,
] as const;
