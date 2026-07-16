import { z } from "zod";
import { defineHiveAction } from "./define";

export const quantResearchAction = defineHiveAction({
  id: "research.quant-swarm",
  title: "Quant research swarm",
  description:
    "Run or inspect a research-only quant workflow with Rust backtests, independent Python statistics, multiple-testing controls, regime audits, and factor decomposition.",
  schema: z.object({
    action: z.enum(["policy", "list", "get", "run"]).default("policy"),
    runId: z.string().optional(),
    request: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: [
    "research",
    "quant",
    "backtest",
    "rust",
    "python",
    "statistics",
    "agent-swarm",
    "overfitting",
  ],
  aliases: [
    "quant research",
    "research swarm",
    "backtest strategy",
    "validate trading hypothesis",
    "factor decomposition",
    "regime audit",
  ],
  mcp: { expose: true, compact: true, toolName: "quant_research" },
  contextIndex: {
    summary:
      "Research-only quant swarm using an authoritative Rust simulator and independent Python validation.",
    retrievalText:
      "Use quant_research or /api/quant-research to inspect policy, list/get durable runs, or run typed strategy candidates through the research-only pipeline. It requires point-in-time and survivorship-control assertions, one-bar-or-greater execution lag, explicit costs, aligned market returns plus MKT/SMB/HML/RMW/CMA/MOM/LOW_VOL factor histories, independent maker-checker assignments, Newey-West HAC t-stat at least 3, block bootstrap, false-discovery control, CSCV probability of backtest overfit, shifted-signal placebo, deflated Sharpe, Gaussian-HMM regime robustness, and factor-residual alpha. It writes local artifacts only. Live trading and order execution are disabled.",
    route: "/api/quant-research",
    methods: ["GET", "POST"],
  },
});
