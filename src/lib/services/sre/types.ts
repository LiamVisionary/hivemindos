export const SRE_PROVIDER_IDS = ["opensre", "native"] as const;
export type SreProviderId = (typeof SRE_PROVIDER_IDS)[number];

export const INCIDENT_SEVERITIES = ["info", "warning", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_SOURCES = ["fleet-watchdog", "manual", "api", "synthetic"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export type IncidentStatus =
  | "captured"
  | "queued"
  | "investigating"
  | "diagnosed"
  | "degraded"
  | "failed";

export type IncidentTargetInput = {
  key?: string;
  name?: string;
  kind?: string;
};

export type IncidentRemediationAttempt = {
  action: string;
  outcome: string;
  at?: string;
};

export type IncidentInvestigationInput = {
  summary: string;
  description?: string;
  severity?: IncidentSeverity;
  source?: IncidentSource;
  target?: IncidentTargetInput;
  symptoms?: string[];
  evidence?: Record<string, unknown>;
  remediationAttempts?: IncidentRemediationAttempt[];
  correlationId?: string;
};

export type IncidentBundle = {
  version: 1;
  capturedAt: string;
  summary: string;
  description?: string;
  severity: IncidentSeverity;
  source: IncidentSource;
  target?: {
    ref: string;
    kind?: string;
  };
  symptoms: string[];
  evidence: Record<string, unknown>;
  remediationAttempts: IncidentRemediationAttempt[];
  correlationId?: string;
  privacy: {
    redacted: true;
    identifiersHashed: true;
    bounded: true;
  };
};

export type SreDiagnosis = {
  report: string;
  problem: string;
  rootCause: string;
  isNoise: boolean;
  validityScore: number;
  toolCalls: Array<Record<string, unknown>>;
  recommendations: string[];
  recommendationsRequireApproval: true;
  executionAuthority: "hivemindos";
};

export type IncidentInvestigation = {
  version: 1;
  id: string;
  status: IncidentStatus;
  provider: SreProviderId;
  createdAt: number;
  updatedAt: number;
  bundle: IncidentBundle;
  diagnosis?: SreDiagnosis;
  error?: string;
  degradedReason?: string;
};

export type IncidentEventType =
  | "captured"
  | "queued"
  | "investigation-started"
  | "diagnosed"
  | "degraded"
  | "failed";

export type IncidentEvent = {
  id: string;
  sequence: number;
  incidentId: string;
  at: number;
  type: IncidentEventType;
  status: IncidentStatus;
  provider: SreProviderId;
  detail?: string;
};

export type SreProviderStatus = {
  id: SreProviderId;
  name: string;
  enabled: boolean;
  ready: boolean;
  mode: "structured-rca" | "capture-only";
  reason?: string;
  version?: string;
  pinnedCommit?: string;
  installedCommit?: string;
  baseUrl?: string;
  capabilities: {
    structuredDiagnosis: boolean;
    evidenceCollection: boolean;
    recommendations: boolean;
    autonomousRemediation: false;
  };
};
