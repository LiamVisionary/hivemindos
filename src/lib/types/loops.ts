export type LoopMode = "closed" | "open" | "optimizer";

export type LoopEvalGatePhase = "pre" | "post";

export type LoopEvalGateKind = "command" | "test" | "artifact" | "agent" | "human" | "receipt";

export type LoopEvalGateStatus = "pending" | "passed" | "failed" | "skipped";

export type LoopEvalGate = {
  id: string;
  title: string;
  kind: LoopEvalGateKind;
  phase: LoopEvalGatePhase;
  required: boolean;
  status: LoopEvalGateStatus;
  command?: string;
  verifier?: string;
  evidence?: string[];
  summary?: string;
  createdAt: number;
  updatedAt?: number;
};

export type LoopMetricDirection = "max" | "min";

export type LoopFrontierStrategyKind = "argmax" | "top_k" | "epsilon_greedy" | "softmax" | "pareto_per_task";

export type LoopFrontierStrategy = {
  kind: LoopFrontierStrategyKind;
  params?: Record<string, number>;
  seed?: number;
};

export type LoopBenchmark = {
  target?: string;
  command?: string;
  metricName?: string;
  metricDirection: LoopMetricDirection;
  scoreFloor?: number;
  resourceProfile?: string;
  instrumentation?: "sdk" | "inline" | "manual";
  discoveredAt: number;
  notes?: string[];
};

export type LoopExperimentStatus = "candidate" | "running" | "evaluated" | "committed" | "discarded" | "failed";

export type LoopExperiment = {
  id: string;
  parentId?: string;
  runId?: string;
  title?: string;
  hypothesis: string;
  status: LoopExperimentStatus;
  score?: number;
  taskScores?: Record<string, number>;
  taskDirections?: Record<string, LoopMetricDirection>;
  gateReceipts?: LoopReceipt[];
  agent?: string;
  result?: string;
  discardedReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type LoopAntiPattern = {
  id: string;
  title: string;
  reason: string;
  sourceExperimentId?: string;
  evidence: string[];
  createdAt: number;
};

export type LoopFrontierItem = {
  id: string;
  rank: number;
  score?: number;
  hypothesis: string;
  status: LoopExperimentStatus;
  parentId?: string;
  reason?: string;
};

export type LoopObservation = {
  totalExperiments: number;
  committedExperiments: number;
  discardedExperiments: number;
  failedExperiments: number;
  bestExperimentId?: string;
  bestScore?: number;
  runningBestExperimentIds: string[];
  frontier: LoopFrontierItem[];
  antiPatternCount: number;
  pendingRequiredGateCount: number;
  updatedAt: number;
};

export type LoopSpec = {
  mode: LoopMode;
  goal: string;
  successCriteria: string[];
  evalGates: LoopEvalGate[];
  benchmark?: LoopBenchmark;
  frontierStrategy?: LoopFrontierStrategy;
  experiments?: LoopExperiment[];
  antiPatterns?: LoopAntiPattern[];
  observation?: LoopObservation;
  budget?: {
    maxAttempts?: number;
    maxRuntimeMs?: number;
    maxTokens?: number;
    maxCostUsd?: number;
  };
  retryPolicy?: {
    maxAttempts?: number;
    onFailure?: "retry" | "needs-human";
  };
  handoffRules?: string[];
  evidenceRequired?: string[];
};

export type LoopReceipt = {
  id: string;
  gateId?: string;
  status: "passed" | "failed" | "skipped";
  summary: string;
  evidence: string[];
  verifier?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type LoopCapabilityCapital = {
  score: number;
  learningAssets: number;
  workflowAssets: number;
  evalGates: number;
  passedEvalGates: number;
  experiments: number;
  committedExperiments: number;
  frontierCandidates: number;
  antiPatterns: number;
  distillationQueue: number;
  learningVelocity: number;
  spendEfficiency: number | null;
  modelIndependence: number;
  notes: string[];
};
