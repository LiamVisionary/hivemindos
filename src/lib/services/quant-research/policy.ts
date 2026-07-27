import type {
  QuantResearchAgentAssignments,
  QuantResearchRoleCapability,
  QuantResearchRoleId,
} from "@/lib/types/quant-research";

export const REQUIRED_QUANT_FACTOR_SERIES = [
  "MKT",
  "SMB",
  "HML",
  "RMW",
  "CMA",
  "MOM",
  "LOW_VOL",
] as const;

export const QUANT_RESEARCH_POLICY = {
  schemaVersion: 1,
  researchOnly: true,
  liveTradingEnabled: false,
  minimumExecutionLagBars: 1,
  minimumHacTStat: 3,
  requirePointInTimeData: true,
  requireSurvivorshipBiasControl: true,
  requireIndependentValidator: true,
  requireFactorCoverage: true,
  requiredFactorSeries: REQUIRED_QUANT_FACTOR_SERIES,
  requireRegimeCoverage: true,
  requireMultipleTestingControl: true,
} as const;

export const QUANT_RESEARCH_ROLE_MATRIX: readonly QuantResearchRoleCapability[] = [
  {
    id: "idea-generator",
    title: "Idea Generator",
    implementation: "llm",
    workerClass: "research",
    deterministic: false,
    responsibilities: [
      "Propose falsifiable hypotheses and economic mechanisms.",
      "Declare the trial family before results are inspected.",
    ],
  },
  {
    id: "feature-engineer",
    title: "Feature Engineer",
    implementation: "llm",
    workerClass: "code",
    deterministic: false,
    responsibilities: [
      "Translate hypotheses into the allowlisted signal DSL.",
      "Document lags, universe assumptions, and data dependencies.",
    ],
  },
  {
    id: "backtester",
    title: "Backtester",
    implementation: "rust",
    workerClass: "code",
    deterministic: true,
    responsibilities: [
      "Run lagged, cost-aware simulation without arbitrary strategy code.",
      "Hash datasets and strategy specifications for lineage.",
    ],
  },
  {
    id: "validator",
    title: "Independent Validator",
    implementation: "python",
    workerClass: "qa",
    deterministic: true,
    responsibilities: [
      "Recompute statistics independently from the Rust engine.",
      "Apply HAC, bootstrap, FDR, PBO, placebo, and deflated-Sharpe gates.",
    ],
  },
  {
    id: "regime-auditor",
    title: "Regime Auditor",
    implementation: "python",
    workerClass: "research",
    deterministic: true,
    responsibilities: [
      "Fit a Gaussian hidden Markov model to aligned market returns and trailing volatility.",
      "Reject single-regime or concentrated performance.",
    ],
  },
  {
    id: "factor-decomposer",
    title: "Factor Decomposer",
    implementation: "python",
    workerClass: "research",
    deterministic: true,
    responsibilities: [
      "Regress strategy returns on supplied factors.",
      "Require factor-residual alpha to survive HAC inference.",
    ],
  },
] as const;

const MAKER_ROLES: readonly QuantResearchRoleId[] = [
  "idea-generator",
  "feature-engineer",
];

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export function validateQuantResearchAssignments(assignments: QuantResearchAgentAssignments) {
  const errors: string[] = [];
  const validator = assignments.validator;
  if (!validator) {
    return { ok: true as const, errors };
  }

  for (const role of MAKER_ROLES) {
    const maker = assignments[role];
    if (!maker) continue;
    const sameAgent = normalized(maker.agentId) === normalized(validator.agentId);
    const sameModel = normalized(maker.model) === normalized(validator.model);
    const sameProvider = normalized(maker.provider) === normalized(validator.provider);
    if (sameAgent || (sameModel && sameProvider)) {
      errors.push(
        `The validator must be independent from ${role}: use a different agent identity and provider/model pair.`,
      );
    }
  }

  return errors.length
    ? { ok: false as const, errors }
    : { ok: true as const, errors };
}
