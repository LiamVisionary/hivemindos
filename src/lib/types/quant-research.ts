export type QuantResearchRoleId =
  | "idea-generator"
  | "feature-engineer"
  | "backtester"
  | "validator"
  | "regime-auditor"
  | "factor-decomposer";

export type QuantResearchImplementation = "llm" | "rust" | "python";

export interface QuantResearchRoleCapability {
  id: QuantResearchRoleId;
  title: string;
  implementation: QuantResearchImplementation;
  workerClass: "research" | "code" | "qa";
  deterministic: boolean;
  responsibilities: readonly string[];
}

export interface QuantResearchAgentAssignment {
  agentId: string;
  provider: string;
  model: string;
}

export type QuantResearchAgentAssignments = Partial<
  Record<QuantResearchRoleId, QuantResearchAgentAssignment>
>;

export type QuantResearchStageMode =
  | "sequential"
  | "parallel-map"
  | "parallel-fan-in"
  | "barrier";

export interface QuantResearchWorkflowStage {
  id: string;
  title: string;
  mode: QuantResearchStageMode;
  roles: QuantResearchRoleId[];
  candidateIds: string[];
}

export interface QuantResearchWorkflowGraph {
  schemaVersion: 1;
  researchOnly: true;
  stages: QuantResearchWorkflowStage[];
}

export interface QuantResearchCandidateResult {
  candidateId: string;
  passed: boolean;
  artifactHash: string;
  failedGateIds?: string[];
  backtestArtifactPath?: string;
  backtestArtifactHash?: string;
  validationArtifactPath?: string;
  validationArtifactHash?: string;
}

export interface QuantResearchAuditResult {
  candidateId: string;
  regimePassed: boolean;
  factorPassed: boolean;
}

export interface QuantResearchRunManifest {
  schemaVersion: 1;
  runId: string;
  researchOnly: true;
  liveTradingEnabled: false;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  graph: QuantResearchWorkflowGraph;
  candidates: QuantResearchCandidateResult[];
  audits: QuantResearchAuditResult[];
  promotedCandidateIds: string[];
  rejectedCandidateIds: string[];
  manifestPath: string;
  reportPath: string;
  dataset?: {
    id: string;
    source: string;
    asOf: string;
    bars: number;
    datasetHash: string;
  };
  validationPolicy?: Record<string, number>;
  assignments?: QuantResearchAgentAssignments;
  failureReason?: string;
}
