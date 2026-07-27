export const HARNESS_CONDITIONS = ["baseline", "treatment", "ablation"] as const;
export const HARNESS_RUN_OUTCOMES = ["accepted", "rejected", "needs-evidence", "blocked", "error"] as const;
export const HARNESS_DECISIONS = ["pending", "retain", "revise", "remove"] as const;

export type HarnessCondition = (typeof HARNESS_CONDITIONS)[number];
export type HarnessRunOutcome = (typeof HARNESS_RUN_OUTCOMES)[number];
export type HarnessDecision = (typeof HARNESS_DECISIONS)[number];

export type HarnessWorker = {
  runtime: string;
  model: string;
  agentId?: string;
  host?: string;
  configurationHash?: string;
};

export type HarnessAuthorityEnvelope = {
  mode: "read-only" | "workspace-write" | "consequential";
  approvalBoundary: string;
  recoveryPath: string;
  permissions?: string[];
};

export type HarnessBudget = {
  maxRunsPerCondition: number;
  maxRuntimeMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
};

export type HarnessJobContract = {
  title: string;
  targetRevision: string;
  externalState: string;
  worker: HarnessWorker;
  representativeJob: string;
  acceptedOutcome: string;
  evaluatorId: string;
  proofRequired: string[];
  authority: HarnessAuthorityEnvelope;
  budget: HarnessBudget;
  suspectedGap: string;
};

export type HarnessIntervention = {
  owner: string;
  change: string;
  expectedBehavior: string;
  mechanism: string;
  supportingEvidence: string[];
  weakeningEvidence: string[];
  carryingCost: string;
};

export type HarnessContextEvidence = {
  available: string[];
  retrieved: string[];
  invoked: string[];
  relevant: string[];
};

export type HarnessProof = {
  outcome: string[];
  architecture: string[];
  workerProduced: string[];
  evaluatorOnly: string[];
};

export type HarnessRunMetrics = {
  elapsedMs: number;
  retries: number;
  humanSteeringCount: number;
  toolCallCount: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
};

export type HarnessRunRecord = {
  id: string;
  condition: HarnessCondition;
  sessionId: string;
  targetRevision: string;
  environmentFingerprint: string;
  worker: HarnessWorker;
  authorityMode: HarnessAuthorityEnvelope["mode"];
  freshSession: boolean;
  isolatedTarget: boolean;
  interventionAvailable: boolean;
  interventionExercised: boolean;
  context: HarnessContextEvidence;
  proof: HarnessProof;
  outcome: HarnessRunOutcome;
  evaluationId: string;
  notes?: string[];
  metrics: HarnessRunMetrics;
  startedAt: number;
  completedAt: number;
};

export type HarnessExperimentComparison = {
  baselineRuns: number;
  treatmentRuns: number;
  ablationRuns: number;
  baselineAcceptedRate: number | null;
  treatmentAcceptedRate: number | null;
  acceptanceDelta: number | null;
  baselineProofRate: number | null;
  treatmentProofRate: number | null;
  proofDelta: number | null;
  baselineAverageElapsedMs: number | null;
  treatmentAverageElapsedMs: number | null;
  elapsedDeltaMs: number | null;
  baselineAveragePromptTokens: number | null;
  treatmentAveragePromptTokens: number | null;
  promptTokenDelta: number | null;
  parityFailures: string[];
  claimReady: boolean;
  claimLimits: string[];
};

export type HarnessExperimentRecord = {
  schemaVersion: 1;
  id: string;
  contract: HarnessJobContract;
  intervention: HarnessIntervention;
  runs: HarnessRunRecord[];
  comparison: HarnessExperimentComparison;
  decision: HarnessDecision;
  decisionEvidence: string[];
  retirementCondition?: string;
  createdAt: number;
  updatedAt: number;
};

export type HarnessExperimentCreateInput = {
  id?: unknown;
  contract?: unknown;
  intervention?: unknown;
  createdAt?: unknown;
};

export type HarnessExperimentListFilter = {
  limit?: unknown;
  decision?: unknown;
};
