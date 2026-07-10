export type FounderPrivacyMode = "private-first" | "balanced" | "cloud-ok";
export type FounderBudgetTier = "local-free" | "starter" | "growth" | "scale";
export type FounderPace = "today" | "week" | "month";

export type FounderConstraints = {
  privacy: FounderPrivacyMode;
  budgetTier: FounderBudgetTier;
  pace: FounderPace;
};

export type FounderAgentCandidate = {
  id: string;
  name: string;
  runtime?: string;
  model?: string;
  role?: string;
  workerClass?: string;
};

export type FounderCrewRole = {
  role: string;
  responsibility: string;
  candidateAgentId?: string;
  candidateAgentName?: string;
  runtime?: string;
  model?: string;
};

export type FounderCapability = {
  intent: string;
  label: string;
  readiness: "ready" | "missing" | "optional";
  implementation?: string;
  requiredCredentialKeys: string[];
  sideEffects: string[];
  approvalRequired: boolean;
  fallback?: string;
};

export type FounderComputeRoute = {
  id: string;
  label: string;
  source: "local" | "hive-compute" | "hosted";
  rationale: string;
  privacy: FounderPrivacyMode;
  estimatedCost: string;
  recommended: boolean;
};

export type FounderLabBlueprint = {
  title: string;
  objective: string;
  metricName: string;
  metricDirection: "increase" | "decrease";
  baselineScore?: number;
  significanceThreshold: number;
  hypotheses: string[];
  experiments: string[];
};

export type FounderBlueprint = {
  version: 1;
  generatedAt: string;
  goal: string;
  archetype: string;
  identity: {
    name: string;
    ticker: string;
    sector: string;
    blurb: string;
    charter: string;
  };
  apexGoal: {
    title: string;
    metric: string;
    target: string;
    unit: "number" | "percent" | "currency" | "users";
  };
  firstMilestone: {
    title: string;
    successCriteria: string[];
    deliverables: string[];
    pace: FounderPace;
  };
  crew: FounderCrewRole[];
  capabilities: FounderCapability[];
  computeRoutes: FounderComputeRoute[];
  budget: {
    firstMilestoneUsd: number;
    dailyUsd: number;
    monthlyUsd: number;
  };
  governance: {
    externalActionsRequireApproval: boolean;
    moneyMovementRequiresApproval: boolean;
    publishingRequiresApproval: boolean;
    killSwitchEnabled: boolean;
  };
  proofRequirements: string[];
  lab: FounderLabBlueprint;
  assumptions: string[];
  constraints: FounderConstraints;
};

export const DEFAULT_FOUNDER_CONSTRAINTS: FounderConstraints = {
  privacy: "private-first",
  budgetTier: "local-free",
  pace: "week",
};
