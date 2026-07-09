export type HiveComputeBinaryStatus = {
  name: string;
  installed: boolean;
  version?: string;
  error?: string;
};

export type HiveComputeEnvPresence = {
  name: string;
  present: boolean;
  source?: "process" | "shared-hive-env" | "local-session";
};

export type HiveComputeModelOption = {
  id: string;
  name?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type HiveComputeGatewayStatus = {
  configured: boolean;
  baseUrl?: string;
  openAiBaseUrl?: string;
  apiKey: HiveComputeEnvPresence;
  capacity?: {
    liveWorkers: number;
    liveModels: string[];
    keyRelayModels: string[];
    fallbackConfigured: boolean;
    pendingJobs: number;
    statusLabel: string;
    statusTone: "live" | "fallback" | "empty";
  };
  health?: {
    ok: boolean;
    status?: number;
    message?: string;
  };
  models?: {
    ok: boolean;
    count: number;
    ids: string[];
    status?: number;
    message?: string;
  };
};

export type HiveComputePaymentRail = "x402" | "mpp" | "prepaid" | "self-hosted";

export type HiveComputePaymentStatus = {
  defaultRail: HiveComputePaymentRail;
  railEnv: string;
  x402: {
    ready: boolean;
    message: string;
  };
  mpp: {
    enabled: boolean;
    ready: boolean;
    enabledEnv: string;
    policyUrlEnv: string;
    sessionTokenEnv: string;
    requireSessionEnv: string;
    policyUrl?: string;
    sessionToken: HiveComputeEnvPresence;
    requireSession: boolean;
    message: string;
  };
};

export type HiveComputePrivacyStatus = {
  mode: "standard" | "tee-required" | "attestation-policy";
  verifiedOnly: boolean;
  teeRequiredEnv: string;
  confidentialModeEnv: string;
  attestationPolicyUrlEnv: string;
  teeProviderEnv: string;
  attestationFileEnv: string;
  attestationCommandEnv: string;
  attestationFormatEnv: string;
  measurementEnv: string;
  imageDigestEnv: string;
  encryptionPublicKeyEnv: string;
  decryptionPrivateKeyFileEnv: string;
  attestationPolicyUrl?: string;
  teeProvider?: string;
  attestationReady: boolean;
  encryptedDeliveryReady: boolean;
  evidenceSource?: "file" | "command";
  message: string;
};

export type HiveComputeWorkerModuleStatus = {
  root: string;
  installed: boolean;
  packageJsonPath: string;
  workerPath: string;
  readmePath: string;
  nodeModulesInstalled: boolean;
  packageName: string;
  version: string;
  runCommand: string;
  dependencyInstallCommand: string;
};

export type HiveComputeHostWhen = "idle" | "always" | "sched";

export type HiveComputeHostRunConfig = {
  markdown: number;
  maxConcurrency: number;
  hostWhen: HiveComputeHostWhen;
  dailyCapUsd: number | null;
  pauseOnBattery: boolean;
  yieldToUser: boolean;
};

export type HiveComputeLocalBackendKind = "lmstudio" | "openai" | "ollama";

export type HiveComputeLocalBackendStatus = {
  kind: HiveComputeLocalBackendKind;
  label: string;
  host: string;
  reachable: boolean;
  message: string;
};

export type HiveComputeHostModel = {
  id: string;
  name?: string;
  providerModelId: string;
  backendKind: HiveComputeLocalBackendKind;
  inputPer1m: number;
  outputPer1m: number;
};

export type HiveComputeWorkerRunStatus = {
  status: "idle" | "starting" | "running" | "failed";
  output: string;
  error: string;
  startedAt: number;
  pid?: number;
};

export type HiveComputeHostContext = {
  backend: HiveComputeLocalBackendStatus;
  models: HiveComputeHostModel[];
  config: HiveComputeHostRunConfig;
  canRun: boolean;
  message: string;
  run?: HiveComputeWorkerRunStatus;
};

export type HiveComputeMarketplaceStatus = {
  productName: string;
  providerSlug: string;
  defaultModel: string;
  gatewayEnv: string;
  openAiBaseEnv: string;
  apiKeyEnv: string;
  workerTokenEnv: string;
  estimatedEarningsEnv: string;
  estimatedEarningsLabel?: string;
  checkedAt: string;
  gateway: HiveComputeGatewayStatus;
  payments: HiveComputePaymentStatus;
  privacy: HiveComputePrivacyStatus;
  workerToken: HiveComputeEnvPresence;
  workerModule: HiveComputeWorkerModuleStatus;
  host: HiveComputeHostContext;
  prerequisites: {
    node: HiveComputeBinaryStatus;
    ollama: HiveComputeBinaryStatus;
  };
  models: HiveComputeModelOption[];
  routing: {
    ready: boolean;
    message: string;
    chatPath: string;
  };
  earning: {
    ready: boolean;
    message: string;
    cta: string;
  };
  boundary: {
    mode: "client-module";
    officialAuthority: string;
    selfHosted: string;
    promptPrivacy: string;
    confidentialCompute: string;
    micropayments: string;
  };
};

export type HiveComputeInstallResult = {
  installed: boolean;
  wrote: string[];
  skipped: string[];
  status: HiveComputeMarketplaceStatus;
};
