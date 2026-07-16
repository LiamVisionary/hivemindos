export const COMPUTER_INTERACTION_ADAPTER_IDS = [
  "hive-action",
  "bee-pilot",
  "page-agent",
  "browser-use",
  "screenshot",
] as const;

export type ComputerInteractionAdapterId = (typeof COMPUTER_INTERACTION_ADAPTER_IDS)[number];

export const COMPUTER_INTERACTION_ACTION_KINDS = [
  "observe",
  "open",
  "navigate",
  "click",
  "input",
  "type",
  "select",
  "scroll",
  "screenshot",
  "submit",
  "send",
  "upload",
  "download",
  "install",
  "delete",
  "purchase",
  "transfer",
  "eval",
  "hive-action",
  "complete",
] as const;

export type ComputerInteractionActionKind = (typeof COMPUTER_INTERACTION_ACTION_KINDS)[number];
export type ComputerInteractionRunStatus =
  | "running"
  | "paused"
  | "awaiting-approval"
  | "completed"
  | "failed"
  | "stopped";

export type ComputerInteractionAction = {
  id?: string;
  kind: ComputerInteractionActionKind;
  adapter: ComputerInteractionAdapterId;
  observationId?: string;
  params: Record<string, unknown>;
  consequence?: boolean;
  description?: string;
};

export type ComputerInteractionObservation = {
  id: string;
  adapter: ComputerInteractionAdapterId;
  sequence: number;
  capturedAt: number;
  url?: string;
  app?: string;
  title?: string;
  contentDigest: string;
  contentPreview?: string;
  injectionSuspected: boolean;
  injectionTrigger?: string;
  evidence: string[];
};

export type ComputerInteractionPolicy = {
  allowedDomains?: string[];
  allowedApps?: string[];
  requireConfirmationForConsequences?: boolean;
  pauseOnPromptInjection?: boolean;
};

export type ComputerInteractionLimits = {
  maxSteps: number;
  maxRuntimeMs: number;
  maxCostUsd: number;
};

export type ComputerInteractionPolicyDecision = {
  decision: "allow" | "block" | "pause" | "confirm";
  reasonCode:
    | "allowed"
    | "stale-observation"
    | "domain-not-allowed"
    | "app-not-allowed"
    | "prompt-injection-suspected"
    | "consequential-action";
  reason: string;
  tier: "observe" | "interact" | "consequence";
};

export type ComputerInteractionActionResult = {
  ok: boolean;
  summary: string;
  evidence?: string[];
  costUsd?: number;
  model?: string;
  cache?: { readTokens?: number; writeTokens?: number; hit?: boolean };
};

export type ComputerInteractionReceipt = {
  id: string;
  step: number;
  adapter: ComputerInteractionAdapterId;
  actionKind: ComputerInteractionActionKind;
  params: Record<string, unknown>;
  observationId?: string;
  verifiedObservationId?: string;
  outcome: "succeeded" | "failed" | "blocked" | "paused" | "awaiting-approval";
  summary: string;
  evidence: string[];
  policy: ComputerInteractionPolicyDecision;
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  costUsd?: number;
  model?: string;
  cache?: ComputerInteractionActionResult["cache"];
};

export type ComputerInteractionPendingApproval = {
  id: string;
  action: ComputerInteractionAction;
  actionFingerprint: string;
  reason: string;
  createdAt: number;
};

export type ComputerInteractionApprovedAction = {
  approvalId: string;
  actionFingerprint: string;
  approvedAt: number;
};

export type ComputerInteractionRun = {
  version: 1;
  id: string;
  goal: string;
  status: ComputerInteractionRunStatus;
  adapters: ComputerInteractionAdapterId[];
  policy: ComputerInteractionPolicy;
  limits: ComputerInteractionLimits;
  startedAt: number;
  updatedAt: number;
  deadlineAt: number;
  stepCount: number;
  costUsd: number;
  runtimeSessionId?: string;
  adapterContext?: {
    browserSession?: string;
  };
  latestObservation?: ComputerInteractionObservation;
  pendingApproval?: ComputerInteractionPendingApproval;
  approvedAction?: ComputerInteractionApprovedAction;
  receipts: ComputerInteractionReceipt[];
  error?: string;
};

export type ComputerInteractionEventType =
  | "run-started"
  | "observation"
  | "policy"
  | "action"
  | "verification"
  | "approval-required"
  | "approved"
  | "paused"
  | "resumed"
  | "stopped"
  | "completed"
  | "failed";

export type ComputerInteractionEvent = {
  id: string;
  sequence: number;
  runId: string;
  at: number;
  type: ComputerInteractionEventType;
  status: ComputerInteractionRunStatus;
  label: string;
  detail?: string;
  receiptId?: string;
  observationId?: string;
};

export type ComputerInteractionAdapter = {
  id: ComputerInteractionAdapterId;
  observe(input: { run: ComputerInteractionRun }): Promise<ComputerInteractionObservation>;
  act(input: { run: ComputerInteractionRun; action: ComputerInteractionAction }): Promise<ComputerInteractionActionResult>;
};
