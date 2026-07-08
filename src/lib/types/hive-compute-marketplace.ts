export type HiveComputeBinaryStatus = {
  name: string;
  installed: boolean;
  version?: string;
  error?: string;
};

export type HiveComputeEnvPresence = {
  name: string;
  present: boolean;
  source?: "process" | "shared-hive-env";
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
  workerToken: HiveComputeEnvPresence;
  workerModule: HiveComputeWorkerModuleStatus;
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
  };
};

export type HiveComputeInstallResult = {
  installed: boolean;
  wrote: string[];
  skipped: string[];
  status: HiveComputeMarketplaceStatus;
};
